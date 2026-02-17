"use client";

function asText(value) {
  return String(value || "").trim();
}

async function getAccessToken(supabase) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = asText(sessionData?.session?.access_token);
  if (!accessToken) {
    throw new Error("You must be signed in.");
  }
  return accessToken;
}

async function readJsonResponse(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success) {
    throw new Error(asText(payload?.error) || fallbackMessage);
  }
  return payload;
}

export async function stageRestaurantWrite({ supabase, payload }) {
  const accessToken = await getAccessToken(supabase);
  const response = await fetch("/api/restaurant-write/stage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload || {}),
  });
  return await readJsonResponse(response, "Failed to stage write.");
}

export async function commitRestaurantWrite({ supabase, batchId }) {
  const accessToken = await getAccessToken(supabase);
  const response = await fetch("/api/restaurant-write/commit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      batchId: asText(batchId),
    }),
  });
  return await readJsonResponse(response, "Failed to commit write.");
}

export async function discardRestaurantWrite({ supabase, batchId }) {
  const accessToken = await getAccessToken(supabase);
  const response = await fetch("/api/restaurant-write/discard", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      batchId: asText(batchId),
    }),
  });
  return await readJsonResponse(response, "Failed to discard write.");
}

export async function loadCurrentRestaurantWrite({ supabase, scopeType, restaurantId }) {
  const accessToken = await getAccessToken(supabase);
  const params = new URLSearchParams();
  params.set("scopeType", asText(scopeType));
  if (asText(restaurantId)) {
    params.set("restaurantId", asText(restaurantId));
  }

  const response = await fetch(`/api/restaurant-write/current?${params.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return await readJsonResponse(response, "Failed to load staged write.");
}

