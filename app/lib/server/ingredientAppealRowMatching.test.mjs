import assert from "node:assert/strict";
import test from "node:test";

import { selectIngredientRowsForAppeal } from "./ingredientAppealRowMatching.js";

const SAMPLE_ROWS = [
  {
    id: "row-1",
    dish_name: "Pizza",
    row_text: "Mozzarella",
    ingredient_payload: { name: "Mozzarella" },
  },
  {
    id: "row-2",
    dish_name: "Pizza",
    row_text: "Tomato Sauce",
    ingredient_payload: { name: "Tomato Sauce" },
  },
  {
    id: "row-3",
    dish_name: "Soup",
    row_text: "Broth",
    ingredient_payload: { name: "Broth" },
  },
];

test("selectIngredientRowsForAppeal matches the exact dish and ingredient", () => {
  const matches = selectIngredientRowsForAppeal({
    rows: SAMPLE_ROWS,
    dishName: "Pizza",
    ingredientName: "Mozzarella",
  });

  assert.deepEqual(matches.map((row) => row.id), ["row-1"]);
});

test("selectIngredientRowsForAppeal does not fall back to other dish rows", () => {
  const matches = selectIngredientRowsForAppeal({
    rows: SAMPLE_ROWS,
    dishName: "Pizza",
    ingredientName: "Broth",
  });

  assert.deepEqual(matches, []);
});
