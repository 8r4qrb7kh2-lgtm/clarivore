import { Suspense } from "react";
import OrderFeedbackClient from "./OrderFeedbackClient";

export default function OrderFeedbackLegacyPage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" style={{ padding: "40px" }}>
          <p style={{ color: "var(--muted)", textAlign: "center" }}>
            Loading feedback page...
          </p>
        </div>
      }
    >
      <OrderFeedbackClient />
    </Suspense>
  );
}
