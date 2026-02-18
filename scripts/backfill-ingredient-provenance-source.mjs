import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE = {
  SMART: "smart_detected",
  MANUAL: "manual_override",
};

function asText(value) {
  return String(value || "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
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
  return output.sort((left, right) => left.localeCompare(right));
}

function includesToken(values, targetToken) {
  const normalizedTarget = normalizeToken(targetToken);
  if (!normalizedTarget) return false;
  return (Array.isArray(values) ? values : []).some(
    (value) => normalizeToken(value) === normalizedTarget,
  );
}

function readTokenState({ containsValues, crossValues, token }) {
  if (includesToken(containsValues, token)) return "contains";
  if (includesToken(crossValues, token)) return "cross";
  return "none";
}

function resolveSource({ selectedState, smartState }) {
  return selectedState === smartState ? SOURCE.SMART : SOURCE.MANUAL;
}

function readOverlayDishName(overlay) {
  return asText(overlay?.id || overlay?.name || overlay?.dishName);
}

function readOverlayIngredients(overlay) {
  return Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];
}

function readFirstBrand(values) {
  const list = Array.isArray(values) ? values : [];
  for (const value of list) {
    const safe = value && typeof value === "object" ? value : {};
    const name = asText(safe?.name || safe?.productName);
    if (!name) continue;
    return { ...safe, name };
  }
  return null;
}

function normalizeIngredientRow(row, index) {
  const firstBrand = readFirstBrand(row?.brands);
  return {
    rowIndex: Number.isFinite(Number(row?.rowIndex))
      ? Math.max(Math.floor(Number(row.rowIndex)), 0)
      : index,
    name: asText(row?.name) || `Ingredient ${index + 1}`,
    allergens: normalizeStringList(row?.allergens),
    crossContaminationAllergens: normalizeStringList(row?.crossContaminationAllergens),
    diets: normalizeStringList(row?.diets),
    crossContaminationDiets: normalizeStringList(row?.crossContaminationDiets),
    aiDetectedAllergens: normalizeStringList(row?.aiDetectedAllergens || row?.allergens),
    aiDetectedCrossContaminationAllergens: normalizeStringList(
      row?.aiDetectedCrossContaminationAllergens || row?.crossContaminationAllergens,
    ),
    aiDetectedDiets: normalizeStringList(row?.aiDetectedDiets || row?.diets),
    aiDetectedCrossContaminationDiets: normalizeStringList(
      row?.aiDetectedCrossContaminationDiets || row?.crossContaminationDiets,
    ),
    removable: Boolean(row?.removable),
    brands: firstBrand ? [firstBrand] : [],
  };
}

function parseOverlays(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildIngredientRowsFromOverlays(overlays) {
  const output = [];

  (Array.isArray(overlays) ? overlays : []).forEach((overlay) => {
    const dishName = readOverlayDishName(overlay);
    if (!dishName) return;

    const ingredients = readOverlayIngredients(overlay).map((row, index) =>
      normalizeIngredientRow(row, index),
    );

    ingredients.forEach((ingredient, index) => {
      output.push({
        dishName,
        rowIndex: index,
        rowText: asText(ingredient.name) || `Ingredient ${index + 1}`,
        removable: Boolean(ingredient.removable),
        allergens: Array.isArray(ingredient.allergens) ? ingredient.allergens : [],
        crossContaminationAllergens: Array.isArray(ingredient.crossContaminationAllergens)
          ? ingredient.crossContaminationAllergens
          : [],
        diets: Array.isArray(ingredient.diets) ? ingredient.diets : [],
        crossContaminationDiets: Array.isArray(ingredient.crossContaminationDiets)
          ? ingredient.crossContaminationDiets
          : [],
        aiDetectedAllergens: Array.isArray(ingredient.aiDetectedAllergens)
          ? ingredient.aiDetectedAllergens
          : [],
        aiDetectedCrossContaminationAllergens: Array.isArray(
          ingredient.aiDetectedCrossContaminationAllergens,
        )
          ? ingredient.aiDetectedCrossContaminationAllergens
          : [],
        aiDetectedDiets: Array.isArray(ingredient.aiDetectedDiets)
          ? ingredient.aiDetectedDiets
          : [],
        aiDetectedCrossContaminationDiets: Array.isArray(
          ingredient.aiDetectedCrossContaminationDiets,
        )
          ? ingredient.aiDetectedCrossContaminationDiets
          : [],
      });
    });
  });

  return output;
}

function buildTokenMap(items, labelSelector) {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const label = asText(labelSelector(item));
    const token = normalizeToken(label);
    if (!token) return;
    map.set(token, item.id);
  });
  return map;
}

async function syncIngredientStatusFromOverlays(tx, restaurantId, overlays) {
  await tx.dish_ingredient_rows.deleteMany({
    where: { restaurant_id: restaurantId },
  });

  const allergenRows = await tx.allergens.findMany({
    where: { is_active: true },
    select: { id: true, key: true },
  });
  const dietRows = await tx.diets.findMany({
    where: { is_active: true, is_supported: true },
    select: { id: true, label: true },
  });

  const allergenIdByToken = buildTokenMap(allergenRows, (item) => item.key);
  const dietIdByToken = buildTokenMap(dietRows, (item) => item.label);
  const supportedDietLabels = dietRows.map((row) => row.label);

  const ingredientRows = buildIngredientRowsFromOverlays(overlays);
  if (ingredientRows.length) {
    await tx.dish_ingredient_rows.createMany({
      data: ingredientRows.map((row) => ({
        restaurant_id: restaurantId,
        dish_name: row.dishName,
        row_index: row.rowIndex,
        row_text: row.rowText || null,
      })),
    });
  }

  const insertedRows = await tx.dish_ingredient_rows.findMany({
    where: { restaurant_id: restaurantId },
    select: { id: true, dish_name: true, row_index: true },
  });

  const rowIdByDishAndIndex = new Map();
  insertedRows.forEach((row) => {
    rowIdByDishAndIndex.set(`${asText(row.dish_name)}::${Number(row.row_index)}`, row.id);
  });

  const allergenEntries = [];
  const dietEntries = [];

  ingredientRows.forEach((row) => {
    const rowId = rowIdByDishAndIndex.get(`${asText(row.dishName)}::${Number(row.rowIndex)}`);
    if (!rowId) return;

    const selectedAllergenContains = Array.isArray(row.allergens) ? row.allergens : [];
    const selectedAllergenCross = Array.isArray(row.crossContaminationAllergens)
      ? row.crossContaminationAllergens
      : [];
    const smartAllergenContains = Array.isArray(row.aiDetectedAllergens)
      ? row.aiDetectedAllergens
      : [];
    const smartAllergenCross = Array.isArray(row.aiDetectedCrossContaminationAllergens)
      ? row.aiDetectedCrossContaminationAllergens
      : [];

    const allergenStatusByToken = new Map();
    selectedAllergenContains.forEach((value) => {
      const token = normalizeToken(value);
      if (!token) return;
      allergenStatusByToken.set(token, {
        is_violation: true,
        is_cross_contamination: false,
      });
    });
    selectedAllergenCross.forEach((value) => {
      const token = normalizeToken(value);
      if (!token) return;
      const current = allergenStatusByToken.get(token) || {
        is_violation: false,
        is_cross_contamination: false,
      };
      current.is_cross_contamination = true;
      allergenStatusByToken.set(token, current);
    });

    allergenStatusByToken.forEach((status, token) => {
      const allergenId = allergenIdByToken.get(token);
      if (!allergenId) return;
      const selectedState = readTokenState({
        containsValues: selectedAllergenContains,
        crossValues: selectedAllergenCross,
        token,
      });
      const smartState = readTokenState({
        containsValues: smartAllergenContains,
        crossValues: smartAllergenCross,
        token,
      });
      allergenEntries.push({
        ingredient_row_id: rowId,
        allergen_id: allergenId,
        is_violation: Boolean(status.is_violation),
        is_cross_contamination: Boolean(status.is_cross_contamination),
        is_removable: Boolean(row.removable),
        source: resolveSource({ selectedState, smartState }),
      });
    });

    const selectedCompatibleDiets = Array.isArray(row.diets) ? row.diets : [];
    const selectedCrossDiets = Array.isArray(row.crossContaminationDiets)
      ? row.crossContaminationDiets
      : [];
    const smartCompatibleDiets = Array.isArray(row.aiDetectedDiets)
      ? row.aiDetectedDiets
      : [];
    const smartCrossDiets = Array.isArray(row.aiDetectedCrossContaminationDiets)
      ? row.aiDetectedCrossContaminationDiets
      : [];

    const compatibleDietTokens = new Set(
      selectedCompatibleDiets.map((value) => normalizeToken(value)).filter(Boolean),
    );
    const crossDietTokens = new Set(
      selectedCrossDiets.map((value) => normalizeToken(value)).filter(Boolean),
    );

    supportedDietLabels.forEach((label) => {
      const labelToken = normalizeToken(label);
      if (!labelToken) return;
      const dietId = dietIdByToken.get(labelToken);
      if (!dietId) return;

      const selectedState = crossDietTokens.has(labelToken)
        ? "cross"
        : compatibleDietTokens.has(labelToken)
          ? "contains"
          : "none";
      const smartState = readTokenState({
        containsValues: smartCompatibleDiets,
        crossValues: smartCrossDiets,
        token: labelToken,
      });
      const source = resolveSource({ selectedState, smartState });

      if (crossDietTokens.has(labelToken)) {
        dietEntries.push({
          ingredient_row_id: rowId,
          diet_id: dietId,
          is_violation: false,
          is_cross_contamination: true,
          is_removable: Boolean(row.removable),
          source,
        });
        return;
      }

      if (!compatibleDietTokens.has(labelToken)) {
        dietEntries.push({
          ingredient_row_id: rowId,
          diet_id: dietId,
          is_violation: true,
          is_cross_contamination: false,
          is_removable: Boolean(row.removable),
          source,
        });
      }
    });
  });

  if (allergenEntries.length) {
    await tx.dish_ingredient_allergens.createMany({ data: allergenEntries });
  }
  if (dietEntries.length) {
    await tx.dish_ingredient_diets.createMany({ data: dietEntries });
  }

  return {
    rows: ingredientRows.length,
    allergens: allergenEntries.length,
    diets: dietEntries.length,
  };
}

async function runBackfill() {
  const restaurants = await prisma.restaurants.findMany({
    select: { id: true, name: true, overlays: true },
    orderBy: { created_at: "asc" },
  });

  let totalRows = 0;
  let totalAllergens = 0;
  let totalDiets = 0;
  let failedCount = 0;

  for (const restaurant of restaurants) {
    const restaurantName = asText(restaurant?.name) || "Restaurant";
    const overlays = parseOverlays(restaurant?.overlays);

    try {
      const result = await prisma.$transaction((tx) =>
        syncIngredientStatusFromOverlays(tx, restaurant.id, overlays),
      );
      const rows = Number(result?.rows) || 0;
      const allergens = Number(result?.allergens) || 0;
      const diets = Number(result?.diets) || 0;
      totalRows += rows;
      totalAllergens += allergens;
      totalDiets += diets;
      console.log(
        `[ok] ${restaurantName} (${restaurant.id}) rows=${rows} allergens=${allergens} diets=${diets}`,
      );
    } catch (error) {
      failedCount += 1;
      console.error(
        `[error] ${restaurantName} (${restaurant.id}) ${error?.message || error}`,
      );
    }
  }

  console.log("Backfill complete.");
  console.log(`Restaurants processed: ${restaurants.length}`);
  console.log(`Ingredient rows written: ${totalRows}`);
  console.log(`Allergen status rows written: ${totalAllergens}`);
  console.log(`Diet status rows written: ${totalDiets}`);
  console.log(`Restaurants failed: ${failedCount}`);

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

runBackfill()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
