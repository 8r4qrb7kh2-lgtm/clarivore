import assert from "node:assert/strict";
import test from "node:test";

import { applyCommittedIngredientAppealToOverlays } from "./committedIngredientAppealSync.js";

test("applyCommittedIngredientAppealToOverlays applies the appeal to matching ingredient rows only", () => {
  const input = [
    {
      id: "Grilled Tofu",
      ingredients: [
        { name: "extra-firm tofu" },
        { name: "soy sauce" },
      ],
    },
    {
      id: "Soup",
      ingredients: [{ name: "extra-firm tofu" }],
    },
  ];

  const result = applyCommittedIngredientAppealToOverlays({
    overlays: input,
    dishName: "Grilled Tofu",
    ingredientName: "extra-firm tofu",
    appeal: {
      id: "appeal-1",
      status: "pending",
      managerMessage: "House-made ingredient.",
      photoAttached: true,
    },
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.overlays[0].ingredients[0].brandAppeal, {
    id: "appeal-1",
    status: "pending",
    managerMessage: "House-made ingredient.",
    reviewNotes: "",
    photoUrl: "",
    photoDataUrl: "",
    photoAttached: true,
    submittedAt: "",
    reviewedAt: "",
    reviewedBy: "",
  });
  assert.equal(result.overlays[0].ingredients[1].brandAppeal, undefined);
  assert.equal(result.overlays[1].ingredients[0].brandAppeal, undefined);
});
