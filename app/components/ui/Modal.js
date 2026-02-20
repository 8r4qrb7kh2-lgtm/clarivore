"use client";

import { useEffect } from "react";
import { cn } from "../../lib/ui/cn";

export function Modal({
  open,
  onOpenChange,
  title,
  footer,
  children,
  className,
  overlayClassName,
  closeOnOverlay = true,
  closeOnEsc = true,
}) {
  useEffect(() => {
    if (!open || !closeOnEsc) return;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onOpenChange?.(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeOnEsc, onOpenChange, open]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[1200] flex items-center justify-center bg-[rgba(5,8,20,0.72)] px-3 py-4 sm:px-4",
        overlayClassName,
      )}
      style={{
        paddingLeft: "max(12px, env(safe-area-inset-left))",
        paddingRight: "max(12px, env(safe-area-inset-right))",
        paddingTop: "max(12px, env(safe-area-inset-top))",
        paddingBottom: "max(12px, env(safe-area-inset-bottom))",
      }}
      onClick={() => {
        if (closeOnOverlay) onOpenChange?.(false);
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || "Dialog"}
        className={cn(
          "w-full max-w-[720px] mx-auto rounded-2xl border border-[#2a3261] bg-[rgba(17,22,48,0.98)] p-5 text-[#e9eefc] shadow-[0_30px_80px_rgba(0,0,0,0.55)]",
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {title ? <h2 className="m-0 mb-3 text-[1.2rem] font-semibold">{title}</h2> : null}
        <div>{children}</div>
        {footer ? <div className="mt-4">{footer}</div> : null}
      </div>
    </div>
  );
}

export default Modal;
