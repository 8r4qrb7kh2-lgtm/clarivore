"use client";

import { useMemo } from "react";
import { useLegacyRuntime } from "../legacy-runtime/useLegacyRuntime";
import ReportIssueDom from "./components/ReportIssueDom";

export default function ReportIssueClient() {
  const scripts = useMemo(
    () => [
      { src: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" },
      { src: "/js/auth-redirect.js", defer: true },
      { src: "/js/report-modal.js", type: "module" },
      { src: "/js/report-issue-page.js", type: "module" },
    ],
    [],
  );

  const { error } = useLegacyRuntime({ scripts });

  return (
    <>
      <ReportIssueDom />
      {error ? (
        <p
          className="status-text error"
          style={{ margin: "12px auto 0", maxWidth: 900, padding: "0 20px" }}
        >
          {error}
        </p>
      ) : null}
    </>
  );
}
