import { supabaseClient as defaultSupabaseClient } from "./supabase";

const SW_PATH = "/manager-push-sw.js";
const IOS_BUNDLE_ID = "com.clarivore.app";
let webInitDone = false;
let nativeInitDone = false;

function supportsPush() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function isNativePlatform() {
  if (window.Capacitor?.isNativePlatform) {
    return window.Capacitor.isNativePlatform();
  }
  if (window.Capacitor?.getPlatform) {
    return window.Capacitor.getPlatform() !== "web";
  }
  return window.navigator?.userAgent?.includes("Capacitor") || false;
}

function getPushPublicKey() {
  return window.CLARIVORE_PUSH_PUBLIC_KEY || "";
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function registerServiceWorker() {
  try {
    return await navigator.serviceWorker.register(SW_PATH);
  } catch (error) {
    console.error("Push service worker registration failed:", error);
    return null;
  }
}

async function saveNativeToken({ client, userId, token, platform }) {
  if (!client || !userId || !token) return;
  const record = {
    user_id: userId,
    device_token: token,
    platform: platform || "ios",
    app_bundle_id: IOS_BUNDLE_ID,
    user_agent: navigator.userAgent || "",
    last_seen_at: new Date().toISOString(),
    disabled_at: null,
  };

  const { error } = await client
    .from("manager_device_tokens")
    .upsert(record, { onConflict: "user_id,device_token" });
  if (error) {
    console.error("Failed to store native push token:", error);
  }
}

async function saveSubscription({ client, userId, subscription }) {
  if (!client || !userId || !subscription) return;
  const payload = subscription.toJSON ? subscription.toJSON() : null;
  const keys = payload?.keys || {};
  const endpoint = subscription.endpoint || payload?.endpoint || "";
  if (!endpoint || !keys.p256dh || !keys.auth) return;

  const record = {
    user_id: userId,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: navigator.userAgent || "",
    last_seen_at: new Date().toISOString(),
    disabled_at: null,
  };

  const { error } = await client
    .from("manager_push_subscriptions")
    .upsert(record, { onConflict: "user_id,endpoint" });
  if (error) {
    console.error("Failed to store push subscription:", error);
  }
}

async function initNativePush({ user, client }) {
  if (nativeInitDone || !user) return;
  if (!isNativePlatform()) return;
  const pushNotifications = window.Capacitor?.Plugins?.PushNotifications;
  if (!pushNotifications?.requestPermissions || !pushNotifications?.register) return;

  nativeInitDone = true;
  const platform = window.Capacitor?.getPlatform
    ? window.Capacitor.getPlatform()
    : "ios";

  pushNotifications.addListener("registration", async (token) => {
    await saveNativeToken({
      client,
      userId: user.id,
      token: token?.value || "",
      platform,
    });
  });

  pushNotifications.addListener("registrationError", (error) => {
    console.error("Native push registration error:", error);
  });

  try {
    const permission = await pushNotifications.requestPermissions();
    if (permission?.receive !== "granted") return;
    await pushNotifications.register();
  } catch (error) {
    console.error("Native push permission request failed:", error);
  }
}

async function ensureSubscription({ client, userId, registration, publicKey }) {
  if (!publicKey) return;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await saveSubscription({ client, userId, subscription });
    return;
  }

  try {
    const newSub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await saveSubscription({ client, userId, subscription: newSub });
  } catch (error) {
    console.error("Failed to subscribe to push notifications:", error);
  }
}

async function initWebPush({ user, client }) {
  if (webInitDone || !user) return;
  if (!supportsPush()) return;
  const publicKey = getPushPublicKey();
  if (!publicKey) {
    console.warn("Push notifications skipped: missing public key.");
    return;
  }

  webInitDone = true;
  const registration = await registerServiceWorker();
  if (!registration) return;

  if (Notification.permission === "granted") {
    await ensureSubscription({ client, userId: user.id, registration, publicKey });
    return;
  }

  if (Notification.permission === "denied") return;

  const requestOnce = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        await ensureSubscription({ client, userId: user.id, registration, publicKey });
      }
    } catch (error) {
      console.error("Notification permission request failed:", error);
    }
  };

  document.addEventListener("click", requestOnce, { once: true });
}

export async function initManagerNotifications({ user, client } = {}) {
  const supabase =
    client ||
    defaultSupabaseClient ||
    (typeof window !== "undefined" ? window.supabaseClient || null : null);
  if (!user || !supabase) return;
  await initNativePush({ user, client: supabase });
  await initWebPush({ user, client: supabase });
}
