import { applyIngredientBrandAppeal } from "./brandAppealState.js";

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function applyCommittedIngredientAppealToOverlays({
  overlays,
  dishName,
  ingredientName,
  appeal,
}) {
  const safeOverlays = Array.isArray(overlays) ? overlays : [];
  const dishToken = normalizeToken(dishName);
  const ingredientToken = normalizeToken(ingredientName);
  if (!ingredientToken) {
    return {
      changed: false,
      overlays: safeOverlays,
    };
  }

  let changed = false;
  const nextOverlays = safeOverlays.map((overlay) => {
    const overlayDishToken = normalizeToken(overlay?.id || overlay?.name || overlay?.dishName);
    if (dishToken && overlayDishToken !== dishToken) {
      return overlay;
    }

    const ingredients = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];
    let overlayChanged = false;
    const nextIngredients = ingredients.map((ingredient) => {
      if (normalizeToken(ingredient?.name) !== ingredientToken) {
        return ingredient;
      }
      overlayChanged = true;
      return applyIngredientBrandAppeal(ingredient, appeal);
    });

    if (!overlayChanged) {
      return overlay;
    }

    changed = true;
    return {
      ...overlay,
      ingredients: nextIngredients,
    };
  });

  return {
    changed,
    overlays: changed ? nextOverlays : safeOverlays,
  };
}
