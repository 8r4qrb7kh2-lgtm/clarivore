import { Suspense } from "react";
import HelpContactClient from "./HelpContactClient";

export default function HelpContactPage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" style={{ padding: "40px" }}>
          <p style={{ color: "var(--muted)", textAlign: "center" }}>
            Loading help page...
          </p>
        </div>
      }
    >
      <HelpContactClient />
    </Suspense>
  );
}
