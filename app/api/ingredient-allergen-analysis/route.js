import { corsJson, corsOptions } from "../_shared/cors";

export const runtime = "nodejs";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

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

function parseClaudeJson(responseText) {
  const value = asText(responseText);
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        // continue
      }
    }

    const objectMatch = value.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }

    return null;
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

async function callAnthropicText({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  maxTokens = 1200,
}) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: asText(model) || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
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

function expandDietHierarchy({
  diets,
  veganLabel,
  vegetarianLabel,
  pescatarianLabel,
}) {
  const out = new Set((Array.isArray(diets) ? diets : []).filter((d) => typeof d === "string"));
  if (veganLabel && out.has(veganLabel)) {
    if (vegetarianLabel) out.add(vegetarianLabel);
    if (pescatarianLabel) out.add(pescatarianLabel);
  }
  if (vegetarianLabel && out.has(vegetarianLabel)) {
    if (pescatarianLabel) out.add(pescatarianLabel);
  }
  return Array.from(out);
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
    asText(process.env.ANTHROPIC_MODEL) || DEFAULT_ANTHROPIC_MODEL;

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

    const veganLabel = findDietLabel("Vegan");
    const vegetarianLabel = findDietLabel("Vegetarian");
    const pescatarianLabel = findDietLabel("Pescatarian");
    const glutenFreeLabel = findDietLabel("Gluten-free", "Gluten Free");

    const resolveDietAlias = buildDietAliasResolver({
      glutenFreeLabel,
      pescatarianLabel,
    });

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
Think carefully and step-by-step before answering, but only output valid JSON.

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

Return ONLY JSON:
{
  "flags": [
    {
      "ingredient": "WHEAT",
      "word_indices": [45],
      "allergen_codes": [1],
      "diet_codes": [2],
      "risk_type": "contained"
    }
  ]
}`;

    const userPrompt = `Here is the transcript with each word numbered (0-based):
${indexedWordList}

Use the numbered list above for word_indices. Do not compute your own indices outside this list.`;

    const responseText = await callAnthropicText({
      apiKey: anthropicApiKey,
      model: anthropicModel,
      systemPrompt,
      userPrompt,
      maxTokens: 1400,
    });

    const parsed = parseClaudeJson(responseText) || {};

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
          diets: expandDietHierarchy({
            diets: mapDiets(flag),
            veganLabel,
            vegetarianLabel,
            pescatarianLabel,
          }),
          risk_type,
        };
      })
      .filter((flag) =>
        flag.ingredient ||
        flag.word_indices.length ||
        flag.allergens.length ||
        flag.diets.length,
      );

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
