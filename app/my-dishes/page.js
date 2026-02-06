import { Suspense } from "react";
import MyDishesClient from "./MyDishesClient";

export default function MyDishesLegacyPage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" style={{ padding: "40px" }}>
          <p style={{ color: "var(--muted)", textAlign: "center" }}>
            Loading my dishes...
          </p>
        </div>
      }
    >
      <MyDishesClient />
    </Suspense>
  );
}
