import { useCallback, useEffect, useRef, useState } from "react";

// This hook manages the short-lived status banner shown above dashboard content.
// Calling `setStatus` immediately updates the banner and auto-clears it after 5 seconds.
export function useTransientStatus() {
  const [statusMessage, setStatusMessage] = useState({ text: "", tone: "" });
  const statusTimerRef = useRef(null);

  const setStatus = useCallback((text, tone = "success") => {
    setStatusMessage({ text, tone });

    // Cancel any previous clear timer so newer status messages are not removed early.
    if (statusTimerRef.current) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }

    // Empty text means caller intentionally cleared the banner.
    if (!text) return;

    statusTimerRef.current = window.setTimeout(() => {
      setStatusMessage((current) =>
        current.text === text ? { text: "", tone: "" } : current,
      );
      statusTimerRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    // Component unmount cleanup prevents pending timers from updating stale state.
    return () => {
      if (statusTimerRef.current) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  return {
    statusMessage,
    setStatus,
  };
}
