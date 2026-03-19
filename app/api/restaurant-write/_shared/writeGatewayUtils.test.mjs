import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIngredientRowsFromOverlays,
  buildMenuDishRowsFromOverlays,
  normalizeOperationPayload,
  reconcileBaseOverlaysWithBaselineKeys,
  RESTAURANT_WRITE_OPERATION_TYPES,
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

test("menu review rows enumerate brand removal and related ingredient row writes", () => {
  const baselineOverlays = [
    {
      overlayKey: "ov-1",
      id: "Grilled Tofu",
      name: "Grilled Tofu",
      pageIndex: 0,
      x: 1,
      y: 2,
      w: 30,
      h: 10,
      ingredients: [
        {
          name: "Honey",
          allergens: ["Milk"],
          diets: ["Vegetarian"],
          brands: [{ name: "Local Honey" }],
          appliedBrandItem: "Local Honey",
          brandRequired: false,
          brandRequirementReason: "",
          removable: false,
          confirmed: true,
        },
      ],
    },
  ];
  const overlays = [
    {
      overlayKey: "ov-1",
      id: "Grilled Tofu",
      name: "Grilled Tofu",
      pageIndex: 0,
      x: 1,
      y: 2,
      w: 30,
      h: 10,
      ingredients: [
        {
          name: "Honey",
          allergens: [],
          diets: [],
          brands: [],
          brandRequired: true,
          brandRequirementReason: "Ingredient must match packaged label",
          removable: false,
          confirmed: false,
        },
      ],
    },
  ];

  const payload = normalizeOperationPayload({
    operationType: RESTAURANT_WRITE_OPERATION_TYPES.MENU_STATE_REPLACE,
    operationPayload: {
      baselineOverlays,
      overlays,
      changedFields: ["overlays"],
    },
  });

  assert.deepEqual(
    payload.rows.map((row) => row.summary),
    [
      "Grilled Tofu: Removed brand item assignment from Honey",
      "Grilled Tofu: Updated allergen selections for Honey",
      "Grilled Tofu: Updated diet selections for Honey",
      "Grilled Tofu: Honey now requires brand assignment",
      "Grilled Tofu: Marked Honey unconfirmed",
    ],
  );

  const brandRow = payload.rows.find((row) => row.fieldKey === "appliedBrandItem");
  assert.ok(brandRow);
  assert.equal(brandRow.beforeValue, "Applied brand item: Local Honey");
  assert.equal(brandRow.afterValue, "Applied brand item: none");

  const requirementRow = payload.rows.find((row) => row.fieldKey === "brandRequired");
  assert.ok(requirementRow);
  assert.match(requirementRow.afterValue, /Brand assignment required: yes/);
  assert.match(requirementRow.afterValue, /Reason: Ingredient must match packaged label/);

  assert.ok(
    !payload.rows.some((row) => row.summary === "Grilled Tofu: Changes to Honey"),
  );
});
