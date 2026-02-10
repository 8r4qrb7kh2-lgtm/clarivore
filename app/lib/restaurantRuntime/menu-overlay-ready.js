function getDefaultMenuElement() {
  if (typeof document === "undefined") return null;
  return document.getElementById("menu");
}

export function waitForMenuOverlays(options = {}) {
  const {
    onReady,
    getMenuElement = getDefaultMenuElement,
    initialDelayMs = 0,
    intervalMs = 100,
    minOverlayCount = 1,
    maxAttempts = 80,
  } = options;

  if (typeof onReady !== "function") {
    return () => {};
  }

  const getSafeMenuElement =
    typeof getMenuElement === "function" ? getMenuElement : getDefaultMenuElement;
  const minCount = Number.isFinite(minOverlayCount) ? Number(minOverlayCount) : 1;
  const delay = Number.isFinite(initialDelayMs) ? Number(initialDelayMs) : 0;
  const interval = Number.isFinite(intervalMs) ? Number(intervalMs) : 100;
  const attemptLimit = Number.isFinite(maxAttempts) ? Number(maxAttempts) : 80;

  let cancelled = false;
  let attempt = 0;
  let timerId = null;

  const clearTimer = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  const check = () => {
    if (cancelled) return;
    attempt += 1;

    const menu = getSafeMenuElement();
    const overlayCount = menu ? menu.querySelectorAll(".overlay").length : 0;
    if (menu && overlayCount >= minCount) {
      onReady(menu);
      return;
    }

    if (attemptLimit > 0 && attempt >= attemptLimit) {
      return;
    }

    timerId = setTimeout(check, interval);
  };

  timerId = setTimeout(check, Math.max(0, delay));
  return () => {
    cancelled = true;
    clearTimer();
  };
}
