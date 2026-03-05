#!/usr/bin/env node

import path from "node:path";
import process from "node:process";

import {
  attachBaselineToCorpus,
  captureBenchmarkCorpus,
  closeBenchmarkResources,
  createPrismaClient,
  DEFAULT_CAPTURE_LIMITS,
  planModelsForCorpus,
} from "./benchmarkSuite.mjs";
import {
  asText,
  ensureDir,
  loadLocalEnv,
  nowRunId,
  readBooleanArg,
  readStringArg,
  parseArgs,
  readIntArg,
  resolveOutDir,
  writeJson,
} from "./benchmarkShared.mjs";

function requireEnv(name) {
  if (!asText(process.env[name])) {
    throw new Error(`Missing required env var: ${name}`);
  }
}

function buildLimits(args) {
  return {
    ...DEFAULT_CAPTURE_LIMITS,
    analyzeIngredientScan: readIntArg(args, "ingredient-scan", DEFAULT_CAPTURE_LIMITS.analyzeIngredientScan),
    ingredientNameAnalysis: readIntArg(args, "ingredient-name", DEFAULT_CAPTURE_LIMITS.ingredientNameAnalysis),
    ingredientAllergenLive: readIntArg(args, "ingredient-allergen-live", DEFAULT_CAPTURE_LIMITS.ingredientAllergenLive),
    frontProductName: readIntArg(args, "front-product", DEFAULT_CAPTURE_LIMITS.frontProductName),
    ingredientPhotoTranscription: readIntArg(args, "photo-transcription", DEFAULT_CAPTURE_LIMITS.ingredientPhotoTranscription),
    ingredientPhotoQuality: readIntArg(args, "photo-quality", DEFAULT_CAPTURE_LIMITS.ingredientPhotoQuality),
    ingredientPhotoLineMatching: readIntArg(args, "photo-line-matching", DEFAULT_CAPTURE_LIMITS.ingredientPhotoLineMatching),
    menuPage: readIntArg(args, "menu-pages", DEFAULT_CAPTURE_LIMITS.menuPage),
    confirmPairs: readIntArg(args, "confirm-pairs", DEFAULT_CAPTURE_LIMITS.confirmPairs),
    aiDishSearch: readIntArg(args, "dish-search", DEFAULT_CAPTURE_LIMITS.aiDishSearch),
    helpAssistant: readIntArg(args, "help", DEFAULT_CAPTURE_LIMITS.helpAssistant),
    adminDataFlowAsk: readIntArg(args, "admin-data-flow", DEFAULT_CAPTURE_LIMITS.adminDataFlowAsk),
    dishEditorText: readIntArg(args, "dish-editor-text", DEFAULT_CAPTURE_LIMITS.dishEditorText),
    dishEditorImage: readIntArg(args, "dish-editor-image", DEFAULT_CAPTURE_LIMITS.dishEditorImage),
  };
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const runId = readStringArg(args, "run-id", nowRunId("ai-corpus"));
  const outDir = resolveOutDir(runId);
  const withBaseline = readBooleanArg(args, "with-baseline", false);
  const googleVisionApiKey = asText(process.env.GOOGLE_VISION_API_KEY);

  requireEnv("DATABASE_URL");
  if (process.cwd() !== path.resolve(".")) {
    // no-op, keeps the script explicit about cwd-sensitive relative paths
  }

  await ensureDir(outDir);
  const prisma = createPrismaClient();

  try {
    const limits = buildLimits(args);
    let corpus = await captureBenchmarkCorpus({
      prisma,
      limits,
      googleVisionApiKey,
    });

    if (withBaseline) {
      requireEnv("ANTHROPIC_API_KEY");
      corpus = await attachBaselineToCorpus(corpus, process.env);
    }

    const corpusPath = path.join(outDir, "corpus.json");
    const modelPlanPath = path.join(outDir, "model-plan.json");
    await writeJson(corpusPath, corpus);
    await writeJson(modelPlanPath, planModelsForCorpus(corpus, process.env));

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          runId,
          corpusPath,
          caseCount: Array.isArray(corpus?.cases) ? corpus.cases.length : 0,
          withBaseline,
          googleVisionEnabled: Boolean(googleVisionApiKey),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await closeBenchmarkResources(prisma);
  }
}

main().catch((error) => {
  process.stderr.write(`${asText(error?.stack || error?.message || error)}\n`);
  process.exit(1);
});
