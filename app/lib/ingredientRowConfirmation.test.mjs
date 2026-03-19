import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIngredientConfirmationSignature,
  resetIngredientConfirmationIfChanged,
} from "./ingredientRowConfirmation.js";

test("appeal review state changes alter the ingredient confirmation signature", () => {
  const pendingSignature = buildIngredientConfirmationSignature({
    name: "Maple Syrup",
    brandRequired: true,
    confirmed: true,
    brandAppeal: {
      id: "appeal-1",
      status: "pending",
      managerMessage: "House-made syrup.",
      photoAttached: true,
      submittedAt: "2026-03-19T12:00:00.000Z",
    },
  });
  const rejectedSignature = buildIngredientConfirmationSignature({
    name: "Maple Syrup",
    brandRequired: true,
    confirmed: true,
    brandAppeal: {
      id: "appeal-1",
      status: "rejected",
      managerMessage: "House-made syrup.",
      photoAttached: true,
      submittedAt: "2026-03-19T12:00:00.000Z",
      reviewedAt: "2026-03-20T08:30:00.000Z",
      reviewedBy: "Admin",
      reviewNotes: "Need a packaged product.",
    },
  });

  assert.notEqual(pendingSignature, rejectedSignature);
});

test("resetIngredientConfirmationIfChanged clears confirmed when row-level data changes", () => {
  const previousIngredient = {
    name: "Maple Syrup",
    brandRequired: true,
    confirmed: true,
    brandAppeal: {
      id: "appeal-1",
      status: "pending",
      managerMessage: "House-made syrup.",
      photoAttached: true,
      submittedAt: "2026-03-19T12:00:00.000Z",
    },
  };
  const nextIngredient = {
    ...previousIngredient,
    brandAppeal: {
      ...previousIngredient.brandAppeal,
      status: "rejected",
      reviewedAt: "2026-03-20T08:30:00.000Z",
      reviewedBy: "Admin",
    },
  };

  assert.equal(
    resetIngredientConfirmationIfChanged(previousIngredient, nextIngredient).confirmed,
    false,
  );
});

test("resetIngredientConfirmationIfChanged ignores confirmed-only toggles", () => {
  const ingredient = {
    name: "Honey",
    allergens: ["Milk"],
    diets: ["Vegetarian"],
    confirmed: true,
  };

  assert.equal(
    resetIngredientConfirmationIfChanged(ingredient, {
      ...ingredient,
      confirmed: false,
    }).confirmed,
    false,
  );
  assert.equal(
    resetIngredientConfirmationIfChanged(
      {
        ...ingredient,
        confirmed: false,
      },
      ingredient,
    ).confirmed,
    true,
  );
});
