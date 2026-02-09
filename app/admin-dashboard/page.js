import { Suspense } from "react";
import AdminDashboardClient from "./AdminDashboardClient";

export default function AdminDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" style={{ padding: "40px" }}>
          <p style={{ color: "var(--muted)", textAlign: "center" }}>
            Loading admin dashboard...
          </p>
        </div>
      }
    >
      <AdminDashboardClient />
    </Suspense>
  );
}
