import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOverlayPublicationSummary,
  filterPublishedOverlays,
  getOverlayPublicationState,
  readOverlayIngredientRows,
} from "./overlayPublication.js";

test("readOverlayIngredientRows falls back to aiIngredients JSON", () => {
  const rows = readOverlayIngredientRows({
    aiIngredients: JSON.stringify([
      { name: "Soy sauce", confirmed: true },
      { name: "Sesame oil", confirmed: false },
    ]),
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.name, "Soy sauce");
  assert.equal(rows[1]?.confirmed, false);
});

test("getOverlayPublicationState treats overlays with an explicit unconfirmed row as unpublished", () => {
  const state = getOverlayPublicationState({
    ingredients: [
      { name: "Tofu", confirmed: true },
      { name: "Sauce", confirmed: false },
    ],
  });

  assert.equal(state.totalIngredientRows, 2);
  assert.equal(state.unconfirmedIngredientRows, 1);
  assert.equal(state.isPublished, false);
});

test("getOverlayPublicationState keeps legacy rows without a confirmed flag published", () => {
  const state = getOverlayPublicationState({
    ingredients: [
      { name: "Tofu", confirmed: true },
      { name: "Sauce" },
    ],
  });

  assert.equal(state.totalIngredientRows, 2);
  assert.equal(state.unconfirmedIngredientRows, 0);
  assert.equal(state.isPublished, true);
});

test("filterPublishedOverlays and buildOverlayPublicationSummary stay in sync", () => {
  const overlays = [
    {
      id: "Published dish",
      ingredients: [{ name: "Tofu", confirmed: true }],
    },
    {
      id: "Unpublished dish",
      ingredients: [{ name: "Sauce", confirmed: false }],
    },
    {
      id: "Legacy dish",
      ingredients: [{ name: "Rice" }],
    },
  ];

  const published = filterPublishedOverlays(overlays);
  const summary = buildOverlayPublicationSummary(overlays);

  assert.deepEqual(
    published.map((overlay) => overlay.id),
    ["Published dish", "Legacy dish"],
  );
  assert.deepEqual(summary, {
    totalOverlayCount: 3,
    publishedOverlayCount: 2,
    unpublishedOverlayCount: 1,
  });
});
