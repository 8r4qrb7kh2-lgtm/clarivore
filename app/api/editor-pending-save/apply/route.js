import { NextResponse } from "next/server";
import {
  asText,
  ensurePendingSaveTables,
  normalizeIngredientRow,
  normalizeToken,
  PENDING_SAVE_BATCH_TABLE,
  prisma,
  readOverlayDishName,
  readOverlayIngredients,
  requireManagerSession,
  toJsonSafe,
} from "../_shared/pendingSaveUtils";

export const runtime = "nodejs";

function parseBatchChangePayload(batch) {
  const value = batch?.change_payload;
  if (!value) return {};
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
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

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const restaurantId = asText(body?.restaurantId);
  const batchId = asText(body?.batchId);
  const expectedStateHash = asText(body?.stateHash);

  if (!restaurantId || !batchId) {
    return NextResponse.json(
      { error: "restaurantId and batchId are required" },
      { status: 400 },
    );
  }

  try {
    const { userId, userEmail } = await requireManagerSession(request, restaurantId);
    await ensurePendingSaveTables(prisma);

    const applyResult = await prisma.$transaction(async (tx) => {
      const batchRows = await tx.$queryRawUnsafe(
        `
        SELECT *
        FROM ${PENDING_SAVE_BATCH_TABLE}
        WHERE id = $1::uuid
          AND restaurant_id = $2::uuid
          AND created_by = $3::uuid
          AND status = 'pending'
        LIMIT 1
      `,
        batchId,
        restaurantId,
        userId,
      );

      const batch = batchRows?.[0] || null;
      if (!batch) {
        throw new Error("Pending save batch not found or already applied.");
      }

      const batchStateHash = asText(batch?.state_hash);
      if (expectedStateHash && batchStateHash && expectedStateHash !== batchStateHash) {
        throw new Error("Pending save batch is stale. Re-open save review.");
      }

      const changePayload = toJsonSafe(parseBatchChangePayload(batch), {});
      const stagedOverlays = toJsonSafe(parseJsonArray(batch?.staged_overlays, []), []);
      const stagedMenuImages = parseJsonArray(batch?.staged_menu_images, [])
        .map((value) => asText(value))
        .filter(Boolean);
      const stagedMenuImage =
        asText(batch?.staged_menu_image) || stagedMenuImages[0] || "";

      if (!stagedMenuImages.length && stagedMenuImage) {
        stagedMenuImages.push(stagedMenuImage);
      }

      await tx.restaurants.update({
        where: { id: restaurantId },
        data: {
          overlays: stagedOverlays,
          menu_image: stagedMenuImage || null,
          menu_images: toJsonSafe(stagedMenuImages, []),
        },
      });

      await tx.dish_ingredient_rows.deleteMany({
        where: {
          restaurant_id: restaurantId,
        },
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

      const ingredientRows = buildIngredientRowsFromOverlays(stagedOverlays);
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

      const ingredientRowIdByDishAndIndex = new Map();
      insertedRows.forEach((row) => {
        ingredientRowIdByDishAndIndex.set(
          `${asText(row.dish_name)}::${Number(row.row_index)}`,
          row.id,
        );
      });

      const allergenEntries = [];
      const dietEntries = [];

      ingredientRows.forEach((row) => {
        const rowId = ingredientRowIdByDishAndIndex.get(
          `${asText(row.dishName)}::${Number(row.rowIndex)}`,
        );
        if (!rowId) return;

        const allergenStatusByToken = new Map();
        (Array.isArray(row.allergens) ? row.allergens : []).forEach((value) => {
          const token = normalizeToken(value);
          if (!token) return;
          allergenStatusByToken.set(token, {
            is_violation: true,
            is_cross_contamination: false,
          });
        });

        (Array.isArray(row.crossContaminationAllergens)
          ? row.crossContaminationAllergens
          : []
        ).forEach((value) => {
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
          allergenEntries.push({
            ingredient_row_id: rowId,
            allergen_id: allergenId,
            is_violation: Boolean(status.is_violation),
            is_cross_contamination: Boolean(status.is_cross_contamination),
            is_removable: Boolean(row.removable),
          });
        });

        const compatibleDietTokens = new Set(
          (Array.isArray(row.diets) ? row.diets : []).map((value) => normalizeToken(value)),
        );
        const crossDietTokens = new Set(
          (Array.isArray(row.crossContaminationDiets) ? row.crossContaminationDiets : []).map(
            (value) => normalizeToken(value),
          ),
        );

        supportedDietLabels.forEach((label) => {
          const dietId = dietIdByToken.get(normalizeToken(label));
          if (!dietId) return;

          const labelToken = normalizeToken(label);
          if (crossDietTokens.has(labelToken)) {
            dietEntries.push({
              ingredient_row_id: rowId,
              diet_id: dietId,
              is_violation: false,
              is_cross_contamination: true,
              is_removable: Boolean(row.removable),
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

      await tx.change_logs.create({
        data: {
          restaurant_id: restaurantId,
          type: "update",
          description: asText(batch?.author) || "Manager",
          changes: JSON.stringify(changePayload),
          user_email: userEmail || null,
          photos: [],
          timestamp: new Date(),
        },
      });

      await tx.$executeRawUnsafe(
        `
        UPDATE ${PENDING_SAVE_BATCH_TABLE}
        SET status = 'applied', applied_at = now(), updated_at = now()
        WHERE id = $1::uuid
      `,
        batchId,
      );

      return {
        overlays: Array.isArray(stagedOverlays) ? stagedOverlays.length : 0,
        rows: ingredientRows.length,
        allergens: allergenEntries.length,
        diets: dietEntries.length,
      };
    });

    return NextResponse.json({
      success: true,
      ...applyResult,
    });
  } catch (error) {
    const message = asText(error?.message) || "Failed to apply pending save batch.";
    const status =
      message === "Missing authorization token"
        ? 401
        : message === "Invalid user session"
          ? 401
          : message === "Not authorized"
            ? 403
            : message === "Pending save batch not found or already applied."
              ? 409
              : message === "Pending save batch is stale. Re-open save review."
              ? 409
              : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
