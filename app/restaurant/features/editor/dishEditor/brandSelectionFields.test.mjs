import assert from "node:assert/strict";
import test from "node:test";

import {
  applyIngredientBrandSelectionFields,
  clearIngredientBrandSelectionFields,
} from "./brandSelectionFields.js";

test("clearIngredientBrandSelectionFields removes persisted selected-brand fields", () => {
  const cleared = clearIngredientBrandSelectionFields({
    name: "Maple Syrup",
    appliedBrandItem: "Old Brand",
    appliedBrand: "Old Brand",
    brandName: "Old Brand",
    barcode: "12345",
    brandImage: "brand-image",
    ingredientsImage: "ingredients-image",
    image: "image",
    ingredientList: "maple syrup",
    ingredientsList: ["maple syrup"],
    parsedIngredientsList: ["maple syrup"],
    brands: [{ name: "Old Brand" }],
  });

  assert.deepEqual(cleared.brands, []);
  assert.equal("appliedBrandItem" in cleared, false);
  assert.equal("appliedBrand" in cleared, false);
  assert.equal("brandName" in cleared, false);
  assert.equal("barcode" in cleared, false);
  assert.equal("brandImage" in cleared, false);
  assert.equal("ingredientsImage" in cleared, false);
  assert.equal("image" in cleared, false);
  assert.equal("ingredientList" in cleared, false);
  assert.equal("ingredientsList" in cleared, false);
  assert.equal("parsedIngredientsList" in cleared, false);
  assert.equal(cleared.name, "Maple Syrup");
});

test("applyIngredientBrandSelectionFields synchronizes direct selected-brand fields", () => {
  const updated = applyIngredientBrandSelectionFields(
    {
      name: "Maple Syrup",
      appliedBrandItem: "Old Brand",
      brands: [],
    },
    {
      name: "New Brand",
      barcode: "67890",
      allergens: ["Soy"],
    },
  );

  assert.equal(updated.appliedBrandItem, "New Brand");
  assert.equal(updated.appliedBrand, "New Brand");
  assert.equal(updated.brandName, "New Brand");
  assert.equal(updated.barcode, "67890");
  assert.deepEqual(updated.brands, [
    {
      name: "New Brand",
      barcode: "67890",
      allergens: ["Soy"],
    },
  ]);
});
