import {
  getLovedDishesSet,
  getOrderItemSelections,
  getOrderItems,
} from "../../lib/restaurantRuntime/runtimeSessionState.js";
import { getEnableConsoleReporting } from "../../lib/restaurantRuntime/restaurantRuntimeBridge.js";

const noop = () => {};
let viewportZoomMetaInitialized = false;

function canUseWindow() {
  return typeof window !== "undefined";
}

export function ensureRestaurantDebugBridge() {
  if (!canUseWindow()) {
    return {
      logDebug: noop,
      setDebugJson: noop,
    };
  }

  const enableConsoleReporting = getEnableConsoleReporting();
  const logDebug = enableConsoleReporting
    ? (msg) => console.log("[DEBUG]", msg)
    : noop;
  const setDebugJson = enableConsoleReporting
    ? (data, title) => console.log("[DEBUG-JSON]", title, data)
    : noop;

  if (!enableConsoleReporting && typeof console !== "undefined") {
    console.log = noop;
    console.info = noop;
    console.warn = noop;
    console.debug = noop;
  }

  return {
    logDebug,
    setDebugJson,
  };
}

export function ensureRestaurantViewportZoomMeta() {
  if (!canUseWindow()) return;
  if (viewportZoomMetaInitialized) return;
  viewportZoomMetaInitialized = true;

  const meta = document.querySelector('meta[name="viewport"]');
  if (meta && !/maximum-scale/i.test(meta.content)) {
    meta.content += ", user-scalable=yes, maximum-scale=10";
  }

  ["touchstart", "touchmove"].forEach((eventName) => {
    document.addEventListener(eventName, () => {}, { passive: true });
  });
}

export function ensureRestaurantRuntimeCollections() {
  if (!canUseWindow()) return;
  getLovedDishesSet();
  getOrderItems();
  getOrderItemSelections();
}

export function initializeRestaurantRuntimeEnvironment() {
  const debugFns = ensureRestaurantDebugBridge();
  ensureRestaurantViewportZoomMeta();
  ensureRestaurantRuntimeCollections();
  return debugFns;
}
