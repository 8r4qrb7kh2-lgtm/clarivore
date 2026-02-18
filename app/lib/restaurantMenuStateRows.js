function asText(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toSafeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toSafeNonNegativeInteger(value, fallback = 0) {
  const numeric = Math.floor(toSafeNumber(value, fallback));
  return Number.isFinite(numeric) ? Math.max(numeric, 0) : fallback;
}

function parseJsonValue(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }
  return value;
}

function parseJsonArray(value, fallback = []) {
  const parsed = parseJsonValue(value, fallback);
  return Array.isArray(parsed) ? parsed : fallback;
}

function parseJsonObject(value, fallback = {}) {
  const parsed = parseJsonValue(value, fallback);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : fallback;
}

function normalizeStringList(values) {
  const seen = new Set();
  const output = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = asText(value);
    const token = normalizeToken(text);
    if (!token || seen.has(token)) return;
    seen.add(token);
    output.push(text);
  });
  return output;
}

function readBrandName(brand) {
  return asText(brand?.name || brand?.productName || brand?.brandName);
}

function normalizeBrandFromRow(brandRow) {
  if (!brandRow || typeof brandRow !== "object") return null;

  const payload = parseJsonObject(brandRow.brand_payload, {});
  const brandName = readBrandName(payload) || asText(brandRow.brand_name);
  if (!brandName) return null;

  const ingredientsList = normalizeStringList(
    Array.isArray(payload.ingredientsList) && payload.ingredientsList.length
      ? payload.ingredientsList
      : Array.isArray(brandRow.ingredients_list)
        ? brandRow.ingredients_list
        : [],
  );

  const brandImage = asText(payload.brandImage || brandRow.brand_image || payload.image || brandRow.image);
  const ingredientsImage = asText(payload.ingredientsImage || brandRow.ingredients_image);
  const image = asText(payload.image || brandRow.image);

  return {
    ...payload,
    name: brandName,
    barcode: asText(payload.barcode || brandRow.barcode),
    brandImage,
    ingredientsImage,
    image,
    ingredientList: asText(payload.ingredientList || brandRow.ingredient_list),
    ingredientsList,
    allergens: normalizeStringList(
      Array.isArray(payload.allergens) && payload.allergens.length
        ? payload.allergens
        : brandRow.allergens,
    ),
    crossContaminationAllergens: normalizeStringList(
      Array.isArray(payload.crossContaminationAllergens) && payload.crossContaminationAllergens.length
        ? payload.crossContaminationAllergens
        : brandRow.cross_contamination_allergens,
    ),
    diets: normalizeStringList(
      Array.isArray(payload.diets) && payload.diets.length ? payload.diets : brandRow.diets,
    ),
    crossContaminationDiets: normalizeStringList(
      Array.isArray(payload.crossContaminationDiets) && payload.crossContaminationDiets.length
        ? payload.crossContaminationDiets
        : brandRow.cross_contamination_diets,
    ),
  };
}

function buildIngredientFromRow(ingredientRow, brandRow) {
  const payload = parseJsonObject(ingredientRow?.ingredient_payload, {});
  const rowIndex = toSafeNonNegativeInteger(
    ingredientRow?.row_index ?? payload?.rowIndex,
    0,
  );
  const ingredientName = asText(payload?.name || ingredientRow?.row_text) || `Ingredient ${rowIndex + 1}`;

  const ingredient = {
    ...payload,
    rowIndex,
    name: ingredientName,
  };

  const appliedBrandItem = asText(
    ingredientRow?.applied_brand_item ||
      payload?.appliedBrandItem ||
      payload?.appliedBrand ||
      payload?.brandName,
  );
  if (appliedBrandItem) {
    ingredient.appliedBrandItem = appliedBrandItem;
    ingredient.appliedBrand = appliedBrandItem;
    ingredient.brandName = appliedBrandItem;
  }

  const normalizedBrand = normalizeBrandFromRow(brandRow);
  if (!normalizedBrand) {
    if (!Array.isArray(ingredient.brands)) {
      ingredient.brands = [];
    }
    return ingredient;
  }

  ingredient.brands = [normalizedBrand];
  ingredient.appliedBrandItem = normalizedBrand.name;
  ingredient.appliedBrand = normalizedBrand.name;
  ingredient.brandName = normalizedBrand.name;

  if (normalizedBrand.brandImage) ingredient.brandImage = normalizedBrand.brandImage;
  if (normalizedBrand.ingredientsImage) ingredient.ingredientsImage = normalizedBrand.ingredientsImage;
  if (normalizedBrand.image) ingredient.image = normalizedBrand.image;
  if (normalizedBrand.ingredientList) ingredient.ingredientList = normalizedBrand.ingredientList;
  if (normalizedBrand.ingredientsList.length) {
    ingredient.ingredientsList = [...normalizedBrand.ingredientsList];
  }

  ingredient.allergens = [...normalizedBrand.allergens];
  ingredient.crossContaminationAllergens = [...normalizedBrand.crossContaminationAllergens];
  ingredient.diets = [...normalizedBrand.diets];
  ingredient.crossContaminationDiets = [...normalizedBrand.crossContaminationDiets];

  if (!Array.isArray(ingredient.aiDetectedAllergens) || !ingredient.aiDetectedAllergens.length) {
    ingredient.aiDetectedAllergens = [...normalizedBrand.allergens];
  }
  if (
    !Array.isArray(ingredient.aiDetectedCrossContaminationAllergens) ||
    !ingredient.aiDetectedCrossContaminationAllergens.length
  ) {
    ingredient.aiDetectedCrossContaminationAllergens = [
      ...normalizedBrand.crossContaminationAllergens,
    ];
  }
  if (!Array.isArray(ingredient.aiDetectedDiets) || !ingredient.aiDetectedDiets.length) {
    ingredient.aiDetectedDiets = [...normalizedBrand.diets];
  }
  if (
    !Array.isArray(ingredient.aiDetectedCrossContaminationDiets) ||
    !ingredient.aiDetectedCrossContaminationDiets.length
  ) {
    ingredient.aiDetectedCrossContaminationDiets = [
      ...normalizedBrand.crossContaminationDiets,
    ];
  }

  return ingredient;
}

function buildOverlayFromDishRow(dishRow, ingredientRows, brandByIngredientId) {
  const payload = parseJsonObject(dishRow?.payload_json, {});
  const dishName =
    asText(dishRow?.dish_name || payload?.name || payload?.id || payload?.dishName) ||
    "Dish";

  const pageIndex = toSafeNonNegativeInteger(dishRow?.page_index ?? payload?.pageIndex, 0);

  const sortedIngredientRows = [...(Array.isArray(ingredientRows) ? ingredientRows : [])].sort(
    (left, right) =>
      toSafeNonNegativeInteger(left?.row_index, 0) -
      toSafeNonNegativeInteger(right?.row_index, 0),
  );

  const ingredients = sortedIngredientRows.map((row) => {
    const ingredientRowId = asText(row?.id);
    const brandRow = ingredientRowId ? brandByIngredientId.get(ingredientRowId) || null : null;
    return buildIngredientFromRow(row, brandRow);
  });

  const removable = parseJsonArray(
    dishRow?.removable_json,
    Array.isArray(payload?.removable) ? payload.removable : [],
  );

  const details = parseJsonObject(dishRow?.details_json, parseJsonObject(payload?.details, {}));
  const ingredientsBlockingDiets = parseJsonObject(
    dishRow?.ingredients_blocking_diets_json,
    parseJsonObject(payload?.ingredientsBlockingDiets || payload?.ingredients_blocking_diets, {}),
  );

  const overlay = {
    ...payload,
    id: dishName,
    name: dishName,
    dishName,
    pageIndex,
    x: toSafeNumber(dishRow?.x, toSafeNumber(payload?.x, 0)),
    y: toSafeNumber(dishRow?.y, toSafeNumber(payload?.y, 0)),
    w: toSafeNumber(dishRow?.w, toSafeNumber(payload?.w, 0)),
    h: toSafeNumber(dishRow?.h, toSafeNumber(payload?.h, 0)),
    allergens: normalizeStringList(
      Array.isArray(dishRow?.allergens) ? dishRow.allergens : payload?.allergens,
    ),
    diets: normalizeStringList(Array.isArray(dishRow?.diets) ? dishRow.diets : payload?.diets),
    crossContaminationAllergens: normalizeStringList(
      Array.isArray(dishRow?.cross_contamination_allergens)
        ? dishRow.cross_contamination_allergens
        : payload?.crossContaminationAllergens,
    ),
    crossContaminationDiets: normalizeStringList(
      Array.isArray(dishRow?.cross_contamination_diets)
        ? dishRow.cross_contamination_diets
        : payload?.crossContaminationDiets,
    ),
    removable,
    ingredientsBlockingDiets,
    ingredients: ingredients.length
      ? ingredients
      : (Array.isArray(payload?.ingredients) ? payload.ingredients : []),
  };

  if (Array.isArray(overlay.ingredients) && overlay.ingredients.length) {
    overlay.aiIngredients = JSON.stringify(overlay.ingredients);
  } else {
    delete overlay.aiIngredients;
  }

  const dishText = asText(dishRow?.dish_text || payload?.text);
  if (dishText) {
    overlay.text = dishText;
  } else {
    delete overlay.text;
  }

  const description = asText(dishRow?.description || payload?.description);
  if (description) {
    overlay.description = description;
  } else {
    delete overlay.description;
  }

  if (Object.keys(details).length) {
    overlay.details = details;
  } else {
    delete overlay.details;
  }

  if (!Object.keys(ingredientsBlockingDiets).length) {
    delete overlay.ingredientsBlockingDiets;
    delete overlay.ingredients_blocking_diets;
  }

  return overlay;
}

function toRestaurantId(value) {
  return asText(value);
}

function buildMenuImages(pageRows, overlays) {
  const imageByPageIndex = new Map();
  let maxPageIndex = 0;

  (Array.isArray(pageRows) ? pageRows : []).forEach((row) => {
    const pageIndex = toSafeNonNegativeInteger(row?.page_index, 0);
    const imageUrl = asText(row?.image_url);
    imageByPageIndex.set(pageIndex, imageUrl);
    maxPageIndex = Math.max(maxPageIndex, pageIndex);
  });

  (Array.isArray(overlays) ? overlays : []).forEach((overlay) => {
    maxPageIndex = Math.max(maxPageIndex, toSafeNonNegativeInteger(overlay?.pageIndex, 0));
  });

  const firstImage =
    asText(imageByPageIndex.get(0)) ||
    [...imageByPageIndex.values()].find((value) => asText(value)) ||
    "";

  const output = [];
  for (let pageIndex = 0; pageIndex <= maxPageIndex; pageIndex += 1) {
    const imageUrl = asText(imageByPageIndex.get(pageIndex) || firstImage);
    output.push(imageUrl);
  }

  return output.filter((value, index) => value || index === 0 || output.some(Boolean));
}

export function getEmptyRestaurantMenuState() {
  return {
    overlays: [],
    menuImages: [],
    menuImage: "",
  };
}

export function buildRestaurantMenuStateMapFromRows({
  menuPageRows,
  menuDishRows,
  ingredientRows,
  brandRows,
}) {
  const pageRowsByRestaurant = new Map();
  const dishRowsByRestaurant = new Map();
  const ingredientRowsByRestaurantAndDishId = new Map();
  const ingredientRowsByRestaurantAndDishName = new Map();
  const brandByIngredientId = new Map();
  const restaurantIds = new Set();

  (Array.isArray(menuPageRows) ? menuPageRows : []).forEach((row) => {
    const restaurantId = toRestaurantId(row?.restaurant_id);
    if (!restaurantId) return;
    restaurantIds.add(restaurantId);
    if (!pageRowsByRestaurant.has(restaurantId)) pageRowsByRestaurant.set(restaurantId, []);
    pageRowsByRestaurant.get(restaurantId).push(row);
  });

  (Array.isArray(menuDishRows) ? menuDishRows : []).forEach((row) => {
    const restaurantId = toRestaurantId(row?.restaurant_id);
    if (!restaurantId) return;
    restaurantIds.add(restaurantId);
    if (!dishRowsByRestaurant.has(restaurantId)) dishRowsByRestaurant.set(restaurantId, []);
    dishRowsByRestaurant.get(restaurantId).push(row);
  });

  (Array.isArray(ingredientRows) ? ingredientRows : []).forEach((row) => {
    const restaurantId = toRestaurantId(row?.restaurant_id);
    if (!restaurantId) return;
    restaurantIds.add(restaurantId);

    const dishId = asText(row?.dish_id);
    if (dishId) {
      const key = `${restaurantId}::dish-id::${dishId}`;
      if (!ingredientRowsByRestaurantAndDishId.has(key)) {
        ingredientRowsByRestaurantAndDishId.set(key, []);
      }
      ingredientRowsByRestaurantAndDishId.get(key).push(row);
    }

    const dishNameToken = normalizeToken(row?.dish_name);
    if (dishNameToken) {
      const key = `${restaurantId}::dish-name::${dishNameToken}`;
      if (!ingredientRowsByRestaurantAndDishName.has(key)) {
        ingredientRowsByRestaurantAndDishName.set(key, []);
      }
      ingredientRowsByRestaurantAndDishName.get(key).push(row);
    }
  });

  (Array.isArray(brandRows) ? brandRows : []).forEach((row) => {
    const ingredientRowId = asText(row?.ingredient_row_id);
    const restaurantId = toRestaurantId(row?.restaurant_id);
    if (!ingredientRowId || !restaurantId) return;
    restaurantIds.add(restaurantId);
    brandByIngredientId.set(ingredientRowId, row);
  });

  const menuStateByRestaurantId = new Map();

  restaurantIds.forEach((restaurantId) => {
    const dishRows = [...(dishRowsByRestaurant.get(restaurantId) || [])].sort((left, right) => {
      const pageDiff =
        toSafeNonNegativeInteger(left?.page_index, 0) -
        toSafeNonNegativeInteger(right?.page_index, 0);
      if (pageDiff !== 0) return pageDiff;
      return asText(left?.dish_name).localeCompare(asText(right?.dish_name));
    });

    const overlays = dishRows.map((dishRow) => {
      const dishId = asText(dishRow?.id);
      const ingredientsByDishId = dishId
        ? ingredientRowsByRestaurantAndDishId.get(`${restaurantId}::dish-id::${dishId}`)
        : null;
      const ingredientsByDishName = ingredientRowsByRestaurantAndDishName.get(
        `${restaurantId}::dish-name::${normalizeToken(dishRow?.dish_name)}`,
      );
      const ingredientList = ingredientsByDishId || ingredientsByDishName || [];
      return buildOverlayFromDishRow(dishRow, ingredientList, brandByIngredientId);
    });

    const pageRows = [...(pageRowsByRestaurant.get(restaurantId) || [])].sort(
      (left, right) =>
        toSafeNonNegativeInteger(left?.page_index, 0) -
        toSafeNonNegativeInteger(right?.page_index, 0),
    );

    const menuImages = buildMenuImages(pageRows, overlays);
    const menuImage = asText(menuImages[0]);

    menuStateByRestaurantId.set(restaurantId, {
      overlays,
      menuImages,
      menuImage,
    });
  });

  return menuStateByRestaurantId;
}

export function mergeRestaurantWithMenuState(restaurant, menuState) {
  const base = restaurant && typeof restaurant === "object" ? restaurant : {};
  const state =
    menuState && typeof menuState === "object"
      ? menuState
      : getEmptyRestaurantMenuState();

  return {
    ...base,
    overlays: Array.isArray(state.overlays) ? state.overlays : [],
    menuImages: Array.isArray(state.menuImages) ? state.menuImages : [],
    menuImage: asText(state.menuImage),
  };
}
