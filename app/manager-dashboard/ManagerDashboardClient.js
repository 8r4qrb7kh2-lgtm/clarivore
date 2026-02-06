"use client";

import { useMemo } from "react";
import { useLegacyRuntime } from "../legacy-runtime/useLegacyRuntime";
import ManagerDashboardDom from "./components/ManagerDashboardDom";

export default function ManagerDashboardClient() {
  const scripts = useMemo(
    () => [
      { src: "https://docs.opencv.org/4.5.2/opencv.js" },
      { src: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" },
      { src: "/js/auth-redirect.js", defer: true },
      { src: "/js/allergen-diet-config.js" },
      { src: "/js/ingredient-label-capture.js", type: "module" },
      { src: "/js/manager-dashboard.js", type: "module" },
      { src: "/js/report-modal.js", type: "module" },
    ],
    [],
  );

  const { error } = useLegacyRuntime({ scripts });

  return (
    <>
      <ManagerDashboardDom />
      {error ? (
        <p
          className="status-text error"
          style={{ margin: "12px auto 0", maxWidth: 1200, padding: "0 20px" }}
        >
          {error}
        </p>
      ) : null}
    </>
  );
}

