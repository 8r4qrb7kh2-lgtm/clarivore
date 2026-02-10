import {
  buildAllergenDietConfig,
  loadAllergenDietConfig,
} from "./allergenConfig";

let browserConfigPromise = null;

function toLoadedConfig(config) {
  return {
    ...buildAllergenDietConfig(),
    ...(config || {}),
    _loaded: true,
  };
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
      const resolvedClient = supabaseClient || window.supabaseClient || null;
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
