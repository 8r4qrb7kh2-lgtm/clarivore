import { Suspense } from "react";

export default function RouteSuspense({ label, children }) {
  return (
    <Suspense
      fallback={
        <div className="page-shell" style={{ padding: "40px" }}>
          <p style={{ color: "var(--muted)", textAlign: "center" }}>
            Loading {label}...
          </p>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
