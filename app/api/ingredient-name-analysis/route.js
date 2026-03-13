import { corsJson, corsOptions } from "../_shared/cors";
import {
  buildIngredientNameAnalysisPrompts,
  buildIngredientNameRepairPrompts,
} from "../../lib/claudePrompts";
import {
  callAnthropicApi,
  callOpenAiApi,
  createTextMessage,
  runWithProviderSelection,
} from "../../lib/server/ai/providerRuntime";
import { ingredientNameAnalysisSchema } from "../../lib/server/ai/responseSchemas";
import {
  findIngredientCatalogEntryByName,
  isSafeIngredientCatalogEntry,
} from "../../lib/server/ingredientCatalog";

export const runtime = "nodejs";

const ANTHROPIC_THINKING_BUDGET_TOKENS = 1024;
const ANTHROPIC_MIN_OUTPUT_TOKENS = 220;
const MAX_ANALYSIS_ATTEMPTS = 3;
const CONFIG_TTL_MS = 5 * 60 * 1000;

let cachedConfig = null;
let cachedConfigAt = 0;

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

function buildPromptCodebookLines(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => `${entry.code} = ${entry.value}`)
    .join("\n");
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
  cachedConfigAt = now;
  return cachedConfig;
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

async function repairJsonResponse(rawOutput) {
  const { systemPrompt: repairSystemPrompt, userPrompt: repairUserPrompt } =
    buildIngredientNameRepairPrompts(rawOutput);
  return await callAnthropicApi({
    promptClass: "ingredientNameAnalysis",
    systemPrompt: repairSystemPrompt,
    messages: [{ role: "user", content: [createTextMessage(repairUserPrompt)] }],
    maxTokens: 320,
  });
}

async function runAnthropicNameAnalysis({ systemPrompt, userPrompt }) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ANALYSIS_ATTEMPTS; attempt += 1) {
    try {
      const response = await callAnthropicApi({
        promptClass: "ingredientNameAnalysis",
        systemPrompt,
        messages: [{ role: "user", content: [createTextMessage(userPrompt)] }],
        maxTokens: 520,
        thinkingBudgetTokens: ANTHROPIC_THINKING_BUDGET_TOKENS,
      });
      const parsed = parseClaudeJson(response.text);
      if (parsed && typeof parsed === "object") {
        return {
          ...response,
          parsed,
        };
      }

      const repairedResponse = await repairJsonResponse(response.text.slice(0, 8000));
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

      lastError = new Error("Ingredient name analyzer returned malformed JSON output.");
    } catch (error) {
      lastError = error;
      if (!isTransientFailure(error) || attempt >= MAX_ANALYSIS_ATTEMPTS) {
        break;
      }
      await sleep(attempt * 250);
    }
  }

  throw lastError || new Error("Ingredient name analysis failed.");
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsJson(
      {
        success: false,
        allergens: [],
        diets: [],
        reasoning: "",
        error: "Invalid JSON payload.",
      },
      { status: 400 },
    );
  }

  const ingredientName = asText(body?.ingredientName);
  const dishName = asText(body?.dishName);
  if (!ingredientName) {
    return corsJson(
      {
        success: false,
        allergens: [],
        diets: [],
        reasoning: "",
        error: "ingredientName is required.",
      },
      { status: 400 },
    );
  }

  try {
    try {
      const catalogEntry = await findIngredientCatalogEntryByName(ingredientName);
      if (isSafeIngredientCatalogEntry(catalogEntry)) {
        return corsJson(
          {
            success: true,
            allergens: Array.isArray(catalogEntry.allergens)
              ? catalogEntry.allergens
              : [],
            diets: Array.isArray(catalogEntry.diets) ? catalogEntry.diets : [],
            reasoning: `Matched known-safe ingredient catalog entry "${catalogEntry.canonicalName || ingredientName}".`,
          },
          { status: 200 },
        );
      }
    } catch (catalogError) {
      console.warn("Ingredient catalog lookup unavailable:", catalogError);
    }

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

    const veganLabel = findDietLabel("Vegan");
    const vegetarianLabel = findDietLabel("Vegetarian");
    const pescatarianLabel = findDietLabel("Pescatarian");
    const glutenFreeLabel = findDietLabel("Gluten-free", "Gluten Free");
    const resolveDietAlias = buildDietAliasResolver({
      glutenFreeLabel,
      pescatarianLabel,
    });

    const expandDietHierarchy = (diets) => {
      const out = new Set(dedupeStrings(diets));
      if (veganLabel && out.has(veganLabel)) {
        if (vegetarianLabel) out.add(vegetarianLabel);
        if (pescatarianLabel) out.add(pescatarianLabel);
      }
      if (vegetarianLabel && out.has(vegetarianLabel)) {
        if (pescatarianLabel) out.add(pescatarianLabel);
      }
      return Array.from(out);
    };

    const allergenCodebookText = buildPromptCodebookLines(allergenCodebook.entries);
    const dietCodebookText = buildPromptCodebookLines(dietCodebook.entries);
    const { systemPrompt, userPrompt } = buildIngredientNameAnalysisPrompts({
      allergenCodebookText,
      dietCodebookText,
      ingredientName,
      dishName,
    });

    const result = await runWithProviderSelection({
      routeId: "ingredient-name-analysis",
      promptClass: "ingredientNameAnalysis",
      requestSummary: {
        ingredientName,
        dishName,
      },
      invokeProvider: async (provider) => {
        const response =
          provider === "openai"
            ? await callOpenAiApi({
                promptClass: "ingredientNameAnalysis",
                systemPrompt,
                messages: [{ role: "user", content: [createTextMessage(userPrompt)] }],
                maxTokens: 520,
                jsonSchema: ingredientNameAnalysisSchema,
                reasoningEffort: "medium",
              })
            : await runAnthropicNameAnalysis({
                systemPrompt,
                userPrompt,
              });

        const parsed =
          response?.parsed && typeof response.parsed === "object"
            ? response.parsed
            : parseClaudeJson(response.text);
        if (!parsed || typeof parsed !== "object") {
          throw new Error("Ingredient name analysis failed.");
        }

        const allergens = dedupeStrings([
          ...parseCodeList(parsed?.allergen_codes, allergenCodebook.codeToValue),
          ...parseLegacyList(parsed?.allergens, allergenCodebook.tokenToValue),
        ]);

        const diets = expandDietHierarchy([
          ...parseCodeList(parsed?.diet_codes, dietCodebook.codeToValue),
          ...parseLegacyList(parsed?.diets, dietCodebook.tokenToValue, resolveDietAlias),
        ]);

        return {
          ...response,
          normalizedOutput: {
            allergens,
            diets,
            reasoning: asText(parsed?.reasoning),
          },
        };
      },
    });

    return corsJson(
      {
        success: true,
        allergens: result.normalizedOutput.allergens,
        diets: result.normalizedOutput.diets,
        reasoning: result.normalizedOutput.reasoning,
      },
      { status: 200 },
    );
  } catch (error) {
    return corsJson(
      {
        success: false,
        allergens: [],
        diets: [],
        reasoning: "",
        error: asText(error?.message) || "Ingredient name analysis failed.",
      },
      { status: 200 },
    );
  }
}
