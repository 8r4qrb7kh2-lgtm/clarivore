import { initOrderFlow } from "./order-flow.js";

export function createOrderRuntime(deps = {}) {
  const state = deps.state || {};
  const send = typeof deps.send === "function" ? deps.send : () => {};
  const resizeLegendToFit =
    typeof deps.resizeLegendToFit === "function" ? deps.resizeLegendToFit : () => {};
  const supabaseClient = deps.supabaseClient || null;
  const getSupabaseClient =
    typeof deps.getSupabaseClient === "function" ? deps.getSupabaseClient : null;
  const getOrderItems =
    typeof deps.getOrderItems === "function" ? deps.getOrderItems : null;
  const setOrderItems =
    typeof deps.setOrderItems === "function" ? deps.setOrderItems : null;
  const getOrderItemSelections =
    typeof deps.getOrderItemSelections === "function"
      ? deps.getOrderItemSelections
      : null;
  const setOpenOrderConfirmDrawer =
    typeof deps.setOpenOrderConfirmDrawer === "function"
      ? deps.setOpenOrderConfirmDrawer
      : null;
  const setOverlayPulseColor =
    typeof deps.setOverlayPulseColor === "function"
      ? deps.setOverlayPulseColor
      : null;
  const getLocationHref =
    typeof deps.getLocationHref === "function" ? deps.getLocationHref : null;
  const navigateToUrl =
    typeof deps.navigateToUrl === "function" ? deps.navigateToUrl : null;
  const getViewportHeight =
    typeof deps.getViewportHeight === "function" ? deps.getViewportHeight : null;
  const addWindowResizeListener =
    typeof deps.addWindowResizeListener === "function"
      ? deps.addWindowResizeListener
      : null;

  const orderFlow = initOrderFlow({
    state,
    send,
    resizeLegendToFit,
    supabaseClient,
    getSupabaseClient,
    getOrderItems,
    setOrderItems,
    getOrderItemSelections,
    setOpenOrderConfirmDrawer,
    setOverlayPulseColor,
    getLocationHref,
    navigateToUrl,
    getViewportHeight,
    addWindowResizeListener,
  });

  return {
    orderFlow,
    ...orderFlow,
  };
}
