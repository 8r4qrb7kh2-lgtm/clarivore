import { randomUUID } from "node:crypto";

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
} from "../../lib/ingredientBrandAppeal.js";
import { selectIngredientRowsForAppeal } from "../../lib/server/ingredientAppealRowMatching.js";
import {
  listIngredientAppealsForAdmin,
  loadIngredientAppealRowsById,
} from "../../lib/server/ingredientAppeals.js";
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
          appealId: asText(afterAppeal?.id || beforeAppeal?.id),
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
  return selectIngredientRowsForAppeal({
    rows: allRows,
    dishName,
    ingredientName,
  });
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

  if (!rows.length) {
    throw new Error("Ingredient row not found.");
  }

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
  appealId,
  reviewStatus,
  reviewNotes,
  reviewedAt,
  reviewedBy,
}) {
  const rows = await loadIngredientAppealRowsById(tx, appealId);
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("Appeal not found.");
  }

  const updatedRows = [];
  for (const row of rows) {
    const currentPayload =
      row?.ingredient_payload && typeof row.ingredient_payload === "object"
        ? { ...row.ingredient_payload }
        : {};
    const beforeAppeal = normalizeIngredientBrandAppeal(currentPayload.brandAppeal);
    if (!beforeAppeal) {
      continue;
    }

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
      restaurantId: asText(row.restaurant_id),
      dishName: asText(row.dish_name),
      ingredientName: asText(currentPayload.name || row.row_text),
      photoUrl: asText(beforeAppeal.photoUrl),
      beforeAppeal,
      afterAppeal: nextAppeal,
    });
  }

  if (!updatedRows.length) {
    throw new Error("Appeal not found.");
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

export async function GET(request) {
  try {
    await requireAdminSession(request);

    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(Number(searchParams.get("limit")) || 200, 500));
    const appeals = await listIngredientAppealsForAdmin(db, { limit });

    return corsJson({
      success: true,
      appeals,
    });
  } catch (error) {
    return errorResponse(
      asText(error?.message) || "Failed to load appeals.",
      getSessionErrorStatus(error),
    );
  }
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
    return errorResponse(
      asText(error?.message) || "Invalid user session.",
      getSessionErrorStatus(error),
    );
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
    try {
      const managerRecord = await db.restaurant_managers.findFirst({
        where: { user_id: userId, restaurant_id: restaurantId },
        select: { id: true },
      });
      if (!managerRecord?.id) {
        return errorResponse("Not authorized to submit appeals for this restaurant.", 403);
      }
    } catch (managerError) {
      return errorResponse(
        asText(managerError?.message) || "Failed to verify manager access.",
        500,
      );
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
  const createdAppealId = randomUUID();
  const actorLabel = resolveAppealActorLabel(session, "Manager");
  const responsePhotoUrl = getPublicAppealPhotoUrl(photoUrl);
  let nextRestaurantWriteVersion = 0;

  try {
    await db.$transaction(async (tx) => {
      await setRestaurantWriteContext(tx);

      const appealState = buildPendingAppealState({
        appealId: createdAppealId,
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

      nextRestaurantWriteVersion = await bumpRestaurantWriteVersion(tx, restaurantId);
    });
  } catch (error) {
    if (photoPath && storageSupabase) {
      await storageSupabase.storage.from(bucketName).remove([photoPath]);
    }
    const message = asText(error?.message) || "Failed to create appeal.";
    const status = message === "Ingredient row not found." ? 404 : 500;
    return errorResponse(message, status);
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
    restaurantWriteVersion: nextRestaurantWriteVersion,
  });
}

export async function PATCH(request) {
  let session = null;
  try {
    session = await requireAdminSession(request);
  } catch (error) {
    return errorResponse(
      asText(error?.message) || "Admin access required.",
      getSessionErrorStatus(error),
    );
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
  let nextRestaurantWriteVersion = 0;

  try {
    const result = await db.$transaction(async (tx) => {
      await setRestaurantWriteContext(tx);

      const updatedRows = await syncIngredientRowsForAppealReview(tx, {
        appealId,
        reviewStatus,
        reviewNotes,
        reviewedAt: reviewedAt.toISOString(),
        reviewedBy,
      });
      const firstRow = updatedRows[0];

      await createAppealChangeLog(tx, {
        restaurantId: firstRow.restaurantId,
        actorLabel: reviewedBy,
        dishName: firstRow.dishName,
        summary:
          reviewStatus === "approved"
            ? `${firstRow.dishName}: Approved brand assignment appeal for ${firstRow.ingredientName}`
            : `${firstRow.dishName}: Rejected brand assignment appeal for ${firstRow.ingredientName}`,
        beforeAppeal: firstRow.beforeAppeal,
        afterAppeal: firstRow.afterAppeal,
        photos: firstRow.photoUrl ? [firstRow.photoUrl] : [],
      });

      nextRestaurantWriteVersion = await bumpRestaurantWriteVersion(tx, firstRow.restaurantId);

      return {
        appeal: {
          id: asText(firstRow.afterAppeal?.id || appealId),
          restaurantId: firstRow.restaurantId,
          dishName: firstRow.dishName,
          ingredientName: firstRow.ingredientName,
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
      restaurantWriteVersion: nextRestaurantWriteVersion,
    });
  } catch (error) {
    const message = asText(error?.message) || "Failed to review appeal.";
    const status = message === "Appeal not found." ? 404 : 500;
    return errorResponse(message, status);
  }
}
