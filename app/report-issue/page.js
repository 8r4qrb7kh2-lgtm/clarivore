import { Suspense } from "react";
import ReportIssueClient from "./ReportIssueClient";

export default function ReportIssuePage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" style={{ padding: "40px" }}>
          <p style={{ color: "var(--muted)", textAlign: "center" }}>
            Loading issue reporting...
          </p>
        </div>
      }
    >
      <ReportIssueClient />
    </Suspense>
  );
}
