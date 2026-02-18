import { useCallback } from "react";

import { computeDietBlockers } from "../utils/settingsAndChangelog";
import { asText, dedupeTokenList, normalizeToken } from "../utils/text";

// AI dish actions that either run analysis or apply analysis results to the selected overlay.
// This keeps AI-specific mutation logic isolated from core editor state wiring.

export function useAiDishActions({
  selectedOverlay,
  callbacks,
  config,
  aiAssistDraftRef,

  normalizeAllergenList,
  normalizeDietList,
  updateOverlay,
  appendPendingChange,
  pushHistory,
  setAiAssistDraft,
}) {
  const applyAiResultToSelectedOverlay = useCallback(async (result) => {
    if (!selectedOverlay?._editorKey || !result) {
      return { success: false };
    }

    const baseIngredients = (Array.isArray(result.ingredients) ? result.ingredients : []).map(
      (ingredient, index) => {
        const rowName = asText(ingredient?.name) || `Ingredient ${index + 1}`;
        const containsAllergens = normalizeAllergenList(ingredient?.allergens);
        const containsDiets = normalizeDietList(ingredient?.diets);
        const crossAllergens = normalizeAllergenList(
          ingredient?.crossContaminationAllergens,
        );
        const crossDiets = normalizeDietList(ingredient?.crossContaminationDiets);
        return {
          ...ingredient,
          name: rowName,
          allergens: containsAllergens,
          diets: containsDiets,
          crossContaminationAllergens: crossAllergens,
          crossContaminationDiets: crossDiets,
          aiDetectedAllergens: normalizeAllergenList(
            ingredient?.aiDetectedAllergens || containsAllergens,
          ),
          aiDetectedDiets: normalizeDietList(
            ingredient?.aiDetectedDiets || containsDiets,
          ),
          aiDetectedCrossContaminationAllergens: normalizeAllergenList(
            ingredient?.aiDetectedCrossContaminationAllergens || crossAllergens,
          ),
          aiDetectedCrossContaminationDiets: normalizeDietList(
            ingredient?.aiDetectedCrossContaminationDiets || crossDiets,
          ),
          brands: Array.isArray(ingredient?.brands) ? ingredient.brands : [],
          brandRequired: Boolean(ingredient?.brandRequired),
          brandRequirementReason: asText(ingredient?.brandRequirementReason),
          confirmed: false,
        };
      },
    );

    const scanRequirementFallbackReason =
      "Automatic scan-requirement analysis failed; assign a brand item.";
    const dishName = asText(selectedOverlay.id || selectedOverlay.name);
    const uniqueByToken = new Map();
    baseIngredients.forEach((ingredient) => {
      const name = asText(ingredient?.name);
      const token = normalizeToken(name);
      if (!token || uniqueByToken.has(token)) return;
      uniqueByToken.set(token, name);
    });

    const requirementByToken = new Map();
    await Promise.all(
      Array.from(uniqueByToken.entries()).map(async ([token, ingredientName]) => {
        try {
          if (!callbacks?.onAnalyzeIngredientScanRequirement) {
            throw new Error("Ingredient scan requirement callback is not configured.");
          }
          const scanResult = await callbacks.onAnalyzeIngredientScanRequirement({
            ingredientName,
            dishName,
          });
          if (typeof scanResult?.needsScan !== "boolean") {
            throw new Error("Invalid scan requirement result.");
          }
          const needsScan = Boolean(scanResult.needsScan);
          requirementByToken.set(token, {
            brandRequired: needsScan,
            brandRequirementReason: needsScan ? asText(scanResult.reasoning) : "",
          });
        } catch (_error) {
          requirementByToken.set(token, {
            brandRequired: true,
            brandRequirementReason: scanRequirementFallbackReason,
          });
        }
      }),
    );

    const ingredients = baseIngredients.map((ingredient) => {
      const token = normalizeToken(ingredient?.name);
      const requirement = token ? requirementByToken.get(token) : null;
      if (!requirement) {
        return {
          ...ingredient,
          brandRequired: true,
          brandRequirementReason: scanRequirementFallbackReason,
        };
      }
      return {
        ...ingredient,
        brandRequired: Boolean(requirement.brandRequired),
        brandRequirementReason: asText(requirement.brandRequirementReason),
      };
    });

    const allergens = Array.from(
      new Set(
        ingredients
          .flatMap((ingredient) =>
            Array.isArray(ingredient?.allergens) ? ingredient.allergens : [],
          )
          .filter(Boolean),
      ),
    );

    const candidateDiets = dedupeTokenList([
      ...(Array.isArray(config?.DIETS) ? config.DIETS : []),
      ...normalizeDietList(result?.dietaryOptions),
      ...ingredients.flatMap((ingredient) =>
        Array.isArray(ingredient?.diets) ? ingredient.diets : [],
      ),
    ]);
    const diets = ingredients.length
      ? candidateDiets.filter((diet) =>
          ingredients.every((ingredient) => {
            if (!Array.isArray(ingredient?.diets)) return false;
            return ingredient.diets.some(
              (value) => normalizeToken(value) === normalizeToken(diet),
            );
          }),
        )
      : [];

    const details = {};
    allergens.forEach((allergen) => {
      const matched = ingredients
        .filter((ingredient) =>
          Array.isArray(ingredient?.allergens)
            ? ingredient.allergens.includes(allergen)
            : false,
        )
        .map((ingredient) => asText(ingredient?.name))
        .filter(Boolean);
      if (matched.length) {
        details[allergen] = `Contains ${Array.from(new Set(matched)).join(", ")}`;
      }
    });

    const ingredientsBlockingDiets = computeDietBlockers(
      ingredients,
      candidateDiets,
    );
    const crossContaminationAllergens = Array.from(
      new Set(
        ingredients
          .flatMap((ingredient) =>
            Array.isArray(ingredient?.crossContaminationAllergens)
              ? ingredient.crossContaminationAllergens
              : [],
          )
          .filter(Boolean),
      ),
    );
    const crossContaminationDiets = Array.from(
      new Set(
        ingredients
          .flatMap((ingredient) =>
            Array.isArray(ingredient?.crossContaminationDiets)
              ? ingredient.crossContaminationDiets
              : [],
          )
          .filter(Boolean),
      ),
    );

    updateOverlay(selectedOverlay._editorKey, {
      allergens,
      diets,
      details,
      ingredients,
      removable: [],
      crossContaminationAllergens,
      crossContaminationDiets,
      ingredientsBlockingDiets,
    });

    const selectedDishName = asText(selectedOverlay.id || selectedOverlay.name || "Dish");
    const firstIngredientRowName = asText(
      ingredients.find((ingredient) => asText(ingredient?.name))?.name || "Ingredient row",
    );
    appendPendingChange(
      `${selectedDishName}: ${firstIngredientRowName}: Applied AI ingredient analysis`,
      {
        key: `ai-analysis:${normalizeToken(selectedDishName)}:${normalizeToken(firstIngredientRowName)}`,
      },
    );
    queueMicrotask(() => pushHistory());
    return { success: true };
  }, [
    appendPendingChange,
    callbacks?.onAnalyzeIngredientScanRequirement,
    config?.DIETS,
    normalizeAllergenList,
    normalizeDietList,
    pushHistory,
    selectedOverlay,
    updateOverlay,
  ]);

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
