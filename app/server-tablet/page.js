import { Suspense } from "react";
import ServerTabletClient from "./ServerTabletClient";

export default function ServerTabletPage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" style={{ padding: "40px" }}>
          <p style={{ color: "var(--muted)", textAlign: "center" }}>
            Loading server tablet...
          </p>
        </div>
      }
    >
      <ServerTabletClient />
    </Suspense>
  );
}
