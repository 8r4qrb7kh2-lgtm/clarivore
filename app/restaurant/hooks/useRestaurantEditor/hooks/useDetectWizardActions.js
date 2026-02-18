import { useCallback } from "react";

import { toDataUrlFromImage } from "../utils/imageProcessing";
import { ensureOverlayVisibility, normalizeOverlay } from "../utils/overlayGeometry";
import { asText, clamp } from "../utils/text";

// Handles the guided dish-detection wizard used for manual mapping.
// This flow is separate from bulk analysis to keep user-driven mapping explicit.

export function useDetectWizardActions({
  callbacks,
  draftMenuImages,
  activePageIndex,
  detectWizardState,
  draftOverlaysLength,
  menuImagesRef,

  setDetectWizardState,
  setDetectWizardOpen,
  setSelectedOverlayKey,

  applyOverlayList,
  appendPendingChange,
  pushHistory,
}) {
  const runDetectDishes = useCallback(async () => {
    if (!callbacks?.onDetectMenuDishes) return { success: false };

    const image = draftMenuImages[activePageIndex] || "";
    const imageData = await toDataUrlFromImage(image);
    if (!imageData) {
      setDetectWizardState({
        loading: false,
        dishes: [],
        currentIndex: 0,
        error: "No menu image available for dish detection.",
      });
      setDetectWizardOpen(true);
      return { success: false };
    }

    setDetectWizardState((current) => ({
      ...current,
      loading: true,
      error: "",
      dishes: [],
      currentIndex: 0,
    }));
    setDetectWizardOpen(true);

    try {
      const result = await callbacks.onDetectMenuDishes({
        imageData,
        pageIndex: activePageIndex,
      });

      const dishes = Array.isArray(result?.dishes)
        ? result.dishes.map((dish, index) => ({
            name: asText(dish?.name || `Dish ${index + 1}`),
            mapped: false,
          }))
        : [];

      setDetectWizardState({
        loading: false,
        dishes,
        currentIndex: 0,
        error: dishes.length ? "" : "No dishes detected.",
      });

      return { success: dishes.length > 0, result };
    } catch (error) {
      setDetectWizardState({
        loading: false,
        dishes: [],
        currentIndex: 0,
        error: error?.message || "Failed to detect dishes.",
      });
      return { success: false, error };
    }
  }, [activePageIndex, callbacks, draftMenuImages, setDetectWizardOpen, setDetectWizardState]);

  const mapDetectedDish = useCallback((rect) => {
    const dishes = Array.isArray(detectWizardState.dishes) ? detectWizardState.dishes : [];
    if (!dishes.length) return null;

    const target = dishes[detectWizardState.currentIndex];
    if (!target?.name) return null;

    const nextOverlayKey = `ov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextOverlay = ensureOverlayVisibility(
      normalizeOverlay(
        {
          _editorKey: nextOverlayKey,
          id: target.name,
          name: target.name,
          description: "",
          x: clamp(Number(rect?.x) || 0, 0, 99),
          y: clamp(Number(rect?.y) || 0, 0, 99),
          w: clamp(Number(rect?.w) || 8, 1, 100),
          h: clamp(Number(rect?.h) || 6, 1, 100),
          pageIndex: activePageIndex,
          allergens: [],
          diets: [],
          removable: [],
          crossContaminationAllergens: [],
          crossContaminationDiets: [],
          details: {},
        },
        draftOverlaysLength,
        nextOverlayKey,
      ),
      menuImagesRef.current.length,
    );

    applyOverlayList((current) => [...current, nextOverlay]);
    setSelectedOverlayKey(nextOverlayKey);

    appendPendingChange(`${nextOverlay.id}: Added overlay manually`);

    setDetectWizardState((current) => {
      const nextDishes = current.dishes.map((dish, index) =>
        index === current.currentIndex ? { ...dish, mapped: true } : dish,
      );

      let nextIndex = current.currentIndex;
      const forward = nextDishes.findIndex((dish, index) => index > current.currentIndex && !dish.mapped);
      if (forward >= 0) {
        nextIndex = forward;
      } else {
        const any = nextDishes.findIndex((dish) => !dish.mapped);
        nextIndex = any >= 0 ? any : current.currentIndex;
      }

      return {
        ...current,
        dishes: nextDishes,
        currentIndex: nextIndex,
      };
    });

    queueMicrotask(() => pushHistory());
    return nextOverlay;
  }, [
    activePageIndex,
    appendPendingChange,
    applyOverlayList,
    detectWizardState.currentIndex,
    detectWizardState.dishes,
    draftOverlaysLength,
    menuImagesRef,
    pushHistory,
    setDetectWizardState,
    setSelectedOverlayKey,
  ]);

  const setDetectWizardIndex = useCallback((nextIndex) => {
    setDetectWizardState((current) => ({
      ...current,
      currentIndex: clamp(
        Number(nextIndex) || 0,
        0,
        Math.max(current.dishes.length - 1, 0),
      ),
    }));
  }, [setDetectWizardState]);

  const closeDetectWizard = useCallback(() => {
    setDetectWizardOpen(false);
    setDetectWizardState({
      loading: false,
      dishes: [],
      currentIndex: 0,
      error: "",
    });
  }, [setDetectWizardOpen, setDetectWizardState]);

  return {
    runDetectDishes,
    mapDetectedDish,
    setDetectWizardIndex,
    closeDetectWizard,
  };
}
