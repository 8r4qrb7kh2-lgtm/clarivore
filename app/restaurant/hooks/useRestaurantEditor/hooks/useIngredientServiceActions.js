import { useCallback } from "react";

import { asText } from "../utils/text";

// Thin wrappers around ingredient-related service callbacks.
// These wrappers validate input and normalize output into stable shapes for the UI.

export function useIngredientServiceActions({
  callbacks,
  restaurant,
  selectedOverlay,
  normalizeAllergenList,
  normalizeDietList,
}) {
  // Analyze one ingredient name and normalize all returned allergen/diet fields.
  const analyzeIngredientName = useCallback(async ({
    ingredientName,
    dishName,
  }) => {
    if (!callbacks?.onAnalyzeIngredientName) {
      return {
        success: false,
        error: new Error("Ingredient name analysis callback is not configured."),
      };
    }

    const safeIngredientName = asText(ingredientName);
    if (!safeIngredientName) {
      return {
        success: false,
        error: new Error("Ingredient name is required."),
      };
    }

    try {
      const result = await callbacks.onAnalyzeIngredientName({
        ingredientName: safeIngredientName,
        dishName:
          asText(dishName) ||
          asText(selectedOverlay?.id || selectedOverlay?.name),
      });

      const allergens = normalizeAllergenList(result?.allergens);
      const diets = normalizeDietList(result?.diets);

      return {
        success: true,
        result: {
          allergens,
          diets,
          crossContaminationAllergens: normalizeAllergenList(
            result?.crossContaminationAllergens,
          ),
          crossContaminationDiets: normalizeDietList(
            result?.crossContaminationDiets,
          ),
          aiDetectedAllergens: normalizeAllergenList(
            result?.aiDetectedAllergens || allergens,
          ),
          aiDetectedDiets: normalizeDietList(result?.aiDetectedDiets || diets),
          aiDetectedCrossContaminationAllergens: normalizeAllergenList(
            result?.aiDetectedCrossContaminationAllergens ||
              result?.crossContaminationAllergens,
          ),
          aiDetectedCrossContaminationDiets: normalizeDietList(
            result?.aiDetectedCrossContaminationDiets ||
              result?.crossContaminationDiets,
          ),
          reasoning: asText(result?.reasoning),
        },
      };
    } catch (error) {
      return { success: false, error };
    }
  }, [
    callbacks,
    normalizeAllergenList,
    normalizeDietList,
    selectedOverlay?.id,
    selectedOverlay?.name,
  ]);

  // Ask callback whether a given ingredient row requires label scan / brand assignment.
  const analyzeIngredientScanRequirement = useCallback(async ({
    ingredientName,
    dishName,
  }) => {
    if (!callbacks?.onAnalyzeIngredientScanRequirement) {
      return {
        success: false,
        error: new Error("Ingredient scan requirement callback is not configured."),
      };
    }

    const safeIngredientName = asText(ingredientName);
    if (!safeIngredientName) {
      return {
        success: false,
        error: new Error("Ingredient name is required."),
      };
    }

    try {
      const result = await callbacks.onAnalyzeIngredientScanRequirement({
        ingredientName: safeIngredientName,
        dishName:
          asText(dishName) ||
          asText(selectedOverlay?.id || selectedOverlay?.name),
      });
      return {
        success: true,
        result: {
          needsScan: Boolean(result?.needsScan),
          reasoning: asText(result?.reasoning),
        },
      };
    } catch (error) {
      return { success: false, error };
    }
  }, [callbacks, selectedOverlay?.id, selectedOverlay?.name]);

  // Submit manager appeal with required dish/ingredient/message/photo payload.
  const submitIngredientAppeal = useCallback(async ({
    dishName,
    ingredientName,
    managerMessage,
    photoDataUrl,
  }) => {
    if (!callbacks?.onSubmitIngredientAppeal) {
      return {
        success: false,
        error: new Error("Ingredient appeal callback is not configured."),
      };
    }

    const safeDishName =
      asText(dishName) || asText(selectedOverlay?.id || selectedOverlay?.name);
    const safeIngredientName = asText(ingredientName);
    const safeManagerMessage = asText(managerMessage);
    const safePhotoDataUrl = asText(photoDataUrl);

    if (!safeDishName || !safeIngredientName || !safeManagerMessage || !safePhotoDataUrl) {
      return {
        success: false,
        error: new Error("Dish, ingredient, appeal message, and appeal photo are required."),
      };
    }

    try {
      const result = await callbacks.onSubmitIngredientAppeal({
        restaurantId: asText(restaurant?.id),
        dishName: safeDishName,
        ingredientName: safeIngredientName,
        managerMessage: safeManagerMessage,
        photoDataUrl: safePhotoDataUrl,
      });
      return { success: true, result };
    } catch (error) {
      return { success: false, error };
    }
  }, [callbacks, restaurant?.id, selectedOverlay?.id, selectedOverlay?.name]);

  // Start a new ingredient label scan flow and normalize structured result for editor.
  const openIngredientLabelScan = useCallback(async ({
    ingredientName,
    onPhaseChange,
    scanProfile = "default",
  }) => {
    if (!callbacks?.onOpenIngredientLabelScan) {
      return {
        success: false,
        error: new Error("Ingredient label scan callback is not configured."),
      };
    }

    try {
      const requestedScanProfile = asText(scanProfile) || "default";
      const result = await callbacks.onOpenIngredientLabelScan({
        ingredientName: asText(ingredientName),
        onPhaseChange: typeof onPhaseChange === "function" ? onPhaseChange : undefined,
        scanProfile: requestedScanProfile,
      });
      if (!result) return { success: true, result: null };

      const allergens = normalizeAllergenList(result?.allergens);
      const diets = normalizeDietList(result?.diets);
      const crossContaminationAllergens = normalizeAllergenList(
        result?.crossContaminationAllergens,
      );
      const crossContaminationDiets = normalizeDietList(
        result?.crossContaminationDiets,
      );

      const productName = asText(result?.productName) || asText(ingredientName);
      const normalizedResult = {
        ...result,
        productName,
        allergens,
        diets,
        crossContaminationAllergens,
        crossContaminationDiets,
        aiDetectedAllergens: normalizeAllergenList(
          result?.aiDetectedAllergens || allergens,
        ),
        aiDetectedDiets: normalizeDietList(result?.aiDetectedDiets || diets),
        aiDetectedCrossContaminationAllergens: normalizeAllergenList(
          result?.aiDetectedCrossContaminationAllergens ||
            crossContaminationAllergens,
        ),
        aiDetectedCrossContaminationDiets: normalizeDietList(
          result?.aiDetectedCrossContaminationDiets || crossContaminationDiets,
        ),
      };

      return { success: true, result: normalizedResult };
    } catch (error) {
      return { success: false, error };
    }
  }, [callbacks, normalizeAllergenList, normalizeDietList]);

  // Resume an existing ingredient label scan session by id.
  const resumeIngredientLabelScan = useCallback(async ({ sessionId }) => {
    if (!callbacks?.onResumeIngredientLabelScan) {
      return {
        success: false,
        error: new Error("Resume ingredient label scan callback is not configured."),
      };
    }

    const safeSessionId = asText(sessionId);
    if (!safeSessionId) {
      return {
        success: false,
        error: new Error("Ingredient label scan session id is required."),
      };
    }

    try {
      const result = await callbacks.onResumeIngredientLabelScan({
        sessionId: safeSessionId,
      });
      return {
        success: result?.success !== false,
        result: result || null,
      };
    } catch (error) {
      return { success: false, error };
    }
  }, [callbacks]);

  // Run corner detection on supplied image data.
  const detectMenuCorners = useCallback(async ({ imageData, width, height }) => {
    if (!callbacks?.onDetectMenuCorners) {
      return {
        success: false,
        error: "Corner detection callback is not configured.",
      };
    }

    try {
      const result = await callbacks.onDetectMenuCorners({
        imageData,
        width,
        height,
      });
      return {
        success: Boolean(result?.success),
        corners: result?.corners || null,
        description: asText(result?.description),
        error: asText(result?.error),
      };
    } catch (error) {
      return {
        success: false,
        corners: null,
        error: error?.message || "Failed to detect menu corners.",
      };
    }
  }, [callbacks]);

  return {
    analyzeIngredientName,
    analyzeIngredientScanRequirement,
    submitIngredientAppeal,
    openIngredientLabelScan,
    resumeIngredientLabelScan,
    detectMenuCorners,
  };
}
