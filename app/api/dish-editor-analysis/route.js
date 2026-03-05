import { corsJson, corsOptions } from "../_shared/cors";
import {
  buildDishEditorAnalysisSystemPrompt,
  buildDishEditorAnalysisUserPrompt,
} from "../../lib/claudePrompts";
import {
  callAnthropicApi,
  callOpenAiApi,
  createImageMessage,
  createTextMessage,
  runWithProviderSelection,
} from "../../lib/server/ai/providerRuntime";
import { dishEditorAnalysisSchema } from "../../lib/server/ai/responseSchemas";

export const runtime = "nodejs";

const CONFIG_TTL_MS = 5 * 60 * 1000;

let cachedConfig = null;
let cachedConfigAt = 0;

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
  }

  return null;
}

function parseImageData(imageData) {
  const value = asText(imageData);
  if (!value) return null;

  if (value.startsWith("data:") && value.includes(",")) {
    const [header, base64Data] = value.split(",", 2);
    const mediaType = asText(header.split(";")[0]?.replace("data:", "")) || "image/jpeg";
    if (!base64Data) return null;
    return { mediaType, base64Data };
  }

  return {
    mediaType: "image/jpeg",
    base64Data: value,
  };
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
  let parsed = [];
  try {
    parsed = text ? JSON.parse(text) : [];
  } catch {
    parsed = [];
  }

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

function expandDietHierarchy(diets, labels) {
  const out = new Set(
    (Array.isArray(diets) ? diets : []).filter((value) => typeof value === "string"),
  );
  if (labels.veganLabel && out.has(labels.veganLabel)) {
    if (labels.vegetarianLabel) out.add(labels.vegetarianLabel);
    if (labels.pescatarianLabel) out.add(labels.pescatarianLabel);
  }
  if (labels.vegetarianLabel && out.has(labels.vegetarianLabel)) {
    if (labels.pescatarianLabel) out.add(labels.pescatarianLabel);
  }
  return Array.from(out);
}

function buildAllDietCodesExample(labels, dietCodebook) {
  return JSON.stringify(
    [labels.veganLabel, labels.vegetarianLabel, labels.pescatarianLabel, labels.glutenFreeLabel]
      .filter(Boolean)
      .map((label) => dietCodebook.entries.find((entry) => entry.value === label)?.code || null)
      .filter((code) => Number.isFinite(Number(code))),
  );
}

export function OPTIONS() {
  return corsOptions();
}

export async function POST(request) {
  let body = null;
  try {
    body = await request.json();
  } catch {
    return corsJson(
      { error: "Invalid JSON payload.", ingredients: [] },
      { status: 400 },
    );
  }

  const dishName = asText(body?.dishName);
  const text = asText(body?.text);
  const parsedImage = parseImageData(body?.imageData);

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

    const labels = {
      veganLabel: findDietLabel("Vegan"),
      vegetarianLabel: findDietLabel("Vegetarian"),
      pescatarianLabel: findDietLabel("Pescatarian"),
      glutenFreeLabel: findDietLabel("Gluten-free", "Gluten Free"),
    };

    const resolveDietAlias = buildDietAliasResolver({
      glutenFreeLabel: labels.glutenFreeLabel,
      pescatarianLabel: labels.pescatarianLabel,
    });

    const allDietCodesExample = buildAllDietCodesExample(labels, dietCodebook);
    const vegetarianDietCodesExample = JSON.stringify(
      [labels.vegetarianLabel, labels.pescatarianLabel]
        .filter(Boolean)
        .map(
          (label) => dietCodebook.entries.find((entry) => entry.value === label)?.code || null,
        )
        .filter((code) => Number.isFinite(Number(code))),
    );
    const vegetarianGlutenFreeCodesExample = JSON.stringify(
      [labels.vegetarianLabel, labels.pescatarianLabel, labels.glutenFreeLabel]
        .filter(Boolean)
        .map(
          (label) => dietCodebook.entries.find((entry) => entry.value === label)?.code || null,
        )
        .filter((code) => Number.isFinite(Number(code))),
    );

    const allergenCodebookText = buildPromptCodebookLines(allergenCodebook.entries);
    const dietCodebookText = buildPromptCodebookLines(dietCodebook.entries);
    const milkCode = allergenCodebook.entries.find((entry) => entry.value === "milk")?.code;
    const eggCode = allergenCodebook.entries.find((entry) => entry.value === "egg")?.code;
    const wheatCode = allergenCodebook.entries.find((entry) => entry.value === "wheat")?.code;
    const systemPrompt = buildDishEditorAnalysisSystemPrompt({
      parsedImage,
      allergenCodebookText,
      dietCodebookText,
      allDietCodesExample,
      milkCode,
      eggCode,
      wheatCode,
      vegetarianDietCodesExample,
      vegetarianGlutenFreeCodesExample,
    });

    const userPrompt = buildDishEditorAnalysisUserPrompt({
      parsedImage,
      dishName,
      text,
    });

    const result = await runWithProviderSelection({
      routeId: "dish-editor-analysis",
      promptClass: "dishEditorAnalysis",
      requestSummary: {
        dishName,
        hasImage: Boolean(parsedImage),
      },
      invokeProvider: async (provider) => {
        const messageContent = [];
        if (parsedImage) {
          messageContent.push(
            createImageMessage({
              mediaType: parsedImage.mediaType,
              base64Data: parsedImage.base64Data,
            }),
          );
        }
        messageContent.push(createTextMessage(userPrompt));

        const response =
          provider === "openai"
            ? await callOpenAiApi({
                promptClass: "dishEditorAnalysis",
                systemPrompt,
                messages: [{ role: "user", content: messageContent }],
                maxTokens: 4000,
                jsonSchema: dishEditorAnalysisSchema,
              })
            : await callAnthropicApi({
                promptClass: "dishEditorAnalysis",
                systemPrompt,
                messages: [{ role: "user", content: messageContent }],
                maxTokens: 4000,
              });

        const parsed = parseClaudeJson(response.text);
        if (!parsed || typeof parsed !== "object") {
          throw new Error(
            "AI returned invalid format. Please try again or describe ingredients in text.",
          );
        }

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

        const ingredients = (Array.isArray(parsed?.ingredients) ? parsed.ingredients : [])
          .map((ingredient, index) => {
            const name = asText(ingredient?.name) || `Ingredient ${index + 1}`;
            const allergens = mapAllergens(ingredient);
            const diets = expandDietHierarchy(mapDiets(ingredient), labels);
            const ingredientsList = Array.isArray(ingredient?.ingredientsList)
              ? ingredient.ingredientsList.map((entry) => asText(entry)).filter(Boolean)
              : [];

            return {
              name,
              brand: asText(ingredient?.brand),
              allergens,
              diets,
              ingredientsList,
              imageQuality: asText(ingredient?.imageQuality),
            };
          })
          .filter(Boolean);

        const dietaryOptions = expandDietHierarchy(
          dedupeStrings([
            ...parseCodeList(parsed?.dietary_option_codes, dietCodebook.codeToValue),
            ...parseLegacyList(
              parsed?.dietaryOptions,
              dietCodebook.tokenToValue,
              resolveDietAlias,
            ),
          ]),
          labels,
        );

        return {
          ...response,
          normalizedOutput: {
            ingredients,
            dietaryOptions,
            verifiedFromImage:
              parsed?.verifiedFromImage !== undefined
                ? Boolean(parsed.verifiedFromImage)
                : Boolean(parsedImage),
          },
        };
      },
    });

    return corsJson(
      {
        ingredients: result.normalizedOutput.ingredients,
        dietaryOptions: result.normalizedOutput.dietaryOptions,
        verifiedFromImage: result.normalizedOutput.verifiedFromImage,
      },
      { status: 200 },
    );
  } catch (error) {
    return corsJson(
      {
        error: asText(error?.message) || "Failed to process request",
        ingredients: [],
      },
      { status: 500 },
    );
  }
}
