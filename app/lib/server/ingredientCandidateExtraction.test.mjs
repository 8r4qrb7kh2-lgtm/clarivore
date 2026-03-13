import assert from "node:assert/strict";
import test from "node:test";

import { buildParsedTranscriptFromCandidateExtraction } from "./ingredientCandidateExtraction.js";

test("buildParsedTranscriptFromCandidateExtraction uses AI-separated ingredients and advisories", () => {
  const transcriptLines = [
    "Ingredients: Pea Crisps (Pea Protein, Rice Starch), Hazelnut.",
    "Manufactured on equipment that processes Peanut, Dairy, Soy, Sesame, Tree Nuts, Wheat",
    "and Egg. May Contain nut shell fragments.",
  ];

  const parsed = buildParsedTranscriptFromCandidateExtraction({
    transcriptLines,
    extractionPayload: {
      direct_ingredients: [
        { text: "Pea Crisps (Pea Protein, Rice Starch)" },
        { text: "Hazelnut", word_indices: [7] },
      ],
      declaration_candidates: [
        {
          text: "Peanut",
          declaration_type: "shared-equipment",
          risk_type: "cross-contamination",
        },
        {
          text: "Tree Nuts",
          declaration_type: "shared-equipment",
          risk_type: "cross-contamination",
        },
        {
          text: "nut shell fragments",
          declaration_type: "may-contain",
          risk_type: "cross-contamination",
        },
      ],
    },
  });

  assert.equal(parsed.extractionMethod, "ai");
  assert.deepEqual(parsed.parsedIngredientsList, [
    "Pea Crisps (Pea Protein, Rice Starch)",
    "Hazelnut",
  ]);
  assert.deepEqual(parsed.directCandidates[0].wordIndices, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(parsed.directCandidates[1].wordIndices, [7]);
  assert.deepEqual(
    parsed.declarationCandidates.map((candidate) => candidate.text),
    ["Peanut", "Tree Nuts", "nut shell fragments"],
  );
  assert.deepEqual(parsed.declarationCandidates[1].wordIndices, [17, 18]);
  assert.deepEqual(parsed.declarationCandidates[2].wordIndices, [24, 25, 26]);
});

test("buildParsedTranscriptFromCandidateExtraction falls back when AI extraction is empty", () => {
  const parsed = buildParsedTranscriptFromCandidateExtraction({
    transcriptLines: ["Ingredients: Tomato Puree (Water, Tomato Paste), Salt"],
    extractionPayload: {
      direct_ingredients: [],
      declaration_candidates: [],
    },
  });

  assert.equal(parsed.extractionMethod, "fallback");
  assert.deepEqual(parsed.parsedIngredientsList, [
    "Tomato Puree (Water, Tomato Paste)",
    "Salt",
  ]);
});
