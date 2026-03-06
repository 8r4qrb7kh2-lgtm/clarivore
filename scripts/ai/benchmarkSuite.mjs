import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";

import {
  buildAiDishSearchPrompt,
  buildAnalyzeIngredientScanPrompts,
  buildConfirmInfoComparisonPrompts,
  buildDetectCornersPrompts,
  buildDetectMenuDishesPrompts,
  buildDishEditorAnalysisSystemPrompt,
  buildDishEditorAnalysisUserPrompt,
  buildFrontProductNamePrompts,
  buildHelpAssistantSystemPrompt,
  buildIngredientAllergenExtractionPrompts,
  buildIngredientAllergenRepairPrompts,
  buildIngredientAllergenVerificationPrompts,
  buildIngredientNameAnalysisPrompts,
  buildIngredientNameRepairPrompts,
  buildIngredientPhotoLineMatchingPrompts,
  buildIngredientPhotoQualityPrompts,
  buildIngredientPhotoTranscriptionPrompts,
} from "../../app/lib/claudePrompts.js";
import {
  aiDishSearchSchema,
  analyzeIngredientScanSchema,
  confirmInfoCompareSchema,
  detectCornersSchema,
  detectMenuDishesSchema,
  dishEditorAnalysisSchema,
  frontProductNameSchema,
  ingredientAllergenFlagsSchema,
  ingredientNameAnalysisSchema,
  ingredientPhotoLineMatchingSchema,
  ingredientPhotoQualitySchema,
  ingredientPhotoTranscriptionSchema,
  menuImageAnalysisSchema,
} from "../../app/lib/server/ai/responseSchemas.js";
import {
  ANTHROPIC_MODEL_DEFAULTS,
  estimateUsageCostUsd,
  getBenchmarkCandidates,
  resolveModelForPromptClass,
} from "../../app/lib/server/ai/modelCatalog.js";
import {
  callAnthropicApi,
  callOpenAiApi,
  createImageMessage,
  createTextMessage,
} from "../../app/lib/server/ai/providerRuntime.js";
import { fetchRestaurantMenuStateMapFromTablesWithPrisma } from "../../app/lib/server/restaurantMenuStateServer.js";
import { ADMIN_DATA_FLOW_VISUALS, getDataFlowSourcePath } from "../../app/api/admin/_shared/dataFlowVisuals.js";
import { __bench as ingredientPhotoBench } from "../../app/api/ingredient-photo-analysis/route.js";
import { __bench as menuImageBench } from "../../app/api/menu-image-analysis/localRepositionEngine.mjs";

import { closeImageToolBrowser, createPerspectiveVariant, cropImageDataUrl } from "./benchmarkImageTools.mjs";
import {
  asText,
  buildCaseId,
  buildModelOverrideEnv,
  clamp,
  dedupeByToken,
  fetchBinaryAsDataUrl,
  joinTranscriptLines,
  levenshtein,
  normalizePhrase,
  normalizePromptClassToken,
  normalizeStringList,
  normalizeToken,
  parseJsonArrayText,
  parseJsonObjectText,
  sha1,
  slugify,
  splitIngredientText,
  stableSample,
  toFiniteNumber,
  tokenizeWords,
} from "./benchmarkShared.mjs";

export const DEFAULT_CAPTURE_LIMITS = {
  analyzeIngredientScan: 100,
  ingredientNameAnalysis: 100,
  ingredientAllergenLive: 100,
  frontProductName: 50,
  ingredientPhotoTranscription: 50,
  ingredientPhotoQuality: 50,
  ingredientPhotoLineMatching: 50,
  menuPage: 20,
  confirmPairs: 20,
  aiDishSearch: 30,
  helpAssistant: 25,
  adminDataFlowAsk: 15,
  dishEditorText: 30,
  dishEditorImage: 20,
};

export const STAGE_CONFIG = {
  pilot: {
    repetitions: 1,
    sampleRatio: 0.25,
  },
  full: {
    repetitions: 5,
    sampleRatio: 1,
  },
};

function dedupeStrings(values) {
  return normalizeStringList(values);
}

function buildCodebook(values) {
  const entries = dedupeStrings(values).map((value, index) => ({
    code: index + 1,
    value,
  }));
  const codeToValue = new Map(entries.map((entry) => [entry.code, entry.value]));
  const tokenToValue = new Map(entries.map((entry) => [normalizeToken(entry.value), entry.value]));
  return { entries, codeToValue, tokenToValue };
}

function buildPromptCodebookLines(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => `${entry.code} = ${entry.value}`)
    .join("\n");
}

function parseCodeList(values, codeToValue) {
  const output = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const resolved = codeToValue.get(Math.trunc(numeric));
    if (resolved) output.push(resolved);
  });
  return dedupeStrings(output);
}

function parseLegacyList(values, tokenToValue, aliasResolver) {
  const output = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const token = normalizeToken(value);
    if (!token) return;
    const strict = tokenToValue.get(token);
    if (strict) {
      output.push(strict);
      return;
    }
    if (typeof aliasResolver === "function") {
      const resolved = asText(aliasResolver(token));
      if (resolved) output.push(resolved);
    }
  });
  return dedupeStrings(output);
}

function buildDietAliasResolver({ glutenFreeLabel, pescatarianLabel }) {
  return (token) => {
    const safe = normalizeToken(token);
    if (!safe) return "";
    if (
      safe === "gf" ||
      safe.includes("glutenfree") ||
      safe.includes("nogluten") ||
      safe.includes("glutenless") ||
      safe.includes("withoutgluten") ||
      safe.includes("freefromgluten")
    ) {
      return glutenFreeLabel || "";
    }
    if (safe === "pescetarian") {
      return pescatarianLabel || "";
    }
    return "";
  };
}

function expandDietHierarchy(diets, labels) {
  const output = new Set((Array.isArray(diets) ? diets : []).map((value) => asText(value)).filter(Boolean));
  if (labels?.veganLabel && output.has(labels.veganLabel)) {
    if (labels.vegetarianLabel) output.add(labels.vegetarianLabel);
    if (labels.pescatarianLabel) output.add(labels.pescatarianLabel);
  }
  if (labels?.vegetarianLabel && output.has(labels.vegetarianLabel) && labels.pescatarianLabel) {
    output.add(labels.pescatarianLabel);
  }
  return Array.from(output);
}

function buildAllDietCodesExample(labels, dietCodebook) {
  return JSON.stringify(
    [labels.veganLabel, labels.vegetarianLabel, labels.pescatarianLabel, labels.glutenFreeLabel]
      .filter(Boolean)
      .map((label) => dietCodebook.entries.find((entry) => entry.value === label)?.code || null)
      .filter((code) => Number.isFinite(Number(code))),
  );
}

function parseDataUrlImage(imageData) {
  const value = asText(imageData);
  if (!value) return null;
  if (value.startsWith("data:") && value.includes(",")) {
    const [header, base64Data] = value.split(",", 2);
    return {
      mediaType: asText(header.split(";")[0]?.replace("data:", "")) || "image/jpeg",
      base64Data,
    };
  }
  return {
    mediaType: "image/jpeg",
    base64Data: value,
  };
}

function parseClaudeJson(value) {
  return parseJsonObjectText(value);
}

function normalizeConfidence(value) {
  const token = asText(value).toLowerCase();
  if (["low", "medium", "high"].includes(token)) return token;
  return "low";
}

function buildAdminSystemPrompt() {
  return [
    "You are Clarivore's admin diagram assistant.",
    "Your job is to answer questions about Clarivore data-flow visuals in plain language.",
    "Use only the provided diagram metadata, Mermaid source, click context, and Axon evidence.",
    "Axon evidence should be treated as fresh code-index context for each user question.",
    "When relevant, explicitly mention allowed user types and page/surface routes.",
    "When relevant, mention function/file locations from either the Mermaid map or Axon matches.",
    "If Axon status is unavailable/error, say that briefly and continue with the diagram context.",
    "If the answer cannot be inferred from the provided context, say that directly.",
    "Keep answers concise and practical for an admin operator.",
  ].join(" ");
}

function buildAdminContextBlock({ entry, sourceText, question }) {
  return [
    `Diagram ID: ${entry.id}`,
    `Diagram title: ${entry.title}`,
    `Diagram description: ${entry.description}`,
    "Mermaid source:",
    "```mermaid",
    sourceText,
    "```",
    "",
    "Axon evidence:",
    "Axon status: unavailable",
    "",
    "User question:",
    question,
  ].join("\n");
}

function extractKeywords(text, limit = 6) {
  const STOP = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "into",
    "your",
    "clarivore",
    "what",
    "how",
    "when",
    "where",
    "does",
    "about",
    "flow",
    "page",
    "data",
    "diagram",
  ]);
  const output = [];
  const seen = new Set();
  tokenizeWords(text).forEach((token) => {
    if (STOP.has(token) || token.length < 3 || seen.has(token)) return;
    seen.add(token);
    output.push(token);
  });
  return output.slice(0, limit);
}

function buildTypos(value) {
  const text = asText(value);
  if (text.length < 5) return text;
  return `${text.slice(0, 1)}${text.slice(2, 4)}${text.slice(1, 2)}${text.slice(4)}`;
}

function buildPartialQuery(value) {
  const tokens = tokenizeWords(value);
  return tokens.slice(0, Math.min(2, tokens.length)).join(" ");
}

function normalizeDishNameSet(values) {
  return dedupeStrings(
    (Array.isArray(values) ? values : [])
      .map((value) => asText(value?.name || value?.dish_name || value))
      .filter(Boolean),
  );
}

function buildExpectedLineMapping(transcriptLines, visualLines) {
  const output = {};
  const used = new Set();
  (Array.isArray(transcriptLines) ? transcriptLines : []).forEach((line, index) => {
    const lineTokens = tokenizeWords(line);
    let bestIndex = -1;
    let bestScore = 0;
    (Array.isArray(visualLines) ? visualLines : []).forEach((visualLine, visualIndex) => {
      if (used.has(visualIndex)) return;
      const visualTokens = tokenizeWords(visualLine?.text);
      if (!lineTokens.length || !visualTokens.length) return;
      let matches = 0;
      lineTokens.forEach((token) => {
        if (
          visualTokens.some(
            (candidate) =>
              candidate === token ||
              candidate.includes(token) ||
              token.includes(candidate),
          )
        ) {
          matches += 1;
        }
      });
      const score = matches / lineTokens.length;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = visualIndex;
      }
    });
    output[String(index)] = bestScore >= 0.2 ? bestIndex : -1;
    if (bestIndex >= 0) used.add(bestIndex);
  });
  return output;
}

function aggregateFlags(flags) {
  const containedAllergens = new Set();
  const crossAllergens = new Set();
  const diets = new Set();
  (Array.isArray(flags) ? flags : []).forEach((flag) => {
    const riskType = asText(flag?.risk_type).toLowerCase();
    const targetSet = riskType.includes("cross") ? crossAllergens : containedAllergens;
    (Array.isArray(flag?.allergens) ? flag.allergens : []).forEach((entry) => {
      const safe = asText(entry);
      if (safe) targetSet.add(safe);
    });
    (Array.isArray(flag?.diets) ? flag.diets : []).forEach((entry) => {
      const safe = asText(entry);
      if (safe) diets.add(safe);
    });
  });
  return {
    containedAllergens: Array.from(containedAllergens),
    crossAllergens: Array.from(crossAllergens),
    diets: Array.from(diets),
  };
}

function normalizeDocumentFlag(flag) {
  return {
    ingredient: normalizePhrase(flag?.ingredient),
    risk_type: asText(flag?.risk_type).toLowerCase().includes("cross")
      ? "cross-contamination"
      : "contained",
    allergens: dedupeStrings(Array.isArray(flag?.allergens) ? flag.allergens : [])
      .map((value) => normalizePhrase(value))
      .filter(Boolean)
      .sort(),
    diets: dedupeStrings(Array.isArray(flag?.diets) ? flag.diets : [])
      .map((value) => normalizePhrase(value))
      .filter(Boolean)
      .sort(),
  };
}

function buildDocumentFlagKey(flag, { includeDiets = true } = {}) {
  const normalized = normalizeDocumentFlag(flag);
  return [
    normalized.ingredient || "-",
    normalized.risk_type,
    normalized.allergens.join("|"),
    includeDiets ? normalized.diets.join("|") : "",
  ].join("::");
}

async function invokeModel({ provider, promptClass, model, invocation, env = process.env }) {
  const overrideEnv = buildModelOverrideEnv(promptClass, provider, model, env);
  const messages = (Array.isArray(invocation?.messages) ? invocation.messages : []).map((message) => ({
    role: asText(message?.role) === "assistant" ? "assistant" : "user",
    content: (Array.isArray(message?.content) ? message.content : []).map((part) => {
      const type = asText(part?.type).toLowerCase();
      if (type === "image") {
        const parsedImage = parseDataUrlImage(part.imageData || part.dataUrl || part.value);
        return createImageMessage(parsedImage || { mediaType: "image/jpeg", base64Data: "" });
      }
      return createTextMessage(part.text);
    }),
  }));

  if (provider === "openai") {
    return await callOpenAiApi({
      promptClass,
      systemPrompt: invocation?.systemPrompt,
      messages,
      maxTokens: invocation?.maxTokens,
      temperature: invocation?.temperature,
      reasoningEffort: invocation?.reasoningEffort,
      jsonSchema: invocation?.jsonSchema || undefined,
      env: overrideEnv,
    });
  }

  return await callAnthropicApi({
    promptClass,
    systemPrompt: invocation?.systemPrompt,
    messages,
    maxTokens: invocation?.maxTokens,
    temperature: invocation?.temperature,
    thinkingBudgetTokens: invocation?.thinkingBudgetTokens,
    env: overrideEnv,
  });
}

function normalizeGenericCase(caseDoc, response) {
  const normalizer = asText(caseDoc?.normalizer);
  switch (normalizer) {
    case "analyzeIngredientScan": {
      const parsed = parseClaudeJson(response.text) || {};
      return {
        needsScan: parsed?.needsScan === true,
        reasoning: asText(parsed?.reasoning),
      };
    }
    case "frontProductName": {
      const parsed = parseClaudeJson(response.text) || {};
      return {
        productName: asText(parsed?.productName),
        confidence: normalizeConfidence(parsed?.confidence),
      };
    }
    case "ingredientPhotoTranscription":
      return {
        transcriptLines: parseJsonArrayText(response.text).map((line) => asText(line)).filter(Boolean),
      };
    case "ingredientPhotoQuality": {
      const parsed = parseClaudeJson(response.text) || {};
      return {
        accept: parsed?.accept === true,
        confidence: normalizeConfidence(parsed?.confidence),
      };
    }
    case "ingredientPhotoLineMatching":
      return {
        mapping: parseClaudeJson(response.text) || {},
      };
    case "detectMenuDishes": {
      const parsed = parseClaudeJson(response.text) || {};
      return {
        dishes: normalizeDishNameSet(parsed?.dishes),
      };
    }
    case "detectCorners": {
      const parsed = parseClaudeJson(response.text) || {};
      const corners = parsed?.corners && typeof parsed.corners === "object" ? parsed.corners : parsed;
      return {
        corners: {
          topLeft: {
            x: toFiniteNumber(corners?.topLeft?.x, 0),
            y: toFiniteNumber(corners?.topLeft?.y, 0),
          },
          topRight: {
            x: toFiniteNumber(corners?.topRight?.x, 0),
            y: toFiniteNumber(corners?.topRight?.y, 0),
          },
          bottomRight: {
            x: toFiniteNumber(corners?.bottomRight?.x, 0),
            y: toFiniteNumber(corners?.bottomRight?.y, 0),
          },
          bottomLeft: {
            x: toFiniteNumber(corners?.bottomLeft?.x, 0),
            y: toFiniteNumber(corners?.bottomLeft?.y, 0),
          },
        },
      };
    }
    case "confirmInfoCompare": {
      const parsed = parseClaudeJson(response.text) || {};
      return {
        match: parsed?.match === true,
        confidence: normalizeConfidence(parsed?.confidence),
      };
    }
    case "menuImageAnalysis": {
      const parsed = parseJsonArrayText(response.text);
      return {
        dishes: normalizeDishNameSet(parsed),
      };
    }
    case "aiDishSearch": {
      const parsed = parseClaudeJson(response.text) || {};
      return {
        candidateIds: (Array.isArray(parsed?.matches) ? parsed.matches : [])
          .map((match) => asText(match?.candidate_id))
          .filter(Boolean),
      };
    }
    case "plainText":
      return {
        answer: asText(response.text),
      };
    default:
      return {
        text: asText(response.text),
      };
  }
}

async function runAnthropicJsonWithRepair({ promptClass, invocation, repairBuilder, model, env }) {
  const overrideEnv = buildModelOverrideEnv(promptClass, "anthropic", model, env);
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await callAnthropicApi({
        promptClass,
        systemPrompt: invocation.systemPrompt,
        messages: invocation.messages.map((message) => ({
          role: message.role,
          content: message.content.map((part) => createTextMessage(part.text)),
        })),
        maxTokens: invocation.maxTokens,
        thinkingBudgetTokens: invocation.thinkingBudgetTokens,
        env: overrideEnv,
      });
      const parsed = parseClaudeJson(response.text);
      if (parsed && typeof parsed === "object") {
        return { ...response, parsed };
      }

      const repairPrompts = repairBuilder(response.text.slice(0, 8000));
      const repairedResponse = await callAnthropicApi({
        promptClass,
        systemPrompt: repairPrompts.systemPrompt,
        messages: [{ role: "user", content: [createTextMessage(repairPrompts.userPrompt)] }],
        maxTokens: 320,
        env: overrideEnv,
      });
      const repaired = parseClaudeJson(repairedResponse.text);
      if (repaired && typeof repaired === "object") {
        return {
          ...repairedResponse,
          parsed: repaired,
          latencyMs: Number(response.latencyMs || 0) + Number(repairedResponse.latencyMs || 0),
          usage: {
            input_tokens:
              Number(response.usage?.input_tokens || 0) +
              Number(repairedResponse.usage?.input_tokens || 0),
            output_tokens:
              Number(response.usage?.output_tokens || 0) +
              Number(repairedResponse.usage?.output_tokens || 0),
            total_tokens:
              Number(response.usage?.total_tokens || 0) +
              Number(repairedResponse.usage?.total_tokens || 0),
          },
        };
      }

      lastError = new Error(`${promptClass} returned malformed JSON.`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`${promptClass} failed.`);
}

async function executeIngredientNameCase(caseDoc, provider, model, env) {
  const allergenCodebook = buildCodebook(caseDoc.input.allergenValues);
  const dietCodebook = buildCodebook(caseDoc.input.dietValues);
  const resolveDietAlias = buildDietAliasResolver(caseDoc.input.labels || {});
  const prompts = buildIngredientNameAnalysisPrompts({
    allergenCodebookText: buildPromptCodebookLines(allergenCodebook.entries),
    dietCodebookText: buildPromptCodebookLines(dietCodebook.entries),
    ingredientName: caseDoc.input.ingredientName,
    dishName: caseDoc.input.dishName,
  });

  const response =
    provider === "openai"
      ? await invokeModel({
          provider,
          promptClass: caseDoc.promptClass,
          model,
          env,
          invocation: {
            systemPrompt: prompts.systemPrompt,
            messages: [{ role: "user", content: [{ type: "text", text: prompts.userPrompt }] }],
            maxTokens: 520,
            jsonSchema: ingredientNameAnalysisSchema,
          },
        })
      : await runAnthropicJsonWithRepair({
          promptClass: caseDoc.promptClass,
          model,
          env,
          invocation: {
            systemPrompt: prompts.systemPrompt,
            messages: [{ role: "user", content: [{ text: prompts.userPrompt }] }],
            maxTokens: 520,
            thinkingBudgetTokens: 1024,
          },
          repairBuilder: buildIngredientNameRepairPrompts,
        });

  const parsed = response.parsed || parseClaudeJson(response.text) || {};
  return {
    ...response,
    normalizedOutput: {
      allergens: dedupeStrings([
        ...parseCodeList(parsed?.allergen_codes, allergenCodebook.codeToValue),
        ...parseLegacyList(parsed?.allergens, allergenCodebook.tokenToValue),
      ]),
      diets: expandDietHierarchy(
        dedupeStrings([
          ...parseCodeList(parsed?.diet_codes, dietCodebook.codeToValue),
          ...parseLegacyList(parsed?.diets, dietCodebook.tokenToValue, resolveDietAlias),
        ]),
        caseDoc.input.labels || {},
      ),
    },
  };
}

async function executeIngredientAllergenCase(caseDoc, provider, model, env) {
  const allergenCodebook = buildCodebook(caseDoc.input.allergenValues);
  const dietCodebook = buildCodebook(caseDoc.input.dietValues);
  const resolveDietAlias = buildDietAliasResolver(caseDoc.input.labels || {});
  const reasoningEffort = asText(caseDoc?.input?.reasoningEffort) || "medium";
  const extractionPrompts = buildIngredientAllergenExtractionPrompts({
    allergenCodebookText: buildPromptCodebookLines(allergenCodebook.entries),
    dietCodebookText: buildPromptCodebookLines(dietCodebook.entries),
    indexedWordList: caseDoc.input.indexedWordList,
    promptVersion: caseDoc.input.promptVersion,
  });

  const runSinglePass = async ({ systemPrompt, userPrompt, maxTokens }) => {
    if (provider === "openai") {
      const response = await invokeModel({
        provider,
        promptClass: caseDoc.promptClass,
        model,
        env,
        invocation: {
          systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: userPrompt }] }],
          maxTokens,
          reasoningEffort,
          jsonSchema: ingredientAllergenFlagsSchema,
        },
      });
      return {
        ...response,
        parsed: parseClaudeJson(response.text) || {},
      };
    }

    return await runAnthropicJsonWithRepair({
      promptClass: caseDoc.promptClass,
      model,
      env,
      invocation: {
        systemPrompt,
        messages: [{ role: "user", content: [{ text: userPrompt }] }],
        maxTokens,
        thinkingBudgetTokens: 1024,
      },
      repairBuilder: (rawOutput) => ({
        ...buildIngredientAllergenRepairPrompts(rawOutput),
      }),
    });
  };

  const pass1 = await runSinglePass({
    systemPrompt: extractionPrompts.systemPrompt,
    userPrompt: extractionPrompts.userPrompt,
    maxTokens: 1800,
  });

  const verificationPrompts = buildIngredientAllergenVerificationPrompts({
    allergenCodebookText: buildPromptCodebookLines(allergenCodebook.entries),
    dietCodebookText: buildPromptCodebookLines(dietCodebook.entries),
    indexedWordList: caseDoc.input.indexedWordList,
    candidateFlagsJson: JSON.stringify({
      flags: Array.isArray(pass1?.parsed?.flags) ? pass1.parsed.flags : [],
    }),
    promptVersion: caseDoc.input.promptVersion,
  });

  const pass2 = await runSinglePass({
    systemPrompt: verificationPrompts.systemPrompt,
    userPrompt: verificationPrompts.userPrompt,
    maxTokens: 1400,
  });

  const parsed = pass2.parsed || parseClaudeJson(pass2.text) || {};
  const flags = (Array.isArray(parsed?.flags) ? parsed.flags : [])
    .map((flag) => ({
      ingredient: asText(flag?.ingredient),
      risk_type: asText(flag?.risk_type).toLowerCase().includes("cross")
        ? "cross-contamination"
        : "contained",
      allergens: dedupeStrings([
        ...parseCodeList(flag?.allergen_codes, allergenCodebook.codeToValue),
        ...parseLegacyList(flag?.allergens, allergenCodebook.tokenToValue),
      ]),
      diets: dedupeStrings([
        ...parseCodeList(flag?.diet_codes, dietCodebook.codeToValue),
        ...parseLegacyList(flag?.diets, dietCodebook.tokenToValue, resolveDietAlias),
      ]),
    }))
    .filter((flag) => flag.ingredient || flag.allergens.length || flag.diets.length);

  return {
    ...pass2,
    latencyMs: Number(pass1.latencyMs || 0) + Number(pass2.latencyMs || 0),
    usage: {
      input_tokens: Number(pass1.usage?.input_tokens || 0) + Number(pass2.usage?.input_tokens || 0),
      output_tokens: Number(pass1.usage?.output_tokens || 0) + Number(pass2.usage?.output_tokens || 0),
      total_tokens: Number(pass1.usage?.total_tokens || 0) + Number(pass2.usage?.total_tokens || 0),
    },
    normalizedOutput: {
      flags,
      aggregate: aggregateFlags(flags),
    },
  };
}

async function executeDishEditorCase(caseDoc, provider, model, env) {
  const allergenCodebook = buildCodebook(caseDoc.input.allergenValues);
  const dietCodebook = buildCodebook(caseDoc.input.dietValues);
  const labels = caseDoc.input.labels || {};
  const resolveDietAlias = buildDietAliasResolver(labels);
  const allDietCodesExample = buildAllDietCodesExample(labels, dietCodebook);
  const vegetarianDietCodesExample = JSON.stringify(
    [labels.vegetarianLabel, labels.pescatarianLabel]
      .filter(Boolean)
      .map((label) => dietCodebook.entries.find((entry) => entry.value === label)?.code || null)
      .filter((code) => Number.isFinite(Number(code))),
  );
  const vegetarianGlutenFreeCodesExample = JSON.stringify(
    [labels.vegetarianLabel, labels.pescatarianLabel, labels.glutenFreeLabel]
      .filter(Boolean)
      .map((label) => dietCodebook.entries.find((entry) => entry.value === label)?.code || null)
      .filter((code) => Number.isFinite(Number(code))),
  );

  const parsedImage = parseDataUrlImage(caseDoc.input.imageData);
  const systemPrompt = buildDishEditorAnalysisSystemPrompt({
    parsedImage,
    allergenCodebookText: buildPromptCodebookLines(allergenCodebook.entries),
    dietCodebookText: buildPromptCodebookLines(dietCodebook.entries),
    allDietCodesExample,
    milkCode: allergenCodebook.entries.find((entry) => entry.value === "milk")?.code,
    eggCode: allergenCodebook.entries.find((entry) => entry.value === "egg")?.code,
    wheatCode: allergenCodebook.entries.find((entry) => entry.value === "wheat")?.code,
    vegetarianDietCodesExample,
    vegetarianGlutenFreeCodesExample,
  });
  const userPrompt = buildDishEditorAnalysisUserPrompt({
    parsedImage,
    dishName: caseDoc.input.dishName,
    text: caseDoc.input.text,
  });

  const messageContent = [];
  if (parsedImage) {
    messageContent.push({ type: "image", imageData: caseDoc.input.imageData });
  }
  messageContent.push({ type: "text", text: userPrompt });

  const response = await invokeModel({
    provider,
    promptClass: caseDoc.promptClass,
    model,
    env,
    invocation: {
      systemPrompt,
      messages: [{ role: "user", content: messageContent }],
      maxTokens: 4000,
      jsonSchema: provider === "openai" ? dishEditorAnalysisSchema : undefined,
    },
  });

  const parsed = parseClaudeJson(response.text) || {};
  return {
    ...response,
    normalizedOutput: {
      ingredients: (Array.isArray(parsed?.ingredients) ? parsed.ingredients : [])
        .map((ingredient, index) => ({
          name: asText(ingredient?.name) || `Ingredient ${index + 1}`,
          allergens: dedupeStrings([
            ...parseCodeList(ingredient?.allergen_codes, allergenCodebook.codeToValue),
            ...parseLegacyList(ingredient?.allergens, allergenCodebook.tokenToValue),
          ]),
          diets: expandDietHierarchy(
            dedupeStrings([
              ...parseCodeList(ingredient?.diet_codes, dietCodebook.codeToValue),
              ...parseLegacyList(ingredient?.diets, dietCodebook.tokenToValue, resolveDietAlias),
            ]),
            labels,
          ),
        }))
        .filter((ingredient) => ingredient.name),
      dietaryOptions: expandDietHierarchy(
        dedupeStrings([
          ...parseCodeList(parsed?.dietary_option_codes, dietCodebook.codeToValue),
          ...parseLegacyList(parsed?.dietaryOptions, dietCodebook.tokenToValue, resolveDietAlias),
        ]),
        labels,
      ),
      verifiedFromImage:
        parsed?.verifiedFromImage !== undefined
          ? Boolean(parsed.verifiedFromImage)
          : Boolean(parsedImage),
    },
  };
}

export async function executeBenchmarkCase(caseDoc, { provider, model, env = process.env }) {
  const promptClass = asText(caseDoc?.promptClass);
  let result = null;
  if (promptClass === "ingredientNameAnalysis") {
    result = await executeIngredientNameCase(caseDoc, provider, model, env);
  } else if (promptClass === "ingredientAllergenAnalysis") {
    result = await executeIngredientAllergenCase(caseDoc, provider, model, env);
  } else if (promptClass === "dishEditorAnalysis") {
    result = await executeDishEditorCase(caseDoc, provider, model, env);
  } else {
    const response = await invokeModel({
      provider,
      promptClass,
      model,
      env,
      invocation: caseDoc.invocation,
    });
    result = {
      ...response,
      normalizedOutput: normalizeGenericCase(caseDoc, response),
    };
  }

  return {
    provider,
    model,
    latencyMs: Number(result?.latencyMs || 0),
    usage: result?.usage || {},
    estimatedCostUsd: estimateUsageCostUsd({
      provider,
      model,
      usage: result?.usage || {},
    }),
    requestId: asText(result?.requestId) || null,
    rawText: asText(result?.text),
    normalizedOutput: result?.normalizedOutput ?? null,
  };
}

export function scoreBenchmarkCase(caseDoc, output, baselineOutput = null) {
  const expectation = caseDoc?.expectation || {};
  const metricType = asText(expectation.metricType);
  const normalized = output?.normalizedOutput || {};

  const compareSets = (actual, expected) => {
    const actualSet = new Set((Array.isArray(actual) ? actual : []).map((value) => normalizePhrase(value)).filter(Boolean));
    const expectedSet = new Set((Array.isArray(expected) ? expected : []).map((value) => normalizePhrase(value)).filter(Boolean));
    const intersection = Array.from(actualSet).filter((value) => expectedSet.has(value)).length;
    const precision = actualSet.size ? intersection / actualSet.size : expectedSet.size ? 0 : 1;
    const recall = expectedSet.size ? intersection / expectedSet.size : actualSet.size ? 0 : 1;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return { precision, recall, f1, exact: actualSet.size === expectedSet.size && intersection === actualSet.size };
  };

  const compareKeySets = (actual, expected) => {
    const actualSet = new Set((Array.isArray(actual) ? actual : []).map((value) => asText(value)).filter(Boolean));
    const expectedSet = new Set((Array.isArray(expected) ? expected : []).map((value) => asText(value)).filter(Boolean));
    const intersection = Array.from(actualSet).filter((value) => expectedSet.has(value)).length;
    const precision = actualSet.size ? intersection / actualSet.size : expectedSet.size ? 0 : 1;
    const recall = expectedSet.size ? intersection / expectedSet.size : actualSet.size ? 0 : 1;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return { precision, recall, f1, exact: actualSet.size === expectedSet.size && intersection === actualSet.size };
  };

  switch (metricType) {
    case "boolean_exact":
      {
        const field = asText(expectation.field) || (Object.prototype.hasOwnProperty.call(normalized, "needsScan") ? "needsScan" : "accept");
        return {
          primaryScore: normalized?.[field] === expectation.value ? 1 : 0,
          exactMatch: normalized?.[field] === expectation.value,
        };
      }
    case "product_name_text": {
      const predicted = normalizePhrase(normalized?.productName);
      const expected = normalizePhrase(expectation.productName);
      const editDistance = levenshtein(predicted, expected);
      const maxLength = Math.max(1, expected.length);
      return {
        primaryScore: predicted === expected ? 1 : Math.max(0, 1 - editDistance / maxLength),
        exactMatch: predicted === expected,
      };
    }
    case "ocr_text": {
      const predicted = normalizePhrase(joinTranscriptLines(normalized?.transcriptLines));
      const expected = normalizePhrase(expectation.text);
      const editDistance = levenshtein(predicted, expected);
      const maxLength = Math.max(1, expected.length);
      return {
        primaryScore: Math.max(0, 1 - editDistance / maxLength),
        exactMatch: predicted === expected,
      };
    }
    case "mapping_exact": {
      const actual = normalized?.mapping && typeof normalized.mapping === "object" ? normalized.mapping : {};
      const expected = expectation.mapping && typeof expectation.mapping === "object" ? expectation.mapping : {};
      const keys = Array.from(new Set([...Object.keys(actual), ...Object.keys(expected)]));
      const matches = keys.filter((key) => Number(actual[key]) === Number(expected[key])).length;
      return {
        primaryScore: keys.length ? matches / keys.length : 1,
        exactMatch: matches === keys.length,
      };
    }
    case "dish_name_set": {
      const setScore = compareSets(normalized?.dishes, expectation.dishes);
      return {
        primaryScore: setScore.f1,
        exactMatch: setScore.exact,
        precision: setScore.precision,
        recall: setScore.recall,
      };
    }
    case "corners": {
      const actualCorners = normalized?.corners || {};
      const expectedCorners = expectation.corners || {};
      const width = Math.max(1, Number(expectation.width) || 1);
      const height = Math.max(1, Number(expectation.height) || 1);
      const diagonal = Math.sqrt(width * width + height * height);
      const cornerKeys = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
      const distances = cornerKeys.map((key) => {
        const actual = actualCorners[key] || {};
        const expected = expectedCorners[key] || {};
        const dx = toFiniteNumber(actual.x, 0) - toFiniteNumber(expected.x, 0);
        const dy = toFiniteNumber(actual.y, 0) - toFiniteNumber(expected.y, 0);
        return Math.sqrt(dx * dx + dy * dy);
      });
      const meanDistance = distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length);
      return {
        primaryScore: Math.max(0, 1 - meanDistance / diagonal),
        meanDistancePx: meanDistance,
      };
    }
    case "compare_accuracy":
      return {
        primaryScore: normalized?.match === expectation.match ? 1 : 0,
        exactMatch: normalized?.match === expectation.match,
      };
    case "ranked_ids": {
      const actual = Array.isArray(normalized?.candidateIds) ? normalized.candidateIds : [];
      const relevant = new Set((Array.isArray(expectation.relevantIds) ? expectation.relevantIds : []).map((value) => asText(value)).filter(Boolean));
      let dcg = 0;
      actual.slice(0, 5).forEach((id, index) => {
        if (relevant.has(asText(id))) {
          dcg += 1 / Math.log2(index + 2);
        }
      });
      let idcg = 0;
      Array.from(relevant).slice(0, 5).forEach((_, index) => {
        idcg += 1 / Math.log2(index + 2);
      });
      const firstRelevantIndex = actual.findIndex((id) => relevant.has(asText(id)));
      return {
        primaryScore: idcg > 0 ? dcg / idcg : actual.length ? 0 : 1,
        mrr: firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0,
      };
    }
    case "keyword_rubric": {
      const answer = normalizePhrase(normalized?.answer);
      const keywords = Array.isArray(expectation.keywords) ? expectation.keywords : [];
      const hits = keywords.filter((keyword) => answer.includes(normalizePhrase(keyword))).length;
      const baselineAnswer = normalizePhrase(baselineOutput?.normalizedOutput?.answer);
      const baselineHits = keywords.filter((keyword) => baselineAnswer.includes(normalizePhrase(keyword))).length;
      return {
        primaryScore: keywords.length ? hits / keywords.length : 1,
        baselineScore: keywords.length ? baselineHits / keywords.length : 1,
      };
    }
    case "label_sets": {
      const allergenScore = compareSets(normalized?.allergens, expectation.allergens);
      const dietScore = compareSets(normalized?.diets, expectation.diets);
      return {
        primaryScore: (allergenScore.f1 + dietScore.f1) / 2,
        allergenF1: allergenScore.f1,
        dietF1: dietScore.f1,
      };
    }
    case "document_flags": {
      const expectedFlags = Array.isArray(expectation.flags) ? expectation.flags : [];
      const hasDetailedFlags = Array.isArray(expectation.flags);
      const aggregate = normalized?.aggregate || aggregateFlags(normalized?.flags);
      const expectedAggregate = hasDetailedFlags
        ? aggregateFlags(expectedFlags)
        : {
            containedAllergens: [],
            crossAllergens: [],
            diets: Array.isArray(expectation.diets) ? expectation.diets : [],
          };
      const allergenScore = compareSets(
        [...(aggregate?.containedAllergens || []), ...(aggregate?.crossAllergens || [])],
        hasDetailedFlags
          ? [...(expectedAggregate?.containedAllergens || []), ...(expectedAggregate?.crossAllergens || [])]
          : expectation.allergens,
      );
      const dietScore = compareSets(
        aggregate?.diets,
        hasDetailedFlags ? expectedAggregate?.diets : expectation.diets,
      );
      const expectedAllergens = new Set(
        (
          hasDetailedFlags
            ? [...(expectedAggregate?.containedAllergens || []), ...(expectedAggregate?.crossAllergens || [])]
            : Array.isArray(expectation.allergens)
              ? expectation.allergens
              : []
        )
          .map((value) => normalizePhrase(value))
          .filter(Boolean),
      );
      const actualAllergens = new Set(
        [...(aggregate?.containedAllergens || []), ...(aggregate?.crossAllergens || [])]
          .map((value) => normalizePhrase(value))
          .filter(Boolean),
      );
      const falseNegatives = Array.from(expectedAllergens).filter((value) => !actualAllergens.has(value)).length;
      if (hasDetailedFlags) {
        const actualFlags = Array.isArray(normalized?.flags) ? normalized.flags : [];
        const flagScore = compareKeySets(
          actualFlags.map((flag) => buildDocumentFlagKey(flag)),
          expectedFlags.map((flag) => buildDocumentFlagKey(flag)),
        );
        const riskScore = compareKeySets(
          actualFlags.map((flag) => buildDocumentFlagKey(flag, { includeDiets: false })),
          expectedFlags.map((flag) => buildDocumentFlagKey(flag, { includeDiets: false })),
        );
        return {
          primaryScore: (flagScore.f1 + allergenScore.f1 + dietScore.f1) / 3,
          flagF1: flagScore.f1,
          riskF1: riskScore.f1,
          allergenF1: allergenScore.f1,
          dietF1: dietScore.f1,
          allergenFalseNegatives: falseNegatives,
        };
      }
      return {
        primaryScore: (allergenScore.f1 + dietScore.f1) / 2,
        allergenF1: allergenScore.f1,
        dietF1: dietScore.f1,
        allergenFalseNegatives: falseNegatives,
      };
    }
    case "dish_editor": {
      const ingredientScore = compareSets(
        (Array.isArray(normalized?.ingredients) ? normalized.ingredients : []).map((ingredient) => ingredient.name),
        expectation.ingredientNames,
      );
      const dietScore = compareSets(normalized?.dietaryOptions, expectation.dietaryOptions);
      return {
        primaryScore: (ingredientScore.f1 + dietScore.f1) / 2,
        ingredientF1: ingredientScore.f1,
        dietF1: dietScore.f1,
      };
    }
    default:
      return {
        primaryScore: 0,
      };
  }
}

function createGenericCase({
  promptClass,
  routeId,
  normalizer,
  invocation,
  expectation,
  source,
}) {
  return {
    id: buildCaseId(promptClass, JSON.stringify({ source, expectation, normalizer })),
    promptClass,
    routeId,
    normalizer,
    invocation,
    expectation,
    source,
  };
}

async function fetchAiConfig(prisma) {
  const [allergens, diets, conflicts] = await Promise.all([
    prisma.allergens.findMany({
      where: { is_active: true },
      select: { key: true, label: true, sort_order: true },
      orderBy: { sort_order: "asc" },
    }),
    prisma.diets.findMany({
      where: { is_active: true },
      select: { key: true, label: true, sort_order: true, is_supported: true, is_ai_enabled: true },
      orderBy: { sort_order: "asc" },
    }),
    prisma.diet_allergen_conflicts.findMany({
      select: {
        diets: { select: { label: true } },
        allergens: { select: { key: true } },
      },
    }),
  ]);

  const supportedDiets = dedupeStrings(
    diets.filter((diet) => diet?.is_supported !== false).map((diet) => diet?.label),
  );
  const aiDiets = dedupeStrings(
    diets.filter((diet) => diet?.is_ai_enabled !== false).map((diet) => diet?.label),
  );
  const dietConflictGuideText = Object.entries(
    conflicts.reduce((acc, row) => {
      const dietLabel = asText(row?.diets?.label);
      const allergenKey = asText(row?.allergens?.key);
      if (!dietLabel || !allergenKey) return acc;
      acc[dietLabel] = acc[dietLabel] || [];
      acc[dietLabel].push(allergenKey);
      return acc;
    }, {}),
  )
    .map(([dietLabel, allergenKeys]) => `- ${dietLabel}: ${dedupeStrings(allergenKeys).join(", ")}`)
    .join("\n");

  const allDietLabels = dedupeStrings([
    ...supportedDiets,
    ...aiDiets,
    ...diets.map((diet) => diet?.label),
  ]);

  const findDietLabel = (...candidates) => {
    const lowerMap = new Map(allDietLabels.map((label) => [label.toLowerCase(), label]));
    for (const candidate of candidates) {
      const safe = asText(candidate);
      if (!safe) continue;
      if (allDietLabels.includes(safe)) return safe;
      const matched = lowerMap.get(safe.toLowerCase());
      if (matched) return matched;
    }
    return "";
  };

  return {
    allergenValues: allergens.map((entry) => asText(entry.key)).filter(Boolean),
    dietValues: allDietLabels,
    labels: {
      veganLabel: findDietLabel("Vegan"),
      vegetarianLabel: findDietLabel("Vegetarian"),
      pescatarianLabel: findDietLabel("Pescatarian"),
      glutenFreeLabel: findDietLabel("Gluten-free", "Gluten Free"),
    },
    canonicalFacts: `Canonical selectable options:\n- Allergens: ${allergens.map((entry) => asText(entry.label || entry.key)).filter(Boolean).join(", ")}\n- Diets: ${diets.filter((entry) => entry?.is_supported !== false).map((entry) => asText(entry.label || entry.key)).filter(Boolean).join(", ")}`,
    dietConflictGuideText: dietConflictGuideText || "- No mapped diet conflicts.",
  };
}

async function fetchBrandRows(prisma) {
  return await prisma.restaurant_menu_ingredient_brand_items.findMany({
    where: {
      OR: [
        { brand_image: { not: null } },
        { ingredients_image: { not: null } },
        { ingredient_list: { not: null } },
      ],
    },
    select: {
      restaurant_id: true,
      ingredient_row_id: true,
      dish_name: true,
      row_index: true,
      brand_name: true,
      brand_image: true,
      ingredients_image: true,
      ingredient_list: true,
      ingredients_list: true,
      allergens: true,
      cross_contamination_allergens: true,
      diets: true,
      cross_contamination_diets: true,
      restaurant_menu_ingredient_rows: {
        select: {
          row_text: true,
          applied_brand_item: true,
        },
      },
    },
  });
}

async function fetchRawIngredientRows(prisma) {
  return await prisma.restaurant_menu_ingredient_rows.findMany({
    where: {
      row_text: { not: null },
      applied_brand_item: null,
    },
    select: {
      restaurant_id: true,
      dish_name: true,
      row_index: true,
      row_text: true,
      ingredient_payload: true,
    },
  });
}

async function fetchMenuPageData(prisma, limit) {
  const pageRows = await prisma.restaurant_menu_pages.findMany({
    where: { image_url: { not: null } },
    select: {
      restaurant_id: true,
      page_index: true,
      image_url: true,
    },
  });
  const selectedPages = stableSample(
    pageRows.filter((row) => asText(row.image_url)),
    limit,
    (row) => `${row.restaurant_id}:${row.page_index}:${row.image_url}`,
  );
  const restaurantIds = dedupeByToken(
    selectedPages.map((row) => row.restaurant_id),
    (value) => value,
  );
  const restaurants = await prisma.restaurants.findMany({
    where: { id: { in: restaurantIds } },
    select: {
      id: true,
      name: true,
      slug: true,
      last_confirmed: true,
    },
  });
  const restaurantMap = new Map(restaurants.map((row) => [row.id, row]));
  const stateByRestaurant = await fetchRestaurantMenuStateMapFromTablesWithPrisma(prisma, restaurantIds);
  return selectedPages.map((page) => ({
    ...page,
    restaurant: restaurantMap.get(page.restaurant_id) || null,
    overlays:
      stateByRestaurant
        .get(page.restaurant_id)
        ?.overlays?.filter((overlay) => Number(overlay?.pageIndex || 0) === Number(page.page_index || 0)) || [],
  }));
}

function buildAnalyzeIngredientScanCases(brandRows, rawRows, limit) {
  const positiveCases = stableSample(brandRows, Math.ceil(limit / 2), (row) => `${row.restaurant_id}:${row.dish_name}:${row.row_index}:${row.brand_name}`);
  const negativeCases = stableSample(
    rawRows.filter((row) => {
      const text = asText(row.row_text);
      return text && text.length <= 32 && !/[,:;()]/.test(text);
    }),
    Math.floor(limit / 2),
    (row) => `${row.restaurant_id}:${row.dish_name}:${row.row_index}:${row.row_text}`,
  );

  return [
    ...positiveCases.map((row) => {
      const ingredientName = asText(row?.restaurant_menu_ingredient_rows?.applied_brand_item) || asText(row?.brand_name);
      const dishName = asText(row?.dish_name);
      const prompts = buildAnalyzeIngredientScanPrompts({ dishName, ingredientName });
      return createGenericCase({
        promptClass: "analyzeIngredientScan",
        routeId: "analyze-ingredient-scan",
        normalizer: "analyzeIngredientScan",
        invocation: {
          systemPrompt: prompts.systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: prompts.userPrompt }] }],
          maxTokens: 300,
          jsonSchema: analyzeIngredientScanSchema,
        },
        expectation: {
          metricType: "boolean_exact",
          field: "needsScan",
          value: true,
        },
        source: {
          dishName,
          ingredientName,
          labelSource: "applied-brand",
        },
      });
    }),
    ...negativeCases.map((row) => {
      const ingredientName = asText(row.row_text);
      const dishName = asText(row.dish_name);
      const prompts = buildAnalyzeIngredientScanPrompts({ dishName, ingredientName });
      return createGenericCase({
        promptClass: "analyzeIngredientScan",
        routeId: "analyze-ingredient-scan",
        normalizer: "analyzeIngredientScan",
        invocation: {
          systemPrompt: prompts.systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: prompts.userPrompt }] }],
          maxTokens: 300,
          jsonSchema: analyzeIngredientScanSchema,
        },
        expectation: {
          metricType: "boolean_exact",
          field: "needsScan",
          value: false,
        },
        source: {
          dishName,
          ingredientName,
          labelSource: "raw-row",
        },
      });
    }),
  ];
}

function buildIngredientNameCases(brandRows, aiConfig, limit) {
  return stableSample(
    brandRows.filter((row) => asText(row.brand_name)),
    limit,
    (row) => `${row.restaurant_id}:${row.dish_name}:${row.row_index}:${row.brand_name}`,
  ).map((row) => ({
    id: buildCaseId("ingredientNameAnalysis", `${row.restaurant_id}:${row.dish_name}:${row.row_index}:${row.brand_name}`),
    promptClass: "ingredientNameAnalysis",
    routeId: "ingredient-name-analysis",
    input: {
      ingredientName: asText(row.brand_name),
      dishName: asText(row.dish_name),
      allergenValues: aiConfig.allergenValues,
      dietValues: aiConfig.dietValues,
      labels: aiConfig.labels,
    },
    expectation: {
      metricType: "label_sets",
      allergens: dedupeStrings(row.allergens),
      diets: expandDietHierarchy(dedupeStrings(row.diets), aiConfig.labels),
    },
    source: {
      dishName: asText(row.dish_name),
      ingredientName: asText(row.brand_name),
    },
  }));
}

function buildIngredientAllergenCases(brandRows, aiConfig, fixtureRows, limit) {
  const liveCases = stableSample(
    brandRows.filter((row) => asText(row.ingredient_list) || (Array.isArray(row.ingredients_list) && row.ingredients_list.length)),
    limit,
    (row) => `${row.restaurant_id}:${row.dish_name}:${row.row_index}:${row.brand_name}`,
  ).map((row) => {
    const transcriptLines = Array.isArray(row.ingredients_list) && row.ingredients_list.length
      ? row.ingredients_list.map((value) => asText(value)).filter(Boolean)
      : splitIngredientText(row.ingredient_list);
    const indexedWordList = transcriptLines
      .flatMap((line) => line.split(/\s+/).map((word) => asText(word)).filter(Boolean))
      .map((word, index) => `${index}: "${word}"`)
      .join("\n");
    return {
      id: buildCaseId("ingredientAllergenAnalysis", `${row.restaurant_id}:${row.dish_name}:${row.row_index}:${row.brand_name}`),
      promptClass: "ingredientAllergenAnalysis",
      routeId: "ingredient-allergen-analysis",
      input: {
        transcriptLines,
        indexedWordList,
        promptVersion: "ingredient-allergen-two-pass-v4-20260305",
        allergenValues: aiConfig.allergenValues,
        dietValues: aiConfig.dietValues,
        labels: aiConfig.labels,
      },
      expectation: {
        metricType: "document_flags",
        allergens: dedupeStrings([
          ...row.allergens,
          ...row.cross_contamination_allergens,
        ]),
        diets: expandDietHierarchy(dedupeStrings(row.diets), aiConfig.labels),
      },
      source: {
        brandName: asText(row.brand_name),
        dishName: asText(row.dish_name),
      },
    };
  });

  const fixtureCases = (Array.isArray(fixtureRows) ? fixtureRows : []).map((row) => {
    const transcriptLines = Array.isArray(row.transcriptLines) ? row.transcriptLines : [];
    const indexedWordList = transcriptLines
      .flatMap((line) => line.split(/\s+/).map((word) => asText(word)).filter(Boolean))
      .map((word, index) => `${index}: "${word}"`)
      .join("\n");
    const expectedFlags = Array.isArray(row.expectedFlags)
      ? row.expectedFlags.map((flag) => ({
          ingredient: asText(flag?.ingredient),
          risk_type: asText(flag?.risk_type).toLowerCase().includes("cross")
            ? "cross-contamination"
            : "contained",
          allergens: dedupeStrings(Array.isArray(flag?.allergens) ? flag.allergens : []),
          diets: dedupeStrings(Array.isArray(flag?.diets) ? flag.diets : []),
        }))
      : [];
    return {
      id: buildCaseId("ingredientAllergenAnalysis", row.id || JSON.stringify(row)),
      promptClass: "ingredientAllergenAnalysis",
      routeId: "ingredient-allergen-analysis",
      input: {
        transcriptLines,
        indexedWordList,
        promptVersion: "ingredient-allergen-two-pass-v4-20260305",
        allergenValues: aiConfig.allergenValues,
        dietValues: aiConfig.dietValues,
        labels: aiConfig.labels,
      },
      expectation: {
        metricType: "document_flags",
        allergens: dedupeStrings(expectedFlags.flatMap((flag) => flag.allergens)),
        diets: dedupeStrings(expectedFlags.flatMap((flag) => flag.diets)),
        flags: expectedFlags,
      },
      source: {
        fixtureId: asText(row.id),
        notes: asText(row.notes),
      },
    };
  });

  return [...fixtureCases, ...liveCases];
}

async function buildIngredientPhotoCases(brandRows, aiConfig, googleVisionApiKey, limits) {
  const selectedRows = stableSample(
    brandRows.filter((row) => asText(row.ingredients_image) && (asText(row.ingredient_list) || (Array.isArray(row.ingredients_list) && row.ingredients_list.length))),
    Math.max(limits.ingredientPhotoTranscription, limits.ingredientPhotoQuality, limits.ingredientPhotoLineMatching),
    (row) => `${row.restaurant_id}:${row.dish_name}:${row.row_index}:${row.brand_name}`,
  );

  const transcriptionCases = [];
  const qualityCases = [];
  const lineMatchingCases = [];

  for (const row of selectedRows) {
    const imageData = await fetchBinaryAsDataUrl(row.ingredients_image);
    const transcriptLines = Array.isArray(row.ingredients_list) && row.ingredients_list.length
      ? row.ingredients_list.map((value) => asText(value)).filter(Boolean)
      : splitIngredientText(row.ingredient_list);
    const expectedText = joinTranscriptLines(transcriptLines);
    const parsedImage = ingredientPhotoBench.parseImageData(imageData);
    if (!parsedImage) continue;

    const transcriptionPrompts = buildIngredientPhotoTranscriptionPrompts();
    transcriptionCases.push(createGenericCase({
      promptClass: "ingredientPhotoTranscription",
      routeId: "ingredient-photo-analysis/transcription",
      normalizer: "ingredientPhotoTranscription",
      invocation: {
        systemPrompt: transcriptionPrompts.systemPrompt,
        messages: [{
          role: "user",
          content: [
            { type: "image", imageData },
            { type: "text", text: transcriptionPrompts.userPrompt },
          ],
        }],
        maxTokens: 4096,
        jsonSchema: ingredientPhotoTranscriptionSchema,
      },
      expectation: {
        metricType: "ocr_text",
        text: expectedText,
      },
      source: {
        brandName: asText(row.brand_name),
        ingredientsImage: asText(row.ingredients_image),
      },
    }));

    const qualityPrompts = buildIngredientPhotoQualityPrompts(expectedText);
    qualityCases.push(createGenericCase({
      promptClass: "ingredientPhotoQuality",
      routeId: "ingredient-photo-analysis/quality",
      normalizer: "ingredientPhotoQuality",
      invocation: {
        systemPrompt: qualityPrompts.systemPrompt,
        messages: [{
          role: "user",
          content: [
            { type: "image", imageData },
            { type: "text", text: qualityPrompts.userPrompt },
          ],
        }],
        maxTokens: 1600,
        jsonSchema: ingredientPhotoQualitySchema,
      },
      expectation: {
        metricType: "boolean_exact",
        field: "accept",
        value: true,
      },
      source: {
        brandName: asText(row.brand_name),
        variant: "positive",
      },
    }));

    if (googleVisionApiKey) {
      const vision = await ingredientPhotoBench.getVisionWords({
        googleVisionApiKey,
        base64Data: parsedImage.base64Data,
      });
      const visualLines = ingredientPhotoBench.groupVisualLines(vision.words);
      const transcriptDesc = transcriptLines.map((line, index) => `Transcript ${index}: "${line}"`).join("\n");
      const visualDesc = visualLines.map((line, index) => `Visual ${index}: "${asText(line?.text)}"`).join("\n");
      const prompts = buildIngredientPhotoLineMatchingPrompts({ transcriptDesc, visualDesc });
      lineMatchingCases.push(createGenericCase({
        promptClass: "ingredientPhotoLineMatching",
        routeId: "ingredient-photo-analysis/line-matching",
        normalizer: "ingredientPhotoLineMatching",
        invocation: {
          systemPrompt: prompts.systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: prompts.userPrompt }] }],
          maxTokens: 1600,
          jsonSchema: ingredientPhotoLineMatchingSchema,
        },
        expectation: {
          metricType: "mapping_exact",
          mapping: buildExpectedLineMapping(transcriptLines, visualLines),
        },
        source: {
          brandName: asText(row.brand_name),
          visualLineCount: visualLines.length,
        },
      }));
    }
  }

  return {
    transcriptionCases: transcriptionCases.slice(0, limits.ingredientPhotoTranscription),
    qualityCases: qualityCases.slice(0, limits.ingredientPhotoQuality),
    lineMatchingCases: lineMatchingCases.slice(0, limits.ingredientPhotoLineMatching),
  };
}

async function buildFrontProductCases(brandRows, limit) {
  const rows = stableSample(
    brandRows.filter((row) => asText(row.brand_image)),
    limit,
    (row) => `${row.restaurant_id}:${row.dish_name}:${row.row_index}:${row.brand_name}`,
  );

  const { systemPrompt, userPrompt } = buildFrontProductNamePrompts();
  const cases = [];
  for (const row of rows) {
    const imageData = await fetchBinaryAsDataUrl(row.brand_image);
    cases.push(createGenericCase({
      promptClass: "frontProductName",
      routeId: "ingredient-photo-analysis/front-product",
      normalizer: "frontProductName",
      invocation: {
        systemPrompt,
        messages: [{
          role: "user",
          content: [
            { type: "image", imageData },
            { type: "text", text: userPrompt },
          ],
        }],
        maxTokens: 600,
        jsonSchema: frontProductNameSchema,
      },
      expectation: {
        metricType: "product_name_text",
        productName: asText(row.brand_name),
      },
      source: {
        brandName: asText(row.brand_name),
      },
    }));
  }
  return cases;
}

async function buildMenuCases(menuPages, googleVisionApiKey, limits) {
  const selectedPages = stableSample(
    menuPages.filter((page) => Array.isArray(page.overlays) && page.overlays.length),
    limits.menuPage,
    (page) => `${page.restaurant_id}:${page.page_index}:${page.image_url}`,
  );
  const menuCases = [];
  const cornersCases = [];
  const compareCases = [];
  const menuImageCases = [];

  for (let index = 0; index < selectedPages.length; index += 1) {
    const page = selectedPages[index];
    const imageData = await fetchBinaryAsDataUrl(page.image_url);
    const expectedDishes = normalizeDishNameSet(page.overlays);

    const detectPrompts = buildDetectMenuDishesPrompts();
    menuCases.push(createGenericCase({
      promptClass: "detectMenuDishes",
      routeId: "detect-menu-dishes",
      normalizer: "detectMenuDishes",
      invocation: {
        systemPrompt: detectPrompts.systemPrompt,
        messages: [{
          role: "user",
          content: [
            { type: "image", imageData },
            { type: "text", text: detectPrompts.userPrompt },
          ],
        }],
        maxTokens: 4000,
        jsonSchema: detectMenuDishesSchema,
      },
      expectation: {
        metricType: "dish_name_set",
        dishes: expectedDishes,
      },
      source: {
        restaurantSlug: asText(page.restaurant?.slug),
        pageIndex: Number(page.page_index),
      },
    }));

    if (googleVisionApiKey) {
      const parsedImage = menuImageBench.parseImageDataSync(imageData);
      const ocr = await menuImageBench.extractTextElements({
        googleVisionApiKey,
        base64Data: parsedImage.base64Data,
      });
      const spatialMap = menuImageBench.buildSpatialRepresentation(ocr.elements);
      const prompt = menuImageBench.buildPrompt(spatialMap, ocr.fullText, []);
      menuImageCases.push(createGenericCase({
        promptClass: "menuImageAnalysis",
        routeId: "menu-image-analysis",
        normalizer: "menuImageAnalysis",
        invocation: {
          messages: [{
            role: "user",
            content: [
              { type: "image", imageData },
              { type: "text", text: prompt },
            ],
          }],
          maxTokens: 8192,
          temperature: 0,
          jsonSchema: menuImageAnalysisSchema,
        },
        expectation: {
          metricType: "dish_name_set",
          dishes: expectedDishes,
        },
        source: {
          restaurantSlug: asText(page.restaurant?.slug),
          pageIndex: Number(page.page_index),
          elementCount: ocr.elements.length,
        },
      }));
    }

    const perspectiveVariant = await createPerspectiveVariant(imageData, {
      rotateX: -10 + (index % 5) * 4,
      rotateY: -16 + (index % 4) * 7,
      rotateZ: -2 + (index % 3) * 2,
      scale: 0.92,
      width: 680,
      height: 920,
    });

    const cornerPrompts = buildDetectCornersPrompts({
      width: perspectiveVariant.width,
      height: perspectiveVariant.height,
    });
    cornersCases.push(createGenericCase({
      promptClass: "detectCorners",
      routeId: "detect-corners",
      normalizer: "detectCorners",
      invocation: {
        systemPrompt: cornerPrompts.systemPrompt,
        messages: [{
          role: "user",
          content: [
            { type: "image", imageData: perspectiveVariant.imageDataUrl },
            { type: "text", text: cornerPrompts.userPrompt },
          ],
        }],
        maxTokens: 600,
        jsonSchema: detectCornersSchema,
      },
      expectation: {
        metricType: "corners",
        corners: perspectiveVariant.corners,
        width: perspectiveVariant.width,
        height: perspectiveVariant.height,
      },
      source: {
        restaurantSlug: asText(page.restaurant?.slug),
        pageIndex: Number(page.page_index),
      },
    }));

    const comparePrompts = buildConfirmInfoComparisonPrompts("menu_page", `${page.restaurant?.name || "Restaurant"} page ${page.page_index}`);
    compareCases.push(createGenericCase({
      promptClass: "confirmInfoCompare",
      routeId: "confirm-info-compare",
      normalizer: "confirmInfoCompare",
      invocation: {
        systemPrompt: comparePrompts.systemPrompt,
        messages: [{
          role: "user",
          content: [
            { type: "image", imageData },
            { type: "image", imageData: perspectiveVariant.imageDataUrl },
            { type: "text", text: comparePrompts.userPrompt },
          ],
        }],
        maxTokens: 800,
        jsonSchema: confirmInfoCompareSchema,
      },
      expectation: {
        metricType: "compare_accuracy",
        match: true,
      },
      source: {
        kind: "menu_page",
        polarity: "positive",
      },
    }));

    const negativePage = selectedPages[(index + 1) % selectedPages.length];
    if (negativePage && negativePage !== page) {
      const negativeImageData = await fetchBinaryAsDataUrl(negativePage.image_url);
      compareCases.push(createGenericCase({
        promptClass: "confirmInfoCompare",
        routeId: "confirm-info-compare",
        normalizer: "confirmInfoCompare",
        invocation: {
          systemPrompt: comparePrompts.systemPrompt,
          messages: [{
            role: "user",
            content: [
              { type: "image", imageData },
              { type: "image", imageData: negativeImageData },
              { type: "text", text: comparePrompts.userPrompt },
            ],
          }],
          maxTokens: 800,
          jsonSchema: confirmInfoCompareSchema,
        },
        expectation: {
          metricType: "compare_accuracy",
          match: false,
        },
        source: {
          kind: "menu_page",
          polarity: "negative",
        },
      }));
    }
  }

  return {
    detectMenuDishesCases: menuCases,
    detectCornersCases: cornersCases,
    confirmInfoCompareMenuCases: compareCases.slice(0, limits.confirmPairs * 2),
    menuImageAnalysisCases: menuImageCases,
  };
}

async function buildBrandCompareCases(brandRows, limit) {
  const rows = stableSample(
    brandRows.filter((row) => asText(row.brand_image)),
    limit,
    (row) => `${row.restaurant_id}:${row.dish_name}:${row.row_index}:${row.brand_name}`,
  );
  const cases = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const imageData = await fetchBinaryAsDataUrl(row.brand_image);
    const variant = await cropImageDataUrl(imageData, {
      x: 30,
      y: 20,
      w: 520,
      h: 520,
      outputWidth: 520,
      outputHeight: 520,
    });
    const prompts = buildConfirmInfoComparisonPrompts("brand_item", asText(row.brand_name));
    cases.push(createGenericCase({
      promptClass: "confirmInfoCompare",
      routeId: "confirm-info-compare",
      normalizer: "confirmInfoCompare",
      invocation: {
        systemPrompt: prompts.systemPrompt,
        messages: [{
          role: "user",
          content: [
            { type: "image", imageData },
            { type: "image", imageData: variant.imageDataUrl },
            { type: "text", text: prompts.userPrompt },
          ],
        }],
        maxTokens: 800,
        jsonSchema: confirmInfoCompareSchema,
      },
      expectation: {
        metricType: "compare_accuracy",
        match: true,
      },
      source: {
        kind: "brand_item",
        polarity: "positive",
      },
    }));

    const negativeRow = rows[(index + 1) % rows.length];
    if (negativeRow && negativeRow !== row) {
      const negativeImageData = await fetchBinaryAsDataUrl(negativeRow.brand_image);
      cases.push(createGenericCase({
        promptClass: "confirmInfoCompare",
        routeId: "confirm-info-compare",
        normalizer: "confirmInfoCompare",
        invocation: {
          systemPrompt: prompts.systemPrompt,
          messages: [{
            role: "user",
            content: [
              { type: "image", imageData },
              { type: "image", imageData: negativeImageData },
              { type: "text", text: prompts.userPrompt },
            ],
          }],
          maxTokens: 800,
          jsonSchema: confirmInfoCompareSchema,
        },
        expectation: {
          metricType: "compare_accuracy",
          match: false,
        },
        source: {
          kind: "brand_item",
          polarity: "negative",
        },
      }));
    }
  }
  return cases.slice(0, limit * 2);
}

async function buildAiDishSearchCases(prisma, limit) {
  const restaurants = await prisma.restaurants.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      last_confirmed: true,
    },
  });
  const restaurantIds = restaurants.map((restaurant) => restaurant.id);
  const stateByRestaurant = await fetchRestaurantMenuStateMapFromTablesWithPrisma(prisma, restaurantIds);
  const candidates = [];
  restaurants.forEach((restaurant) => {
    const overlays = Array.isArray(stateByRestaurant.get(restaurant.id)?.overlays)
      ? stateByRestaurant.get(restaurant.id).overlays
      : [];
    overlays.forEach((overlay, overlayIndex) => {
      const dishName = asText(overlay?.name || overlay?.id);
      if (!dishName) return;
      const candidateId = `${restaurant.id}:${overlayIndex}:${slugify(dishName, "dish")}`;
      candidates.push({
        candidate_id: candidateId,
        restaurant_id: restaurant.id,
        restaurant_name: asText(restaurant.name),
        restaurant_slug: asText(restaurant.slug) || null,
        name: dishName,
        description: asText(overlay?.description || overlay?.details?.__ingredientsSummary || ""),
      });
    });
  });

  const seedCandidates = stableSample(candidates, Math.ceil(limit / 3), (candidate) => candidate.candidate_id);
  const output = [];
  seedCandidates.forEach((candidate) => {
    const exactPrompt = buildAiDishSearchPrompt({
      userQuery: candidate.name,
      userAllergens: [],
      userDiets: [],
      candidates,
      maxMatches: 80,
    });
    output.push(createGenericCase({
      promptClass: "aiDishSearch",
      routeId: "ai-dish-search",
      normalizer: "aiDishSearch",
      invocation: {
        messages: [{ role: "user", content: [{ type: "text", text: exactPrompt }] }],
        maxTokens: 2000,
        temperature: 0,
        jsonSchema: aiDishSearchSchema,
      },
      expectation: {
        metricType: "ranked_ids",
        relevantIds: [candidate.candidate_id],
      },
      source: {
        queryVariant: "exact",
        candidateId: candidate.candidate_id,
      },
    }));

    const typoQuery = buildTypos(candidate.name);
    const typoPrompt = buildAiDishSearchPrompt({
      userQuery: typoQuery,
      userAllergens: [],
      userDiets: [],
      candidates,
      maxMatches: 80,
    });
    output.push(createGenericCase({
      promptClass: "aiDishSearch",
      routeId: "ai-dish-search",
      normalizer: "aiDishSearch",
      invocation: {
        messages: [{ role: "user", content: [{ type: "text", text: typoPrompt }] }],
        maxTokens: 2000,
        temperature: 0,
        jsonSchema: aiDishSearchSchema,
      },
      expectation: {
        metricType: "ranked_ids",
        relevantIds: [candidate.candidate_id],
      },
      source: {
        queryVariant: "typo",
        candidateId: candidate.candidate_id,
      },
    }));

    const partialQuery = buildPartialQuery(candidate.name);
    if (partialQuery) {
      const partialPrompt = buildAiDishSearchPrompt({
        userQuery: partialQuery,
        userAllergens: [],
        userDiets: [],
        candidates,
        maxMatches: 80,
      });
      output.push(createGenericCase({
        promptClass: "aiDishSearch",
        routeId: "ai-dish-search",
        normalizer: "aiDishSearch",
        invocation: {
          messages: [{ role: "user", content: [{ type: "text", text: partialPrompt }] }],
          maxTokens: 2000,
          temperature: 0,
          jsonSchema: aiDishSearchSchema,
        },
        expectation: {
          metricType: "ranked_ids",
          relevantIds: [candidate.candidate_id],
        },
        source: {
          queryVariant: "partial",
          candidateId: candidate.candidate_id,
        },
      }));
    }
  });

  return output.slice(0, limit);
}

async function buildHelpAssistantCases(prisma, aiConfig, limit) {
  const kbRows = await prisma.help_kb.findMany({
    select: {
      title: true,
      content: true,
      url: true,
      source_path: true,
      tags: true,
      mode: true,
    },
    take: limit,
    orderBy: { updated_at: "desc" },
  }).catch(async () => {
    return await prisma.help_kb.findMany({
      select: {
        title: true,
        content: true,
        url: true,
        source_path: true,
        tags: true,
        mode: true,
      },
      take: limit,
    });
  });

  return stableSample(kbRows, limit, (row) => `${row.mode}:${row.title}`).map((row) => {
    const requestedMode = asText(row.mode).toLowerCase() === "manager" ? "manager" : "customer";
    const question = requestedMode === "manager"
      ? `How do I use ${asText(row.title)} in the manager tools?`
      : `How do I use ${asText(row.title)}?`;
    const evidence = `Snippet 1: ${asText(row.title)} [${asText(row.source_path) || asText(row.url) || "kb"}]\n${asText(row.content).slice(0, 900)}`;
    return createGenericCase({
      promptClass: "helpAssistant",
      routeId: "help-assistant",
      normalizer: "plainText",
      invocation: {
        systemPrompt: buildHelpAssistantSystemPrompt({
          requestedMode,
          canonicalFacts: aiConfig.canonicalFacts,
          evidence,
        }),
        messages: [{ role: "user", content: [{ type: "text", text: question }] }],
        maxTokens: 900,
        temperature: 0.2,
      },
      expectation: {
        metricType: "keyword_rubric",
        keywords: extractKeywords(`${row.title} ${row.content}`, 6),
      },
      source: {
        title: asText(row.title),
        mode: requestedMode,
      },
    });
  });
}

async function buildAdminDataFlowCases(limit) {
  const templates = [
    "What does this diagram show?",
    "Which routes or surfaces are involved here?",
    "What tables or storage boundaries matter in this flow?",
  ];

  const rows = [];
  for (const visual of ADMIN_DATA_FLOW_VISUALS) {
    const sourceText = await readFile(getDataFlowSourcePath(visual), "utf8");
    templates.forEach((question) => {
      rows.push(
        createGenericCase({
          promptClass: "adminDataFlowAsk",
          routeId: "admin-data-flow-ask",
          normalizer: "plainText",
          invocation: {
            systemPrompt: buildAdminSystemPrompt(),
            messages: [{
              role: "user",
              content: [{
                type: "text",
                text: buildAdminContextBlock({
                  entry: visual,
                  sourceText,
                  question,
                }),
              }],
            }],
            maxTokens: 900,
            temperature: 0.2,
          },
          expectation: {
            metricType: "keyword_rubric",
            keywords: extractKeywords(`${visual.title} ${visual.description} ${sourceText}`, 8),
          },
          source: {
            diagramId: visual.id,
            question,
          },
        }),
      );
    });
  }
  return rows.slice(0, limit);
}

async function buildDishEditorCases(menuPages, aiConfig, limits) {
  const descriptionCases = [];
  const imageCases = [];

  for (const page of menuPages) {
    const pageImageData = await fetchBinaryAsDataUrl(page.image_url);
    for (const overlay of Array.isArray(page.overlays) ? page.overlays : []) {
      const dishName = asText(overlay?.name || overlay?.id);
      const description = asText(overlay?.description || overlay?.details?.__ingredientsSummary || overlay?.text);
      const ingredientNames = dedupeStrings((Array.isArray(overlay?.ingredients) ? overlay.ingredients : []).map((ingredient) => ingredient?.name));
      const dietaryOptions = expandDietHierarchy(dedupeStrings(overlay?.diets), aiConfig.labels);
      if (!dishName || !ingredientNames.length) continue;

      if (description && descriptionCases.length < limits.dishEditorText) {
        descriptionCases.push({
          id: buildCaseId("dishEditorAnalysis", `${page.restaurant_id}:${page.page_index}:${dishName}:text`),
          promptClass: "dishEditorAnalysis",
          routeId: "dish-editor-analysis",
          input: {
            dishName,
            text: description,
            imageData: "",
            allergenValues: aiConfig.allergenValues,
            dietValues: aiConfig.dietValues,
            labels: aiConfig.labels,
          },
          expectation: {
            metricType: "dish_editor",
            ingredientNames,
            dietaryOptions,
          },
          source: {
            variant: "text",
            dishName,
          },
        });
      }

      if (imageCases.length < limits.dishEditorImage) {
        const crop = await cropImageDataUrl(pageImageData, {
          x: Number(overlay?.x || 0),
          y: Number(overlay?.y || 0),
          w: Number(overlay?.w || 220),
          h: Number(overlay?.h || 160),
          coordSpace: "thousand",
          outputWidth: 640,
          outputHeight: 480,
        });
        imageCases.push({
          id: buildCaseId("dishEditorAnalysis", `${page.restaurant_id}:${page.page_index}:${dishName}:image`),
          promptClass: "dishEditorAnalysis",
          routeId: "dish-editor-analysis",
          input: {
            dishName,
            text: description,
            imageData: crop.imageDataUrl,
            allergenValues: aiConfig.allergenValues,
            dietValues: aiConfig.dietValues,
            labels: aiConfig.labels,
          },
          expectation: {
            metricType: "dish_editor",
            ingredientNames,
            dietaryOptions,
          },
          source: {
            variant: "image",
            dishName,
          },
        });
      }
    }
  }

  return {
    descriptionCases,
    imageCases,
  };
}

export async function captureBenchmarkCorpus({
  prisma,
  limits = DEFAULT_CAPTURE_LIMITS,
  googleVisionApiKey = "",
}) {
  const aiConfig = await fetchAiConfig(prisma);
  const [brandRows, rawRows, menuPages] = await Promise.all([
    fetchBrandRows(prisma),
    fetchRawIngredientRows(prisma),
    fetchMenuPageData(prisma, limits.menuPage + 8),
  ]);

  const fixtureText = await readFile("ml/data/evals/ingredient_transcript_cases.jsonl", "utf8").catch(() => "");
  const fixtureRows = fixtureText
    .split(/\r?\n/)
    .map((line) => asText(line))
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const [
    frontProductCases,
    ingredientPhotoCases,
    menuCases,
    brandCompareCases,
    aiDishSearchCases,
    helpAssistantCases,
    adminDataFlowCases,
    dishEditorCases,
  ] = await Promise.all([
    buildFrontProductCases(brandRows, limits.frontProductName),
    buildIngredientPhotoCases(brandRows, aiConfig, googleVisionApiKey, limits),
    buildMenuCases(menuPages, googleVisionApiKey, limits),
    buildBrandCompareCases(brandRows, limits.confirmPairs),
    buildAiDishSearchCases(prisma, limits.aiDishSearch),
    buildHelpAssistantCases(prisma, aiConfig, limits.helpAssistant),
    buildAdminDataFlowCases(limits.adminDataFlowAsk),
    buildDishEditorCases(menuPages, aiConfig, limits),
  ]);

  const cases = [
    ...buildAnalyzeIngredientScanCases(brandRows, rawRows, limits.analyzeIngredientScan),
    ...buildIngredientNameCases(brandRows, aiConfig, limits.ingredientNameAnalysis),
    ...buildIngredientAllergenCases(
      brandRows,
      aiConfig,
      fixtureRows,
      limits.ingredientAllergenLive,
    ),
    ...frontProductCases,
    ...ingredientPhotoCases.transcriptionCases,
    ...ingredientPhotoCases.qualityCases,
    ...ingredientPhotoCases.lineMatchingCases,
    ...menuCases.detectMenuDishesCases,
    ...menuCases.detectCornersCases,
    ...menuCases.menuImageAnalysisCases,
    ...menuCases.confirmInfoCompareMenuCases,
    ...brandCompareCases,
    ...aiDishSearchCases,
    ...helpAssistantCases,
    ...adminDataFlowCases,
    ...dishEditorCases.descriptionCases,
    ...dishEditorCases.imageCases,
  ];

  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    counts: cases.reduce((acc, caseDoc) => {
      const key = asText(caseDoc.promptClass);
      acc[key] = Number(acc[key] || 0) + 1;
      return acc;
    }, {}),
    cases,
  };
}

export async function attachBaselineToCorpus(corpus, env = process.env) {
  const cases = Array.isArray(corpus?.cases) ? corpus.cases : [];
  const enrichedCases = [];

  for (const caseDoc of cases) {
    const model = resolveModelForPromptClass(caseDoc.promptClass, "anthropic", env);
    const baseline = await executeBenchmarkCase(caseDoc, {
      provider: "anthropic",
      model,
      env,
    });
    enrichedCases.push({
      ...caseDoc,
      baseline,
    });
  }

  return {
    ...corpus,
    cases: enrichedCases,
    baselineProvider: "anthropic",
    baselineCapturedAt: new Date().toISOString(),
  };
}

export function createPrismaClient() {
  return new PrismaClient();
}

export async function closeBenchmarkResources(prisma) {
  await prisma?.$disconnect?.();
  await closeImageToolBrowser();
}

export function planModelsForCorpus(corpus, env = process.env) {
  const prompts = Array.from(new Set((Array.isArray(corpus?.cases) ? corpus.cases : []).map((caseDoc) => caseDoc.promptClass)));
  return prompts.map((promptClass) => ({
    promptClass,
    anthropicBaseline: resolveModelForPromptClass(promptClass, "anthropic", env),
    openaiCandidates: getBenchmarkCandidates(promptClass, "openai"),
  }));
}

export function sampleCorpusCases(corpus, ratio = 1) {
  const safeRatio = clamp(Number(ratio) || 1, 0.05, 1);
  const grouped = new Map();
  (Array.isArray(corpus?.cases) ? corpus.cases : []).forEach((caseDoc) => {
    const key = asText(caseDoc.promptClass);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(caseDoc);
  });

  const sampled = [];
  grouped.forEach((rows) => {
    const target = Math.max(1, Math.round(rows.length * safeRatio));
    sampled.push(...stableSample(rows, target, (row) => row.id));
  });

  return {
    ...corpus,
    cases: sampled,
  };
}

export { normalizePromptClassToken };
