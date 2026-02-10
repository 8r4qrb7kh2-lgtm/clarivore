export function createBrandMemory({
  storageKey,
  norm,
  parseJsonArray,
  toArray,
  state,
  debugLog = () => {},
} = {}) {
  let cache = null;

  const load = () => {
    if (cache) return cache;
    try {
      const raw = localStorage.getItem(storageKey);
      cache = raw ? JSON.parse(raw) : {};
    } catch (_) {
      cache = {};
    }
    return cache;
  };

  const persist = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(cache || {}));
    } catch (_) {}
  };

  const normalizeIngredientKey = (name) =>
    norm(name || "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const rememberBrand = (name, data = {}) => {
    const key = normalizeIngredientKey(name);
    if (!key) return;
    const store = load();
    const brand = (data.brand || "").trim();
    if (!brand) {
      delete store[key];
      persist();
      return;
    }
    store[key] = {
      brand,
      brandImage: data.brandImage || "",
      ingredientsImage: data.ingredientsImage || "",
      ingredientsList: Array.isArray(data.ingredientsList)
        ? data.ingredientsList
        : [],
      allergens: Array.isArray(data.allergens) ? data.allergens : [],
      crossContamination: Array.isArray(data.crossContamination)
        ? data.crossContamination
        : [],
      diets: Array.isArray(data.diets) ? data.diets : [],
      crossContaminationDiets: Array.isArray(data.crossContaminationDiets)
        ? data.crossContaminationDiets
        : [],
      barcode: data.barcode || "",
    };
    persist();
  };

  const getRememberedBrand = (name) => {
    const key = normalizeIngredientKey(name);
    if (!key) return null;
    const store = load();

    if (store[key]) {
      debugLog(
        `Looking up brand for "${name}" (key: "${key}"): Found exact match: ${store[key].brand}`,
      );
      return store[key];
    }

    const searchWords = key.split(/\s+/).filter((w) => w.length > 2);
    const storeKeys = Object.keys(store);

    let bestMatch = null;
    let bestScore = 0;

    for (const storeKey of storeKeys) {
      const storeWords = storeKey.split(/\s+/).filter((w) => w.length > 2);
      if (storeWords.length === 0) continue;

      const matchedStoreWords = storeWords.filter((stw) =>
        searchWords.some(
          (sw) => stw === sw || stw.includes(sw) || sw.includes(stw),
        ),
      );

      const score = matchedStoreWords.length / storeWords.length;
      if (score >= 1.0 && score > bestScore) {
        bestScore = score;
        bestMatch = { key: storeKey, data: store[storeKey] };
      }
    }

    if (bestMatch) {
      debugLog(
        `Looking up brand for "${name}" (key: "${key}"): Found fuzzy match "${bestMatch.key}" (score: ${bestScore.toFixed(2)}): ${bestMatch.data.brand}`,
      );
      return bestMatch.data;
    }

    debugLog(`Looking up brand for "${name}" (key: "${key}"): Not found`);
    debugLog("Available keys in brand memory:", storeKeys);
    return null;
  };

  const rebuildBrandMemoryFromRestaurant = () => {
    debugLog("=== REBUILDING BRAND MEMORY ===");
    debugLog("Old brand memory:", JSON.stringify(cache));
    cache = {};

    if (!state?.restaurant || !Array.isArray(state.restaurant.overlays)) {
      debugLog("No restaurant or overlays found, clearing memory");
      persist();
      return;
    }

    debugLog(
      `Scanning ${state.restaurant.overlays.length} dishes for brands...`,
    );

    state.restaurant.overlays.forEach((overlay, overlayIdx) => {
      const dishName = overlay.id || overlay.name || "unnamed";

      let ingredients = parseJsonArray(overlay.aiIngredients);
      if (ingredients.length) {
        debugLog(
          `Dish ${overlayIdx} (${dishName}): Found aiIngredients with ${ingredients.length} ingredients`,
        );
      }

      if (!ingredients.length && Array.isArray(overlay.ingredients)) {
        ingredients = overlay.ingredients;
        debugLog(
          `Dish ${overlayIdx} (${dishName}): Using legacy ingredients array with ${ingredients.length} ingredients`,
        );
      }

      const sanitizedIngredients = toArray(ingredients);
      if (!sanitizedIngredients.length) {
        debugLog(`Dish ${overlayIdx} (${dishName}): No ingredients found`);
        return;
      }

      debugLog(
        `Dish ${overlayIdx} (${dishName}): Processing ${sanitizedIngredients.length} ingredients`,
      );

      sanitizedIngredients.forEach((ingredient) => {
        if (
          !ingredient?.name ||
          !Array.isArray(ingredient.brands) ||
          ingredient.brands.length === 0
        ) {
          return;
        }

        debugLog(
          `  - Ingredient "${ingredient.name}" has ${ingredient.brands.length} brand(s)`,
        );

        ingredient.brands.forEach((brandEntry) => {
          if (brandEntry?.name) {
            debugLog(
              `    -> Saving brand "${brandEntry.name}" for "${ingredient.name}"`,
            );
            rememberBrand(ingredient.name, {
              brand: brandEntry.name,
              brandImage: brandEntry.brandImage || "",
              ingredientsImage: brandEntry.ingredientsImage || "",
              ingredientsList: Array.isArray(brandEntry.ingredientsList)
                ? brandEntry.ingredientsList
                : [],
              allergens: Array.isArray(brandEntry.allergens)
                ? brandEntry.allergens
                : [],
              diets: Array.isArray(brandEntry.diets) ? brandEntry.diets : [],
            });
          }
        });
      });
    });

    debugLog("=== BRAND MEMORY REBUILD COMPLETE ===");
    debugLog("New brand memory:", JSON.stringify(cache));
    persist();
  };

  return {
    rememberBrand,
    getRememberedBrand,
    rebuildBrandMemoryFromRestaurant,
  };
}
