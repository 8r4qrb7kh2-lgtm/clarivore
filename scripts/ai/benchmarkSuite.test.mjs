import assert from "node:assert/strict";
import test from "node:test";

import {
  planModelsForCorpus,
  sampleCorpusCases,
  scoreBenchmarkCase,
} from "./benchmarkSuite.mjs";

test("sampleCorpusCases keeps at least one case per prompt class", () => {
  const corpus = {
    cases: [
      { id: "a1", promptClass: "detectMenuDishes" },
      { id: "a2", promptClass: "detectMenuDishes" },
      { id: "b1", promptClass: "ingredientNameAnalysis" },
      { id: "b2", promptClass: "ingredientNameAnalysis" },
    ],
  };

  const sampled = sampleCorpusCases(corpus, 0.1);
  const classes = new Set(sampled.cases.map((entry) => entry.promptClass));

  assert.equal(classes.has("detectMenuDishes"), true);
  assert.equal(classes.has("ingredientNameAnalysis"), true);
});

test("scoreBenchmarkCase computes dish-name F1", () => {
  const score = scoreBenchmarkCase(
    {
      expectation: {
        metricType: "dish_name_set",
        dishes: ["Margherita Pizza", "Caesar Salad"],
      },
    },
    {
      normalizedOutput: {
        dishes: ["Margherita Pizza"],
      },
    },
  );

  assert.equal(score.precision, 1);
  assert.equal(score.recall, 0.5);
  assert.equal(Number(score.primaryScore.toFixed(4)), 0.6667);
});

test("planModelsForCorpus lists anthropic baseline and openai candidates", () => {
  const plan = planModelsForCorpus({
    cases: [
      { id: "1", promptClass: "analyzeIngredientScan" },
      { id: "2", promptClass: "ingredientAllergenAnalysis" },
    ],
  });

  const scan = plan.find((entry) => entry.promptClass === "analyzeIngredientScan");
  const flags = plan.find((entry) => entry.promptClass === "ingredientAllergenAnalysis");

  assert.equal(scan?.anthropicBaseline?.startsWith("claude-"), true);
  assert.equal(Array.isArray(scan?.openaiCandidates), true);
  assert.equal(flags?.openaiCandidates.includes("gpt-5-mini"), true);
});
