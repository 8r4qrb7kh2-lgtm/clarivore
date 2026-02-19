import { useCallback, useEffect, useRef, useState } from "react";
import {
  acquireEditorLock,
  refreshEditorLock,
  releaseEditorLock,
} from "../../lib/editorLockClient";

const HEARTBEAT_INTERVAL_MS = 20 * 1000;
const DEFAULT_BLOCKED_MESSAGE = "Someone is currently in web page editor.";
const DEFAULT_ERROR_MESSAGE = "Unable to verify editor availability.";
const SESSION_STORAGE_KEY = "clarivoreEditorInstanceSessionKey";

function asText(value) {
  return String(value || "").trim();
}

function generateSessionKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveSessionKey() {
  if (typeof window === "undefined") return "";
  try {
    const existing = asText(window.sessionStorage.getItem(SESSION_STORAGE_KEY));
    if (existing) return existing;
    const created = generateSessionKey();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return generateSessionKey();
  }
}

function resolveHolderInstance() {
  if (typeof window === "undefined") return "web";
  const host = asText(window.location?.host);
  const platform = asText(window.navigator?.platform || "web");
  return host ? `${host}:${platform}` : `web:${platform}`;
}

function toBlockedMessage(payload, fallbackMessage = DEFAULT_BLOCKED_MESSAGE) {
  if (payload?.reason === "same_user_other_instance") {
    return fallbackMessage;
  }
  if (payload?.reason === "another_editor_active") {
    return fallbackMessage;
  }
  return fallbackMessage;
}

export function useEditorLock({
  supabaseClient,
  restaurantId,
  isEditorRequested,
  userId,
}) {
  const mountedRef = useRef(false);
  const heartbeatTimerRef = useRef(null);
  const heldRestaurantIdRef = useRef("");
  const holdingLockRef = useRef(false);
  const shouldHoldLockRef = useRef(false);

  const [status, setStatus] = useState("idle");
  const [lock, setLock] = useState(null);
  const [message, setMessage] = useState("");
  const [refreshBusy, setRefreshBusy] = useState(false);

  const clearHeartbeat = useCallback(() => {
    if (!heartbeatTimerRef.current) return;
    window.clearInterval(heartbeatTimerRef.current);
    heartbeatTimerRef.current = null;
  }, []);

  const releaseLockForRestaurant = useCallback(
    async ({ restaurantId: targetRestaurantId, keepalive = false }) => {
      const safeRestaurantId = asText(targetRestaurantId);
      if (!safeRestaurantId || !supabaseClient || !userId) return;
      const sessionKey = resolveSessionKey();
      if (!sessionKey) return;

      try {
        await releaseEditorLock({
          supabase: supabaseClient,
          restaurantId: safeRestaurantId,
          sessionKey,
          keepalive,
        });
      } catch {
        // Lock release failures are non-fatal because leases auto-expire.
      } finally {
        if (heldRestaurantIdRef.current === safeRestaurantId) {
          heldRestaurantIdRef.current = "";
          holdingLockRef.current = false;
        }
      }
    },
    [supabaseClient, userId],
  );

  const applyAcquirePayload = useCallback(
    (payload) => {
      if (!mountedRef.current) return false;

      if (payload?.available && payload?.owned) {
        setStatus("granted");
        setLock(payload?.lock || null);
        setMessage("");
        holdingLockRef.current = true;
        heldRestaurantIdRef.current = asText(restaurantId);
        return true;
      }

      setStatus("blocked");
      setLock(payload?.lock || null);
      setMessage(toBlockedMessage(payload));
      holdingLockRef.current = false;
      heldRestaurantIdRef.current = "";
      return false;
    },
    [restaurantId],
  );

  const acquireLock = useCallback(
    async ({ useRefreshAction = false } = {}) => {
      if (!supabaseClient || !restaurantId || !userId) return false;

      const sessionKey = resolveSessionKey();
      if (!sessionKey) {
        throw new Error(DEFAULT_ERROR_MESSAGE);
      }

      const payload = useRefreshAction
        ? await refreshEditorLock({
            supabase: supabaseClient,
            restaurantId,
            sessionKey,
            holderInstance: resolveHolderInstance(),
          })
        : await acquireEditorLock({
            supabase: supabaseClient,
            restaurantId,
            sessionKey,
            holderInstance: resolveHolderInstance(),
          });

      return applyAcquirePayload(payload);
    },
    [applyAcquirePayload, restaurantId, supabaseClient, userId],
  );

  const startHeartbeat = useCallback(() => {
    clearHeartbeat();
    if (typeof window === "undefined") return;

    heartbeatTimerRef.current = window.setInterval(async () => {
      if (!mountedRef.current || !shouldHoldLockRef.current) return;
      if (!supabaseClient || !restaurantId || !userId) return;

      try {
        const acquired = await acquireLock({ useRefreshAction: true });
        if (!acquired) {
          clearHeartbeat();
        }
      } catch (error) {
        if (!mountedRef.current) return;
        clearHeartbeat();
        holdingLockRef.current = false;
        heldRestaurantIdRef.current = "";
        setStatus("error");
        setMessage(asText(error?.message) || DEFAULT_ERROR_MESSAGE);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }, [acquireLock, clearHeartbeat, restaurantId, supabaseClient, userId]);

  const refreshStatus = useCallback(async () => {
    if (!isEditorRequested || !supabaseClient || !restaurantId || !userId) return;

    setRefreshBusy(true);
    setStatus("checking");
    setMessage("");

    try {
      const acquired = await acquireLock({ useRefreshAction: true });
      if (acquired) {
        startHeartbeat();
      } else {
        clearHeartbeat();
      }
    } catch (error) {
      if (!mountedRef.current) return;
      clearHeartbeat();
      holdingLockRef.current = false;
      heldRestaurantIdRef.current = "";
      setStatus("error");
      setMessage(asText(error?.message) || DEFAULT_ERROR_MESSAGE);
    } finally {
      if (mountedRef.current) {
        setRefreshBusy(false);
      }
    }
  }, [
    acquireLock,
    clearHeartbeat,
    isEditorRequested,
    restaurantId,
    startHeartbeat,
    supabaseClient,
    userId,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearHeartbeat();
      const heldRestaurantId = asText(heldRestaurantIdRef.current);
      if (heldRestaurantId) {
        void releaseLockForRestaurant({
          restaurantId: heldRestaurantId,
          keepalive: true,
        });
      }
    };
  }, [clearHeartbeat, releaseLockForRestaurant]);

  useEffect(() => {
    shouldHoldLockRef.current = Boolean(
      isEditorRequested && supabaseClient && restaurantId && userId,
    );
  }, [isEditorRequested, restaurantId, supabaseClient, userId]);

  useEffect(() => {
    const shouldHoldLock = Boolean(
      isEditorRequested && supabaseClient && restaurantId && userId,
    );

    if (!shouldHoldLock) {
      clearHeartbeat();
      const heldRestaurantId = asText(heldRestaurantIdRef.current);
      if (holdingLockRef.current && heldRestaurantId) {
        void releaseLockForRestaurant({
          restaurantId: heldRestaurantId,
        });
      } else {
        heldRestaurantIdRef.current = "";
        holdingLockRef.current = false;
      }
      setStatus("idle");
      setLock(null);
      setMessage("");
      setRefreshBusy(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setStatus("checking");
      setMessage("");

      const previousRestaurantId = asText(heldRestaurantIdRef.current);
      if (holdingLockRef.current && previousRestaurantId && previousRestaurantId !== restaurantId) {
        await releaseLockForRestaurant({ restaurantId: previousRestaurantId });
      }

      const acquired = await acquireLock();
      if (cancelled || !mountedRef.current) return;
      if (acquired) {
        startHeartbeat();
      } else {
        clearHeartbeat();
      }
    };

    run().catch((error) => {
      if (cancelled || !mountedRef.current) return;
      clearHeartbeat();
      holdingLockRef.current = false;
      heldRestaurantIdRef.current = "";
      setStatus("error");
      setMessage(asText(error?.message) || DEFAULT_ERROR_MESSAGE);
    });

    return () => {
      cancelled = true;
    };
  }, [
    acquireLock,
    clearHeartbeat,
    isEditorRequested,
    releaseLockForRestaurant,
    restaurantId,
    startHeartbeat,
    supabaseClient,
    userId,
  ]);

  const checking = isEditorRequested && status === "checking";
  const granted = isEditorRequested && status === "granted";
  const blocked = isEditorRequested && (status === "blocked" || status === "error");
  const blockedMessage =
    status === "error"
      ? DEFAULT_BLOCKED_MESSAGE
      : asText(message) || DEFAULT_BLOCKED_MESSAGE;

  return {
    status,
    checking,
    granted,
    blocked,
    lock,
    message: blocked ? blockedMessage : "",
    refreshBusy,
    refreshStatus,
  };
}

export default useEditorLock;
