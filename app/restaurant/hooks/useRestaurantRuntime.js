"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient as supabase } from "../../lib/supabase";
import {
  applyConsoleReportingPreference,
  buildRestaurantBootPayload,
  initRestaurantBootGlobals,
} from "../restaurantBootService";
import {
  loadRestaurantDependencies,
  loadRestaurantRuntimeModule,
} from "../runtime/scriptLoader";
import { initializeRestaurantRuntimeEnvironment } from "../runtime/runtimeEnvironment";

export function useRestaurantRuntime({ slug, isQrVisit, inviteToken }) {
  const router = useRouter();
  const [status, setStatus] = useState("Loading restaurant...");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let lockRef = null;

    async function boot() {
      try {
        if (!supabase) {
          throw new Error("Supabase env vars are missing.");
        }

        if (!slug) {
          throw new Error("No restaurant specified.");
        }

        applyConsoleReportingPreference();
        initRestaurantBootGlobals(supabase);
        initializeRestaurantRuntimeEnvironment();

        setStatus("Loading restaurant data...");
        const [result] = await Promise.all([
          buildRestaurantBootPayload({
            supabaseClient: supabase,
            slug,
            isQrVisit,
            inviteToken,
          }),
          loadRestaurantDependencies(),
        ]);

        if (cancelled) return;

        if (result.redirect) {
          router.replace(result.redirect);
          return;
        }

        if (!result.payload) {
          throw new Error(result.error || "Unable to load restaurant.");
        }

        lockRef = result.lock;

        setStatus("Starting restaurant app...");
        const runtimeModule = await loadRestaurantRuntimeModule();

        if (cancelled) return;

        runtimeModule.hydrateRestaurantBootPayload(result.payload);

        if (!cancelled) {
          setStatus("");
        }
      } catch (bootError) {
        console.error("[restaurant-next] boot failed", bootError);
        if (!cancelled) {
          setError(bootError?.message || "Failed to load restaurant page.");
          setStatus("");
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
      if (lockRef && typeof lockRef.release === "function") {
        lockRef.release().catch(() => {});
      }
    };
  }, [inviteToken, isQrVisit, router, slug]);

  return { status, error };
}
