import { useCallback } from "react";

import { ensureOverlayVisibility, normalizeOverlay } from "../utils/overlayGeometry";
import { asText, clamp } from "../utils/text";

// Overlay-focused user actions.
// These handlers manage selection, geometry, allergens, and diet flags for one dish overlay.

export function useOverlayActions({
  selectedOverlay,
  activePageIndex,
  draftOverlaysLength,
  menuImagesRef,
  overlaysRef,

  setSelectedOverlayKey,
  setDishEditorOpen,
  setDishAiAssistOpen,
  setAiAssistDraft,

  applyOverlayList,
  appendPendingChange,
  pushHistory,
}) {
  // Generic overlay patch helper used by all overlay editing interactions.
  const updateOverlay = useCallback((overlayKey, patch, options = {}) => {
    if (!overlayKey) return;

    applyOverlayList((current) =>
      current.map((overlay, index) => {
        if (overlay._editorKey !== overlayKey) return overlay;

        const next = ensureOverlayVisibility(
          normalizeOverlay(
            {
              ...overlay,
              ...(typeof patch === "function" ? patch(overlay) : patch),
            },
            index,
            overlay._editorKey,
          ),
          menuImagesRef.current.length,
        );

        // Keep bounds safe after drag/resize.
        next.w = clamp(next.w, 0.5, 100);
        next.h = clamp(next.h, 0.5, 100);
        next.x = clamp(next.x, 0, 100 - next.w);
        next.y = clamp(next.y, 0, 100 - next.h);

        return next;
      }),
    );

    if (options?.changeText) {
      appendPendingChange(options.changeText, {
        key: options?.changeKey,
      });
    }

    if (options?.recordHistory) {
      queueMicrotask(() => pushHistory());
    }
  }, [appendPendingChange, applyOverlayList, menuImagesRef, pushHistory]);

  // Create a new default overlay on the active page.
  const addOverlay = useCallback(() => {
    const nextKey = `ov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    applyOverlayList((current) => {
      const nextIndex = current.length;
      const next = [
        ...current,
        ensureOverlayVisibility(
          normalizeOverlay(
            {
              _editorKey: nextKey,
              id: `Dish ${nextIndex + 1}`,
              name: `Dish ${nextIndex + 1}`,
              description: "",
              x: 10,
              y: 10,
              w: 22,
              h: 8,
              pageIndex: activePageIndex,
              allergens: [],
              diets: [],
              removable: [],
              crossContaminationAllergens: [],
              crossContaminationDiets: [],
              details: {},
              ingredients: [],
            },
            nextIndex,
            nextKey,
          ),
          menuImagesRef.current.length,
        ),
      ];
      return next;
    });

    setSelectedOverlayKey(nextKey);
    appendPendingChange("Added overlay", {
      key: `overlay:${nextKey}:added`,
    });
    queueMicrotask(() => pushHistory());
  }, [
    activePageIndex,
    appendPendingChange,
    applyOverlayList,
    draftOverlaysLength,
    menuImagesRef,
    pushHistory,
    setSelectedOverlayKey,
  ]);

  // Remove an overlay and choose a safe fallback selection.
  const removeOverlay = useCallback((overlayKey) => {
    const overlay = overlaysRef.current.find((item) => item._editorKey === overlayKey);
    const stableOverlayKey = asText(overlay?._editorKey || overlay?.overlayKey || overlayKey);

    applyOverlayList((current) => current.filter((item) => item._editorKey !== overlayKey));
    setSelectedOverlayKey((current) => {
      if (current !== overlayKey) return current;
      const fallback = overlaysRef.current.find((item) => item._editorKey !== overlayKey);
      return fallback?._editorKey || "";
    });

    appendPendingChange("Removed overlay", {
      key: stableOverlayKey ? `overlay:${stableOverlayKey}:removed` : "",
    });
    queueMicrotask(() => pushHistory());
  }, [appendPendingChange, applyOverlayList, overlaysRef, pushHistory, setSelectedOverlayKey]);

  // Select overlay by editor key.
  const selectOverlay = useCallback((overlayKey) => {
    setSelectedOverlayKey(asText(overlayKey));
  }, [setSelectedOverlayKey]);

  // Open dish editor for a specific overlay.
  const openDishEditor = useCallback((overlayKey) => {
    if (!overlayKey) return;
    setSelectedOverlayKey(overlayKey);
    setDishEditorOpen(true);
  }, [setDishEditorOpen, setSelectedOverlayKey]);

  // Closing the dish editor also resets AI-assist draft state.
  const closeDishEditor = useCallback(() => {
    setDishEditorOpen(false);
    setDishAiAssistOpen(false);
    setAiAssistDraft({
      text: "",
      imageData: "",
      loading: false,
      error: "",
      result: null,
    });
  }, [setAiAssistDraft, setDishAiAssistOpen, setDishEditorOpen]);

  // Convenience wrapper that patches whichever overlay is currently selected.
  const updateSelectedOverlay = useCallback((patch, options = {}) => {
    if (!selectedOverlay?._editorKey) return;
    updateOverlay(selectedOverlay._editorKey, patch, options);
  }, [selectedOverlay?._editorKey, updateOverlay]);

  // Toggle allergen membership and clean dependent fields when removed.
  const toggleSelectedAllergen = useCallback((allergenKey) => {
    const key = asText(allergenKey);
    if (!key || !selectedOverlay?._editorKey) return;

    updateOverlay(selectedOverlay._editorKey, (overlay) => {
      const nextSet = new Set(overlay.allergens || []);
      if (nextSet.has(key)) {
        nextSet.delete(key);
      } else {
        nextSet.add(key);
      }

      const nextDetails = { ...(overlay.details || {}) };
      if (!nextSet.has(key)) {
        delete nextDetails[key];
      }

      const nextRemovable = (overlay.removable || []).filter(
        (item) => asText(item?.allergen) !== key,
      );

      const nextCross = (overlay.crossContaminationAllergens || []).filter(
        (item) => asText(item) !== key,
      );

      return {
        allergens: Array.from(nextSet),
        details: nextDetails,
        removable: nextRemovable,
        crossContaminationAllergens: nextSet.has(key)
          ? overlay.crossContaminationAllergens || []
          : nextCross,
      };
    });
  }, [selectedOverlay?._editorKey, updateOverlay]);

  // Update free-form allergen detail text.
  const setSelectedAllergenDetail = useCallback((allergenKey, value) => {
    const key = asText(allergenKey);
    if (!key || !selectedOverlay?._editorKey) return;

    updateOverlay(selectedOverlay._editorKey, (overlay) => ({
      details: {
        ...(overlay.details || {}),
        [key]: asText(value),
      },
    }));
  }, [selectedOverlay?._editorKey, updateOverlay]);

  // Mark/unmark whether a named allergen can be removed from the dish.
  const setSelectedAllergenRemovable = useCallback((allergenKey, checked) => {
    const key = asText(allergenKey);
    if (!key || !selectedOverlay?._editorKey) return;

    updateOverlay(selectedOverlay._editorKey, (overlay) => {
      const existing = Array.isArray(overlay.removable) ? overlay.removable : [];
      const filtered = existing.filter((item) => asText(item?.allergen) !== key);
      if (checked) {
        filtered.push({
          allergen: key,
          component: asText((overlay.details || {})[key]) || key,
        });
      }
      return {
        removable: filtered,
      };
    });
  }, [selectedOverlay?._editorKey, updateOverlay]);

  // Mark/unmark allergen as cross-contamination risk.
  const setSelectedAllergenCrossContamination = useCallback((allergenKey, checked) => {
    const key = asText(allergenKey);
    if (!key || !selectedOverlay?._editorKey) return;

    updateOverlay(selectedOverlay._editorKey, (overlay) => {
      const set = new Set(Array.isArray(overlay.crossContaminationAllergens) ? overlay.crossContaminationAllergens : []);
      if (checked) {
        set.add(key);
      } else {
        set.delete(key);
      }
      return {
        crossContaminationAllergens: Array.from(set),
      };
    });
  }, [selectedOverlay?._editorKey, updateOverlay]);

  // Toggle diet tag membership on selected overlay.
  const toggleSelectedDiet = useCallback((dietLabel) => {
    const diet = asText(dietLabel);
    if (!diet || !selectedOverlay?._editorKey) return;

    updateOverlay(selectedOverlay._editorKey, (overlay) => {
      const set = new Set(overlay.diets || []);
      if (set.has(diet)) set.delete(diet);
      else set.add(diet);
      return { diets: Array.from(set) };
    });
  }, [selectedOverlay?._editorKey, updateOverlay]);

  return {
    updateOverlay,
    addOverlay,
    removeOverlay,
    selectOverlay,
    openDishEditor,
    closeDishEditor,
    updateSelectedOverlay,
    toggleSelectedAllergen,
    setSelectedAllergenDetail,
    setSelectedAllergenRemovable,
    setSelectedAllergenCrossContamination,
    toggleSelectedDiet,
  };
}
