"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ManagerDashboardDom from "./components/ManagerDashboardDom";
import { prepareManagerDashboardBootPayload } from "./services/managerDashboardBoot";
import { supabaseClient as supabase } from "../lib/supabase";
import { loadScript } from "../runtime/scriptLoader";
import { initManagerNotifications } from "../lib/managerNotifications";
import { ensureAllergenDietConfigGlobals } from "../lib/allergenConfigRuntime";

export default function ManagerDashboardClient() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [authUser, setAuthUser] = useState(null);
  const [managerRestaurants, setManagerRestaurants] = useState([]);
  const [managerMode, setManagerMode] = useState("editor");
  const [isManagerOrOwner, setIsManagerOrOwner] = useState(false);

  const onModeChange = useCallback(
    (nextMode) => {
      if (!nextMode || nextMode === managerMode) return;
      localStorage.setItem("clarivoreManagerMode", nextMode);
      setManagerMode(nextMode);
      if (nextMode === "customer") {
        router.replace("/home");
      } else {
        router.replace("/manager-dashboard");
      }
    },
    [managerMode, router],
  );

  const onSignOut = useCallback(async () => {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
      router.replace("/account?mode=signin");
    } catch (signOutError) {
      console.error("[manager-dashboard-next] sign-out failed", signOutError);
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

        await loadScript("https://docs.opencv.org/4.5.2/opencv.js");
        await ensureAllergenDietConfigGlobals(supabase);

        const bootPayload = await prepareManagerDashboardBootPayload();
        const hasManagerAccess = Boolean(
          bootPayload.isOwner || bootPayload.isManager,
        );

        if (hasManagerAccess) {
          bootPayload.currentMode =
            localStorage.getItem("clarivoreManagerMode") || "editor";
        } else {
          bootPayload.currentMode = null;
        }

        if (!cancelled) {
          setAuthUser(bootPayload.user || null);
          setManagerRestaurants(bootPayload.managerRestaurants || []);
          setManagerMode(bootPayload.currentMode || "editor");
          setIsManagerOrOwner(hasManagerAccess);
        }

        if (hasManagerAccess && bootPayload.currentMode !== "editor") {
          router.replace("/home");
          return;
        }

        if (bootPayload.user) {
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
          bootPayload.managerNotificationsReady = false;
        }
        bootPayload.topbarSetupDone = true;

        window.__managerDashboardBootPayload = bootPayload;

        await import("./runtime/legacy/ingredient-label-capture.js");
        await import("./runtime/legacy/manager-dashboard.js");
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
  }, [router]);

  return (
    <>
      <ManagerDashboardDom
        user={authUser}
        isManagerOrOwner={isManagerOrOwner}
        managerRestaurants={managerRestaurants}
        managerMode={managerMode}
        onModeChange={onModeChange}
        onSignOut={onSignOut}
      />
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
