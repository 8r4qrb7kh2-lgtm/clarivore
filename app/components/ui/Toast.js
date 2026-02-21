"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { cn } from "../../lib/ui/cn";

const ToastContext = createContext(null);

const TONE_CLASS = {
  neutral: "border-[#2a3261] bg-[rgba(17,22,48,0.95)] text-[#e9eefc]",
  success: "border-[#1a7b46] bg-[rgba(23,102,58,0.25)] text-[#cbf7dd]",
  warn: "border-[rgba(250,204,21,0.55)] bg-[rgba(250,204,21,0.16)] text-[#fff3a8]",
  danger: "border-[#a12525] bg-[rgba(139,29,29,0.34)] text-[#ffd0d0]",
};

function createToastId() {
  return `toast-${Math.random().toString(36).slice(2, 10)}`;
}

export function ToastProvider({ children, maxToasts = 5 }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    ({ title, description = "", tone = "neutral", duration = 3200 }) => {
      if (tone === "success") {
        return "";
      }

      const id = createToastId();
      setToasts((current) => {
        const next = [...current, { id, title, description, tone }];
        return next.slice(-maxToasts);
      });

      if (duration > 0) {
        window.setTimeout(() => dismiss(id), duration);
      }

      return id;
    },
    [dismiss, maxToasts],
  );

  const value = useMemo(() => ({ push, dismiss, toasts }), [dismiss, push, toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[1400] flex w-[min(420px,92vw)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto rounded-xl border px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.4)]",
              TONE_CLASS[toast.tone] || TONE_CLASS.neutral,
            )}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                {toast.title ? <p className="m-0 text-sm font-semibold">{toast.title}</p> : null}
                {toast.description ? (
                  <p className="m-0 mt-1 text-xs opacity-90">{toast.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                className="btnLink !p-0 text-xs"
                onClick={() => dismiss(toast.id)}
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider.");
  }
  return ctx;
}

export default ToastProvider;
