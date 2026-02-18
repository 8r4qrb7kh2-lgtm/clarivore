import { useMemo } from "react";
import { getActiveAllergenDietConfig } from "../../../../lib/allergenConfigRuntime";

// This hook reads runtime allergen/diet configuration and provides safe defaults.
// Returning all config in one place keeps downstream hooks simple and predictable.
export function useDashboardRuntimeConfig() {
  const runtimeConfig = getActiveAllergenDietConfig();

  return useMemo(() => {
    const ALLERGENS = Array.isArray(runtimeConfig.ALLERGENS)
      ? runtimeConfig.ALLERGENS
      : [];
    const DIETS = Array.isArray(runtimeConfig.DIETS) ? runtimeConfig.DIETS : [];
    const ALLERGEN_EMOJI = runtimeConfig.ALLERGEN_EMOJI || {};
    const DIET_EMOJI = runtimeConfig.DIET_EMOJI || {};

    // If runtime did not provide strict normalizers, use permissive fallback logic.
    const normalizeAllergen =
      typeof runtimeConfig.normalizeAllergen === "function"
        ? runtimeConfig.normalizeAllergen
        : (value) => {
            const raw = String(value ?? "").trim();
            if (!raw) return "";
            if (!ALLERGENS.length) return raw;
            return ALLERGENS.includes(raw) ? raw : "";
          };

    const normalizeDietLabel =
      typeof runtimeConfig.normalizeDietLabel === "function"
        ? runtimeConfig.normalizeDietLabel
        : (value) => {
            const raw = String(value ?? "").trim();
            if (!raw) return "";
            if (!DIETS.length) return raw;
            return DIETS.includes(raw) ? raw : "";
          };

    const formatAllergenLabel =
      typeof runtimeConfig.formatAllergenLabel === "function"
        ? runtimeConfig.formatAllergenLabel
        : (value) => String(value || "");

    return {
      ALLERGENS,
      DIETS,
      ALLERGEN_EMOJI,
      DIET_EMOJI,
      normalizeAllergen,
      normalizeDietLabel,
      formatAllergenLabel,
    };
  }, [runtimeConfig]);
}
