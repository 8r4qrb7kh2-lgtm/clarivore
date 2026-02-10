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
} from "../tablet-simulation-logic.mjs";
import {
  getPersistedTabletState,
  persistTabletState,
  subscribeToTabletState,
} from "../tablet-sync.js";
import { saveTabletOrder, fetchTabletOrders } from "../tablet-orders-api.js";

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

const allergenConfig =
  typeof window !== "undefined" ? window.ALLERGEN_DIET_CONFIG || {} : {};
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
} = {}) {
  const supabaseClient = supabaseClientOverride || window.supabaseClient;
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
  let noticeBannerContainer = null;
  let noticeUpdatesPrimed = false;
  const noticeUpdateCache = new Map();

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

  initializeOrderConfirmDrawer();
  window.__openOrderConfirmDrawer = openOrderConfirmDrawer;

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
      dishes: Array.isArray(window.orderItems) ? [...window.orderItems] : [],
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
        window.orderItems = [...formData.dishes];
        // Visually select dishes in the menu by finding overlays with matching titles
        formData.dishes.forEach((dishName) => {
          const overlays = document.querySelectorAll(".overlay");
          overlays.forEach((overlay) => {
            const titleEl = overlay.querySelector(".tTitle");
            if (titleEl) {
              const title = titleEl.textContent.trim();
              if (
                title.toLowerCase() === dishName.toLowerCase() ||
                title === dishName
              ) {
                overlay.classList.add("selected");
                if (typeof window.setOverlayPulseColor === "function") {
                  window.setOverlayPulseColor(overlay);
                }
                // Also update the "Add to order" button if it exists
                const addBtn = overlay.querySelector(
                  `.addToOrderBtn[data-dish-name]`,
                );
                if (addBtn) {
                  addBtn.disabled = true;
                  addBtn.textContent = "Added";
                }
              }
            }
          });
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
      if (window.orderItems && window.orderItems.length > 0) {
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
    const currentUrl = window.location.href;
    window.location.href = `/account?redirect=${encodeURIComponent(currentUrl)}&mode=signin`;
  }

  function handleSignUpClick() {
    saveOrderFormState();
    const currentUrl = window.location.href;
    window.location.href = `/account?redirect=${encodeURIComponent(currentUrl)}&mode=signup`;
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

  function ensureNoticeBannerContainer() {
    if (noticeBannerContainer) return noticeBannerContainer;
    const container = document.createElement("div");
    container.className = "noticeUpdateBannerStack";
    document.body.appendChild(container);
    noticeBannerContainer = container;
    return container;
  }

  function getLatestExternalUpdate(order) {
    const history = Array.isArray(order?.history) ? order.history : [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const entry = history[i];
      if (!entry) continue;
      if (entry.actor && entry.actor !== "Diner") {
        return {
          actor: entry.actor || "Update",
          message: entry.message || "",
          at: entry.at || "",
        };
      }
    }
    return null;
  }

  function buildNoticeUpdateSnapshot(order) {
    if (!order || !order.id) return null;
    const latestExternal = getLatestExternalUpdate(order);
    return {
      status: order.status || "",
      externalAt: latestExternal?.at || "",
      latestExternal,
    };
  }

  function getNoticeUpdateMessage(order, latestExternal) {
    if (latestExternal?.message) return latestExternal.message;
    if (order?.status && ORDER_UPDATE_MESSAGES[order.status]) {
      return ORDER_UPDATE_MESSAGES[order.status];
    }
    return "Your notice was updated.";
  }

  function getNoticeDishTitle(order) {
    const items = Array.isArray(order?.items) ? order.items : [];
    const dishNames = items
      .map((item) => (item ?? "").toString().trim())
      .filter(Boolean);
    if (!dishNames.length) return "your dish";
    if (dishNames.length === 1) return dishNames[0];
    return `${dishNames[0]} + ${dishNames.length - 1} more`;
  }

  function attachNoticeBannerInteractions(banner, { onDismiss, onTap } = {}) {
    let startY = null;
    let deltaY = 0;
    let pointerId = null;
    let moved = false;
    let suppressClick = false;

    const reset = () => {
      startY = null;
      deltaY = 0;
      pointerId = null;
      moved = false;
      banner.style.transition = "";
      banner.style.transform = "";
      banner.style.opacity = "";
    };

    const maybeSuppressClick = () => {
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 50);
    };

    banner.addEventListener("pointerdown", (event) => {
      pointerId = event.pointerId;
      startY = event.clientY;
      moved = false;
      banner.setPointerCapture?.(pointerId);
      banner.style.transition = "none";
    });

    banner.addEventListener("pointermove", (event) => {
      if (pointerId === null || event.pointerId !== pointerId || startY === null)
        return;
      const nextDelta = event.clientY - startY;
      if (nextDelta > 0) return;
      deltaY = nextDelta;
      if (Math.abs(deltaY) > 6) moved = true;
      banner.style.transform = `translateY(${deltaY}px)`;
      const opacity = Math.max(0.2, 1 + deltaY / 80);
      banner.style.opacity = `${opacity}`;
    });

    banner.addEventListener("pointerup", () => {
      if (deltaY < -40) {
        maybeSuppressClick();
        if (typeof onDismiss === "function") onDismiss();
        reset();
        return;
      }
      if (!moved && typeof onTap === "function") {
        onTap();
      }
      reset();
    });

    banner.addEventListener("pointercancel", reset);

    banner.addEventListener("click", (event) => {
      if (suppressClick) {
        event.preventDefault();
        return;
      }
      if (typeof onTap === "function") onTap();
    });
  }

  function dismissNoticeBanner(banner) {
    if (!banner) return;
    banner.classList.add("is-dismissed");
    setTimeout(() => {
      banner.remove();
    }, 240);
  }

  function showNoticeUpdateBanner(order, latestExternal) {
    const container = ensureNoticeBannerContainer();
    const banner = document.createElement("div");
    const dishTitle = getNoticeDishTitle(order);
    const title = dishTitle ? `Notice update for ${dishTitle}` : "Notice update";
    const message = getNoticeUpdateMessage(order, latestExternal);
    banner.className = "noticeUpdateBanner";
    banner.innerHTML = `
      <div class="noticeUpdateBannerTitle">${esc(title)}</div>
      <div class="noticeUpdateBannerBody">${esc(message)}</div>
    `;
    container.appendChild(banner);
    requestAnimationFrame(() => {
      banner.classList.add("is-visible");
    });

    const handleDismiss = () => dismissNoticeBanner(banner);
    attachNoticeBannerInteractions(banner, {
      onDismiss: handleDismiss,
      onTap: () => {
        openOrderSidebar();
        renderOrderSidebarStatus(order);
      },
    });

    setTimeout(() => {
      dismissNoticeBanner(banner);
    }, 9000);
  }

  function handleNoticeUpdates(orders) {
    const currentUserId = state.user?.id || null;
    const trackedOrders = Array.isArray(orders)
      ? orders.filter((order) => {
          if (!order || !order.id) return false;
          if (currentUserId && order.userId && order.userId !== currentUserId) {
            return false;
          }
          return true;
        })
      : [];

    if (!noticeUpdatesPrimed) {
      trackedOrders.forEach((order) => {
        const snapshot = buildNoticeUpdateSnapshot(order);
        if (snapshot) {
          noticeUpdateCache.set(order.id, snapshot);
        }
      });
      noticeUpdatesPrimed = true;
      return;
    }

    const activeIds = new Set();
    trackedOrders.forEach((order) => {
      activeIds.add(order.id);
      const snapshot = buildNoticeUpdateSnapshot(order);
      if (!snapshot) return;
      const previous = noticeUpdateCache.get(order.id);
      if (previous && snapshot.externalAt && snapshot.externalAt !== previous.externalAt) {
        if (snapshot.latestExternal?.actor && snapshot.latestExternal.actor !== "Diner") {
          showNoticeUpdateBanner(order, snapshot.latestExternal);
        }
      }
      noticeUpdateCache.set(order.id, snapshot);
    });

    for (const key of noticeUpdateCache.keys()) {
      if (!activeIds.has(key)) {
        noticeUpdateCache.delete(key);
      }
    }
  }

  function renderOrderSidebarStatus(order) {
    if (!orderSidebarStatus || !orderSidebarStatusBadge) {
      return;
    }
    const hasItems =
      Array.isArray(window.orderItems) && window.orderItems.length > 0;
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

  function getOrderTimestamps(order) {
    const history = Array.isArray(order.history) ? order.history : [];
    const submittedEntry = history.find(
      (e) =>
        e.message &&
        (e.message.includes("Submitted") || e.message.includes("submitted")),
    );
    const submittedTime =
      submittedEntry?.at || order.updatedAt || order.createdAt;
    const updates = history
      .filter((e) => e.at && e.at !== submittedTime)
      .map((e) => ({
        actor: e.actor || "System",
        message: e.message || "Status update",
        at: e.at,
      }));
    return { submittedTime, updates };
  }

  function buildOrderSidebarPendingOrderHtml(order) {
    const submittedItems =
      Array.isArray(order.items) && order.items.length ? order.items : [];
    const dishName = submittedItems.length
      ? submittedItems.join(", ")
      : "No dishes recorded";
    const allergens =
      Array.isArray(order.allergies) && order.allergies.length
        ? order.allergies.map((a) => formatOrderListLabel(a)).join(", ")
        : "None";
    const diets =
      Array.isArray(order.diets) && order.diets.length
        ? order.diets.map((d) => formatOrderListLabel(d)).join(", ")
        : "None";
    const metaParts = [];
    if (order.tableNumber) {
      metaParts.push(`Table ${esc(order.tableNumber)}`);
    }
    if (order.serverCode) {
      metaParts.push(`Code ${esc(order.serverCode)}`);
    }
    const metaLine = metaParts.length
      ? metaParts.join(" • ")
      : "Awaiting table assignment";
    const descriptor = ORDER_STATUS_DESCRIPTORS[order.status] || {
      label: order.status,
      tone: "idle",
    };
    const badgeClass = getBadgeClassForTone(descriptor?.tone || "idle");
    const { submittedTime, updates } = getOrderTimestamps(order);
    const submittedTimeStr = submittedTime
      ? formatTabletTimestamp(submittedTime)
      : "";
    const nonDinerUpdates = updates.filter((u) => u.actor !== "Diner");
    const updatesHtml =
      nonDinerUpdates.length > 0
        ? `
  <div class="orderSidebarTimestamps">
    ${nonDinerUpdates.map((u) => `<div class="orderSidebarTimestamp"><span class="orderSidebarTimestampActor">${esc(u.actor)}:</span> ${esc(u.message)} <span class="orderSidebarTimestampTime">${formatTabletTimestamp(u.at)}</span></div>`).join("")}
  </div>
    `
        : "";
    const kitchenQuestion = getKitchenQuestion(order);
    const hasKitchenQuestion =
      kitchenQuestion && !kitchenQuestion.response;
    const kitchenQuestionHtml = hasKitchenQuestion
      ? `
  <div class="orderSidebarKitchenQuestion">
    <div class="orderSidebarKitchenQuestionLabel">Kitchen Question</div>
    <div class="orderSidebarKitchenQuestionText">${esc(kitchenQuestion.text)}</div>
    <div class="orderSidebarKitchenQuestionActions">
      <button type="button" class="orderSidebarQuestionBtn orderSidebarQuestionYes" data-order-id="${escapeAttribute(order.id)}" data-response="yes">Yes</button>
      <button type="button" class="orderSidebarQuestionBtn orderSidebarQuestionNo" data-order-id="${escapeAttribute(order.id)}" data-response="no">No</button>
    </div>
  </div>
    `
      : "";
    const showClearBtn = shouldShowClearOrderButton(order);
    const showRescindConfirm =
      !showClearBtn && rescindConfirmOrderId === order.id;
    const actionBtnHtml = showClearBtn
      ? `<button type="button" class="orderSidebarClearBtn" data-order-id="${escapeAttribute(order.id)}">Clear from dashboard</button>`
      : showRescindConfirm
        ? `
    <div class="orderSidebarRescindConfirm">
      <div class="orderSidebarRescindPrompt">Rescind this notice? This will cancel the allergy notice submission.</div>
      <div class="orderSidebarRescindActions">
        <button type="button" class="orderSidebarRescindConfirmBtn" data-order-id="${escapeAttribute(order.id)}">Yes, rescind</button>
        <button type="button" class="orderSidebarRescindCancelBtn" data-order-id="${escapeAttribute(order.id)}">Keep notice</button>
      </div>
    </div>
  `
        : `<button type="button" class="orderSidebarRescindBtn" data-order-id="${escapeAttribute(order.id)}">Rescind notice</button>`;
    const isRescinded = order.status === TABLET_ORDER_STATUSES.RESCINDED_BY_DINER;
    const statusLabel = isRescinded ? "Notice rescinded" : "Submitted Notice";
    const statusMeta = isRescinded
      ? "Your allergy notice has been rescinded."
      : metaLine;

    return `
  <div class="orderSidebarCard orderSidebarPendingCard" data-order-id="${escapeAttribute(order.id)}">
    <div class="orderSidebarPendingLabel">${statusLabel}</div>
    <div class="orderSidebarPendingMeta">${statusMeta}</div>
    <div class="orderSidebarPendingBadge">
      <span class="${badgeClass}">${escapeConfirmationHtml(descriptor.label || "Updating status")}</span>
    </div>
    <div class="orderSidebarPendingMeta"><strong>Order:</strong> ${esc(dishName)}</div>
    <div class="orderSidebarPendingMeta"><strong>Allergens:</strong> ${esc(allergens)}</div>
    <div class="orderSidebarPendingMeta"><strong>Diets:</strong> ${esc(diets)}</div>
    ${submittedTimeStr ? `<div class="orderSidebarTimestamp"><span class="orderSidebarTimestampActor">Diner:</span> notice submitted <span class="orderSidebarTimestampTime">${submittedTimeStr}</span></div>` : ""}
    ${kitchenQuestionHtml}
    ${updatesHtml}
    ${actionBtnHtml}
  </div>
    `;
  }

  function renderOrderSidebarPendingOrders(orders) {
    if (!orderSidebarItems) return;
    syncOrderItemSelections();
    orderSidebarItems.dataset.mode = orders.length ? "pending" : "cart";
    const cartItems = Array.isArray(window.orderItems) ? window.orderItems : [];
    const cartItemsHtml = cartItems.length
      ? `
  <div class="orderSidebarCard">
    <div class="orderSidebarPendingLabel">New items</div>
    ${cartItems
      .map(
        (itemName) => `
      <div class="orderItem" data-dish-name="${escapeAttribute(itemName)}">
        <button type="button" class="orderItemSelect${isOrderItemSelected(itemName) ? " is-selected" : ""}" data-dish-name="${escapeAttribute(itemName)}" aria-pressed="${isOrderItemSelected(itemName) ? "true" : "false"}" aria-label="Select ${escapeAttribute(itemName)}"></button>
        <div style="flex:1">
          <div class="orderItemName">${esc(itemName)}</div>
        </div>
        <button type="button" class="orderItemRemove" data-dish-name="${esc(itemName)}">Remove</button>
      </div>
    `,
      )
      .join("")}
  </div>
    `
      : "";
    const ordersHtml = orders.map(buildOrderSidebarPendingOrderHtml).join("");
    orderSidebarItems.innerHTML = `${ordersHtml}${cartItemsHtml}`;
    updateConfirmButtonVisibility();
    if (cartItems.length > 0) {
      orderSidebarItems.querySelectorAll(".orderItemRemove").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const dishName = btn.getAttribute("data-dish-name");
          if (dishName) removeDishFromOrder(dishName);
        });
      });
      bindOrderItemSelectButtons(orderSidebarItems);
    }
    orderSidebarItems
      .querySelectorAll(".orderSidebarRescindBtn")
      .forEach((btn) => {
        btn.addEventListener("click", handleRescindNotice);
      });
    orderSidebarItems
      .querySelectorAll(".orderSidebarRescindConfirmBtn")
      .forEach((btn) => {
        btn.addEventListener("click", handleRescindConfirm);
      });
    orderSidebarItems
      .querySelectorAll(".orderSidebarRescindCancelBtn")
      .forEach((btn) => {
        btn.addEventListener("click", handleRescindCancel);
      });
    orderSidebarItems.querySelectorAll(".orderSidebarClearBtn").forEach((btn) => {
      btn.addEventListener("click", handleClearOrderFromSidebar);
    });
    orderSidebarItems
      .querySelectorAll(".orderSidebarQuestionBtn")
      .forEach((btn) => {
        btn.addEventListener("click", handleKitchenQuestionResponse);
      });
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
    if (!orderConfirmServerPanel) return;
    const body = orderConfirmServerPanel.querySelector(".orderConfirmTabletBody");
    if (!body) return;
    const relevantStatuses = [
      TABLET_ORDER_STATUSES.SUBMITTED_TO_SERVER,
      TABLET_ORDER_STATUSES.QUEUED_FOR_KITCHEN,
      TABLET_ORDER_STATUSES.REJECTED_BY_SERVER,
    ];

    const serverGroups = new Map();
    tabletSimState.orders.forEach((order) => {
      if (!order?.serverCode) return;
      if (!relevantStatuses.includes(order.status)) return;
      ensureOrderServerMetadata(order);
      const serverId = order.serverId || "0000";
      if (!serverGroups.has(serverId)) {
        serverGroups.set(serverId, []);
      }
      serverGroups.get(serverId).push(order);
    });

    if (serverGroups.size === 0) {
      body.innerHTML =
        '<div class="orderConfirmStatusBadge" data-tone="idle">Waiting for diner</div><p class="orderConfirmEmpty">Share your server code plus their table number when you&rsquo;re ready.</p>';
      return;
    }

    if (
      !serverPanelState.activeServerId ||
      !serverGroups.has(serverPanelState.activeServerId)
    ) {
      serverPanelState.activeServerId = Array.from(serverGroups.keys())[0];
    }

    const tabsHtml = Array.from(serverGroups.entries())
      .map(([serverId, orders]) => {
        const name =
          ensureOrderServerMetadata(orders[0]).serverName || `Server ${serverId}`;
        const isActive = serverId === serverPanelState.activeServerId;
        return `<button type="button" class="orderConfirmServerTab${isActive ? " is-active" : ""}" data-server-tab="${escapeAttribute(serverId)}">${escapeConfirmationHtml(name)}</button>`;
      })
      .join("");

    const activeOrders = serverGroups.get(serverPanelState.activeServerId) || [];
    const orderCards = activeOrders.length
      ? activeOrders.map(renderServerOrderCard).join("")
      : '<p class="serverOrderEmpty">No active notices for this server.</p>';

    body.innerHTML = `
  <div class="orderConfirmServerTabs">${tabsHtml}</div>
  <div class="orderConfirmServerOrders">${orderCards}</div>
    `;
  }

  function renderServerOrderCard(order) {
    ensureOrderServerMetadata(order);
    const descriptor = ORDER_STATUS_DESCRIPTORS[order.status] || {
      label: "Updating status",
      tone: "info",
    };
    const badgeClass = getBadgeClassForTone(descriptor.tone);
    const dishes =
      Array.isArray(order.items) && order.items.length
        ? order.items.map((item) => esc(item)).join(", ")
        : "No dishes listed";
    const allergies =
      Array.isArray(order.allergies) && order.allergies.length
        ? order.allergies.map((a) => formatOrderListLabel(a)).join(", ")
        : "None saved";
    const diets =
      Array.isArray(order.diets) && order.diets.length
        ? order.diets.join(", ")
        : "None saved";
    const tableLabel = order.tableNumber
      ? `Table ${esc(order.tableNumber)}`
      : "Table not recorded";
    const codeLabel = order.serverCode
      ? `Code ${esc(order.serverCode)}`
      : "Code unavailable";
    const notes = order.customNotes
      ? `<div>Notes: ${esc(order.customNotes)}</div>`
      : "";
    let actionsHtml = "";
    if (order.status === TABLET_ORDER_STATUSES.SUBMITTED_TO_SERVER) {
      actionsHtml = `
    <div class="serverOrderActions">
      <button type="button" data-server-action="approve" data-order-id="${escapeAttribute(order.id)}">Approve &amp; send to kitchen</button>
      <button type="button" data-server-action="reject" data-order-id="${escapeAttribute(order.id)}">Reject notice</button>
  </div>`;
    } else if (order.status === TABLET_ORDER_STATUSES.QUEUED_FOR_KITCHEN) {
      actionsHtml = `
    <div class="serverOrderActions">
      <button type="button" data-server-action="dispatch" data-order-id="${escapeAttribute(order.id)}">Send to kitchen</button>
      <button type="button" data-server-action="reject" data-order-id="${escapeAttribute(order.id)}">Reject notice</button>
  </div>`;
    } else if (order.status === TABLET_ORDER_STATUSES.REJECTED_BY_SERVER) {
      actionsHtml =
        '<p class="serverOrderEmpty">Rejected. Waiting for diner updates.</p>';
    } else {
      actionsHtml =
        '<p class="serverOrderEmpty">This notice has moved to the kitchen tablet.</p>';
    }

    return `
  <article class="serverOrderCard" data-order-id="${escapeAttribute(order.id)}">
    <div class="serverOrderHeader">
      <div>
        <div class="serverOrderTitle">${esc(order.customerName || "Guest")}</div>
        <div class="serverOrderMeta">${tableLabel} • ${codeLabel}</div>
        <div class="serverOrderMeta">Dishes: ${dishes}</div>
      </div>
      <span class="${badgeClass}">${escapeConfirmationHtml(descriptor.label)}</span>
    </div>
    <div class="serverOrderDetails">
      <div>Allergies: ${esc(allergies)}</div>
      <div>Diets: ${esc(diets)}</div>
      ${notes}
    </div>
    ${actionsHtml}
  </article>
    `;
  }

  async function handleServerOrderAction(action, orderId) {
    const order = getTabletOrderById(orderId);
    if (!order) return;
    try {
      if (action === "approve") {
        tabletServerApprove(tabletSimState, orderId);
        tabletServerDispatchToKitchen(tabletSimState, orderId);
      } else if (action === "dispatch") {
        tabletServerDispatchToKitchen(tabletSimState, orderId);
      } else if (action === "reject") {
        const reason = await showTextPrompt({
          title: "Reject notice",
          message: "Let the diner know why this notice cannot be processed.",
          placeholder:
            "e.g. We need a manager to assist before sending this through.",
          confirmLabel: "Send rejection",
          cancelLabel: "Cancel",
        });
        if (reason === null) return;
        const rejectionReason = reason || "Rejected the notice.";
        tabletServerReject(tabletSimState, orderId, rejectionReason);
      } else {
        return;
      }
      persistTabletStateAndRender();
    } catch (error) {
      alert(error?.message || "Unable to update server tablet.");
    }
  }

  function renderKitchenOrderCard(order) {
    ensureOrderServerMetadata(order);
    const descriptor = ORDER_STATUS_DESCRIPTORS[order.status] || {
      label: "Updating status",
      tone: "info",
    };
    const badgeClass = getBadgeClassForTone(descriptor.tone);
    const dishes =
      Array.isArray(order.items) && order.items.length
        ? order.items.map((item) => esc(item)).join(", ")
        : "No dishes listed";
    const allergies =
      Array.isArray(order.allergies) && order.allergies.length
        ? order.allergies.map((a) => formatOrderListLabel(a)).join(", ")
        : "None saved";
    const diets =
      Array.isArray(order.diets) && order.diets.length
        ? order.diets.join(", ")
        : "None saved";
    const tableLabel = order.tableNumber
      ? `Table ${esc(order.tableNumber)}`
      : "Table not recorded";
    const messageLog =
      Array.isArray(order.kitchenMessages) && order.kitchenMessages.length
        ? `<div class="kitchenOrderNotes">Messages sent: ${order.kitchenMessages.map((msg) => `${esc(msg.text)} (${formatTabletTimestamp(msg.at)})`).join("; ")}</div>`
        : "";
    const questionLog = order.kitchenQuestion
      ? `<div class="kitchenOrderNotes">Follow-up: ${esc(order.kitchenQuestion.text)}${order.kitchenQuestion.response ? ` • Diner replied ${esc(order.kitchenQuestion.response.toUpperCase())}` : " • Awaiting diner response"}</div>`
      : "";

    const actions = [];
    if (order.status === TABLET_ORDER_STATUSES.WITH_KITCHEN) {
      actions.push(
        `<button type="button" data-kitchen-action="acknowledge" data-order-id="${escapeAttribute(order.id)}">Acknowledge notice</button>`,
      );
    }
    if (order.status !== TABLET_ORDER_STATUSES.ACKNOWLEDGED) {
      actions.push(
        `<button type="button" data-kitchen-action="message" data-order-id="${escapeAttribute(order.id)}">Send follow-up message</button>`,
      );
    }

    const actionsHtml = actions.length
      ? `<div class="kitchenOrderActions">${actions.join("")}</div>`
      : "";

    return `
  <article class="kitchenOrderCard" data-order-id="${escapeAttribute(order.id)}">
    <div class="kitchenOrderHeader">
      <div>
        <div class="kitchenOrderTitle">${esc(order.customerName || "Guest")}</div>
        <div class="kitchenOrderMeta">${tableLabel} • Dishes: ${dishes}</div>
      </div>
      <span class="${badgeClass}">${escapeConfirmationHtml(descriptor.label)}</span>
    </div>
    <div class="kitchenOrderMeta">Allergies: ${esc(allergies)}</div>
    <div class="kitchenOrderMeta">Diets: ${esc(diets)}</div>
    ${messageLog}
    ${questionLog}
    ${actionsHtml}
  </article>
    `;
  }

  function renderOrderConfirmKitchenPanel() {
    if (!orderConfirmKitchenPanel) return;
    const body = orderConfirmKitchenPanel.querySelector(
      ".orderConfirmTabletBody",
    );
    if (!body) return;
    const activeStatuses = [
      TABLET_ORDER_STATUSES.WITH_KITCHEN,
      TABLET_ORDER_STATUSES.ACKNOWLEDGED,
      TABLET_ORDER_STATUSES.AWAITING_USER_RESPONSE,
      TABLET_ORDER_STATUSES.QUESTION_ANSWERED,
    ];
    const orders = tabletSimState.orders.filter((order) =>
      activeStatuses.includes(order.status),
    );
    if (orders.length === 0) {
      body.innerHTML =
        '<div class="orderConfirmStatusBadge" data-tone="idle">Kitchen idle</div><p class="orderConfirmEmpty">The request will appear here after the server dispatches it.</p>';
      return;
    }
    const cards = orders.map(renderKitchenOrderCard).join("");
    body.innerHTML = `<div class="kitchenOrderList">${cards}</div>`;
  }

  async function handleOrderConfirmSubmit() {
    if (!orderConfirmForm) return;
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
      window.orderItems = Array.isArray(window.orderItems)
        ? window.orderItems.filter((item) => !submittedSet.has(item))
        : [];
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
    const tabBtn = evt.target.closest?.("[data-server-tab]");
    if (tabBtn) {
      evt.preventDefault();
      const id = tabBtn.getAttribute("data-server-tab");
      if (id && id !== serverPanelState.activeServerId) {
        serverPanelState.activeServerId = id;
        renderOrderConfirmServerPanel();
      }
      return;
    }
    const actionBtn = evt.target.closest?.("[data-server-action]");
    if (actionBtn) {
      evt.preventDefault();
      const action = actionBtn.getAttribute("data-server-action");
      const orderId = actionBtn.getAttribute("data-order-id");
      if (!action || !orderId) return;
      handleServerOrderAction(action, orderId).catch((err) => {
        console.error("Server action failed", err);
        alert("Unable to update server tablet at this time.");
      });
    }
  }

  function handleOrderConfirmKitchenPanel(evt) {
    const actionBtn = evt.target.closest?.("[data-kitchen-action]");
    if (!actionBtn) return;
    evt.preventDefault();
    const action = actionBtn.getAttribute("data-kitchen-action");
    const orderId = actionBtn.getAttribute("data-order-id");
    if (!action || !orderId) return;
    handleKitchenOrderAction(action, orderId).catch((err) => {
      console.error("Kitchen action failed", err);
      alert("Unable to update the kitchen tablet right now.");
    });
  }

  async function handleKitchenOrderAction(action, orderId) {
    const order = getTabletOrderById(orderId);
    if (!order) return;
    try {
      if (action === "acknowledge") {
        const chefId = tabletSimState.chefs[0]?.id || null;
        if (!chefId) throw new Error("No chefs available.");
        tabletKitchenAcknowledge(tabletSimState, orderId, chefId);
      } else if (action === "message") {
        const text = await showTextPrompt({
          title: "Send follow-up message",
          message: "What would you like the diner to see on their side?",
          placeholder:
            "e.g. Please confirm if sesame oil is okay before we proceed.",
          confirmLabel: "Send message",
          cancelLabel: "Cancel",
        });
        if (!text) return;
        recordKitchenMessage(order, text);
      } else {
        return;
      }
      persistTabletStateAndRender();
    } catch (error) {
      throw error;
    }
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

  function recordKitchenMessage(order, message) {
    if (!order || !message?.trim()) return;
    const text = message.trim();
    const entry = {
      text,
      at: new Date().toISOString(),
    };
    if (!Array.isArray(order.kitchenMessages)) {
      order.kitchenMessages = [];
    }
    order.kitchenMessages.push(entry);
    order.history.push({
      actor: "Kitchen",
      message: `Sent message to diner: "${text}"`,
      at: entry.at,
    });
    order.status = TABLET_ORDER_STATUSES.AWAITING_USER_RESPONSE;
    order.updatedAt = entry.at;
  }

  function showTextPrompt({
    title = "Input",
    message = "",
    placeholder = "",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
  } = {}) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "appPromptBackdrop";
      const modal = document.createElement("div");
      modal.className = "appPromptModal";
      const heading = document.createElement("h3");
      heading.textContent = title;
      modal.appendChild(heading);
      if (message) {
        const desc = document.createElement("p");
        desc.textContent = message;
        modal.appendChild(desc);
      }
      const textarea = document.createElement("textarea");
      textarea.placeholder = placeholder;
      modal.appendChild(textarea);
      const actions = document.createElement("div");
      actions.className = "appPromptModalActions";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "appPromptCancel";
      cancelBtn.textContent = cancelLabel;
      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "appPromptConfirm";
      confirmBtn.textContent = confirmLabel;
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      modal.appendChild(actions);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      const cleanup = () => {
        backdrop.remove();
      };

      cancelBtn.addEventListener("click", () => {
        cleanup();
        resolve(null);
      });
      confirmBtn.addEventListener("click", () => {
        const value = textarea.value.trim();
        cleanup();
        resolve(value);
      });
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) {
          cleanup();
          resolve(null);
        }
      });
      textarea.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cleanup();
          resolve(null);
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          const value = textarea.value.trim();
          cleanup();
          resolve(value);
        }
      });
      setTimeout(() => textarea.focus(), 50);
    });
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
      if (
        window.orderItems &&
        Array.isArray(window.orderItems) &&
        window.orderItems.length > 0
      ) {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            items: window.orderItems,
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
          window.orderItems = [...data.items];
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
    window.orderItems = [];
    clearOrderItemSelections();
    return false;
  }

  function getOrderItemSelections() {
    if (!window.orderItemSelections) window.orderItemSelections = new Set();
    return window.orderItemSelections;
  }

  function clearOrderItemSelections() {
    getOrderItemSelections().clear();
  }

  function syncOrderItemSelections() {
    const selections = getOrderItemSelections();
    const items = Array.isArray(window.orderItems) ? window.orderItems : [];
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
    if (orderConfirmDrawer?.classList.contains("show")) {
      renderOrderConfirmSummary();
    }
  }

  function getSelectedOrderItems() {
    syncOrderItemSelections();
    const selections = getOrderItemSelections();
    const items = Array.isArray(window.orderItems) ? window.orderItems : [];
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
    if (!window.orderItems) window.orderItems = [];
    if (window.orderItems.includes(dishName)) {
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
    window.orderItems.push(dishName);
    persistOrderItems();
    updateOrderSidebar();
    openOrderSidebar();
    closeDishDetailsAfterAdd();
    return { success: true };
  }

  function removeDishFromOrder(dishName) {
    if (!window.orderItems) window.orderItems = [];
    const index = window.orderItems.indexOf(dishName);
    if (index > -1) {
      window.orderItems.splice(index, 1);
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
    const hasItems =
      Array.isArray(window.orderItems) && window.orderItems.length > 0;
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

    if (!window.orderItems || window.orderItems.length === 0) {
      sidebarItemsContainer.innerHTML =
        '<div class="orderSidebarEmpty">No items added yet</div>';
      setConfirmButtonVisibility(false);
      setConfirmButtonDisabled(true);
      minimizeOrderSidebar();
    } else {
      const itemsHTML = window.orderItems
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

    if (orderConfirmDrawer?.classList.contains("show")) {
      renderOrderConfirmSummary();
    }

    updateOrderSidebarBadge();
    setOrderSidebarVisibility();
  }

  function isOrderSidebarDisabled() {
    return state.page === "editor";
  }

  function hasOrderSidebarContent() {
    const hasItems =
      Array.isArray(window.orderItems) && window.orderItems.length > 0;
    const sidebarOrders = getSidebarOrders();
    return hasItems || (Array.isArray(sidebarOrders) && sidebarOrders.length > 0);
  }

  function setOrderSidebarVisibility() {
    const sidebar = document.getElementById("orderSidebar");
    if (!sidebar) return;
    if (isOrderSidebarDisabled()) {
      sidebar.style.display = "none";
      sidebar.classList.remove("open");
      sidebar.classList.add("minimized");
      document.body.classList.remove("orderSidebarOpen");
      return;
    }
    const hasContent = hasOrderSidebarContent();
    sidebar.style.display = hasContent ? "" : "none";
    if (!hasContent) {
      sidebar.classList.remove("open");
      sidebar.classList.add("minimized");
      document.body.classList.remove("orderSidebarOpen");
    }
  }

  function setOrderSidebarToggleLabel(text) {
    const label = document.getElementById("orderSidebarToggleLabel");
    const toggleBtn = document.getElementById("orderSidebarToggle");
    if (label) {
      label.textContent = text;
      return;
    }
    if (toggleBtn) {
      toggleBtn.textContent = text;
    }
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
    const hasCartItems =
      Array.isArray(window.orderItems) && window.orderItems.length > 0;
    const isCleared = orderSidebarItems?.dataset.mode === "cleared";
    const cartCount = hasCartItems && !isCleared ? window.orderItems.length : 0;
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
    const badge = document.getElementById("orderSidebarBadge");
    if (!badge) return;
    const count = getActiveOrderCount();
    if (count > 0) {
      badge.textContent = String(count);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function setConfirmButtonVisibility(visible) {
    if (confirmOrderBtn) {
      confirmOrderBtn.hidden = !visible;
    }
    if (orderSidebarActions) {
      orderSidebarActions.style.display = visible ? "" : "none";
    }
    if (!visible && confirmOrderHint) {
      confirmOrderHint.hidden = true;
    }
  }

  function setConfirmButtonDisabled(disabled) {
    if (confirmOrderBtn) {
      confirmOrderBtn.disabled = disabled;
    }
    if (confirmOrderHint) {
      const isVisible = !!confirmOrderBtn && !confirmOrderBtn.hidden;
      confirmOrderHint.hidden = !disabled || !isVisible;
    }
  }

  let orderSidebarCustomHeight = null;
  let orderSidebarLastExpandedHeight = null;
  let orderSidebarDragState = null;

  function clampValue(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getOrderSidebarHeightBounds(options = {}) {
    const { allowCollapsed = false } = options;
    const viewportHeight = window.innerHeight || 0;
    const collapsedHeight = getOrderSidebarCollapsedHeight();
    const minHeight = allowCollapsed
      ? collapsedHeight
      : Math.max(collapsedHeight + 80, Math.round(viewportHeight * 0.35));
    const maxHeight = Math.max(
      minHeight + 140,
      Math.round(viewportHeight * 0.92),
    );
    return { minHeight, maxHeight };
  }

  function getOrderSidebarCollapsedHeight() {
    const sidebar = document.getElementById("orderSidebar");
    if (!sidebar) return 72;
    const raw = getComputedStyle(sidebar).getPropertyValue(
      "--order-sidebar-collapsed-height",
    );
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 72;
  }

  function setOrderSidebarHeight(height, persist = true) {
    const sidebar = document.getElementById("orderSidebar");
    if (!sidebar) return;
    if (persist) {
      orderSidebarCustomHeight = height;
    }
    sidebar.style.setProperty("--order-sidebar-height", `${height}px`);
  }

  function updateOrderSidebarHeight() {
    const sidebar = document.getElementById("orderSidebar");
    if (!sidebar) return;
    if (sidebar.classList.contains("minimized")) {
      return;
    }
    const { minHeight, maxHeight } = getOrderSidebarHeightBounds();
    const menuWrap = document.querySelector(".menuWrap");
    let baseHeight = menuWrap ? menuWrap.getBoundingClientRect().height : 0;
    if (!baseHeight || baseHeight < 200) baseHeight = window.innerHeight || 0;
    let targetHeight = orderSidebarCustomHeight;
    if (!targetHeight || Number.isNaN(targetHeight)) {
      targetHeight = Math.round(baseHeight * 0.75);
    }
    targetHeight = clampValue(targetHeight, minHeight, maxHeight);
    setOrderSidebarHeight(targetHeight);
  }

  function initOrderSidebarDrag() {
    const header = document.querySelector(".orderSidebarHeader");
    const sidebar = document.getElementById("orderSidebar");
    if (!header || !sidebar) return;

    const onPointerDown = (event) => {
      if (event.target.closest("button")) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      orderSidebarDragState = {
        startY: event.clientY,
        startHeight: sidebar.getBoundingClientRect().height,
        lastHeight: null,
      };
      orderSidebarLastExpandedHeight =
        orderSidebarCustomHeight || orderSidebarDragState.startHeight;
      sidebar.classList.add("dragging");
      if (header.setPointerCapture) {
        header.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
    };

    const onPointerMove = (event) => {
      if (!orderSidebarDragState) return;
      const delta = orderSidebarDragState.startY - event.clientY;
      const { minHeight, maxHeight } = getOrderSidebarHeightBounds({
        allowCollapsed: true,
      });
      const collapseThreshold = getOrderSidebarCollapsedHeight() + 24;
      let nextHeight = orderSidebarDragState.startHeight + delta;
      nextHeight = clampValue(nextHeight, minHeight, maxHeight);
      orderSidebarDragState.lastHeight = nextHeight;
      sidebar.classList.remove("minimized");
      sidebar.classList.add("open");
      document.body.classList.add("orderSidebarOpen");
      const shouldPersist = nextHeight > collapseThreshold;
      if (shouldPersist) {
        orderSidebarLastExpandedHeight = nextHeight;
      }
      setOrderSidebarHeight(nextHeight, shouldPersist);
      event.preventDefault();
    };

    const onPointerUp = () => {
      if (!orderSidebarDragState) return;
      const finalHeight =
        orderSidebarDragState.lastHeight || orderSidebarDragState.startHeight;
      const collapseThreshold = getOrderSidebarCollapsedHeight() + 24;
      orderSidebarUserToggled = true;
      sidebar.classList.remove("dragging");
      orderSidebarDragState = null;
      if (finalHeight <= collapseThreshold) {
        if (orderSidebarLastExpandedHeight) {
          orderSidebarCustomHeight = orderSidebarLastExpandedHeight;
        }
        minimizeOrderSidebar();
        return;
      }
      setOrderSidebarHeight(finalHeight);
      openOrderSidebar();
    };

    header.addEventListener("pointerdown", onPointerDown);
    header.addEventListener("pointermove", onPointerMove);
    header.addEventListener("pointerup", onPointerUp);
    header.addEventListener("pointercancel", onPointerUp);
  }

  function hasSubmittedActiveOrder() {
    const order = getTabletOrder();
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

  function updateConfirmButtonVisibility() {
    const hasItems =
      Array.isArray(window.orderItems) && window.orderItems.length > 0;
    const clearedMode = orderSidebarItems?.dataset.mode === "cleared";
    if (!hasItems || clearedMode) {
      setConfirmButtonVisibility(false);
      setConfirmButtonDisabled(true);
      return;
    }
    const selectedItems = getSelectedOrderItems();
    setConfirmButtonVisibility(true);
    setConfirmButtonDisabled(selectedItems.length === 0);
  }

  function minimizeOrderSidebar() {
    const sidebar = document.getElementById("orderSidebar");
    if (!sidebar) return;
    if (isOrderSidebarDisabled()) {
      sidebar.classList.remove("open");
      sidebar.classList.add("minimized");
      document.body.classList.remove("orderSidebarOpen");
      return;
    }
    sidebar.classList.add("minimized");
    sidebar.classList.remove("open");
    setOrderSidebarToggleLabel("+ View order dashboard");
    document.body.classList.remove("orderSidebarOpen");
    updateOrderSidebarHeight();
    updateOrderSidebarBadge();
  }

  function openOrderSidebar() {
    const sidebar = document.getElementById("orderSidebar");
    if (!sidebar) return;
    if (isOrderSidebarDisabled()) {
      setOrderSidebarVisibility();
      return;
    }
    if (!hasOrderSidebarContent()) {
      setOrderSidebarVisibility();
      return;
    }
    sidebar.classList.add("open");
    sidebar.classList.remove("minimized");
    setOrderSidebarToggleLabel("−");
    document.body.classList.add("orderSidebarOpen");
    updateOrderSidebarHeight();
    updateOrderSidebarBadge();
  }

  function toggleOrderSidebar() {
    const sidebar = document.getElementById("orderSidebar");
    if (!sidebar || isOrderSidebarDisabled()) return;
    if (!hasOrderSidebarContent()) {
      setOrderSidebarVisibility();
      return;
    }
    orderSidebarUserToggled = true;
    if (sidebar.classList.contains("minimized")) {
      openOrderSidebar();
    } else {
      minimizeOrderSidebar();
    }
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
    window.addEventListener("resize", updateOrderSidebarHeight);
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
    if (hasRestoredItems && window.orderItems && window.orderItems.length > 0) {
      // Visually restore selected dishes in the menu
      const waitForMenu = () => {
        const menu = document.getElementById("menu");
        if (menu && menu.querySelectorAll(".overlay").length > 0) {
          window.orderItems.forEach((dishName) => {
            const overlays = document.querySelectorAll(".overlay");
            overlays.forEach((overlay) => {
              const titleEl = overlay.querySelector(".tTitle");
              if (titleEl) {
                const title = titleEl.textContent.trim();
                if (
                  title.toLowerCase() === dishName.toLowerCase() ||
                  title === dishName
                ) {
                  overlay.classList.add("selected");
                  if (typeof window.setOverlayPulseColor === "function") {
                    window.setOverlayPulseColor(overlay);
                  }
                  const addBtn = overlay.querySelector(
                    `.addToOrderBtn[data-dish-name]`,
                  );
                  if (addBtn) {
                    addBtn.disabled = true;
                    addBtn.textContent = "Added";
                  }
                }
              }
            });
          });
          updateOrderSidebar();
          openOrderSidebar();
        } else {
          setTimeout(waitForMenu, 100);
        }
      };
      setTimeout(waitForMenu, 500);
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
