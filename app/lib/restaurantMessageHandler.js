import { filterRestaurantsByVisibility } from "./restaurantVisibility.js";
import {
  applyOverlayPulseColor,
  callRerenderLayer,
  getSaveReviewControl,
  getDisplayChangeLog,
  getOpenBrandVerification,
  getOpenConfirmOnLoad,
  getOpenLogOnLoad,
  getStartInEditor,
  resetEditorRouteFlags,
  setOpenConfirmOnLoad,
  setOpenLogOnLoad,
} from "./restaurantRuntime/restaurantRuntimeBridge.js";
import {
  getOrderItems,
  setOrderItems,
  getSupabaseClient,
} from "./restaurantRuntime/runtimeSessionState.js";

function filterOrdersByRestaurant(orderFlow, restaurantId) {
  if (!orderFlow || !orderFlow.tabletSimState) return;
  orderFlow.tabletSimState.orders = (orderFlow.tabletSimState.orders || []).filter(
    (order) => order && order.restaurantId === restaurantId,
  );
}

function clearCurrentTabletOrderIfNeeded({
  orderFlow,
  restaurantId,
  stopOrderRefresh,
}) {
  if (!orderFlow || !orderFlow.tabletSimOrderId) return;
  const currentOrder = (orderFlow.tabletSimState?.orders || []).find(
    (order) => order && order.id === orderFlow.tabletSimOrderId,
  );
  if (!currentOrder || currentOrder.restaurantId !== restaurantId) {
    orderFlow.tabletSimOrderId = null;
    stopOrderRefresh();
  }
}

function restoreSelectedMenuItems({ updateOrderSidebar, openOrderSidebar }) {
  const orderItems = getOrderItems();
  if (!orderItems.length) return;

  const waitForMenu = () => {
    const menu = document.getElementById("menu");
    if (menu && menu.querySelectorAll(".overlay").length > 0) {
      orderItems.forEach((dishName) => {
        const overlays = document.querySelectorAll(".overlay");
        overlays.forEach((overlay) => {
          const titleEl = overlay.querySelector(".tTitle");
          if (!titleEl) return;
          const title = titleEl.textContent.trim();
          if (
            title.toLowerCase() !== String(dishName).toLowerCase() &&
            title !== dishName
          ) {
            return;
          }

          overlay.classList.add("selected");
          applyOverlayPulseColor(overlay);

          const addBtn = overlay.querySelector(`.addToOrderBtn[data-dish-name]`);
          if (addBtn) {
            addBtn.disabled = true;
            addBtn.textContent = "Added";
          }
        });
      });
      updateOrderSidebar();
      openOrderSidebar();
      return;
    }

    setTimeout(waitForMenu, 100);
  };

  setTimeout(waitForMenu, 500);
}

function applyRestaurantUpdate({
  message,
  state,
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
}) {
  if (!message.restaurant) return;

  const nextRestaurant = normalizeRestaurant(message.restaurant);
  const nextRestaurantId = nextRestaurant?._id || nextRestaurant?.id || null;
  const previousRestaurantId =
    state.restaurant?._id || state.restaurant?.id || null;

  if (
    nextRestaurantId &&
    previousRestaurantId &&
    nextRestaurantId !== previousRestaurantId
  ) {
    filterOrdersByRestaurant(orderFlow, nextRestaurantId);
    clearCurrentTabletOrderIfNeeded({
      orderFlow,
      restaurantId: nextRestaurantId,
      stopOrderRefresh,
    });
    persistTabletStateSnapshot();
    renderOrderSidebarStatus(null);
  }

  state.restaurant = nextRestaurant;

  if (nextRestaurantId) {
    if (previousRestaurantId && nextRestaurantId !== previousRestaurantId) {
      setOrderItems([]);
      clearOrderItemSelections();
    }

    const restored = restoreOrderItems();
    if (!restored) {
      setOrderItems([]);
      clearOrderItemSelections();
    }

    persistOrderItems();
    updateOrderSidebar();
    restoreSelectedMenuItems({ updateOrderSidebar, openOrderSidebar });
  }

  rebuildBrandMemoryFromRestaurant();
}

function applyRestaurantsUpdate({ message, state }) {
  if (!message.restaurants) return;
  state.restaurants = filterRestaurantsByVisibility(message.restaurants || [], {
    user: state.user || null,
  });
}

function hydrateQrPreferences({ state, urlQR, normalizeAllergen, normalizeDietLabel }) {
  if ((state.qr || urlQR) && (!state.allergies || !state.allergies.length)) {
    try {
      const storedAllergies = sessionStorage.getItem("qrAllergies");
      if (storedAllergies) {
        state.allergies = (JSON.parse(storedAllergies) || [])
          .map(normalizeAllergen)
          .filter(Boolean);
      }
    } catch (_) {
      // Ignore malformed session payloads
    }
  }

  if ((state.qr || urlQR) && (!state.diets || !state.diets.length)) {
    try {
      const storedDiets = sessionStorage.getItem("qrDiets");
      if (storedDiets) {
        state.diets = (JSON.parse(storedDiets) || [])
          .map(normalizeDietLabel)
          .filter(Boolean);
      }
    } catch (_) {
      // Ignore malformed session payloads
    }
  }
}

function maybeResetAckForRestaurantEntry({ message, state }) {
  const params = new URLSearchParams(window.location.search);
  const hasDishNameParam = !!params.get("dishName");
  const ackParam = params.get("ack");

  if (
    (message.page === "restaurant" || message.restaurant) &&
    !hasDishNameParam &&
    ackParam !== "1"
  ) {
    state.ack = false;
  }
}

function handleMessageTypes({
  message,
  state,
  normalizeAllergen,
  normalizeDietLabel,
  rerenderOrderConfirmDetails,
  handleDishEditorResult,
  handleDishEditorError,
  normalizeRestaurant,
  rebuildBrandMemoryFromRestaurant,
  getEditorSaveApi,
  checkForActiveOrders,
  updateLastConfirmedText,
}) {
  if (message.type === "allergiesSaved") {
    state.allergies = (message.allergies || [])
      .map(normalizeAllergen)
      .filter(Boolean);
    rerenderOrderConfirmDetails();
  }

  if (message.type === "aiAssistResult") {
    handleDishEditorResult(message);
    return { stop: true };
  }

  if (message.type === "aiAssistError") {
    handleDishEditorError(message);
    return { stop: true };
  }

  if (message.type === "overlaysSaved") {
    resetEditorRouteFlags();

    try {
      const editorSaveApi = getEditorSaveApi();
      if (editorSaveApi && typeof editorSaveApi.setSaveState === "function") {
        editorSaveApi.setSaveState("saved");
      }
    } catch (_) {
      // Save-state indicator is optional
    }

    const saveReviewControl = getSaveReviewControl();
    if (
      saveReviewControl &&
      typeof saveReviewControl.isOpen === "function" &&
      saveReviewControl.isOpen()
    ) {
      saveReviewControl.close();
    }

    if (message.restaurant) {
      const normalized = normalizeRestaurant(message.restaurant);
      if (normalized) {
        console.log(
          "overlaysSaved: Checking aiIngredients preservation:",
          normalized.overlays?.map((overlay) => ({
            id: overlay.id,
            hasAiIngredients: !!overlay.aiIngredients,
            aiIngredientsType: typeof overlay.aiIngredients,
          })),
        );
        state.restaurant = normalized;
      }

      rebuildBrandMemoryFromRestaurant();
      if (state.restaurant && state.page !== "editor") {
        setTimeout(() => checkForActiveOrders(), 500);
      }
    }

    callRerenderLayer();
    return { stop: false };
  }

  if (message.type === "saveFailed") {
    try {
      const editorSaveApi = getEditorSaveApi();
      if (editorSaveApi && typeof editorSaveApi.setSaveState === "function") {
        editorSaveApi.setSaveState("error");
      }

      const saveReviewControl = getSaveReviewControl();
      const hasSaveReview =
        saveReviewControl &&
        typeof saveReviewControl.isOpen === "function" &&
        saveReviewControl.isOpen();

      if (
        saveReviewControl &&
        typeof saveReviewControl.setError === "function"
      ) {
        saveReviewControl.setError(
          "Save failed. Please review and try again.",
        );
      }

      console.error("Save failed message received:", message.message, message.error);
      console.error("Full error object:", JSON.stringify(message.error, null, 2));

      let errorMessage = message.message || "Unknown error occurred";
      if (message.error) {
        if (message.error.code) errorMessage += `\nError code: ${message.error.code}`;
        if (message.error.hint) errorMessage += `\nHint: ${message.error.hint}`;
        if (message.error.details) {
          errorMessage += `\nDetails: ${JSON.stringify(message.error.details)}`;
        }
      }

      if (!hasSaveReview) {
        alert(
          `❌ Failed to save changes!\n\n${errorMessage}\n\nPlease check the browser console (F12) for full error details.`,
        );
      }
    } catch (_) {
      // Ignore save indicator failures
    }
    return { stop: false };
  }

  if (message.type === "confirmationSaved") {
    if (message.timestamp && state.restaurant) {
      state.restaurant.lastConfirmed = message.timestamp;
    }
    if (message.restaurant) {
      state.restaurant =
        normalizeRestaurant(message.restaurant) || state.restaurant;
      rebuildBrandMemoryFromRestaurant();
    }
    try {
      updateLastConfirmedText();
    } catch (_) {
      // Last-confirmed row may not be mounted yet
    }
    return { stop: false };
  }

  if (message.type === "confirmationFailed") {
    alert("Could not confirm allergen information. " + (message.message || ""));
    return { stop: false };
  }

  if (message.type === "changeLog") {
    try {
      const displayChangeLog = getDisplayChangeLog();
      if (typeof displayChangeLog === "function") {
        displayChangeLog(message.logs || [], message.error);
      }
    } catch (_) {
      // Ignore change-log modal failures
    }
    return { stop: true };
  }

  return { stop: false };
}

function runEditorLoadHooks({ state, openChangeLog }) {
  if (getOpenLogOnLoad() && state.page === "editor") {
    setTimeout(() => {
      if (typeof openChangeLog === "function") {
        openChangeLog();
        setOpenLogOnLoad(false);
      }
    }, 100);
  }

  if (getOpenConfirmOnLoad() && state.page === "editor") {
    setTimeout(() => {
      const openBrandVerification = getOpenBrandVerification();
      if (typeof openBrandVerification === "function") {
        openBrandVerification();
        setOpenConfirmOnLoad(false);
      }
    }, 120);
  }
}

export function createRestaurantMessageHandler(options = {}) {
  const {
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
    getEditorSaveApi,
    checkForActiveOrders,
    updateLastConfirmedText,
    renderTopbar,
    render,
    maybeInitHowItWorksTour,
    updateFullScreenAllergySummary,
    openChangeLog,
  } = options;

  return function handleRestaurantMessage(message) {
    const m = message || {};

    if (!state._hydrated) {
      state._hydrated = true;
      document.body.style.display = "";
    }

    if (m.user) {
      state.user = m.user;
      applyDefaultUserName();
      if (state.user?.loggedIn) {
        initDinerNotifications({ user: state.user, client: getSupabaseClient() });
      }
    }

    if (Object.prototype.hasOwnProperty.call(m, "isHowItWorks")) {
      state.isHowItWorks = !!m.isHowItWorks;
    }

    if (state.user?.loggedIn) {
      closeQrPromo("login");
      if (typeof hideQrBanner === "function") hideQrBanner();
    }

    if (m.allergies) {
      state.allergies = (m.allergies || []).map(normalizeAllergen).filter(Boolean);
      rerenderOrderConfirmDetails();
    }

    if (m.diets) {
      state.diets = (m.diets || []).map(normalizeDietLabel).filter(Boolean);
      rerenderOrderConfirmDetails();
    }

    applyRestaurantUpdate({
      message: m,
      state,
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
    });

    applyRestaurantsUpdate({ message: m, state });

    if (typeof m.canEdit === "boolean") state.canEdit = m.canEdit;

    if (typeof m.qr === "boolean") state.qr = m.qr;
    else if (urlQR) state.qr = true;

    if (m.page) state.page = m.page;

    if (getStartInEditor() && state.canEdit) {
      console.log(
        "Activating editor mode from URL parameter, canEdit:",
        state.canEdit,
      );
      state.page = "editor";
    } else if (getStartInEditor()) {
      console.log("Editor mode requested but canEdit is:", state.canEdit);
    }

    if (m.aiAssistEndpoint) {
      state.aiAssistEndpoint = m.aiAssistEndpoint;
    }

    hydrateQrPreferences({ state, urlQR, normalizeAllergen, normalizeDietLabel });
    maybeResetAckForRestaurantEntry({ message: m, state });

    const typeResult = handleMessageTypes({
      message: m,
      state,
      normalizeAllergen,
      normalizeDietLabel,
      rerenderOrderConfirmDetails,
      handleDishEditorResult,
      handleDishEditorError,
      normalizeRestaurant,
      rebuildBrandMemoryFromRestaurant,
      getEditorSaveApi,
      checkForActiveOrders,
      updateLastConfirmedText,
    });

    if (typeResult.stop) return;

    renderTopbar();
    render();
    maybeInitHowItWorksTour();
    updateFullScreenAllergySummary();
    runEditorLoadHooks({ state, openChangeLog });
  };
}
