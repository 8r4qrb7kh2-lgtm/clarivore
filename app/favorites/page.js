import { Suspense } from "react";
import FavoritesClient from "./FavoritesClient";

export default function FavoritesPage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" style={{ padding: "40px" }}>
          <p style={{ color: "var(--muted)", textAlign: "center" }}>
            Loading favorites...
          </p>
        </div>
      }
    >
      <FavoritesClient />
    </Suspense>
  );
}
