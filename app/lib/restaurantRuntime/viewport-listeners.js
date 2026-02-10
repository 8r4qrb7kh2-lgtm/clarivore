const noop = () => {};

function bindGlobalEventListener(eventName, listener, listenerOptions) {
  if (typeof addEventListener !== "function") return noop;
  addEventListener(eventName, listener, listenerOptions);
  return () => {
    if (typeof removeEventListener === "function") {
      removeEventListener(eventName, listener, listenerOptions);
    }
  };
}

function bindTargetEventListener(
  target,
  eventName,
  listener,
  listenerOptions,
) {
  if (!target || typeof target.addEventListener !== "function") return noop;
  target.addEventListener(eventName, listener, listenerOptions);
  return () => {
    if (typeof target.removeEventListener === "function") {
      target.removeEventListener(eventName, listener, listenerOptions);
    }
  };
}

export function getRuntimeVisualViewport() {
  return typeof visualViewport !== "undefined" ? visualViewport : null;
}

export function bindViewportListeners(options = {}) {
  const {
    onResize,
    onVisualViewportResize,
    onVisualViewportScroll,
    listenerOptions = { passive: true },
  } = options;
  const cleanupFns = [];

  if (typeof onResize === "function") {
    cleanupFns.push(
      bindGlobalEventListener("resize", onResize, listenerOptions),
    );
  }

  const runtimeVisualViewport = getRuntimeVisualViewport();
  if (runtimeVisualViewport) {
    if (typeof onVisualViewportResize === "function") {
      cleanupFns.push(
        bindTargetEventListener(
          runtimeVisualViewport,
          "resize",
          onVisualViewportResize,
          listenerOptions,
        ),
      );
    }
    if (typeof onVisualViewportScroll === "function") {
      cleanupFns.push(
        bindTargetEventListener(
          runtimeVisualViewport,
          "scroll",
          onVisualViewportScroll,
          listenerOptions,
        ),
      );
    }
  }

  return () => {
    cleanupFns.splice(0).forEach((cleanup) => {
      try {
        cleanup();
      } catch (_) {
        // Keep cleanup resilient for runtime environments without full DOM APIs.
      }
    });
  };
}
