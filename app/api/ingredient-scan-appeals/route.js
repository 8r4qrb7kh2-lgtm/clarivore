import { createClient } from "@supabase/supabase-js";
import { corsJson, corsOptions } from "../_shared/cors";
import { sendNotificationEmail } from "../notifications/_shared/emailSender";
import {
  asText,
  isAppAdminUser,
  prisma,
  requireAuthenticatedSession,
} from "../restaurant-write/_shared/writeGatewayUtils";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsOptions();
}

const DEFAULT_APPEAL_PHOTO_BUCKET = "ingredient-scan-appeals";

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

function extensionForMediaType(mediaType) {
  const normalized = asText(mediaType).toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  return "jpg";
}

function createStorageAdminClient() {
  const supabaseUrl = asText(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const serviceRoleKey = asText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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

  let session = null;
  try {
    session = await requireAuthenticatedSession(request);
  } catch (error) {
    const message = asText(error?.message);
    if (message === "Missing authorization token") {
      return errorResponse("Missing authorization token.", 401);
    }
    if (message === "Invalid user session") {
      return errorResponse("Invalid user session.", 401);
    }
    if (message === "Supabase server credentials missing") {
      return errorResponse("Supabase configuration missing.", 500);
    }
    return errorResponse(message || "Invalid user session.", 401);
  }

  const userId = asText(session?.userId);
  if (!userId) {
    return errorResponse("Invalid user session.", 401);
  }

  let isAdmin = false;
  try {
    isAdmin = await isAppAdminUser(prisma, userId);
  } catch (adminError) {
    return errorResponse(asText(adminError?.message) || "Failed to verify admin access.", 500);
  }

  if (!isAdmin) {
    let managerRecord = null;
    try {
      managerRecord = await prisma.restaurant_managers.findFirst({
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
    restaurantRecord = await prisma.restaurants.findUnique({
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

  let data = null;
  try {
    data = await prisma.ingredient_scan_appeals.create({
      data: {
        restaurant_id: restaurantId,
        dish_name: dishName,
        ingredient_name: ingredientName,
        photo_url: photoUrl,
        manager_message: managerMessage,
        review_status: "pending",
        ai_recommended_scan: true,
        manager_disagrees: true,
        submitted_at: new Date(),
      },
      select: { id: true },
    });
  } catch (error) {
    if (photoPath && storageSupabase) {
      await storageSupabase.storage.from(bucketName).remove([photoPath]);
    }
    return errorResponse(asText(error?.message) || "Failed to create appeal.", 500);
  }

  try {
    const photoUrlForEmail = photoUrl.startsWith("data:") ? "" : photoUrl;
    const emailResult = await sendNotificationEmail({
      type: "appeal",
      restaurantName: asText(restaurantRecord?.name) || "Unknown Restaurant",
      restaurantSlug: asText(restaurantRecord?.slug),
      ingredientName,
      dishName,
      photoUrl: photoUrlForEmail,
      managerMessage,
    });
    if (!emailResult?.success && !emailResult?.skipped) {
      throw new Error(emailResult?.error || "Appeal email notification failed.");
    }
  } catch (emailError) {
    await prisma.ingredient_scan_appeals.deleteMany({ where: { id: data?.id } });
    if (photoPath && storageSupabase) {
      await storageSupabase.storage.from(bucketName).remove([photoPath]);
    }
    return errorResponse(
      asText(emailError?.message) || "Appeal email notification failed.",
      500,
    );
  }

  return corsJson({
    success: true,
    id: data?.id || "",
    photoUrl,
  });
}
