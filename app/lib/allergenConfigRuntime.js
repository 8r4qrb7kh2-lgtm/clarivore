import {
  buildAllergenDietConfig,
  loadAllergenDietConfig,
} from "./allergenConfig";
import { supabaseClient as defaultSupabaseClient } from "./supabase";

let browserConfigPromise = null;

function toLoadedConfig(config) {
  return {
    ...buildAllergenDietConfig(),
    ...(config || {}),
    _loaded: true,
  };
}

export function getActiveAllergenDietConfig() {
  if (typeof window !== "undefined" && window.ALLERGEN_DIET_CONFIG) {
    return window.ALLERGEN_DIET_CONFIG;
  }
  return toLoadedConfig(buildAllergenDietConfig());
}

export async function ensureAllergenDietConfigGlobals(supabaseClient = null) {
  if (typeof window === "undefined") {
    return toLoadedConfig(buildAllergenDietConfig());
  }

  if (window.ALLERGEN_DIET_CONFIG?._loaded && window.loadAllergenDietConfig) {
    return window.ALLERGEN_DIET_CONFIG;
  }

  if (!browserConfigPromise) {
    browserConfigPromise = (async () => {
      const resolvedClient =
        supabaseClient ||
        defaultSupabaseClient ||
        window.supabaseClient ||
        null;
      const config = await loadAllergenDietConfig(resolvedClient);
      return toLoadedConfig(config);
    })();
  }

  const loadedConfig = await browserConfigPromise;
  window.ALLERGEN_DIET_CONFIG = loadedConfig;
  window.loadAllergenDietConfig = async (options = {}) =>
    ensureAllergenDietConfigGlobals(
      options?.supabaseClient || supabaseClient || null,
    );
  return loadedConfig;
}
