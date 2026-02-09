"use client";

import { useEffect, useState } from "react";
import AdminDashboardDom from "./components/AdminDashboardDom";
import { supabaseClient as supabase } from "../lib/supabase";
import { loadScript } from "../runtime/scriptLoader";
import { prepareAdminDashboardBootPayload } from "./services/adminDashboardBoot";

export default function AdminDashboardClient() {
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        if (!supabase) {
          throw new Error("Supabase env vars are missing.");
        }

        window.supabaseClient = supabase;

        await loadScript(
          "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js",
          { defer: true },
        );

        const bootPayload = await prepareAdminDashboardBootPayload();

        const { setupTopbar, attachSignOutHandler } = await import(
          /* webpackIgnore: true */
          "/js/shared-nav.js"
        );

        setupTopbar("admin", bootPayload.user, {
          managerRestaurants: bootPayload.managerRestaurants || [],
        });
        bootPayload.topbarSetupDone = true;

        if (bootPayload.user) {
          attachSignOutHandler(supabase);
          bootPayload.signOutHandlerBound = true;
        }

        window.__adminDashboardBootPayload = bootPayload;

        await import(
          /* webpackIgnore: true */
          "/js/admin-dashboard-page.js"
        );
      } catch (runtimeError) {
        console.error("[admin-dashboard-next] boot failed", runtimeError);
        if (!cancelled) {
          setError(
            runtimeError?.message || "Failed to load admin dashboard runtime.",
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
