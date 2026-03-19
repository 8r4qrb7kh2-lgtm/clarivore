import assert from "node:assert/strict";
import test from "node:test";

import {
  formatIngredientBrandAppealSnapshot,
  normalizeIngredientBrandAppeal,
  parseIngredientBrandAppealSnapshot,
} from "./ingredientBrandAppeal.js";

test("parseIngredientBrandAppealSnapshot round-trips formatted appeal snapshots", () => {
  const appeal = normalizeIngredientBrandAppeal({
    id: "appeal-1",
    review_status: "approved",
    manager_message: "This is house-made.",
    photo_url: "https://example.com/photo.jpg",
    submitted_at: "2026-03-19T12:00:00.000Z",
    reviewed_at: "2026-03-20T08:30:00.000Z",
    reviewed_by: "Admin Reviewer",
    review_notes: "Approved because no packaged product is used.",
  });

  assert.deepEqual(parseIngredientBrandAppealSnapshot(formatIngredientBrandAppealSnapshot(appeal)), {
    id: "",
    status: "approved",
    managerMessage: "This is house-made.",
    reviewNotes: "Approved because no packaged product is used.",
    photoUrl: "",
    photoAttached: true,
    submittedAt: "2026-03-19T12:00:00.000Z",
    reviewedAt: "2026-03-20T08:30:00.000Z",
    reviewedBy: "Admin Reviewer",
  });
});

test("parseIngredientBrandAppealSnapshot returns null for empty snapshots", () => {
  assert.equal(parseIngredientBrandAppealSnapshot("Brand assignment appeal: none"), null);
  assert.equal(parseIngredientBrandAppealSnapshot(""), null);
});
