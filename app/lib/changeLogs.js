function toSafeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(parsed, 0);
}

async function getAccessToken(supabaseClient) {
  const { data: sessionData, error: sessionError } =
    await supabaseClient.auth.getSession();
  if (sessionError) throw sessionError;

  const accessToken = String(sessionData?.session?.access_token || "").trim();
  if (!accessToken) {
    throw new Error("You must be signed in.");
  }
  return accessToken;
}

async function readChangeLogResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(
      String(payload?.error || "").trim() || "Failed to load change log.",
    );
  }
  return Array.isArray(payload?.logs) ? payload.logs : [];
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
  const accessToken = await getAccessToken(supabaseClient);
  const params = new URLSearchParams();
  params.set("restaurantId", safeRestaurantId);
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  const response = await fetch(`/api/restaurant-change-logs?${params.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  return await readChangeLogResponse(response);
}
