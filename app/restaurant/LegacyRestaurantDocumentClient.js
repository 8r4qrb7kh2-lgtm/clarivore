"use client";

import { useEffect, useState } from "react";
import PageShell from "../components/PageShell";

export default function LegacyRestaurantDocumentClient({ html }) {
  const [error, setError] = useState("");

  useEffect(() => {
    if (!html) {
      setError("Legacy restaurant page is unavailable.");
      return;
    }

    try {
      // Replace the full document so the legacy page runs exactly as before.
      document.open();
      document.write(html);
      document.close();
    } catch (runtimeError) {
      setError(
        runtimeError?.message || "Unable to load the restaurant page.",
      );
    }
  }, [html]);

  return (
    <PageShell>
      <p className={`status-text${error ? " error" : ""}`}>
        {error || "Loading restaurant..."}
      </p>
    </PageShell>
  );
}
