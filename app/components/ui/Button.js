import { forwardRef } from "react";
import { cn } from "../../lib/ui/cn";

const VARIANT_CLASS = {
  solid: "btn",
  outline: "btn btnGhost",
  link: "btnLink",
};

const TONE_CLASS = {
  neutral: "",
  primary: "btnPrimary",
  secondary: "btnSecondary",
  danger: "btnDanger",
  success: "btnSuccess",
  ghost: "btnGhost",
};

const SIZE_CLASS = {
  compact: "btnSmall",
  standard: "",
  roomy: "px-4 py-3 text-[0.95rem]",
};

export const Button = forwardRef(function Button(
  {
    as: Comp = "button",
    type = "button",
    variant = "solid",
    size = "standard",
    tone = "neutral",
    loading = false,
    disabled = false,
    className,
    children,
    ...props
  },
  ref,
) {
  const isLinkVariant = variant === "link";
  const classNames = cn(
    VARIANT_CLASS[variant] || VARIANT_CLASS.solid,
    !isLinkVariant ? TONE_CLASS[tone] || "" : "",
    !isLinkVariant ? SIZE_CLASS[size] || "" : "",
    loading ? "opacity-70 pointer-events-none" : "",
    className,
  );

  return (
    <Comp
      ref={ref}
      type={Comp === "button" ? type : undefined}
      disabled={Comp === "button" ? disabled || loading : undefined}
      aria-busy={loading || undefined}
      className={classNames}
      {...props}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-r-transparent" />
          <span>{children}</span>
        </span>
      ) : (
        children
      )}
    </Comp>
  );
});

export default Button;
