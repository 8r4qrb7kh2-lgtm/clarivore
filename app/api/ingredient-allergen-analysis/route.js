import { corsJson, corsOptions } from "../_shared/cors";

export const runtime = "nodejs";

const PINNED_ANTHROPIC_MODEL = "claude-sonnet-4-5";
const MAX_ANALYSIS_ATTEMPTS = 2;
const ANALYSIS_MAX_TOKENS = 1100;
const REPAIR_MAX_TOKENS = 700;

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
  return `${normalizedLines}::${allergenKey}::${dietKey}`;
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
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  maxTokens = ANALYSIS_MAX_TOKENS,
}) {
  const safeMaxTokens = Math.max(Number(maxTokens) || 0, 400);

  const requestPayload = {
    model: asText(model) || PINNED_ANTHROPIC_MODEL,
    max_tokens: safeMaxTokens,
    temperature: 0,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(requestPayload),
  });

  const payloadText = await response.text();
  let payload = null;
  try {
    payload = payloadText ? JSON.parse(payloadText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      asText(payload?.error?.message) ||
      asText(payload?.error) ||
      asText(payloadText) ||
      "Anthropic API request failed.";
    throw new Error(message);
  }

  const content = Array.isArray(payload?.content) ? payload.content : [];
  const text = content
    .filter(
      (block) =>
        block &&
        typeof block === "object" &&
        typeof block.text === "string" &&
        (block.type === "text" || block.type === "output_text" || !block.type),
    )
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text || asText(payload?.content);
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

async function repairJsonResponse({ apiKey, model, rawOutput }) {
  const repairSystemPrompt = `You repair malformed JSON.
Return ONLY valid JSON with this exact shape:
{
  "flags": [
    {
      "ingredient": "name",
      "word_indices": [0],
      "allergen_codes": [1],
      "diet_codes": [1],
      "risk_type": "contained"
    }
  ]
}`;
  const repairUserPrompt = `Repair this output into valid JSON only. Do not add markdown.

${rawOutput}`;

  return await callAnthropicText({
    apiKey,
    model,
    systemPrompt: repairSystemPrompt,
    userPrompt: repairUserPrompt,
    maxTokens: REPAIR_MAX_TOKENS,
  });
}

async function runFlagAnalysis({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ANALYSIS_ATTEMPTS; attempt += 1) {
    try {
      const responseText = await callAnthropicText({
        apiKey,
        model,
        systemPrompt,
        userPrompt,
        maxTokens: ANALYSIS_MAX_TOKENS,
      });

      const parsed = parseClaudeJson(responseText);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.flags)) {
        return parsed;
      }

      const repairedText = await repairJsonResponse({
        apiKey,
        model,
        rawOutput: responseText.slice(0, 8000),
      });
      const repaired = parseClaudeJson(repairedText);
      if (repaired && typeof repaired === "object" && Array.isArray(repaired.flags)) {
        return repaired;
      }

      lastError = new Error("Ingredient allergen analyzer returned malformed JSON output.");
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

  if (!transcriptLines.length) {
    return corsJson({ success: true, flags: [] }, { status: 200 });
  }

  const anthropicApiKey = asText(process.env.ANTHROPIC_API_KEY);
  const anthropicModel =
    asText(process.env.ANTHROPIC_MODEL_INGREDIENT_FLAGS) ||
    asText(process.env.ANTHROPIC_MODEL) ||
    PINNED_ANTHROPIC_MODEL;

  if (!anthropicApiKey) {
    return corsJson(
      {
        success: false,
        error: "ANTHROPIC_API_KEY is not configured.",
        flags: [],
      },
      { status: 500 },
    );
  }

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

    const analysisCacheKey = buildAnalysisCacheKey({
      transcriptLines,
      allergenEntries: allergenCodebook.entries,
      dietEntries: dietCodebook.entries,
    });
    const cachedFlags = getCachedAnalysis(analysisCacheKey);
    if (cachedFlags !== null) {
      return corsJson(
        {
          success: true,
          flags: cachedFlags,
        },
        { status: 200 },
      );
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

    const systemPrompt = `You are an allergen and dietary preference analyzer for a restaurant allergen awareness system.
Return only valid JSON.

Analyze transcripted ingredient-label lines and return allergen/diet flags tied to word indices.
Use ONLY numeric codes from these codebooks.

Allergen codebook:
${allergenCodebookText}

Diet codebook:
${dietCodebookText}

CRITICAL ALLERGEN RULES:
- ONLY flag allergens from the codebook list.
- Do NOT flag "gluten" as a separate allergen.
- Oats by themselves are NOT wheat unless wheat is explicitly present.

RISK TYPES:
- "contained" for direct ingredients or explicit contains statements.
- "cross-contamination" for may contain/shared facility style risk.

PHRASE + WORD INDEX RULES:
- Define each flagged ingredient phrase strictly by delimiter boundaries.
- Start at the first word immediately after the nearest previous comma (or semicolon), or line start if none.
- End at the last word immediately before the next comma (or semicolon), or line end if none.
- "ingredient" must be exactly that bounded phrase and must not be a parent/group phrase.
- "word_indices" must include ALL and ONLY words from that exact bounded phrase.
- "word_indices" must be unique and sorted ascending.
- For a single-word ingredient phrase, return exactly one index.
- Do NOT include section-heading/context tokens (e.g. "INGREDIENTS:", "CONTAINS") unless they are part of that exact bounded ingredient phrase.
- If an allergen is in a sub-ingredient phrase, do NOT return the broader parent phrase name.
- Always use 0-based word indices from the provided numbered transcript list.

DIET PRECISION RULES:
- Add diet codes only when directly justified by ingredient evidence in that phrase.
- Do NOT infer broader diet failures from stricter diets.
- If one phrase indicates a Vegan violation, do not auto-add Vegetarian/Pescatarian unless separately justified.
- For wheat/gluten evidence, prefer Gluten-free only (unless additional direct evidence supports other diet violations).

EXPLICIT STATEMENT PRIORITY:
- Treat "contains" statements as direct/contained risk for listed allergens.
- Treat "may contain" and shared-facility statements as cross-contamination risk.
- When explicit statements appear, prioritize those signals over weaker contextual inference.

EXAMPLES:
- Positive: "Wheat flour" -> include allergen wheat, include Gluten-free diet violation.
- Negative: "Wheat flour" -> do NOT include Vegan, Vegetarian, or Pescatarian diet violations from that phrase alone.
- Delimiter-boundary positive: "Confectionery Coating (Allulose, Sustainable Palm Kernel And Palm Oil, Whole Milk Powder, Tapioca Fiber, Cocoa Processed With Alkali, Sunflower Lecithin)" with milk evidence -> ingredient must be exactly "Whole Milk Powder".
- Delimiter-boundary negative: For the same line, do NOT return "Confectionery Coating (Allulose, Sustainable Palm Kernel And Palm Oil, Whole Milk Powder, Tapioca Fiber, Cocoa Processed With Alkali, Sunflower Lecithin)" as the milk ingredient phrase.

Return ONLY JSON:
{
  "flags": [
    {
      "ingredient": "Wheat flour",
      "word_indices": [45, 46],
      "allergen_codes": [1],
      "diet_codes": [2],
      "risk_type": "contained"
    }
  ]
}`;

    const userPrompt = `Here is the transcript with each word numbered (0-based):
${indexedWordList}

Use the numbered list above for word_indices. Do not compute your own indices outside this list.`;

    const parsed = await runFlagAnalysis({
      apiKey: anthropicApiKey,
      model: anthropicModel,
      systemPrompt,
      userPrompt,
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

    const flags = (Array.isArray(parsed?.flags) ? parsed.flags : [])
      .map((flag) => {
        const riskRaw = asText(flag?.risk_type).toLowerCase();
        const risk_type = riskRaw.includes("cross")
          ? "cross-contamination"
          : "contained";

        const word_indices = (Array.isArray(flag?.word_indices) ? flag.word_indices : [])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value >= 0)
          .map((value) => Math.trunc(value));

        return {
          ingredient: asText(flag?.ingredient),
          word_indices,
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

    setCachedAnalysis(analysisCacheKey, flags);

    return corsJson(
      {
        success: true,
        flags,
      },
      { status: 200 },
    );
  } catch (error) {
    return corsJson(
      {
        success: false,
        error: asText(error?.message) || "Failed to analyze ingredient transcript.",
        flags: [],
      },
      { status: 200 },
    );
  }
}
