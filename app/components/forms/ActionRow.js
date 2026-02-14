import { cn } from "../../lib/ui/cn";
import styles from "./ActionRow.module.css";

const ALIGN_CLASS = {
  start: "",
  center: styles.center,
  end: styles.end,
  spaceBetween: styles.spaceBetween,
};

export default function ActionRow({ align = "start", className, children, ...props }) {
  return (
    <div className={cn(styles.row, ALIGN_CLASS[align] || "", className)} {...props}>
      {children}
    </div>
  );
}
