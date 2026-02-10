import { createPageServicesRuntime } from "../../lib/pageServicesRuntime.js";
import { createDishEditorRuntime } from "../../lib/restaurantRuntime/dish-editor-runtime.js";
import { normalizeRestaurantRow } from "../../lib/restaurantNormalization.js";

function adjustMobileInfoPanelForZoom() {
  // No longer needed since pinch-to-zoom is disabled.
}

export function createRestaurantRuntimeCore(options = {}) {
  const {
    state,
    slug,
    allergenConfig,
    insertChangeLogEntry,
    fetchChangeLogEntries,
    getTipPinned,
    getMobileInfoPanel,
    setMobileInfoPanel,
    onZoomChange,
    normalizeAllergen,
    normalizeDietLabel,
    getDietAllergenConflicts,
    ALLERGENS,
    DIETS,
    ALLERGEN_EMOJI,
    DIET_EMOJI,
    supabaseClient,
    getSupabaseKey,
    getAiAssistEndpoint,
    current,
  } = options;

  const pageServicesRuntime = createPageServicesRuntime({
    state,
    slug,
    allergenConfig,
    normalizeRestaurant: (row) => normalizeRestaurantRow(row, {
      normalizeAllergen,
      normalizeDietLabel,
    }),
    insertChangeLogEntry,
    fetchChangeLogEntries,
    adjustMobileInfoPanelForZoom,
    getTipPinned,
    getMobileInfoPanel,
    setMobileInfoPanel,
    onZoomChange,
    normalizeAllergen,
    getDietAllergenConflicts,
    ALLERGENS,
    DIETS,
    ALLERGEN_EMOJI,
    DIET_EMOJI,
    supabaseClient,
  });

  const normalizeRestaurant = (row) =>
    normalizeRestaurantRow(row, {
      normalizeAllergen,
      normalizeDietLabel: pageServicesRuntime.normalizeDietLabel,
    });

  const dishEditorRuntime = createDishEditorRuntime({
    esc: pageServicesRuntime.esc,
    state,
    normalizeDietLabel: pageServicesRuntime.normalizeDietLabel,
    normalizeAllergen,
    formatAllergenLabel: pageServicesRuntime.formatAllergenLabel,
    getDietAllergenConflicts,
    getIssueReportMeta: pageServicesRuntime.getIssueReportMeta,
    ALLERGENS,
    ALLERGEN_EMOJI,
    DIETS,
    DIET_EMOJI,
    cap: pageServicesRuntime.cap,
    norm: pageServicesRuntime.norm,
    tooltipBodyHTML: pageServicesRuntime.tooltipBodyHTML,
    send: pageServicesRuntime.send,
    getSupabaseKey:
      typeof getSupabaseKey === "function" ? getSupabaseKey : () => "",
    getAiAssistEndpoint:
      typeof getAiAssistEndpoint === "function" ? getAiAssistEndpoint : () => null,
    current,
  });

  return {
    pageServicesRuntime,
    orderFlow: pageServicesRuntime.orderRuntime.orderFlow,
    dishEditorRuntime,
    normalizeRestaurant,
    adjustMobileInfoPanelForZoom,
  };
}
