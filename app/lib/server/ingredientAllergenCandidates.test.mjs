import assert from "node:assert/strict";
import test from "node:test";

const ingredientLabelParserModule = await import("../ingredientLabelParser.js");
const { parseIngredientLabelTranscript } =
  ingredientLabelParserModule.parseIngredientLabelTranscript
    ? ingredientLabelParserModule
    : ingredientLabelParserModule.default;
const ingredientAllergenCandidatesModule = await import("./ingredientAllergenCandidates.js");
const {
  buildAllergenAliasMap,
  buildDietsByAllergenIndex,
  mapCandidateFlagsToPublicFlags,
  resolveExplicitDeclarationCandidates,
} = ingredientAllergenCandidatesModule.buildAllergenAliasMap
  ? ingredientAllergenCandidatesModule
  : ingredientAllergenCandidatesModule.default;

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

test("resolveExplicitDeclarationCandidates maps advisory allergens without AI", () => {
  const parsed = parseIngredientLabelTranscript([
    "Ingredients: Sugar. Manufactured on equipment that processes peanuts, dairy, soy, sesame, tree nuts, wheat, and egg.",
  ]);

  const allergenAliasMap = buildAllergenAliasMap([
    { key: "milk", label: "Milk" },
    { key: "peanut", label: "Peanut" },
    { key: "soy", label: "Soy" },
    { key: "sesame", label: "Sesame" },
    { key: "tree_nut", label: "Tree Nut" },
    { key: "wheat", label: "Wheat" },
    { key: "egg", label: "Egg" },
  ]);
  const dietsByAllergen = buildDietsByAllergenIndex({
    Vegan: ["milk", "egg"],
    "Gluten-free": ["wheat"],
  });

  const { resolvedFlags, unresolvedCandidates } = resolveExplicitDeclarationCandidates({
    declarationCandidates: parsed.declarationCandidates,
    allergenAliasMap,
    dietsByAllergen,
  });

  assert.equal(unresolvedCandidates.length, 0);
  assert.deepEqual(
    resolvedFlags.map((flag) => ({
      ingredient: flag.ingredient,
      allergens: flag.allergens,
      diets: flag.diets,
      risk_type: flag.risk_type,
    })),
    [
      {
        ingredient: "peanuts",
        allergens: ["peanut"],
        diets: [],
        risk_type: "cross-contamination",
      },
      {
        ingredient: "dairy",
        allergens: ["milk"],
        diets: ["Vegan"],
        risk_type: "cross-contamination",
      },
      {
        ingredient: "soy",
        allergens: ["soy"],
        diets: [],
        risk_type: "cross-contamination",
      },
      {
        ingredient: "sesame",
        allergens: ["sesame"],
        diets: [],
        risk_type: "cross-contamination",
      },
      {
        ingredient: "tree nuts",
        allergens: ["tree_nut"],
        diets: [],
        risk_type: "cross-contamination",
      },
      {
        ingredient: "wheat",
        allergens: ["wheat"],
        diets: ["Gluten-free"],
        risk_type: "cross-contamination",
      },
      {
        ingredient: "egg",
        allergens: ["egg"],
        diets: ["Vegan"],
        risk_type: "cross-contamination",
      },
    ],
  );
});
