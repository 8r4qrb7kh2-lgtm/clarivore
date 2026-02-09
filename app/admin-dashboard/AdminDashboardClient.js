"use client";

import { useMemo } from "react";
import { useModuleRuntime } from "../runtime/useModuleRuntime";
import AdminDashboardDom from "./components/AdminDashboardDom";

export default function AdminDashboardClient() {
  const externalScripts = useMemo(
    () => [
      { src: "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js" },
      { src: "/js/auth-redirect.js", defer: true },
    ],
    [],
  );
  const moduleScripts = useMemo(() => ["/js/admin-dashboard-page.js"], []);

  const { error } = useModuleRuntime({ externalScripts, moduleScripts });

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
