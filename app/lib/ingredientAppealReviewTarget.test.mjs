import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIngredientAppealReviewTarget,
  parseIngredientAppealReviewTarget,
} from "./ingredientAppealReviewTarget.js";

test("ingredient appeal review targets prefer explicit appeal ids", () => {
  assert.equal(
    buildIngredientAppealReviewTarget({ appealId: "appeal-1", rowId: "row-1" }),
    "appeal:appeal-1",
  );
  assert.equal(
    buildIngredientAppealReviewTarget({ rowId: "row-1" }),
    "row:row-1",
  );
  assert.equal(buildIngredientAppealReviewTarget({}), "");
});

test("ingredient appeal review targets parse typed and legacy values", () => {
  assert.deepEqual(parseIngredientAppealReviewTarget("appeal:appeal-1"), {
    type: "appeal",
    value: "appeal-1",
    legacy: false,
  });
  assert.deepEqual(parseIngredientAppealReviewTarget("row:row-1"), {
    type: "row",
    value: "row-1",
    legacy: false,
  });
  assert.deepEqual(parseIngredientAppealReviewTarget("legacy-row-id"), {
    type: "appeal",
    value: "legacy-row-id",
    legacy: true,
  });
});
