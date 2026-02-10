import { createHowItWorksTour } from "./how-it-works-tour.js";
import { initRestaurantFilters } from "./restaurant-filters.js";
import { renderRestaurantCardsPage } from "./restaurant-cards-page.js";
import { renderRestaurantScreen } from "./restaurant-screen.js";
import { createMenuDrawRuntime } from "./menu-draw-runtime.js";
import { createDishInteractionTracker } from "./menu-dish-tracking.js";
import { createMenuOverlayRuntime } from "./menu-overlays.js";
import { bindMenuOverlayListeners } from "./menu-overlay-listeners.js";
import { initializeMenuLayout } from "./menu-layout.js";
import { setupMenuPinchZoom } from "./menu-pinch-zoom.js";

export function createRestaurantViewRuntime(deps = {}) {
  const state = deps.state || {};
  const renderTopbar =
    typeof deps.renderTopbar === "function" ? deps.renderTopbar : () => {};
  const div = typeof deps.div === "function" ? deps.div : () => document.createElement("div");
  const esc =
    typeof deps.esc === "function"
      ? deps.esc
      : (value) => String(value ?? "");
  const send = typeof deps.send === "function" ? deps.send : () => {};
  const getWeeksAgoInfo =
    typeof deps.getWeeksAgoInfo === "function" ? deps.getWeeksAgoInfo : () => "";
  const resizeLegendToFit =
    typeof deps.resizeLegendToFit === "function" ? deps.resizeLegendToFit : () => {};
  const normalizeAllergen =
    typeof deps.normalizeAllergen === "function"
      ? deps.normalizeAllergen
      : (value) => String(value ?? "").trim();
  const normalizeDietLabel =
    typeof deps.normalizeDietLabel === "function"
      ? deps.normalizeDietLabel
      : (value) => String(value ?? "").trim();
  const formatAllergenLabel =
    typeof deps.formatAllergenLabel === "function"
      ? deps.formatAllergenLabel
      : (value) => String(value ?? "");
  const ALLERGENS = Array.isArray(deps.ALLERGENS) ? deps.ALLERGENS : [];
  const DIETS = Array.isArray(deps.DIETS) ? deps.DIETS : [];
  const ALLERGEN_EMOJI =
    deps.ALLERGEN_EMOJI && typeof deps.ALLERGEN_EMOJI === "object"
      ? deps.ALLERGEN_EMOJI
      : {};
  const DIET_EMOJI =
    deps.DIET_EMOJI && typeof deps.DIET_EMOJI === "object" ? deps.DIET_EMOJI : {};
  const prefersMobileInfo =
    typeof deps.prefersMobileInfo === "function"
      ? deps.prefersMobileInfo
      : () => false;
  const renderMobileInfo =
    typeof deps.renderMobileInfo === "function" ? deps.renderMobileInfo : () => {};
  const getCurrentMobileInfoItem =
    typeof deps.getCurrentMobileInfoItem === "function"
      ? deps.getCurrentMobileInfoItem
      : () => null;
  const updateFullScreenAllergySummary =
    typeof deps.updateFullScreenAllergySummary === "function"
      ? deps.updateFullScreenAllergySummary
      : () => {};
  const updateOrderSidebar =
    typeof deps.updateOrderSidebar === "function" ? deps.updateOrderSidebar : () => {};
  const openOrderSidebar =
    typeof deps.openOrderSidebar === "function" ? deps.openOrderSidebar : () => {};
  const getMenuState =
    typeof deps.getMenuState === "function" ? deps.getMenuState : () => ({});
  const ensureMobileViewerChrome =
    typeof deps.ensureMobileViewerChrome === "function"
      ? deps.ensureMobileViewerChrome
      : () => null;
  const updateZoomIndicator =
    typeof deps.updateZoomIndicator === "function" ? deps.updateZoomIndicator : () => {};
  const supabaseClient = deps.supabaseClient || null;
  const ensureMobileInfoPanel =
    typeof deps.ensureMobileInfoPanel === "function"
      ? deps.ensureMobileInfoPanel
      : () => null;
  const getIsOverlayZoomed =
    typeof deps.getIsOverlayZoomed === "function"
      ? deps.getIsOverlayZoomed
      : () => false;
  const getZoomedOverlayItem =
    typeof deps.getZoomedOverlayItem === "function"
      ? deps.getZoomedOverlayItem
      : () => null;
  const zoomOutOverlay =
    typeof deps.zoomOutOverlay === "function" ? deps.zoomOutOverlay : () => {};
  const hideTip = typeof deps.hideTip === "function" ? deps.hideTip : () => {};
  const zoomToOverlay =
    typeof deps.zoomToOverlay === "function" ? deps.zoomToOverlay : () => {};
  const getMobileInfoPanel =
    typeof deps.getMobileInfoPanel === "function"
      ? deps.getMobileInfoPanel
      : () => null;
  const clearCurrentMobileInfoItem =
    typeof deps.clearCurrentMobileInfoItem === "function"
      ? deps.clearCurrentMobileInfoItem
      : () => {};
  const showTipIn =
    typeof deps.showTipIn === "function" ? deps.showTipIn : () => {};
  const pageTip = deps.pageTip || null;
  const tooltipBodyHTML =
    typeof deps.tooltipBodyHTML === "function" ? deps.tooltipBodyHTML : () => "";
  const getTipPinned =
    typeof deps.getTipPinned === "function" ? deps.getTipPinned : () => false;
  const getPinnedOverlayItem =
    typeof deps.getPinnedOverlayItem === "function"
      ? deps.getPinnedOverlayItem
      : () => null;
  const setOverlayPulseColor =
    typeof deps.setOverlayPulseColor === "function"
      ? deps.setOverlayPulseColor
      : () => {};
  const hasCrossContamination =
    typeof deps.hasCrossContamination === "function"
      ? deps.hasCrossContamination
      : () => false;
  const computeStatus =
    typeof deps.computeStatus === "function" ? deps.computeStatus : () => "neutral";
  const captureMenuBaseDimensions =
    typeof deps.captureMenuBaseDimensions === "function"
      ? deps.captureMenuBaseDimensions
      : () => {};
  const setMobileZoom =
    typeof deps.setMobileZoom === "function" ? deps.setMobileZoom : () => {};
  const getMobileZoomLevel =
    typeof deps.getMobileZoomLevel === "function"
      ? deps.getMobileZoomLevel
      : () => 1;
  const orderFlow = deps.orderFlow || {};
  const TABLET_ORDER_STATUSES =
    deps.TABLET_ORDER_STATUSES && typeof deps.TABLET_ORDER_STATUSES === "object"
      ? deps.TABLET_ORDER_STATUSES
      : {};
  const setRootOffsetPadding =
    typeof deps.setRootOffsetPadding === "function"
      ? deps.setRootOffsetPadding
      : () => {};
  const mountRestaurantShell =
    typeof deps.mountRestaurantShell === "function"
      ? deps.mountRestaurantShell
      : () => {};
  const applyRestaurantShellState =
    typeof deps.applyRestaurantShellState === "function"
      ? deps.applyRestaurantShellState
      : () => {};
  const fmtDate = typeof deps.fmtDate === "function" ? deps.fmtDate : () => "";
  const initGuestFilterControls =
    typeof deps.initGuestFilterControls === "function"
      ? deps.initGuestFilterControls
      : () => {};
  const showRestaurantMenuSurface =
    typeof deps.showRestaurantMenuSurface === "function"
      ? deps.showRestaurantMenuSurface
      : () => {};
  const urlQR = deps.urlQR || false;
  const shouldShowQrPromo =
    typeof deps.shouldShowQrPromo === "function" ? deps.shouldShowQrPromo : () => false;
  const queueQrPromoTimer =
    typeof deps.queueQrPromoTimer === "function" ? deps.queueQrPromoTimer : () => {};
  const cancelQrPromoTimer =
    typeof deps.cancelQrPromoTimer === "function" ? deps.cancelQrPromoTimer : () => {};
  const bindSavedPreferenceButtons =
    typeof deps.bindSavedPreferenceButtons === "function"
      ? deps.bindSavedPreferenceButtons
      : () => {};
  const bindRestaurantActionButtons =
    typeof deps.bindRestaurantActionButtons === "function"
      ? deps.bindRestaurantActionButtons
      : () => {};
  const openFeedbackModal =
    typeof deps.openFeedbackModal === "function" ? deps.openFeedbackModal : () => {};
  const openReportIssueModal =
    typeof deps.openReportIssueModal === "function"
      ? deps.openReportIssueModal
      : () => {};
  const openMobileViewer =
    typeof deps.openMobileViewer === "function" ? deps.openMobileViewer : () => {};

  const renderCardsPage = () =>
    renderRestaurantCardsPage({
      state,
      renderTopbar,
      root: document.getElementById("root"),
      div,
      esc,
      send,
      getWeeksAgoInfo,
    });

  const {
    renderSavedChips,
    renderSavedDiets,
    renderSelectedChips,
    renderSelectedDiets,
    renderSelector,
    renderDietSelector,
  } = initRestaurantFilters({
    state,
    normalizeAllergen,
    normalizeDietLabel,
    formatAllergenLabel,
    ALLERGENS,
    DIETS,
    ALLERGEN_EMOJI,
    DIET_EMOJI,
    div,
    esc,
    send,
    prefersMobileInfo,
    renderMobileInfo,
    getCurrentMobileInfoItem,
    updateFullScreenAllergySummary,
    rerenderLayer: () => {
      if (window.__rerenderLayer__) window.__rerenderLayer__();
    },
  });

  const howItWorksTour = createHowItWorksTour({
    state,
    renderSelector,
    renderDietSelector,
    updateOrderSidebar,
    openOrderSidebar,
    rerenderLayer: () => {
      if (window.__rerenderLayer__) window.__rerenderLayer__();
    },
  });

  const menuDrawRuntime = createMenuDrawRuntime({
    state,
    div,
    getMenuState,
    initializeMenuLayout,
    ensureMobileViewerChrome,
    updateZoomIndicator,
    setupMenuPinchZoom,
    createDishInteractionTracker,
    normalizeAllergen,
    normalizeDietLabel,
    supabaseClient,
    createMenuOverlayRuntime,
    ensureMobileInfoPanel,
    prefersMobileInfo,
    getIsOverlayZoomed,
    getZoomedOverlayItem,
    zoomOutOverlay,
    hideTip,
    zoomToOverlay,
    getMobileInfoPanel,
    clearCurrentMobileInfoItem,
    showTipIn,
    pageTip,
    tooltipBodyHTML,
    getTipPinned,
    getPinnedOverlayItem,
    setOverlayPulseColor,
    hasCrossContamination,
    computeStatus,
    captureMenuBaseDimensions,
    setMobileZoom,
    getMobileZoomLevel,
    bindMenuOverlayListeners,
  });
  const drawMenu = menuDrawRuntime.drawMenu;

  const renderRestaurant = () =>
    renderRestaurantScreen({
      state,
      orderFlow,
      TABLET_ORDER_STATUSES,
      renderTopbar,
      setRootOffsetPadding,
      mountRestaurantShell,
      applyRestaurantShellState,
      esc,
      fmtDate,
      initGuestFilterControls,
      renderSelector,
      renderSelectedChips,
      renderSavedChips,
      renderDietSelector,
      renderSelectedDiets,
      renderSavedDiets,
      showRestaurantMenuSurface,
      drawMenu,
      resizeLegendToFit,
      getMenuState,
      ensureMobileViewerChrome,
      updateZoomIndicator,
      prefersMobileInfo,
      openMobileViewer,
      send,
      urlQR,
      shouldShowQrPromo,
      queueQrPromoTimer,
      cancelQrPromoTimer,
      bindSavedPreferenceButtons,
      bindRestaurantActionButtons,
      openFeedbackModal,
      openReportIssueModal,
      ensureMobileInfoPanel,
      clearCurrentMobileInfoItem,
    });

  return {
    renderCardsPage,
    renderRestaurant,
    drawMenu,
    renderSavedChips,
    renderSavedDiets,
    renderSelectedChips,
    renderSelectedDiets,
    renderSelector,
    renderDietSelector,
    maybeInitHowItWorksTour: howItWorksTour.maybeInitHowItWorksTour,
  };
}
