import { Suspense } from "react";
import KitchenTabletClient from "./KitchenTabletClient";

export default function KitchenTabletPage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" style={{ padding: "40px" }}>
          <p style={{ color: "var(--muted)", textAlign: "center" }}>
            Loading kitchen tablet...
          </p>
        </div>
      }
    >
      <KitchenTabletClient />
    </Suspense>
  );
}
