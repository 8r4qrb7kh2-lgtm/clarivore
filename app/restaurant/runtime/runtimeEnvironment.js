const noop = () => {};

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

  const enableConsoleReporting = window.__enableConsoleReporting === true;

  if (!enableConsoleReporting && typeof console !== "undefined") {
    console.log = noop;
    console.info = noop;
    console.warn = noop;
    window.logDebug = noop;
    window.setDebugJson = noop;
  } else {
    window.logDebug = window.logDebug || ((msg) => console.log("[DEBUG]", msg));
    window.setDebugJson =
      window.setDebugJson ||
      ((data, title) => console.log("[DEBUG-JSON]", title, data));
  }

  return {
    logDebug: typeof window.logDebug === "function" ? window.logDebug : noop,
    setDebugJson:
      typeof window.setDebugJson === "function" ? window.setDebugJson : noop,
  };
}

export function ensureRestaurantViewportZoomMeta() {
  if (!canUseWindow()) return;
  if (window.__restaurantViewportZoomInit) return;
  window.__restaurantViewportZoomInit = true;

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

  window.lovedDishesSet = window.lovedDishesSet || new Set();
  window.orderItems = window.orderItems || [];
  window.orderItemSelections = window.orderItemSelections || new Set();
}

export function initializeRestaurantRuntimeEnvironment() {
  const debugFns = ensureRestaurantDebugBridge();
  ensureRestaurantViewportZoomMeta();
  ensureRestaurantRuntimeCollections();
  return debugFns;
}
