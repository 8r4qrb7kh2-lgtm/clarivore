"use client";

import { useCallback, useMemo } from "react";
import { useModuleRuntime } from "../runtime/useModuleRuntime";
import ManagerDashboardDom from "./components/ManagerDashboardDom";
import { prepareManagerDashboardBootPayload } from "./services/managerDashboardBoot";

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

  const beforeModuleLoad = useCallback(async () => {
    const bootPayload = await prepareManagerDashboardBootPayload();
    const hasManagerAccess = Boolean(bootPayload.isOwner || bootPayload.isManager);

    if (hasManagerAccess) {
      bootPayload.currentMode =
        localStorage.getItem("clarivoreManagerMode") || "editor";
    } else {
      bootPayload.currentMode = null;
    }

    if (bootPayload.user) {
      const [{ setupTopbar }, { initManagerNotifications }] = await Promise.all([
        import(
          /* webpackIgnore: true */
          "/js/shared-nav.js"
        ),
        hasManagerAccess
          ? import(
              /* webpackIgnore: true */
              "/js/manager-notifications.js"
            )
          : Promise.resolve({ initManagerNotifications: null }),
      ]);

      setupTopbar("home", bootPayload.user, {
        managerRestaurants: bootPayload.managerRestaurants || [],
      });
      bootPayload.topbarSetupDone = true;

      if (hasManagerAccess && typeof initManagerNotifications === "function") {
        initManagerNotifications({
          user: bootPayload.user,
          client: window.supabaseClient,
        });
        bootPayload.managerNotificationsReady = true;
      } else {
        bootPayload.managerNotificationsReady = false;
      }
    } else {
      bootPayload.topbarSetupDone = false;
      bootPayload.managerNotificationsReady = false;
    }

    window.__managerDashboardBootPayload = bootPayload;
  }, []);

  const { error } = useModuleRuntime({
    externalScripts,
    moduleScripts,
    beforeModuleLoad,
  });

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
