import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const OWNER_EMAIL = "matt.29.ds@gmail.com";

function asText(value) {
  return String(value ?? "").trim();
}

function errorResponse(message, status) {
  return NextResponse.json({ success: false, error: message }, { status });
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
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse("Supabase server credentials missing.", 500);
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

  if (!restaurantId || !dishName || !ingredientName || !managerMessage) {
    return errorResponse(
      "restaurantId, dishName, ingredientName, and managerMessage are required.",
      400,
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return errorResponse("Invalid user session.", 401);
  }

  const user = userData.user;
  const isOwner = asText(user?.email).toLowerCase() === OWNER_EMAIL.toLowerCase();
  if (!isOwner) {
    const { data: managerRecord, error: managerError } = await supabase
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

  const { data, error } = await supabase
    .from("ingredient_scan_appeals")
    .insert({
      restaurant_id: restaurantId,
      dish_name: dishName,
      ingredient_name: ingredientName,
      manager_message: managerMessage,
      review_status: "pending",
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    return errorResponse(error.message || "Failed to create appeal.", 500);
  }

  return NextResponse.json({
    success: true,
    id: data?.id || "",
  });
}
