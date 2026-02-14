import { cn } from "../../lib/ui/cn";
import styles from "./FormSectionCard.module.css";

export default function FormSectionCard({ className, children, ...props }) {
  return (
    <section className={cn(styles.card, className)} {...props}>
      {children}
    </section>
  );
}
