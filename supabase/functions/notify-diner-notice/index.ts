import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") || "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") || "";
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID") || "com.clarivore.app";
const APNS_PRIVATE_KEY = Deno.env.get("APNS_PRIVATE_KEY") || "";
const APNS_ENV = (Deno.env.get("APNS_ENV") || "production").toLowerCase();
const VAPID_SUBJECT =
  Deno.env.get("VAPID_SUBJECT") || "mailto:notifications@clarivore.org";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const STATUS_MESSAGES: Record<string, string> = {
  awaiting_server_approval: "Your notice is waiting for server approval.",
  queued_for_kitchen: "Your notice has been approved and queued for the kitchen.",
  with_kitchen: "Your notice is now with the kitchen.",
  acknowledged: "The kitchen acknowledged your notice.",
  awaiting_user_response: "The kitchen has a follow-up question.",
  question_answered: "Your response was sent to the kitchen.",
  rejected_by_server: "The server rejected your notice.",
  rejected_by_kitchen: "The kitchen rejected your notice.",
  rescinded_by_diner: "You rescinded this notice.",
};

function jsonResponse(payload: unknown, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function base64UrlEncode(data: ArrayBuffer | Uint8Array | string) {
  let bytes: Uint8Array;
  if (typeof data === "string") {
    bytes = new TextEncoder().encode(data);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else {
    bytes = new Uint8Array(data);
  }

  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeApnsKey(rawKey: string) {
  if (!rawKey) return "";
  const trimmed = rawKey.trim();
  if (!trimmed) return "";
  if (trimmed.includes("BEGIN PRIVATE KEY")) return trimmed;

  try {
    const decoded = atob(trimmed);
    if (decoded.includes("BEGIN PRIVATE KEY")) {
      return decoded;
    }
  } catch (_) {
    // ignore
  }

  const base64Body = trimmed.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/=_-]+$/.test(base64Body) && base64Body.length > 100) {
    return `-----BEGIN PRIVATE KEY-----\n${base64Body}\n-----END PRIVATE KEY-----`;
  }

  return "";
}

function pemToArrayBuffer(pem: string) {
  const contents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(contents);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function createApnsJwt() {
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY) return "";
  const pem = normalizeApnsKey(APNS_PRIVATE_KEY);
  if (!pem.includes("BEGIN PRIVATE KEY")) return "";
  const keyData = pemToArrayBuffer(pem);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const header = base64UrlEncode(
    JSON.stringify({ alg: "ES256", kid: APNS_KEY_ID }),
  );
  const payload = base64UrlEncode(
    JSON.stringify({ iss: APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const signatureEncoded = base64UrlEncode(signature);
  return `${signingInput}.${signatureEncoded}`;
}

let webpushModule: { default?: unknown } | null = null;

async function loadWebPush() {
  if (webpushModule) return webpushModule;
  try {
    webpushModule = await import("npm:web-push@3.6.6");
    return webpushModule;
  } catch (err) {
    console.error("Web push module failed to load:", err);
    return null;
  }
}

async function sendPushNotifications(params: {
  subscriptions: Array<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>;
  title: string;
  body: string;
  url: string;
  tag: string;
}) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return { skipped: true, sent: 0 };
  }

  const webpushImport = await loadWebPush();
  const webpush = webpushImport?.default || webpushImport;
  if (!webpush) {
    return { skipped: true, sent: 0 };
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  let sent = 0;
  for (const sub of params.subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({
          title: params.title,
          body: params.body,
          url: params.url,
          tag: params.tag,
        }),
      );
      sent += 1;
    } catch (err) {
      const status = err?.statusCode || err?.status || err?.response?.statusCode;
      if (status === 404 || status === 410) {
        await supabase
          .from("diner_push_subscriptions")
          .update({ disabled_at: new Date().toISOString() })
          .eq("id", sub.id);
      }
      console.error("Push send failed:", err);
    }
  }

  return { sent };
}

async function sendApnsNotifications(params: {
  tokens: Array<{ id: string; device_token: string }>;
  title: string;
  body: string;
  noticeId: string;
}) {
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY) {
    console.warn("APNs skipped: missing key/team/private key");
    return { skipped: true, sent: 0 };
  }
  if (!APNS_BUNDLE_ID) {
    console.warn("APNs skipped: missing bundle id");
    return { skipped: true, sent: 0 };
  }

  const jwt = await createApnsJwt();
  if (!jwt) {
    console.warn("APNs skipped: JWT creation failed");
    return { skipped: true, sent: 0 };
  }

  const apnsHost =
    APNS_ENV === "development"
      ? "https://api.sandbox.push.apple.com"
      : "https://api.push.apple.com";

  let sent = 0;
  if (!params.tokens.length) {
    console.warn("APNs skipped: no device tokens");
    return { skipped: true, sent: 0 };
  }

  for (const tokenEntry of params.tokens) {
    const response = await fetch(
      `${apnsHost}/3/device/${tokenEntry.device_token}`,
      {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": APNS_BUNDLE_ID,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-collapse-id": `notice-${params.noticeId}`,
        },
        body: JSON.stringify({
          aps: {
            alert: { title: params.title, body: params.body },
            sound: "default",
          },
          noticeId: params.noticeId,
        }),
      },
    );

    if (response.ok) {
      sent += 1;
      continue;
    }

    let reason = "";
    try {
      const payload = await response.json();
      reason = payload?.reason || "";
    } catch (_) {
      // ignore
    }

    if (
      response.status === 410 ||
      reason === "Unregistered" ||
      reason === "BadDeviceToken" ||
      reason === "DeviceTokenNotForTopic"
    ) {
      await supabase
        .from("diner_device_tokens")
        .update({ disabled_at: new Date().toISOString() })
        .eq("id", tokenEntry.id);
    }

    console.error("APNs send failed:", response.status, reason);
  }

  return { sent };
}

function latestExternalUpdate(history: Array<{ actor?: string; message?: string; at?: string }> | null) {
  const entries = Array.isArray(history) ? history : [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.actor && entry.actor !== "Diner") {
      return entry;
    }
  }
  return null;
}

function buildNotificationBody(status: string, message?: string) {
  const raw = message || STATUS_MESSAGES[status] || "Your notice was updated.";
  const normalized = String(raw || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 177)}...`;
}

function buildDishTitle(items: unknown) {
  const list = Array.isArray(items)
    ? items.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (list.length === 0) return "your dish";
  if (list.length === 1) return list[0];
  return `${list[0]} + ${list.length - 1} more`;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  let payload: { orderId?: string } = {};
  try {
    payload = await req.json();
  } catch (_) {
    payload = {};
  }

  const orderId = payload?.orderId;
  if (!orderId) {
    return jsonResponse({ error: "Missing orderId" }, 400, corsHeaders);
  }

  const { data: orderRow, error: orderError } = await supabase
    .from("tablet_orders")
    .select("id, status, payload, restaurant_id")
    .eq("id", orderId)
    .single();

  if (orderError || !orderRow) {
    return jsonResponse({ error: "Order not found" }, 404, corsHeaders);
  }

  const orderPayload = (orderRow.payload || {}) as Record<string, unknown>;
  const userId =
    (orderPayload.userId as string) || (orderPayload.user_id as string) || "";
  if (!userId) {
    return jsonResponse(
      { skipped: true, reason: "no_user" },
      200,
      corsHeaders,
    );
  }

  const restaurantId =
    (orderPayload.restaurantId as string) ||
    (orderRow.restaurant_id as string) ||
    "";
  let restaurantName = (orderPayload.restaurantName as string) || "";
  let restaurantSlug = "";
  if (restaurantId) {
    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("name, slug")
      .eq("id", restaurantId)
      .single();
    if (restaurant?.name) restaurantName = restaurant.name;
    if (restaurant?.slug) restaurantSlug = restaurant.slug;
  }

  const history = orderPayload.history as Array<{ actor?: string; message?: string; at?: string }> | null;
  const latestUpdate = latestExternalUpdate(history);
  const status = (orderRow.status as string) || (orderPayload.status as string) || "";
  const body = buildNotificationBody(status, latestUpdate?.message);
  const dishTitle = buildDishTitle(orderPayload.items);
  const title = dishTitle ? `Notice update for ${dishTitle}` : "Notice update";
  const url = restaurantSlug
    ? `/restaurant.html?slug=${encodeURIComponent(restaurantSlug)}`
    : "/restaurants.html";

  const { data: subscriptions } = await supabase
    .from("diner_push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId)
    .is("disabled_at", null);

  const pushResult = await sendPushNotifications({
    subscriptions: subscriptions || [],
    title,
    body,
    url,
    tag: `notice-${orderRow.id}`,
  });

  const { data: deviceTokens } = await supabase
    .from("diner_device_tokens")
    .select("id, device_token")
    .eq("user_id", userId)
    .eq("platform", "ios")
    .is("disabled_at", null);

  const apnsResult = await sendApnsNotifications({
    tokens: deviceTokens || [],
    title,
    body,
    noticeId: String(orderRow.id),
  });

  return jsonResponse(
    {
      success: true,
      pushesSent: pushResult?.sent || 0,
      iosPushesSent: apnsResult?.sent || 0,
    },
    200,
    corsHeaders,
  );
});
