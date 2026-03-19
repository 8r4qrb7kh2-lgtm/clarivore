import assert from "node:assert/strict";
import test from "node:test";

import {
  applyIngredientBrandAppeal,
  clearIngredientBrandAppeal,
  isIngredientBrandAppealPending,
  normalizeIngredientBrandAppeal,
} from "./brandAppealState.js";

test("normalizeIngredientBrandAppeal returns null for empty values", () => {
  assert.equal(normalizeIngredientBrandAppeal(null), null);
  assert.equal(normalizeIngredientBrandAppeal({}), null);
});

test("normalizeIngredientBrandAppeal normalizes persisted appeal metadata", () => {
  assert.deepEqual(
    normalizeIngredientBrandAppeal({
      id: "appeal-1",
      reviewStatus: "PENDING",
      manager_message: "Pure maple syrup should not require a scan.",
      photo_url: "https://example.com/photo.jpg",
      submitted_at: "2026-03-19T12:00:00.000Z",
    }),
    {
      id: "appeal-1",
      status: "pending",
      managerMessage: "Pure maple syrup should not require a scan.",
      photoUrl: "https://example.com/photo.jpg",
      photoAttached: true,
      submittedAt: "2026-03-19T12:00:00.000Z",
    },
  );
});

test("normalizeIngredientBrandAppeal drops inline photo blobs while preserving attachment state", () => {
  assert.deepEqual(
    normalizeIngredientBrandAppeal({
      id: "appeal-2",
      status: "pending",
      managerMessage: "Need an exception.",
      photoUrl: "data:image/jpeg;base64,abc123",
    }),
    {
      id: "appeal-2",
      status: "pending",
      managerMessage: "Need an exception.",
      photoUrl: "",
      photoAttached: true,
      submittedAt: "",
    },
  );
});

test("apply and clear ingredient brand appeal update the ingredient payload", () => {
  const withAppeal = applyIngredientBrandAppeal(
    { name: "Maple Syrup" },
    {
      id: "appeal-1",
      status: "pending",
      managerMessage: "Pure maple syrup should not require a scan.",
      photoAttached: true,
    },
  );
  assert.deepEqual(withAppeal.brandAppeal, {
    id: "appeal-1",
    status: "pending",
    managerMessage: "Pure maple syrup should not require a scan.",
    photoUrl: "",
    photoAttached: true,
    submittedAt: "",
  });
  assert.equal(isIngredientBrandAppealPending(withAppeal), true);

  const cleared = clearIngredientBrandAppeal(withAppeal);
  assert.equal("brandAppeal" in cleared, false);
  assert.equal(isIngredientBrandAppealPending(cleared), false);
});
