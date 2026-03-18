import assert from "node:assert/strict";
import test from "node:test";

import {
  pruneCrossSelections,
  reduceIngredientFlagSelections,
} from "./ingredientFlagReducer.js";

test("pruneCrossSelections drops weaker cross-contamination matches when contains exists", () => {
  assert.deepEqual(
    pruneCrossSelections(
      ["Vegan", "Milk", "Gluten-free"],
      ["vegan", "Egg", "gluten free", "Soy"],
    ),
    ["Egg", "Soy"],
  );
});

test("reduceIngredientFlagSelections keeps contains precedence for overlapping diets and allergens", () => {
  const reduced = reduceIngredientFlagSelections([
    {
      allergens: ["Milk"],
      diets: ["Vegan"],
      risk_type: "contained",
    },
    {
      allergens: ["Egg"],
      diets: ["Vegan"],
      risk_type: "cross-contamination",
    },
    {
      allergens: ["Wheat"],
      diets: ["Gluten-free"],
      risk_type: "contained",
    },
    {
      allergens: ["Wheat", "Soy"],
      diets: ["Gluten-free", "Vegetarian"],
      risk_type: "cross-contamination",
    },
  ]);

  assert.deepEqual(reduced, {
    containedAllergens: ["Milk", "Wheat"],
    crossContaminationAllergens: ["Egg", "Soy"],
    violatedDiets: ["Vegan", "Gluten-free"],
    crossContaminationDiets: ["Vegetarian"],
  });
});
