import { normalizeIngredientBrandAppeal } from "../../../../lib/ingredientBrandAppeal.js";
export { normalizeIngredientBrandAppeal };

export function applyIngredientBrandAppeal(ingredient, appeal) {
  const next = ingredient && typeof ingredient === "object" ? { ...ingredient } : {};
  const normalizedAppeal = normalizeIngredientBrandAppeal(appeal);
  if (!normalizedAppeal) {
    delete next.brandAppeal;
    return next;
  }

  next.brandAppeal = normalizedAppeal;
  return next;
}

export function clearIngredientBrandAppeal(ingredient) {
  const next = ingredient && typeof ingredient === "object" ? { ...ingredient } : {};
  delete next.brandAppeal;
  return next;
}

export function isIngredientBrandAppealPending(ingredient) {
  const normalizedAppeal = normalizeIngredientBrandAppeal(ingredient?.brandAppeal);
  return normalizedAppeal?.status === "pending";
}
