import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY") || "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") || "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") || "";
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID") || "com.clarivore.app";
const APNS_PRIVATE_KEY = Deno.env.get("APNS_PRIVATE_KEY") || "";
const APNS_ENV = (Deno.env.get("APNS_ENV") || "production").toLowerCase();
const VAPID_SUBJECT =
  Deno.env.get("VAPID_SUBJECT") || "mailto:notifications@clarivore.org";
const FROM_EMAIL =
  Deno.env.get("CHAT_NOTIFICATIONS_FROM") || "clarivoretesting@gmail.com";
const FROM_NAME = "Clarivore";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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
  if (rawKey.includes("BEGIN PRIVATE KEY")) return rawKey;
  try {
    const decoded = atob(rawKey);
    if (decoded.includes("BEGIN PRIVATE KEY")) {
      return decoded;
    }
  } catch (_) {
    // ignore
  }
  return rawKey;
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function buildEmailHtml(params: {
  senderName: string;
  message: string;
  restaurantName: string;
  dashboardUrl: string;
}) {
  const sender = escapeHtml(params.senderName);
  const message = escapeHtml(params.message);
  const restaurant = escapeHtml(params.restaurantName);
  const dashboardUrl = escapeHtml(params.dashboardUrl);

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 640px; margin: 0 auto; padding: 20px;">
        <h2 style="margin-bottom: 8px;">New chat message</h2>
        <p style="margin-top: 0; color: #555;">Restaurant: <strong>${restaurant}</strong></p>
        <p><strong>Sender:</strong> ${sender}</p>
        <p><strong>Message:</strong></p>
        <div style="background: #f3f4f6; padding: 12px 14px; border-radius: 8px; white-space: pre-wrap;">${message}</div>
        <p style="margin-top: 16px;">
          <a href="${dashboardUrl}" style="background: #1f4fd7; color: white; text-decoration: none; padding: 10px 16px; border-radius: 6px; display: inline-block;">Open manager dashboard</a>
        </p>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 12px;">Sent by Clarivore</p>
      </body>
    </html>
  `;
}

function buildEmailText(params: {
  senderName: string;
  message: string;
  restaurantName: string;
  dashboardUrl: string;
}) {
  return [
    "New chat message",
    `Restaurant: ${params.restaurantName}`,
    `Sender: ${params.senderName}`,
    "",
    "Message:",
    params.message,
    "",
    `Open manager dashboard: ${params.dashboardUrl}`,
    "",
    "Sent by Clarivore",
  ].join("\n");
}

async function getManagerEmails(userIds: string[]) {
  const emails: string[] = [];
  for (const userId of userIds) {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error) {
      console.error("Failed to fetch user email:", error);
      continue;
    }
    if (data?.user?.email) {
      emails.push(data.user.email);
    }
  }
  return Array.from(new Set(emails));
}

async function sendEmailNotifications(params: {
  emails: string[];
  senderName: string;
  message: string;
  restaurantName: string;
  dashboardUrl: string;
}) {
  if (!SENDGRID_API_KEY || params.emails.length === 0) {
    return { skipped: true, sent: 0 };
  }

  const subject = `New chat message from ${params.senderName}`;
  const html = buildEmailHtml(params);
  const text = buildEmailText(params);
  let sent = 0;

  for (const email of params.emails) {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email }],
            subject,
          },
        ],
        from: { email: FROM_EMAIL, name: FROM_NAME },
        content: [
          { type: "text/plain", value: text },
          { type: "text/html", value: html },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`SendGrid error for ${email}:`, errorText);
      continue;
    }
    sent += 1;
  }

  return { sent };
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
          .from("manager_push_subscriptions")
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
  messageId: string;
}) {
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY) {
    return { skipped: true, sent: 0 };
  }
  if (!APNS_BUNDLE_ID) {
    return { skipped: true, sent: 0 };
  }

  const jwt = await createApnsJwt();
  if (!jwt) return { skipped: true, sent: 0 };

  const apnsHost =
    APNS_ENV === "development"
      ? "https://api.sandbox.push.apple.com"
      : "https://api.push.apple.com";

  let sent = 0;
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
          "apns-collapse-id": `chat-${params.messageId}`,
        },
        body: JSON.stringify({
          aps: {
            alert: { title: params.title, body: params.body },
            sound: "default",
          },
          messageId: params.messageId,
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
        .from("manager_device_tokens")
        .update({ disabled_at: new Date().toISOString() })
        .eq("id", tokenEntry.id);
    }

    console.error("APNs send failed:", response.status, reason);
  }

  return { sent };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  let payload: { messageId?: string } = {};
  try {
    payload = await req.json();
  } catch (_) {
    payload = {};
  }

  const messageId = payload?.messageId;
  if (!messageId) {
    return jsonResponse({ error: "Missing messageId" }, 400, corsHeaders);
  }

  const { data: message, error: messageError } = await supabase
    .from("restaurant_direct_messages")
    .select("id, restaurant_id, message, sender_role, sender_name, created_at")
    .eq("id", messageId)
    .single();

  if (messageError || !message) {
    return jsonResponse(
      { error: "Message not found" },
      404,
      corsHeaders,
    );
  }

  if (message.sender_role === "restaurant") {
    return jsonResponse(
      { skipped: true, reason: "sender_role" },
      200,
      corsHeaders,
    );
  }

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id, name, slug")
    .eq("id", message.restaurant_id)
    .single();

  const { data: managerRows, error: managerError } = await supabase
    .from("restaurant_managers")
    .select("user_id")
    .eq("restaurant_id", message.restaurant_id);

  if (managerError) {
    return jsonResponse(
      { error: "Failed to load managers" },
      500,
      corsHeaders,
    );
  }

  const userIds = Array.from(
    new Set((managerRows || []).map((row) => row.user_id).filter(Boolean)),
  );

  if (userIds.length === 0) {
    return jsonResponse(
      { skipped: true, reason: "no_managers" },
      200,
      corsHeaders,
    );
  }

  const senderName = message.sender_name || "Clarivore team";
  const restaurantName = restaurant?.name || "Your restaurant";
  const dashboardUrl = "https://clarivore.org/manager-dashboard.html";
  const messageText = message.message ? String(message.message) : "";
  const trimmedMessage =
    messageText.length > 280 ? `${messageText.slice(0, 277)}...` : messageText;

  const emails = await getManagerEmails(userIds);
  const emailResult = await sendEmailNotifications({
    emails,
    senderName,
    message: messageText,
    restaurantName,
    dashboardUrl,
  });

  const { data: subscriptions } = await supabase
    .from("manager_push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds)
    .is("disabled_at", null);

  const pushResult = await sendPushNotifications({
    subscriptions: subscriptions || [],
    title: `New message from ${senderName}`,
    body: trimmedMessage,
    url: "/manager-dashboard.html",
    tag: `chat-${message.id}`,
  });

  const { data: deviceTokens } = await supabase
    .from("manager_device_tokens")
    .select("id, device_token")
    .in("user_id", userIds)
    .eq("platform", "ios")
    .is("disabled_at", null);

  const apnsResult = await sendApnsNotifications({
    tokens: deviceTokens || [],
    title: `New message from ${senderName}`,
    body: trimmedMessage,
    messageId: message.id,
  });

  return jsonResponse(
    {
      success: true,
      emailsSent: emailResult?.sent || 0,
      pushesSent: pushResult?.sent || 0,
      iosPushesSent: apnsResult?.sent || 0,
      managerCount: userIds.length,
    },
    200,
    corsHeaders,
  );
});
