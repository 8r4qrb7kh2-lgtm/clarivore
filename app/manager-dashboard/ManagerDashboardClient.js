"use client";

import { useMemo } from "react";
import { useModuleRuntime } from "../runtime/useModuleRuntime";
import ManagerDashboardDom from "./components/ManagerDashboardDom";

export default function ManagerDashboardClient() {
  const externalScripts = useMemo(
    () => [
      { src: "https://docs.opencv.org/4.5.2/opencv.js" },
      { src: "/js/auth-redirect.js", defer: true },
      { src: "/js/allergen-diet-config.js" },
    ],
    [],
  );
  const moduleScripts = useMemo(
    () => [
      "/js/ingredient-label-capture.js",
      "/js/manager-dashboard.js",
      "/js/report-modal.js",
    ],
    [],
  );

  const { error } = useModuleRuntime({ externalScripts, moduleScripts });

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
