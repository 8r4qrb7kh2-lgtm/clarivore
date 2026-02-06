import { Suspense } from "react";
import ManagerDashboardClient from "./ManagerDashboardClient";

export default function ManagerDashboardLegacyPage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" style={{ padding: "40px" }}>
          <p style={{ color: "var(--muted)", textAlign: "center" }}>
            Loading manager dashboard...
          </p>
        </div>
      }
    >
      <ManagerDashboardClient />
    </Suspense>
  );
}
