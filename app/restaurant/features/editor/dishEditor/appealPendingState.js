import { isIngredientBrandAppealPending } from "./brandAppealState.js";

export function buildAppealPendingMap(ingredients) {
  const next = {};
  (Array.isArray(ingredients) ? ingredients : []).forEach((ingredient, index) => {
    if (isIngredientBrandAppealPending(ingredient)) {
      next[index] = true;
    }
  });
  return next;
}

export function mergeAppealPendingMap(currentPending, ingredients) {
  const next = buildAppealPendingMap(ingredients);
  const ingredientCount = Array.isArray(ingredients) ? ingredients.length : 0;

  Object.keys(currentPending || {}).forEach((key) => {
    const numericIndex = Number(key);
    if (!Number.isInteger(numericIndex)) return;
    if (numericIndex < 0 || numericIndex >= ingredientCount) return;
    if (currentPending?.[key] === true) {
      next[numericIndex] = true;
    }
  });

  return next;
}
