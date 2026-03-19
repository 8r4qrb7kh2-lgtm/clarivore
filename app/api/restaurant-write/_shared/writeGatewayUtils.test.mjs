import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIngredientRowsFromOverlays,
  buildMenuDishRowsFromOverlays,
  reconcileBaseOverlaysWithBaselineKeys,
} from "./writeGatewayUtils.js";
import { buildRestaurantMenuStateMapFromRows } from "../../../lib/restaurantMenuStateRows.js";

test("menu write rows use stable overlay keys even when dish names collide", () => {
  const overlays = [
    {
      overlayKey: "ov-1",
      id: "Shared Dish",
      name: "Shared Dish",
      pageIndex: 0,
      x: 1,
      y: 2,
      w: 30,
      h: 10,
      ingredients: [{ name: "Tofu" }],
    },
    {
      overlayKey: "ov-2",
      id: "Shared Dish",
      name: "Shared Dish",
      pageIndex: 0,
      x: 10,
      y: 12,
      w: 30,
      h: 10,
      ingredients: [{ name: "Tomato" }],
    },
  ];

  const dishRows = buildMenuDishRowsFromOverlays(overlays);
  const ingredientRows = buildIngredientRowsFromOverlays(overlays);

  assert.deepEqual(
    dishRows.map((row) => row.dishKey),
    ["ov1", "ov2"],
  );
  assert.deepEqual(
    ingredientRows.map((row) => row.dishKey),
    ["ov1", "ov2"],
  );
});

test("menu state hydration restores overlay keys from stored dish keys", () => {
  const stateByRestaurantId = buildRestaurantMenuStateMapFromRows({
    menuPageRows: [
      {
        restaurant_id: "restaurant-1",
        page_index: 0,
        image_url: "",
      },
    ],
    menuDishRows: [
      {
        id: "dish-1",
        restaurant_id: "restaurant-1",
        dish_key: "ov123",
        dish_name: "Grilled Tofu",
        page_index: 0,
        x: 1,
        y: 2,
        w: 25,
        h: 10,
        payload_json: {},
      },
    ],
    ingredientRows: [],
    brandRows: [],
  });

  const overlay = stateByRestaurantId.get("restaurant-1")?.overlays?.[0] || null;
  assert.ok(overlay);
  assert.equal(overlay.overlayKey, "ov123");
  assert.equal(overlay.name, "Grilled Tofu");
});

test("legacy baseline overlays can remap stored rows onto staged overlay keys", () => {
  const baseOverlays = [
    {
      id: "Grilled Tofu",
      name: "Grilled Tofu",
      pageIndex: 0,
      x: 1,
      y: 2,
      w: 30,
      h: 10,
      ingredients: [{ name: "Tofu" }],
    },
  ];
  const baselineOverlays = [
    {
      overlayKey: "ov-legacy-1",
      id: "Grilled Tofu",
      name: "Grilled Tofu",
      pageIndex: 0,
      x: 1,
      y: 2,
      w: 30,
      h: 10,
      ingredients: [{ name: "Tofu" }],
    },
  ];

  const reconciled = reconcileBaseOverlaysWithBaselineKeys({
    baseOverlays,
    baselineOverlays,
  });

  assert.equal(reconciled[0]?.overlayKey, "ov-legacy-1");
  assert.deepEqual(
    buildMenuDishRowsFromOverlays(reconciled).map((row) => row.dishKey),
    ["ovlegacy1"],
  );
});
