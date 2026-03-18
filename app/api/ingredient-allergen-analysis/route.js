import { corsJson, corsOptions } from "../_shared/cors.js";
import {
  buildIngredientAllergenConflictVerificationPrompts,
  buildIngredientAllergenExtractionPrompts,
  buildIngredientCandidateExtractionPrompts,
} from "../../lib/claudePrompts.js";
import {
  callOpenAiApi,
  createTextMessage,
  runWithProviderSelection,
} from "../../lib/server/ai/providerRuntime.js";
import {
  ingredientAllergenCandidateFlagsSchema,
  ingredientCandidateExtractionSchema,
} from "../../lib/server/ai/responseSchemas.js";
import {
  buildAllergenAliasMap,
  buildCandidateListText,
  buildDietsByAllergenIndex,
  mapCandidateFlagsToPublicFlags,
  resolveExplicitDeclarationCandidates,
} from "../../lib/server/ingredientAllergenCandidates.js";
import { parseIngredientLabelTranscript } from "../../lib/ingredientLabelParser.js";
import {
  buildParsedTranscriptFromCandidateExtraction,
  normalizeCandidateExtractionPayload,
} from "../../lib/server/ingredientCandidateExtraction.js";
import {
  findSafeIngredientTableMatches,
  loadSafeIngredientTable,
} from "../../lib/server/safeIngredientTable.js";

export const runtime = "nodejs";

const PINNED_OPENAI_MODEL = "gpt-5.4";
const OPENAI_REASONING_EFFORT = "low";
const CANDIDATE_EXTRACTION_REASONING_EFFORT = "none";
const MAX_ANALYSIS_ATTEMPTS = 2;
const ANALYSIS_MAX_TOKENS = 1800;
const VERIFICATION_MAX_TOKENS = 1400;
const CANDIDATE_EXTRACTION_MIN_TOKENS = 1200;
const CANDIDATE_EXTRACTION_MAX_TOKENS = 6400;
const PROMPT_VERSION =
  "ingredient-allergen-openai-safe-table-v6-low-20260318";
const CANDIDATE_EXTRACTION_PROMPT_VERSION =
  "ingredient-candidate-extraction-openai-v3-20260313";

const CONFIG_TTL_MS = 60 * 60 * 1000;
const ANALYSIS_CACHE_TTL_MS = 15 * 60 * 1000;
const ANALYSIS_CACHE_MAX_ENTRIES = 128;
const CANDIDATE_EXTRACTION_CACHE_TTL_MS = 15 * 60 * 1000;
const CANDIDATE_EXTRACTION_CACHE_MAX_ENTRIES = 128;
const SAFE_TABLE_MATCH_CACHE_TTL_MS = 15 * 60 * 1000;
const SAFE_TABLE_MATCH_CACHE_MAX_ENTRIES = 128;
let cachedConfig = null;
let cachedConfigAt = 0;
let cachedConfigPromise = null;
const analysisCache = new Map();
const candidateExtractionCache = new Map();
const safeTableMatchCache = new Map();

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

function buildTranscriptCacheKey({ transcriptLines, promptVersion }) {
  const normalizedLines = (Array.isArray(transcriptLines) ? transcriptLines : [])
    .map((line) => asText(line))
    .filter(Boolean)
    .join("\n");
  return `${asText(promptVersion) || "unknown"}::${normalizedLines}`;
}

function buildCatalogMatchCacheKey(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => asText(value))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .join("|");
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

function getCachedCandidateExtraction(cacheKey) {
  const entry = candidateExtractionCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.at > CANDIDATE_EXTRACTION_CACHE_TTL_MS) {
    candidateExtractionCache.delete(cacheKey);
    return null;
  }
  return entry.value && typeof entry.value === "object" ? entry.value : null;
}

function setCachedCandidateExtraction(cacheKey, value) {
  candidateExtractionCache.set(cacheKey, {
    at: Date.now(),
    value: value && typeof value === "object" ? value : null,
  });

  if (candidateExtractionCache.size <= CANDIDATE_EXTRACTION_CACHE_MAX_ENTRIES) {
    return;
  }

  let oldestKey = "";
  let oldestAt = Number.POSITIVE_INFINITY;
  candidateExtractionCache.forEach((entry, key) => {
    const at = Number(entry?.at);
    if (!Number.isFinite(at)) return;
    if (at < oldestAt) {
      oldestAt = at;
      oldestKey = key;
    }
  });
  if (oldestKey) {
    candidateExtractionCache.delete(oldestKey);
  }
}

function getCachedSafeTableMatches(cacheKey) {
  const entry = safeTableMatchCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.at > SAFE_TABLE_MATCH_CACHE_TTL_MS) {
    safeTableMatchCache.delete(cacheKey);
    return null;
  }
  return entry.value && typeof entry.value === "object" ? entry.value : null;
}

function setCachedSafeTableMatches(cacheKey, value) {
  safeTableMatchCache.set(cacheKey, {
    at: Date.now(),
    value: value && typeof value === "object" ? value : null,
  });

  if (safeTableMatchCache.size <= SAFE_TABLE_MATCH_CACHE_MAX_ENTRIES) {
    return;
  }

  let oldestKey = "";
  let oldestAt = Number.POSITIVE_INFINITY;
  safeTableMatchCache.forEach((entry, key) => {
    const at = Number(entry?.at);
    if (!Number.isFinite(at)) return;
    if (at < oldestAt) {
      oldestAt = at;
      oldestKey = key;
    }
  });
  if (oldestKey) {
    safeTableMatchCache.delete(oldestKey);
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

function sortStrings(values) {
  return dedupeStrings(values).sort((left, right) => left.localeCompare(right));
}

function asciiText(value) {
  return asText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeCatalogLookupTerm(value) {
  return asciiText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function singularizeLookupWord(value) {
  const word = normalizeCatalogLookupTerm(value);
  if (!word) return "";
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (
    word.endsWith("s") &&
    !word.endsWith("ss") &&
    !word.endsWith("us") &&
    !word.endsWith("is")
  ) {
    return word.slice(0, -1);
  }
  return word;
}

function pluralizeLookupWord(value) {
  const word = normalizeCatalogLookupTerm(value);
  if (!word) return "";
  if (word.endsWith("s")) return word;
  if (
    word.endsWith("ch") ||
    word.endsWith("sh") ||
    word.endsWith("x") ||
    word.endsWith("z")
  ) {
    return `${word}es`;
  }
  if (word.endsWith("y") && word.length > 1 && !/[aeiou]y$/.test(word)) {
    return `${word.slice(0, -1)}ies`;
  }
  return `${word}s`;
}

function buildCatalogLookupVariants(value) {
  const base = normalizeCatalogLookupTerm(value);
  if (!base) return [];

  const variants = new Set([base]);
  const words = base.split(" ").filter(Boolean);
  if (!words.length) return Array.from(variants);

  const lastWord = words[words.length - 1];
  const singularLastWord = singularizeLookupWord(lastWord);
  const pluralLastWord = pluralizeLookupWord(lastWord);

  if (singularLastWord && singularLastWord !== lastWord) {
    variants.add([...words.slice(0, -1), singularLastWord].join(" "));
  }
  if (pluralLastWord && pluralLastWord !== lastWord) {
    variants.add([...words.slice(0, -1), pluralLastWord].join(" "));
  }

  return Array.from(variants).filter(Boolean);
}

function partitionDirectCandidatesForAiReview({ directCandidates, safeTableMatches }) {
  const matchedTexts = new Set(
    Array.isArray(safeTableMatches?.matchedCandidateTexts)
      ? safeTableMatches.matchedCandidateTexts
      : [],
  );
  const safeCatalogDirectCandidates = [];
  const aiReviewDirectCandidates = [];

  (Array.isArray(directCandidates) ? directCandidates : []).forEach((candidate) => {
    const text = asText(candidate?.text);
    if (!text || !matchedTexts.has(text)) {
      aiReviewDirectCandidates.push(candidate);
      return;
    }
    safeCatalogDirectCandidates.push(candidate);
  });

  return {
    safeCatalogDirectCandidates,
    aiReviewDirectCandidates,
    riskyCatalogMatchedDirectCandidates: [],
  };
}

function toPostgresTextArrayLiteral(values) {
  const safeValues = dedupeStrings(values);
  if (!safeValues.length) return "{}";
  return `{${safeValues
    .map((value) => `"${asText(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",")}}`;
}

async function fetchSafeIngredientTableMatches({
  candidateTexts,
  disableCache = false,
}) {
  const safeCandidateTexts = dedupeStrings(candidateTexts);
  const safeIngredientTable = await loadSafeIngredientTable();
  if (!safeCandidateTexts.length) {
    return {
      matchedCandidateCount: 0,
      matchedCandidateTexts: [],
      matchedEntriesByCandidateText: {},
      sourceLabel:
        asText(safeIngredientTable?.sourceLabel) || "safe-ingredient-table",
      sourcePath: asText(safeIngredientTable?.sourcePath),
      tableStatus: "not-needed",
      tableVersionKey: asText(safeIngredientTable?.versionKey) || "not-needed",
      tableRowCount: Number.isFinite(Number(safeIngredientTable?.rowCount))
        ? Math.max(0, Math.trunc(Number(safeIngredientTable.rowCount)))
        : 0,
      tableError: asText(safeIngredientTable?.error),
    };
  }

  const candidateTerms = safeCandidateTexts.flatMap((text) => buildCatalogLookupVariants(text));
  const normalizedLookupTerms = dedupeStrings(candidateTerms);
  if (!normalizedLookupTerms.length) {
    return {
      matchedCandidateCount: 0,
      matchedCandidateTexts: [],
      matchedEntriesByCandidateText: {},
      sourceLabel:
        asText(safeIngredientTable?.sourceLabel) || "safe-ingredient-table",
      sourcePath: "",
      tableStatus: "invalid-input",
      tableVersionKey: "invalid-input",
      tableRowCount: 0,
      tableError: "",
    };
  }

  const cacheKey = buildCatalogMatchCacheKey(normalizedLookupTerms);
  const versionedCacheKey = `${asText(safeIngredientTable?.versionKey) || "missing"}::${cacheKey}`;
  if (!disableCache) {
    const cached = getCachedSafeTableMatches(versionedCacheKey);
    if (cached) return cached;
  }

  const result = await findSafeIngredientTableMatches(safeCandidateTexts);

  if (!disableCache) {
    setCachedSafeTableMatches(versionedCacheKey, result);
  }

  return result;
}

function normalizeIntegerCodes(values) {
  const numbers = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const numeric = Math.trunc(Number(value));
    if (!Number.isFinite(numeric) || seen.has(numeric)) return;
    seen.add(numeric);
    numbers.push(numeric);
  });
  return numbers.sort((left, right) => left - right);
}

function normalizeStructuredCandidateFlags(flags) {
  return (Array.isArray(flags) ? flags : [])
    .map((flag) => ({
      candidate_id: asText(flag?.candidate_id || flag?.candidateId),
      allergen_codes: normalizeIntegerCodes(flag?.allergen_codes),
      diet_codes: normalizeIntegerCodes(flag?.diet_codes),
    }))
    .filter(
      (flag) =>
        flag.candidate_id &&
        (flag.allergen_codes.length || flag.diet_codes.length),
    )
    .sort((left, right) => {
      const byId = left.candidate_id.localeCompare(right.candidate_id);
      if (byId !== 0) return byId;
      const leftKey = JSON.stringify([left.allergen_codes, left.diet_codes]);
      const rightKey = JSON.stringify([right.allergen_codes, right.diet_codes]);
      return leftKey.localeCompare(rightKey);
    });
}

function normalizeCandidateFlagConsensus(flags) {
  return (Array.isArray(flags) ? flags : [])
    .map((flag) => ({
      candidate_id: asText(flag?.candidate_id || flag?.candidateId),
      allergens: sortStrings(flag?.allergens),
      diets: sortStrings(flag?.diets),
    }))
    .filter((flag) => flag.candidate_id && (flag.allergens.length || flag.diets.length))
    .sort((left, right) => {
      const byId = left.candidate_id.localeCompare(right.candidate_id);
      if (byId !== 0) return byId;
      const leftKey = JSON.stringify([left.allergens, left.diets]);
      const rightKey = JSON.stringify([right.allergens, right.diets]);
      return leftKey.localeCompare(rightKey);
    });
}

function candidateFlagConsensusMatches(left, right) {
  return (
    JSON.stringify(normalizeCandidateFlagConsensus(left)) ===
    JSON.stringify(normalizeCandidateFlagConsensus(right))
  );
}

function sumUsage(responses) {
  return (Array.isArray(responses) ? responses : []).reduce(
    (accumulator, response) => ({
      input_tokens:
        accumulator.input_tokens + Number(response?.usage?.input_tokens || 0),
      output_tokens:
        accumulator.output_tokens + Number(response?.usage?.output_tokens || 0),
      total_tokens:
        accumulator.total_tokens + Number(response?.usage?.total_tokens || 0),
    }),
    {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
  );
}

function buildAggregateLatencyMs(parallelResponses, serialResponses = []) {
  const parallelLatencies = (Array.isArray(parallelResponses) ? parallelResponses : [])
    .map((response) => Number(response?.latencyMs || 0))
    .filter(Number.isFinite);
  const serialLatency = (Array.isArray(serialResponses) ? serialResponses : []).reduce(
    (total, response) => total + Number(response?.latencyMs || 0),
    0,
  );
  return Math.max(0, ...parallelLatencies) + serialLatency;
}

function serializeStructuredFlags(parsedResponse) {
  const sourceFlags = Array.isArray(parsedResponse)
    ? parsedResponse
    : Array.isArray(parsedResponse?.flags)
      ? parsedResponse.flags
      : [];
  return JSON.stringify({
    flags: normalizeStructuredCandidateFlags(sourceFlags),
  });
}

async function runOpenAiFlagAnalysis({
  systemPrompt,
  userPrompt,
  maxTokens = ANALYSIS_MAX_TOKENS,
  phaseName = "analysis",
  metadata,
  env = process.env,
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ANALYSIS_ATTEMPTS; attempt += 1) {
    try {
      const response = await callOpenAiApi({
        promptClass: "ingredientAllergenAnalysis",
        systemPrompt,
        messages: [{ role: "user", content: [createTextMessage(userPrompt)] }],
        maxTokens,
        jsonSchema: ingredientAllergenCandidateFlagsSchema,
        reasoningEffort: OPENAI_REASONING_EFFORT,
        metadata,
        env,
      });

      const parsed = parseClaudeJson(response.text);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.flags)) {
        return {
          ...response,
          parsed,
        };
      }

      lastError = new Error(
        `Ingredient allergen ${asText(phaseName) || "analysis"} pass returned malformed structured output.`,
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

async function runOpenAiCandidateExtraction({
  systemPrompt,
  userPrompt,
  maxTokens = CANDIDATE_EXTRACTION_MIN_TOKENS,
  metadata,
  env = process.env,
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ANALYSIS_ATTEMPTS; attempt += 1) {
    try {
      const attemptMaxTokens = Math.min(
        Math.max(CANDIDATE_EXTRACTION_MIN_TOKENS, Number(maxTokens) || 0) * attempt,
        CANDIDATE_EXTRACTION_MAX_TOKENS,
      );
      const response = await callOpenAiApi({
        promptClass: "ingredientCandidateExtraction",
        systemPrompt,
        messages: [{ role: "user", content: [createTextMessage(userPrompt)] }],
        maxTokens: attemptMaxTokens,
        jsonSchema: ingredientCandidateExtractionSchema,
        metadata,
        env,
      });

      const normalized = normalizeCandidateExtractionPayload(
        response?.parsed && typeof response.parsed === "object"
          ? response.parsed
          : parseClaudeJson(response.text),
      );
      if (normalized) {
        return {
          ...response,
          parsed: normalized,
        };
      }

      const incompleteReason = asText(response?.rawResponse?.incomplete_details?.reason);
      const incompleteStatus = asText(response?.rawResponse?.status);
      lastError = new Error(
        incompleteReason || incompleteStatus === "incomplete"
          ? `Ingredient candidate extraction returned malformed output (${incompleteReason || "incomplete response"}).`
          : "Ingredient candidate extraction returned malformed output.",
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

  throw lastError || new Error("Failed to extract ingredient candidates.");
}

function estimateCandidateExtractionMaxTokens(parsedTranscript) {
  const words = Array.isArray(parsedTranscript?.words) ? parsedTranscript.words : [];
  const directCandidates = Array.isArray(parsedTranscript?.directCandidates)
    ? parsedTranscript.directCandidates
    : [];
  const declarationCandidates = Array.isArray(parsedTranscript?.declarationCandidates)
    ? parsedTranscript.declarationCandidates
    : [];
  const candidates = [...directCandidates, ...declarationCandidates];
  const candidateWordCount = candidates.reduce((sum, candidate) => {
    const wordIndices = Array.isArray(candidate?.wordIndices) ? candidate.wordIndices : [];
    if (wordIndices.length) return sum + wordIndices.length;
    return sum + asText(candidate?.text).split(/\s+/).filter(Boolean).length;
  }, 0);
  const estimated =
    800 +
    candidates.length * 80 +
    candidateWordCount * 20 +
    words.length * 8;

  return Math.min(
    CANDIDATE_EXTRACTION_MAX_TOKENS,
    Math.max(CANDIDATE_EXTRACTION_MIN_TOKENS, estimated),
  );
}

async function extractIngredientCandidates({
  transcriptLines,
  indexedTranscript,
  analysisOptions,
  env = process.env,
}) {
  const seedTranscript = indexedTranscript || parseIngredientLabelTranscript(transcriptLines);

  const cacheKey = buildTranscriptCacheKey({
    transcriptLines,
    promptVersion: CANDIDATE_EXTRACTION_PROMPT_VERSION,
  });

  if (!analysisOptions.disableCache) {
    const cached = getCachedCandidateExtraction(cacheKey);
    if (cached) {
      const parsedTranscript = buildParsedTranscriptFromCandidateExtraction({
        transcriptLines,
        extractionPayload: cached,
        seedTranscript,
      });
      if (
        !parsedTranscript.directCandidates.length &&
        !parsedTranscript.declarationCandidates.length
      ) {
        throw new Error("Ingredient candidate extraction returned no candidates.");
      }
      return {
        parsedTranscript,
        debug: {
          provider: "openai",
          model: PINNED_OPENAI_MODEL,
          reasoningEffort: CANDIDATE_EXTRACTION_REASONING_EFFORT,
        },
      };
    }
  }

  const { systemPrompt, userPrompt } = buildIngredientCandidateExtractionPrompts({
    transcriptLines,
    indexedWordList: seedTranscript?.indexedWordList,
  });

  let result;
  result = await runWithProviderSelection({
    routeId: "ingredient-candidate-extraction",
    promptClass: "ingredientCandidateExtraction",
    requestSummary: {
      transcriptLineCount: Array.isArray(transcriptLines) ? transcriptLines.length : 0,
      promptVersion: CANDIDATE_EXTRACTION_PROMPT_VERSION,
    },
    invokeProvider: async (provider) => {
      if (provider !== "openai") {
        throw new Error("Ingredient candidate extraction is pinned to OpenAI for this route.");
      }

      const response = await runOpenAiCandidateExtraction({
        systemPrompt,
        userPrompt,
        maxTokens: estimateCandidateExtractionMaxTokens(seedTranscript),
        metadata: {
          route_id: "ingredient-candidate-extraction",
          prompt_version: CANDIDATE_EXTRACTION_PROMPT_VERSION,
        },
        env,
      });

      return {
        ...response,
        normalizedOutput:
          response?.parsed && typeof response.parsed === "object" ? response.parsed : {},
      };
    },
    env,
  });

  if (!analysisOptions.disableCache) {
    setCachedCandidateExtraction(cacheKey, result.normalizedOutput);
  }

  const parsedTranscript = buildParsedTranscriptFromCandidateExtraction({
    transcriptLines,
    extractionPayload: result.normalizedOutput,
    seedTranscript,
  });
  if (
    !parsedTranscript.directCandidates.length &&
    !parsedTranscript.declarationCandidates.length
  ) {
    throw new Error("Ingredient candidate extraction returned no candidates.");
  }
  return {
    parsedTranscript,
    debug: {
      provider: asText(result?.provider) || "openai",
      model: asText(result?.model) || PINNED_OPENAI_MODEL,
      reasoningEffort: CANDIDATE_EXTRACTION_REASONING_EFFORT,
    },
  };
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

function buildCandidateDebugPayload({
  parsedTranscript,
  resolvedDeclarationFlags,
  unresolvedDeclarationCandidates,
  safeCatalogDirectCandidates,
  aiReviewDirectCandidates,
  riskyCatalogMatchedDirectCandidates,
  aiCandidates,
  safeTableMatches,
  candidateExtractionDebug,
}) {
  const matchedEntriesByCandidateText =
    safeTableMatches?.matchedEntriesByCandidateText &&
    typeof safeTableMatches.matchedEntriesByCandidateText === "object"
      ? safeTableMatches.matchedEntriesByCandidateText
      : {};
  const directIngredientTexts = Array.isArray(parsedTranscript?.parsedIngredientsList)
    ? parsedTranscript.parsedIngredientsList
    : [];
  const declarationsSentToAiTexts = (Array.isArray(unresolvedDeclarationCandidates)
    ? unresolvedDeclarationCandidates
    : []
  )
    .map((candidate) => asText(candidate?.text))
    .filter(Boolean);
  const catalogBypassedDirectIngredientTexts = (Array.isArray(safeCatalogDirectCandidates)
    ? safeCatalogDirectCandidates
    : []
  )
    .map((candidate) => asText(candidate?.text))
    .filter(Boolean);
  const directIngredientsSentToAiTexts = (Array.isArray(aiReviewDirectCandidates)
    ? aiReviewDirectCandidates
    : []
  )
    .map((candidate) => asText(candidate?.text))
    .filter(Boolean);
  const riskyCatalogMatchedDirectIngredientTexts = (Array.isArray(riskyCatalogMatchedDirectCandidates)
    ? riskyCatalogMatchedDirectCandidates
    : []
  )
    .map((candidate) => asText(candidate?.text))
    .filter(Boolean);
  return {
    ingredientExtractionMethod: asText(parsedTranscript?.extractionMethod) || "ai",
    parsedIngredientsList: directIngredientTexts,
    directIngredientCount: directIngredientTexts.length,
    directIngredientTexts,
    catalogBypassedDirectIngredientCount: catalogBypassedDirectIngredientTexts.length,
    catalogBypassedDirectIngredientTexts,
    directIngredientsSentToAiCount: directIngredientsSentToAiTexts.length,
    directIngredientsSentToAiTexts,
    riskyCatalogMatchedDirectIngredientCount: riskyCatalogMatchedDirectIngredientTexts.length,
    riskyCatalogMatchedDirectIngredientTexts,
    resolvedDeclarationCandidateCount: Array.isArray(resolvedDeclarationFlags)
      ? resolvedDeclarationFlags.length
      : 0,
    resolvedDeclarationCandidateTexts: (Array.isArray(resolvedDeclarationFlags)
      ? resolvedDeclarationFlags
      : []
    )
      .map((flag) => asText(flag?.ingredient))
      .filter(Boolean),
    unresolvedDeclarationCandidateCount: Array.isArray(unresolvedDeclarationCandidates)
      ? unresolvedDeclarationCandidates.length
      : 0,
    unresolvedDeclarationCandidateTexts: declarationsSentToAiTexts,
    declarationsSentToAiCount: declarationsSentToAiTexts.length,
    declarationsSentToAiTexts,
    aiReviewInputCount: Array.isArray(aiCandidates) ? aiCandidates.length : 0,
    aiReviewDirectIngredientCount: directIngredientsSentToAiTexts.length,
    aiReviewDeclarationCount: declarationsSentToAiTexts.length,
    aiCandidateCount: Array.isArray(aiCandidates) ? aiCandidates.length : 0,
    aiCandidateTexts: (Array.isArray(aiCandidates) ? aiCandidates : [])
      .map((candidate) => asText(candidate?.text))
      .filter(Boolean),
    safeIngredientTableSource:
      asText(safeTableMatches?.sourceLabel) || "safe-ingredient-table",
    safeIngredientTablePath: asText(safeTableMatches?.sourcePath),
    safeIngredientTableStatus:
      asText(safeTableMatches?.tableStatus) || "unknown",
    safeIngredientTableVersionKey: asText(safeTableMatches?.tableVersionKey),
    safeIngredientTableRowCount: Number.isFinite(Number(safeTableMatches?.tableRowCount))
      ? Math.max(0, Math.trunc(Number(safeTableMatches.tableRowCount)))
      : 0,
    safeIngredientTableError: asText(safeTableMatches?.tableError),
    safeTableMatchedCandidateCount: Number.isFinite(
      Number(safeTableMatches?.matchedCandidateCount),
    )
      ? Math.max(0, Math.trunc(Number(safeTableMatches.matchedCandidateCount)))
      : 0,
    safeTableMatchedCandidateTexts: Array.isArray(safeTableMatches?.matchedCandidateTexts)
      ? safeTableMatches.matchedCandidateTexts
      : [],
    safeTableMatchedEntriesByCandidateText: matchedEntriesByCandidateText,
    safeTableBypassedDirectIngredientCount: catalogBypassedDirectIngredientTexts.length,
    safeTableBypassedDirectIngredientTexts: catalogBypassedDirectIngredientTexts,
    riskySafeTableMatchedDirectIngredientCount:
      riskyCatalogMatchedDirectIngredientTexts.length,
    riskySafeTableMatchedDirectIngredientTexts:
      riskyCatalogMatchedDirectIngredientTexts,
    catalogMatchedCandidateCount: Number.isFinite(
      Number(safeTableMatches?.matchedCandidateCount),
    )
      ? Math.max(0, Math.trunc(Number(safeTableMatches.matchedCandidateCount)))
      : 0,
    catalogMatchedCandidateTexts: Array.isArray(safeTableMatches?.matchedCandidateTexts)
      ? safeTableMatches.matchedCandidateTexts
      : [],
    catalogMatchedEntriesByCandidateText: matchedEntriesByCandidateText,
    candidateExtractionProvider: asText(candidateExtractionDebug?.provider) || "openai",
    candidateExtractionModel:
      asText(candidateExtractionDebug?.model) || PINNED_OPENAI_MODEL,
    candidateExtractionReasoningEffort:
      asText(candidateExtractionDebug?.reasoningEffort) ||
      CANDIDATE_EXTRACTION_REASONING_EFFORT,
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

  const buildDebugPayload = (
    {
      pass1Used = false,
      pass2Used = false,
      fallbackReason = null,
      provider = "openai",
      model = PINNED_OPENAI_MODEL,
      reasoningEffort = OPENAI_REASONING_EFFORT,
      agentStrategy = "parallel-dual-analysis-with-conflict-verification",
      agentAUsed = false,
      agentBUsed = false,
      agentAgreement = "not-run",
      adjudicationUsed = false,
    } = {},
    extra = {},
  ) => ({
    promptVersion: PROMPT_VERSION,
    provider,
    model,
    reasoningEffort,
    analysisProvider: provider,
    analysisModel: model,
    analysisReasoningEffort: reasoningEffort,
    agentStrategy,
    pass1Used,
    pass2Used,
    pass2Applied: pass2Used,
    agentAUsed,
    agentBUsed,
    agentAgreement,
    adjudicationUsed,
    fallbackReason: asText(fallbackReason) || null,
    ...(extra && typeof extra === "object" ? extra : {}),
  });

  if (!transcriptLines.length) {
    const payload = { success: true, flags: [], parsedIngredientsList: [] };
    if (analysisOptions.debug) {
      payload.debug = buildDebugPayload({ fallbackReason: "empty-transcript" });
    }
    return corsJson(payload, { status: 200 });
  }

  try {
    const openAiEnv = {
      ...process.env,
      AI_PROVIDER: "openai",
      OPENAI_MODEL_INGREDIENT_FLAGS: PINNED_OPENAI_MODEL,
    };
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

    const normalizeCandidateFlagsFromResponse = (parsedResponse) =>
      (Array.isArray(parsedResponse?.flags) ? parsedResponse.flags : [])
        .map((flag) => {
          return {
            candidate_id: asText(flag?.candidate_id || flag?.candidateId),
            allergens: mapAllergens(flag),
            diets: mapDiets(flag),
          };
        })
        .filter((flag) =>
          flag.candidate_id && (flag.allergens.length || flag.diets.length),
        );

    const indexedTranscript = parseIngredientLabelTranscript(transcriptLines);
    const {
      parsedTranscript,
      debug: candidateExtractionDebug,
    } = await extractIngredientCandidates({
      transcriptLines,
      indexedTranscript,
      analysisOptions,
      env: openAiEnv,
    });
    const aiDirectCandidates = Array.isArray(parsedTranscript.directCandidates)
      ? parsedTranscript.directCandidates
      : [];
    const safeTableMatches = await fetchSafeIngredientTableMatches({
      candidateTexts: parsedTranscript.parsedIngredientsList,
      disableCache: analysisOptions.disableCache,
    });
    const {
      safeCatalogDirectCandidates,
      aiReviewDirectCandidates,
      riskyCatalogMatchedDirectCandidates,
    } = partitionDirectCandidatesForAiReview({
      directCandidates: aiDirectCandidates,
      safeTableMatches,
    });
    const allergenAliasMap = buildAllergenAliasMap(config?.allergens);
    const dietsByAllergen = buildDietsByAllergenIndex(config?.dietAllergenConflicts);
    const {
      resolvedFlags: resolvedDeclarationFlags,
      unresolvedCandidates: unresolvedDeclarationCandidates,
    } = resolveExplicitDeclarationCandidates({
      declarationCandidates: parsedTranscript.declarationCandidates,
      allergenAliasMap,
      dietsByAllergen,
    });
    const aiCandidates = [...aiReviewDirectCandidates, ...unresolvedDeclarationCandidates];
    const candidateDebugPayload = buildCandidateDebugPayload({
      parsedTranscript,
      resolvedDeclarationFlags,
      unresolvedDeclarationCandidates,
      safeCatalogDirectCandidates,
      aiReviewDirectCandidates,
      riskyCatalogMatchedDirectCandidates,
      aiCandidates,
      safeTableMatches: analysisOptions.debug ? safeTableMatches : null,
      candidateExtractionDebug,
    });
    const safeTableVersionKey = asText(safeTableMatches?.tableVersionKey) || "missing";
    const analysisCacheKey = buildAnalysisCacheKey({
      transcriptLines,
      allergenEntries: allergenCodebook.entries,
      dietEntries: dietCodebook.entries,
      promptVersion: `${PROMPT_VERSION}|${CANDIDATE_EXTRACTION_PROMPT_VERSION}|${safeTableVersionKey}`,
    });
    if (!analysisOptions.disableCache) {
      const cachedFlags = getCachedAnalysis(analysisCacheKey);
      if (cachedFlags !== null) {
        const payload = {
          success: true,
          flags: cachedFlags,
          parsedIngredientsList: parsedTranscript.parsedIngredientsList,
        };
        if (analysisOptions.debug) {
          payload.debug = buildDebugPayload(
            {
              pass1Used: false,
              pass2Used: false,
              fallbackReason: "cache-hit",
              agentAgreement: "cache-hit",
            },
            candidateDebugPayload,
          );
        }
        return corsJson(payload, { status: 200 });
      }
    }

    if (!aiCandidates.length) {
      const payload = {
        success: true,
        flags: resolvedDeclarationFlags,
        parsedIngredientsList: parsedTranscript.parsedIngredientsList,
      };
      if (analysisOptions.debug) {
        payload.debug = buildDebugPayload(
          {
            pass1Used: false,
            pass2Used: false,
            fallbackReason: resolvedDeclarationFlags.length
              ? "deterministic-declarations-only"
              : "no-candidates",
            agentAgreement: "not-run",
          },
          candidateDebugPayload,
        );
      }
      if (!analysisOptions.disableCache) {
        setCachedAnalysis(analysisCacheKey, resolvedDeclarationFlags);
      }
      return corsJson(payload, { status: 200 });
    }

    const allergenCodebookText = buildPromptCodebookLines(allergenCodebook.entries);
    const dietCodebookText = buildPromptCodebookLines(dietCodebook.entries);
    const candidateListText = buildCandidateListText(aiCandidates);
    const candidateById = new Map(
      aiCandidates.map((candidate) => [asText(candidate?.id), candidate]),
    );

    const extractionPrompts = buildIngredientAllergenExtractionPrompts({
      allergenCodebookText,
      dietCodebookText,
      candidateListText,
      promptVersion: PROMPT_VERSION,
    });

    const result = await runWithProviderSelection({
      routeId: "ingredient-allergen-analysis",
      promptClass: "ingredientAllergenAnalysis",
      requestSummary: {
        transcriptLineCount: transcriptLines.length,
        parsedIngredientCount: parsedTranscript.parsedIngredientsList.length,
        aiCandidateCount: aiCandidates.length,
        resolvedDeclarationCandidateCount: resolvedDeclarationFlags.length,
        promptVersion: PROMPT_VERSION,
      },
      invokeProvider: async (provider) => {
        if (provider !== "openai") {
          throw new Error("Ingredient allergen analysis is pinned to OpenAI for this route.");
        }

        const buildMetadata = (phase, agent) => ({
          route_id: "ingredient-allergen-analysis",
          phase,
          agent,
          prompt_version: PROMPT_VERSION,
        });
        const [agentASettled, agentBSettled] = await Promise.allSettled([
          runOpenAiFlagAnalysis({
            systemPrompt: extractionPrompts.systemPrompt,
            userPrompt: extractionPrompts.userPrompt,
            maxTokens: ANALYSIS_MAX_TOKENS,
            phaseName: "agent-a-analysis",
            metadata: buildMetadata("analysis", "agent-a"),
            env: openAiEnv,
          }),
          runOpenAiFlagAnalysis({
            systemPrompt: extractionPrompts.systemPrompt,
            userPrompt: extractionPrompts.userPrompt,
            maxTokens: ANALYSIS_MAX_TOKENS,
            phaseName: "agent-b-analysis",
            metadata: buildMetadata("analysis", "agent-b"),
            env: openAiEnv,
          }),
        ]);

        const agentAResponse =
          agentASettled.status === "fulfilled" ? agentASettled.value : null;
        const agentBResponse =
          agentBSettled.status === "fulfilled" ? agentBSettled.value : null;
        const agentAFlags = agentAResponse
          ? normalizeCandidateFlagsFromResponse(agentAResponse.parsed)
          : null;
        const agentBFlags = agentBResponse
          ? normalizeCandidateFlagsFromResponse(agentBResponse.parsed)
          : null;

        let adjudicationResponse = null;
        let fallbackReason = "";
        let finalFlags = [];
        let agentAgreement = "not-run";

        if (agentAFlags && agentBFlags) {
          if (candidateFlagConsensusMatches(agentAFlags, agentBFlags)) {
            finalFlags = agentAFlags;
            agentAgreement = "agreed";
          } else {
            try {
              const verificationPrompts = buildIngredientAllergenConflictVerificationPrompts({
                allergenCodebookText,
                dietCodebookText,
                candidateListText,
                agentAFlagsJson: serializeStructuredFlags(agentAResponse.parsed),
                agentBFlagsJson: serializeStructuredFlags(agentBResponse.parsed),
                promptVersion: PROMPT_VERSION,
              });

              adjudicationResponse = await runOpenAiFlagAnalysis({
                systemPrompt: verificationPrompts.systemPrompt,
                userPrompt: verificationPrompts.userPrompt,
                maxTokens: VERIFICATION_MAX_TOKENS,
                phaseName: "conflict-verification",
                metadata: buildMetadata("verification", "adjudicator"),
                env: openAiEnv,
              });
              finalFlags = normalizeCandidateFlagsFromResponse(adjudicationResponse.parsed);
              agentAgreement = "conflict-resolved";
            } catch (verificationError) {
              finalFlags = agentAFlags;
              agentAgreement = "conflict-fallback-agent-a";
              fallbackReason =
                `adjudication-failed:${asText(verificationError?.message) || "unknown"}`;
            }
          }
        } else if (agentAFlags || agentBFlags) {
          finalFlags = agentAFlags || agentBFlags || [];
          agentAgreement = "single-agent-fallback";
          if (!agentAFlags) {
            fallbackReason =
              `agent-a-failed:${asText(agentASettled.reason?.message || agentASettled.reason) || "unknown"}`;
          } else if (!agentBFlags) {
            fallbackReason =
              `agent-b-failed:${asText(agentBSettled.reason?.message || agentBSettled.reason) || "unknown"}`;
          }
        } else {
          const failures = [agentASettled, agentBSettled]
            .filter((entry) => entry.status === "rejected")
            .map((entry, index) =>
              `agent-${index === 0 ? "a" : "b"}:${asText(entry.reason?.message || entry.reason) || "unknown"}`,
            );
          throw new Error(
            failures.join("; ") || "Failed to analyze ingredient transcript.",
          );
        }

        const publicFlags = mapCandidateFlagsToPublicFlags(finalFlags, candidateById);
        const combinedFlags = [...resolvedDeclarationFlags, ...publicFlags];
        const completedResponses = [agentAResponse, agentBResponse].filter(Boolean);
        if (adjudicationResponse) {
          completedResponses.push(adjudicationResponse);
        }

        return {
          provider: "openai",
          model:
            asText(adjudicationResponse?.model) ||
            asText(agentAResponse?.model) ||
            asText(agentBResponse?.model) ||
            PINNED_OPENAI_MODEL,
          latencyMs: buildAggregateLatencyMs(
            [agentAResponse, agentBResponse],
            adjudicationResponse ? [adjudicationResponse] : [],
          ),
          usage: sumUsage(completedResponses),
          rawText: completedResponses.map((response) => response.text).filter(Boolean).join("\n\n"),
          normalizedOutput: {
            flags: combinedFlags,
            debug: buildDebugPayload(
              {
                pass1Used: Boolean(agentAResponse || agentBResponse),
                pass2Used: Boolean(adjudicationResponse),
                provider: "openai",
                model:
                  asText(adjudicationResponse?.model) ||
                  asText(agentAResponse?.model) ||
                  asText(agentBResponse?.model) ||
                  PINNED_OPENAI_MODEL,
                reasoningEffort: OPENAI_REASONING_EFFORT,
                agentAUsed: Boolean(agentAResponse),
                agentBUsed: Boolean(agentBResponse),
                agentAgreement,
                adjudicationUsed: Boolean(adjudicationResponse),
                fallbackReason,
              },
              candidateDebugPayload,
            ),
          },
        };
      },
      env: openAiEnv,
    });
    const finalFlags = result.normalizedOutput.flags;
    const debugPayload = result.normalizedOutput.debug;

    if (!analysisOptions.disableCache) {
      setCachedAnalysis(analysisCacheKey, finalFlags);
    }

    const payload = {
      success: true,
      flags: finalFlags,
      parsedIngredientsList: parsedTranscript.parsedIngredientsList,
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
      parsedIngredientsList: [],
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
