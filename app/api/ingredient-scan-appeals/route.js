import { createClient } from "@supabase/supabase-js";
import { corsJson, corsOptions } from "../_shared/cors";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsOptions();
}

const OWNER_EMAIL = "matt.29.ds@gmail.com";
const APPEAL_PHOTO_BUCKET = "ingredient-scan-appeals";

function asText(value) {
  return String(value ?? "").trim();
}

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

async function invokeSupabaseFunction({
  supabaseUrl,
  supabaseApiKey,
  authToken,
  functionName,
  payload,
}) {
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken || supabaseApiKey}`,
      apikey: supabaseApiKey,
    },
    body: JSON.stringify(payload || {}),
  });

  const bodyText = await response.text();
  let parsed = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new Error(
      asText(parsed?.error) ||
        asText(parsed?.message) ||
        `Failed request to ${functionName}.`,
    );
  }
  return parsed || {};
}

export async function POST(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";
  if (!token) {
    return errorResponse("Missing authorization token.", 401);
  }

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return errorResponse("Supabase configuration missing.", 500);
  }

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

  const userScopedSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  const privilegedSupabase = serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : userScopedSupabase;

  const { data: userData, error: userError } = await userScopedSupabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return errorResponse("Invalid user session.", 401);
  }

  const user = userData.user;
  const isOwner = asText(user?.email).toLowerCase() === OWNER_EMAIL.toLowerCase();
  if (!isOwner) {
    const { data: managerRecord, error: managerError } = await privilegedSupabase
      .from("restaurant_managers")
      .select("id")
      .eq("user_id", user.id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (managerError) {
      return errorResponse(managerError.message || "Failed to verify manager access.", 500);
    }
    if (!managerRecord?.id) {
      return errorResponse("Not authorized to submit appeals for this restaurant.", 403);
    }
  }

  const { data: restaurantRecord } = await privilegedSupabase
    .from("restaurants")
    .select("name, slug")
    .eq("id", restaurantId)
    .maybeSingle();

  const extension = extensionForMediaType(parsedPhoto.mediaType);
  const photoPath = `${restaurantId}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const photoBuffer = Buffer.from(parsedPhoto.base64Data, "base64");

  const { error: uploadError } = await privilegedSupabase.storage
    .from(APPEAL_PHOTO_BUCKET)
    .upload(photoPath, photoBuffer, {
      contentType: parsedPhoto.mediaType,
      upsert: false,
      cacheControl: "3600",
    });
  if (uploadError) {
    return errorResponse(uploadError.message || "Failed to upload appeal photo.", 500);
  }

  const { data: photoUrlData } = privilegedSupabase.storage
    .from(APPEAL_PHOTO_BUCKET)
    .getPublicUrl(photoPath);
  const photoUrl = asText(photoUrlData?.publicUrl);
  if (!photoUrl) {
    await privilegedSupabase.storage.from(APPEAL_PHOTO_BUCKET).remove([photoPath]);
    return errorResponse("Failed to resolve appeal photo URL.", 500);
  }

  const { data, error } = await privilegedSupabase
    .from("ingredient_scan_appeals")
    .insert({
      restaurant_id: restaurantId,
      dish_name: dishName,
      ingredient_name: ingredientName,
      photo_url: photoUrl,
      manager_message: managerMessage,
      review_status: "pending",
      ai_recommended_scan: true,
      manager_disagrees: true,
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    await privilegedSupabase.storage.from(APPEAL_PHOTO_BUCKET).remove([photoPath]);
    return errorResponse(error.message || "Failed to create appeal.", 500);
  }

  try {
    const emailResult = await invokeSupabaseFunction({
      supabaseUrl,
      supabaseApiKey: serviceRoleKey || supabaseAnonKey,
      authToken: serviceRoleKey || token,
      functionName: "send-notification-email",
      payload: {
        type: "appeal",
        restaurantName: asText(restaurantRecord?.name) || "Unknown Restaurant",
        restaurantSlug: asText(restaurantRecord?.slug),
        ingredientName,
        dishName,
        photoUrl,
        managerMessage,
      },
    });
    if (!emailResult?.success) {
      throw new Error(emailResult?.error || "Appeal email notification failed.");
    }
  } catch (emailError) {
    await privilegedSupabase.from("ingredient_scan_appeals").delete().eq("id", data?.id);
    await privilegedSupabase.storage.from(APPEAL_PHOTO_BUCKET).remove([photoPath]);
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
