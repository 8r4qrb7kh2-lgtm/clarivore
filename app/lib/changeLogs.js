function toSafeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(parsed, 0);
}

// Shared change-log read helper so dashboard/editor stay in sync.
export async function fetchRestaurantChangeLogs(
  supabaseClient,
  restaurantId,
  options = {},
) {
  if (!supabaseClient) throw new Error("Supabase is not configured.");

  const safeRestaurantId = String(restaurantId || "").trim();
  if (!safeRestaurantId) return [];

  const limit = toSafeInteger(options.limit, 10) || 10;
  const offset = toSafeInteger(options.offset, 0);

  const { data, error } = await supabaseClient
    .from("change_logs")
    .select("*")
    .eq("restaurant_id", safeRestaurantId)
    .order("timestamp", { ascending: false })
    .range(offset, offset + Math.max(limit - 1, 0));

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}
