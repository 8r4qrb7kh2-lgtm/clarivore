import { forwardRef } from "react";
import { cn } from "../../lib/ui/cn";

const SIZE_CLASS = {
  compact: "px-2 py-1 text-sm",
  standard: "px-3 py-2 text-[0.95rem]",
  roomy: "px-3.5 py-2.5 text-base",
};

const STATE_CLASS = {
  default: "border-[#2a3261] focus:border-[#7c9cff]",
  error: "border-[#dc5252] focus:border-[#dc5252]",
  success: "border-[#22c55e] focus:border-[#22c55e]",
};

export const Input = forwardRef(function Input(
  {
    size = "standard",
    state = "default",
    leadingIcon,
    trailingAction,
    className,
    wrapperClassName,
    ...props
  },
  ref,
) {
  return (
    <div className={cn("relative flex items-center", wrapperClassName)}>
      {leadingIcon ? (
        <span className="pointer-events-none absolute left-3 text-[#a7b2d1]">
          {leadingIcon}
        </span>
      ) : null}
      <input
        ref={ref}
        className={cn(
          "w-full rounded-xl border bg-[rgba(17,22,48,0.9)] text-[#e9eefc] outline-none transition-colors",
          "placeholder:text-[#8ea0d3] focus:ring-2 focus:ring-[rgba(124,156,255,0.18)]",
          SIZE_CLASS[size] || SIZE_CLASS.standard,
          STATE_CLASS[state] || STATE_CLASS.default,
          leadingIcon ? "pl-9" : "",
          trailingAction ? "pr-10" : "",
          className,
        )}
        {...props}
      />
      {trailingAction ? (
        <span className="absolute right-2 inline-flex items-center">
          {trailingAction}
        </span>
      ) : null}
    </div>
  );
});

export default Input;
