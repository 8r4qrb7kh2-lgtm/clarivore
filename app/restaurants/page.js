import { Suspense } from "react";
import RestaurantsClient from "./RestaurantsClient";

export default function RestaurantsPage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" style={{ padding: "40px" }}>
          <p style={{ color: "var(--muted)", textAlign: "center" }}>
            Loading restaurants...
          </p>
        </div>
      }
    >
      <RestaurantsClient />
    </Suspense>
  );
}
