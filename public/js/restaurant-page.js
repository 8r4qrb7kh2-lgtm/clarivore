// --- DEBUG STUBS (Global) ---
const ENABLE_CONSOLE_REPORTING =
  typeof window !== "undefined" && window.__enableConsoleReporting === true;
const noop = () => {};
if (!ENABLE_CONSOLE_REPORTING && typeof console !== "undefined") {
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  window.logDebug = noop;
  window.setDebugJson = noop;
} else {
  // Provide stub implementations for debug functions that may be called elsewhere
  window.logDebug = window.logDebug || ((msg) => console.log("[DEBUG]", msg));
  window.setDebugJson =
    window.setDebugJson ||
    ((data, title) => console.log("[DEBUG-JSON]", title, data));
}

import { ORDER_STATUSES as TabletOrderStatusesConst } from "./tablet-simulation-logic.mjs";
import { setupTopbar } from "./shared-nav.js";
import { createHowItWorksTour } from "./restaurant/how-it-works-tour.js";
import { initOrderFlow } from "./restaurant/order-flow.js";
import { initUnsavedChangesGuard } from "./restaurant/unsaved-changes.js";
import { initAutoOpenDish } from "./restaurant/auto-open-dish.js";
import { initIngredientSources } from "./restaurant/ingredient-sources.js";
import { initFeedbackModals } from "./restaurant/feedback-modals.js";
import { initDinerNotifications } from "./diner-notifications.js";
import {
  analyzeBoxSizes,
  splitImageIntoSections,
} from "./restaurant/menu-image-utils.js";
import { detectDishesOnMenu } from "./restaurant/menu-dish-detection.js";
import { initBrandVerification } from "./restaurant/brand-verification.js";
import { initChangeLog } from "./restaurant/change-log.js";
import { initEditorOverlays } from "./restaurant/editor-overlays.js";
import { initMenuImageEditor } from "./restaurant/menu-images.js";
import { initEditorNavigation } from "./restaurant/editor-navigation.js";
import { initEditorSections } from "./restaurant/editor-sections.js";
import { initEditorHistory } from "./restaurant/editor-history.js";
import { initEditorSettings } from "./restaurant/editor-settings.js";
import { initEditorSaveFlow } from "./restaurant/editor-save.js";
import { mountEditorShell } from "./restaurant/editor-shell-markup.js";
import { initOrderConfirmRestore } from "./restaurant/order-confirm-restore.js";
import { initMobileOverlayZoom } from "./restaurant/mobile-overlay-zoom.js";
import {
  applyRestaurantShellState,
  mountRestaurantShell,
} from "./restaurant/restaurant-shell-markup.js";
import { mountReportShell } from "./restaurant/report-shell-markup.js";
import {
  bindRestaurantActionButtons,
  bindSavedPreferenceButtons,
  initGuestFilterControls,
  showRestaurantMenuSurface,
} from "./restaurant/restaurant-view.js";
import { bindEditorBackButton } from "./restaurant/editor-exit.js";
import { bindDetectDishesButton } from "./restaurant/editor-dish-detection.js";
import { bindEditorToolbarScale } from "./restaurant/editor-toolbar.js";
import { bindEditorHistoryControls } from "./restaurant/editor-history-controls.js";
import { openPendingDishInEditor } from "./restaurant/editor-pending-dish.js";
import { createEditorItemEditor } from "./restaurant/editor-item-editor.js";
import { createEditorLastConfirmedUpdater } from "./restaurant/editor-last-confirmed.js";
import { bindEditorRuntimeBindings } from "./restaurant/editor-runtime-bindings.js";
import { createEditorRenderer } from "./restaurant/editor-screen.js";
import {
  initializeEditorAssets,
  createDirtyController,
  createEditorChangeState,
  applyPendingMenuIndexRemap,
} from "./restaurant/editor-session.js";
import { createRestaurantMessageHandler } from "./restaurant/restaurant-message.js";
import { initRestaurantFilters } from "./restaurant/restaurant-filters.js";
import { initRestaurantTopbar } from "./restaurant/restaurant-topbar.js";
import { renderRestaurantCardsPage } from "./restaurant/restaurant-cards-page.js";
import { renderRestaurantScreen } from "./restaurant/restaurant-screen.js";
import {
  createQrPromoController,
  deriveQrVisitFlag,
} from "./restaurant/qr-promo.js";
import { renderRestaurantReportPage } from "./restaurant/restaurant-report-page.js";
import { setupMenuPinchZoom } from "./restaurant/menu-pinch-zoom.js";
import { createDishInteractionTracker } from "./restaurant/menu-dish-tracking.js";
import { createMenuOverlayRuntime } from "./restaurant/menu-overlays.js";
import { bindMenuOverlayListeners } from "./restaurant/menu-overlay-listeners.js";
import { initializeMenuLayout } from "./restaurant/menu-layout.js";
import {
  fetchChangeLogEntries,
  insertChangeLogEntry,
} from "./restaurant/change-log-service.js";
import { createNavigationRuntime } from "./restaurant/navigation-runtime.js";
import {
  createDishCompatibilityEvaluator,
  createTooltipBodyHTML,
} from "./restaurant/dish-compatibility-tooltip.js";
import { normalizeRestaurantRow } from "./restaurant/restaurant-normalization.js";
import {
  createMobileInfoHelpers,
  prefersMobileInfo,
} from "./restaurant/mobile-info-helpers.js";
import { createMobileInfoPanelRuntime } from "./restaurant/mobile-info-panel-runtime.js";
import { createTooltipRuntime } from "./restaurant/tooltip-runtime.js";
import { createMobileViewerRuntime } from "./restaurant/mobile-viewer-runtime.js";
import { createMenuDrawRuntime } from "./restaurant/menu-draw-runtime.js";
import { createPageRouterRuntime } from "./restaurant/page-router-runtime.js";
import { createBootHydrationRuntime } from "./restaurant/boot-hydration-runtime.js";
import { createPageUtilsRuntime } from "./restaurant/page-utils-runtime.js";
import { createPageOffsetRuntime } from "./restaurant/page-offset-runtime.js";
import { createMobileInfoPanelDom } from "./restaurant/mobile-info-panel-dom.js";
import { createDishEditorRuntime } from "./restaurant/dish-editor-runtime.js";
import {
  fmtDate,
  fmtDateTime,
  getWeeksAgoInfo,
} from "./restaurant/time-formatting.js";

// Shim globals for module scope
const logDebug = window.logDebug || noop;
const setDebugJson = window.setDebugJson || noop;

const TABLET_ORDER_STATUSES = TabletOrderStatusesConst ?? {
  DRAFT: "draft",
  CODE_ASSIGNED: "awaiting_user_submission",
  SUBMITTED_TO_SERVER: "awaiting_server_approval",
  QUEUED_FOR_KITCHEN: "queued_for_kitchen",
  WITH_KITCHEN: "with_kitchen",
  ACKNOWLEDGED: "acknowledged",
  AWAITING_USER_RESPONSE: "awaiting_user_response",
  QUESTION_ANSWERED: "question_answered",
  REJECTED_BY_SERVER: "rejected_by_server",
  RESCINDED_BY_DINER: "rescinded_by_diner",
  REJECTED_BY_KITCHEN: "rejected_by_kitchen",
};

// Ensure zoom is always allowed on mobile Safari
(function () {
  var m = document.querySelector('meta[name="viewport"]');
  if (m && !/maximum-scale/i.test(m.content)) {
    m.content += ", user-scalable=yes, maximum-scale=10";
  }
  ["touchstart", "touchmove"].forEach(function (t) {
    document.addEventListener(t, function () {}, { passive: true });
  });
})();

const allergenConfig = window.loadAllergenDietConfig
  ? await window.loadAllergenDietConfig()
  : (window.ALLERGEN_DIET_CONFIG || {});
const ALLERGENS = Array.isArray(allergenConfig.ALLERGENS)
  ? allergenConfig.ALLERGENS
  : [];
const DIETS = Array.isArray(allergenConfig.DIETS) ? allergenConfig.DIETS : [];

let openBrandIdentificationChoice = () => {};
let showIngredientPhotoUploadModal = () => {};
let showPhotoAnalysisLoadingInRow = () => {};
let hidePhotoAnalysisLoadingInRow = () => {};
let updatePhotoAnalysisLoadingStatus = () => {};
let showPhotoAnalysisResultButton = () => {};
let collectAllBrandItems = null;
let openBrandVerification = () => {};
let openChangeLog = () => {};
let updateLastConfirmedText = () => {};
let openFeedbackModal = () => {};
let openReportIssueModal = () => {};
let rebuildBrandMemoryFromRestaurant = () => {};
let aiAssistState = null;
let aiAssistSetStatus = () => {};
let ensureAiAssistElements = () => {};
let collectAiTableData = () => [];
let renderAiTable = () => {};
let openDishEditor = () => {};
let handleDishEditorResult = () => {};
let handleDishEditorError = () => {};
let getAiAssistBackdrop = () => null;
let getAiAssistTableBody = () => null;
const ALLERGEN_EMOJI =
  allergenConfig.ALLERGEN_EMOJI &&
  typeof allergenConfig.ALLERGEN_EMOJI === "object"
    ? allergenConfig.ALLERGEN_EMOJI
    : {};
const DIET_EMOJI =
  allergenConfig.DIET_EMOJI && typeof allergenConfig.DIET_EMOJI === "object"
    ? allergenConfig.DIET_EMOJI
    : {};
const normalizeAllergen =
  typeof allergenConfig.normalizeAllergen === "function"
    ? allergenConfig.normalizeAllergen
    : (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) return "";
        if (!ALLERGENS.length) return raw;
        return ALLERGENS.includes(raw) ? raw : "";
      };
const getDietAllergenConflicts =
  typeof allergenConfig.getDietAllergenConflicts === "function"
    ? allergenConfig.getDietAllergenConflicts
    : () => [];
const state = {
  page: null,
  restaurants: [],
  restaurant: null,
  allergies: [],
  diets: [],
  ack: false,
  user: { loggedIn: false },
  canEdit: false,
  qr: false,
  _hydrated: false,
  aiAssistEndpoint: null,
  isHowItWorks: false,
  guestFilterEditing: false,
};
let maybeInitHowItWorksTour = () => {};
let hasUnsavedChanges = () => false;
let showUnsavedChangesModal = () => {};
let editorSaveApi = null;
let navigateWithCheck = (url) => {
  window.location.href = url;
};
window.lovedDishesSet = window.lovedDishesSet || new Set();
window.orderItems = window.orderItems || [];
window.orderItemSelections = window.orderItemSelections || new Set();

let mobileInfoPanel = null;
let currentMobileInfoItem = null;
let ensureMobileInfoPanel = () => null;
let renderMobileInfo = () => {};
let syncMobileInfoPanel = () => {};
let captureMenuBaseDimensions = () => {};
let ensureMobileViewerChrome = () => null;
let updateZoomIndicator = () => {};
let updateFullScreenAllergySummary = () => {};
let setMobileZoom = () => {};
let resetMobileZoom = () => {};
let openMobileViewer = () => {};
let closeMobileViewer = () => {};
let getMobileZoomLevel = () => 1;
let drawMenu = () => {};
let render = () => {};
let applyRestaurantBootPayload = () => {};
let getMenuState = () => ({});
let getIssueReportMeta = () => ({
  pageUrl: "",
  userEmail: null,
  reporterName: null,
  accountName: null,
  accountId: null,
});
let resizeLegendToFit = () => {};
let updateRootOffset = () => {};
let setRootOffsetPadding = () => {};
let send = () => {};

let zoomToOverlay = () => {};
let zoomOutOverlay = () => {};
let isOverlayZoomed = false;
let zoomedOverlayItem = null;
let showTipIn = () => {};
let hideTip = () => {};
let getTipPinned = () => false;
let getPinnedOverlayItem = () => null;

function adjustMobileInfoPanelForZoom() {
  // No longer needed since pinch-to-zoom is disabled
  // Keeping function for compatibility
}

const urlQR = deriveQrVisitFlag();

function isDishInfoPopupOpen() {
  // Check if mobile info panel is showing
  const mobilePanel = document.getElementById("mobileInfoPanel");
  if (mobilePanel && mobilePanel.classList.contains("show")) return true;
  // Check if desktop tooltip is pinned open
  if (getTipPinned()) return true;
  return false;
}
const {
  shouldShowQrPromo,
  cancelQrPromoTimer,
  queueQrPromoTimer,
  closeQrPromo,
} = createQrPromoController({
  state,
  isDishInfoPopupOpen,
});

const navigationRuntime = createNavigationRuntime({
  state,
  slug,
  normalizeRestaurant,
  insertChangeLogEntry,
  fetchChangeLogEntries,
  closeQrPromo,
});
send = navigationRuntime.send;

const orderFlow = initOrderFlow({
  state,
  send,
  resizeLegendToFit,
  supabaseClient: window.supabaseClient,
});
const {
  applyDefaultUserName,
  rerenderOrderConfirmDetails,
  renderOrderSidebarStatus,
  persistTabletStateSnapshot,
  ensureAddToOrderConfirmContainer,
  showAddToOrderConfirmation,
  hideAddToOrderConfirmation,
  addDishToOrder,
  getDishCompatibilityDetails,
  restoreOrderFormState,
  updateOrderSidebar,
  updateOrderSidebarBadge,
  getOrderFormStateStorageKey,
  openOrderSidebar,
  setOrderSidebarVisibility,
  restoreOrderItems,
  clearOrderItemSelections,
  persistOrderItems,
  stopOrderRefresh,
  checkForActiveOrders,
  openOrderConfirmDrawer,
  renderOrderConfirm,
  getTabletOrderById,
  getTabletOrder,
  confirmOrder,
  checkUserAuth,
  updateOrderConfirmAuthState,
  initOrderSidebar,
} = orderFlow;
navigationRuntime.bindQrPromoControls();
const esc = (s) =>
  (s ?? "").toString().replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[m],
  );
const norm = (value) => String(value ?? "").toLowerCase().trim();
const cap = (s) =>
  (s || "")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
const formatAllergenLabel =
  typeof allergenConfig.formatAllergenLabel === "function"
    ? allergenConfig.formatAllergenLabel
    : (value) => cap(value);

const setOverlayPulseColor = (overlayElement) => {
  if (!overlayElement) return;

  const borderColor = getComputedStyle(overlayElement).borderColor || "";
  const match = borderColor.match(/rgba?\(([^)]+)\)/i);
  if (match) {
    const rgbParts = match[1]
      .split(",")
      .slice(0, 3)
      .map((value) => Math.round(parseFloat(value.trim())))
      .filter((value) => Number.isFinite(value));

    if (rgbParts.length === 3) {
      overlayElement.style.setProperty("--pulse-rgb", rgbParts.join(", "));
    }
  }

  overlayElement.style.zIndex = "1010";
};
window.setOverlayPulseColor = setOverlayPulseColor;

function hidePageLoader() {
  const loader = document.getElementById("pageLoader");
  if (!loader) return;
  loader.classList.add("hidden");
  window.setTimeout(() => {
    loader.remove();
  }, 400);
}

const pageUtilsRuntime = createPageUtilsRuntime({ state });
getMenuState = pageUtilsRuntime.getMenuState;
getIssueReportMeta = pageUtilsRuntime.getIssueReportMeta;
resizeLegendToFit = pageUtilsRuntime.resizeLegendToFit;
pageUtilsRuntime.bindLegendResizeListener();
const pageOffsetRuntime = createPageOffsetRuntime();
updateRootOffset = pageOffsetRuntime.updateRootOffset;
setRootOffsetPadding = pageOffsetRuntime.setRootOffsetPadding;
const mobileInfoPanelDomRuntime = createMobileInfoPanelDom({
  getMobileInfoPanel: () => mobileInfoPanel,
  setMobileInfoPanel: (panel) => {
    mobileInfoPanel = panel;
  },
  adjustMobileInfoPanelForZoom,
});
ensureMobileInfoPanel = mobileInfoPanelDomRuntime.ensureMobileInfoPanel;

const { renderGroupedSourcesHtml } = initIngredientSources({ esc });
const normalizeDietLabel =
  typeof allergenConfig.normalizeDietLabel === "function"
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
  ensureAddToOrderConfirmContainer,
  hideAddToOrderConfirmation,
  showAddToOrderConfirmation,
  addDishToOrder,
  getDishCompatibilityDetails,
  toggleLoveDishInTooltip,
  onZoomChange: ({ isZoomed, item }) => {
    isOverlayZoomed = isZoomed;
    zoomedOverlayItem = item || null;
  },
});
zoomToOverlay = mobileZoomApi.zoomToOverlay;
zoomOutOverlay = mobileZoomApi.zoomOutOverlay;
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

const dishEditorRuntime = createDishEditorRuntime({
  esc,
  state,
  normalizeDietLabel,
  normalizeAllergen,
  formatAllergenLabel,
  getDietAllergenConflicts,
  getIssueReportMeta,
  ALLERGENS,
  ALLERGEN_EMOJI,
  DIETS,
  DIET_EMOJI,
  cap,
  norm,
  tooltipBodyHTML,
  send,
  current: {
    openBrandIdentificationChoice,
    showIngredientPhotoUploadModal,
    showPhotoAnalysisLoadingInRow,
    hidePhotoAnalysisLoadingInRow,
    updatePhotoAnalysisLoadingStatus,
    showPhotoAnalysisResultButton,
    aiAssistState,
    aiAssistSetStatus,
    ensureAiAssistElements,
    collectAiTableData,
    renderAiTable,
    openDishEditor,
    handleDishEditorResult,
    handleDishEditorError,
    rebuildBrandMemoryFromRestaurant,
    getAiAssistBackdrop,
    getAiAssistTableBody,
  },
});
openBrandIdentificationChoice = dishEditorRuntime.openBrandIdentificationChoice;
showIngredientPhotoUploadModal = dishEditorRuntime.showIngredientPhotoUploadModal;
showPhotoAnalysisLoadingInRow = dishEditorRuntime.showPhotoAnalysisLoadingInRow;
hidePhotoAnalysisLoadingInRow = dishEditorRuntime.hidePhotoAnalysisLoadingInRow;
updatePhotoAnalysisLoadingStatus =
  dishEditorRuntime.updatePhotoAnalysisLoadingStatus;
showPhotoAnalysisResultButton = dishEditorRuntime.showPhotoAnalysisResultButton;
aiAssistState = dishEditorRuntime.aiAssistState;
aiAssistSetStatus = dishEditorRuntime.aiAssistSetStatus;
ensureAiAssistElements = dishEditorRuntime.ensureAiAssistElements;
collectAiTableData = dishEditorRuntime.collectAiTableData;
renderAiTable = dishEditorRuntime.renderAiTable;
openDishEditor = dishEditorRuntime.openDishEditor;
handleDishEditorResult = dishEditorRuntime.handleDishEditorResult;
handleDishEditorError = dishEditorRuntime.handleDishEditorError;
rebuildBrandMemoryFromRestaurant =
  dishEditorRuntime.rebuildBrandMemoryFromRestaurant;
getAiAssistBackdrop = dishEditorRuntime.getAiAssistBackdrop;
getAiAssistTableBody = dishEditorRuntime.getAiAssistTableBody;

const feedbackModalsApi = initFeedbackModals({
  configureModalClose,
  state,
  getIssueReportMeta,
  SUPABASE_KEY: typeof window !== "undefined" ? window.SUPABASE_KEY : "",
});
openFeedbackModal = feedbackModalsApi.openFeedbackModal || openFeedbackModal;
openReportIssueModal =
  feedbackModalsApi.openReportIssueModal || openReportIssueModal;
function div(html, cls) {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  d.innerHTML = html;
  return d;
}

function normalizeRestaurant(row) {
  return normalizeRestaurantRow(row, {
    normalizeAllergen,
    normalizeDietLabel,
  });
}

function configureModalClose({ visible = true, onClick = null } = {}) {
  const closeBtn = document.getElementById("modalCloseBtn");
  if (closeBtn) {
    closeBtn.style.display = visible ? "inline-flex" : "none";
    closeBtn.onclick = onClick || null;
  }
}

const { renderTopbar } = initRestaurantTopbar({
  state,
  urlQR,
  slug,
  setupTopbar,
  hasUnsavedChanges: () => hasUnsavedChanges(),
  showUnsavedChangesModal: (onProceed) => showUnsavedChangesModal(onProceed),
  clearEditorDirty: () => {
    window.editorDirty = false;
    if (aiAssistState) aiAssistState.savedToDish = true;
  },
  updateRootOffset,
});

/* tooltips */
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
showTipIn = tooltipRuntime.showTipIn;
hideTip = tooltipRuntime.hideTip;
getTipPinned = tooltipRuntime.getTipPinned;
getPinnedOverlayItem = tooltipRuntime.getPinnedOverlayItem;

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
  getMobileInfoPanel: () => mobileInfoPanel,
  getCurrentMobileInfoItem: () => currentMobileInfoItem,
  setCurrentMobileInfoItem: (item) => {
    currentMobileInfoItem = item;
    window.currentMobileInfoItem = item;
  },
  getIsOverlayZoomed: () => isOverlayZoomed,
  adjustMobileInfoPanelForZoom,
  hideTip: () => hideTip(),
});
renderMobileInfo = mobileInfoPanelRuntime.renderMobileInfo;
syncMobileInfoPanel = mobileInfoPanelRuntime.syncMobileInfoPanel;
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
  getCurrentMobileInfoItem: () => currentMobileInfoItem,
  setCurrentMobileInfoItem: (item) => {
    currentMobileInfoItem = item;
    window.currentMobileInfoItem = item;
  },
  getMobileInfoPanel: () => mobileInfoPanel,
  getRenderMobileInfo: () => renderMobileInfo,
});
captureMenuBaseDimensions = mobileViewerRuntime.captureMenuBaseDimensions;
ensureMobileViewerChrome = mobileViewerRuntime.ensureMobileViewerChrome;
updateZoomIndicator = mobileViewerRuntime.updateZoomIndicator;
updateFullScreenAllergySummary = mobileViewerRuntime.updateFullScreenAllergySummary;
setMobileZoom = mobileViewerRuntime.setMobileZoom;
resetMobileZoom = mobileViewerRuntime.resetMobileZoom;
openMobileViewer = mobileViewerRuntime.openMobileViewer;
closeMobileViewer = mobileViewerRuntime.closeMobileViewer;
getMobileZoomLevel = mobileViewerRuntime.getMobileZoomLevel;

/* list */
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

/* chips */
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
  getCurrentMobileInfoItem: () => currentMobileInfoItem,
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
maybeInitHowItWorksTour = howItWorksTour.maybeInitHowItWorksTour;

/* draw (simple image that follows page zoom) */
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
  supabaseClient: window.supabaseClient,
  createMenuOverlayRuntime,
  ensureMobileInfoPanel,
  prefersMobileInfo,
  getIsOverlayZoomed: () => isOverlayZoomed,
  getZoomedOverlayItem: () => zoomedOverlayItem,
  zoomOutOverlay,
  hideTip,
  zoomToOverlay,
  getMobileInfoPanel: () => mobileInfoPanel,
  clearCurrentMobileInfoItem: () => {
    currentMobileInfoItem = null;
  },
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
drawMenu = menuDrawRuntime.drawMenu;

/* restaurant page */
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
    clearCurrentMobileInfoItem: () => {
      currentMobileInfoItem = null;
    },
  });


const renderEditor = createEditorRenderer({
  state,
  renderTopbar,
  mountEditorShell,
  setRootOffsetPadding,
  bindEditorToolbarScale,
  initializeEditorAssets,
  initEditorSections,
  div,
  createDirtyController,
  createEditorChangeState,
  initEditorHistory,
  initEditorOverlays,
  initEditorSaveFlow,
  send,
  esc,
  aiAssistSetStatus,
  cap,
  formatAllergenLabel,
  getDietAllergenConflicts,
  tooltipBodyHTML,
  createEditorLastConfirmedUpdater,
  getWeeksAgoInfo,
  fmtDateTime,
  initBrandVerification,
  getIssueReportMeta,
  openDishEditor,
  getAiAssistTableBody,
  showIngredientPhotoUploadModal,
  renderGroupedSourcesHtml,
  configureModalClose,
  normalizeDietLabel,
  normalizeAllergen,
  ALLERGENS,
  DIETS,
  norm,
  getSupabaseKey: () =>
    typeof window !== "undefined" ? window.SUPABASE_KEY || "" : "",
  getFetchProductByBarcode: () =>
    typeof window !== "undefined" ? window.fetchProductByBarcode || null : null,
  getShowReplacementPreview: () =>
    typeof window !== "undefined" ? window.showReplacementPreview || null : null,
  initChangeLog,
  initEditorSettings,
  orderFlow,
  bindEditorRuntimeBindings,
  bindEditorHistoryControls,
  bindDetectDishesButton,
  detectDishesOnMenu,
  initEditorNavigation,
  initMenuImageEditor,
  analyzeBoxSizes,
  splitImageIntoSections,
  bindEditorBackButton,
  createEditorItemEditor,
  openPendingDishInEditor,
  applyPendingMenuIndexRemap,
  setEditorSaveApi: (api) => {
    editorSaveApi = api;
  },
  setCollectAllBrandItems: (collector) => {
    collectAllBrandItems = collector;
    window.collectAllBrandItems = collectAllBrandItems;
    window.collectAiBrandItems = collectAllBrandItems;
  },
  setOpenBrandVerification: (openFn) => {
    openBrandVerification = openFn;
  },
  setOpenChangeLog: (openFn) => {
    openChangeLog = openFn;
  },
  setUpdateLastConfirmedText: (updater) => {
    updateLastConfirmedText = updater;
  },
  renderApp: () => {
    render();
  },
});

const pageRouterRuntime = createPageRouterRuntime({
  state,
  setOrderSidebarVisibility,
  renderCardsPage,
  renderEditor,
  renderRestaurant,
  renderRestaurantReportPage,
  renderTopbar,
  mountReportShell,
  send,
  hidePageLoader,
});
render = pageRouterRuntime.render;

const unsavedChangesGuard = initUnsavedChangesGuard({
  collectAiTableData,
  getAiAssistBackdrop,
  getAiAssistState: () => aiAssistState,
  getNameInput: () => document.getElementById("aiAssistNameInput"),
  getEditorDirty: () => window.editorDirty,
  onClearDirty: () => {
    window.editorDirty = false;
    if (aiAssistState) aiAssistState.savedToDish = true;
  },
});
hasUnsavedChanges = unsavedChangesGuard.hasUnsavedChanges;
showUnsavedChangesModal = unsavedChangesGuard.showUnsavedChangesModal;
navigateWithCheck = unsavedChangesGuard.navigateWithCheck;

const handleRestaurantMessage = createRestaurantMessageHandler({
  state,
  urlQR,
  applyDefaultUserName,
  initDinerNotifications,
  closeQrPromo,
  hideQrBanner,
  normalizeAllergen,
  normalizeDietLabel,
  rerenderOrderConfirmDetails,
  normalizeRestaurant,
  orderFlow,
  stopOrderRefresh,
  persistTabletStateSnapshot,
  renderOrderSidebarStatus,
  clearOrderItemSelections,
  restoreOrderItems,
  persistOrderItems,
  updateOrderSidebar,
  openOrderSidebar,
  rebuildBrandMemoryFromRestaurant,
  handleDishEditorResult,
  handleDishEditorError,
  getEditorSaveApi: () => editorSaveApi,
  checkForActiveOrders,
  updateLastConfirmedText,
  renderTopbar,
  render,
  maybeInitHowItWorksTour,
  updateFullScreenAllergySummary,
  openChangeLog: () => openChangeLog(),
});
const bootHydrationRuntime = createBootHydrationRuntime({
  handleRestaurantMessage,
});
applyRestaurantBootPayload = bootHydrationRuntime.applyRestaurantBootPayload;
bootHydrationRuntime.bindWindowPayloadListener();

export function hydrateRestaurantBootPayload(payload) {
  applyRestaurantBootPayload(payload || {});
}

initAutoOpenDish({ state });
initOrderConfirmRestore({
  initOrderSidebar,
  getOrderFormStateStorageKey,
  checkUserAuth,
  restoreOrderFormState,
  updateOrderConfirmAuthState,
  rerenderOrderConfirmDetails,
});
