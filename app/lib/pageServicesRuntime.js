import { initIngredientSources } from "./ingredientSources.js";
import { initMobileOverlayZoom } from "../restaurant/runtime/legacy/restaurant/mobile-overlay-zoom.js";
import {
  createQrPromoController,
  deriveQrVisitFlag,
} from "../restaurant/runtime/legacy/restaurant/qr-promo.js";
import { createNavigationRuntime } from "./restaurantNavigationRuntime.js";
import { createOrderRuntime } from "../restaurant/runtime/legacy/restaurant/order-runtime.js";
import {
  createDishCompatibilityEvaluator,
  createTooltipBodyHTML,
} from "../restaurant/runtime/legacy/restaurant/dish-compatibility-tooltip.js";
import { createMobileInfoHelpers, prefersMobileInfo } from "./mobileInfoHelpersRuntime.js";
import { createPageUtilsRuntime } from "./pageUtilsRuntime.js";
import { createPageOffsetRuntime } from "./pageOffsetRuntime.js";
import { createMobileInfoPanelDom } from "../restaurant/runtime/legacy/restaurant/mobile-info-panel-dom.js";
import { createPageCoreRuntime } from "./pageCoreRuntime.js";

export function createPageServicesRuntime({
  state,
  slug,
  allergenConfig,
  normalizeRestaurant,
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
}) {
  const pageUtilsRuntime = createPageUtilsRuntime({ state });
  const getMenuState = pageUtilsRuntime.getMenuState;
  const getIssueReportMeta = pageUtilsRuntime.getIssueReportMeta;
  const resizeLegendToFit = pageUtilsRuntime.resizeLegendToFit;
  pageUtilsRuntime.bindLegendResizeListener();

  const pageOffsetRuntime = createPageOffsetRuntime();
  const updateRootOffset = pageOffsetRuntime.updateRootOffset;
  const setRootOffsetPadding = pageOffsetRuntime.setRootOffsetPadding;

  const pageCoreRuntime = createPageCoreRuntime({
    formatAllergenLabel: allergenConfig?.formatAllergenLabel,
    getTipPinned,
  });

  const {
    esc,
    norm,
    cap,
    formatAllergenLabel,
    setOverlayPulseColor,
    hidePageLoader,
    div,
    configureModalClose,
    isDishInfoPopupOpen,
  } = pageCoreRuntime;

  const mobileInfoPanelDomRuntime = createMobileInfoPanelDom({
    getMobileInfoPanel,
    setMobileInfoPanel,
    adjustMobileInfoPanelForZoom,
  });
  const ensureMobileInfoPanel = mobileInfoPanelDomRuntime.ensureMobileInfoPanel;

  const urlQR = deriveQrVisitFlag();
  const qrPromoRuntime = createQrPromoController({
    state,
    isDishInfoPopupOpen,
  });

  const navigationRuntime = createNavigationRuntime({
    state,
    slug,
    normalizeRestaurant,
    insertChangeLogEntry,
    fetchChangeLogEntries,
    closeQrPromo: qrPromoRuntime.closeQrPromo,
  });
  const send = navigationRuntime.send;

  const orderRuntime = createOrderRuntime({
    state,
    send,
    resizeLegendToFit,
    supabaseClient,
  });
  navigationRuntime.bindQrPromoControls();

  const { renderGroupedSourcesHtml } = initIngredientSources({ esc });

  const normalizeDietLabel =
    typeof allergenConfig?.normalizeDietLabel === "function"
      ? allergenConfig.normalizeDietLabel
      : (diet) => {
          if (!diet) return "";
          const raw = diet.toString().trim();
          if (!DIETS.length) return raw;
          return DIETS.includes(raw) ? raw : "";
        };

  const { mobileCompactBodyHTML, toggleLoveDishInTooltip } =
    createMobileInfoHelpers({
      normalizeAllergen,
      normalizeDietLabel,
      formatAllergenLabel,
      ALLERGEN_EMOJI,
      DIET_EMOJI,
      esc,
    });

  const { computeStatus, hasCrossContamination } =
    createDishCompatibilityEvaluator({
      normalizeAllergen,
      normalizeDietLabel,
      getDietAllergenConflicts,
    });

  const mobileZoomApi = initMobileOverlayZoom({
    state,
    esc,
    getMenuState,
    setOverlayPulseColor,
    mobileCompactBodyHTML,
    ensureAddToOrderConfirmContainer: orderRuntime.ensureAddToOrderConfirmContainer,
    hideAddToOrderConfirmation: orderRuntime.hideAddToOrderConfirmation,
    showAddToOrderConfirmation: orderRuntime.showAddToOrderConfirmation,
    addDishToOrder: orderRuntime.addDishToOrder,
    getDishCompatibilityDetails: orderRuntime.getDishCompatibilityDetails,
    toggleLoveDishInTooltip,
    onZoomChange: ({ isZoomed, item }) => {
      if (typeof onZoomChange === "function") {
        onZoomChange({ isZoomed, item: item || null });
      }
    },
  });

  const tooltipBodyHTML = createTooltipBodyHTML({
    normalizeAllergen,
    normalizeDietLabel,
    getDietAllergenConflicts,
    ALLERGEN_EMOJI,
    DIET_EMOJI,
    formatAllergenLabel,
    esc,
    prefersMobileInfo: () => prefersMobileInfo(),
  });

  return {
    getMenuState,
    getIssueReportMeta,
    resizeLegendToFit,
    updateRootOffset,
    setRootOffsetPadding,
    esc,
    norm,
    cap,
    formatAllergenLabel,
    setOverlayPulseColor,
    hidePageLoader,
    div,
    configureModalClose,
    isDishInfoPopupOpen,
    ensureMobileInfoPanel,
    urlQR,
    shouldShowQrPromo: qrPromoRuntime.shouldShowQrPromo,
    cancelQrPromoTimer: qrPromoRuntime.cancelQrPromoTimer,
    queueQrPromoTimer: qrPromoRuntime.queueQrPromoTimer,
    closeQrPromo: qrPromoRuntime.closeQrPromo,
    send,
    orderRuntime,
    normalizeDietLabel,
    mobileCompactBodyHTML,
    toggleLoveDishInTooltip,
    computeStatus,
    hasCrossContamination,
    zoomToOverlay: mobileZoomApi.zoomToOverlay,
    zoomOutOverlay: mobileZoomApi.zoomOutOverlay,
    tooltipBodyHTML,
    renderGroupedSourcesHtml,
  };
}
