export function initializeEditorAssets(restaurant = {}) {
  let menuImages =
    restaurant.menuImages || (restaurant.menuImage ? [restaurant.menuImage] : []);

  if (window.__editorOverrideMenuImages) {
    menuImages = window.__editorOverrideMenuImages;
    window.__editorOverrideMenuImages = null;
  }

  const hasOriginalMenuImages = Array.isArray(window.__editorOriginalMenuImages);
  if (!hasOriginalMenuImages) {
    window.__editorOriginalMenuImages = JSON.parse(JSON.stringify(menuImages));
  }

  const originalMenuImages = JSON.parse(
    JSON.stringify(window.__editorOriginalMenuImages || menuImages),
  );

  let currentPageIndex = 0;
  let applyCurrentPageOnLoad = false;
  if (Number.isInteger(window.__editorOverrideCurrentPage)) {
    currentPageIndex = Math.min(
      Math.max(window.__editorOverrideCurrentPage, 0),
      Math.max(0, menuImages.length - 1),
    );
    applyCurrentPageOnLoad = true;
    window.__editorOverrideCurrentPage = null;
  }

  let overlays = JSON.parse(JSON.stringify(restaurant.overlays || []));
  if (window.__editorOverrideOverlays) {
    overlays = window.__editorOverrideOverlays;
    window.__editorOverrideOverlays = null;
  }

  overlays.forEach((overlay) => {
    if (overlay.pageIndex === undefined) {
      overlay.pageIndex = 0;
    }
  });

  return {
    menuImages,
    originalMenuImages,
    currentPageIndex,
    applyCurrentPageOnLoad,
    overlays,
  };
}

export function createDirtyController(saveButton) {
  let dirty = false;

  const setDirty = (next = true) => {
    dirty = next;
    window.editorDirty = next;
    if (!saveButton) return;

    saveButton.style.display = dirty ? "inline-flex" : "none";
    saveButton.classList.toggle("savePulse", dirty);

    if (dirty) {
      saveButton.classList.remove("btnPrimary", "btnDanger");
      saveButton.classList.add("btnSuccess");
      return;
    }

    saveButton.classList.remove("btnSuccess", "btnDanger", "savePulse");
    saveButton.classList.add("btnPrimary");
  };

  if (window.__editorForceDirty) {
    setDirty(true);
    window.__editorForceDirty = false;
  }

  return {
    setDirty,
    isDirty: () => dirty,
  };
}

export function createEditorChangeState(restaurant = {}) {
  const pendingChanges = [];
  if (Array.isArray(window.__editorOverridePendingChanges)) {
    pendingChanges.splice(
      0,
      pendingChanges.length,
      ...window.__editorOverridePendingChanges,
    );
    window.__editorOverridePendingChanges = null;
  }

  let originalOverlaysRef = JSON.stringify(restaurant.overlays || []);
  let originalRestaurantSettings = {
    website: restaurant.website || null,
    phone: restaurant.phone || null,
    delivery_url: restaurant.delivery_url || null,
  };

  window.updateOriginalRestaurantSettings = function updateOriginalRestaurantSettings(
    newSettings,
  ) {
    originalRestaurantSettings = newSettings;
  };

  return {
    getPendingChanges: () => pendingChanges,
    setPendingChanges: (next) => {
      pendingChanges.splice(
        0,
        pendingChanges.length,
        ...(Array.isArray(next) ? next : []),
      );
    },
    pushPendingChange: (change) => {
      pendingChanges.push(change);
    },
    getOriginalOverlaysRef: () => originalOverlaysRef,
    setOriginalOverlaysRef: (next) => {
      originalOverlaysRef = next;
    },
    getOriginalRestaurantSettings: () => originalRestaurantSettings,
  };
}

export function applyPendingMenuIndexRemap({ overlays, oldImages, indexMap }) {
  if (!Array.isArray(oldImages) || !Array.isArray(indexMap)) return;

  const oldToNewIndex = new Map();
  indexMap.forEach((oldIndex, newIndex) => {
    if (Number.isInteger(oldIndex)) {
      oldToNewIndex.set(oldIndex, newIndex);
    }
  });
  if (!oldToNewIndex.size) return;

  const removedIndices = [];
  for (let i = 0; i < oldImages.length; i++) {
    if (!oldToNewIndex.has(i)) {
      removedIndices.push(i);
    }
  }

  if (removedIndices.length) {
    for (let i = overlays.length - 1; i >= 0; i--) {
      const overlayPageIndex = overlays[i].pageIndex ?? 0;
      if (removedIndices.includes(overlayPageIndex)) {
        overlays.splice(i, 1);
      }
    }
  }

  overlays.forEach((overlay) => {
    const overlayPageIndex = overlay.pageIndex ?? 0;
    if (oldToNewIndex.has(overlayPageIndex)) {
      overlay.pageIndex = oldToNewIndex.get(overlayPageIndex);
    }
  });
}
