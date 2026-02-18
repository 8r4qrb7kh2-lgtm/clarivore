// Brand utilities collect, normalize, and mutate ingredient-brand data
// embedded in menu overlay payloads.

import { getOverlayDishName } from "./menuUtils";

export function normalizeBrandKey(value) {
  // Canonical key format allows safe matching regardless of case or whitespace.
  return String(value || "").trim().toLowerCase();
}

export function normalizeTagList(list, normalizer) {
  const seen = new Set();

  // 1) force string type, 2) trim, 3) optional domain-specific normalize,
  // 4) remove empty entries, 5) remove duplicates while preserving order.
  return (Array.isArray(list) ? list : [])
    .map((value) => String(value ?? "").trim())
    .map((value) => (typeof normalizer === "function" ? normalizer(value) : value))
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

export function collectBrandItemsFromOverlays(overlays) {
  // We aggregate by barcode when available, otherwise by normalized name.
  // Map values store mutable sets during collection, then we convert to arrays.
  const items = new Map();

  (Array.isArray(overlays) ? overlays : []).forEach((overlay, overlayIndex) => {
    const dishName = getOverlayDishName(overlay, overlayIndex);

    // Ingredient payload may live in `aiIngredients` string or `ingredients` array.
    let ingredients = [];
    if (overlay?.aiIngredients) {
      try {
        ingredients = JSON.parse(overlay.aiIngredients);
      } catch {
        ingredients = [];
      }
    }
    if (!ingredients.length && Array.isArray(overlay?.ingredients)) {
      ingredients = overlay.ingredients;
    }

    ingredients.forEach((ingredient) => {
      if (!ingredient?.name || !Array.isArray(ingredient.brands)) return;

      ingredient.brands.forEach((brand) => {
        if (!brand?.name) return;

        const barcodeKey = normalizeBrandKey(brand.barcode);
        const nameKey = normalizeBrandKey(brand.name);
        const key = barcodeKey ? `barcode:${barcodeKey}` : `name:${nameKey}`;
        if (!key) return;

        if (!items.has(key)) {
          items.set(key, {
            key,
            brandName: brand.name,
            barcode: brand.barcode || "",
            brandImage: brand.brandImage || brand.image || "",
            ingredientsList: Array.isArray(brand.ingredientsList)
              ? [...brand.ingredientsList]
              : brand.ingredientList
                ? [brand.ingredientList]
                : [],
            allergens: new Set(Array.isArray(brand.allergens) ? brand.allergens : []),
            diets: new Set(Array.isArray(brand.diets) ? brand.diets : []),
            ingredientNames: new Set(),
            dishIngredients: new Map(),
            dishes: new Set(),
            overlayIndices: new Set(),
          });
        }

        const item = items.get(key);

        // Build reverse lookups used by the UI (ingredient names, dish list, and mapping).
        item.ingredientNames.add(ingredient.name);
        if (dishName) item.dishes.add(dishName);
        if (dishName && ingredient.name) {
          if (!item.dishIngredients.has(dishName)) {
            item.dishIngredients.set(dishName, new Set());
          }
          item.dishIngredients.get(dishName).add(ingredient.name);
        }
        item.overlayIndices.add(overlayIndex);

        // Prefer first image, but upgrade if initial value was empty.
        if (!item.brandImage && (brand.brandImage || brand.image)) {
          item.brandImage = brand.brandImage || brand.image;
        }

        // Merge allergen and diet labels across all appearances of this brand.
        if (Array.isArray(brand.allergens)) {
          brand.allergens.forEach((entry) => item.allergens.add(entry));
        }
        if (Array.isArray(brand.diets)) {
          brand.diets.forEach((entry) => item.diets.add(entry));
        }

        // Merge ingredient text list while preventing duplicates.
        if (Array.isArray(brand.ingredientsList)) {
          brand.ingredientsList.forEach((entry) => {
            if (entry && !item.ingredientsList.includes(entry)) {
              item.ingredientsList.push(entry);
            }
          });
        } else if (brand.ingredientList && !item.ingredientsList.includes(brand.ingredientList)) {
          item.ingredientsList.push(brand.ingredientList);
        }
      });
    });
  });

  // Convert mutable sets/maps into plain serializable arrays and objects.
  return Array.from(items.values())
    .map((item) => ({
      ...item,
      allergens: Array.from(item.allergens),
      diets: Array.from(item.diets),
      ingredientNames: Array.from(item.ingredientNames),
      dishIngredients: Array.from(item.dishIngredients.entries()).reduce(
        (accumulator, [dishName, ingredientSet]) => ({
          ...accumulator,
          [dishName]: Array.from(ingredientSet),
        }),
        {},
      ),
      dishes: Array.from(item.dishes),
      overlayIndices: Array.from(item.overlayIndices),
    }))
    .sort((a, b) => a.brandName.localeCompare(b.brandName));
}

function applyBrandDetections(ingredient, newBrand, normalizeAllergen, normalizeDietLabel) {
  // Replacement also updates AI-detected allergen/diet fields so downstream logic
  // reads consistent data after editing.
  const allergens = normalizeTagList(newBrand?.allergens, normalizeAllergen);
  const diets = normalizeTagList(newBrand?.diets, normalizeDietLabel);
  const crossContaminationAllergens = normalizeTagList(
    newBrand?.crossContaminationAllergens,
    normalizeAllergen,
  );
  const crossContaminationDiets = normalizeTagList(
    newBrand?.crossContaminationDiets,
    normalizeDietLabel,
  );

  ingredient.allergens = allergens.slice();
  ingredient.diets = diets.slice();
  ingredient.crossContaminationAllergens = crossContaminationAllergens.slice();
  ingredient.crossContaminationDiets = crossContaminationDiets.slice();
  ingredient.aiDetectedAllergens = allergens.slice();
  ingredient.aiDetectedDiets = diets.slice();
  ingredient.aiDetectedCrossContaminationAllergens = crossContaminationAllergens.slice();
  ingredient.aiDetectedCrossContaminationDiets = crossContaminationDiets.slice();
}

export function replaceBrandInOverlays(
  overlays,
  oldItem,
  newBrand,
  normalizeAllergen,
  normalizeDietLabel,
) {
  // Deep-clone first so we never mutate the currently rendered overlay tree.
  const updated = JSON.parse(JSON.stringify(Array.isArray(overlays) ? overlays : []));
  const oldBarcode = normalizeBrandKey(oldItem?.barcode);
  const oldName = normalizeBrandKey(oldItem?.brandName);

  updated.forEach((overlay) => {
    let ingredients = [];
    let hasAiIngredients = false;

    if (overlay?.aiIngredients) {
      try {
        ingredients = JSON.parse(overlay.aiIngredients);
        hasAiIngredients = true;
      } catch {
        ingredients = [];
      }
    }

    if (!ingredients.length && Array.isArray(overlay?.ingredients)) {
      ingredients = overlay.ingredients;
    }

    if (!ingredients.length) return;

    let changed = false;
    ingredients.forEach((ingredient) => {
      if (!Array.isArray(ingredient.brands)) return;

      let ingredientChanged = false;
      ingredient.brands = ingredient.brands.map((brand) => {
        const brandBarcode = normalizeBrandKey(brand?.barcode);
        const brandName = normalizeBrandKey(brand?.name);
        const matches = oldBarcode
          ? brandBarcode === oldBarcode
          : Boolean(brandName && brandName === oldName);

        if (matches) {
          changed = true;
          ingredientChanged = true;
          return { ...newBrand };
        }
        return brand;
      });

      if (ingredientChanged) {
        applyBrandDetections(ingredient, newBrand, normalizeAllergen, normalizeDietLabel);
      }
    });

    if (!changed) return;

    // Preserve whichever ingredient storage format was present on this overlay.
    if (hasAiIngredients || overlay?.aiIngredients) {
      overlay.aiIngredients = JSON.stringify(ingredients);
    }
    if (Array.isArray(overlay?.ingredients)) {
      overlay.ingredients = ingredients;
    }
  });

  return updated;
}
