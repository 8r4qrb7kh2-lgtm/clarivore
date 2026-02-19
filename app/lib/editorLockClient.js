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
  if (!response.ok || payload?.success === false) {
    throw new Error(asText(payload?.error) || fallbackMessage);
  }
  return payload;
}

async function postEditorLockAction({ supabase, payload, keepalive = false }) {
  const accessToken = await getAccessToken(supabase);
  const response = await fetch("/api/editor-lock", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload || {}),
    keepalive,
  });

  return await readJsonResponse(response, "Editor lock request failed.");
}

export async function acquireEditorLock({
  supabase,
  restaurantId,
  sessionKey,
  holderInstance = "",
}) {
  return await postEditorLockAction({
    supabase,
    payload: {
      action: "acquire",
      restaurantId: asText(restaurantId),
      sessionKey: asText(sessionKey),
      holderInstance: asText(holderInstance),
    },
  });
}

export async function refreshEditorLock({
  supabase,
  restaurantId,
  sessionKey,
  holderInstance = "",
}) {
  return await postEditorLockAction({
    supabase,
    payload: {
      action: "refresh",
      restaurantId: asText(restaurantId),
      sessionKey: asText(sessionKey),
      holderInstance: asText(holderInstance),
    },
  });
}

export async function getEditorLockStatus({
  supabase,
  restaurantId,
  sessionKey,
}) {
  return await postEditorLockAction({
    supabase,
    payload: {
      action: "status",
      restaurantId: asText(restaurantId),
      sessionKey: asText(sessionKey),
    },
  });
}

export async function releaseEditorLock({
  supabase,
  restaurantId,
  sessionKey,
  keepalive = false,
}) {
  return await postEditorLockAction({
    supabase,
    payload: {
      action: "release",
      restaurantId: asText(restaurantId),
      sessionKey: asText(sessionKey),
    },
    keepalive,
  });
}
