import assert from "node:assert/strict";
import test from "node:test";

import { parseIngredientLabelTranscript } from "../../lib/ingredientLabelParser.js";
import {
  mapCandidateFlagsToPublicFlags,
  partitionCandidatesByCatalogSafety,
} from "../../lib/server/ingredientAllergenCandidates.js";

const SUPPORTED_DIETS = ["Vegan", "Vegetarian", "Pescatarian", "Gluten-free"];

function createSafeCatalogEntry() {
  return {
    isReady: true,
    allergens: [],
    diets: [...SUPPORTED_DIETS],
    seedSource: "openfoodfacts_safe_only_v1",
    metadata: {
      catalog_type: "safe_only",
      supported_diets: [...SUPPORTED_DIETS],
    },
  };
}

test("partitionCandidatesByCatalogSafety skips safe direct ingredients and retains declarations", () => {
  const parsed = parseIngredientLabelTranscript([
    "Ingredients: Salt, Wheat flour. Contains: sesame.",
  ]);

  const { catalogSafeDirectCandidates, aiCandidates } =
    partitionCandidatesByCatalogSafety({
      directCandidates: parsed.directCandidates,
      declarationCandidates: parsed.declarationCandidates,
      entriesByIngredient: new Map([["Salt", createSafeCatalogEntry()]]),
    });

  assert.deepEqual(
    catalogSafeDirectCandidates.map((candidate) => candidate.text),
    ["Salt"],
  );
  assert.deepEqual(
    aiCandidates.map((candidate) => candidate.text),
    ["Wheat flour", "sesame"],
  );
});

test("partitionCandidatesByCatalogSafety yields no AI candidates when all direct ingredients are safe", () => {
  const parsed = parseIngredientLabelTranscript([
    "Ingredients: Salt, Water",
  ]);

  const safeEntries = new Map(
    parsed.directCandidates.map((candidate) => [
      candidate.text,
      createSafeCatalogEntry(),
    ]),
  );

  const { catalogSafeDirectCandidates, aiCandidates } =
    partitionCandidatesByCatalogSafety({
      directCandidates: parsed.directCandidates,
      declarationCandidates: parsed.declarationCandidates,
      entriesByIngredient: safeEntries,
    });

  assert.equal(catalogSafeDirectCandidates.length, 2);
  assert.equal(aiCandidates.length, 0);
});

test("mapCandidateFlagsToPublicFlags restores ingredient text, word indices, and risk type", () => {
  const parsed = parseIngredientLabelTranscript([
    "Ingredients: Salt, Wheat flour. May contain sesame.",
  ]);

  const candidateById = new Map(
    [...parsed.directCandidates, ...parsed.declarationCandidates].map((candidate) => [
      candidate.id,
      candidate,
    ]),
  );

  const publicFlags = mapCandidateFlagsToPublicFlags(
    [
      {
        candidate_id: parsed.directCandidates[1].id,
        allergens: ["wheat"],
        diets: ["Gluten-free"],
      },
      {
        candidate_id: parsed.declarationCandidates[0].id,
        allergens: ["sesame"],
        diets: [],
      },
    ],
    candidateById,
  );

  assert.deepEqual(publicFlags, [
    {
      ingredient: "Wheat flour",
      word_indices: parsed.directCandidates[1].wordIndices,
      allergens: ["wheat"],
      diets: ["Gluten-free"],
      risk_type: "contained",
    },
    {
      ingredient: "sesame",
      word_indices: parsed.declarationCandidates[0].wordIndices,
      allergens: ["sesame"],
      diets: [],
      risk_type: "cross-contamination",
    },
  ]);
});
