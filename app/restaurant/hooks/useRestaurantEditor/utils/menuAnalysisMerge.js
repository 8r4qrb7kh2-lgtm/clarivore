import { ensureOverlayVisibility, normalizeOverlay } from "./overlayGeometry";
import { asText, normalizeLegacyMatchKey, normalizeToken } from "./text";

// Merge helper that applies detector/remap dish results onto existing overlays.
// It returns both the next overlay list and summary counters.

export function mergePageDetectionsIntoOverlays({
  current,
  pageDetections,
  removeUnmatchedPages,
  pageCount,
}) {
  // Work on a copy so callers can use this helper in immutable state updates.
  const next = [...current];
  let updatedCount = 0;
  let addedCount = 0;
  let removedCount = 0;

  pageDetections.forEach((detection) => {
    const pageIndex = Number(detection?.pageIndex) || 0;

    const removeUnmatchedOnPage = (detectedTokens) => {
      // Optional cleanup mode: remove overlays on this page that are no longer detected.
      if (!removeUnmatchedPages.has(pageIndex)) return;
      for (let index = next.length - 1; index >= 0; index -= 1) {
        const overlay = next[index];
        const page = Number.isFinite(Number(overlay?.pageIndex))
          ? Number(overlay.pageIndex)
          : 0;
        if (page !== pageIndex) continue;
        const token = normalizeToken(overlay?.id || overlay?.name);
        if (!token || !detectedTokens.has(token)) {
          next.splice(index, 1);
          removedCount += 1;
        }
      }
    };

    const mergeDish = (dish, usedMatchIndexes) => {
      // Try to match by normalized name before creating a new overlay.
      const token = normalizeToken(dish?.name);
      if (!token) return;
      const dishMatchKey = normalizeLegacyMatchKey(dish?.name);

      const matchedIndex = next.findIndex((overlay, index) => {
        if (usedMatchIndexes.has(index)) return false;
        const page = Number.isFinite(Number(overlay?.pageIndex))
          ? Number(overlay.pageIndex)
          : 0;
        if (page !== pageIndex) return false;
        const overlayMatchKey = normalizeLegacyMatchKey(overlay?.id || overlay?.name);
        if (dishMatchKey && overlayMatchKey && overlayMatchKey === dishMatchKey) {
          return true;
        }
        const overlayToken = normalizeToken(overlay?.id || overlay?.name);
        return overlayToken === token;
      });

      if (matchedIndex >= 0) {
        // Matched existing overlay: update geometry in place.
        usedMatchIndexes.add(matchedIndex);
        const existing = next[matchedIndex];
        next[matchedIndex] = ensureOverlayVisibility(
          {
            ...existing,
            id: asText(existing?.id) || dish.name,
            name: asText(existing?.name) || dish.name,
            x: dish.x,
            y: dish.y,
            w: dish.w,
            h: dish.h,
            pageIndex,
          },
          pageCount,
        );
        updatedCount += 1;
        return;
      }

      const nextOverlayKey = `ov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // No match found: create a brand-new overlay for this detected dish.
      const nextOverlay = ensureOverlayVisibility(
        normalizeOverlay(
          {
            _editorKey: nextOverlayKey,
            id: dish.name,
            name: dish.name,
            description: "",
            x: dish.x,
            y: dish.y,
            w: dish.w,
            h: dish.h,
            pageIndex,
            allergens: [],
            diets: [],
            removable: [],
            crossContaminationAllergens: [],
            crossContaminationDiets: [],
            details: {},
            ingredients: [],
          },
          next.length,
          nextOverlayKey,
        ),
        pageCount,
      );

      next.push(nextOverlay);
      addedCount += 1;
    };

    if (detection?.mode === "remap") {
      // Remap mode may provide separate updated vs new sets.
      const detectedTokens = detection?.detectedTokens instanceof Set
        ? detection.detectedTokens
        : new Set();

      if (detection?.replacePageOverlays) {
        for (let index = next.length - 1; index >= 0; index -= 1) {
          const overlay = next[index];
          const page = Number.isFinite(Number(overlay?.pageIndex))
            ? Number(overlay.pageIndex)
            : 0;
          if (page !== pageIndex) continue;
          next.splice(index, 1);
          removedCount += 1;
        }
      }

      const usedMatchIndexes = new Set();
      (Array.isArray(detection.updatedDishes) ? detection.updatedDishes : []).forEach((dish) => {
        mergeDish(dish, usedMatchIndexes);
      });
      (Array.isArray(detection.newDishes) ? detection.newDishes : []).forEach((dish) => {
        mergeDish(dish, usedMatchIndexes);
      });

      removeUnmatchedOnPage(detectedTokens);
      return;
    }

    const dishes = Array.isArray(detection?.dishes) ? detection.dishes : [];
    const detectedTokens = detection?.detectedTokens instanceof Set
      ? detection.detectedTokens
      : new Set();

    removeUnmatchedOnPage(detectedTokens);

    if (!dishes.length) return;
    const usedMatchIndexes = new Set();
    dishes.forEach((dish) => {
      mergeDish(dish, usedMatchIndexes);
    });
  });

  return {
    next,
    updatedCount,
    addedCount,
    removedCount,
  };
}
