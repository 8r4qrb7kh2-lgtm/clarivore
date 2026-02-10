import { ORDER_STATUSES as TabletOrderStatusesConst } from "../../lib/tabletSimulationLogic.mjs";
import { setupTopbar } from "../../lib/sharedNav.js";
import { initDinerNotifications } from "../../lib/dinerNotifications.js";
import { getActiveAllergenDietConfig } from "../../lib/allergenConfigRuntime.js";
import { supabaseAnonKey, supabaseUrl } from "../../lib/supabase.js";
import {
  analyzeBoxSizes,
  splitImageIntoSections,
} from "../../lib/restaurantRuntime/menu-image-utils.js";
import { detectDishesOnMenu } from "../../lib/restaurantRuntime/menu-dish-detection.js";
import { initBrandVerification } from "../../lib/restaurantRuntime/brand-verification.js";
import { initChangeLog } from "../../lib/restaurantChangeLogRuntime.js";
import { initEditorOverlays } from "../../lib/restaurantRuntime/editor-overlays.js";
import { initMenuImageEditor } from "../../lib/restaurantRuntime/menu-images.js";
import { initEditorNavigation } from "../../lib/restaurantRuntime/editor-navigation.js";
import { initEditorSections } from "../../lib/restaurantRuntime/editor-sections.js";
import { initEditorHistory } from "../../lib/restaurantRuntime/editor-history.js";
import { initEditorSettings } from "../../lib/restaurantRuntime/editor-settings.js";
import { initEditorSaveFlow } from "../../lib/restaurantRuntime/editor-save.js";
import { mountEditorShell } from "../../lib/editorShellMarkup.js";
import {
  applyRestaurantShellState,
  mountRestaurantShell,
} from "../../lib/restaurantShellMarkup.js";
import { mountReportShell } from "../../lib/reportShellMarkup.js";
import {
  bindRestaurantActionButtons,
  bindSavedPreferenceButtons,
  initGuestFilterControls,
  showRestaurantMenuSurface,
} from "../../lib/restaurantViewBindings.js";
import { bindEditorBackButton } from "../../lib/restaurantRuntime/editor-exit.js";
import { bindDetectDishesButton } from "../../lib/restaurantRuntime/editor-dish-detection.js";
import { bindEditorToolbarScale } from "../../lib/restaurantRuntime/editor-toolbar.js";
import { bindEditorHistoryControls } from "../../lib/restaurantRuntime/editor-history-controls.js";
import { openPendingDishInEditor } from "../../lib/restaurantRuntime/editor-pending-dish.js";
import { createEditorItemEditor } from "../../lib/restaurantRuntime/editor-item-editor.js";
import { createEditorLastConfirmedUpdater } from "../../lib/editorLastConfirmedRuntime.js";
import { bindEditorRuntimeBindings } from "../../lib/restaurantRuntime/editor-runtime-bindings.js";
import {
  initializeEditorAssets,
  createDirtyController,
  createEditorChangeState,
  applyPendingMenuIndexRemap,
} from "../../lib/restaurantRuntime/editor-session.js";
import { renderRestaurantReportPage } from "../../lib/restaurantReportPageRuntime.js";
import {
  fetchChangeLogEntries,
  insertChangeLogEntry,
} from "../../lib/changeLogService.js";
import { prefersMobileInfo } from "../../lib/mobileInfoHelpersRuntime.js";
import {
  fmtDate,
  fmtDateTime,
  getWeeksAgoInfo,
} from "../../lib/timeFormatting.js";
import { initializeRestaurantRuntimeEnvironment } from "./runtimeEnvironment.js";
import { createRestaurantRuntimeCore } from "./createRestaurantRuntimeCore.js";
import { createRestaurantRuntimeCoreOptions } from "./createRestaurantRuntimeCoreOptions.js";
import { createRestaurantPageUiBundle } from "./createRestaurantPageUiBundle.js";
import { createRestaurantPageUiBundleOptions } from "./createRestaurantPageUiBundleOptions.js";
import { createRestaurantEditorHydrationBundle } from "./createRestaurantEditorHydrationBundle.js";
import { createRestaurantEditorHydrationBundleOptions } from "./createRestaurantEditorHydrationBundleOptions.js";
import { createRestaurantRuntimeBrowserServices } from "./createRestaurantRuntimeBrowserServices.js";
import {
  getEditorDirty,
  getCurrentMobileInfoItem as getBridgeCurrentMobileInfoItem,
  setCollectAllBrandItems,
  setCurrentMobileInfoItem as setBridgeCurrentMobileInfoItem,
  setEditorDirty,
  setOverlayPulseColorHandler,
  setOpenBrandVerification,
} from "../../lib/restaurantRuntime/restaurantRuntimeBridge.js";
import {
  getLovedDishesSet,
  getOrderItems,
  getSupabaseClient,
} from "../../lib/restaurantRuntime/runtimeSessionState.js";

const { logDebug, setDebugJson } = initializeRestaurantRuntimeEnvironment();

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

const allergenConfig = getActiveAllergenDietConfig();
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
let openImageModal = () => {};
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
const runtimeBrowserServices = createRestaurantRuntimeBrowserServices();
const resolveRuntimeGlobal = runtimeBrowserServices.resolveRuntimeGlobal;
let maybeInitHowItWorksTour = () => {};
let hasUnsavedChanges = () => false;
let showUnsavedChangesModal = () => {};
let editorSaveApi = null;
let navigateWithCheck = (url) => runtimeBrowserServices.navigateTo(url);
let mobileInfoPanel = null;
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
let renderCardsPage = () => {};
let renderRestaurant = () => {};
let renderEditor = () => {};
let renderSavedChips = () => {};
let renderSavedDiets = () => {};
let renderSelectedChips = () => {};
let renderSelectedDiets = () => {};
let renderSelector = () => {};
let renderDietSelector = () => {};
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
let urlQR = false;
let shouldShowQrPromo = () => false;
let cancelQrPromoTimer = () => {};
let queueQrPromoTimer = () => {};
let closeQrPromo = () => {};
let orderRuntime = { orderFlow: {} };
let esc = (value) => String(value ?? "");
let norm = (value) => String(value ?? "");
let cap = (value) => String(value ?? "");
let formatAllergenLabel = (value) => String(value ?? "");
let normalizeDietLabel = (value) => String(value ?? "");
let mobileCompactBodyHTML = () => "";
let toggleLoveDishInTooltip = () => {};
let computeStatus = () => "unknown";
let hasCrossContamination = () => false;
let tooltipBodyHTML = () => "";
let renderGroupedSourcesHtml = () => "";
let setOverlayPulseColor = () => {};
let hidePageLoader = () => {};
let div = () => runtimeBrowserServices.createElement("div");
let configureModalClose = () => {};
let isDishInfoPopupOpen = () => false;

let zoomToOverlay = () => {};
let zoomOutOverlay = () => {};
let isOverlayZoomed = false;
let zoomedOverlayItem = null;
let showTipIn = () => {};
let hideTip = () => {};
let getTipPinned = () => false;
let getPinnedOverlayItem = () => null;
let pageTip = null;
const runtimeSupabaseAnonKey = supabaseAnonKey || "";
const runtimeSupabaseUrl = supabaseUrl || "https://fgoiyycctnwnghrvsilt.supabase.co";

const runtimeCoreOptions = createRestaurantRuntimeCoreOptions({
  state,
  slug,
  allergenConfig,
  insertChangeLogEntry,
  fetchChangeLogEntries,
  getTipPinned: () => getTipPinned(),
  getMobileInfoPanel: () => mobileInfoPanel,
  setMobileInfoPanel: (panel) => {
    mobileInfoPanel = panel;
  },
  onZoomChange: ({ isZoomed, item }) => {
    isOverlayZoomed = isZoomed;
    zoomedOverlayItem = item || null;
  },
  normalizeAllergen,
  normalizeDietLabel,
  getDietAllergenConflicts,
  ALLERGENS,
  DIETS,
  ALLERGEN_EMOJI,
  DIET_EMOJI,
  supabaseClient: getSupabaseClient(),
  getSupabaseKey: () => runtimeSupabaseAnonKey,
  getAiAssistEndpoint: () => resolveRuntimeGlobal("__CLE_AI_ENDPOINT__"),
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
    openImageModal,
    handleDishEditorResult,
    handleDishEditorError,
    rebuildBrandMemoryFromRestaurant,
    getAiAssistBackdrop,
    getAiAssistTableBody,
  },
});
const {
  pageServicesRuntime,
  orderFlow,
  dishEditorRuntime,
  normalizeRestaurant,
  adjustMobileInfoPanelForZoom,
} = createRestaurantRuntimeCore(runtimeCoreOptions);
({
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
  shouldShowQrPromo,
  cancelQrPromoTimer,
  queueQrPromoTimer,
  closeQrPromo,
  send,
  orderRuntime,
  normalizeDietLabel,
  mobileCompactBodyHTML,
  toggleLoveDishInTooltip,
  computeStatus,
  hasCrossContamination,
  zoomToOverlay,
  zoomOutOverlay,
  tooltipBodyHTML,
  renderGroupedSourcesHtml,
} = pageServicesRuntime);
setOverlayPulseColorHandler(setOverlayPulseColor);

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
} = orderRuntime;
({
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
  openImageModal,
  handleDishEditorResult,
  handleDishEditorError,
  rebuildBrandMemoryFromRestaurant,
  getAiAssistBackdrop,
  getAiAssistTableBody,
} = dishEditorRuntime);

const clearEditorDirtyState = () => {
  setEditorDirty(false);
  if (aiAssistState) aiAssistState.savedToDish = true;
};
const pageUiBundleOptions = createRestaurantPageUiBundleOptions({
  state,
  slug,
  urlQR,
  setupTopbar,
  hasUnsavedChanges: () => hasUnsavedChanges(),
  showUnsavedChangesModal: (onProceed) => showUnsavedChangesModal(onProceed),
  clearEditorDirty: clearEditorDirtyState,
  updateRootOffset,
  configureModalClose,
  getIssueReportMeta,
  supabaseKey: runtimeSupabaseAnonKey,
  esc,
  prefersMobileInfo,
  mobileCompactBodyHTML,
  toggleLoveDishInTooltip,
  ensureAddToOrderConfirmContainer,
  hideAddToOrderConfirmation,
  showAddToOrderConfirmation,
  addDishToOrder,
  getDishCompatibilityDetails,
  getOrderItems,
  getLovedDishesSet,
  getSupabaseClient,
  ensureMobileInfoPanel,
  getMobileInfoPanel: () => mobileInfoPanel,
  getCurrentMobileInfoItem: () => getBridgeCurrentMobileInfoItem(),
  setCurrentMobileInfoItem: (item) => {
    setBridgeCurrentMobileInfoItem(item);
  },
  getIsOverlayZoomed: () => isOverlayZoomed,
  adjustMobileInfoPanelForZoom,
  setOverlayPulseColor,
  normalizeAllergen,
  ALLERGEN_EMOJI,
  DIET_EMOJI,
  formatAllergenLabel,
  getMenuState,
  div,
  send,
  getWeeksAgoInfo,
  normalizeDietLabel,
  ALLERGENS,
  DIETS,
  updateOrderSidebar,
  openOrderSidebar,
  supabaseClient: getSupabaseClient(),
  getZoomedOverlayItem: () => zoomedOverlayItem,
  zoomOutOverlay,
  zoomToOverlay,
  clearCurrentMobileInfoItem: () => {
    setBridgeCurrentMobileInfoItem(null);
  },
  hasCrossContamination,
  computeStatus,
  orderFlow,
  TABLET_ORDER_STATUSES,
  setRootOffsetPadding,
  mountRestaurantShell,
  applyRestaurantShellState,
  fmtDate,
  initGuestFilterControls,
  showRestaurantMenuSurface,
  resizeLegendToFit,
  shouldShowQrPromo,
  queueQrPromoTimer,
  cancelQrPromoTimer,
  bindSavedPreferenceButtons,
  bindRestaurantActionButtons,
});
const {
  pageUiRuntime,
  renderTopbar,
  overlayUiRuntime,
  restaurantViewRuntime,
} = createRestaurantPageUiBundle(pageUiBundleOptions);
openFeedbackModal = pageUiRuntime.openFeedbackModal || openFeedbackModal;
openReportIssueModal =
  pageUiRuntime.openReportIssueModal || openReportIssueModal;
({
  pageTip,
  showTipIn,
  hideTip,
  getTipPinned,
  getPinnedOverlayItem,
  renderMobileInfo,
  syncMobileInfoPanel,
  captureMenuBaseDimensions,
  ensureMobileViewerChrome,
  updateZoomIndicator,
  updateFullScreenAllergySummary,
  setMobileZoom,
  resetMobileZoom,
  openMobileViewer,
  closeMobileViewer,
  getMobileZoomLevel,
} = overlayUiRuntime);
({
  renderCardsPage,
  drawMenu,
  renderRestaurant,
  renderSavedChips,
  renderSavedDiets,
  renderSelectedChips,
  renderSelectedDiets,
  renderSelector,
  renderDietSelector,
  maybeInitHowItWorksTour,
} = restaurantViewRuntime);

const editorHydrationBundleOptions =
  createRestaurantEditorHydrationBundleOptions({
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
    getSupabaseKey: () => runtimeSupabaseAnonKey,
    getSupabaseUrl: () => runtimeSupabaseUrl,
    getSupabaseAnonKey: () => runtimeSupabaseAnonKey,
    getFetchProductByBarcode: () =>
      resolveRuntimeGlobal("fetchProductByBarcode"),
    getBarcodeLibrary: () => resolveRuntimeGlobal("ZXing"),
    getOpenImageModal: () => openImageModal,
    getShowReplacementPreview: () =>
      resolveRuntimeGlobal("showReplacementPreview"),
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
    onEditorSaveApi: (api) => {
      editorSaveApi = api;
    },
    onCollectAllBrandItems: (collector) => {
      setCollectAllBrandItems(collector);
    },
    onOpenBrandVerification: (openFn) => {
      setOpenBrandVerification(openFn);
    },
    onOpenChangeLog: (openFn) => {
      openChangeLog = openFn;
    },
    onUpdateLastConfirmedText: (updater) => {
      updateLastConfirmedText = updater;
    },
    renderApp: () => {
      render();
    },
    setOrderSidebarVisibility,
    renderCardsPage,
    renderRestaurant,
    renderRestaurantReportPage,
    mountReportShell,
    hidePageLoader,
    collectAiTableData,
    getAiAssistBackdrop,
    getAiAssistState: () => aiAssistState,
    getNameInput: () => runtimeBrowserServices.getElementById("aiAssistNameInput"),
    getEditorDirty: () => getEditorDirty(),
    onClearDirty: clearEditorDirtyState,
    urlQR,
    applyDefaultUserName,
    initDinerNotifications,
    closeQrPromo,
    hideQrBanner,
    rerenderOrderConfirmDetails,
    normalizeRestaurant,
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
    maybeInitHowItWorksTour,
    updateFullScreenAllergySummary,
    openChangeLog: () => openChangeLog(),
    initOrderSidebar,
    getOrderFormStateStorageKey,
    checkUserAuth,
    restoreOrderFormState,
    updateOrderConfirmAuthState,
  });
const {
  editorRuntime,
  pageRouterRuntime,
  unsavedGuardRuntime,
  hydrationRuntime,
} = createRestaurantEditorHydrationBundle(editorHydrationBundleOptions);
renderEditor = editorRuntime.renderEditor;
render = pageRouterRuntime.render;
({
  hasUnsavedChanges,
  showUnsavedChangesModal,
  navigateWithCheck,
} = unsavedGuardRuntime);
applyRestaurantBootPayload = hydrationRuntime.applyRestaurantBootPayload;

export function hydrateRestaurantBootPayload(payload) {
  hydrationRuntime.hydrateRestaurantBootPayload(payload || {});
}

hydrationRuntime.initializePostBoot();
