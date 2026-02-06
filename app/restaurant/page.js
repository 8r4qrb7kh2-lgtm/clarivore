import { Suspense } from "react";
import RestaurantClient from "./RestaurantClient";

export default function RestaurantPage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" style={{ padding: "40px" }}>
          <p style={{ color: "var(--muted)", textAlign: "center" }}>
            Loading restaurant...
          </p>
        </div>
      }
    >
      <RestaurantClient />
    </Suspense>
  );
}
