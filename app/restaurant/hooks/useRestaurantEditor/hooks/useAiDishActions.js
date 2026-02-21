import { useCallback } from "react";

import { asText } from "../utils/text";

// AI dish actions that either run analysis or apply analysis results to the selected overlay.
// This keeps AI-specific mutation logic isolated from core editor state wiring.

export function useAiDishActions({
  selectedOverlay,
  callbacks,
  aiAssistDraftRef,
  updateOverlay,
  pushHistory,
  setAiAssistDraft,
}) {
  // Apply AI analysis payload onto currently selected overlay fields.
  // This stage now seeds ingredient rows only; row-level smart detection runs via Apply flow.
  const applyAiResultToSelectedOverlay = useCallback(async (result) => {
    if (!selectedOverlay?._editorKey || !result) {
      return { success: false };
    }

    // Build row shells only. Allergens/diets/scan requirement are resolved by row Apply logic.
    const ingredients = (Array.isArray(result.ingredients) ? result.ingredients : []).map(
      (ingredient, index) => {
        const rowName = asText(ingredient?.name) || `Ingredient ${index + 1}`;
        return {
          ...ingredient,
          name: rowName,
          allergens: [],
          diets: [],
          crossContaminationAllergens: [],
          crossContaminationDiets: [],
          aiDetectedAllergens: [],
          aiDetectedDiets: [],
          aiDetectedCrossContaminationAllergens: [],
          aiDetectedCrossContaminationDiets: [],
          brands: [],
          brandRequired: false,
          brandRequirementReason: "",
          confirmed: false,
        };
      },
    );

    // Persist computed AI result into selected overlay.
    updateOverlay(selectedOverlay._editorKey, {
      allergens: [],
      diets: [],
      details: {},
      ingredients,
      removable: [],
      crossContaminationAllergens: [],
      crossContaminationDiets: [],
      ingredientsBlockingDiets: {},
    });

    queueMicrotask(() => pushHistory());
    return { success: true };
  }, [
    pushHistory,
    selectedOverlay,
    updateOverlay,
  ]);

  // Run AI analysis request using current AI-assist draft text/image for selected dish.
  const runAiDishAnalysis = useCallback(async ({ overrideText } = {}) => {
    if (!selectedOverlay || !callbacks?.onAnalyzeDish) return { success: false };

    const draftSnapshot = aiAssistDraftRef.current || {};
    const draftText = asText(
      overrideText !== undefined ? overrideText : draftSnapshot.text,
    );
    const draftImageData = asText(draftSnapshot.imageData);
    if (!draftText && !draftImageData) {
      setAiAssistDraft((current) => ({
        ...current,
        loading: false,
        error: "Add recipe text or upload an ingredient photo before processing.",
      }));
      return { success: false };
    }

    const payload = {
      dishName: selectedOverlay.id || selectedOverlay.name,
      text: draftText,
      // The UI supports text or image. If text exists, force text mode.
      imageData: draftText ? "" : draftImageData,
    };

    setAiAssistDraft((current) => ({
      ...current,
      loading: true,
      error: "",
      result: null,
    }));

    try {
      const result = await callbacks.onAnalyzeDish(payload);

      setAiAssistDraft((current) => ({
        ...current,
        imageData: payload.imageData,
        loading: false,
        result,
      }));

      return { success: true, result };
    } catch (error) {
      setAiAssistDraft((current) => ({
        ...current,
        loading: false,
        error: error?.message || "Failed to analyze dish.",
      }));
      return { success: false, error };
    }
  }, [aiAssistDraftRef, callbacks, selectedOverlay, setAiAssistDraft]);

  return {
    applyAiResultToSelectedOverlay,
    runAiDishAnalysis,
  };
}
