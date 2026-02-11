"use client";

import { useMemo, useState } from "react";
import { cn } from "../../lib/ui/cn";

export function Tabs({
  items = [],
  value,
  defaultValue,
  onValueChange,
  className,
  listClassName,
  panelClassName,
}) {
  const firstValue = useMemo(() => {
    if (defaultValue) return defaultValue;
    return items[0]?.value || null;
  }, [defaultValue, items]);

  const [internalValue, setInternalValue] = useState(firstValue);
  const currentValue = value ?? internalValue;

  const activeItem = items.find((item) => item.value === currentValue) || null;

  const setValue = (nextValue) => {
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    onValueChange?.(nextValue);
  };

  return (
    <div className={className}>
      <div
        className={cn(
          "inline-flex rounded-full border border-[#2a3261] bg-[rgba(17,22,48,0.85)] p-1",
          listClassName,
        )}
        role="tablist"
      >
        {items.map((item) => {
          const isActive = item.value === currentValue;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm transition-colors",
                isActive
                  ? "bg-[#4c5ad4] text-white"
                  : "text-[#a7b2d1] hover:text-[#dbe3ff]",
              )}
              onClick={() => setValue(item.value)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div className={cn("mt-4", panelClassName)}>{activeItem?.content ?? null}</div>
    </div>
  );
}

export default Tabs;
