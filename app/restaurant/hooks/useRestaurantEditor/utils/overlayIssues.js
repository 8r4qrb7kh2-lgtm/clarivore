import { asText } from "./text";

// Validation helpers used before save.
// Each helper returns plain issue records so callers can format UI messages consistently.

function hasAssignedBrand(ingredient) {
  return (Array.isArray(ingredient?.brands) ? ingredient.brands : []).some(
    (brand) => asText(brand?.name),
  );
}

export function buildOverlayBrandRequirementIssues(overlay) {
  const issues = [];
  const overlayName = asText(overlay?.id || overlay?.name) || "Dish";
  const rows = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];

  rows.forEach((ingredient, index) => {
    if (!ingredient?.brandRequired) return;
    if (hasAssignedBrand(ingredient)) return;

    const ingredientName = asText(ingredient?.name) || `Ingredient ${index + 1}`;
    const reason = asText(ingredient?.brandRequirementReason);
    issues.push({
      overlayName,
      ingredientName,
      reason,
      message: reason
        ? `${overlayName}: ${ingredientName} requires brand assignment (${reason})`
        : `${overlayName}: ${ingredientName} requires brand assignment`,
    });
  });

  return issues;
}

export function buildBrandRequirementIssues(overlays) {
  return (Array.isArray(overlays) ? overlays : []).flatMap((overlay) =>
    buildOverlayBrandRequirementIssues(overlay),
  );
}

export function buildOverlayIngredientConfirmationIssues(overlay) {
  const issues = [];
  const overlayName = asText(overlay?.id || overlay?.name) || "Dish";
  const rows = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];

  rows.forEach((ingredient, index) => {
    if (ingredient?.confirmed === true) return;

    const ingredientName = asText(ingredient?.name) || `Ingredient ${index + 1}`;
    issues.push({
      overlayName,
      ingredientName,
      message: `${overlayName}: ${ingredientName} must be confirmed before saving`,
    });
  });

  return issues;
}

export function buildIngredientConfirmationIssues(overlays) {
  return (Array.isArray(overlays) ? overlays : []).flatMap((overlay) =>
    buildOverlayIngredientConfirmationIssues(overlay),
  );
}
