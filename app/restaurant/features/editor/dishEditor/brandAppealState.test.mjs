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
      review_status: "PENDING",
      manager_message: "Pure maple syrup should not require a scan.",
      photo_url: "https://example.com/photo.jpg",
      photo_attached: true,
      submitted_at: "2026-03-19T12:00:00.000Z",
      reviewed_at: "2026-03-20T08:30:00.000Z",
      review_notes: "Approved because this is house-made.",
      reviewed_by: "Admin Reviewer",
    }),
    {
      id: "appeal-1",
      status: "pending",
      managerMessage: "Pure maple syrup should not require a scan.",
      reviewNotes: "Approved because this is house-made.",
      photoUrl: "https://example.com/photo.jpg",
      photoAttached: true,
      submittedAt: "2026-03-19T12:00:00.000Z",
      reviewedAt: "2026-03-20T08:30:00.000Z",
      reviewedBy: "Admin Reviewer",
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
      reviewNotes: "",
      photoUrl: "",
      photoAttached: true,
      submittedAt: "",
      reviewedAt: "",
      reviewedBy: "",
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
    reviewNotes: "",
    photoUrl: "",
    photoAttached: true,
    submittedAt: "",
    reviewedAt: "",
    reviewedBy: "",
  });
  assert.equal(isIngredientBrandAppealPending(withAppeal), true);

  const cleared = clearIngredientBrandAppeal(withAppeal);
  assert.equal("brandAppeal" in cleared, false);
  assert.equal(isIngredientBrandAppealPending(cleared), false);
});
