"use client";

import { useEffect } from "react";
import { cn } from "../../lib/ui/cn";

const SIDE_CLASS = {
  right: "right-0 top-0 h-full",
  left: "left-0 top-0 h-full",
  bottom: "bottom-0 left-0 w-full",
};

export function Drawer({
  open,
  side = "right",
  onOpenChange,
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
      className={cn("fixed inset-0 z-[1200] bg-[rgba(5,8,20,0.64)]", overlayClassName)}
      onClick={() => {
        if (closeOnOverlay) onOpenChange?.(false);
      }}
      role="presentation"
    >
      <aside
        className={cn(
          "absolute w-full max-w-[460px] border border-[#2a3261] bg-[rgba(17,22,48,0.98)] p-4 text-[#e9eefc] shadow-[0_20px_50px_rgba(0,0,0,0.5)]",
          side === "bottom" ? "max-w-none rounded-t-2xl" : "h-full",
          SIDE_CLASS[side] || SIDE_CLASS.right,
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </aside>
    </div>
  );
}

export default Drawer;
