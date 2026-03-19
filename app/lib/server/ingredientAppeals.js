import { normalizeIngredientBrandAppeal } from "../ingredientBrandAppeal.js";

function asText(value) {
  return String(value ?? "").trim();
}

function toTimestamp(value) {
  const parsed = Date.parse(asText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortAppealsNewestFirst(left, right) {
  const leftTimestamp = Math.max(
    toTimestamp(left?.submitted_at),
    toTimestamp(left?.reviewed_at),
    toTimestamp(left?.updated_at),
  );
  const rightTimestamp = Math.max(
    toTimestamp(right?.submitted_at),
    toTimestamp(right?.reviewed_at),
    toTimestamp(right?.updated_at),
  );
  return rightTimestamp - leftTimestamp;
}

function buildCurrentAppealEntry(row) {
  const payload =
    row?.ingredient_payload && typeof row.ingredient_payload === "object"
      ? row.ingredient_payload
      : {};
  const appeal = normalizeIngredientBrandAppeal(payload.brandAppeal);
  if (!appeal) return null;

  const ingredientRowId = asText(row?.id);
  const submittedAt = asText(appeal.submittedAt || row?.updated_at);

  return {
    id: asText(appeal.id || ingredientRowId),
    appeal_id: asText(appeal.id || ingredientRowId),
    ingredient_row_id: ingredientRowId,
    restaurant_id: asText(row?.restaurant_id),
    dish_name: asText(row?.dish_name),
    row_index: Number.isFinite(Number(row?.row_index))
      ? Math.max(Math.floor(Number(row.row_index)), 0)
      : 0,
    ingredient_name: asText(payload.name || row?.row_text),
    submitted_at: submittedAt,
    review_status: asText(appeal.status || "pending"),
    reviewed_at: asText(appeal.reviewedAt),
    reviewed_by: asText(appeal.reviewedBy),
    manager_message: asText(appeal.managerMessage),
    photo_url: asText(appeal.photoUrl),
    photo_data_url: asText(appeal.photoDataUrl),
    review_notes: asText(appeal.reviewNotes),
    restaurants: null,
    reviewable: true,
    history_only: false,
    updated_at: asText(row?.updated_at),
  };
}

export async function listIngredientAppealsForAdmin(dbClient, options = {}) {
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Math.min(Math.floor(Number(options.limit)), 500))
    : 200;

  const rowResults = await dbClient.$queryRawUnsafe(
    `
      SELECT id, restaurant_id, dish_name, row_index, row_text, ingredient_payload, updated_at
      FROM public.restaurant_menu_ingredient_rows
      WHERE ingredient_payload -> 'brandAppeal' IS NOT NULL
      ORDER BY updated_at DESC, row_index ASC
    `,
  );

  const appeals = (Array.isArray(rowResults) ? rowResults : [])
    .map((row) => buildCurrentAppealEntry(row))
    .filter(Boolean)
    .sort(sortAppealsNewestFirst)
    .slice(0, limit);

  const restaurantIds = Array.from(
    new Set(appeals.map((entry) => asText(entry.restaurant_id)).filter(Boolean)),
  );
  const restaurantLookup = new Map();
  if (restaurantIds.length) {
    const restaurants = await dbClient.restaurants.findMany({
      where: { id: { in: restaurantIds } },
      select: { id: true, name: true, slug: true },
    });
    (Array.isArray(restaurants) ? restaurants : []).forEach((restaurant) => {
      restaurantLookup.set(asText(restaurant.id), restaurant);
    });
  }

  return appeals.map((entry) => ({
    ...entry,
    restaurants: restaurantLookup.get(asText(entry.restaurant_id)) || null,
  }));
}

export async function loadIngredientAppealRowsById(dbClient, appealId) {
  const safeAppealId = asText(appealId);
  if (!safeAppealId) return [];

  return await dbClient.$queryRawUnsafe(
    `
      SELECT id, restaurant_id, dish_name, row_index, row_text, ingredient_payload
      FROM public.restaurant_menu_ingredient_rows
      WHERE (
        ingredient_payload -> 'brandAppeal' ->> 'id' = $1
        OR (
          ingredient_payload -> 'brandAppeal' IS NOT NULL
          AND COALESCE(ingredient_payload -> 'brandAppeal' ->> 'id', '') = ''
          AND id::text = $1
        )
      )
      ORDER BY row_index ASC
    `,
    safeAppealId,
  );
}
