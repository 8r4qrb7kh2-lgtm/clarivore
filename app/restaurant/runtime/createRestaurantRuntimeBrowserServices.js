function getRuntimeDocument() {
  return typeof document !== "undefined" ? document : null;
}

function getRuntimeLocation() {
  return typeof location !== "undefined" ? location : null;
}

export function createRestaurantRuntimeBrowserServices() {
  return {
    createElement(tagName = "div") {
      const runtimeDocument = getRuntimeDocument();
      if (!runtimeDocument || typeof runtimeDocument.createElement !== "function") {
        return null;
      }
      return runtimeDocument.createElement(tagName);
    },
    getElementById(id) {
      const runtimeDocument = getRuntimeDocument();
      if (!runtimeDocument || typeof runtimeDocument.getElementById !== "function") {
        return null;
      }
      return runtimeDocument.getElementById(id);
    },
    navigateTo(url) {
      const runtimeLocation = getRuntimeLocation();
      if (!runtimeLocation) return;
      runtimeLocation.href = url;
    },
    resolveRuntimeGlobal(key) {
      if (!key || typeof globalThis === "undefined") return null;
      return globalThis[key] || null;
    },
  };
}
