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
import { createOrderConfirmTabletRuntime } from "./order-confirm-tablet-runtime.js";
import { createOrderNoticeUpdatesRuntime } from "./order-notice-updates-runtime.js";

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
    const items = readOrderItems();
    if (Array.isArray(items)) return items;
    return writeOrderItems([]);
  }

  function hasOrderItems() {
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
  let orderConfirmModeBound = false;
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
  const orderConfirmCodeBlock = document.getElementById("orderConfirmCodeBlock");
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
  let orderSidebarUserToggled = false;
  let orderSidebarLastOrderId = null;
  let orderSidebarAutoMinimizedOrderId = null;
  let orderSidebarForceOpenOrderId = null;
  let rescindConfirmOrderId = null;
  let orderConfirmTabletRuntime = null;
  let orderNoticeUpdatesRuntime = null;
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
      orderSidebarUserToggled = true;
    },
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
    bindOrderItemSelectButtons: (container) => bindOrderItemSelectButtons(container),
    handleRescindNotice,
    handleRescindConfirm,
    handleRescindCancel,
    handleClearOrderFromSidebar,
    handleKitchenQuestionResponse,
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

  initializeOrderConfirmDrawer();
  setOpenOrderConfirmDrawer(openOrderConfirmDrawer);

  function getSuggestedUserName() {
    if (!state.user) return "";
    const rawName =
      typeof state.user.name === "string" ? state.user.name.trim() : "";
    if (rawName) return rawName;
    const first = state.user.user_metadata?.first_name
      ? String(state.user.user_metadata.first_name).trim()
      : "";
    const last = state.user.user_metadata?.last_name
      ? String(state.user.user_metadata.last_name).trim()
      : "";
    const combined = `${first} ${last}`.trim();
    if (combined) return combined;
    const email = typeof state.user.email === "string" ? state.user.email : "";
    if (email) {
      const emailName = (email.split("@")[0] || "")
        .replace(/[_\.]+/g, " ")
        .trim();
      if (emailName) return emailName;
    }
    return "";
  }

  function applyDefaultUserName(force = false) {
    if (!orderConfirmNameInput) return;
    const current = (orderConfirmNameInput.value || "").trim();
    if (current && !force) return;
    const suggested = getSuggestedUserName();
    if (suggested) {
      orderConfirmNameInput.value = suggested;
    }
  }

  async function checkUserAuth() {
    try {
      const supabaseClient = getSupabaseClient();
      if (!supabaseClient) return false;
      const {
        data: { user },
      } = await supabaseClient.auth.getUser();
      return !!user;
    } catch (error) {
      return false;
    }
  }

  function saveOrderFormState() {
    if (!orderConfirmForm) return;
    const storageKey = getOrderFormStateStorageKey();
    const formData = {
      name: orderConfirmNameInput?.value || "",
      mode:
        orderConfirmForm.querySelector('input[name="orderConfirmMode"]:checked')
          ?.value || "dine-in",
      allergies: Array.from(
        orderConfirmAllergyChips?.querySelectorAll(".chip.selected") || [],
      ).map((c) => c.textContent.trim()),
      diets: Array.from(
        orderConfirmDietChips?.querySelectorAll(".chip.selected") || [],
      ).map((c) => c.textContent.trim()),
      notes: orderConfirmNotesInput?.value || "",
      code: orderConfirmCodeInput?.value || "",
      dishes: [...getOrderItems()],
      timestamp: Date.now(),
      restaurantSlug: getRestaurantSlug(),
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(formData));
      if (storageKey !== "orderConfirmFormState") {
        localStorage.removeItem("orderConfirmFormState");
      }
    } catch (error) {
      console.error("Failed to save order form state", error);
    }
  }

  function restoreOrderFormState() {
    try {
      const storageKey = getOrderFormStateStorageKey();
      let saved = localStorage.getItem(storageKey);
      let usedLegacyKey = false;
      if (!saved && storageKey !== "orderConfirmFormState") {
        saved = localStorage.getItem("orderConfirmFormState");
        if (saved) usedLegacyKey = true;
      }
      if (!saved) return false;
      const formData = JSON.parse(saved);
      const restaurantMatches =
        !formData?.restaurantSlug ||
        formData.restaurantSlug === getRestaurantSlug();
      if (
        !formData ||
        Date.now() - formData.timestamp > 3600000 ||
        !restaurantMatches
      ) {
        localStorage.removeItem(storageKey);
        if (usedLegacyKey) localStorage.removeItem("orderConfirmFormState");
        return false;
      }

      // Restore dishes first
      if (
        formData.dishes &&
        Array.isArray(formData.dishes) &&
        formData.dishes.length > 0
      ) {
        writeOrderItems([...formData.dishes]);
        waitForMenuOverlays({
          onReady: () => {
            markOverlayDishesSelected(formData.dishes, {
              setOverlayPulseColor: applyOverlayPulseColor,
            });
            updateOrderSidebar();
          },
        });
        updateOrderSidebar();
      }

      // Restore form fields
      if (orderConfirmNameInput) {
        if (formData.name) {
          orderConfirmNameInput.value = formData.name;
        } else if (state.user?.name) {
          orderConfirmNameInput.value = state.user.name;
        } else if (state.user?.email) {
          orderConfirmNameInput.value = (
            state.user.email.split("@")[0] || ""
          ).trim();
        }
      }
      if (formData.mode) {
        const modeRadio = orderConfirmForm?.querySelector(
          `input[name="orderConfirmMode"][value="${formData.mode}"]`,
        );
        if (modeRadio) modeRadio.checked = true;
      }
      // Note: allergies/diets chips are display-only and will be rendered when state.allergies/diets are loaded
      // They don't need to be "selected" - they just show what's in state.allergies and state.diets
      if (orderConfirmNameInput && !orderConfirmNameInput.value.trim()) {
        applyDefaultUserName();
      }
      if (orderConfirmNotesInput && formData.notes)
        orderConfirmNotesInput.value = formData.notes;
      if (orderConfirmCodeInput && formData.code)
        orderConfirmCodeInput.value = formData.code;

      // Acknowledge disclaimer
      const wasAcknowledged = state.ack;
      state.ack = true;
      const ackBtn = document.getElementById("ackBtn");
      if (ackBtn) {
        // Send ack message if not already acknowledged
        if (!wasAcknowledged && typeof send === "function") {
          send({ type: "ack" });
        }
        ackBtn.textContent = "Acknowledged";
        ackBtn.classList.remove("off");
        ackBtn.classList.add("on");
        // Show menu and legend
        const menu = document.getElementById("menu");
        if (menu) menu.classList.add("show");
        const actionButtonsRow = document.getElementById("actionButtonsRow");
        if (actionButtonsRow) actionButtonsRow.style.display = "flex";
        const legendRow = document.getElementById("legendRow");
        if (legendRow) {
          legendRow.style.display = "flex";
          setTimeout(resizeLegendToFit, 0);
        }
        const confirmedRow = document.getElementById("confirmedRow");
        if (confirmedRow) confirmedRow.style.display = "block";
      }

      // Open sidebar
      openOrderSidebar();

      // Automatically proceed to confirmation if there are dishes
      if (hasOrderItems()) {
        setTimeout(() => {
          confirmOrder();
          // Ensure summary reflects restored preferences
          setTimeout(() => {
            rerenderOrderConfirmDetails();
          }, 120);
        }, 100);
      }

      localStorage.removeItem(storageKey);
      if (storageKey !== "orderConfirmFormState") {
        localStorage.removeItem("orderConfirmFormState");
      }
      return true;
    } catch (error) {
      console.error("Failed to restore form state", error);
      return false;
    }
  }

  function handleSignInClick() {
    saveOrderFormState();
    const currentUrl = getLocationHref();
    navigateToUrl(
      `/account?redirect=${encodeURIComponent(currentUrl)}&mode=signin`,
    );
  }

  function handleSignUpClick() {
    saveOrderFormState();
    const currentUrl = getLocationHref();
    navigateToUrl(
      `/account?redirect=${encodeURIComponent(currentUrl)}&mode=signup`,
    );
  }

  async function updateOrderConfirmAuthState() {
    const isAuthenticated = await checkUserAuth();
    if (orderConfirmAuthPrompt) {
      orderConfirmAuthPrompt.style.display = isAuthenticated ? "none" : "block";
    }
    if (orderConfirmSubmitBtn) {
      orderConfirmSubmitBtn.disabled = !isAuthenticated;
    }
    if (isAuthenticated) {
      restoreOrderFormState();
      applyDefaultUserName();
    }
  }

  function rerenderOrderConfirmDetails() {
    if (!orderConfirmDrawer?.classList.contains("show")) return;
    // Re-render everything to reflect current state (especially dish summary cards)
    renderOrderConfirmSummary();
    renderOrderConfirmAllergies();
    renderOrderConfirmDiets();
  }

  function initializeOrderConfirmDrawer() {
    if (!orderConfirmDrawer) return;
    bindOrderConfirmModeSwitcher();
    orderConfirmCloseBtn?.addEventListener("click", closeOrderConfirmDrawer);
    orderConfirmDrawer.addEventListener("click", (evt) => {
      if (evt.target === orderConfirmDrawer) {
        closeOrderConfirmDrawer();
      }
    });
    document.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape" && orderConfirmDrawer.classList.contains("show")) {
        closeOrderConfirmDrawer();
      }
    });
    orderConfirmSubmitBtn?.addEventListener("click", handleOrderConfirmSubmit);
    orderConfirmResetBtn?.addEventListener("click", handleOrderConfirmReset);
    orderConfirmSignInBtn?.addEventListener("click", handleSignInClick);
    orderConfirmSignUpBtn?.addEventListener("click", handleSignUpClick);

    updateOrderConfirmAuthState();
    orderConfirmServerPanel?.addEventListener(
      "click",
      handleOrderConfirmServerPanel,
    );
    orderConfirmKitchenPanel?.addEventListener(
      "click",
      handleOrderConfirmKitchenPanel,
    );
  }

  function openOrderConfirmDrawer() {
    if (!orderConfirmDrawer) return;
    console.log("[order-confirm] Opening confirmation drawer");
    renderOrderConfirmSummary();
    resetOrderConfirmFlow({ preserveOrders: true });
    applyDefaultUserName();
    renderOrderConfirmAllergies();
    renderOrderConfirmDiets();
    updateOrderConfirmAuthState();
    orderConfirmDrawer.classList.add("show");
    orderConfirmDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("orderConfirmOpen");
    setTimeout(() => orderConfirmNameInput?.focus(), 60);
    // Re-render after a delay to catch any allergies/diets that arrive after drawer opens
    setTimeout(() => {
      if (orderConfirmDrawer?.classList.contains("show")) {
        rerenderOrderConfirmDetails();
        // Also ensure name is populated from user account if not already set
        if (orderConfirmNameInput && !orderConfirmNameInput.value) {
          if (state.user?.name) {
            orderConfirmNameInput.value = state.user.name;
          } else if (state.user?.email) {
            orderConfirmNameInput.value = (
              state.user.email.split("@")[0] || ""
            ).trim();
          }
        }
      }
    }, 1000);
  }

  function closeOrderConfirmDrawer() {
    if (!orderConfirmDrawer) return;
    orderConfirmDrawer.classList.remove("show");
    orderConfirmDrawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("orderConfirmOpen");
  }

  function resetOrderConfirmFlow(options = {}) {
    if (!orderConfirmForm) return;
    const preserveOrders = options.preserveOrders !== false;
    if (!preserveOrders) {
      tabletSimState = createTabletInitialState();
      tabletSimOrderId = null;
    }
    orderConfirmForm.reset();
    updateOrderConfirmModeVisibility();
    if (orderConfirmCodeInput) {
      orderConfirmCodeInput.value = "";
      orderConfirmCodeInput.disabled = false;
    }
    if (orderConfirmSubmitBtn) {
      orderConfirmSubmitBtn.disabled = false;
    }
    setStatusMessage(orderConfirmSubmitStatus, "");
    setOrderConfirmStatusBadge("Waiting for server code", "idle");
    renderOrderConfirmServerPanel();
    renderOrderConfirmKitchenPanel();
    orderConfirmResetBtn?.setAttribute("hidden", "");
    if (state.user?.name) {
      orderConfirmNameInput.value = state.user.name;
    } else if (state.user?.email) {
      orderConfirmNameInput.value = (state.user.email.split("@")[0] || "").trim();
    } else if (orderConfirmNameInput) {
      orderConfirmNameInput.value = "";
    }
    if (orderConfirmDeliveryInput) orderConfirmDeliveryInput.value = "";
    if (orderConfirmNotesInput) orderConfirmNotesInput.value = "";
    serverPanelState.activeServerId = null;
    if (!preserveOrders) {
      renderOrderSidebarStatus(null);
      persistTabletStateSnapshot();
    } else {
      renderOrderSidebarStatus(getTabletOrder());
    }
  }

  function renderOrderConfirmSummary() {
    if (!orderConfirmSummaryList || !orderConfirmEmptySummary) return;
    orderConfirmSummaryList.innerHTML = "";
    const items = getSelectedOrderItems();
    if (items.length === 0) {
      orderConfirmEmptySummary.hidden = false;
      return;
    }
    orderConfirmEmptySummary.hidden = true;
    items.forEach((item) => {
      const li = document.createElement("li");
      li.innerHTML = createDishSummaryCard(item);
      orderConfirmSummaryList.appendChild(li);
    });
  }

  function renderOrderConfirmAllergies() {
    if (!orderConfirmAllergyChips) return;
    orderConfirmAllergyChips.innerHTML = "";
    const allergies = Array.isArray(state.allergies) ? state.allergies : [];
    if (allergies.length === 0) {
      const chip = document.createElement("span");
      chip.className = "orderConfirmChip muted";
      chip.textContent = "No allergens saved";
      orderConfirmAllergyChips.appendChild(chip);
      return;
    }
    allergies.forEach((allergen) => {
      const chip = document.createElement("span");
      chip.className = "orderConfirmChip";
      const label = formatOrderListLabel(allergen);
      const emoji = getAllergenEmoji(allergen) || "🔴";
      chip.textContent = `${emoji} ${label}`;
      orderConfirmAllergyChips.appendChild(chip);
    });
  }

  function renderOrderConfirmDiets() {
    if (!orderConfirmDietChips) return;
    orderConfirmDietChips.innerHTML = "";
    const diets = Array.isArray(state.diets) ? state.diets : [];
    if (diets.length === 0) {
      const chip = document.createElement("span");
      chip.className = "orderConfirmChip muted";
      chip.textContent = "No diets saved";
      orderConfirmDietChips.appendChild(chip);
      return;
    }
    diets.forEach((diet) => {
      const chip = document.createElement("span");
      chip.className = "orderConfirmChip";
      const label = formatOrderListLabel(diet);
      const emoji = getDietEmoji(diet) || "🍽️";
      chip.textContent = `${emoji} ${label}`;
      orderConfirmDietChips.appendChild(chip);
    });
  }

  function getDismissedOrderIds() {
    try {
      const raw = localStorage.getItem(ORDER_SIDEBAR_DISMISSED_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((id) => typeof id === "string" && id);
    } catch (error) {
      console.warn("Failed to read dismissed order ids", error);
      return [];
    }
  }

  function setDismissedOrderIds(ids) {
    try {
      const unique = Array.from(
        new Set(ids.filter((id) => typeof id === "string" && id)),
      );
      const trimmed = unique.slice(-25);
      localStorage.setItem(ORDER_SIDEBAR_DISMISSED_KEY, JSON.stringify(trimmed));
    } catch (error) {
      console.warn("Failed to store dismissed order ids", error);
    }
  }

  function dismissOrderId(orderId) {
    if (!orderId) return;
    const ids = getDismissedOrderIds();
    if (!ids.includes(orderId)) {
      ids.push(orderId);
      setDismissedOrderIds(ids);
    }
    updateOrderSidebarBadge();
  }

  function pruneDismissedOrders() {
    const dismissed = getDismissedOrderIds();
    if (!dismissed.length) return dismissed;
    const filtered = tabletSimState.orders.filter(
      (order) => !dismissed.includes(order.id),
    );
    if (filtered.length !== tabletSimState.orders.length) {
      tabletSimState.orders = filtered;
      if (tabletSimOrderId && dismissed.includes(tabletSimOrderId)) {
        tabletSimOrderId = null;
        stopOrderRefresh();
      }
      persistTabletStateSnapshot();
    }
    return dismissed;
  }

  function getOrderSidebarOpenAfterSubmitId() {
    try {
      const raw = localStorage.getItem(ORDER_SIDEBAR_OPEN_AFTER_SUBMIT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.orderId !== "string") return null;
      return parsed.orderId;
    } catch (error) {
      console.warn("Failed to read sidebar open-after-submit state", error);
      return null;
    }
  }

  function setOrderSidebarOpenAfterSubmit(orderId) {
    if (!orderId) return;
    try {
      localStorage.setItem(
        ORDER_SIDEBAR_OPEN_AFTER_SUBMIT_KEY,
        JSON.stringify({
          orderId,
          at: Date.now(),
        }),
      );
    } catch (error) {
      console.warn("Failed to store sidebar open-after-submit state", error);
    }
  }

  function clearOrderSidebarOpenAfterSubmit() {
    try {
      localStorage.removeItem(ORDER_SIDEBAR_OPEN_AFTER_SUBMIT_KEY);
    } catch (error) {
      console.warn("Failed to clear sidebar open-after-submit state", error);
    }
  }

  function resetOrderSidebarAutoState() {
    orderSidebarUserToggled = false;
    orderSidebarLastOrderId = null;
    orderSidebarAutoMinimizedOrderId = null;
  }

  function isActiveOrder(order) {
    if (!order) return false;
    if (order.status === TABLET_ORDER_STATUSES.CODE_ASSIGNED) return false;
    if (
      TABLET_ORDER_STATUSES.DRAFT &&
      order.status === TABLET_ORDER_STATUSES.DRAFT
    )
      return false;
    if (order.status === TABLET_ORDER_STATUSES.RESCINDED_BY_DINER) return false;
    if (order.status === TABLET_ORDER_STATUSES.REJECTED_BY_SERVER) return false;
    if (order.status === TABLET_ORDER_STATUSES.REJECTED_BY_KITCHEN) return false;
    return true;
  }

  function shouldShowClearOrderButton(order) {
    if (!order) return false;
    return (
      order.status === TABLET_ORDER_STATUSES.ACKNOWLEDGED ||
      order.status === TABLET_ORDER_STATUSES.QUESTION_ANSWERED ||
      order.status === TABLET_ORDER_STATUSES.REJECTED_BY_SERVER ||
      order.status === TABLET_ORDER_STATUSES.REJECTED_BY_KITCHEN ||
      order.status === TABLET_ORDER_STATUSES.RESCINDED_BY_DINER
    );
  }

  function maybeAutoMinimizeSidebar(order) {
    const orderId = order?.id || null;
    if (!orderSidebarForceOpenOrderId) {
      orderSidebarForceOpenOrderId = getOrderSidebarOpenAfterSubmitId();
    }
    if (orderId !== orderSidebarLastOrderId) {
      orderSidebarUserToggled = false;
      orderSidebarAutoMinimizedOrderId = null;
      orderSidebarLastOrderId = orderId;
    }
    if (orderId && orderSidebarForceOpenOrderId === orderId) {
      orderSidebarUserToggled = true;
      openOrderSidebar();
      orderSidebarForceOpenOrderId = null;
      clearOrderSidebarOpenAfterSubmit();
      return;
    }
    if (!isActiveOrder(order)) return;
    if (orderSidebarUserToggled) return;
    if (orderSidebarAutoMinimizedOrderId === orderId) return;
    minimizeOrderSidebar();
    orderSidebarAutoMinimizedOrderId = orderId;
  }

  function isSidebarOrderVisible(order) {
    if (!order || !order.id) return false;
    if (order.status === TABLET_ORDER_STATUSES.CODE_ASSIGNED) return false;
    if (
      TABLET_ORDER_STATUSES.DRAFT &&
      order.status === TABLET_ORDER_STATUSES.DRAFT
    )
      return false;
    return true;
  }

  function getSidebarOrders() {
    const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
    const dismissed = pruneDismissedOrders();
    const orders = Array.isArray(tabletSimState.orders)
      ? tabletSimState.orders
      : [];
    return orders
      .filter((order) => {
        if (!order || !order.id) return false;
        if (!isSidebarOrderVisible(order)) return false;
        if (
          restaurantId &&
          order.restaurantId &&
          order.restaurantId !== restaurantId
        )
          return false;
        if (restaurantId && !order.restaurantId) return false;
        if (dismissed.includes(order.id)) return false;
        return true;
      })
      .sort((a, b) => getOrderSortValue(b) - getOrderSortValue(a));
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
      setOrderSidebarOpenAfterSubmit(order.id);
      orderSidebarForceOpenOrderId = order.id;
      orderSidebarUserToggled = true;
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
    try {
      if (state.page === "editor") return;
      const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
      if (!restaurantId) return;

      // Clear orders from other restaurants
      tabletSimState.orders = tabletSimState.orders.filter((o) => {
        if (!o.restaurantId) return false; // Remove orders without restaurantId
        return o.restaurantId === restaurantId;
      });

      // If current order is from a different restaurant, clear it
      if (tabletSimOrderId) {
        const currentOrder = tabletSimState.orders.find(
          (o) => o.id === tabletSimOrderId,
        );
        if (
          !currentOrder ||
          (currentOrder.restaurantId &&
            currentOrder.restaurantId !== restaurantId)
        ) {
          tabletSimOrderId = null;
          stopOrderRefresh();
        }
      }

      const orders = await fetchTabletOrders([restaurantId]);
      const dismissed = getDismissedOrderIds();
      const filteredOrders = orders.filter((o) => !dismissed.includes(o.id));
      tabletSimState.orders = filteredOrders;
      handleNoticeUpdates(filteredOrders);
      const activeOrders = filteredOrders.filter((o) => isOrderActiveForBadge(o));
      const activeOrder = pickMostRecentOrder(activeOrders);
      if (activeOrder) {
        tabletSimOrderId = activeOrder.id;
        persistTabletStateSnapshot();
        state.ack = true;
        const ackBtn = document.getElementById("ackBtn");
        if (ackBtn) {
          ackBtn.textContent = "Acknowledged";
          ackBtn.classList.remove("off");
          ackBtn.classList.add("on");
        }
        renderOrderSidebarStatus(activeOrder);
        minimizeOrderSidebar();
        startOrderRefresh();
      } else {
        tabletSimOrderId = null;
        stopOrderRefresh();
        // No active order for this restaurant - clear sidebar
        renderOrderSidebarStatus(null);
      }
      updateOrderSidebarBadge();
    } catch (error) {
      console.error("Failed to check for active orders", error);
    }
  }

  function bindOrderConfirmModeSwitcher() {
    if (orderConfirmModeBound || !orderConfirmForm) return;
    const radios = orderConfirmForm.querySelectorAll(
      'input[name="orderConfirmMode"]',
    );
    radios.forEach((radio) => {
      radio.addEventListener("change", () => {
        updateOrderConfirmModeVisibility();
      });
    });
    orderConfirmModeBound = true;
    updateOrderConfirmModeVisibility();
  }

  function updateOrderConfirmModeVisibility() {
    if (!orderConfirmForm) return;
    const conditionalLabels = orderConfirmForm.querySelectorAll(
      ".orderConfirmConditional [data-mode]",
    );
    const active = orderConfirmForm.querySelector(
      'input[name="orderConfirmMode"]:checked',
    );
    const isDelivery = active && active.value === "delivery";

    conditionalLabels.forEach((label) => {
      const mode = label.getAttribute("data-mode");
      label.hidden = !active || active.value !== mode;
    });

    // Update delivery button visibility and link
    const deliveryButtonContainer = document.getElementById(
      "deliveryButtonContainer",
    );
    if (deliveryButtonContainer) {
      deliveryButtonContainer.hidden = !isDelivery;
      const deliveryLinkButton = document.getElementById("deliveryLinkButton");
      if (deliveryLinkButton) {
        if (isDelivery && state.restaurant?.delivery_url) {
          deliveryLinkButton.href = state.restaurant.delivery_url;
          deliveryLinkButton.style.display = "inline-flex";
          deliveryLinkButton.style.opacity = "1";
          deliveryLinkButton.style.cursor = "pointer";
          deliveryLinkButton.onclick = null; // Allow default link behavior
        } else if (isDelivery && !state.restaurant?.delivery_url) {
          // Show button but disabled if no URL is set
          deliveryLinkButton.href = "#";
          deliveryLinkButton.style.display = "inline-flex";
          deliveryLinkButton.style.opacity = "0.5";
          deliveryLinkButton.style.cursor = "not-allowed";
          deliveryLinkButton.onclick = (e) => {
            e.preventDefault();
            alert("Delivery URL not configured. Please contact the restaurant.");
          };
        } else {
          deliveryLinkButton.style.display = "none";
        }
      }
    }

    // Update server code section visibility
    const dineInCodeSection = document.getElementById("dineInCodeSection");
    const deliveryMessageSection = document.getElementById(
      "deliveryMessageSection",
    );
    if (dineInCodeSection) {
      dineInCodeSection.style.display = isDelivery ? "none" : "block";
    }
    if (deliveryMessageSection) {
      deliveryMessageSection.style.display = isDelivery ? "block" : "none";
    }
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
    if (!orderConfirmStatusBadge) return;
    orderConfirmStatusBadge.dataset.tone = tone || "idle";
    orderConfirmStatusBadge.textContent = label;
  }

  function setStatusMessage(target, message, variant) {
    if (!target) return;
    target.textContent = message || "";
    target.classList.remove("error", "success");
    if (!message) return;
    if (variant === "error") {
      target.classList.add("error");
    } else if (variant === "success") {
      target.classList.add("success");
    }
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

  function getDishOverlayByName(dishName) {
    const overlays = Array.isArray(state.restaurant?.overlays)
      ? state.restaurant.overlays
      : [];
    const target = (dishName || "").toString().trim().toLowerCase();
    if (!target) return null;
    return (
      overlays.find((overlay) => {
        const candidate = (overlay.id || overlay.name || "")
          .toString()
          .trim()
          .toLowerCase();
        return candidate === target;
      }) || null
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

  function renderCompatibilityList(messages, extraClass) {
    if (!messages || messages.length === 0) return "";
    const className = extraClass
      ? `orderDishStatusList ${extraClass}`
      : "orderDishStatusList";
    const items = messages
      .map((msg) => {
        const type = msg.type || "info";
        return `<li class="${type}">${esc(msg.text)}</li>`;
      })
      .join("");
    return `<ul class="${className}">${items}</ul>`;
  }

  function getDishCompatibilityDetails(dishName) {
    const userAllergies = Array.isArray(state.allergies) ? state.allergies : [];
    const userDiets = Array.isArray(state.diets) ? state.diets : [];
    const dish = getDishOverlayByName(dishName);
    const details = {
      dish,
      severity: "success",
      badgeLabel: "Meets all requirements",
      allergenMessages: [],
      dietMessages: [],
      hasPreferences: userAllergies.length > 0 || userDiets.length > 0,
      issues: {
        allergens: [],
        diets: [],
      },
    };

    const severityRank = { success: 0, warn: 1, danger: 2 };
    let highestRank = -1;
    const trackSeverity = (type) => {
      const rank = severityRank[type];
      if (rank !== undefined && rank > highestRank) {
        highestRank = rank;
      }
    };

    if (!dish) {
      if (details.hasPreferences) {
        details.severity = "warn";
        details.badgeLabel = "Check with staff";
        if (userAllergies.length) {
          details.allergenMessages.push({
            type: "warn",
            text: "Allergen details unavailable for this item.",
          });
          trackSeverity("warn");
        } else {
          details.allergenMessages.push({
            type: "info",
            text: "Allergen details unavailable for this item.",
          });
        }
        if (userDiets.length) {
          details.dietMessages.push({
            type: "warn",
            text: "Dietary compatibility unknown.",
          });
          trackSeverity("warn");
        }
      } else {
        details.severity = "info";
        details.badgeLabel = "No saved preferences";
        details.allergenMessages.push({
          type: "info",
          text: "No allergies saved",
        });
        details.dietMessages.push({
          type: "info",
          text: "No diets saved",
        });
      }
      return details;
    }

    const dishAllergens = (dish.allergens || [])
      .map(normalizeAllergen)
      .filter(Boolean);
    const dishDietSet = new Set(
      (dish.diets || []).map(normalizeDietLabel).filter(Boolean),
    );
    const removableAllergens = new Set(
      (dish.removable || [])
        .map((r) => normalizeAllergen(r.allergen || ""))
        .filter(Boolean),
    );

    if (userAllergies.length === 0) {
      details.allergenMessages.push({ type: "info", text: "No allergies saved" });
    } else {
      userAllergies.forEach((allergen) => {
        const normalized = normalizeAllergen(allergen);
        if (!normalized) return;
        const friendly = formatOrderListLabel(allergen);
        const hasAllergen = dishAllergens.includes(normalized);
        if (!hasAllergen) {
          details.allergenMessages.push({
            type: "success",
            text: `Doesn't contain ${friendly}`,
          });
        } else if (removableAllergens.has(normalized)) {
          details.allergenMessages.push({
            type: "warn",
            text: `Can be made ${friendly}-free`,
          });
          trackSeverity("warn");
        } else {
          details.allergenMessages.push({
            type: "danger",
            text: `Contains ${friendly}`,
          });
          trackSeverity("danger");
          details.issues.allergens.push(friendly);
        }
      });
    }

    const normalizedDiets = (userDiets || [])
      .map(normalizeDietLabel)
      .filter(Boolean);

    if (normalizedDiets.length === 0) {
      details.dietMessages.push({
        type: "info",
        text: "No diets saved",
      });
    } else {
      normalizedDiets.forEach((diet) => {
        const friendlyDiet = formatOrderListLabel(diet);
        const conflicts = getDietAllergenConflicts(diet);
        const blockingAllergens = conflicts.filter((allergen) =>
          dishAllergens.includes(allergen),
        );
        const allBlockingRemovable =
          blockingAllergens.length > 0 &&
          blockingAllergens.every((allergen) =>
            removableAllergens.has(allergen),
          );

        if (dishDietSet.has(diet)) {
          details.dietMessages.push({
            type: "success",
            text: `Meets ${friendlyDiet}`,
          });
        } else if (allBlockingRemovable) {
          details.dietMessages.push({
            type: "warn",
            text: `Can be made ${friendlyDiet}`,
          });
          trackSeverity("warn");
        } else if (blockingAllergens.length > 0) {
          details.dietMessages.push({
            type: "danger",
            text: `Not ${friendlyDiet}`,
          });
          trackSeverity("danger");
          details.issues.diets.push(friendlyDiet);
        } else {
          details.dietMessages.push({
            type: "danger",
            text: `Not ${friendlyDiet}`,
          });
          trackSeverity("danger");
          details.issues.diets.push(friendlyDiet);
        }
      });
    }

    if (details.issues.allergens.length > 0 || details.issues.diets.length > 0) {
      details.severity = "danger";
      details.badgeLabel = "Cannot be accommodated";
    } else if (highestRank === 1) {
      details.severity = "warn";
      details.badgeLabel = "Can be removed/replaced";
    } else if (details.hasPreferences) {
      details.severity = "success";
      details.badgeLabel = "Meets all requirements";
    } else {
      details.severity = "info";
      details.badgeLabel = "No saved preferences";
    }

    return details;
  }

  function renderCompatibilitySection(title, messages) {
    const list = renderCompatibilityList(messages);
    if (!list) return "";
    return `<div class="orderConfirmDishSection">
  <div class="orderConfirmDishSectionTitle">${esc(title)}</div>
  ${list}
    </div>`;
  }

  function createDishSummaryCard(dishName) {
    const details = getDishCompatibilityDetails(dishName);
    const severityClass =
      {
        success: "orderConfirmDishBadge--success",
        warn: "orderConfirmDishBadge--warn",
        danger: "orderConfirmDishBadge--danger",
        info: "orderConfirmDishBadge--info",
      }[details.severity] || "orderConfirmDishBadge--info";
    const allergenSection = renderCompatibilitySection(
      "Allergens",
      details.allergenMessages,
    );
    const dietSection = renderCompatibilitySection(
      "Diets",
      details.dietMessages,
    );
    const sections = [allergenSection, dietSection].filter(Boolean).join("");
    const body =
      sections ||
      '<p class="orderConfirmDishNote">No saved allergies or diets.</p>';
    return `
  <article class="orderConfirmDishCard" data-severity="${details.severity}">
    <div class="orderConfirmDishCardHeader">
      <div class="orderConfirmDishName">${esc(dishName)}</div>
      <span class="orderConfirmDishBadge ${severityClass}">${esc(details.badgeLabel)}</span>
    </div>
    ${body}
  </article>
    `;
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

  function buildAddToOrderWarningMessage(dishName, details) {
    const parts = [];
    if (details.issues?.allergens?.length) {
      const list = details.issues.allergens.join(", ");
      parts.push(`${dishName} contains ${list} that cannot be accommodated.`);
    }
    if (details.issues?.diets?.length) {
      const list = details.issues.diets.join(", ");
      parts.push(
        `${dishName} does not meet your ${list} preference${details.issues.diets.length > 1 ? "s" : ""}.`,
      );
    }
    const intro = parts.length
      ? parts.join(" ")
      : "This dish may not align with your saved preferences.";
    return `${intro} Are you sure you want to add this to your order?`;
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
    if (state.restaurant?.slug) return state.restaurant.slug;
    if (typeof slug === "string" && slug) return slug;
    return "";
  }

  function getOrderItemsStorageKey() {
    const restaurantSlug = getRestaurantSlug();
    return restaurantSlug ? `orderItems:${restaurantSlug}` : "orderItems";
  }

  function getOrderFormStateStorageKey() {
    const restaurantSlug = getRestaurantSlug();
    return restaurantSlug
      ? `orderConfirmFormState:${restaurantSlug}`
      : "orderConfirmFormState";
  }

  // Order management functions
  function persistOrderItems() {
    const storageKey = getOrderItemsStorageKey();
    try {
      const orderItems = getOrderItems();
      if (orderItems.length > 0) {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            items: orderItems,
            timestamp: Date.now(),
          }),
        );
      } else {
        localStorage.removeItem(storageKey);
      }
      if (storageKey !== "orderItems") {
        localStorage.removeItem("orderItems");
      }
    } catch (error) {
      console.error("Failed to persist order items", error);
    }
  }

  function restoreOrderItems() {
    const storageKey = getOrderItemsStorageKey();
    try {
      let saved = localStorage.getItem(storageKey);
      let usedLegacyKey = false;
      if (!saved && storageKey !== "orderItems") {
        saved = localStorage.getItem("orderItems");
        if (saved) usedLegacyKey = true;
      }
      if (saved) {
        const data = JSON.parse(saved);
        const isValidArray = data && Array.isArray(data.items);
        const isFresh =
          data && data.timestamp && Date.now() - data.timestamp < 86400000;
        if (isValidArray && isFresh && data.items.length) {
          writeOrderItems([...data.items]);
          syncOrderItemSelections();
          if (usedLegacyKey) {
            localStorage.removeItem("orderItems");
            localStorage.setItem(storageKey, saved);
          }
          return true;
        } else {
          localStorage.removeItem(storageKey);
          if (usedLegacyKey) localStorage.removeItem("orderItems");
        }
      }
    } catch (error) {
      console.error("Failed to restore order items", error);
      localStorage.removeItem(storageKey);
      if (storageKey !== "orderItems") localStorage.removeItem("orderItems");
    }
    writeOrderItems([]);
    clearOrderItemSelections();
    return false;
  }

  function getOrderItemSelections() {
    return readOrderItemSelections();
  }

  function clearOrderItemSelections() {
    getOrderItemSelections().clear();
  }

  function syncOrderItemSelections() {
    const selections = getOrderItemSelections();
    const items = getOrderItems();
    const itemSet = new Set(items);
    Array.from(selections).forEach((item) => {
      if (!itemSet.has(item)) {
        selections.delete(item);
      }
    });
  }

  function isOrderItemSelected(dishName) {
    return getOrderItemSelections().has(dishName);
  }

  function toggleOrderItemSelection(dishName) {
    const selections = getOrderItemSelections();
    if (selections.has(dishName)) {
      selections.delete(dishName);
    } else {
      selections.add(dishName);
    }
    updateConfirmButtonVisibility();
    orderSidebarUiRuntime.syncConfirmDrawerSummary();
  }

  function getSelectedOrderItems() {
    syncOrderItemSelections();
    const selections = getOrderItemSelections();
    const items = getOrderItems();
    return items.filter((item) => selections.has(item));
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
    const orderItems = getOrderItems();
    if (orderItems.includes(dishName)) {
      return { success: false, message: "already-added" };
    }

    const force = !!options.force;

    // Check if dish can be accommodated with user's allergens and diets
    const userAllergies = (state.allergies || [])
      .map(normalizeAllergen)
      .filter(Boolean);
    const userDiets = (state.diets || [])
      .map(normalizeDietLabel)
      .filter(Boolean);
    const issues = {
      allergens: [],
      diets: [],
    };

    // Get dish data from overlays (use same function as getDishCompatibilityDetails for consistency)
    const dish = getDishOverlayByName(dishName);

    if (dish) {
      const dishAllergens = (dish.allergens || [])
        .map(normalizeAllergen)
        .filter(Boolean);
      const removableAllergens = new Set(
        (dish.removable || [])
          .map((r) => normalizeAllergen(r.allergen || ""))
          .filter(Boolean),
      );

      // Check if any user allergen is present and cannot be accommodated
      if (userAllergies.length > 0) {
        const nonAccommodatableAllergens = userAllergies.filter((allergen) => {
          const hasAllergen = dishAllergens.includes(allergen);
          return hasAllergen && !removableAllergens.has(allergen);
        });

        if (nonAccommodatableAllergens.length > 0) {
          issues.allergens = nonAccommodatableAllergens.map((a) =>
            formatOrderListLabel(a),
          );
        }
      }

      // Check diet incompatibilities (check even if no allergies)
      if (userDiets.length > 0) {
        const dishDietSet = new Set(
          (dish.diets || []).map(normalizeDietLabel).filter(Boolean),
        );
        userDiets.forEach((diet) => {
          const conflicts = getDietAllergenConflicts(diet);
          // Use exact same logic as getDishCompatibilityDetails
          const blockingAllergens = conflicts.filter((allergen) =>
            dishAllergens.includes(allergen),
          );
          const friendlyDiet = formatOrderListLabel(diet);
          const meetsDiet = dishDietSet.has(diet);
          const allBlockingRemovable =
            blockingAllergens.length > 0 &&
            blockingAllergens.every((allergen) =>
              removableAllergens.has(allergen),
            );

          // Match the exact logic from getDishCompatibilityDetails:
          // - If diet is explicitly met, no issue
          // - If all blocking allergens are removable, no issue (can be made)
          // - Otherwise, add to issues (cannot be made or unknown)
          if (meetsDiet) {
            // Diet is explicitly met, no issue
          } else if (allBlockingRemovable) {
            // Can be made vegan, no issue
          } else {
            // Cannot be made or unknown, require confirmation
            issues.diets.push(friendlyDiet);
          }
        });
      }

      if ((issues.allergens.length > 0 || issues.diets.length > 0) && !force) {
        return {
          success: false,
          needsConfirmation: true,
          issues,
        };
      }
    }
    // If dish not found in overlays, allow adding (user can decide)

    // Add to order if it can be accommodated
    orderItems.push(dishName);
    writeOrderItems(orderItems);
    persistOrderItems();
    updateOrderSidebar();
    openOrderSidebar();
    closeDishDetailsAfterAdd();
    return { success: true };
  }

  function removeDishFromOrder(dishName) {
    const orderItems = getOrderItems();
    const index = orderItems.indexOf(dishName);
    if (index > -1) {
      orderItems.splice(index, 1);
      writeOrderItems(orderItems);
      getOrderItemSelections().delete(dishName);
      persistOrderItems();
      syncOrderItemSelections();
      updateOrderSidebar();
      // Re-enable "Add to order" button if item is removed while tooltip is open
      const addBtn = document.querySelector(
        `.addToOrderBtn[data-dish-name="${esc(dishName)}"]`,
      );
      if (addBtn) {
        addBtn.disabled = false;
        addBtn.textContent = "Add to order";
      }
    }
  }

  function bindOrderItemSelectButtons(container) {
    if (!container) return;
    container.querySelectorAll(".orderItemSelect").forEach((btn) => {
      if (btn.__selectionBound) return;
      btn.__selectionBound = true;
      const applySelectionState = (dishName) => {
        toggleOrderItemSelection(dishName);
        const isSelected = isOrderItemSelected(dishName);
        btn.classList.toggle("is-selected", isSelected);
        btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
        btn.setAttribute(
          "aria-label",
          `${isSelected ? "Deselect" : "Select"} ${dishName}`,
        );
      };
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dishName = btn.getAttribute("data-dish-name");
        if (!dishName) return;
        applySelectionState(dishName);
      });
      const row = btn.closest(".orderItem");
      if (row && !row.__rowSelectionBound) {
        row.__rowSelectionBound = true;
        row.addEventListener("click", (e) => {
          if (e.target.closest(".orderItemRemove")) return;
          if (e.target.closest(".orderItemSelect")) return;
          const dishName =
            row.getAttribute("data-dish-name") ||
            btn.getAttribute("data-dish-name");
          if (!dishName) return;
          applySelectionState(dishName);
        });
      }
    });
  }

  function updateOrderSidebar() {
    const sidebarItemsContainer = document.getElementById("orderSidebarItems");
    if (!sidebarItemsContainer) return;
    const sidebarOrders = getSidebarOrders();
    if (sidebarOrders.length) {
      renderOrderSidebarPendingOrders(sidebarOrders);
      updateOrderSidebarBadge();
      setOrderSidebarVisibility();
      return;
    }
    const hasItems = hasOrderItems();
    syncOrderItemSelections();
    if (sidebarItemsContainer.dataset.mode === "cleared" && !hasItems) {
      updateOrderSidebarBadge();
      setOrderSidebarVisibility();
      return;
    }
    if (sidebarItemsContainer.dataset.mode === "cleared" && hasItems) {
      sidebarItemsContainer.dataset.mode = "cart";
    }
    if (!sidebarItemsContainer.dataset.mode) {
      sidebarItemsContainer.dataset.mode = "cart";
    }

    const orderItems = getOrderItems();
    if (!orderItems.length) {
      sidebarItemsContainer.innerHTML =
        '<div class="orderSidebarEmpty">No items added yet</div>';
      setConfirmButtonVisibility(false);
      setConfirmButtonDisabled(true);
      minimizeOrderSidebar();
    } else {
      const itemsHTML = orderItems
        .map(
          (dishName) => `
    <div class="orderSidebarCard">
      <div class="orderItem" data-dish-name="${escapeAttribute(dishName)}">
        <button type="button" class="orderItemSelect${isOrderItemSelected(dishName) ? " is-selected" : ""}" data-dish-name="${escapeAttribute(dishName)}" aria-pressed="${isOrderItemSelected(dishName) ? "true" : "false"}" aria-label="Select ${escapeAttribute(dishName)}"></button>
        <div style="flex:1">
          <div class="orderItemName">${esc(dishName)}</div>
        </div>
        <button type="button" class="orderItemRemove" data-dish-name="${esc(dishName)}">Remove</button>
      </div>
    </div>
  `,
        )
        .join("");
      sidebarItemsContainer.innerHTML = itemsHTML;

      // Attach remove handlers
      sidebarItemsContainer
        .querySelectorAll(".orderItemRemove")
        .forEach((btn) => {
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const dishName = btn.getAttribute("data-dish-name");
            if (dishName) removeDishFromOrder(dishName);
          });
        });
      bindOrderItemSelectButtons(sidebarItemsContainer);

      updateConfirmButtonVisibility();
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

  function getOrderSortValue(order) {
    if (!order) return 0;
    const candidates = [order.updatedAt, order.submittedAt, order.createdAt];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate;
      }
      const parsed = Date.parse(candidate);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return 0;
  }

  function pickMostRecentOrder(orders) {
    if (!Array.isArray(orders) || orders.length === 0) return null;
    const sorted = orders
      .slice()
      .sort((a, b) => getOrderSortValue(b) - getOrderSortValue(a));
    return sorted[0] || null;
  }

  function isOrderActiveForBadge(order) {
    if (!order || !order.id) return false;
    if (
      TABLET_ORDER_STATUSES.DRAFT &&
      order.status === TABLET_ORDER_STATUSES.DRAFT
    )
      return false;
    if (order.status === TABLET_ORDER_STATUSES.CODE_ASSIGNED) return false;
    if (order.status === TABLET_ORDER_STATUSES.RESCINDED_BY_DINER) return false;
    if (order.status === TABLET_ORDER_STATUSES.REJECTED_BY_SERVER) return false;
    if (order.status === TABLET_ORDER_STATUSES.REJECTED_BY_KITCHEN) return false;
    return true;
  }

  function getActiveOrderCount() {
    const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
    const dismissed = getDismissedOrderIds();
    const orders = Array.isArray(tabletSimState.orders)
      ? tabletSimState.orders
      : [];
    const activeOrders = orders.filter((order) => {
      if (!order || !order.id) return false;
      if (
        restaurantId &&
        order.restaurantId &&
        order.restaurantId !== restaurantId
      )
        return false;
      if (dismissed.includes(order.id)) return false;
      return isOrderActiveForBadge(order);
    });
    const hasCartItems = hasOrderItems();
    const isCleared = orderSidebarItems?.dataset.mode === "cleared";
    const cartCount = hasCartItems && !isCleared ? getOrderItems().length : 0;
    if (activeOrders.length > 0) {
      const submittedCount = activeOrders.reduce((sum, order) => {
        const count =
          Array.isArray(order.items) && order.items.length
            ? order.items.length
            : 1;
        return sum + count;
      }, 0);
      return submittedCount + cartCount;
    }
    return cartCount;
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

  // Initialize order sidebar handlers
  let orderRefreshTimerId = null;
  const ORDER_REFRESH_INTERVAL_MS = 15000;

  async function refreshOrderStatus() {
    try {
      const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
      if (!restaurantId) return;
      const orders = await fetchTabletOrders([restaurantId]);
      const dismissed = getDismissedOrderIds();
      const filteredOrders = orders.filter((o) => !dismissed.includes(o.id));
      tabletSimState.orders = filteredOrders;
      handleNoticeUpdates(filteredOrders);
      const activeOrders = filteredOrders.filter((o) => isOrderActiveForBadge(o));
      let targetOrder = tabletSimOrderId
        ? filteredOrders.find((o) => o.id === tabletSimOrderId)
        : null;

      if (!targetOrder || !isOrderActiveForBadge(targetOrder)) {
        targetOrder = pickMostRecentOrder(activeOrders);
        if (targetOrder) {
          tabletSimOrderId = targetOrder.id;
          if (!orderRefreshTimerId) {
            startOrderRefresh();
          }
        } else if (tabletSimOrderId) {
          tabletSimOrderId = null;
          stopOrderRefresh();
        }
      }

      persistTabletStateSnapshot();
      if (targetOrder) {
        renderOrderSidebarStatus(targetOrder);
        updateOrderSidebarBadge();
      } else {
        renderOrderSidebarStatus(null);
        updateOrderSidebarBadge();
      }
    } catch (error) {
      console.error("Failed to refresh order status", error);
    }
  }

  function startOrderRefresh() {
    stopOrderRefresh();
    if (!tabletSimOrderId) return;
    orderRefreshTimerId = setInterval(() => {
      refreshOrderStatus().catch((err) => {
        console.error("[order-refresh] periodic refresh failed", err);
      });
    }, ORDER_REFRESH_INTERVAL_MS);
  }

  function stopOrderRefresh() {
    if (orderRefreshTimerId) {
      clearInterval(orderRefreshTimerId);
      orderRefreshTimerId = null;
    }
  }

  function initOrderSidebar() {
    // Filter orders by current restaurant when sidebar initializes
    const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
    if (restaurantId) {
      tabletSimState.orders = tabletSimState.orders.filter((o) => {
        if (!o.restaurantId) return false;
        return o.restaurantId === restaurantId;
      });
      // Clear current order if it's from a different restaurant
      if (tabletSimOrderId) {
        const currentOrder = tabletSimState.orders.find(
          (o) => o.id === tabletSimOrderId,
        );
        if (
          !currentOrder ||
          (currentOrder.restaurantId &&
            currentOrder.restaurantId !== restaurantId)
        ) {
          tabletSimOrderId = null;
          stopOrderRefresh();
        }
      }
      persistTabletStateSnapshot();
    }

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
