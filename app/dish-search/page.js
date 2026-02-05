import { Suspense } from "react";
import DishSearchClient from "./DishSearchClient";

export default function DishSearchPage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" style={{ padding: "40px" }}>
          <p style={{ color: "var(--muted)", textAlign: "center" }}>
            Loading dish search...
          </p>
        </div>
      }
    >
      <DishSearchClient />
    </Suspense>
  );
}
