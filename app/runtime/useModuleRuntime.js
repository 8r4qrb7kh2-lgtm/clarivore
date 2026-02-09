"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_PUSH_PUBLIC_KEY,
  supabaseAnonKey,
  supabaseClient,
  supabaseUrl,
} from "../lib/supabase";
import { loadScript } from "./scriptLoader";

const modulePromises = new Map();

async function loadModule(src) {
  if (!src) {
    throw new Error("Missing module script path.");
  }
  if (modulePromises.has(src)) {
    return modulePromises.get(src);
  }
  const promise = import(
    /* webpackIgnore: true */
    src
  );
  modulePromises.set(src, promise);
  return promise;
}

function setRuntimeGlobals() {
  window.SUPABASE_URL = supabaseUrl;
  window.SUPABASE_ANON_KEY = supabaseAnonKey;
  window.SUPABASE_KEY = supabaseAnonKey;
  window.CLARIVORE_PUSH_PUBLIC_KEY = DEFAULT_PUSH_PUBLIC_KEY;
  if (supabaseClient) {
    window.supabaseClient = window.supabaseClient || supabaseClient;
  }
}

export function useModuleRuntime({
  externalScripts = [],
  moduleScripts = [],
} = {}) {
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        setRuntimeGlobals();

        for (const scriptConfig of externalScripts) {
          if (!scriptConfig?.src) continue;
          await loadScript(scriptConfig.src, {
            type: scriptConfig.type,
            defer: scriptConfig.defer,
            async: scriptConfig.async,
          });
        }

        for (const moduleSrc of moduleScripts) {
          await loadModule(moduleSrc);
        }

        if (!cancelled) {
          setReady(true);
        }
      } catch (runtimeError) {
        console.error("[module-runtime] failed", runtimeError);
        if (!cancelled) {
          setError(runtimeError?.message || "Failed to load page runtime.");
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, [externalScripts, moduleScripts]);

  return { ready, error };
}
