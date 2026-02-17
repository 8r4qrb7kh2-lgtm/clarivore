"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppLoadingScreen from "../components/AppLoadingScreen";
import AdminDashboardDom from "./components/AdminDashboardDom";
import { supabaseClient as supabase } from "../lib/supabase";
import { loadScript } from "../runtime/scriptLoader";
import { prepareAdminDashboardBootPayload } from "./services/adminDashboardBoot";

export default function AdminDashboardClient() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isBooting, setIsBooting] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

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

        try {
          await loadScript(
            "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js",
            { defer: true },
          );
        } catch (scriptError) {
          // QR generation should not block admin boot in offline/CDN-restricted environments.
          console.warn("[admin-dashboard-next] failed to load QR script", scriptError);
        }

        const bootPayload = await prepareAdminDashboardBootPayload();
        if (!cancelled) {
          setAuthUser(bootPayload.user || null);
          setIsAdmin(Boolean(bootPayload.isAdmin));
        }
      } catch (runtimeError) {
        console.error("[admin-dashboard-next] boot failed", runtimeError);
        if (!cancelled) {
          setError(
            runtimeError?.message || "Failed to load admin dashboard.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsBooting(false);
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isBooting) {
    return <AppLoadingScreen label="admin dashboard" />;
  }

  return (
    <>
      <AdminDashboardDom
        user={authUser}
        isAdmin={isAdmin}
        isBooting={isBooting}
        onSignOut={onSignOut}
      />
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
