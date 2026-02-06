"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_PUSH_PUBLIC_KEY,
  supabaseAnonKey,
  supabaseClient,
  supabaseUrl,
} from "../lib/supabase";
import { loadScript } from "../tablet-runtime/scriptLoader";

export function useLegacyRuntime({ scripts = [] }) {
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const loadedScripts = [];

    async function boot() {
      try {
        window.SUPABASE_URL = supabaseUrl;
        window.SUPABASE_ANON_KEY = supabaseAnonKey;
        window.SUPABASE_KEY = supabaseAnonKey;
        window.CLARIVORE_PUSH_PUBLIC_KEY = DEFAULT_PUSH_PUBLIC_KEY;
        if (supabaseClient) {
          window.supabaseClient = window.supabaseClient || supabaseClient;
        }

        for (const scriptConfig of scripts) {
          const node = await loadScript(scriptConfig.src, {
            type: scriptConfig.type,
            defer: scriptConfig.defer,
            async: scriptConfig.async,
          });
          loadedScripts.push(node);
        }
      } catch (runtimeError) {
        console.error("[legacy-runtime] failed", runtimeError);
        if (!cancelled) {
          setError(runtimeError?.message || "Failed to load page runtime.");
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
      loadedScripts.forEach((node) => {
        if (node && node.dataset.nextRuntime === "1") node.remove();
      });
    };
  }, [scripts]);

  return { error };
}

