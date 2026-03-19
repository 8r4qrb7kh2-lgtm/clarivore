import assert from "node:assert/strict";
import test from "node:test";

import { mergeAppealPendingMap } from "./appealPendingState.js";

test("mergeAppealPendingMap preserves locally submitted pending rows", () => {
  const ingredients = [
    {
      name: "extra-firm tofu",
      brandAppeal: {
        id: "appeal-1",
        status: "pending",
      },
    },
    {
      name: "soy sauce",
    },
    {
      name: "sesame oil",
    },
  ];

  assert.deepEqual(mergeAppealPendingMap({ 2: true, 7: true }, ingredients), {
    0: true,
    2: true,
  });
});
