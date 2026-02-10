import { createMobileInfoPanelRuntime } from "./mobile-info-panel-runtime.js";
import { createMobileViewerRuntime } from "./mobile-viewer-runtime.js";
import { createTooltipRuntime } from "./tooltip-runtime.js";

export function createOverlayUiRuntime(deps = {}) {
  const state = deps.state || {};
  const esc =
    typeof deps.esc === "function"
      ? deps.esc
      : (value) => String(value ?? "");
  const prefersMobileInfo =
    typeof deps.prefersMobileInfo === "function"
      ? deps.prefersMobileInfo
      : () => false;
  const mobileCompactBodyHTML =
    typeof deps.mobileCompactBodyHTML === "function"
      ? deps.mobileCompactBodyHTML
      : () => "";
  const toggleLoveDishInTooltip =
    typeof deps.toggleLoveDishInTooltip === "function"
      ? deps.toggleLoveDishInTooltip
      : async () => {};
  const ensureAddToOrderConfirmContainer =
    typeof deps.ensureAddToOrderConfirmContainer === "function"
      ? deps.ensureAddToOrderConfirmContainer
      : () => null;
  const hideAddToOrderConfirmation =
    typeof deps.hideAddToOrderConfirmation === "function"
      ? deps.hideAddToOrderConfirmation
      : () => {};
  const showAddToOrderConfirmation =
    typeof deps.showAddToOrderConfirmation === "function"
      ? deps.showAddToOrderConfirmation
      : () => {};
  const addDishToOrder =
    typeof deps.addDishToOrder === "function" ? deps.addDishToOrder : () => ({});
  const getDishCompatibilityDetails =
    typeof deps.getDishCompatibilityDetails === "function"
      ? deps.getDishCompatibilityDetails
      : () => ({ issues: {} });
  const ensureMobileInfoPanel =
    typeof deps.ensureMobileInfoPanel === "function"
      ? deps.ensureMobileInfoPanel
      : () => null;
  const getMobileInfoPanel =
    typeof deps.getMobileInfoPanel === "function"
      ? deps.getMobileInfoPanel
      : () => null;
  const getCurrentMobileInfoItem =
    typeof deps.getCurrentMobileInfoItem === "function"
      ? deps.getCurrentMobileInfoItem
      : () => null;
  const setCurrentMobileInfoItem =
    typeof deps.setCurrentMobileInfoItem === "function"
      ? deps.setCurrentMobileInfoItem
      : () => {};
  const getIsOverlayZoomed =
    typeof deps.getIsOverlayZoomed === "function"
      ? deps.getIsOverlayZoomed
      : () => false;
  const adjustMobileInfoPanelForZoom =
    typeof deps.adjustMobileInfoPanelForZoom === "function"
      ? deps.adjustMobileInfoPanelForZoom
      : () => {};
  const setOverlayPulseColor =
    typeof deps.setOverlayPulseColor === "function"
      ? deps.setOverlayPulseColor
      : () => {};
  const normalizeAllergen =
    typeof deps.normalizeAllergen === "function"
      ? deps.normalizeAllergen
      : (value) => String(value ?? "").trim();
  const ALLERGEN_EMOJI =
    deps.ALLERGEN_EMOJI && typeof deps.ALLERGEN_EMOJI === "object"
      ? deps.ALLERGEN_EMOJI
      : {};
  const DIET_EMOJI =
    deps.DIET_EMOJI && typeof deps.DIET_EMOJI === "object" ? deps.DIET_EMOJI : {};
  const formatAllergenLabel =
    typeof deps.formatAllergenLabel === "function"
      ? deps.formatAllergenLabel
      : (value) => String(value ?? "");
  const getMenuState =
    typeof deps.getMenuState === "function" ? deps.getMenuState : () => ({});

  const pageTip = document.getElementById("tip");
  const tooltipRuntime = createTooltipRuntime({
    pageTip,
    state,
    esc,
    toggleLoveDishInTooltip,
    ensureAddToOrderConfirmContainer,
    hideAddToOrderConfirmation,
    showAddToOrderConfirmation,
    addDishToOrder,
    getDishCompatibilityDetails,
    setOverlayPulseColor,
  });

  const mobileInfoPanelRuntime = createMobileInfoPanelRuntime({
    state,
    esc,
    prefersMobileInfo,
    mobileCompactBodyHTML,
    toggleLoveDishInTooltip,
    ensureAddToOrderConfirmContainer,
    hideAddToOrderConfirmation,
    showAddToOrderConfirmation,
    addDishToOrder,
    getDishCompatibilityDetails,
    ensureMobileInfoPanel,
    getMobileInfoPanel,
    getCurrentMobileInfoItem,
    setCurrentMobileInfoItem,
    getIsOverlayZoomed,
    adjustMobileInfoPanelForZoom,
    hideTip: () => tooltipRuntime.hideTip(),
  });

  const renderMobileInfo = mobileInfoPanelRuntime.renderMobileInfo;
  const syncMobileInfoPanel = mobileInfoPanelRuntime.syncMobileInfoPanel;
  mobileInfoPanelRuntime.bindSyncListeners();
  ensureMobileInfoPanel();

  const mobileViewerRuntime = createMobileViewerRuntime({
    state,
    normalizeAllergen,
    ALLERGEN_EMOJI,
    DIET_EMOJI,
    esc,
    formatAllergenLabel,
    getMenuState,
    setOverlayPulseColor,
    prefersMobileInfo,
    getCurrentMobileInfoItem,
    setCurrentMobileInfoItem,
    getMobileInfoPanel,
    getRenderMobileInfo: () => renderMobileInfo,
  });

  return {
    pageTip,
    showTipIn: tooltipRuntime.showTipIn,
    hideTip: tooltipRuntime.hideTip,
    getTipPinned: tooltipRuntime.getTipPinned,
    getPinnedOverlayItem: tooltipRuntime.getPinnedOverlayItem,
    renderMobileInfo,
    syncMobileInfoPanel,
    captureMenuBaseDimensions: mobileViewerRuntime.captureMenuBaseDimensions,
    ensureMobileViewerChrome: mobileViewerRuntime.ensureMobileViewerChrome,
    updateZoomIndicator: mobileViewerRuntime.updateZoomIndicator,
    updateFullScreenAllergySummary:
      mobileViewerRuntime.updateFullScreenAllergySummary,
    setMobileZoom: mobileViewerRuntime.setMobileZoom,
    resetMobileZoom: mobileViewerRuntime.resetMobileZoom,
    openMobileViewer: mobileViewerRuntime.openMobileViewer,
    closeMobileViewer: mobileViewerRuntime.closeMobileViewer,
    getMobileZoomLevel: mobileViewerRuntime.getMobileZoomLevel,
  };
}
