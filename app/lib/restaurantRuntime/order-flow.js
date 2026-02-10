import {
  createInitialState as createTabletInitialState,
  createOrderDraft as createTabletOrderDraft,
  requestServerCode as tabletRequestServerCode,
  submitOrderToServer as tabletSubmitOrderToServer,
  serverApprove as tabletServerApprove,
  serverDispatchToKitchen as tabletServerDispatchToKitchen,
  serverReject as tabletServerReject,
  kitchenAcknowledge as tabletKitchenAcknowledge,
  userRespondToQuestion as tabletUserRespondToQuestion,
  ORDER_STATUSES as TabletOrderStatusesConst,
} from "../tabletSimulationLogic.mjs";
import {
  getPersistedTabletState,
  persistTabletState,
  subscribeToTabletState,
} from "../tabletSync.js";
import { saveTabletOrder, fetchTabletOrders } from "../tabletOrdersApi.js";
import { getActiveAllergenDietConfig } from "../allergenConfigRuntime.js";
import {
  getOrderItemSelections as getSessionOrderItemSelections,
  getOrderItems as getSessionOrderItems,
  getSupabaseClient as getSessionSupabaseClient,
  setOpenOrderConfirmDrawer as setSessionOpenOrderConfirmDrawer,
  setOrderItems as setSessionOrderItems,
} from "./runtimeSessionState.js";
import { applyOverlayPulseColor as applyOverlayPulseColorFromBridge } from "./restaurantRuntimeBridge.js";
import { markOverlayDishesSelected } from "./overlay-dom.js";
import { waitForMenuOverlays } from "./menu-overlay-ready.js";
import { createOrderSidebarUiRuntime } from "./order-sidebar-ui-runtime.js";
import { createOrderSidebarPendingRuntime } from "./order-sidebar-pending-runtime.js";
import { createOrderSidebarCartRuntime } from "./order-sidebar-cart-runtime.js";
import { createOrderSidebarStateRuntime } from "./order-sidebar-state-runtime.js";
import { createOrderConfirmTabletRuntime } from "./order-confirm-tablet-runtime.js";
import { createOrderNoticeUpdatesRuntime } from "./order-notice-updates-runtime.js";
import { createOrderDishCompatibilityRuntime } from "./order-dish-compatibility-runtime.js";
import { createOrderItemStateRuntime } from "./order-item-state-runtime.js";
import { createOrderConfirmUiRuntime } from "./order-confirm-ui-runtime.js";
import { createOrderDishActionsRuntime } from "./order-dish-actions-runtime.js";
import { createOrderConfirmFormRuntime } from "./order-confirm-form-runtime.js";
import { createOrderStatusSyncRuntime } from "./order-status-sync-runtime.js";

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

const allergenConfig = getActiveAllergenDietConfig();
const ALLERGENS = Array.isArray(allergenConfig.ALLERGENS)
  ? allergenConfig.ALLERGENS
  : [];
const DIETS = Array.isArray(allergenConfig.DIETS) ? allergenConfig.DIETS : [];
const normalizeAllergen =
  typeof allergenConfig.normalizeAllergen === "function"
    ? allergenConfig.normalizeAllergen
    : (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) return "";
        if (!ALLERGENS.length) return raw;
        return ALLERGENS.includes(raw) ? raw : "";
      };
const normalizeDietLabel =
  typeof allergenConfig.normalizeDietLabel === "function"
    ? allergenConfig.normalizeDietLabel
    : (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) return "";
        if (!DIETS.length) return raw;
        return DIETS.includes(raw) ? raw : "";
      };
const formatPreferenceLabel =
  typeof allergenConfig.formatPreferenceLabel === "function"
    ? allergenConfig.formatPreferenceLabel
    : (value) => {
        const raw = String(value || "");
        return raw
          .split(" ")
          .map((part) =>
            part ? part.charAt(0).toUpperCase() + part.slice(1) : "",
          )
          .join(" ");
      };
const getAllergenEmoji =
  typeof allergenConfig.getAllergenEmoji === "function"
    ? allergenConfig.getAllergenEmoji
    : () => "";
const getDietEmoji =
  typeof allergenConfig.getDietEmoji === "function"
    ? allergenConfig.getDietEmoji
    : () => "";
const getDietAllergenConflicts =
  typeof allergenConfig.getDietAllergenConflicts === "function"
    ? allergenConfig.getDietAllergenConflicts
    : () => [];

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

export function initOrderFlow({
  state,
  send,
  resizeLegendToFit,
  supabaseClient: supabaseClientOverride,
  getSupabaseClient: getSupabaseClientOverride,
  getOrderItems: getOrderItemsOverride,
  setOrderItems: setOrderItemsOverride,
  getOrderItemSelections: getOrderItemSelectionsOverride,
  setOpenOrderConfirmDrawer: setOpenOrderConfirmDrawerOverride,
  setOverlayPulseColor: setOverlayPulseColorOverride,
  getLocationHref: getLocationHrefOverride,
  navigateToUrl: navigateToUrlOverride,
  getViewportHeight: getViewportHeightOverride,
  addWindowResizeListener: addWindowResizeListenerOverride,
} = {}) {
  const getSupabaseClient = () =>
    supabaseClientOverride ||
    (typeof getSupabaseClientOverride === "function"
      ? getSupabaseClientOverride()
      : getSessionSupabaseClient()) ||
    null;

  const readOrderItems =
    typeof getOrderItemsOverride === "function"
      ? getOrderItemsOverride
      : () => getSessionOrderItems();

  const writeOrderItems =
    typeof setOrderItemsOverride === "function"
      ? (items) => setOrderItemsOverride(Array.isArray(items) ? items : [])
      : (items) => setSessionOrderItems(items);

  const readOrderItemSelections =
    typeof getOrderItemSelectionsOverride === "function"
      ? getOrderItemSelectionsOverride
      : () => getSessionOrderItemSelections();

  const setOpenOrderConfirmDrawer =
    typeof setOpenOrderConfirmDrawerOverride === "function"
      ? setOpenOrderConfirmDrawerOverride
      : (fn) => setSessionOpenOrderConfirmDrawer(fn);

  const applyOverlayPulseColor =
    typeof setOverlayPulseColorOverride === "function"
      ? setOverlayPulseColorOverride
      : (overlay) => applyOverlayPulseColorFromBridge(overlay);

  const getLocationHref =
    typeof getLocationHrefOverride === "function"
      ? getLocationHrefOverride
      : () => (typeof location !== "undefined" ? location.href : "");

  const navigateToUrl =
    typeof navigateToUrlOverride === "function"
      ? navigateToUrlOverride
      : (url) => {
          if (typeof location !== "undefined") {
            location.href = url;
          }
        };

  const getViewportHeight =
    typeof getViewportHeightOverride === "function"
      ? getViewportHeightOverride
      : () => (typeof innerHeight === "number" ? innerHeight : 0);

  const addWindowResizeListener =
    typeof addWindowResizeListenerOverride === "function"
      ? addWindowResizeListenerOverride
      : (handler) => {
          if (typeof addEventListener === "function") {
            addEventListener("resize", handler);
          }
        };

  function getOrderItems() {
    if (orderItemStateRuntime) {
      return orderItemStateRuntime.getOrderItems();
    }
    const items = readOrderItems();
    if (Array.isArray(items)) return items;
    const fallback = [];
    writeOrderItems(fallback);
    return fallback;
  }

  function hasOrderItems() {
    if (orderItemStateRuntime) {
      return orderItemStateRuntime.hasOrderItems();
    }
    return getOrderItems().length > 0;
  }
  const ORDER_STATUS_DESCRIPTORS = {
    [TABLET_ORDER_STATUSES.CODE_ASSIGNED]: {
      label: "Waiting for server confirmation",
      tone: "warn",
    },
    [TABLET_ORDER_STATUSES.SUBMITTED_TO_SERVER]: {
      label: "Waiting for server approval",
      tone: "warn",
    },
    [TABLET_ORDER_STATUSES.QUEUED_FOR_KITCHEN]: {
      label: "Ready to send to kitchen",
      tone: "warn",
    },
    [TABLET_ORDER_STATUSES.WITH_KITCHEN]: {
      label: "At kitchen tablet",
      tone: "idle",
    },
    [TABLET_ORDER_STATUSES.ACKNOWLEDGED]: {
      label: "Acknowledged by kitchen",
      tone: "success",
    },
    [TABLET_ORDER_STATUSES.AWAITING_USER_RESPONSE]: {
      label: "Kitchen awaiting diner response",
      tone: "warn",
    },
    [TABLET_ORDER_STATUSES.QUESTION_ANSWERED]: {
      label: "Follow-up complete",
      tone: "success",
    },
    [TABLET_ORDER_STATUSES.REJECTED_BY_SERVER]: {
      label: "Rejected by server",
      tone: "danger",
    },
    [TABLET_ORDER_STATUSES.RESCINDED_BY_DINER]: {
      label: "Rescinded by diner",
      tone: "warn",
    },
    [TABLET_ORDER_STATUSES.REJECTED_BY_KITCHEN]: {
      label: "Rejected by kitchen",
      tone: "danger",
    },
  };
  const ORDER_UPDATE_MESSAGES = {
    [TABLET_ORDER_STATUSES.SUBMITTED_TO_SERVER]:
      "Your notice is waiting for server approval.",
    [TABLET_ORDER_STATUSES.QUEUED_FOR_KITCHEN]:
      "Your notice has been approved and queued for the kitchen.",
    [TABLET_ORDER_STATUSES.WITH_KITCHEN]:
      "Your notice is now with the kitchen.",
    [TABLET_ORDER_STATUSES.ACKNOWLEDGED]:
      "The kitchen acknowledged your notice.",
    [TABLET_ORDER_STATUSES.AWAITING_USER_RESPONSE]:
      "The kitchen has a follow-up question.",
    [TABLET_ORDER_STATUSES.QUESTION_ANSWERED]:
      "Your response was sent to the kitchen.",
    [TABLET_ORDER_STATUSES.REJECTED_BY_SERVER]:
      "The server rejected your notice.",
    [TABLET_ORDER_STATUSES.REJECTED_BY_KITCHEN]:
      "The kitchen rejected your notice.",
    [TABLET_ORDER_STATUSES.RESCINDED_BY_DINER]:
      "You rescinded this notice.",
  };
  const ORDER_SIDEBAR_DISMISSED_KEY = "orderSidebarDismissedOrders";
  const ORDER_SIDEBAR_OPEN_AFTER_SUBMIT_KEY = "orderSidebarOpenAfterSubmit";

  let tabletSimState = createTabletInitialState();
  let tabletSimOrderId = null;
  let tabletStateUpdatedAt = 0;

  const persistedTabletState = getPersistedTabletState();
  if (persistedTabletState) {
    tabletSimState.orders = deepCloneArray(persistedTabletState.orders);
    if (
      Array.isArray(persistedTabletState.chefs) &&
      persistedTabletState.chefs.length
    ) {
      tabletSimState.chefs = deepCloneArray(persistedTabletState.chefs);
    }
    if (typeof persistedTabletState.lastServerCode === "string") {
      tabletSimState.lastServerCode = persistedTabletState.lastServerCode;
    }
    tabletStateUpdatedAt = persistedTabletState.updatedAt || Date.now();
    if (persistedTabletState.currentOrderId) {
      tabletSimOrderId = persistedTabletState.currentOrderId;
    } else if (tabletSimState.orders.length > 0) {
      const activeOrders = tabletSimState.orders.filter((order) =>
        isOrderActiveForBadge(order),
      );
      const submittedOrder = pickMostRecentOrder(activeOrders);
      if (submittedOrder) {
        tabletSimOrderId = submittedOrder.id;
      }
    }
  }
  const dismissedOrderIds = getDismissedOrderIds();
  if (dismissedOrderIds.length) {
    tabletSimState.orders = tabletSimState.orders.filter(
      (order) => !dismissedOrderIds.includes(order.id),
    );
    if (tabletSimOrderId && dismissedOrderIds.includes(tabletSimOrderId)) {
      tabletSimOrderId = null;
    }
  }

  subscribeToTabletState((payload) => {
    if (!payload) return;
    if (payload.updatedAt && payload.updatedAt <= tabletStateUpdatedAt) return;
    tabletStateUpdatedAt = payload.updatedAt || Date.now();
    tabletSimState.orders = deepCloneArray(payload.orders);
    if (Array.isArray(payload.chefs) && payload.chefs.length) {
      tabletSimState.chefs = deepCloneArray(payload.chefs);
    }
    if (typeof payload.lastServerCode === "string") {
      tabletSimState.lastServerCode = payload.lastServerCode;
    }
    const dismissed = getDismissedOrderIds();
    if (dismissed.length) {
      tabletSimState.orders = tabletSimState.orders.filter(
        (order) => !dismissed.includes(order.id),
      );
      if (tabletSimOrderId && dismissed.includes(tabletSimOrderId)) {
        tabletSimOrderId = null;
      }
    }
    renderOrderConfirm();
    updateOrderSidebarBadge();
  });
  const serverPanelState = { activeServerId: null };

  const orderConfirmDrawer = document.getElementById("orderConfirmDrawer");
  const orderConfirmCloseBtn = document.getElementById("orderConfirmClose");
  const orderConfirmSummaryList = document.getElementById(
    "orderConfirmSummaryList",
  );
  const orderConfirmEmptySummary = document.getElementById(
    "orderConfirmEmptySummary",
  );
  const orderConfirmStatusBadge = document.getElementById(
    "orderConfirmStatusBadge",
  );
  const orderConfirmForm = document.getElementById("orderConfirmForm");
  const orderConfirmNameInput = document.getElementById("orderConfirmName");
  const orderConfirmDeliveryInput = document.getElementById(
    "orderConfirmDelivery",
  );
  const orderConfirmAllergyChips = document.getElementById(
    "orderConfirmAllergyChips",
  );
  const orderConfirmDietChips = document.getElementById("orderConfirmDietChips");
  const orderConfirmNotesInput = document.getElementById("orderConfirmNotes");
  const orderConfirmCodeInput = document.getElementById("orderConfirmCodeInput");
  const orderConfirmSubmitBtn = document.getElementById("orderConfirmSubmitBtn");
  const orderConfirmSubmitStatus = document.getElementById(
    "orderConfirmSubmitStatus",
  );
  const orderConfirmResetBtn = document.getElementById("orderConfirmResetBtn");
  const orderConfirmAuthPrompt = document.getElementById(
    "orderConfirmAuthPrompt",
  );
  const orderConfirmSignInBtn = document.getElementById("orderConfirmSignInBtn");
  const orderConfirmSignUpBtn = document.getElementById("orderConfirmSignUpBtn");
  const orderConfirmServerPanel = document.getElementById(
    "orderConfirmServerPanel",
  );
  const orderConfirmKitchenPanel = document.getElementById(
    "orderConfirmKitchenPanel",
  );
  const orderSidebarStatus = document.getElementById("orderSidebarStatus");
  const orderSidebarStatusBadge = document.getElementById(
    "orderSidebarStatusBadge",
  );
  const orderSidebarItems = document.getElementById("orderSidebarItems");
  const orderSidebarActions = document.getElementById("orderSidebarActions");
  const confirmOrderBtn = document.getElementById("confirmOrderBtn");
  const confirmOrderHint = document.getElementById("confirmOrderHint");
  if (orderSidebarItems) {
    orderSidebarItems.dataset.mode = "cart";
  }
  let rescindConfirmOrderId = null;
  let orderItemStateRuntime = null;
  let orderSidebarStateRuntime = null;
  let orderSidebarCartRuntime = null;
  let orderDishActionsRuntime = null;
  let orderConfirmFormRuntime = null;
  let orderConfirmUiRuntime = null;
  let orderConfirmTabletRuntime = null;
  let orderNoticeUpdatesRuntime = null;
  let orderStatusSyncRuntime = null;
  orderItemStateRuntime = createOrderItemStateRuntime({
    state,
    getGlobalSlug: () =>
      typeof slug === "string" && slug ? slug : "",
    readOrderItems: () => readOrderItems(),
    writeOrderItems: (items) => writeOrderItems(items),
    readOrderItemSelections: () => readOrderItemSelections(),
  });
  const orderSidebarUiRuntime = createOrderSidebarUiRuntime({
    state,
    orderSidebarItems,
    orderSidebarActions,
    confirmOrderBtn,
    confirmOrderHint,
    orderConfirmDrawer,
    hasOrderItems: () => hasOrderItems(),
    getSelectedOrderItems: () => getSelectedOrderItems(),
    getSidebarOrders: () => getSidebarOrders(),
    getActiveOrderCount: () => getActiveOrderCount(),
    getViewportHeight,
    onRenderOrderConfirmSummary: () => {
      renderOrderConfirmSummary();
    },
    onSidebarUserToggle: () => {
      orderSidebarStateRuntime?.markSidebarUserToggled();
    },
  });
  orderSidebarStateRuntime = createOrderSidebarStateRuntime({
    TABLET_ORDER_STATUSES,
    dismissedStorageKey: ORDER_SIDEBAR_DISMISSED_KEY,
    openAfterSubmitStorageKey: ORDER_SIDEBAR_OPEN_AFTER_SUBMIT_KEY,
    getCurrentRestaurantId: () =>
      state.restaurant?._id || state.restaurant?.id || null,
    getOrders: () => (Array.isArray(tabletSimState.orders) ? tabletSimState.orders : []),
    setOrders: (orders) => {
      tabletSimState.orders = Array.isArray(orders) ? orders : [];
    },
    getCurrentOrderId: () => tabletSimOrderId,
    setCurrentOrderId: (orderId) => {
      tabletSimOrderId = orderId || null;
    },
    onStopOrderRefresh: () => stopOrderRefresh(),
    onPersistSnapshot: () => persistTabletStateSnapshot(),
    onUpdateSidebarBadge: () => updateOrderSidebarBadge(),
    onOpenSidebar: () => openOrderSidebar(),
    onMinimizeSidebar: () => minimizeOrderSidebar(),
    getSidebarMode: () => orderSidebarItems?.dataset.mode || "",
    hasOrderItems: () => hasOrderItems(),
    getOrderItems: () => getOrderItems(),
  });
  orderSidebarCartRuntime = createOrderSidebarCartRuntime({
    orderSidebarItems,
    esc,
    escapeAttribute,
    hasOrderItems: () => hasOrderItems(),
    getOrderItems: () => getOrderItems(),
    isOrderItemSelected: (dishName) => isOrderItemSelected(dishName),
    syncOrderItemSelections: () => syncOrderItemSelections(),
    toggleOrderItemSelection: (dishName) => toggleOrderItemSelection(dishName),
    removeDishFromOrder: (dishName) => removeDishFromOrder(dishName),
    setConfirmButtonVisibility: (visible) => setConfirmButtonVisibility(visible),
    setConfirmButtonDisabled: (disabled) => setConfirmButtonDisabled(disabled),
    updateConfirmButtonVisibility: () => updateConfirmButtonVisibility(),
    minimizeOrderSidebar: () => minimizeOrderSidebar(),
  });
  const orderSidebarPendingRuntime = createOrderSidebarPendingRuntime({
    orderSidebarItems,
    ORDER_STATUS_DESCRIPTORS,
    TABLET_ORDER_STATUSES,
    esc,
    escapeAttribute,
    escapeConfirmationHtml,
    formatOrderListLabel,
    getBadgeClassForTone,
    formatTabletTimestamp,
    getKitchenQuestion,
    shouldShowClearOrderButton,
    getRescindConfirmOrderId: () => rescindConfirmOrderId,
    getOrderItems: () => getOrderItems(),
    isOrderItemSelected: (dishName) => isOrderItemSelected(dishName),
    syncOrderItemSelections: () => syncOrderItemSelections(),
    updateConfirmButtonVisibility: () => updateConfirmButtonVisibility(),
    removeDishFromOrder: (dishName) => removeDishFromOrder(dishName),
    bindOrderItemSelectButtons: (container) =>
      orderSidebarCartRuntime?.bindOrderItemSelectButtons(container),
    handleRescindNotice,
    handleRescindConfirm,
    handleRescindCancel,
    handleClearOrderFromSidebar,
    handleKitchenQuestionResponse,
  });
  const orderDishCompatibilityRuntime = createOrderDishCompatibilityRuntime({
    getRestaurantOverlays: () =>
      Array.isArray(state.restaurant?.overlays) ? state.restaurant.overlays : [],
    getUserAllergies: () =>
      Array.isArray(state.allergies) ? state.allergies : [],
    getUserDiets: () => (Array.isArray(state.diets) ? state.diets : []),
    normalizeAllergen,
    normalizeDietLabel,
    getDietAllergenConflicts,
    formatOrderListLabel,
    esc,
  });
  orderDishActionsRuntime = createOrderDishActionsRuntime({
    getOrderItems: () => getOrderItems(),
    writeOrderItems: (items) => writeOrderItems(items),
    getOrderItemSelections: () => getOrderItemSelections(),
    getDishCompatibilityDetails: (dishName) => getDishCompatibilityDetails(dishName),
    hasBlockingCompatibilityIssues: (details) =>
      orderDishCompatibilityRuntime.hasBlockingCompatibilityIssues(details),
    persistOrderItems: () => persistOrderItems(),
    syncOrderItemSelections: () => syncOrderItemSelections(),
    updateOrderSidebar: () => updateOrderSidebar(),
    openOrderSidebar: () => openOrderSidebar(),
    closeDishDetailsAfterAdd: () => closeDishDetailsAfterAdd(),
    onAfterRemoveDish: (dishName) => {
      const addBtn = document.querySelector(
        `.addToOrderBtn[data-dish-name="${esc(dishName)}"]`,
      );
      if (addBtn) {
        addBtn.disabled = false;
        addBtn.textContent = "Add to order";
      }
    },
  });
  orderConfirmFormRuntime = createOrderConfirmFormRuntime({
    state,
    send,
    resizeLegendToFit,
    orderConfirmForm,
    orderConfirmNameInput,
    orderConfirmAllergyChips,
    orderConfirmDietChips,
    orderConfirmNotesInput,
    orderConfirmCodeInput,
    orderConfirmAuthPrompt,
    orderConfirmSubmitBtn,
    getSupabaseClient: () => getSupabaseClient(),
    getOrderItems: () => getOrderItems(),
    writeOrderItems: (items) => writeOrderItems(items),
    hasOrderItems: () => hasOrderItems(),
    getOrderFormStateStorageKey: () => getOrderFormStateStorageKey(),
    getRestaurantSlug: () => getRestaurantSlug(),
    getLocationHref: () => getLocationHref(),
    navigateToUrl: (url) => navigateToUrl(url),
    waitForMenuOverlays,
    markOverlayDishesSelected,
    applyOverlayPulseColor,
    onUpdateOrderSidebar: () => updateOrderSidebar(),
    onOpenOrderSidebar: () => openOrderSidebar(),
    onConfirmOrder: () => confirmOrder(),
    onRerenderOrderConfirmDetails: () => rerenderOrderConfirmDetails(),
    showAlert: (message) => {
      if (typeof alert === "function") {
        alert(message);
      }
    },
  });
  orderConfirmTabletRuntime = createOrderConfirmTabletRuntime({
    orderConfirmServerPanel,
    orderConfirmKitchenPanel,
    ORDER_STATUS_DESCRIPTORS,
    TABLET_ORDER_STATUSES,
    serverPanelState,
    getTabletSimState: () => tabletSimState,
    ensureOrderServerMetadata,
    getBadgeClassForTone,
    formatOrderListLabel,
    formatTabletTimestamp,
    getTabletOrderById,
    persistTabletStateAndRender,
    tabletServerApprove,
    tabletServerDispatchToKitchen,
    tabletServerReject,
    tabletKitchenAcknowledge,
    esc,
    escapeAttribute,
    escapeConfirmationHtml,
    showAlert: (message) => {
      if (typeof alert === "function") {
        alert(message);
      }
    },
  });
  orderNoticeUpdatesRuntime = createOrderNoticeUpdatesRuntime({
    state,
    ORDER_UPDATE_MESSAGES,
    esc,
    onOpenOrderSidebar: () => openOrderSidebar(),
    onRenderOrderSidebarStatus: (order) => renderOrderSidebarStatus(order),
  });
  orderStatusSyncRuntime = createOrderStatusSyncRuntime({
    getCurrentRestaurantId: () => state.restaurant?._id || state.restaurant?.id || null,
    isEditorPage: () => state.page === "editor",
    fetchOrdersForRestaurant: async (restaurantId) => {
      if (!restaurantId) return [];
      return fetchTabletOrders([restaurantId]);
    },
    getDismissedOrderIds: () => getDismissedOrderIds(),
    isOrderActiveForBadge,
    pickMostRecentOrder,
    handleNoticeUpdates: (orders) => handleNoticeUpdates(orders),
    getOrders: () => (Array.isArray(tabletSimState.orders) ? tabletSimState.orders : []),
    setOrders: (orders) => {
      tabletSimState.orders = Array.isArray(orders) ? orders : [];
    },
    getCurrentOrderId: () => tabletSimOrderId,
    setCurrentOrderId: (orderId) => {
      tabletSimOrderId = orderId || null;
    },
    persistTabletStateSnapshot: () => persistTabletStateSnapshot(),
    renderOrderSidebarStatus: (order) => renderOrderSidebarStatus(order),
    updateOrderSidebarBadge: () => updateOrderSidebarBadge(),
    minimizeOrderSidebar: () => minimizeOrderSidebar(),
    onActiveOrderDetected: () => {
      state.ack = true;
      const ackBtn = document.getElementById("ackBtn");
      if (ackBtn) {
        ackBtn.textContent = "Acknowledged";
        ackBtn.classList.remove("off");
        ackBtn.classList.add("on");
      }
    },
    logError: (message, error) => {
      console.error(message, error);
    },
  });
  orderConfirmUiRuntime = createOrderConfirmUiRuntime({
    state,
    orderConfirmDrawer,
    orderConfirmCloseBtn,
    orderConfirmSummaryList,
    orderConfirmEmptySummary,
    orderConfirmStatusBadge,
    orderConfirmForm,
    orderConfirmNameInput,
    orderConfirmDeliveryInput,
    orderConfirmAllergyChips,
    orderConfirmDietChips,
    orderConfirmNotesInput,
    orderConfirmCodeInput,
    orderConfirmSubmitBtn,
    orderConfirmSubmitStatus,
    orderConfirmResetBtn,
    orderConfirmSignInBtn,
    orderConfirmSignUpBtn,
    orderConfirmServerPanel,
    orderConfirmKitchenPanel,
    getSelectedOrderItems: () => getSelectedOrderItems(),
    createDishSummaryCard: (dishName) => createDishSummaryCard(dishName),
    formatOrderListLabel,
    getAllergenEmoji,
    getDietEmoji,
    onBindOrderConfirmModeSwitcher: () => bindOrderConfirmModeSwitcher(),
    onHandleOrderConfirmSubmit: () => handleOrderConfirmSubmit(),
    onHandleOrderConfirmReset: () => handleOrderConfirmReset(),
    onHandleSignInClick: () => handleSignInClick(),
    onHandleSignUpClick: () => handleSignUpClick(),
    onHandleOrderConfirmServerPanel: (event) => handleOrderConfirmServerPanel(event),
    onHandleOrderConfirmKitchenPanel: (event) => handleOrderConfirmKitchenPanel(event),
    onUpdateOrderConfirmAuthState: () => updateOrderConfirmAuthState(),
    onUpdateOrderConfirmModeVisibility: () => updateOrderConfirmModeVisibility(),
    onRenderOrderConfirmServerPanel: () => renderOrderConfirmServerPanel(),
    onRenderOrderConfirmKitchenPanel: () => renderOrderConfirmKitchenPanel(),
    onRenderOrderSidebarStatus: (order) => renderOrderSidebarStatus(order),
    onPersistTabletStateSnapshot: () => persistTabletStateSnapshot(),
    onGetTabletOrder: () => getTabletOrder(),
    onApplyDefaultUserName: () => applyDefaultUserName(),
    onResetOrders: () => {
      tabletSimState = createTabletInitialState();
      tabletSimOrderId = null;
    },
    onResetServerPanelState: () => {
      serverPanelState.activeServerId = null;
    },
  });

  initializeOrderConfirmDrawer();
  setOpenOrderConfirmDrawer(openOrderConfirmDrawer);

  function applyDefaultUserName(force = false) {
    return orderConfirmFormRuntime.applyDefaultUserName(force);
  }

  async function checkUserAuth() {
    return orderConfirmFormRuntime.checkUserAuth();
  }

  function saveOrderFormState() {
    return orderConfirmFormRuntime.saveOrderFormState();
  }

  function restoreOrderFormState() {
    return orderConfirmFormRuntime.restoreOrderFormState();
  }

  function handleSignInClick() {
    return orderConfirmFormRuntime.handleSignInClick();
  }

  function handleSignUpClick() {
    return orderConfirmFormRuntime.handleSignUpClick();
  }

  async function updateOrderConfirmAuthState() {
    return orderConfirmFormRuntime.updateOrderConfirmAuthState();
  }

  function rerenderOrderConfirmDetails() {
    return orderConfirmUiRuntime.rerenderOrderConfirmDetails();
  }

  function initializeOrderConfirmDrawer() {
    return orderConfirmUiRuntime.initializeOrderConfirmDrawer();
  }

  function openOrderConfirmDrawer() {
    return orderConfirmUiRuntime.openOrderConfirmDrawer();
  }

  function closeOrderConfirmDrawer() {
    return orderConfirmUiRuntime.closeOrderConfirmDrawer();
  }

  function resetOrderConfirmFlow(options = {}) {
    return orderConfirmUiRuntime.resetOrderConfirmFlow(options);
  }

  function renderOrderConfirmSummary() {
    return orderConfirmUiRuntime.renderOrderConfirmSummary();
  }

  function renderOrderConfirmAllergies() {
    return orderConfirmUiRuntime.renderOrderConfirmAllergies();
  }

  function renderOrderConfirmDiets() {
    return orderConfirmUiRuntime.renderOrderConfirmDiets();
  }

  function getDismissedOrderIds() {
    return orderSidebarStateRuntime.getDismissedOrderIds();
  }

  function dismissOrderId(orderId) {
    return orderSidebarStateRuntime.dismissOrderId(orderId);
  }

  function resetOrderSidebarAutoState() {
    return orderSidebarStateRuntime.resetOrderSidebarAutoState();
  }

  function shouldShowClearOrderButton(order) {
    return orderSidebarStateRuntime.shouldShowClearOrderButton(order);
  }

  function maybeAutoMinimizeSidebar(order) {
    return orderSidebarStateRuntime.maybeAutoMinimizeSidebar(order);
  }

  function getSidebarOrders() {
    return orderSidebarStateRuntime.getSidebarOrders();
  }

  function handleNoticeUpdates(orders) {
    orderNoticeUpdatesRuntime?.handleNoticeUpdates(orders);
  }

  function renderOrderSidebarStatus(order) {
    if (!orderSidebarStatus || !orderSidebarStatusBadge) {
      return;
    }
    const hasItems = hasOrderItems();
    const sidebarOrders = getSidebarOrders();

    if (
      rescindConfirmOrderId &&
      !sidebarOrders.some((o) => o.id === rescindConfirmOrderId)
    ) {
      rescindConfirmOrderId = null;
    }

    if (
      !sidebarOrders.length &&
      orderSidebarItems?.dataset.mode === "cleared" &&
      !hasItems
    ) {
      updateOrderSidebarBadge();
      setOrderSidebarVisibility();
      return;
    }

    const activeSidebarOrders = sidebarOrders.filter((o) =>
      isOrderActiveForBadge(o),
    );
    const primaryOrder =
      pickMostRecentOrder(activeSidebarOrders) ||
      pickMostRecentOrder(sidebarOrders);
    maybeAutoMinimizeSidebar(primaryOrder);

    if (!primaryOrder) {
      orderSidebarStatus.hidden = true;
      orderSidebarStatusBadge.dataset.tone = "idle";
      orderSidebarStatusBadge.textContent = "Waiting for server code";
      if (orderSidebarItems) {
        orderSidebarItems.dataset.mode = "cart";
        updateOrderSidebar();
      }
      updateConfirmButtonVisibility();
      updateOrderSidebarBadge();
      return;
    }

    const descriptor = ORDER_STATUS_DESCRIPTORS[primaryOrder.status] || {
      label: primaryOrder.status,
      tone: "idle",
    };
    orderSidebarStatus.hidden = true;
    orderSidebarStatusBadge.dataset.tone = descriptor.tone || "idle";
    orderSidebarStatusBadge.textContent = descriptor.label || "Updating status";
    renderOrderSidebarPendingOrders(sidebarOrders);
    updateOrderSidebarBadge();
    setOrderSidebarVisibility();
  }

  function renderOrderSidebarPendingOrders(orders) {
    return orderSidebarPendingRuntime.renderOrderSidebarPendingOrders(orders);
  }

  function renderOrderSidebarPendingOrder(order) {
    if (!order) {
      renderOrderSidebarPendingOrders([]);
      return;
    }
    renderOrderSidebarPendingOrders([order]);
  }

  function renderOrderSidebarRescindedNotice(orderId) {
    if (!orderId) {
      renderOrderSidebarStatus(null);
      return;
    }
    const order = getTabletOrderById(orderId);
    if (!order) {
      renderOrderSidebarStatus(null);
      return;
    }
    renderOrderSidebarPendingOrders([order]);
  }

  function renderOrderConfirm() {
    renderOrderConfirmSummary();
    renderOrderConfirmServerPanel();
    renderOrderConfirmKitchenPanel();
    renderOrderConfirmAllergies();
    renderOrderConfirmDiets();
    const order = getTabletOrder();
    renderOrderSidebarStatus(order);
    if (!order) {
      setOrderConfirmStatusBadge("Waiting for server code", "idle");
      orderConfirmResetBtn?.setAttribute("hidden", "");
      return;
    }
    const descriptor = ORDER_STATUS_DESCRIPTORS[order.status] || {
      label: order.status,
      tone: "idle",
    };
    setOrderConfirmStatusBadge(descriptor.label, descriptor.tone);
    if (
      order.status === TABLET_ORDER_STATUSES.ACKNOWLEDGED ||
      order.status === TABLET_ORDER_STATUSES.QUESTION_ANSWERED
    ) {
      orderConfirmResetBtn?.removeAttribute("hidden");
    }
  }

  function renderOrderConfirmServerPanel() {
    orderConfirmTabletRuntime?.renderOrderConfirmServerPanel();
  }

  function renderOrderConfirmKitchenPanel() {
    orderConfirmTabletRuntime?.renderOrderConfirmKitchenPanel();
  }

  async function handleOrderConfirmSubmit() {
    if (!orderConfirmForm) return;
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
      setStatusMessage(
        orderConfirmSubmitStatus,
        "Please sign in or create an account to submit your notice.",
        "error",
      );
      return;
    }
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
    if (!user) {
      setStatusMessage(
        orderConfirmSubmitStatus,
        "Please sign in or create an account to submit your notice.",
        "error",
      );
      if (orderConfirmAuthPrompt) orderConfirmAuthPrompt.style.display = "block";
      return;
    }
    setStatusMessage(orderConfirmSubmitStatus, "");
    const name = (orderConfirmNameInput?.value || "").trim();
    if (!name) {
      setStatusMessage(
        orderConfirmSubmitStatus,
        "Enter your name so the team knows who submitted this.",
        "error",
      );
      orderConfirmNameInput?.focus();
      return;
    }
    const diningMode =
      orderConfirmForm.elements["orderConfirmMode"]?.value || "dine-in";
    const codeValue =
      diningMode === "dine-in" ? (orderConfirmCodeInput?.value || "").trim() : "";
    if (diningMode === "dine-in" && !codeValue) {
      setStatusMessage(
        orderConfirmSubmitStatus,
        "Enter the code your server shared when they're ready.",
        "error",
      );
      orderConfirmCodeInput?.focus();
      return;
    }
    const deliveryValue = (orderConfirmDeliveryInput?.value || "").trim();
    const allergies = Array.isArray(state.allergies) ? [...state.allergies] : [];
    const diets = Array.isArray(state.diets) ? [...state.diets] : [];
    const customNotes = (orderConfirmNotesInput?.value || "").trim();
    const selectedItems = getSelectedOrderItems();
    if (!selectedItems.length) {
      setStatusMessage(
        orderConfirmSubmitStatus,
        "Select at least one item to submit.",
        "error",
      );
      return;
    }
    const dishesSummary = selectedItems.join(", ");
    const codeMeta = diningMode === "dine-in" ? parseServerCode(codeValue) : null;
    const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
    if (!restaurantId) {
      setStatusMessage(
        orderConfirmSubmitStatus,
        "Unable to identify the restaurant for this notice.",
        "error",
      );
      return;
    }
    try {
      let order = getTabletOrder();
      const hasSubmittedOrder =
        order && order.status !== TABLET_ORDER_STATUSES.CODE_ASSIGNED;
      if (hasSubmittedOrder) {
        order = null;
      }
      if (!order) {
        const draft = createTabletOrderDraft({
          customerName: name,
          restaurantName: state.restaurant?.name || "Unknown restaurant",
          diningMode,
          tableOrPickup: "",
          deliveryAddress: diningMode === "delivery" ? deliveryValue : "",
          allergies,
          customNotes,
        });
        if (user) {
          draft.userId = user.id;
        }
        draft.diets = diets;
        if (dishesSummary) {
          draft.history.push({
            at: new Date().toISOString(),
            actor: "Diner",
            message: `Selected dishes: ${dishesSummary}`,
          });
        }
        const allergyMessage = allergies.length
          ? `Flagged allergens: ${allergies
              .map((allergen) => formatOrderListLabel(allergen))
              .join(", ")}`
          : "No allergens selected; sending confirmation request.";
        draft.history.push({
          at: new Date().toISOString(),
          actor: "Diner",
          message: allergyMessage,
        });
        const dietsMessage = diets.length
          ? `Diets: ${diets.join(", ")}`
          : "No diets selected.";
        draft.history.push({
          at: new Date().toISOString(),
          actor: "Diner",
          message: dietsMessage,
        });
        if (customNotes) {
          draft.history.push({
            at: new Date().toISOString(),
            actor: "Diner",
            message: `Additional note: "${customNotes}"`,
          });
        }
        if (diningMode === "dine-in") {
          order = tabletRequestServerCode(tabletSimState, draft, {
            code: codeValue,
          });
          tabletSimOrderId = order.id;
        } else {
          // For delivery/pickup, create order without server code
          order = {
            ...draft,
            status: TABLET_ORDER_STATUSES.CODE_ASSIGNED,
            createdAt: new Date().toISOString(),
          };
          tabletSimOrderId = order.id;
          tabletSimState.orders.push(order);
        }
      }
      order.items = [...selectedItems];
      order.diets = diets;
      order.restaurantId = restaurantId;
      if (user && !order.userId) {
        order.userId = user.id;
      }
      if (diningMode === "dine-in" && codeMeta) {
        order.tableNumber = codeMeta.tableNumber;
        order.serverId = codeMeta.serverId;
        order.serverName = codeMeta.serverName;
        ensureOrderServerMetadata(order);
        serverPanelState.activeServerId = order.serverId;
        tabletSubmitOrderToServer(tabletSimState, tabletSimOrderId, codeValue);
      } else if (diningMode === "delivery") {
        // For delivery, send directly to the kitchen tablet
        const submittedAt = new Date().toISOString();
        order.status = TABLET_ORDER_STATUSES.WITH_KITCHEN;
        order.submittedAt = submittedAt;
        order.updatedAt = submittedAt;
        if (!Array.isArray(order.history)) {
          order.history = [];
        }
        order.history.push({
          at: submittedAt,
          actor: "Diner",
          message: "Submitted delivery notice directly to kitchen tablet.",
        });
      }
      await saveTabletOrder(order, { restaurantId });
      if (orderConfirmCodeInput) orderConfirmCodeInput.disabled = true;
      if (orderConfirmSubmitBtn) orderConfirmSubmitBtn.disabled = true;
      const submitSuccessMessage =
        diningMode === "delivery"
          ? "Order sent to kitchen tablet."
          : "Order submitted to server station.";
      setStatusMessage(orderConfirmSubmitStatus, submitSuccessMessage, "success");
      state.ack = true;
      const ackBtn = document.getElementById("ackBtn");
      if (ackBtn) {
        ackBtn.textContent = "Acknowledged";
        ackBtn.classList.remove("off");
        ackBtn.classList.add("on");
      }
      persistTabletStateAndRender();
      // Clear order items from localStorage since notice has been submitted
      const submittedSet = new Set(selectedItems);
      writeOrderItems(getOrderItems().filter((item) => !submittedSet.has(item)));
      submittedSet.forEach((item) => getOrderItemSelections().delete(item));
      persistOrderItems();
      updateOrderSidebar();
      closeOrderConfirmDrawer();
      orderSidebarStateRuntime.forceOpenForOrder(order.id);
      openOrderSidebar();
      renderOrderSidebarStatus(order);
      startOrderRefresh();
    } catch (error) {
      console.error("Failed to submit order to server", error);
      setStatusMessage(
        orderConfirmSubmitStatus,
        error?.message || "Unable to notify the server tablet right now.",
        "error",
      );
    }
  }

  function handleOrderConfirmServerPanel(evt) {
    orderConfirmTabletRuntime?.handleOrderConfirmServerPanel(evt);
  }

  function handleOrderConfirmKitchenPanel(evt) {
    orderConfirmTabletRuntime?.handleOrderConfirmKitchenPanel(evt);
  }

  function handleOrderConfirmReset() {
    renderOrderConfirmSummary();
    resetOrderConfirmFlow({ preserveOrders: false });
    renderOrderConfirmAllergies();
    renderOrderConfirmDiets();
  }

  function handleRescindNotice(evt) {
    const btn = evt.target.closest(".orderSidebarRescindBtn");
    if (!btn) return;
    const orderId = btn.getAttribute("data-order-id");
    if (!orderId) return;
    rescindConfirmOrderId = orderId;
    renderOrderSidebarStatus(null);
  }

  async function handleRescindConfirm(evt) {
    const btn = evt.target.closest(".orderSidebarRescindConfirmBtn");
    if (!btn) return;
    const orderId = btn.getAttribute("data-order-id");
    if (!orderId) return;
    await performRescindNotice(orderId);
  }

  function handleRescindCancel(evt) {
    const btn = evt.target.closest(".orderSidebarRescindCancelBtn");
    if (!btn) return;
    rescindConfirmOrderId = null;
    renderOrderSidebarStatus(null);
  }

  async function performRescindNotice(orderId) {
    try {
      const order = getTabletOrderById(orderId);
      if (!order) {
        throw new Error("Order not found.");
      }
      const now = new Date().toISOString();
      order.status = TABLET_ORDER_STATUSES.RESCINDED_BY_DINER;
      order.rescindedAt = now;
      order.updatedAt = now;
      if (!Array.isArray(order.history)) {
        order.history = [];
      }
      order.history.push({
        at: now,
        actor: "Diner",
        message: "Rescinded the notice.",
      });
      const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
      if (restaurantId) {
        await saveTabletOrder(order, { restaurantId });
      }
      if (tabletSimOrderId === orderId) {
        const remainingOrders = tabletSimState.orders.filter(
          (o) => o.id !== orderId,
        );
        const nextOrder = pickMostRecentOrder(
          remainingOrders.filter((o) => isOrderActiveForBadge(o)),
        );
        tabletSimOrderId = nextOrder ? nextOrder.id : null;
        if (!tabletSimOrderId) {
          stopOrderRefresh();
        }
      }
      rescindConfirmOrderId = null;
      persistTabletStateSnapshot();
      renderOrderSidebarStatus(null);
    } catch (error) {
      console.error("Failed to rescind notice", error);
      alert("Unable to rescind the notice right now. Please try again.");
    }
  }

  function handleClearOrderFromSidebar(evt) {
    const btn = evt.target.closest(".orderSidebarClearBtn");
    if (!btn) return;
    const orderId = btn.getAttribute("data-order-id");
    if (orderId) {
      if (rescindConfirmOrderId === orderId) {
        rescindConfirmOrderId = null;
      }
      if (tabletSimOrderId === orderId) {
        const remainingOrders = tabletSimState.orders.filter(
          (o) => o.id !== orderId,
        );
        const nextOrder = pickMostRecentOrder(
          remainingOrders.filter((o) => isOrderActiveForBadge(o)),
        );
        tabletSimOrderId = nextOrder ? nextOrder.id : null;
        if (!tabletSimOrderId) {
          stopOrderRefresh();
        }
      }
      const orderIndex = tabletSimState.orders.findIndex((o) => o.id === orderId);
      if (orderIndex !== -1) {
        tabletSimState.orders.splice(orderIndex, 1);
      }
      dismissOrderId(orderId);
      persistTabletStateSnapshot();
    }
    resetOrderSidebarAutoState();
    renderOrderSidebarStatus(null);
  }

  async function handleKitchenQuestionResponse(evt) {
    const btn = evt.target.closest(".orderSidebarQuestionBtn");
    if (!btn) return;
    const orderId = btn.getAttribute("data-order-id");
    const response = btn.getAttribute("data-response");
    if (!orderId || !response || !["yes", "no"].includes(response)) return;
    try {
      const order = getTabletOrderById(orderId);
      if (!order) return;
      if (!order.kitchenQuestion) {
        const derivedQuestion = getKitchenQuestion(order);
        if (derivedQuestion) {
          order.kitchenQuestion = derivedQuestion;
        }
      }
      if (!order.kitchenQuestion) return;
      tabletUserRespondToQuestion(tabletSimState, orderId, response);
      const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
      if (restaurantId) {
        await saveTabletOrder(order, { restaurantId });
      }
      persistTabletStateAndRender();
      renderOrderSidebarStatus(null);
    } catch (error) {
      console.error("Failed to respond to kitchen question", error);
      alert("Unable to send your response right now. Please try again.");
    }
  }

  async function checkForActiveOrders() {
    return orderStatusSyncRuntime?.checkForActiveOrders();
  }

  function bindOrderConfirmModeSwitcher() {
    return orderConfirmFormRuntime.bindOrderConfirmModeSwitcher();
  }

  function updateOrderConfirmModeVisibility() {
    return orderConfirmFormRuntime.updateOrderConfirmModeVisibility();
  }

  function getTabletOrder() {
    const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
    if (!restaurantId) return null;
    let order = tabletSimOrderId
      ? tabletSimState.orders.find((order) => order.id === tabletSimOrderId) ||
        null
      : null;
    if (!order) {
      const activeOrders = getSidebarOrders().filter((o) =>
        isOrderActiveForBadge(o),
      );
      order =
        pickMostRecentOrder(activeOrders) ||
        pickMostRecentOrder(getSidebarOrders());
      if (order) {
        tabletSimOrderId = order.id;
      }
    }
    // Only return order if it belongs to the current restaurant
    if (order && order.restaurantId && order.restaurantId !== restaurantId) {
      // Order belongs to a different restaurant - clear it
      tabletSimOrderId = null;
      const index = tabletSimState.orders.indexOf(order);
      if (index > -1) {
        tabletSimState.orders.splice(index, 1);
      }
      persistTabletStateSnapshot();
      return null;
    }
    return order;
  }

  function setOrderConfirmStatusBadge(label, tone = "idle") {
    return orderConfirmUiRuntime.setOrderConfirmStatusBadge(label, tone);
  }

  function setStatusMessage(target, message, variant) {
    return orderConfirmUiRuntime.setStatusMessage(target, message, variant);
  }

  function deepCloneArray(value) {
    try {
      return JSON.parse(JSON.stringify(Array.isArray(value) ? value : []));
    } catch (error) {
      console.warn("Failed to clone tablet state array", error);
      return [];
    }
  }

  function persistTabletStateSnapshot() {
    const payload = persistTabletState({
      orders: tabletSimState.orders,
      chefs: tabletSimState.chefs,
      lastServerCode: tabletSimState.lastServerCode,
      currentOrderId: tabletSimOrderId,
    });
    if (payload) {
      tabletStateUpdatedAt = payload.updatedAt || Date.now();
    }
    return payload;
  }

  function persistTabletStateAndRender() {
    persistTabletStateSnapshot();
    renderOrderConfirm();
  }

  function formatOrderListLabel(value) {
    return formatPreferenceLabel(value);
  }

  function getDishCompatibilityDetails(dishName) {
    return orderDishCompatibilityRuntime.getDishCompatibilityDetails(dishName);
  }

  function createDishSummaryCard(dishName) {
    return orderDishCompatibilityRuntime.createDishSummaryCard(dishName);
  }

  function buildAddToOrderWarningMessage(dishName, details) {
    return orderDishCompatibilityRuntime.buildAddToOrderWarningMessage(
      dishName,
      details,
    );
  }

  function deriveKitchenQuestionFromHistory(order) {
    const history = Array.isArray(order?.history) ? order.history : [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const entry = history[i];
      if (!entry?.message) continue;
      const actor = String(entry.actor || "").toLowerCase();
      if (actor && actor !== "kitchen") continue;
      const match = String(entry.message).match(
        /Sent a yes\/no question:\\s*\"([^\"]+)\"/i,
      );
      if (match && match[1]) {
        return {
          text: match[1],
          response: null,
          askedAt: entry.at || null,
        };
      }
    }
    return null;
  }

  function getKitchenQuestion(order) {
    if (order?.kitchenQuestion) return order.kitchenQuestion;
    return deriveKitchenQuestionFromHistory(order);
  }

  function getBadgeClassForTone(tone) {
    switch (tone) {
      case "success":
        return "orderConfirmDishBadge orderConfirmDishBadge--success";
      case "warn":
        return "orderConfirmDishBadge orderConfirmDishBadge--warn";
      case "danger":
        return "orderConfirmDishBadge orderConfirmDishBadge--danger";
      default:
        return "orderConfirmDishBadge orderConfirmDishBadge--info";
    }
  }

  function ensureAddToOrderConfirmContainer(tipEl) {
    let container = tipEl.querySelector(".addToOrderConfirm");
    if (container) return container;
    container = document.createElement("div");
    container.className = "addToOrderConfirm";
    container.style.display = "none";
    container.innerHTML = `
  <p data-role="message"></p>
  <div class="addToOrderConfirmActions">
    <button type="button" class="addToOrderConfirmCancel">Keep browsing</button>
    <button type="button" class="addToOrderConfirmProceed">Add anyway</button>
  </div>
    `;
    tipEl.appendChild(container);
    const cancelBtn = container.querySelector(".addToOrderConfirmCancel");
    const proceedBtn = container.querySelector(".addToOrderConfirmProceed");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", (event) => {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        hideAddToOrderConfirmation(container);
      });
    }
    if (proceedBtn) {
      proceedBtn.addEventListener("click", (event) => {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        const dishName = container.dataset.dishName;
        if (!dishName) return;
        const result = addDishToOrder(dishName, { force: true });
        if (result?.success) {
          hideAddToOrderConfirmation(container);
          const btn = container.__addBtn;
          if (btn) {
            btn.disabled = true;
            btn.textContent = "Added";
          }
        }
      });
    }
    return container;
  }

  function showAddToOrderConfirmation(container, dishName, details, addButton) {
    if (!container) return;
    container.__addBtn = addButton || null;
    const messageEl = container.querySelector('[data-role="message"]');
    const proceedBtn = container.querySelector(".addToOrderConfirmProceed");
    container.dataset.dishName = dishName;
    container.dataset.severity = details.severity || "warn";
    if (messageEl) {
      messageEl.textContent = buildAddToOrderWarningMessage(dishName, details);
    }
    if (proceedBtn) {
      const isWarn = details.severity === "warn";
      proceedBtn.classList.toggle("warn", isWarn);
      proceedBtn.textContent = isWarn ? "Add with adjustments" : "Add anyway";
    }
    container.style.display = "flex";
  }

  function hideAddToOrderConfirmation(container) {
    if (!container) return;
    container.style.display = "none";
    container.dataset.dishName = "";
    container.dataset.severity = "";
  }

  const SERVER_CODE_PREFIX_LENGTH = 4;
  function parseServerCode(code) {
    const raw = String(code || "").trim();
    if (!raw) {
      return {
        serverId: "0000",
        tableNumber: "",
        serverName: "Server",
      };
    }
    const prefix = raw.slice(0, SERVER_CODE_PREFIX_LENGTH) || "0000";
    const remainder = raw.slice(SERVER_CODE_PREFIX_LENGTH).trim();
    return {
      serverId: prefix,
      tableNumber: remainder || "",
      serverName: `Server ${prefix}`,
    };
  }

  function ensureOrderServerMetadata(order) {
    if (!order) return null;
    if (order.serverId && order.serverName) return order;
    const parsed = parseServerCode(order.serverCode);
    order.serverId = order.serverId || parsed.serverId;
    order.serverName = order.serverName || parsed.serverName;
    if (typeof order.tableNumber === "undefined") {
      order.tableNumber = parsed.tableNumber;
    }
    return order;
  }

  function getTabletOrderById(orderId) {
    if (!orderId) return null;
    return tabletSimState.orders.find((order) => order.id === orderId) || null;
  }

  function formatTabletTimestamp(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function escapeConfirmationHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttribute(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;");
  }

  function getRestaurantSlug() {
    return orderItemStateRuntime.getRestaurantSlug();
  }

  function getOrderItemsStorageKey() {
    return orderItemStateRuntime.getOrderItemsStorageKey();
  }

  function getOrderFormStateStorageKey() {
    return orderItemStateRuntime.getOrderFormStateStorageKey();
  }

  // Order management functions
  function persistOrderItems() {
    return orderItemStateRuntime.persistOrderItems();
  }

  function restoreOrderItems() {
    return orderItemStateRuntime.restoreOrderItems();
  }

  function getOrderItemSelections() {
    return orderItemStateRuntime.getOrderItemSelections();
  }

  function clearOrderItemSelections() {
    return orderItemStateRuntime.clearOrderItemSelections();
  }

  function syncOrderItemSelections() {
    return orderItemStateRuntime.syncOrderItemSelections();
  }

  function isOrderItemSelected(dishName) {
    return orderItemStateRuntime.isOrderItemSelected(dishName);
  }

  function toggleOrderItemSelection(dishName) {
    orderItemStateRuntime.toggleOrderItemSelection(dishName);
    updateConfirmButtonVisibility();
    orderSidebarUiRuntime.syncConfirmDrawerSummary();
  }

  function getSelectedOrderItems() {
    return orderItemStateRuntime.getSelectedOrderItems();
  }

  function closeDishDetailsAfterAdd() {
    const dishInfo = document.getElementById("zoomedDishInfo");
    if (dishInfo) {
      dishInfo.classList.remove("show");
    }
    if (typeof renderMobileInfo === "function") {
      renderMobileInfo(null);
    } else {
      const mobilePanel = document.getElementById("mobileInfoPanel");
      if (mobilePanel) {
        mobilePanel.classList.remove("show");
        mobilePanel.style.display = "none";
        mobilePanel.innerHTML = "";
      }
    }
  }

  function addDishToOrder(dishName, options = {}) {
    return orderDishActionsRuntime.addDishToOrder(dishName, options);
  }

  function removeDishFromOrder(dishName) {
    return orderDishActionsRuntime.removeDishFromOrder(dishName);
  }

  function updateOrderSidebar() {
    const sidebarOrders = getSidebarOrders();
    if (sidebarOrders.length) {
      renderOrderSidebarPendingOrders(sidebarOrders);
      updateOrderSidebarBadge();
      setOrderSidebarVisibility();
      return;
    }
    const rendered = orderSidebarCartRuntime?.renderOrderSidebarCart();
    if (!rendered) {
      return;
    }

    orderSidebarUiRuntime.syncConfirmDrawerSummary();

    updateOrderSidebarBadge();
    setOrderSidebarVisibility();
  }

  function isOrderSidebarDisabled() {
    return orderSidebarUiRuntime.isOrderSidebarDisabled();
  }

  function hasOrderSidebarContent() {
    return orderSidebarUiRuntime.hasOrderSidebarContent();
  }

  function setOrderSidebarVisibility() {
    return orderSidebarUiRuntime.setOrderSidebarVisibility();
  }

  function pickMostRecentOrder(orders) {
    return orderSidebarStateRuntime.pickMostRecentOrder(orders);
  }

  function isOrderActiveForBadge(order) {
    return orderSidebarStateRuntime.isOrderActiveForBadge(order);
  }

  function getActiveOrderCount() {
    return orderSidebarStateRuntime.getActiveOrderCount();
  }

  function updateOrderSidebarBadge() {
    return orderSidebarUiRuntime.updateOrderSidebarBadge();
  }

  function setConfirmButtonVisibility(visible) {
    return orderSidebarUiRuntime.setConfirmButtonVisibility(visible);
  }

  function setConfirmButtonDisabled(disabled) {
    return orderSidebarUiRuntime.setConfirmButtonDisabled(disabled);
  }

  function updateOrderSidebarHeight() {
    return orderSidebarUiRuntime.updateOrderSidebarHeight();
  }

  function initOrderSidebarDrag() {
    return orderSidebarUiRuntime.initOrderSidebarDrag();
  }

  function updateConfirmButtonVisibility() {
    return orderSidebarUiRuntime.updateConfirmButtonVisibility();
  }

  function minimizeOrderSidebar() {
    return orderSidebarUiRuntime.minimizeOrderSidebar();
  }

  function openOrderSidebar() {
    return orderSidebarUiRuntime.openOrderSidebar();
  }

  function toggleOrderSidebar() {
    return orderSidebarUiRuntime.toggleOrderSidebar();
  }

  function confirmOrder() {
    const selectedItems = getSelectedOrderItems();
    if (!selectedItems.length) {
      alert("Select at least one item to submit.");
      return;
    }
    openOrderConfirmDrawer();
  }

  async function refreshOrderStatus() {
    return orderStatusSyncRuntime?.refreshOrderStatus();
  }

  function startOrderRefresh() {
    return orderStatusSyncRuntime?.startOrderRefresh();
  }

  function stopOrderRefresh() {
    return orderStatusSyncRuntime?.stopOrderRefresh();
  }

  function initOrderSidebar() {
    orderStatusSyncRuntime?.scopeOrdersToCurrentRestaurant();

    const confirmBtn = document.getElementById("confirmOrderBtn");
    const refreshBtn = document.getElementById("orderSidebarRefreshBtn");
    const sidebar = document.getElementById("orderSidebar");

    setOrderSidebarVisibility();
    updateOrderSidebarHeight();
    addWindowResizeListener(updateOrderSidebarHeight);
    initOrderSidebarDrag();

    if (confirmBtn) {
      confirmBtn.addEventListener("click", (e) => {
        e.preventDefault();
        confirmOrder();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        refreshBtn.disabled = true;
        refreshBtn.textContent = "↻";
        refreshBtn.style.opacity = "0.6";
        try {
          await refreshOrderStatus();
        } finally {
          setTimeout(() => {
            refreshBtn.disabled = false;
            refreshBtn.style.opacity = "1";
          }, 500);
        }
      });
    }

    updateOrderSidebarBadge();

    // Restore order items from localStorage if they exist
    const hasRestoredItems = restoreOrderItems();
    if (hasRestoredItems && hasOrderItems()) {
      // Visually restore selected dishes in the menu
      waitForMenuOverlays({
        initialDelayMs: 500,
        onReady: () => {
          markOverlayDishesSelected(getOrderItems(), {
            setOverlayPulseColor: applyOverlayPulseColor,
          });
          updateOrderSidebar();
          openOrderSidebar();
        },
      });
    } else {
      // Initialize sidebar state
      updateOrderSidebar();
    }

    // Start periodic refresh if there's an active order
    if (tabletSimOrderId) {
      startOrderRefresh();
      const order = getTabletOrderById(tabletSimOrderId);
      if (order) {
        state.ack = true;
        const ackBtn = document.getElementById("ackBtn");
        if (ackBtn) {
          ackBtn.textContent = "Acknowledged";
          ackBtn.classList.remove("off");
          ackBtn.classList.add("on");
        }
        renderOrderSidebarStatus(order);
        minimizeOrderSidebar();
      }
    } else if (state.restaurant) {
      // Check for active orders if no order is currently loaded
      setTimeout(() => checkForActiveOrders(), 1000);
    }
  }


  return {
    applyDefaultUserName,
    rerenderOrderConfirmDetails,
    renderOrderSidebarStatus,
    persistTabletStateSnapshot,
    getOrderFormStateStorageKey,
    restoreOrderFormState,
    ensureAddToOrderConfirmContainer,
    showAddToOrderConfirmation,
    hideAddToOrderConfirmation,
    addDishToOrder,
    getDishCompatibilityDetails,
    checkUserAuth,
    updateOrderConfirmAuthState,
    updateOrderSidebar,
    updateOrderSidebarBadge,
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
    initOrderSidebar,
    get tabletSimState() {
      return tabletSimState;
    },
    set tabletSimState(value) {
      tabletSimState = value;
    },
    get tabletSimOrderId() {
      return tabletSimOrderId;
    },
    set tabletSimOrderId(value) {
      tabletSimOrderId = value;
    },
  };
}
