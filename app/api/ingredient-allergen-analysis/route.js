import { corsJson, corsOptions } from "../_shared/cors";
import {
  buildIngredientAllergenExtractionPrompts,
  buildIngredientAllergenRepairPrompts,
  buildIngredientAllergenVerificationPrompts,
} from "../../lib/claudePrompts";
import {
  callAnthropicApi,
  callOpenAiApi,
  createTextMessage,
  runWithProviderSelection,
} from "../../lib/server/ai/providerRuntime";
import { ingredientAllergenFlagsSchema } from "../../lib/server/ai/responseSchemas";

export const runtime = "nodejs";

const PINNED_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const MAX_ANALYSIS_ATTEMPTS = 2;
const ANALYSIS_MAX_TOKENS = 1800;
const VERIFICATION_MAX_TOKENS = 1400;
const REPAIR_MAX_TOKENS = 700;
const ANTHROPIC_THINKING_BUDGET_TOKENS = 1024;
const PROMPT_VERSION = "ingredient-allergen-two-pass-v4-20260305";

const CONFIG_TTL_MS = 60 * 60 * 1000;
const ANALYSIS_CACHE_TTL_MS = 15 * 60 * 1000;
const ANALYSIS_CACHE_MAX_ENTRIES = 128;
let cachedConfig = null;
let cachedConfigAt = 0;
let cachedConfigPromise = null;
const analysisCache = new Map();

export function OPTIONS() {
  return corsOptions();
}

function asText(value) {
  return String(value ?? "").trim();
}

function canonicalToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dedupeStrings(values) {
  const out = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = asText(value);
    if (!text) return;
    const token = canonicalToken(text);
    if (!token || seen.has(token)) return;
    seen.add(token);
    out.push(text);
  });
  return out;
}

function buildCodebook(values) {
  const list = dedupeStrings(values);
  const entries = list.map((value, index) => ({
    code: index + 1,
    value,
  }));

  const codeToValue = new Map();
  const tokenToValue = new Map();
  entries.forEach((entry) => {
    codeToValue.set(entry.code, entry.value);
    tokenToValue.set(canonicalToken(entry.value), entry.value);
  });

  return {
    entries,
    codeToValue,
    tokenToValue,
  };
}

function parseCodeList(input, codeToValue) {
  const out = [];
  (Array.isArray(input) ? input : []).forEach((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const resolved = codeToValue.get(Math.trunc(numeric));
    if (resolved) out.push(resolved);
  });
  return out;
}

function parseLegacyList(input, tokenToValue, aliasResolver) {
  const out = [];
  (Array.isArray(input) ? input : []).forEach((value) => {
    const token = canonicalToken(value);
    if (!token) return;
    const strictMatch = tokenToValue.get(token);
    if (strictMatch) {
      out.push(strictMatch);
      return;
    }
    if (typeof aliasResolver === "function") {
      const alias = asText(aliasResolver(token));
      if (alias) out.push(alias);
    }
  });
  return out;
}

function buildPromptCodebookLines(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => `${entry.code} = ${entry.value}`)
    .join("\n");
}

function extractBalancedJsonObjects(value) {
  const out = [];
  const text = asText(value);
  if (!text) return out;

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (ch === "}") {
      if (depth <= 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return out;
}

function parseClaudeJson(responseText) {
  const value = asText(responseText);
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    // continue
  }

  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // continue
    }
  }

  const balancedObjects = extractBalancedJsonObjects(value);
  for (let index = balancedObjects.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(balancedObjects[index]);
    } catch {
      // continue
    }
  }

  return null;
}

function buildAnalysisCacheKey({
  transcriptLines,
  allergenEntries,
  dietEntries,
  promptVersion,
}) {
  const normalizedLines = (Array.isArray(transcriptLines) ? transcriptLines : [])
    .map((line) => asText(line))
    .filter(Boolean)
    .join("\n");
  const allergenKey = (Array.isArray(allergenEntries) ? allergenEntries : [])
    .map((entry) => asText(entry?.value || entry))
    .filter(Boolean)
    .join("|");
  const dietKey = (Array.isArray(dietEntries) ? dietEntries : [])
    .map((entry) => asText(entry?.value || entry))
    .filter(Boolean)
    .join("|");
  return `${asText(promptVersion) || "unknown"}::${normalizedLines}::${allergenKey}::${dietKey}`;
}

function getCachedAnalysis(cacheKey) {
  const entry = analysisCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.at > ANALYSIS_CACHE_TTL_MS) {
    analysisCache.delete(cacheKey);
    return null;
  }
  return Array.isArray(entry.flags) ? entry.flags : null;
}

function setCachedAnalysis(cacheKey, flags) {
  analysisCache.set(cacheKey, {
    at: Date.now(),
    flags: Array.isArray(flags) ? flags : [],
  });

  if (analysisCache.size <= ANALYSIS_CACHE_MAX_ENTRIES) {
    return;
  }

  let oldestKey = "";
  let oldestAt = Number.POSITIVE_INFINITY;
  analysisCache.forEach((entry, key) => {
    const at = Number(entry?.at);
    if (!Number.isFinite(at)) return;
    if (at < oldestAt) {
      oldestAt = at;
      oldestKey = key;
    }
  });
  if (oldestKey) {
    analysisCache.delete(oldestKey);
  }
}

function readSupabaseRuntime() {
  const url =
    asText(process.env.SUPABASE_URL) ||
    asText(process.env.NEXT_PUBLIC_SUPABASE_URL);

  const key =
    asText(process.env.SUPABASE_ANON_KEY) ||
    asText(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  return { url, key };
}

async function fetchJson(url, headers) {
  const response = await fetch(url, {
    method: "GET",
    headers,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : [];
  if (!response.ok) {
    throw new Error(asText(parsed?.message) || `Supabase fetch failed (${response.status}).`);
  }
  return parsed;
}

async function fetchAllergenDietConfig() {
  const now = Date.now();
  if (cachedConfig && now - cachedConfigAt < CONFIG_TTL_MS) {
    return cachedConfig;
  }

  if (cachedConfigPromise) {
    return await cachedConfigPromise;
  }

  cachedConfigPromise = (async () => {
    const { url, key } = readSupabaseRuntime();
    if (!url || !key) {
      throw new Error(
        "Supabase runtime config missing: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ANON_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY are required.",
      );
    }

    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    };

    const [allergens, diets, conflicts] = await Promise.all([
      fetchJson(
        `${url}/rest/v1/allergens?select=key,label,sort_order,is_active&is_active=eq.true&order=sort_order.asc`,
        headers,
      ),
      fetchJson(
        `${url}/rest/v1/diets?select=key,label,sort_order,is_active,is_supported,is_ai_enabled&is_active=eq.true&order=sort_order.asc`,
        headers,
      ),
      fetchJson(
        `${url}/rest/v1/diet_allergen_conflicts?select=diet:diet_id(label),allergen:allergen_id(key)`,
        headers,
      ),
    ]);

    const supportedDiets = dedupeStrings(
      diets
        .filter((diet) => diet?.is_supported !== false)
        .map((diet) => diet?.label),
    );

    const aiDiets = dedupeStrings(
      diets
        .filter((diet) => diet?.is_ai_enabled !== false)
        .map((diet) => diet?.label),
    );

    const dietAllergenConflicts = {};
    (Array.isArray(conflicts) ? conflicts : []).forEach((row) => {
      const dietLabel = asText(row?.diet?.label);
      const allergenKey = asText(row?.allergen?.key);
      if (!dietLabel || !allergenKey) return;
      if (!dietAllergenConflicts[dietLabel]) {
        dietAllergenConflicts[dietLabel] = [];
      }
      if (!dietAllergenConflicts[dietLabel].includes(allergenKey)) {
        dietAllergenConflicts[dietLabel].push(allergenKey);
      }
    });

    cachedConfig = {
      allergens: Array.isArray(allergens) ? allergens : [],
      diets: Array.isArray(diets) ? diets : [],
      dietAllergenConflicts,
      supportedDiets,
      aiDiets,
    };
    cachedConfigAt = Date.now();
    return cachedConfig;
  })();

  try {
    return await cachedConfigPromise;
  } finally {
    cachedConfigPromise = null;
  }
}

async function callAnthropicText({
  systemPrompt,
  userPrompt,
  maxTokens = ANALYSIS_MAX_TOKENS,
  enableThinking = true,
  env = process.env,
}) {
  const minTokens = enableThinking
    ? ANTHROPIC_THINKING_BUDGET_TOKENS + 300
    : 400;
  const safeMaxTokens = Math.max(Number(maxTokens) || 0, minTokens);
  return await callAnthropicApi({
    promptClass: "ingredientAllergenAnalysis",
    systemPrompt,
    messages: [{ role: "user", content: [createTextMessage(userPrompt)] }],
    maxTokens: safeMaxTokens,
    thinkingBudgetTokens: enableThinking ? ANTHROPIC_THINKING_BUDGET_TOKENS : undefined,
    temperature: enableThinking ? undefined : 0,
    env,
  });
}

function isTransientFailure(error) {
  const message = asText(error?.message).toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("overloaded") ||
    message.includes("temporar") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("529") ||
    message.includes("503")
  );
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function repairJsonResponse({ rawOutput, env }) {
  const { systemPrompt: repairSystemPrompt, userPrompt: repairUserPrompt } =
    buildIngredientAllergenRepairPrompts(rawOutput);

  return await callAnthropicText({
    systemPrompt: repairSystemPrompt,
    userPrompt: repairUserPrompt,
    maxTokens: REPAIR_MAX_TOKENS,
    enableThinking: false,
    env,
  });
}

async function runFlagAnalysis({
  systemPrompt,
  userPrompt,
  maxTokens = ANALYSIS_MAX_TOKENS,
  phaseName = "analysis",
  env = process.env,
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ANALYSIS_ATTEMPTS; attempt += 1) {
    try {
      const response = await callAnthropicText({
        systemPrompt,
        userPrompt,
        maxTokens,
        env,
      });

      const parsed = parseClaudeJson(response.text);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.flags)) {
        return {
          ...response,
          parsed,
        };
      }

      const repairedResponse = await repairJsonResponse({
        rawOutput: response.text.slice(0, 8000),
        env,
      });
      const repaired = parseClaudeJson(repairedResponse.text);
      if (repaired && typeof repaired === "object" && Array.isArray(repaired.flags)) {
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

      lastError = new Error(
        `Ingredient allergen ${asText(phaseName) || "analysis"} pass returned malformed JSON output.`,
      );
      if (attempt >= MAX_ANALYSIS_ATTEMPTS) {
        break;
      }
    } catch (error) {
      lastError = error;
      if (!isTransientFailure(error) || attempt >= MAX_ANALYSIS_ATTEMPTS) {
        break;
      }
      await sleep(attempt * 250);
    }
  }

  throw lastError || new Error("Failed to analyze ingredient transcript.");
}

function buildDietConflictGuideText(dietAllergenConflicts) {
  const map = dietAllergenConflicts && typeof dietAllergenConflicts === "object"
    ? dietAllergenConflicts
    : {};
  const rows = Object.keys(map)
    .sort((a, b) => a.localeCompare(b))
    .map((dietLabel) => {
      const allergens = dedupeStrings(map[dietLabel] || [])
        .map((value) => asText(value))
        .filter(Boolean);
      if (!allergens.length) {
        return `- ${dietLabel}: no mapped allergens.`;
      }
      return `- ${dietLabel}: ${allergens.join(", ")}`;
    });
  return rows.length ? rows.join("\n") : "- No mapped diet conflicts.";
}

function readAnalysisOptions(body) {
  const options = body?.analysisOptions && typeof body.analysisOptions === "object"
    ? body.analysisOptions
    : {};
  return {
    disableCache: options.disableCache === true,
    debug: options.debug === true,
  };
}

function buildDietAliasResolver({ glutenFreeLabel, pescatarianLabel }) {
  return (token) => {
    const safe = canonicalToken(token);
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

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsJson(
      { success: false, error: "Invalid JSON payload.", flags: [] },
      { status: 400 },
    );
  }

  const transcriptLines = (Array.isArray(body?.transcriptLines) ? body.transcriptLines : [])
    .map((line) => asText(line))
    .filter(Boolean);
  const analysisOptions = readAnalysisOptions(body);

  const buildDebugPayload = ({
    pass1Used = false,
    pass2Used = false,
    fallbackReason = null,
  } = {}) => ({
    promptVersion: PROMPT_VERSION,
    pass1Used,
    pass2Used,
    pass2Applied: pass2Used,
    fallbackReason: asText(fallbackReason) || null,
  });

  if (!transcriptLines.length) {
    const payload = { success: true, flags: [] };
    if (analysisOptions.debug) {
      payload.debug = buildDebugPayload({ fallbackReason: "empty-transcript" });
    }
    return corsJson(payload, { status: 200 });
  }

  const anthropicModel =
    asText(process.env.ANTHROPIC_MODEL_INGREDIENT_FLAGS) ||
    asText(process.env.ANTHROPIC_MODEL) ||
    PINNED_ANTHROPIC_MODEL;
  const anthropicEnv = {
    ...process.env,
    ANTHROPIC_MODEL_INGREDIENT_ALLERGEN_ANALYSIS: anthropicModel,
  };

  try {
    const config = await fetchAllergenDietConfig();
    const allergenKeys = (Array.isArray(config?.allergens) ? config.allergens : [])
      .map((allergen) => asText(allergen?.key))
      .filter(Boolean);

    const supportedDietLabels = Array.isArray(config?.supportedDiets)
      ? config.supportedDiets
      : [];
    const aiDietLabels = Array.isArray(config?.aiDiets) ? config.aiDiets : [];
    const configuredDietLabels = (Array.isArray(config?.diets) ? config.diets : [])
      .map((diet) => asText(diet?.label))
      .filter(Boolean);
    const dietLabels = dedupeStrings([
      ...supportedDietLabels,
      ...aiDietLabels,
      ...configuredDietLabels,
    ]);

    const allergenCodebook = buildCodebook(allergenKeys);
    const dietCodebook = buildCodebook(dietLabels);

    const findDietLabel = (...candidates) => {
      const lowerMap = new Map(
        dietCodebook.entries.map((entry) => [entry.value.toLowerCase(), entry.value]),
      );
      for (const candidate of candidates) {
        const safe = asText(candidate);
        if (!safe) continue;
        if (dietCodebook.entries.some((entry) => entry.value === safe)) return safe;
        const byLower = lowerMap.get(safe.toLowerCase());
        if (byLower) return byLower;
      }
      return "";
    };

    const pescatarianLabel = findDietLabel("Pescatarian");
    const glutenFreeLabel = findDietLabel("Gluten-free", "Gluten Free");

    const resolveDietAlias = buildDietAliasResolver({
      glutenFreeLabel,
      pescatarianLabel,
    });

    const mapAllergens = (raw) =>
      dedupeStrings([
        ...parseCodeList(raw?.allergen_codes, allergenCodebook.codeToValue),
        ...parseLegacyList(raw?.allergens, allergenCodebook.tokenToValue),
      ]);

    const mapDiets = (raw) =>
      dedupeStrings([
        ...parseCodeList(raw?.diet_codes, dietCodebook.codeToValue),
        ...parseLegacyList(raw?.diets, dietCodebook.tokenToValue, resolveDietAlias),
      ]);

    const normalizeFlagsFromResponse = (parsedResponse) =>
      (Array.isArray(parsedResponse?.flags) ? parsedResponse.flags : [])
        .map((flag) => {
          const riskRaw = asText(flag?.risk_type).toLowerCase();
          const risk_type = riskRaw.includes("cross")
            ? "cross-contamination"
            : "contained";

          const word_indices = (
            Array.isArray(flag?.word_indices) ? flag.word_indices : [flag?.word_indices]
          )
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value >= 0)
            .map((value) => Math.trunc(value));
          const normalizedIndices = Array.from(new Set(word_indices)).sort(
            (a, b) => a - b,
          );

          return {
            ingredient: asText(flag?.ingredient),
            word_indices: normalizedIndices,
            allergens: mapAllergens(flag),
            diets: mapDiets(flag),
            risk_type,
          };
        })
        .filter((flag) =>
          flag.ingredient ||
          flag.word_indices.length ||
          flag.allergens.length ||
          flag.diets.length,
        );

    const analysisCacheKey = buildAnalysisCacheKey({
      transcriptLines,
      allergenEntries: allergenCodebook.entries,
      dietEntries: dietCodebook.entries,
      promptVersion: PROMPT_VERSION,
    });
    if (!analysisOptions.disableCache) {
      const cachedFlags = getCachedAnalysis(analysisCacheKey);
      if (cachedFlags !== null) {
        const payload = {
          success: true,
          flags: cachedFlags,
        };
        if (analysisOptions.debug) {
          payload.debug = buildDebugPayload({
            pass1Used: false,
            pass2Used: false,
            fallbackReason: "cache-hit",
          });
        }
        return corsJson(payload, { status: 200 });
      }
    }

    const allergenCodebookText = buildPromptCodebookLines(allergenCodebook.entries);
    const dietCodebookText = buildPromptCodebookLines(dietCodebook.entries);

    const wordList = [];
    transcriptLines.forEach((line) => {
      line.split(/\s+/).forEach((word) => {
        const safe = asText(word);
        if (safe) wordList.push(safe);
      });
    });

    const indexedWordList = wordList
      .map((word, index) => `${index}: "${word}"`)
      .join("\n");

    const extractionPrompts = buildIngredientAllergenExtractionPrompts({
      allergenCodebookText,
      dietCodebookText,
      indexedWordList,
      promptVersion: PROMPT_VERSION,
    });

    const result = await runWithProviderSelection({
      routeId: "ingredient-allergen-analysis",
      promptClass: "ingredientAllergenAnalysis",
      requestSummary: {
        transcriptLineCount: transcriptLines.length,
        promptVersion: PROMPT_VERSION,
      },
      invokeProvider: async (provider) => {
        const pass1Response =
          provider === "openai"
            ? await callOpenAiApi({
                promptClass: "ingredientAllergenAnalysis",
                systemPrompt: extractionPrompts.systemPrompt,
                messages: [{ role: "user", content: [createTextMessage(extractionPrompts.userPrompt)] }],
                maxTokens: ANALYSIS_MAX_TOKENS,
                jsonSchema: ingredientAllergenFlagsSchema,
                reasoningEffort: "medium",
              })
            : await runFlagAnalysis({
                systemPrompt: extractionPrompts.systemPrompt,
                userPrompt: extractionPrompts.userPrompt,
                maxTokens: ANALYSIS_MAX_TOKENS,
                phaseName: "extraction",
                env: anthropicEnv,
              });

        const pass1Parsed =
          pass1Response?.parsed && typeof pass1Response.parsed === "object"
            ? pass1Response.parsed
            : parseClaudeJson(pass1Response.text);
        if (!pass1Parsed || typeof pass1Parsed !== "object") {
          throw new Error("Failed to analyze ingredient transcript.");
        }

        const pass1Flags = normalizeFlagsFromResponse(pass1Parsed);
        let pass2Used = false;
        let fallbackReason = "";
        let finalFlags = pass1Flags;
        let aggregateResponse = {
          ...pass1Response,
        };

        try {
          const verificationPrompts = buildIngredientAllergenVerificationPrompts({
            allergenCodebookText,
            dietCodebookText,
            indexedWordList,
            candidateFlagsJson: JSON.stringify({
              flags: Array.isArray(pass1Parsed?.flags) ? pass1Parsed.flags : [],
            }),
            promptVersion: PROMPT_VERSION,
          });

          const pass2Response =
            provider === "openai"
              ? await callOpenAiApi({
                  promptClass: "ingredientAllergenAnalysis",
                  systemPrompt: verificationPrompts.systemPrompt,
                  messages: [
                    { role: "user", content: [createTextMessage(verificationPrompts.userPrompt)] },
                  ],
                  maxTokens: VERIFICATION_MAX_TOKENS,
                  jsonSchema: ingredientAllergenFlagsSchema,
                  reasoningEffort: "medium",
                })
              : await runFlagAnalysis({
                  systemPrompt: verificationPrompts.systemPrompt,
                  userPrompt: verificationPrompts.userPrompt,
                  maxTokens: VERIFICATION_MAX_TOKENS,
                  phaseName: "verification",
                  env: anthropicEnv,
                });

          const pass2Parsed =
            pass2Response?.parsed && typeof pass2Response.parsed === "object"
              ? pass2Response.parsed
              : parseClaudeJson(pass2Response.text);
          if (!pass2Parsed || typeof pass2Parsed !== "object") {
            throw new Error("Ingredient verification returned malformed JSON output.");
          }
          const pass2Flags = normalizeFlagsFromResponse(pass2Parsed);

          aggregateResponse = {
            ...pass2Response,
            latencyMs:
              Number(pass1Response.latencyMs || 0) + Number(pass2Response.latencyMs || 0),
            usage: {
              input_tokens:
                Number(pass1Response.usage?.input_tokens || 0) +
                Number(pass2Response.usage?.input_tokens || 0),
              output_tokens:
                Number(pass1Response.usage?.output_tokens || 0) +
                Number(pass2Response.usage?.output_tokens || 0),
              total_tokens:
                Number(pass1Response.usage?.total_tokens || 0) +
                Number(pass2Response.usage?.total_tokens || 0),
            },
            rawText: [pass1Response.text, pass2Response.text].filter(Boolean).join("\n\n"),
          };

          if (pass2Flags.length === 0 && pass1Flags.length > 0) {
            fallbackReason = "pass2-empty-while-pass1-non-empty";
          } else {
            finalFlags = pass2Flags;
            pass2Used = true;
          }
        } catch (pass2Error) {
          fallbackReason = `pass2-failed:${asText(pass2Error?.message) || "unknown"}`;
        }

        return {
          ...aggregateResponse,
          normalizedOutput: {
            flags: finalFlags,
            debug: buildDebugPayload({
              pass1Used: true,
              pass2Used,
              fallbackReason,
            }),
          },
        };
      },
    });
    const finalFlags = result.normalizedOutput.flags;
    const debugPayload = result.normalizedOutput.debug;

    if (!analysisOptions.disableCache) {
      setCachedAnalysis(analysisCacheKey, finalFlags);
    }

    const payload = {
      success: true,
      flags: finalFlags,
    };
    if (analysisOptions.debug) {
      payload.debug = debugPayload;
    }

    return corsJson(payload, { status: 200 });
  } catch (error) {
    const payload = {
      success: false,
      error: asText(error?.message) || "Failed to analyze ingredient transcript.",
      flags: [],
    };
    if (analysisOptions.debug) {
      payload.debug = buildDebugPayload({
        pass1Used: false,
        pass2Used: false,
        fallbackReason: "route-error",
      });
    }
    return corsJson(payload, { status: 200 });
  }
}
