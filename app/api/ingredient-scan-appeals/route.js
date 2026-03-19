import { corsJson, corsOptions } from "../_shared/cors";
import { sendNotificationEmail } from "../notifications/_shared/emailSender";
import {
  asText,
  bumpRestaurantWriteVersion,
  db,
  isAppAdminUser,
  requireAdminSession,
  requireAuthenticatedSession,
  setRestaurantWriteContext,
} from "../restaurant-write/_shared/writeGatewayUtils";
import {
  formatIngredientBrandAppealSnapshot,
  normalizeIngredientBrandAppeal,
} from "../../lib/ingredientBrandAppeal";
import { createSupabaseServiceRoleClient } from "../../lib/server/supabaseServerClient";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsOptions();
}

const DEFAULT_APPEAL_PHOTO_BUCKET = "ingredient-scan-appeals";
const MAX_APPEAL_PHOTO_BYTES = 768 * 1024;

function errorResponse(message, status) {
  return corsJson({ success: false, error: message }, { status });
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseDataUrl(dataUrl) {
  const value = asText(dataUrl);
  if (!value.startsWith("data:") || !value.includes(",")) return null;
  const [header, base64Data] = value.split(",", 2);
  const mediaType = asText(header.split(";")[0]?.replace("data:", "")) || "image/jpeg";
  if (!base64Data) return null;
  return { mediaType, base64Data };
}

function estimateBase64Bytes(base64Data) {
  const safe = asText(base64Data);
  if (!safe) return 0;
  const padding = safe.endsWith("==") ? 2 : safe.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((safe.length * 3) / 4) - padding);
}

function extensionForMediaType(mediaType) {
  const normalized = asText(mediaType).toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  return "jpg";
}

function createStorageAdminClient() {
  return createSupabaseServiceRoleClient();
}

function getPublicAppealPhotoUrl(value) {
  const safeValue = asText(value);
  return safeValue.startsWith("data:") ? "" : safeValue;
}

function resolveAppealActorLabel(session, fallbackLabel) {
  const metadata = session?.user?.user_metadata;
  const fullName = asText(
    metadata?.full_name || metadata?.name || metadata?.display_name,
  );
  return fullName || asText(session?.userEmail) || fallbackLabel;
}

function normalizeAppealReviewStatus(value) {
  const normalized = asText(value).toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "rejected") return "rejected";
  return "";
}

async function ensureAppealBucketExists({
  supabase,
  bucketName,
}) {
  const { data: existingBucket, error: getBucketError } = await supabase.storage.getBucket(
    bucketName,
  );

  if (!getBucketError) {
    if (existingBucket?.public !== true) {
      const { error: updateError } = await supabase.storage.updateBucket(bucketName, {
        public: true,
      });
      if (updateError) {
        return {
          success: false,
          error:
            asText(updateError?.message) ||
            "Bucket exists but could not be updated to public access.",
        };
      }
    }
    return { success: true };
  }

  const getMessage = asText(getBucketError?.message);
  const getStatus = Number(getBucketError?.statusCode || getBucketError?.status || 0);
  const isNotFound = getStatus === 404 || /not found/i.test(getMessage);
  if (!isNotFound) {
    return {
      success: false,
      error: getMessage || "Failed to check appeal photo storage bucket.",
    };
  }

  const { error: createError } = await supabase.storage.createBucket(bucketName, {
    public: true,
  });
  if (createError) {
    const createMessage = asText(createError?.message);
    const alreadyExists = /already exists/i.test(createMessage) || /duplicate/i.test(createMessage);
    if (!alreadyExists) {
      return {
        success: false,
        error: createMessage || "Failed to create appeal photo storage bucket.",
      };
    }

    const { error: updateError } = await supabase.storage.updateBucket(bucketName, {
      public: true,
    });
    if (updateError) {
      return {
        success: false,
        error:
          asText(updateError?.message) ||
          "Appeal photo bucket exists but could not be updated to public access.",
      };
    }
  }

  return { success: true };
}

function buildAppealChangePayload({
  actorLabel,
  dishName,
  summary,
  beforeAppeal,
  afterAppeal,
}) {
  const safeDishName = asText(dishName) || "General changes";
  return {
    author: actorLabel,
    general: [],
    items: {
      [safeDishName]: [
        {
          summary,
          before: formatIngredientBrandAppealSnapshot(beforeAppeal),
          after: formatIngredientBrandAppealSnapshot(afterAppeal),
        },
      ],
    },
  };
}

async function createAppealChangeLog(tx, {
  restaurantId,
  actorLabel,
  dishName,
  summary,
  beforeAppeal,
  afterAppeal,
  photos = [],
}) {
  await tx.change_logs.create({
    data: {
      restaurant_id: restaurantId,
      type: "update",
      description: actorLabel,
      changes: buildAppealChangePayload({
        actorLabel,
        dishName,
        summary,
        beforeAppeal,
        afterAppeal,
      }),
      user_email: null,
      photos: (Array.isArray(photos) ? photos : []).map((value) => asText(value)).filter(Boolean),
      timestamp: new Date(),
    },
  });
}

function readIngredientPayloadName(row) {
  const payload = row?.ingredient_payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const payloadName = asText(payload.name);
    if (payloadName) return payloadName;
  }
  return asText(row?.row_text);
}

async function loadMatchingIngredientRows(tx, {
  restaurantId,
  dishName,
  ingredientName,
}) {
  const allRows = await tx.restaurant_menu_ingredient_rows.findMany({
    where: { restaurant_id: restaurantId },
    select: {
      id: true,
      dish_name: true,
      row_index: true,
      row_text: true,
      ingredient_payload: true,
    },
  });

  const dishToken = normalizeToken(dishName);
  const ingredientToken = normalizeToken(ingredientName);
  const exactDishRows = dishToken
    ? allRows.filter((row) => normalizeToken(row?.dish_name) === dishToken)
    : allRows;
  const candidateRows = exactDishRows.length ? exactDishRows : allRows;

  if (!ingredientToken) return candidateRows;

  const exactIngredientRows = candidateRows.filter(
    (row) => normalizeToken(readIngredientPayloadName(row)) === ingredientToken,
  );
  return exactIngredientRows.length ? exactIngredientRows : candidateRows;
}

function buildPendingAppealState({
  appealId,
  managerMessage,
  photoUrl,
  submittedAt,
}) {
  return normalizeIngredientBrandAppeal({
    id: appealId,
    reviewStatus: "pending",
    managerMessage,
    photoUrl: getPublicAppealPhotoUrl(photoUrl),
    photoAttached: true,
    submittedAt,
  });
}

function buildReviewedAppealState({
  existingAppeal,
  reviewStatus,
  reviewNotes,
  reviewedAt,
  reviewedBy,
}) {
  return normalizeIngredientBrandAppeal({
    ...(existingAppeal && typeof existingAppeal === "object" ? existingAppeal : {}),
    reviewStatus,
    reviewNotes,
    reviewedAt,
    reviewedBy,
  });
}

async function syncIngredientRowsForAppealSubmission(tx, {
  restaurantId,
  dishName,
  ingredientName,
  appealState,
}) {
  const rows = await loadMatchingIngredientRows(tx, {
    restaurantId,
    dishName,
    ingredientName,
  });

  for (const row of rows) {
    const currentPayload =
      row?.ingredient_payload && typeof row.ingredient_payload === "object"
        ? { ...row.ingredient_payload }
        : {};
    currentPayload.brandAppeal = appealState;
    await tx.restaurant_menu_ingredient_rows.update({
      where: { id: row.id },
      data: {
        row_text: asText(currentPayload.name) || asText(row.row_text) || null,
        ingredient_payload: currentPayload,
      },
    });
  }

  return rows;
}

async function syncIngredientRowsForAppealReview(tx, {
  restaurantId,
  dishName,
  ingredientName,
  reviewStatus,
  reviewNotes,
  reviewedAt,
  reviewedBy,
}) {
  const rows = await loadMatchingIngredientRows(tx, {
    restaurantId,
    dishName,
    ingredientName,
  });

  const updatedRows = [];
  for (const row of rows) {
    const currentPayload =
      row?.ingredient_payload && typeof row.ingredient_payload === "object"
        ? { ...row.ingredient_payload }
        : {};
    const beforeAppeal = normalizeIngredientBrandAppeal(currentPayload.brandAppeal);
    const nextAppeal = buildReviewedAppealState({
      existingAppeal: currentPayload.brandAppeal,
      reviewStatus,
      reviewNotes,
      reviewedAt,
      reviewedBy,
    });

    if (reviewStatus === "approved") {
      currentPayload.brandRequired = false;
      delete currentPayload.brandRequirementReason;
    } else {
      currentPayload.brandRequired = true;
    }
    currentPayload.brandAppeal = nextAppeal;

    await tx.restaurant_menu_ingredient_rows.update({
      where: { id: row.id },
      data: {
        row_text: asText(currentPayload.name) || asText(row.row_text) || null,
        ingredient_payload: currentPayload,
      },
    });

    updatedRows.push({
      id: row.id,
      beforeAppeal,
      afterAppeal: nextAppeal,
    });
  }

  return updatedRows;
}

function getSessionErrorStatus(error) {
  const message = asText(error?.message);
  if (message === "Missing authorization token") return 401;
  if (message === "Invalid user session") return 401;
  if (message === "Supabase server credentials missing") return 500;
  if (message === "Admin access required") return 403;
  return 401;
}

export async function POST(request) {
  const bucketName =
    asText(process.env.INGREDIENT_SCAN_APPEALS_BUCKET) || DEFAULT_APPEAL_PHOTO_BUCKET;

  let body = null;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON payload.", 400);
  }

  const restaurantId = asText(body?.restaurantId);
  const dishName = asText(body?.dishName);
  const ingredientName = asText(body?.ingredientName);
  const managerMessage = asText(body?.managerMessage);
  const photoDataUrl = asText(body?.photoDataUrl);

  if (!restaurantId || !dishName || !ingredientName || !managerMessage || !photoDataUrl) {
    return errorResponse(
      "restaurantId, dishName, ingredientName, managerMessage, and photoDataUrl are required.",
      400,
    );
  }

  const parsedPhoto = parseDataUrl(photoDataUrl);
  if (!parsedPhoto) {
    return errorResponse("photoDataUrl must be a valid data URL image.", 400);
  }
  if (!asText(parsedPhoto.mediaType).toLowerCase().startsWith("image/")) {
    return errorResponse("photoDataUrl must be a valid image.", 400);
  }
  if (estimateBase64Bytes(parsedPhoto.base64Data) > MAX_APPEAL_PHOTO_BYTES) {
    return errorResponse("Appeal photo is too large. Use an image under 768 KB.", 413);
  }

  let session = null;
  try {
    session = await requireAuthenticatedSession(request);
  } catch (error) {
    return errorResponse(asText(error?.message) || "Invalid user session.", getSessionErrorStatus(error));
  }

  const userId = asText(session?.userId);
  if (!userId) {
    return errorResponse("Invalid user session.", 401);
  }

  let isAdmin = false;
  try {
    isAdmin = await isAppAdminUser(db, userId);
  } catch (adminError) {
    return errorResponse(asText(adminError?.message) || "Failed to verify admin access.", 500);
  }

  if (!isAdmin) {
    let managerRecord = null;
    try {
      managerRecord = await db.restaurant_managers.findFirst({
        where: { user_id: userId, restaurant_id: restaurantId },
        select: { id: true },
      });
    } catch (managerError) {
      return errorResponse(
        asText(managerError?.message) || "Failed to verify manager access.",
        500,
      );
    }
    if (!managerRecord?.id) {
      return errorResponse("Not authorized to submit appeals for this restaurant.", 403);
    }
  }

  let restaurantRecord = null;
  try {
    restaurantRecord = await db.restaurants.findUnique({
      where: { id: restaurantId },
      select: { name: true, slug: true },
    });
  } catch {
    restaurantRecord = null;
  }

  const storageSupabase = createStorageAdminClient();
  let photoUrl = photoDataUrl;
  let photoPath = "";
  if (storageSupabase) {
    const bucketReady = await ensureAppealBucketExists({
      supabase: storageSupabase,
      bucketName,
    });

    if (!bucketReady.success) {
      console.warn(
        `[ingredient-scan-appeals] storage setup failed (${bucketReady.error || "unknown"}); using inline photo fallback.`,
      );
    } else {
      const extension = extensionForMediaType(parsedPhoto.mediaType);
      photoPath = `${restaurantId}/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
      const photoBuffer = Buffer.from(parsedPhoto.base64Data, "base64");

      const { error: uploadError } = await storageSupabase.storage
        .from(bucketName)
        .upload(photoPath, photoBuffer, {
          contentType: parsedPhoto.mediaType,
          upsert: false,
          cacheControl: "3600",
        });

      if (uploadError) {
        console.warn(
          `[ingredient-scan-appeals] photo upload failed (${asText(uploadError?.message) || "unknown"}); using inline photo fallback.`,
        );
        photoPath = "";
      } else {
        const { data: photoUrlData } = storageSupabase.storage
          .from(bucketName)
          .getPublicUrl(photoPath);
        const publicPhotoUrl = asText(photoUrlData?.publicUrl);
        if (publicPhotoUrl) {
          photoUrl = publicPhotoUrl;
        } else {
          await storageSupabase.storage.from(bucketName).remove([photoPath]);
          photoPath = "";
          console.warn(
            "[ingredient-scan-appeals] could not resolve public photo URL; using inline photo fallback.",
          );
        }
      }
    }
  } else {
    console.warn(
      "[ingredient-scan-appeals] SUPABASE_SERVICE_ROLE_KEY missing; using inline photo fallback.",
    );
  }

  const submittedAt = new Date();
  const actorLabel = resolveAppealActorLabel(session, "Manager");
  const responsePhotoUrl = getPublicAppealPhotoUrl(photoUrl);

  let createdAppealId = "";
  try {
    const transactionResult = await db.$transaction(async (tx) => {
      await setRestaurantWriteContext(tx);

      const createdAppeal = await tx.ingredient_scan_appeals.create({
        data: {
          restaurant_id: restaurantId,
          dish_name: dishName,
          ingredient_name: ingredientName,
          photo_url: photoUrl,
          manager_message: managerMessage,
          review_status: "pending",
          ai_recommended_scan: true,
          manager_disagrees: true,
          submitted_at: submittedAt,
        },
        select: { id: true },
      });

      const appealState = buildPendingAppealState({
        appealId: createdAppeal?.id,
        managerMessage,
        photoUrl,
        submittedAt: submittedAt.toISOString(),
      });

      const matchingRows = await syncIngredientRowsForAppealSubmission(tx, {
        restaurantId,
        dishName,
        ingredientName,
        appealState,
      });

      const beforeAppeal = normalizeIngredientBrandAppeal(
        matchingRows[0]?.ingredient_payload?.brandAppeal,
      );
      await createAppealChangeLog(tx, {
        restaurantId,
        actorLabel,
        dishName,
        summary: `${dishName}: Submitted brand assignment appeal for ${ingredientName}`,
        beforeAppeal,
        afterAppeal: appealState,
        photos: responsePhotoUrl ? [responsePhotoUrl] : [],
      });

      if (matchingRows.length) {
        await bumpRestaurantWriteVersion(tx, restaurantId);
      }

      return {
        appealId: asText(createdAppeal?.id),
        appealState,
        matchedRowCount: matchingRows.length,
      };
    });

    createdAppealId = transactionResult.appealId;
  } catch (error) {
    if (photoPath && storageSupabase) {
      await storageSupabase.storage.from(bucketName).remove([photoPath]);
    }
    return errorResponse(asText(error?.message) || "Failed to create appeal.", 500);
  }

  try {
    const emailResult = await sendNotificationEmail({
      type: "appeal",
      restaurantName: asText(restaurantRecord?.name) || "Unknown Restaurant",
      restaurantSlug: asText(restaurantRecord?.slug),
      ingredientName,
      dishName,
      photoUrl: responsePhotoUrl,
      managerMessage,
    });
    if (!emailResult?.success && !emailResult?.skipped) {
      console.warn(
        `[ingredient-scan-appeals] appeal email failed: ${asText(emailResult?.error) || "unknown error"}`,
      );
    }
  } catch (emailError) {
    console.warn(
      `[ingredient-scan-appeals] appeal email failed: ${asText(emailError?.message) || "unknown error"}`,
    );
  }

  return corsJson({
    success: true,
    id: createdAppealId,
    appeal: {
      id: createdAppealId,
      reviewStatus: "pending",
      managerMessage,
      photoUrl: responsePhotoUrl,
      photoAttached: true,
      submittedAt: submittedAt.toISOString(),
    },
    photoUrl: responsePhotoUrl,
    photoAttached: true,
    reviewStatus: "pending",
    submittedAt: submittedAt.toISOString(),
  });
}

export async function PATCH(request) {
  let session = null;
  try {
    session = await requireAdminSession(request);
  } catch (error) {
    return errorResponse(asText(error?.message) || "Admin access required.", getSessionErrorStatus(error));
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON payload.", 400);
  }

  const appealId = asText(body?.appealId);
  const reviewStatus = normalizeAppealReviewStatus(body?.status);
  const reviewNotes = asText(body?.reviewNotes);

  if (!appealId || !reviewStatus) {
    return errorResponse("appealId and a valid status are required.", 400);
  }

  const reviewedAt = new Date();
  const reviewedBy = resolveAppealActorLabel(session, "Admin");

  try {
    const result = await db.$transaction(async (tx) => {
      await setRestaurantWriteContext(tx);

      const existingAppeal = await tx.ingredient_scan_appeals.findUnique({
        where: { id: appealId },
        select: {
          id: true,
          restaurant_id: true,
          dish_name: true,
          ingredient_name: true,
          manager_message: true,
          photo_url: true,
          submitted_at: true,
          review_status: true,
          review_notes: true,
          reviewed_at: true,
        },
      });

      if (!existingAppeal?.id) {
        throw new Error("Appeal not found.");
      }

      await tx.ingredient_scan_appeals.update({
        where: { id: appealId },
        data: {
          review_status: reviewStatus,
          reviewed_at: reviewedAt,
          review_notes: reviewNotes || null,
        },
      });

      const updatedRows = await syncIngredientRowsForAppealReview(tx, {
        restaurantId: asText(existingAppeal.restaurant_id),
        dishName: asText(existingAppeal.dish_name),
        ingredientName: asText(existingAppeal.ingredient_name),
        reviewStatus,
        reviewNotes,
        reviewedAt: reviewedAt.toISOString(),
        reviewedBy,
      });

      const beforeAppeal =
        updatedRows[0]?.beforeAppeal ||
        normalizeIngredientBrandAppeal({
          id: existingAppeal.id,
          review_status: existingAppeal.review_status,
          manager_message: existingAppeal.manager_message,
          photo_url: getPublicAppealPhotoUrl(existingAppeal.photo_url),
          photo_attached: Boolean(asText(existingAppeal.photo_url)),
          submitted_at: existingAppeal.submitted_at?.toISOString?.() || existingAppeal.submitted_at,
          reviewed_at: existingAppeal.reviewed_at?.toISOString?.() || existingAppeal.reviewed_at,
          review_notes: existingAppeal.review_notes,
        });
      const afterAppeal =
        updatedRows[0]?.afterAppeal ||
        buildReviewedAppealState({
          existingAppeal: {
            id: existingAppeal.id,
            review_status: reviewStatus,
            manager_message: existingAppeal.manager_message,
            photo_url: getPublicAppealPhotoUrl(existingAppeal.photo_url),
            photo_attached: Boolean(asText(existingAppeal.photo_url)),
            submitted_at:
              existingAppeal.submitted_at?.toISOString?.() || existingAppeal.submitted_at,
          },
          reviewStatus,
          reviewNotes,
          reviewedAt: reviewedAt.toISOString(),
          reviewedBy,
        });

      await createAppealChangeLog(tx, {
        restaurantId: asText(existingAppeal.restaurant_id),
        actorLabel: reviewedBy,
        dishName: asText(existingAppeal.dish_name),
        summary:
          reviewStatus === "approved"
            ? `${existingAppeal.dish_name}: Approved brand assignment appeal for ${existingAppeal.ingredient_name}`
            : `${existingAppeal.dish_name}: Rejected brand assignment appeal for ${existingAppeal.ingredient_name}`,
        beforeAppeal,
        afterAppeal,
        photos: getPublicAppealPhotoUrl(existingAppeal.photo_url)
          ? [getPublicAppealPhotoUrl(existingAppeal.photo_url)]
          : [],
      });

      if (updatedRows.length) {
        await bumpRestaurantWriteVersion(tx, asText(existingAppeal.restaurant_id));
      }

      return {
        appeal: {
          id: asText(existingAppeal.id),
          restaurantId: asText(existingAppeal.restaurant_id),
          dishName: asText(existingAppeal.dish_name),
          ingredientName: asText(existingAppeal.ingredient_name),
          reviewStatus,
          reviewNotes,
          reviewedAt: reviewedAt.toISOString(),
          reviewedBy,
        },
        matchedRowCount: updatedRows.length,
      };
    });

    return corsJson({
      success: true,
      appeal: result.appeal,
      matchedIngredientRows: result.matchedRowCount,
    });
  } catch (error) {
    const message = asText(error?.message) || "Failed to review appeal.";
    const status = message === "Appeal not found." ? 404 : 500;
    return errorResponse(message, status);
  }
}
