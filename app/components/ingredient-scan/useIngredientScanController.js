"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import IngredientScanModal from "./IngredientScanModal";

function asText(value) {
  return String(value ?? "").trim();
}

function toError(value, fallback = "Ingredient label scan failed.") {
  if (value instanceof Error) return value;
  const text = asText(value);
  return new Error(text || fallback);
}

export function useIngredientScanController() {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState("");

  const deferredRef = useRef(new Map());
  const eventHandlerRef = useRef(new Map());
  const sessionMetaRef = useRef(new Map());
  const sessionCounterRef = useRef(0);

  const closeSession = useCallback((sessionId) => {
    const safeId = asText(sessionId);
    if (!safeId) return;
    setSessions((current) =>
      current.filter((session) => session.sessionId !== safeId),
    );
    setActiveSessionId((current) => (current === safeId ? "" : current));
    deferredRef.current.delete(safeId);
    eventHandlerRef.current.delete(safeId);
    sessionMetaRef.current.delete(safeId);
  }, []);

  const emitPhase = useCallback((sessionId, phase, payload = {}) => {
    const safeId = asText(sessionId);
    const safePhase = asText(phase);
    if (!safeId || !safePhase) return;

    const previousMeta = sessionMetaRef.current.get(safeId) || {};
    sessionMetaRef.current.set(safeId, {
      ...previousMeta,
      phase: safePhase,
      message: asText(payload?.message),
      error: asText(payload?.error),
    });

    const handler = eventHandlerRef.current.get(safeId);
    if (typeof handler !== "function") return;

    const meta = sessionMetaRef.current.get(safeId) || previousMeta;
    handler({
      sessionId: safeId,
      ingredientName: asText(meta.ingredientName),
      phase: safePhase,
      ...(payload && typeof payload === "object" ? payload : {}),
    });
  }, []);

  const resolveSession = useCallback((sessionId, result = null) => {
    const safeId = asText(sessionId);
    if (!safeId) return;

    const deferred = deferredRef.current.get(safeId);
    if (deferred && typeof deferred.resolve === "function") {
      deferred.resolve(result ?? null);
    }
    closeSession(safeId);
  }, [closeSession]);

  const rejectSession = useCallback((sessionId, error) => {
    const safeId = asText(sessionId);
    if (!safeId) return;

    const deferred = deferredRef.current.get(safeId);
    if (deferred && typeof deferred.reject === "function") {
      deferred.reject(toError(error));
    }
    closeSession(safeId);
  }, [closeSession]);

  const openScan = useCallback(async ({
    ingredientName,
    supportedDiets = [],
    onPhaseChange,
    scanProfile = "default",
  }) => {
    const label = asText(ingredientName);
    if (!label) {
      throw new Error("Ingredient name is required before scanning.");
    }

    const sessionId = `ingredient-scan-${Date.now()}-${sessionCounterRef.current + 1}`;
    sessionCounterRef.current += 1;
    const backgroundMode = typeof onPhaseChange === "function";
    const resolvedScanProfile = asText(scanProfile) || "default";
    const initialCaptureMessage =
      asText(resolvedScanProfile).toLowerCase() === "dish_editor_brand"
        ? "Capture product front photo."
        : "Capture ingredient label photo.";

    return await new Promise((resolve, reject) => {
      deferredRef.current.set(sessionId, { resolve, reject });
      if (backgroundMode) {
        eventHandlerRef.current.set(sessionId, onPhaseChange);
      } else {
        eventHandlerRef.current.delete(sessionId);
      }
      sessionMetaRef.current.set(sessionId, {
        ingredientName: label,
        scanProfile: resolvedScanProfile,
        phase: "capture_open",
        message: initialCaptureMessage,
        error: "",
      });

      setSessions((current) => [
        ...current,
        {
          sessionId,
          ingredientName: label,
          supportedDiets: Array.isArray(supportedDiets) ? supportedDiets : [],
          backgroundMode,
          scanProfile: resolvedScanProfile,
        },
      ]);
      setActiveSessionId(sessionId);
      emitPhase(sessionId, "capture_open", { message: initialCaptureMessage });
    });
  }, [emitPhase]);

  const resumeScan = useCallback(async ({ sessionId }) => {
    const safeId = asText(sessionId);
    if (!safeId) {
      throw new Error("Session id is required.");
    }

    const session = sessionMetaRef.current.get(safeId);
    if (!session) {
      throw new Error("Ingredient scan session was not found.");
    }

    const phase = asText(session.phase);
    if (phase !== "ready_for_review" && phase !== "review_open") {
      throw new Error("Ingredient scan session is not ready for review yet.");
    }

    setActiveSessionId(safeId);
    emitPhase(safeId, "review_open");
    return { success: true };
  }, [emitPhase]);

  const modalNode = useMemo(() => {
    if (!sessions.length) return null;

    return sessions.map((session) => {
      const sessionId = session.sessionId;
      return (
        <IngredientScanModal
          key={sessionId}
          sessionId={sessionId}
          open={activeSessionId === sessionId}
          ingredientName={session.ingredientName}
          supportedDiets={session.supportedDiets}
          backgroundMode={session.backgroundMode}
          scanProfile={session.scanProfile}
          onCancel={() => {
            emitPhase(sessionId, "cancelled");
            resolveSession(sessionId, null);
          }}
          onRequestHide={() => {
            setActiveSessionId((current) => (current === sessionId ? "" : current));
          }}
          onPhaseChange={(event) => {
            const phase = asText(event?.phase);
            const message = asText(event?.message);
            const errorText = asText(event?.error);
            if (phase) {
              emitPhase(sessionId, phase, {
                message,
                error: errorText,
              });
            }

            if (phase === "failed") {
              rejectSession(sessionId, errorText || message);
            }
          }}
          onApply={async (payload) => {
            emitPhase(sessionId, "applied");
            resolveSession(sessionId, payload || null);
          }}
        />
      );
    });
  }, [activeSessionId, emitPhase, rejectSession, resolveSession, sessions]);

  return {
    openScan,
    resumeScan,
    modalNode,
    isOpen: Boolean(activeSessionId),
  };
}

export default useIngredientScanController;
