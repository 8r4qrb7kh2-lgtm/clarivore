// Brand utilities collect, normalize, and mutate ingredient-brand data
// embedded in menu overlay payloads.

import { getOverlayDishName } from "./menuUtils";

export function normalizeBrandKey(value) {
  // Canonical key format allows safe matching regardless of case or whitespace.
  return String(value || "").trim().toLowerCase();
}

function asText(value) {
  return String(value || "").trim();
}

function readBrandName(brand) {
  return asText(brand?.name || brand?.productName);
}

function readIngredientBrandImage(ingredient, brand) {
  return asText(
    brand?.brandImage ||
      brand?.image ||
      brand?.ingredientsImage ||
      ingredient?.brandImage ||
      ingredient?.image ||
      ingredient?.ingredientsImage,
  );
}

function readIngredientBrandList(ingredient) {
  return Array.isArray(ingredient?.brands) ? ingredient.brands : [];
}

function readFirstNamedBrand(ingredient) {
  const brands = readIngredientBrandList(ingredient);
  for (const brand of brands) {
    if (readBrandName(brand)) return brand;
  }
  return null;
}

function readAppliedBrandName(ingredient) {
  return asText(ingredient?.appliedBrandItem || ingredient?.appliedBrand || ingredient?.brandName);
}

function resolveIngredientAppliedBrand(ingredient) {
  const appliedBrandName = readAppliedBrandName(ingredient);
  const appliedBrandKey = normalizeBrandKey(appliedBrandName);

  if (appliedBrandKey) {
    const brands = readIngredientBrandList(ingredient);
    const matched = brands.find(
      (brand) => normalizeBrandKey(readBrandName(brand)) === appliedBrandKey,
    );
    if (matched) return matched;

    const firstNamedBrand = readFirstNamedBrand(ingredient);
    if (firstNamedBrand) return firstNamedBrand;

    if (appliedBrandName) {
      return {
        name: appliedBrandName,
        barcode: asText(ingredient?.barcode),
        brandImage: readIngredientBrandImage(ingredient, null),
        ingredientsList: Array.isArray(ingredient?.ingredientsList) ? ingredient.ingredientsList : [],
        ingredientList: asText(ingredient?.ingredientList),
        allergens: Array.isArray(ingredient?.allergens) ? ingredient.allergens : [],
        diets: Array.isArray(ingredient?.diets) ? ingredient.diets : [],
      };
    }
  }

  return readFirstNamedBrand(ingredient);
}

function collectIngredientTextLines(ingredient, brand) {
  const lines = [];
  if (Array.isArray(brand?.ingredientsList)) {
    lines.push(...brand.ingredientsList);
  } else if (brand?.ingredientList) {
    lines.push(brand.ingredientList);
  }

  if (Array.isArray(ingredient?.ingredientsList)) {
    lines.push(...ingredient.ingredientsList);
  } else if (ingredient?.ingredientList) {
    lines.push(ingredient.ingredientList);
  }

  return lines.map((entry) => asText(entry)).filter(Boolean);
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
      const ingredientName = asText(ingredient?.name);
      if (!ingredientName) return;

      // Brand items "in use" should be sourced from the applied/selected brand
      // for each ingredient row (not from all candidate brands).
      const appliedBrand = resolveIngredientAppliedBrand(ingredient);
      const brandName = readBrandName(appliedBrand);
      if (!brandName) return;

      const barcodeKey = normalizeBrandKey(appliedBrand?.barcode || ingredient?.barcode);
      const nameKey = normalizeBrandKey(brandName);
      const key = barcodeKey ? `barcode:${barcodeKey}` : `name:${nameKey}`;
      if (!key) return;

      if (!items.has(key)) {
        items.set(key, {
          key,
          brandName,
          barcode: asText(appliedBrand?.barcode || ingredient?.barcode),
          brandImage: readIngredientBrandImage(ingredient, appliedBrand),
          ingredientsList: collectIngredientTextLines(ingredient, appliedBrand),
          allergens: new Set(
            Array.isArray(appliedBrand?.allergens) && appliedBrand.allergens.length
              ? appliedBrand.allergens
              : Array.isArray(ingredient?.allergens)
                ? ingredient.allergens
                : [],
          ),
          diets: new Set(
            Array.isArray(appliedBrand?.diets) && appliedBrand.diets.length
              ? appliedBrand.diets
              : Array.isArray(ingredient?.diets)
                ? ingredient.diets
                : [],
          ),
          ingredientNames: new Set(),
          dishIngredients: new Map(),
          dishes: new Set(),
          overlayIndices: new Set(),
        });
      }

      const item = items.get(key);

      // Build reverse lookups used by the UI (ingredient names, dish list, and mapping).
      item.ingredientNames.add(ingredientName);
      if (dishName) item.dishes.add(dishName);
      if (dishName) {
        if (!item.dishIngredients.has(dishName)) {
          item.dishIngredients.set(dishName, new Set());
        }
        item.dishIngredients.get(dishName).add(ingredientName);
      }
      item.overlayIndices.add(overlayIndex);

      // Prefer first image, but upgrade if initial value was empty.
      if (!item.brandImage) {
        item.brandImage = readIngredientBrandImage(ingredient, appliedBrand);
      }

      // Merge allergen and diet labels across all appearances of this brand.
      const allergenValues =
        Array.isArray(appliedBrand?.allergens) && appliedBrand.allergens.length
          ? appliedBrand.allergens
          : Array.isArray(ingredient?.allergens)
            ? ingredient.allergens
            : [];
      allergenValues.forEach((entry) => item.allergens.add(entry));

      const dietValues =
        Array.isArray(appliedBrand?.diets) && appliedBrand.diets.length
          ? appliedBrand.diets
          : Array.isArray(ingredient?.diets)
            ? ingredient.diets
            : [];
      dietValues.forEach((entry) => item.diets.add(entry));

      // Merge ingredient text list while preventing duplicates.
      collectIngredientTextLines(ingredient, appliedBrand).forEach((entry) => {
        if (!item.ingredientsList.includes(entry)) {
          item.ingredientsList.push(entry);
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
      const appliedBrand = resolveIngredientAppliedBrand(ingredient);
      const appliedBrandBarcode = normalizeBrandKey(appliedBrand?.barcode || ingredient?.barcode);
      const appliedBrandName = normalizeBrandKey(readBrandName(appliedBrand));
      const matches = oldBarcode
        ? appliedBrandBarcode === oldBarcode
        : Boolean(appliedBrandName && appliedBrandName === oldName);

      if (!matches) return;

      changed = true;
      ingredient.brands = [{ ...newBrand }];
      const replacementName = readBrandName(newBrand);
      if (replacementName) {
        ingredient.appliedBrandItem = replacementName;
        ingredient.appliedBrand = replacementName;
        ingredient.brandName = replacementName;
      }
      const replacementImage = readIngredientBrandImage(ingredient, newBrand);
      if (replacementImage) {
        ingredient.brandImage = replacementImage;
      }
      ingredient.confirmed = false;
      applyBrandDetections(ingredient, newBrand, normalizeAllergen, normalizeDietLabel);
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
