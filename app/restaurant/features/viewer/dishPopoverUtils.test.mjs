import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDishIngredientParagraph,
  computeMobileDishPanelMaxHeight,
} from "./dishPopoverUtils.js";

test("buildDishIngredientParagraph formats ingredient rows with applied brand ingredients", () => {
  const paragraph = buildDishIngredientParagraph({
    ingredients: [
      {
        name: "Extra-firm tofu",
        brands: [
          {
            name: "House Tofu",
            ingredientsList: ["Ingredients: Soybeans", "Water", "Calcium sulfate"],
          },
        ],
        appliedBrandItem: "House Tofu",
      },
      {
        name: "Sesame oil",
        brands: [
          {
            name: "Toasted Sesame Oil",
            ingredientList: "Ingredients: Sesame seed oil",
          },
        ],
      },
      {
        name: "Green onions",
      },
    ],
  });

  assert.equal(
    paragraph,
    "Extra-firm tofu (Soybeans, Water, Calcium sulfate), Sesame oil (Sesame seed oil), Green onions",
  );
});

test("buildDishIngredientParagraph prefers the applied brand when multiple brand rows exist", () => {
  const paragraph = buildDishIngredientParagraph({
    ingredients: [
      {
        name: "Soy sauce",
        brands: [
          {
            name: "Brand A",
            ingredientList: "Water, soybeans",
          },
          {
            name: "Brand B",
            ingredientList: "Water, soybeans, wheat, salt",
          },
        ],
        appliedBrandItem: "Brand B",
      },
    ],
  });

  assert.equal(paragraph, "Soy sauce (Water, soybeans, wheat, salt)");
});

test("buildDishIngredientParagraph falls back to the stored ingredient summary", () => {
  const paragraph = buildDishIngredientParagraph({
    details: {
      __ingredientsSummary: "Olive oil;\nGarlic; Crushed tomatoes",
    },
  });

  assert.equal(paragraph, "Olive oil, Garlic, Crushed tomatoes");
});

test("computeMobileDishPanelMaxHeight keeps the default height when the overlay is clear", () => {
  assert.equal(
    computeMobileDishPanelMaxHeight({
      viewportHeight: 844,
      overlayBottom: 430,
      defaultMaxHeight: 300,
      minimumHeight: 120,
      gap: 12,
    }),
    300,
  );
});

test("computeMobileDishPanelMaxHeight shrinks the panel when the overlay is near the bottom", () => {
  assert.equal(
    computeMobileDishPanelMaxHeight({
      viewportHeight: 844,
      overlayBottom: 700,
      defaultMaxHeight: 300,
      minimumHeight: 120,
      gap: 12,
    }),
    132,
  );
});

test("computeMobileDishPanelMaxHeight respects the configured minimum height", () => {
  assert.equal(
    computeMobileDishPanelMaxHeight({
      viewportHeight: 700,
      overlayBottom: 670,
      defaultMaxHeight: 240,
      minimumHeight: 96,
      hardMinimumHeight: 80,
      gap: 12,
    }),
    80,
  );
});

test("computeMobileDishPanelMaxHeight can dip below the preferred minimum when needed", () => {
  assert.equal(
    computeMobileDishPanelMaxHeight({
      viewportHeight: 520,
      overlayBottom: 424.90625,
      defaultMaxHeight: 215.594,
      minimumHeight: 96,
      hardMinimumHeight: 80,
      gap: 12,
    }),
    83.09375,
  );
});
