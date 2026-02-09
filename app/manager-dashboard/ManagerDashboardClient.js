"use client";

import { useEffect, useState } from "react";
import ManagerDashboardDom from "./components/ManagerDashboardDom";
import { prepareManagerDashboardBootPayload } from "./services/managerDashboardBoot";
import { supabaseClient as supabase } from "../lib/supabase";
import { loadScript } from "../runtime/scriptLoader";

export default function ManagerDashboardClient() {
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        if (!supabase) {
          throw new Error("Supabase env vars are missing.");
        }

        window.supabaseClient = supabase;

        await loadScript("https://docs.opencv.org/4.5.2/opencv.js");
        await loadScript("/js/auth-redirect.js", { defer: true });
        await loadScript("/js/allergen-diet-config.js");

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

        await import(
          /* webpackIgnore: true */
          "/js/ingredient-label-capture.js"
        );
        await import(
          /* webpackIgnore: true */
          "/js/manager-dashboard.js"
        );
        await import(
          /* webpackIgnore: true */
          "/js/report-modal.js"
        );
      } catch (runtimeError) {
        console.error("[manager-dashboard-next] boot failed", runtimeError);
        if (!cancelled) {
          setError(
            runtimeError?.message || "Failed to load manager dashboard runtime.",
          );
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, []);

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
