import {
  buildRestaurantMenuStateMapFromRows,
  getEmptyRestaurantMenuState,
  mergeRestaurantWithMenuState,
} from "./restaurantMenuStateRows";

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

export async function fetchRestaurantMenuStateMapFromTables(supabaseClient, restaurantIds) {
  if (!supabaseClient) {
    throw new Error("Supabase env vars are missing.");
  }

  const ids = normalizeRestaurantIds(restaurantIds);
  if (!ids.length) return new Map();

  const [pagesResult, dishesResult, ingredientRowsResult, brandItemsResult] = await Promise.all([
    supabaseClient
      .from("restaurant_menu_pages")
      .select("restaurant_id,page_index,image_url")
      .in("restaurant_id", ids),
    supabaseClient
      .from("restaurant_menu_dishes")
      .select(
        "id,restaurant_id,dish_key,dish_name,page_index,x,y,w,h,dish_text,description,details_json,allergens,diets,cross_contamination_allergens,cross_contamination_diets,removable_json,ingredients_blocking_diets_json,payload_json",
      )
      .in("restaurant_id", ids),
    supabaseClient
      .from("restaurant_menu_ingredient_rows")
      .select("id,restaurant_id,dish_id,dish_name,row_index,row_text,applied_brand_item,ingredient_payload")
      .in("restaurant_id", ids),
    supabaseClient
      .from("restaurant_menu_ingredient_brand_items")
      .select(
        "restaurant_id,ingredient_row_id,dish_name,row_index,brand_name,barcode,brand_image,ingredients_image,image,ingredient_list,ingredients_list,allergens,cross_contamination_allergens,diets,cross_contamination_diets,brand_payload",
      )
      .in("restaurant_id", ids),
  ]);

  if (pagesResult.error) throw pagesResult.error;
  if (dishesResult.error) throw dishesResult.error;
  if (ingredientRowsResult.error) throw ingredientRowsResult.error;
  if (brandItemsResult.error) throw brandItemsResult.error;

  return buildRestaurantMenuStateMapFromRows({
    menuPageRows: Array.isArray(pagesResult.data) ? pagesResult.data : [],
    menuDishRows: Array.isArray(dishesResult.data) ? dishesResult.data : [],
    ingredientRows: Array.isArray(ingredientRowsResult.data)
      ? ingredientRowsResult.data
      : [],
    brandRows: Array.isArray(brandItemsResult.data) ? brandItemsResult.data : [],
  });
}

export async function hydrateRestaurantsWithTableMenuState(supabaseClient, restaurantRows) {
  const rows = Array.isArray(restaurantRows) ? restaurantRows : [];
  if (!rows.length) return [];

  const ids = rows
    .map((row) => asText(row?.id))
    .filter(Boolean);
  const stateByRestaurantId = await fetchRestaurantMenuStateMapFromTables(
    supabaseClient,
    ids,
  );

  return rows.map((row) => {
    const restaurantId = asText(row?.id);
    const menuState = stateByRestaurantId.get(restaurantId) || getEmptyRestaurantMenuState();
    return mergeRestaurantWithMenuState(row, menuState);
  });
}

export async function hydrateRestaurantWithTableMenuState(supabaseClient, restaurantRow) {
  if (!restaurantRow || typeof restaurantRow !== "object") return null;

  const restaurantId = asText(restaurantRow?.id);
  if (!restaurantId) {
    return mergeRestaurantWithMenuState(restaurantRow, getEmptyRestaurantMenuState());
  }

  const stateByRestaurantId = await fetchRestaurantMenuStateMapFromTables(
    supabaseClient,
    [restaurantId],
  );

  return mergeRestaurantWithMenuState(
    restaurantRow,
    stateByRestaurantId.get(restaurantId) || getEmptyRestaurantMenuState(),
  );
}
