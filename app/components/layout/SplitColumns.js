import { cn } from "../../lib/ui/cn";
import styles from "./SplitColumns.module.css";

export default function SplitColumns({
  left = null,
  right = null,
  columns = 2,
  className,
  children,
  ...props
}) {
  const hasNamedColumns = left !== null || right !== null;

  return (
    <div
      className={cn(styles.grid, columns <= 1 ? styles.single : "", className)}
      {...props}
    >
      {hasNamedColumns ? (
        <>
          <div>{left}</div>
          {columns > 1 ? <div>{right}</div> : null}
        </>
      ) : (
        children
      )}
    </div>
  );
}
