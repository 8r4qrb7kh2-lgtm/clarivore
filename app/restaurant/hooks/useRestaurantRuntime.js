"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient as supabase } from "../../lib/supabase";
import {
  applyConsoleReportingPreference,
  buildRestaurantBootPayload,
  dispatchRestaurantBootPayload,
  initRestaurantBootGlobals,
} from "../restaurantBootService";
import {
  loadRestaurantDependencies,
  loadRestaurantRuntimeModule,
} from "../runtime/scriptLoader";

export function useRestaurantRuntime({ slug, isQrVisit, inviteToken }) {
  const router = useRouter();
  const [status, setStatus] = useState("Loading restaurant...");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const loadedScripts = [];
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

        setStatus("Loading page dependencies...");
        loadedScripts.push(...(await loadRestaurantDependencies()));

        setStatus("Loading restaurant data...");
        const result = await buildRestaurantBootPayload({
          supabaseClient: supabase,
          slug,
          isQrVisit,
          inviteToken,
        });

        if (cancelled) return;

        if (result.redirect) {
          router.replace(result.redirect);
          return;
        }

        if (!result.payload) {
          throw new Error(result.error || "Unable to load restaurant.");
        }

        lockRef = result.lock;
        dispatchRestaurantBootPayload(result.payload);

        setStatus("Starting restaurant app...");
        loadedScripts.push(await loadRestaurantRuntimeModule());

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
      loadedScripts.forEach((node) => node.remove());
      if (lockRef && typeof lockRef.release === "function") {
        lockRef.release().catch(() => {});
      }
    };
  }, [inviteToken, isQrVisit, router, slug]);

  return { status, error };
}
