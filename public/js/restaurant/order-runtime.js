import { initOrderFlow } from "./order-flow.js";

export function createOrderRuntime(deps = {}) {
  const state = deps.state || {};
  const send = typeof deps.send === "function" ? deps.send : () => {};
  const resizeLegendToFit =
    typeof deps.resizeLegendToFit === "function" ? deps.resizeLegendToFit : () => {};
  const supabaseClient = deps.supabaseClient || null;

  const orderFlow = initOrderFlow({
    state,
    send,
    resizeLegendToFit,
    supabaseClient,
  });

  return {
    orderFlow,
    ...orderFlow,
  };
}
