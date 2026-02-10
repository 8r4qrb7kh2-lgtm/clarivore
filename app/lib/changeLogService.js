export async function insertChangeLogEntry(base) {
  const client = window.supabaseClient;
  if (!client) throw new Error("Supabase client not ready.");
  const payload = {
    restaurant_id: base.restaurantId,
    type: base.type,
    description: base.description,
    changes: base.changes,
    user_email: base.userEmail || null,
    photos: Array.isArray(base.photos)
      ? base.photos
      : base.photos
        ? [base.photos]
        : [],
    timestamp: base.timestamp || new Date().toISOString(),
  };
  Object.keys(payload).forEach((key) => payload[key] == null && delete payload[key]);
  const { error } = await client.from("change_logs").insert([payload]);
  if (error) throw error;
  return true;
}

export async function fetchChangeLogEntries(restaurantId) {
  const client = window.supabaseClient;
  if (!client) throw new Error("Supabase client not ready.");
  let query = client
    .from("change_logs")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(50);
  if (restaurantId) {
    query = query.eq("restaurant_id", restaurantId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
