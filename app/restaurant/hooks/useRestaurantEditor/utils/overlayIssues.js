import { asText } from "./text";

// Validation helpers used before save.
// Each helper returns plain issue records so callers can format UI messages consistently.

function hasAssignedBrand(ingredient) {
  // A row is considered assigned when at least one brand has a non-empty name.
  return (Array.isArray(ingredient?.brands) ? ingredient.brands : []).some(
    (brand) => asText(brand?.name),
  );
}

export function buildOverlayBrandRequirementIssues(overlay) {
  // Collect missing-brand issues for a single dish overlay.
  const issues = [];
  const overlayName = asText(overlay?.id || overlay?.name) || "Dish";
  const overlayKey = asText(overlay?._editorKey);
  const rows = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];

  rows.forEach((ingredient, index) => {
    if (!ingredient?.brandRequired) return;
    if (hasAssignedBrand(ingredient)) return;

    const ingredientName = asText(ingredient?.name) || `Ingredient ${index + 1}`;
    const reason = asText(ingredient?.brandRequirementReason);
    issues.push({
      overlayKey,
      overlayName,
      ingredientName,
      rowIndex: index,
      reason,
      message: reason
        ? `${overlayName}: ${ingredientName} requires brand assignment (${reason})`
        : `${overlayName}: ${ingredientName} requires brand assignment`,
    });
  });

  return issues;
}

export function buildBrandRequirementIssues(overlays) {
  // Flatten per-overlay brand requirement issues into one list.
  return (Array.isArray(overlays) ? overlays : []).flatMap((overlay) =>
    buildOverlayBrandRequirementIssues(overlay),
  );
}

export function buildOverlayIngredientConfirmationIssues(overlay) {
  // Collect ingredient rows that are still unconfirmed in a single overlay.
  const issues = [];
  const overlayName = asText(overlay?.id || overlay?.name) || "Dish";
  const overlayKey = asText(overlay?._editorKey);
  const rows = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];

  rows.forEach((ingredient, index) => {
    if (ingredient?.confirmed === true) return;

    const ingredientName = asText(ingredient?.name) || `Ingredient ${index + 1}`;
    issues.push({
      overlayKey,
      overlayName,
      ingredientName,
      rowIndex: index,
      message: `${overlayName}: ${ingredientName} must be confirmed before saving`,
    });
  });

  return issues;
}

export function buildIngredientConfirmationIssues(overlays) {
  // Flatten per-overlay confirmation issues into one list.
  return (Array.isArray(overlays) ? overlays : []).flatMap((overlay) =>
    buildOverlayIngredientConfirmationIssues(overlay),
  );
}
