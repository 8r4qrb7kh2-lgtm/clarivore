"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_PUSH_PUBLIC_KEY,
  supabaseAnonKey,
  supabaseClient,
  supabaseUrl,
} from "../lib/supabase";
import { loadTabletRuntime } from "./scriptLoader";

export function useLegacyTabletRuntime({ moduleSrc }) {
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadedScripts = [];

    async function boot() {
      try {
        if (!moduleSrc) {
          throw new Error("Missing runtime module path.");
        }

        window.SUPABASE_URL = supabaseUrl;
        window.SUPABASE_ANON_KEY = supabaseAnonKey;
        window.SUPABASE_KEY = supabaseAnonKey;
        window.CLARIVORE_PUSH_PUBLIC_KEY = DEFAULT_PUSH_PUBLIC_KEY;
        if (supabaseClient) {
          window.supabaseClient = window.supabaseClient || supabaseClient;
        }

        loadedScripts.push(...(await loadTabletRuntime({ moduleSrc })));

        if (!cancelled) {
          setReady(true);
        }
      } catch (runtimeError) {
        console.error("[tablet-runtime] failed", runtimeError);
        if (!cancelled) {
          setError(runtimeError?.message || "Failed to load tablet runtime.");
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
      loadedScripts.forEach((node) => {
        if (node && node.dataset.nextRuntime === "1") node.remove();
      });
      setReady(false);
    };
  }, [moduleSrc]);

  return { ready, error };
}

