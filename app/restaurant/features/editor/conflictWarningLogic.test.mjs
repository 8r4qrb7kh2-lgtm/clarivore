import assert from "node:assert/strict";
import test from "node:test";

import { buildDietAllergenConflictMessages } from "./conflictWarningLogic.js";

function runConflictMessages({
  selectedAllergenEntries,
  selectedDietEntries,
  conflictsByDiet = {},
}) {
  return buildDietAllergenConflictMessages({
    selectedAllergenEntries,
    selectedDietEntries,
    getDietAllergenConflicts: (diet) => conflictsByDiet[diet] || [],
    formatAllergenLabel: (value) => value,
    formatDietLabel: (value) => value,
  });
}

test("buildDietAllergenConflictMessages suppresses warnings when both diet and allergen are cross-contamination only", () => {
  const messages = runConflictMessages({
    selectedAllergenEntries: [{ token: "Milk", state: "cross" }],
    selectedDietEntries: [{ token: "Vegan", state: "cross" }],
    conflictsByDiet: {
      Vegan: ["Milk"],
    },
  });

  assert.deepEqual(messages, []);
});

test("buildDietAllergenConflictMessages keeps direct contains conflicts", () => {
  const messages = runConflictMessages({
    selectedAllergenEntries: [{ token: "Milk", state: "contains" }],
    selectedDietEntries: [{ token: "Vegan", state: "contains" }],
    conflictsByDiet: {
      Vegan: ["Milk"],
    },
  });

  assert.deepEqual(messages, [
    "Conflict warning: Vegan conflicts with Milk because both are marked as contains.",
  ]);
});

test("buildDietAllergenConflictMessages warns on mixed contains and cross-contamination states", () => {
  const messages = runConflictMessages({
    selectedAllergenEntries: [{ token: "Milk", state: "cross" }],
    selectedDietEntries: [{ token: "Vegan", state: "contains" }],
    conflictsByDiet: {
      Vegan: ["Milk"],
    },
  });

  assert.deepEqual(messages, [
    "Selection warning: Vegan conflicts with Milk (Vegan is marked as contains; Milk is marked as cross-contamination).",
  ]);
});
