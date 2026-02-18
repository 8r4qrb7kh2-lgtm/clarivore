import {
  buildRestaurantMenuStateMapFromRows,
  getEmptyRestaurantMenuState,
  mergeRestaurantWithMenuState,
} from "../restaurantMenuStateRows.js";

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeRestaurantIds(restaurantIds) {
  const seen = new Set();
  const output = [];
  (Array.isArray(restaurantIds) ? restaurantIds : []).forEach((value) => {
    const id = asText(value);
    if (!id || seen.has(id)) return;
    seen.add(id);
    output.push(id);
  });
  return output;
}

export async function fetchRestaurantMenuStateMapFromTablesWithPrisma(
  prismaClient,
  restaurantIds,
) {
  if (!prismaClient) {
    throw new Error("Prisma client is required.");
  }

  const ids = normalizeRestaurantIds(restaurantIds);
  if (!ids.length) return new Map();

  const [menuPageRows, menuDishRows, ingredientRows, brandRows] = await Promise.all([
    prismaClient.restaurant_menu_pages.findMany({
      where: { restaurant_id: { in: ids } },
      select: {
        restaurant_id: true,
        page_index: true,
        image_url: true,
      },
    }),
    prismaClient.restaurant_menu_dishes.findMany({
      where: { restaurant_id: { in: ids } },
      select: {
        id: true,
        restaurant_id: true,
        dish_key: true,
        dish_name: true,
        page_index: true,
        x: true,
        y: true,
        w: true,
        h: true,
        dish_text: true,
        description: true,
        details_json: true,
        allergens: true,
        diets: true,
        cross_contamination_allergens: true,
        cross_contamination_diets: true,
        removable_json: true,
        ingredients_blocking_diets_json: true,
        payload_json: true,
      },
    }),
    prismaClient.restaurant_menu_ingredient_rows.findMany({
      where: { restaurant_id: { in: ids } },
      select: {
        id: true,
        restaurant_id: true,
        dish_id: true,
        dish_name: true,
        row_index: true,
        row_text: true,
        applied_brand_item: true,
        ingredient_payload: true,
      },
    }),
    prismaClient.restaurant_menu_ingredient_brand_items.findMany({
      where: { restaurant_id: { in: ids } },
      select: {
        restaurant_id: true,
        ingredient_row_id: true,
        dish_name: true,
        row_index: true,
        brand_name: true,
        barcode: true,
        brand_image: true,
        ingredients_image: true,
        image: true,
        ingredient_list: true,
        ingredients_list: true,
        allergens: true,
        cross_contamination_allergens: true,
        diets: true,
        cross_contamination_diets: true,
        brand_payload: true,
      },
    }),
  ]);

  return buildRestaurantMenuStateMapFromRows({
    menuPageRows,
    menuDishRows,
    ingredientRows,
    brandRows,
  });
}

export async function fetchRestaurantMenuStateFromTablesWithPrisma(
  prismaClient,
  restaurantId,
) {
  const id = asText(restaurantId);
  if (!id) return getEmptyRestaurantMenuState();

  const map = await fetchRestaurantMenuStateMapFromTablesWithPrisma(
    prismaClient,
    [id],
  );
  return map.get(id) || getEmptyRestaurantMenuState();
}

export async function hydrateRestaurantsWithTableMenuStateFromPrisma(
  prismaClient,
  restaurantRows,
) {
  const rows = Array.isArray(restaurantRows) ? restaurantRows : [];
  if (!rows.length) return [];

  const ids = rows
    .map((row) => asText(row?.id))
    .filter(Boolean);

  const stateByRestaurantId = await fetchRestaurantMenuStateMapFromTablesWithPrisma(
    prismaClient,
    ids,
  );

  return rows.map((row) => {
    const id = asText(row?.id);
    return mergeRestaurantWithMenuState(
      row,
      stateByRestaurantId.get(id) || getEmptyRestaurantMenuState(),
    );
  });
}
