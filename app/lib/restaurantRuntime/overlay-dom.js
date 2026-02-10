function normalizeDishName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function resolveQueryRoot(root) {
  if (root && typeof root.querySelectorAll === "function") {
    return root;
  }
  return typeof document !== "undefined" ? document : null;
}

export function getOverlayElements(root = null) {
  const queryRoot = resolveQueryRoot(root);
  if (!queryRoot) return [];
  return [...queryRoot.querySelectorAll(".overlay")];
}

export function getOverlayDishName(overlay) {
  if (!overlay) return "";
  const dataName =
    overlay.getAttribute("data-item-id") ||
    overlay.getAttribute("data-dish-name") ||
    overlay.dataset?.itemId ||
    overlay.dataset?.dishName ||
    "";
  if (dataName) return String(dataName).trim();

  const titleEl =
    typeof overlay.querySelector === "function"
      ? overlay.querySelector(".tTitle")
      : null;
  return String(titleEl?.textContent ?? "").trim();
}

export function setOverlayDishName(overlay, dishName) {
  if (!overlay) return;
  const value = String(dishName ?? "").trim();
  if (!value) return;
  overlay.setAttribute("data-item-id", value);
  overlay.setAttribute("data-dish-name", value);
}

export function clearSelectedOverlays(options = {}) {
  const { root = null, clearAnimation = false } = options;
  const overlays = getOverlayElements(root);
  overlays.forEach((overlay) => {
    overlay.classList.remove("selected");
    if (clearAnimation) {
      overlay.style.animation = "none";
    }
  });
  return overlays.length;
}

export function markOverlaySelected(overlay, options = {}) {
  if (!overlay) return false;
  const {
    root = null,
    clearExisting = false,
    clearAnimation = false,
    restartAnimation = false,
    setOverlayPulseColor = null,
  } = options;

  if (clearExisting) {
    clearSelectedOverlays({ root, clearAnimation });
  }

  overlay.classList.add("selected");
  if (typeof setOverlayPulseColor === "function") {
    setOverlayPulseColor(overlay);
  }
  if (restartAnimation) {
    void overlay.offsetWidth;
    overlay.style.animation = "";
    void overlay.offsetWidth;
  }
  return true;
}

export function findOverlayByDishName(dishName, options = {}) {
  const { root = null } = options;
  const target = normalizeDishName(dishName);
  if (!target) return null;
  const overlays = getOverlayElements(root);
  return (
    overlays.find(
      (overlay) => normalizeDishName(getOverlayDishName(overlay)) === target,
    ) || null
  );
}

export function markOverlayDishesSelected(dishNames, options = {}) {
  const {
    root = null,
    clearExisting = false,
    setOverlayPulseColor = null,
    restartAnimation = false,
  } = options;
  const targets = Array.isArray(dishNames)
    ? dishNames.map(normalizeDishName).filter(Boolean)
    : [];
  if (!targets.length) return 0;

  const targetSet = new Set(targets);
  if (clearExisting) {
    clearSelectedOverlays({ root, clearAnimation: restartAnimation });
  }

  let selectedCount = 0;
  getOverlayElements(root).forEach((overlay) => {
    const overlayName = normalizeDishName(getOverlayDishName(overlay));
    if (!overlayName || !targetSet.has(overlayName)) return;
    markOverlaySelected(overlay, {
      root,
      clearExisting: false,
      restartAnimation,
      setOverlayPulseColor,
    });
    const addBtn = overlay.querySelector(".addToOrderBtn[data-dish-name]");
    if (addBtn) {
      addBtn.disabled = true;
      addBtn.textContent = "Added";
    }
    selectedCount += 1;
  });
  return selectedCount;
}
