import { initAutoOpenDish } from "../../../../lib/autoOpenDishRuntime.js";
import { createBootHydrationRuntime } from "../../../../lib/bootHydrationRuntime.js";
import { initOrderConfirmRestore } from "../../../../lib/orderConfirmRestoreRuntime.js";
import { createRestaurantMessageHandler } from "../../../../lib/restaurantMessageHandler.js";

export function createHydrationRuntime(deps = {}) {
  const state = deps.state || {};

  const handleRestaurantMessage = createRestaurantMessageHandler({
    state,
    urlQR: deps.urlQR,
    applyDefaultUserName: deps.applyDefaultUserName,
    initDinerNotifications: deps.initDinerNotifications,
    closeQrPromo: deps.closeQrPromo,
    hideQrBanner: deps.hideQrBanner,
    normalizeAllergen: deps.normalizeAllergen,
    normalizeDietLabel: deps.normalizeDietLabel,
    rerenderOrderConfirmDetails: deps.rerenderOrderConfirmDetails,
    normalizeRestaurant: deps.normalizeRestaurant,
    orderFlow: deps.orderFlow,
    stopOrderRefresh: deps.stopOrderRefresh,
    persistTabletStateSnapshot: deps.persistTabletStateSnapshot,
    renderOrderSidebarStatus: deps.renderOrderSidebarStatus,
    clearOrderItemSelections: deps.clearOrderItemSelections,
    restoreOrderItems: deps.restoreOrderItems,
    persistOrderItems: deps.persistOrderItems,
    updateOrderSidebar: deps.updateOrderSidebar,
    openOrderSidebar: deps.openOrderSidebar,
    rebuildBrandMemoryFromRestaurant: deps.rebuildBrandMemoryFromRestaurant,
    handleDishEditorResult: deps.handleDishEditorResult,
    handleDishEditorError: deps.handleDishEditorError,
    getEditorSaveApi: deps.getEditorSaveApi,
    checkForActiveOrders: deps.checkForActiveOrders,
    updateLastConfirmedText: deps.updateLastConfirmedText,
    renderTopbar: deps.renderTopbar,
    render: deps.render,
    maybeInitHowItWorksTour: deps.maybeInitHowItWorksTour,
    updateFullScreenAllergySummary: deps.updateFullScreenAllergySummary,
    openChangeLog: deps.openChangeLog,
  });

  const bootHydrationRuntime = createBootHydrationRuntime({
    handleRestaurantMessage,
  });

  function bindWindowPayloadListener() {
    bootHydrationRuntime.bindWindowPayloadListener();
  }

  function hydrateRestaurantBootPayload(payload) {
    bootHydrationRuntime.applyRestaurantBootPayload(payload || {});
  }

  function initializePostBoot() {
    initAutoOpenDish({ state });
    initOrderConfirmRestore({
      initOrderSidebar: deps.initOrderSidebar,
      getOrderFormStateStorageKey: deps.getOrderFormStateStorageKey,
      checkUserAuth: deps.checkUserAuth,
      restoreOrderFormState: deps.restoreOrderFormState,
      updateOrderConfirmAuthState: deps.updateOrderConfirmAuthState,
      rerenderOrderConfirmDetails: deps.rerenderOrderConfirmDetails,
    });
  }

  return {
    applyRestaurantBootPayload: bootHydrationRuntime.applyRestaurantBootPayload,
    bindWindowPayloadListener,
    hydrateRestaurantBootPayload,
    initializePostBoot,
  };
}
