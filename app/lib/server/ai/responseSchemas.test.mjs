import assert from "node:assert/strict";
import test from "node:test";

import { ingredientCandidateExtractionSchema } from "./responseSchemas.js";

test("ingredientCandidateExtractionSchema requires word_indices on all candidate objects", () => {
  const directItem = ingredientCandidateExtractionSchema?.schema?.properties?.direct_ingredients?.items;
  const declarationItem =
    ingredientCandidateExtractionSchema?.schema?.properties?.declaration_candidates?.items;

  assert.deepEqual(directItem?.required, ["text", "word_indices"]);
  assert.deepEqual(declarationItem?.required, [
    "text",
    "word_indices",
    "declaration_type",
    "risk_type",
  ]);
  assert.deepEqual(directItem?.properties?.word_indices?.type, ["array", "null"]);
  assert.deepEqual(declarationItem?.properties?.word_indices?.type, ["array", "null"]);
});
