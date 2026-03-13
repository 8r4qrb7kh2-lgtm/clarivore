import assert from "node:assert/strict";
import test from "node:test";

import { parseIngredientLabelTranscript } from "./ingredientLabelParser.js";

test("parseIngredientLabelTranscript preserves top-level parenthetical groups", () => {
  const parsed = parseIngredientLabelTranscript([
    "Ingredients: Tomato Puree (Water, Tomato Paste), Salt",
  ]);

  assert.deepEqual(parsed.parsedIngredientsList, [
    "Tomato Puree (Water, Tomato Paste)",
    "Salt",
  ]);
  assert.deepEqual(
    parsed.directCandidates.map((candidate) => candidate.wordIndices),
    [[1, 2, 3, 4, 5], [6]],
  );
  assert.equal(parsed.declarationCandidates.length, 0);
});

test("parseIngredientLabelTranscript splits top-level semicolons like commas", () => {
  const parsed = parseIngredientLabelTranscript([
    "Ingredients: Water; Salt; Lemon Juice Concentrate",
  ]);

  assert.deepEqual(parsed.parsedIngredientsList, [
    "Water",
    "Salt",
    "Lemon Juice Concentrate",
  ]);
});

test("parseIngredientLabelTranscript excludes declarations from direct ingredients", () => {
  const parsed = parseIngredientLabelTranscript([
    "Ingredients: Corn flour, salt. Contains: wheat, soy. May contain milk and egg.",
  ]);

  assert.deepEqual(parsed.parsedIngredientsList, ["Corn flour", "salt"]);
  assert.deepEqual(
    parsed.declarationCandidates.map((candidate) => ({
      text: candidate.text,
      riskType: candidate.riskType,
    })),
    [
      { text: "wheat", riskType: "contained" },
      { text: "soy", riskType: "contained" },
      { text: "milk", riskType: "cross-contamination" },
      { text: "egg", riskType: "cross-contamination" },
    ],
  );
});

test("parseIngredientLabelTranscript keeps quantified contains phrases in direct ingredients", () => {
  const parsed = parseIngredientLabelTranscript([
    "Ingredients: Water, Sugar, Contains 2% Or Less Of: Citric Acid, Natural Flavors",
  ]);

  assert.deepEqual(parsed.parsedIngredientsList, [
    "Water",
    "Sugar",
    "Citric Acid",
    "Natural Flavors",
  ]);
  assert.equal(parsed.declarationCandidates.length, 0);
});
