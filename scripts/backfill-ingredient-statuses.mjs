import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const parseAiIngredients = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const normalizeRowText = (row) => {
  const name = String(row?.name || row?.ingredient || "").trim();
  if (name) return name;
  const list = Array.isArray(row?.ingredientsList)
    ? row.ingredientsList.filter(Boolean)
    : [];
  if (list.length) return list.join(", ");
  return "";
};

const coerceRowIndex = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

async function backfill() {
  const allergens = await prisma.allergens.findMany({
    where: { is_active: true },
    select: { id: true, key: true },
  });
  const diets = await prisma.diets.findMany({
    where: { is_active: true, is_supported: true },
    select: { id: true, label: true },
  });

  const allergenIdByKey = new Map(
    allergens.map((row) => [row.key, row.id]),
  );
  const dietIdByLabel = new Map(diets.map((row) => [row.label, row.id]));
  const supportedDietLabels = diets.map((row) => row.label);

  const restaurants = await prisma.restaurants.findMany({
    select: { id: true, name: true, overlays: true },
  });

  let totalRows = 0;
  let totalAllergenEntries = 0;
  let totalDietEntries = 0;

  for (const restaurant of restaurants) {
    const overlays = Array.isArray(restaurant.overlays)
      ? restaurant.overlays
      : [];

    for (const overlay of overlays) {
      const dishName = overlay?.id || overlay?.name;
      if (!dishName) continue;

      const rows = parseAiIngredients(overlay?.aiIngredients);

      await prisma.dish_ingredient_rows.deleteMany({
        where: {
          restaurant_id: restaurant.id,
          dish_name: dishName,
        },
      });

      if (!rows.length) continue;

      const rowPayload = rows.map((row, idx) => ({
        restaurant_id: restaurant.id,
        dish_name: dishName,
        row_index: coerceRowIndex(row?.index, idx),
        row_text: normalizeRowText(row) || null,
      }));

      await prisma.dish_ingredient_rows.createMany({ data: rowPayload });

      const insertedRows = await prisma.dish_ingredient_rows.findMany({
        where: {
          restaurant_id: restaurant.id,
          dish_name: dishName,
        },
        select: { id: true, row_index: true },
      });

      const rowIdByIndex = new Map(
        insertedRows.map((row) => [row.row_index, row.id]),
      );

      const allergenEntries = [];
      const dietEntries = [];

      rows.forEach((row, idx) => {
        const rowIndex = coerceRowIndex(row?.index, idx);
        const rowId = rowIdByIndex.get(rowIndex);
        if (!rowId) return;

        const isRemovable = row?.removable === true;
        const allergens = Array.isArray(row?.allergens) ? row.allergens : [];
        const crossContamination = Array.isArray(row?.crossContamination)
          ? row.crossContamination
          : [];
        const allergenStatus = new Map();

        allergens.forEach((key) => {
          if (!key) return;
          allergenStatus.set(key, {
            is_violation: true,
            is_cross_contamination: false,
          });
        });
        crossContamination.forEach((key) => {
          if (!key) return;
          const existing =
            allergenStatus.get(key) ||
            {
              is_violation: false,
              is_cross_contamination: false,
            };
          existing.is_cross_contamination = true;
          allergenStatus.set(key, existing);
        });

        allergenStatus.forEach((status, key) => {
          const allergenId = allergenIdByKey.get(key);
          if (!allergenId) return;
          allergenEntries.push({
            ingredient_row_id: rowId,
            allergen_id: allergenId,
            is_violation: status.is_violation,
            is_cross_contamination: status.is_cross_contamination,
            is_removable: isRemovable,
          });
        });

        const diets = Array.isArray(row?.diets) ? row.diets : [];
        const crossContaminationDiets = Array.isArray(row?.crossContaminationDiets)
          ? row.crossContaminationDiets
          : [];
        const dietSet = new Set(diets);
        const crossContaminationSet = new Set(crossContaminationDiets);
        const compatible = new Set([...dietSet, ...crossContaminationSet]);

        supportedDietLabels.forEach((label) => {
          const dietId = dietIdByLabel.get(label);
          if (!dietId) return;
          if (crossContaminationSet.has(label)) {
            dietEntries.push({
              ingredient_row_id: rowId,
              diet_id: dietId,
              is_violation: false,
              is_cross_contamination: true,
              is_removable: isRemovable,
            });
            return;
          }
          if (!compatible.has(label)) {
            dietEntries.push({
              ingredient_row_id: rowId,
              diet_id: dietId,
              is_violation: true,
              is_cross_contamination: false,
              is_removable: isRemovable,
            });
          }
        });
      });

      if (allergenEntries.length) {
        await prisma.dish_ingredient_allergens.createMany({
          data: allergenEntries,
        });
      }
      if (dietEntries.length) {
        await prisma.dish_ingredient_diets.createMany({ data: dietEntries });
      }

      totalRows += insertedRows.length;
      totalAllergenEntries += allergenEntries.length;
      totalDietEntries += dietEntries.length;
    }
  }

  console.log("Backfill complete.");
  console.log(`Ingredient rows: ${totalRows}`);
  console.log(`Allergen entries: ${totalAllergenEntries}`);
  console.log(`Diet entries: ${totalDietEntries}`);
}

backfill()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
