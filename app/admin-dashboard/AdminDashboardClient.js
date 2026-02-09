"use client";

import { useMemo } from "react";
import { useLegacyRuntime } from "../legacy-runtime/useLegacyRuntime";
import AdminDashboardDom from "./components/AdminDashboardDom";

export default function AdminDashboardClient() {
  const scripts = useMemo(
    () => [
      { src: "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js" },
      { src: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" },
      { src: "/js/auth-redirect.js", defer: true },
      { src: "/js/admin-dashboard-page.js", type: "module" },
    ],
    [],
  );

  const { error } = useLegacyRuntime({ scripts });

  return (
    <>
      <AdminDashboardDom />
      {error ? (
        <p
          className="status-text error"
          style={{ margin: "12px auto 0", maxWidth: 1400, padding: "0 20px" }}
        >
          {error}
        </p>
      ) : null}
    </>
  );
}
