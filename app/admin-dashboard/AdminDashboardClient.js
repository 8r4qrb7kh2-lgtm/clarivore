"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminDashboardDom from "./components/AdminDashboardDom";
import { supabaseClient as supabase } from "../lib/supabase";
import { loadScript } from "../runtime/scriptLoader";
import { prepareAdminDashboardBootPayload } from "./services/adminDashboardBoot";

export default function AdminDashboardClient() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [authUser, setAuthUser] = useState(null);

  const onSignOut = useCallback(async () => {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
      router.replace("/account?mode=signin");
    } catch (signOutError) {
      console.error("[admin-dashboard-next] sign-out failed", signOutError);
      setError("Unable to sign out right now.");
    }
  }, [router]);

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
        if (!cancelled) {
          setAuthUser(bootPayload.user || null);
        }

        window.__adminDashboardBootPayload = bootPayload;

        await import("./runtime/legacy/admin-dashboard-page.js");
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
      <AdminDashboardDom user={authUser} onSignOut={onSignOut} />
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
