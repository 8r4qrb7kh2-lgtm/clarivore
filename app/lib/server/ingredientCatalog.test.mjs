import assert from "node:assert/strict";
import test from "node:test";

import { isSafeIngredientCatalogEntry } from "./ingredientCatalog.js";

const SUPPORTED_DIETS = [
  "Vegan",
  "Vegetarian",
  "Pescatarian",
  "Gluten-free",
];

function createSafeCatalogEntry(overrides = {}) {
  const metadata = {
    catalog_type: "safe_only",
    supported_diets: [...SUPPORTED_DIETS],
    ...(overrides.metadata && typeof overrides.metadata === "object"
      ? overrides.metadata
      : {}),
  };

  return {
    canonicalName: "salt",
    normalizedName: "salt",
    aliases: ["salt"],
    lookupTerms: ["salt"],
    allergens: [],
    diets: [...SUPPORTED_DIETS],
    isReady: true,
    seedSource: "openfoodfacts_safe_only_v1",
    metadata,
    ...overrides,
  };
}

test("isSafeIngredientCatalogEntry rejects punctuation-tainted nut rows", () => {
  const row = createSafeCatalogEntry({
    canonicalName: "hazelnuts +",
    normalizedName: "hazelnuts",
    aliases: ["hazelnuts*+"],
    lookupTerms: ["hazelnuts"],
    metadata: {
      surface_forms: [{ name: "hazelnuts*+", count: 3 }],
    },
  });

  assert.equal(isSafeIngredientCatalogEntry(row), false);
});

test("isSafeIngredientCatalogEntry rejects compacted allergen and animal rows", () => {
  const unsafeRows = [
    createSafeCatalogEntry({
      canonicalName: "eggwhite",
      normalizedName: "eggwhite",
      aliases: ["eggwhite"],
      lookupTerms: ["eggwhite"],
    }),
    createSafeCatalogEntry({
      canonicalName: "wheatflour",
      normalizedName: "wheatflour",
      aliases: ["wheatflour"],
      lookupTerms: ["wheatflour"],
    }),
    createSafeCatalogEntry({
      canonicalName: "almondmilk",
      normalizedName: "almondmilk",
      aliases: ["almondmilk"],
      lookupTerms: ["almondmilk"],
    }),
    createSafeCatalogEntry({
      canonicalName: "catfish",
      normalizedName: "catfish",
      aliases: ["catfish"],
      lookupTerms: ["catfish"],
    }),
    createSafeCatalogEntry({
      canonicalName: "crabmeat",
      normalizedName: "crabmeat",
      aliases: ["crabmeat"],
      lookupTerms: ["crabmeat"],
    }),
  ];

  unsafeRows.forEach((row) => {
    assert.equal(isSafeIngredientCatalogEntry(row), false, row.canonicalName);
  });
});

test("isSafeIngredientCatalogEntry preserves known safe exceptions", () => {
  const safeRows = [
    createSafeCatalogEntry({
      canonicalName: "cream of tartar",
      normalizedName: "cream of tartar",
      aliases: ["cream of tartar"],
      lookupTerms: ["cream of tartar"],
    }),
    createSafeCatalogEntry({
      canonicalName: "butternut squash",
      normalizedName: "butternut squash",
      aliases: ["butternut squash"],
      lookupTerms: ["butternut squash"],
    }),
    createSafeCatalogEntry({
      canonicalName: "eggplant",
      normalizedName: "eggplant",
      aliases: ["eggplant"],
      lookupTerms: ["eggplant"],
    }),
    createSafeCatalogEntry({
      canonicalName: "buckwheat flour",
      normalizedName: "buckwheat flour",
      aliases: ["buckwheat flour"],
      lookupTerms: ["buckwheat flour"],
    }),
    createSafeCatalogEntry({
      canonicalName: "oat milk",
      normalizedName: "oat milk",
      aliases: ["oat milk"],
      lookupTerms: ["oat milk"],
    }),
    createSafeCatalogEntry({
      canonicalName: "sunflower butter",
      normalizedName: "sunflower butter",
      aliases: ["sunflower butter"],
      lookupTerms: ["sunflower butter"],
    }),
    createSafeCatalogEntry({
      canonicalName: "cocoa butter",
      normalizedName: "cocoa butter",
      aliases: ["cocoa butter"],
      lookupTerms: ["cocoa butter"],
    }),
  ];

  safeRows.forEach((row) => {
    assert.equal(isSafeIngredientCatalogEntry(row), true, row.canonicalName);
  });
});
