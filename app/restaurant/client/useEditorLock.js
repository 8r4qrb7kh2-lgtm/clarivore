import { useCallback, useEffect, useRef, useState } from "react";
import {
  acquireEditorLock,
  refreshEditorLock,
  releaseEditorLock,
  takeOverEditorLock,
} from "../../lib/editorLockClient";
import { readOrCreateEditorLockSessionKey } from "./editorLockSessionKey";
import {
  canTakeOverEditorLock,
  resolveEditorLockMessage,
} from "./editorLockState";

const HEARTBEAT_INTERVAL_MS = 20 * 1000;
const DEFAULT_BLOCKED_MESSAGE = "Someone is currently in web page editor.";
const DEFAULT_ERROR_MESSAGE = "Unable to verify editor availability.";

function asText(value) {
  return String(value || "").trim();
}

function resolveHolderInstance() {
  if (typeof window === "undefined") return "web";
  const host = asText(window.location?.host);
  const platform = asText(window.navigator?.platform || "web");
  return host ? `${host}:${platform}` : `web:${platform}`;
}

export function useEditorLock({
  supabaseClient,
  restaurantId,
  isEditorRequested,
  userId,
  preflightPending = false,
  preflightBlocked = false,
  preflightMessage = "",
}) {
  const mountedRef = useRef(false);
  const heartbeatTimerRef = useRef(null);
  const heldRestaurantIdRef = useRef("");
  const holdingLockRef = useRef(false);
  const shouldHoldLockRef = useRef(false);
  const sessionKeyRef = useRef("");

  if (!sessionKeyRef.current) {
    // Keep one key per browser tab. sessionStorage survives reloads in the same
    // tab, but a separately opened tab gets its own key and must acquire
    // the editor lock independently.
    sessionKeyRef.current = readOrCreateEditorLockSessionKey({
      storage: typeof window === "undefined" ? null : window.sessionStorage,
    });
  }

  const [status, setStatus] = useState("idle");
  const [lock, setLock] = useState(null);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [takeoverBusy, setTakeoverBusy] = useState(false);

  const readSessionKey = useCallback(() => {
    sessionKeyRef.current = readOrCreateEditorLockSessionKey({
      currentKey: sessionKeyRef.current,
      storage: typeof window === "undefined" ? null : window.sessionStorage,
    });
    return sessionKeyRef.current;
  }, []);

  const clearHeartbeat = useCallback(() => {
    if (!heartbeatTimerRef.current) return;
    window.clearInterval(heartbeatTimerRef.current);
    heartbeatTimerRef.current = null;
  }, []);

  const releaseLockForRestaurant = useCallback(
    async ({ restaurantId: targetRestaurantId, keepalive = false }) => {
      const safeRestaurantId = asText(targetRestaurantId);
      if (!safeRestaurantId || !supabaseClient || !userId) return;
      const sessionKey = readSessionKey();
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
    [readSessionKey, supabaseClient, userId],
  );

  const applyAcquirePayload = useCallback(
    (payload) => {
      if (!mountedRef.current) return false;

      if (payload?.available && payload?.owned) {
        setStatus("granted");
        setLock(payload?.lock || null);
        setMessage("");
        setReason("");
        holdingLockRef.current = true;
        heldRestaurantIdRef.current = asText(restaurantId);
        return true;
      }

      setStatus("blocked");
      setLock(payload?.lock || null);
      setMessage(asText(payload?.message));
      setReason(asText(payload?.reason));
      holdingLockRef.current = false;
      heldRestaurantIdRef.current = "";
      return false;
    },
    [restaurantId],
  );

  const acquireLock = useCallback(
    async ({ useRefreshAction = false } = {}) => {
      if (!supabaseClient || !restaurantId || !userId) return false;

      const sessionKey = readSessionKey();
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
    [applyAcquirePayload, readSessionKey, restaurantId, supabaseClient, userId],
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
        setReason("");
        setMessage(asText(error?.message) || DEFAULT_ERROR_MESSAGE);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }, [acquireLock, clearHeartbeat, restaurantId, supabaseClient, userId]);

  const refreshStatus = useCallback(async () => {
    if (!isEditorRequested || !supabaseClient || !restaurantId || !userId) return;
    if (preflightPending) {
      setStatus("checking");
      setReason("");
      setMessage("");
      return;
    }
    if (preflightBlocked) {
      setStatus("error");
      setReason("");
      setMessage(asText(preflightMessage) || DEFAULT_ERROR_MESSAGE);
      return;
    }

    setRefreshBusy(true);
    setStatus("checking");
    setMessage("");
    setReason("");

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
      setReason("");
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
    preflightPending,
    preflightBlocked,
    preflightMessage,
    restaurantId,
    startHeartbeat,
    supabaseClient,
    userId,
  ]);

  const takeOver = useCallback(async () => {
    if (!isEditorRequested || !supabaseClient || !restaurantId || !userId) return;
    if (preflightPending) {
      setStatus("checking");
      setReason("");
      setMessage("");
      return;
    }
    if (preflightBlocked) {
      setStatus("error");
      setReason("");
      setMessage(asText(preflightMessage) || DEFAULT_ERROR_MESSAGE);
      return;
    }

    setTakeoverBusy(true);
    setStatus("checking");
    setMessage("");
    setReason("");

    try {
      const sessionKey = readSessionKey();
      if (!sessionKey) {
        throw new Error(DEFAULT_ERROR_MESSAGE);
      }
      if (preflightBlocked) {
        throw new Error(asText(preflightMessage) || DEFAULT_ERROR_MESSAGE);
      }

      const payload = await takeOverEditorLock({
        supabase: supabaseClient,
        restaurantId,
        sessionKey,
        holderInstance: resolveHolderInstance(),
      });

      const acquired = applyAcquirePayload(payload);
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
      setReason("");
      setMessage(asText(error?.message) || DEFAULT_ERROR_MESSAGE);
    } finally {
      if (mountedRef.current) {
        setTakeoverBusy(false);
      }
    }
  }, [
    applyAcquirePayload,
    clearHeartbeat,
    isEditorRequested,
    preflightPending,
    preflightBlocked,
    preflightMessage,
    readSessionKey,
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
    if (typeof window === "undefined") return undefined;

    const releaseOnPageExit = () => {
      const heldRestaurantId = asText(heldRestaurantIdRef.current);
      if (!heldRestaurantId) return;
      void releaseLockForRestaurant({
        restaurantId: heldRestaurantId,
        keepalive: true,
      });
    };

    window.addEventListener("pagehide", releaseOnPageExit);
    window.addEventListener("beforeunload", releaseOnPageExit);
    return () => {
      window.removeEventListener("pagehide", releaseOnPageExit);
      window.removeEventListener("beforeunload", releaseOnPageExit);
    };
  }, [releaseLockForRestaurant]);

  useEffect(() => {
    shouldHoldLockRef.current = Boolean(
      isEditorRequested &&
        !preflightPending &&
        !preflightBlocked &&
        supabaseClient &&
        restaurantId &&
        userId,
    );
  }, [
    isEditorRequested,
    preflightPending,
    preflightBlocked,
    restaurantId,
    supabaseClient,
    userId,
  ]);

  useEffect(() => {
    const shouldHoldLock = Boolean(
      isEditorRequested &&
        !preflightPending &&
        !preflightBlocked &&
        supabaseClient &&
        restaurantId &&
        userId,
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
      setStatus(isEditorRequested && preflightPending ? "checking" : "idle");
      setLock(null);
      setMessage(
        isEditorRequested && preflightBlocked
          ? asText(preflightMessage) || DEFAULT_ERROR_MESSAGE
          : "",
      );
      setReason("");
      setRefreshBusy(false);
      setTakeoverBusy(false);
      if (isEditorRequested && preflightPending) {
        return;
      }
      if (isEditorRequested && preflightBlocked) {
        setStatus("error");
      }
      return;
    }

    let cancelled = false;

    const run = async () => {
      setStatus("checking");
      setMessage("");
      setReason("");

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
      setReason("");
      setMessage(asText(error?.message) || DEFAULT_ERROR_MESSAGE);
    });

    return () => {
      cancelled = true;
    };
  }, [
    acquireLock,
    clearHeartbeat,
    isEditorRequested,
    preflightPending,
    preflightBlocked,
    preflightMessage,
    releaseLockForRestaurant,
    restaurantId,
    startHeartbeat,
    supabaseClient,
    userId,
  ]);

  const checking = isEditorRequested && status === "checking";
  const granted = isEditorRequested && status === "granted";
  const blocked = isEditorRequested && (status === "blocked" || status === "error");
  const blockedMessage = resolveEditorLockMessage({
    status,
    reason,
    message: message || DEFAULT_BLOCKED_MESSAGE,
  });
  const canTakeOver = canTakeOverEditorLock({ status, reason });

  return {
    status,
    checking,
    granted,
    blocked,
    canTakeOver,
    lock,
    message: blocked ? blockedMessage : "",
    refreshBusy,
    takeoverBusy,
    refreshStatus,
    takeOver,
  };
}

export default useEditorLock;
