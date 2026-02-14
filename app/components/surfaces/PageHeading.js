import { cn } from "../../lib/ui/cn";
import styles from "./PageHeading.module.css";

export default function PageHeading({
  title,
  subtitle,
  centered = false,
  className,
  titleClassName,
  subtitleClassName,
}) {
  return (
    <header className={cn(styles.wrap, centered ? styles.centered : "", className)}>
      <h1 className={cn(styles.title, titleClassName)}>{title}</h1>
      {subtitle ? <p className={cn(styles.subtitle, subtitleClassName)}>{subtitle}</p> : null}
    </header>
  );
}
