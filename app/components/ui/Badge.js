import { cn } from "../../lib/ui/cn";

const TONE_CLASS = {
  neutral: "bg-[rgba(124,156,255,0.18)] text-[#dce5ff] border-[rgba(124,156,255,0.35)]",
  primary: "bg-[rgba(76,90,212,0.32)] text-white border-[#5c6ce8]",
  success: "bg-[rgba(23,102,58,0.38)] text-[#cbf7dd] border-[#1a7b46]",
  warn: "bg-[rgba(250,204,21,0.2)] text-[#fff3a8] border-[rgba(250,204,21,0.5)]",
  danger: "bg-[rgba(139,29,29,0.36)] text-[#ffd0d0] border-[#a12525]",
};

export function Badge({ tone = "neutral", className, children, ...props }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        TONE_CLASS[tone] || TONE_CLASS.neutral,
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export default Badge;
