import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  asText,
  ensurePendingSaveTables,
  getStateHashForSave,
  normalizeIngredientRow,
  normalizeStringList,
  PENDING_SAVE_BATCH_TABLE,
  PENDING_SAVE_ROW_TABLE,
  prisma,
  readOverlayDishName,
  readOverlayIngredients,
  requireManagerSession,
  toDishKey,
  toJsonSafe,
} from "../_shared/pendingSaveUtils";

export const runtime = "nodejs";

function buildDishRowMap(overlays) {
  const dishMap = new Map();
  (Array.isArray(overlays) ? overlays : []).forEach((overlay) => {
    const dishName = readOverlayDishName(overlay);
    if (!dishName) return;

    const dishKey = toDishKey(dishName);
    const normalizedRows = readOverlayIngredients(overlay).map((row, index) =>
      normalizeIngredientRow(row, index),
    );

    const rowMap = new Map();
    normalizedRows.forEach((row, index) => {
      const safeIndex = Number.isFinite(Number(row.rowIndex))
        ? Math.max(Math.floor(Number(row.rowIndex)), 0)
        : index;
      rowMap.set(safeIndex, { ...row, rowIndex: safeIndex });
    });

    dishMap.set(dishKey, {
      dishName,
      rowMap,
      rowCount: normalizedRows.length,
    });
  });
  return dishMap;
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildChangeRows({ baselineOverlays, overlays }) {
  const baselineDishMap = buildDishRowMap(baselineOverlays);
  const currentDishMap = buildDishRowMap(overlays);
  const allDishKeys = Array.from(
    new Set([...baselineDishMap.keys(), ...currentDishMap.keys()]),
  );

  const output = [];

  allDishKeys.forEach((dishKey) => {
    const baselineDish = baselineDishMap.get(dishKey) || {
      dishName: "Dish",
      rowMap: new Map(),
      rowCount: 0,
    };
    const currentDish = currentDishMap.get(dishKey) || {
      dishName: baselineDish.dishName,
      rowMap: new Map(),
      rowCount: 0,
    };

    const dishName = asText(currentDish.dishName || baselineDish.dishName) || "Dish";
    const maxRows = Math.max(baselineDish.rowCount, currentDish.rowCount);

    for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
      const beforeRow = baselineDish.rowMap.get(rowIndex) || null;
      const afterRow = currentDish.rowMap.get(rowIndex) || null;

      if (!beforeRow && !afterRow) continue;

      if (!beforeRow && afterRow) {
        output.push({
          dishName,
          rowIndex,
          ingredientName: asText(afterRow.name) || `Ingredient ${rowIndex + 1}`,
          changeType: "ingredient_row_added",
          fieldKey: "ingredient_row",
          beforeValue: null,
          afterValue: afterRow,
          summary: `${dishName}: Added ingredient row ${asText(afterRow.name) || `Ingredient ${rowIndex + 1}`}`,
        });
        continue;
      }

      if (beforeRow && !afterRow) {
        output.push({
          dishName,
          rowIndex,
          ingredientName: asText(beforeRow.name) || `Ingredient ${rowIndex + 1}`,
          changeType: "ingredient_row_removed",
          fieldKey: "ingredient_row",
          beforeValue: beforeRow,
          afterValue: null,
          summary: `${dishName}: Removed ingredient row ${asText(beforeRow.name) || `Ingredient ${rowIndex + 1}`}`,
        });
        continue;
      }

      const ingredientName =
        asText(afterRow?.name) || asText(beforeRow?.name) || `Ingredient ${rowIndex + 1}`;

      const fieldComparisons = [
        {
          fieldKey: "name",
          changeType: "ingredient_name_changed",
          beforeValue: asText(beforeRow?.name),
          afterValue: asText(afterRow?.name),
          summary: `${dishName}: ${ingredientName}: Ingredient row name updated`,
        },
        {
          fieldKey: "allergens",
          changeType: "ingredient_allergens_changed",
          beforeValue: normalizeStringList(beforeRow?.allergens),
          afterValue: normalizeStringList(afterRow?.allergens),
          summary: `${dishName}: ${ingredientName}: Contains allergen selection updated`,
        },
        {
          fieldKey: "cross_contamination_allergens",
          changeType: "ingredient_cross_allergens_changed",
          beforeValue: normalizeStringList(beforeRow?.crossContaminationAllergens),
          afterValue: normalizeStringList(afterRow?.crossContaminationAllergens),
          summary: `${dishName}: ${ingredientName}: Cross-contamination allergen selection updated`,
        },
        {
          fieldKey: "diets",
          changeType: "ingredient_diets_changed",
          beforeValue: normalizeStringList(beforeRow?.diets),
          afterValue: normalizeStringList(afterRow?.diets),
          summary: `${dishName}: ${ingredientName}: Diet compatibility updated`,
        },
        {
          fieldKey: "cross_contamination_diets",
          changeType: "ingredient_cross_diets_changed",
          beforeValue: normalizeStringList(beforeRow?.crossContaminationDiets),
          afterValue: normalizeStringList(afterRow?.crossContaminationDiets),
          summary: `${dishName}: ${ingredientName}: Cross-contamination diet risk updated`,
        },
        {
          fieldKey: "removable",
          changeType: "ingredient_removable_changed",
          beforeValue: Boolean(beforeRow?.removable),
          afterValue: Boolean(afterRow?.removable),
          summary: `${dishName}: ${ingredientName}: Removable flag updated`,
        },
      ];

      fieldComparisons.forEach((entry) => {
        if (valuesEqual(entry.beforeValue, entry.afterValue)) return;
        output.push({
          dishName,
          rowIndex,
          ingredientName,
          changeType: entry.changeType,
          fieldKey: entry.fieldKey,
          beforeValue: entry.beforeValue,
          afterValue: entry.afterValue,
          summary: entry.summary,
        });
      });
    }
  });

  return output;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const restaurantId = asText(body?.restaurantId);
  const overlays = Array.isArray(body?.overlays) ? body.overlays : [];
  const baselineOverlays = Array.isArray(body?.baselineOverlays) ? body.baselineOverlays : [];
  const menuImage = asText(body?.menuImage);
  const menuImages = Array.isArray(body?.menuImages) ? body.menuImages.filter(Boolean) : [];
  const providedStateHash = asText(body?.stateHash);
  const author = asText(body?.author) || "Manager";
  const changePayload = toJsonSafe(body?.changePayload, {});

  if (!restaurantId) {
    return NextResponse.json({ error: "restaurantId is required" }, { status: 400 });
  }

  try {
    const { userId } = await requireManagerSession(request, restaurantId);
    await ensurePendingSaveTables(prisma);

    const stateHash = providedStateHash || getStateHashForSave({ overlays, menuImages });
    const rows = buildChangeRows({ baselineOverlays, overlays });

    const result = await prisma.$transaction(async (tx) => {
      const existingBatchRowsUnsafe = await tx.$queryRawUnsafe(
        `
        SELECT id
        FROM ${PENDING_SAVE_BATCH_TABLE}
        WHERE restaurant_id = $1::uuid
          AND created_by = $2::uuid
          AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `,
        restaurantId,
        userId,
      );

      const existingBatchId = asText(existingBatchRowsUnsafe?.[0]?.id);
      let batchId = existingBatchId;

      if (existingBatchId) {
        await tx.$executeRawUnsafe(
          `
          UPDATE ${PENDING_SAVE_BATCH_TABLE}
          SET
            author = $1,
            state_hash = $2,
            staged_overlays = $3::jsonb,
            staged_menu_image = $4,
            staged_menu_images = $5::jsonb,
            change_payload = $6::jsonb,
            row_count = $7,
            updated_at = now()
          WHERE id = $8::uuid
        `,
          author || null,
          stateHash || null,
          JSON.stringify(overlays),
          menuImage || null,
          JSON.stringify(menuImages),
          JSON.stringify(changePayload),
          rows.length,
          existingBatchId,
        );
      } else {
        batchId = randomUUID();
        await tx.$executeRawUnsafe(
          `
          INSERT INTO ${PENDING_SAVE_BATCH_TABLE}
            (id, restaurant_id, created_by, author, status, state_hash, staged_overlays, staged_menu_image, staged_menu_images, change_payload, row_count)
          VALUES
            (
              $1::uuid,
              $2::uuid,
              $3::uuid,
              $4,
              'pending',
              $5,
              $6::jsonb,
              $7,
              $8::jsonb,
              $9::jsonb,
              $10
            )
        `,
          batchId,
          restaurantId,
          userId,
          author || null,
          stateHash || null,
          JSON.stringify(overlays),
          menuImage || null,
          JSON.stringify(menuImages),
          JSON.stringify(changePayload),
          rows.length,
        );
      }

      if (!batchId) {
        throw new Error("Failed to stage pending save batch.");
      }

      await tx.$executeRawUnsafe(
        `
        DELETE FROM ${PENDING_SAVE_ROW_TABLE}
        WHERE batch_id = $1::uuid
      `,
        batchId,
      );

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        await tx.$executeRawUnsafe(
          `
          INSERT INTO ${PENDING_SAVE_ROW_TABLE}
            (id, batch_id, sort_order, dish_name, row_index, ingredient_name, change_type, field_key, before_value, after_value, summary)
          VALUES
            (
              $1::uuid,
              $2::uuid,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9::jsonb,
              $10::jsonb,
              $11
            )
        `,
          randomUUID(),
          batchId,
          index,
          row.dishName || null,
          Number.isFinite(Number(row.rowIndex)) ? Number(row.rowIndex) : null,
          row.ingredientName || null,
          row.changeType,
          row.fieldKey || null,
          JSON.stringify(toJsonSafe(row.beforeValue, null)),
          JSON.stringify(toJsonSafe(row.afterValue, null)),
          row.summary,
        );
      }

      return { batchId };
    });

    return NextResponse.json({
      success: true,
      batchId: result.batchId,
      stateHash,
      rows: rows.map((row, index) => ({
        id: `${result.batchId}:${index}`,
        sortOrder: index,
        dishName: row.dishName,
        rowIndex: row.rowIndex,
        ingredientName: row.ingredientName,
        changeType: row.changeType,
        fieldKey: row.fieldKey,
        beforeValue: row.beforeValue,
        afterValue: row.afterValue,
        summary: row.summary,
      })),
    });
  } catch (error) {
    const message = asText(error?.message) || "Failed to stage pending save.";
    const status =
      message === "Missing authorization token"
        ? 401
        : message === "Invalid user session"
          ? 401
          : message === "Not authorized"
            ? 403
            : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
