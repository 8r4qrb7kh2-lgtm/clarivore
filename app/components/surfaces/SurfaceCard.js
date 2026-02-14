import { cn } from "../../lib/ui/cn";
import styles from "./SurfaceCard.module.css";

export default function SurfaceCard({
  title,
  subtitle,
  headerRight = null,
  className,
  bodyClassName,
  titleClassName,
  subtitleClassName,
  children,
  ...props
}) {
  const hasHeader = Boolean(title || subtitle || headerRight);

  return (
    <section className={cn(styles.card, className)} {...props}>
      {hasHeader ? (
        <div className={styles.header}>
          <div className={styles.titleWrap}>
            {title ? <h2 className={cn(styles.title, titleClassName)}>{title}</h2> : null}
            {subtitle ? (
              <p className={cn(styles.subtitle, subtitleClassName)}>{subtitle}</p>
            ) : null}
          </div>
          {headerRight ? <div>{headerRight}</div> : null}
        </div>
      ) : null}
      <div className={cn(styles.body, bodyClassName)}>{children}</div>
    </section>
  );
}
