function asText(value) {
  return String(value ?? "").trim();
}

function normalizePromptClassToken(value) {
  return asText(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

export const AI_PROVIDER_OPTIONS = new Set(["anthropic", "openai", "shadow"]);
export const AI_SINGLE_PROVIDER_OPTIONS = new Set(["anthropic", "openai"]);

export const ANTHROPIC_MODEL_DEFAULTS = {
  sonnet: "claude-sonnet-4-20250514",
  sonnetVision: "claude-sonnet-4-5-20250929",
  haiku: "claude-haiku-4-5-20251001",
};

export const OPENAI_MODEL_DEFAULTS = {
  cheap: "gpt-5-nano",
  balanced: "gpt-5-mini",
  miniVision: "gpt-4.1-mini",
  fallback: "gpt-5",
};

export const AI_PROMPT_MODELS = {
  analyzeIngredientScan: {
    openai: {
      defaultModel: "gpt-5.4",
      candidates: [
        "gpt-5.4",
        OPENAI_MODEL_DEFAULTS.balanced,
        OPENAI_MODEL_DEFAULTS.cheap,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.sonnet,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.sonnet],
    },
  },
  aiDishSearch: {
    openai: {
      defaultModel: OPENAI_MODEL_DEFAULTS.miniVision,
      candidates: [
        OPENAI_MODEL_DEFAULTS.miniVision,
        OPENAI_MODEL_DEFAULTS.balanced,
        OPENAI_MODEL_DEFAULTS.cheap,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.sonnet,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.sonnet],
    },
  },
  adminDataFlowAsk: {
    openai: {
      defaultModel: OPENAI_MODEL_DEFAULTS.balanced,
      candidates: [
        OPENAI_MODEL_DEFAULTS.balanced,
        OPENAI_MODEL_DEFAULTS.miniVision,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.sonnet,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.sonnet],
    },
  },
  confirmInfoCompare: {
    openai: {
      defaultModel: OPENAI_MODEL_DEFAULTS.miniVision,
      candidates: [
        OPENAI_MODEL_DEFAULTS.miniVision,
        OPENAI_MODEL_DEFAULTS.balanced,
        OPENAI_MODEL_DEFAULTS.cheap,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.sonnet,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.sonnet],
    },
  },
  detectCorners: {
    openai: {
      defaultModel: OPENAI_MODEL_DEFAULTS.balanced,
      candidates: [
        OPENAI_MODEL_DEFAULTS.balanced,
        OPENAI_MODEL_DEFAULTS.miniVision,
        OPENAI_MODEL_DEFAULTS.cheap,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.sonnet,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.sonnet],
    },
  },
  detectMenuDishes: {
    openai: {
      defaultModel: OPENAI_MODEL_DEFAULTS.miniVision,
      candidates: [
        OPENAI_MODEL_DEFAULTS.miniVision,
        OPENAI_MODEL_DEFAULTS.balanced,
        OPENAI_MODEL_DEFAULTS.cheap,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.sonnet,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.sonnet],
    },
  },
  dishEditorAnalysis: {
    openai: {
      defaultModel: OPENAI_MODEL_DEFAULTS.balanced,
      candidates: [
        OPENAI_MODEL_DEFAULTS.balanced,
        OPENAI_MODEL_DEFAULTS.miniVision,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.sonnet,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.sonnet],
    },
  },
  frontProductName: {
    openai: {
      defaultModel: OPENAI_MODEL_DEFAULTS.cheap,
      candidates: [OPENAI_MODEL_DEFAULTS.cheap, OPENAI_MODEL_DEFAULTS.balanced],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.sonnet,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.sonnet],
    },
  },
  helpAssistant: {
    openai: {
      defaultModel: OPENAI_MODEL_DEFAULTS.miniVision,
      candidates: [
        OPENAI_MODEL_DEFAULTS.miniVision,
        OPENAI_MODEL_DEFAULTS.balanced,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.sonnet,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.sonnet],
    },
  },
  ingredientAllergenAnalysis: {
    openai: {
      defaultModel: "gpt-5.4",
      candidates: [
        "gpt-5.4",
        OPENAI_MODEL_DEFAULTS.balanced,
        OPENAI_MODEL_DEFAULTS.miniVision,
        OPENAI_MODEL_DEFAULTS.cheap,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.haiku,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.haiku],
    },
  },
  ingredientCandidateExtraction: {
    openai: {
      defaultModel: "gpt-5.4",
      candidates: [
        "gpt-5.4",
        OPENAI_MODEL_DEFAULTS.balanced,
        OPENAI_MODEL_DEFAULTS.miniVision,
        OPENAI_MODEL_DEFAULTS.cheap,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.haiku,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.haiku],
    },
  },
  ingredientNameAnalysis: {
    openai: {
      defaultModel: "gpt-5.4",
      candidates: [
        "gpt-5.4",
        OPENAI_MODEL_DEFAULTS.balanced,
        OPENAI_MODEL_DEFAULTS.cheap,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.haiku,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.haiku],
    },
  },
  ingredientListSeparation: {
    openai: {
      defaultModel: "gpt-5.4",
      candidates: [
        "gpt-5.4",
        OPENAI_MODEL_DEFAULTS.balanced,
        OPENAI_MODEL_DEFAULTS.cheap,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.haiku,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.haiku],
    },
  },
  ingredientPhotoLineMatching: {
    openai: {
      defaultModel: OPENAI_MODEL_DEFAULTS.balanced,
      candidates: [
        OPENAI_MODEL_DEFAULTS.balanced,
        OPENAI_MODEL_DEFAULTS.miniVision,
        OPENAI_MODEL_DEFAULTS.cheap,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.sonnet,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.sonnet],
    },
  },
  ingredientPhotoQuality: {
    openai: {
      defaultModel: OPENAI_MODEL_DEFAULTS.balanced,
      candidates: [
        OPENAI_MODEL_DEFAULTS.balanced,
        OPENAI_MODEL_DEFAULTS.miniVision,
        OPENAI_MODEL_DEFAULTS.cheap,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.sonnet,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.sonnet],
    },
  },
  ingredientPhotoTranscription: {
    openai: {
      defaultModel: OPENAI_MODEL_DEFAULTS.balanced,
      candidates: [
        OPENAI_MODEL_DEFAULTS.balanced,
        OPENAI_MODEL_DEFAULTS.miniVision,
        OPENAI_MODEL_DEFAULTS.cheap,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.sonnet,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.sonnet],
    },
  },
  menuImageAnalysis: {
    openai: {
      defaultModel: OPENAI_MODEL_DEFAULTS.miniVision,
      candidates: [
        OPENAI_MODEL_DEFAULTS.miniVision,
        OPENAI_MODEL_DEFAULTS.balanced,
        OPENAI_MODEL_DEFAULTS.cheap,
      ],
    },
    anthropic: {
      defaultModel: ANTHROPIC_MODEL_DEFAULTS.sonnetVision,
      candidates: [ANTHROPIC_MODEL_DEFAULTS.sonnetVision],
    },
  },
};

const MODEL_ENV_ALIASES = {
  ingredientAllergenAnalysis: {
    anthropic: ["ANTHROPIC_MODEL_INGREDIENT_FLAGS"],
    openai: ["OPENAI_MODEL_INGREDIENT_FLAGS"],
  },
};

const MODEL_PRICING_BY_PREFIX = [
  { provider: "openai", prefix: "gpt-5-nano", inputUsdPer1M: 0.05, outputUsdPer1M: 0.4 },
  { provider: "openai", prefix: "gpt-5-mini", inputUsdPer1M: 0.25, outputUsdPer1M: 2.0 },
  { provider: "openai", prefix: "gpt-4.1-mini", inputUsdPer1M: 0.4, outputUsdPer1M: 1.6 },
  { provider: "openai", prefix: "gpt-5", inputUsdPer1M: 1.25, outputUsdPer1M: 10.0 },
  { provider: "anthropic", prefix: "claude-haiku-4-5", inputUsdPer1M: 1.0, outputUsdPer1M: 5.0 },
  { provider: "anthropic", prefix: "claude-sonnet-4-5", inputUsdPer1M: 3.0, outputUsdPer1M: 15.0 },
  { provider: "anthropic", prefix: "claude-sonnet-4", inputUsdPer1M: 3.0, outputUsdPer1M: 15.0 },
];

function findPromptEntry(promptClass) {
  return AI_PROMPT_MODELS[promptClass] || null;
}

function buildEnvOverrideKeys(promptClass, provider) {
  const promptToken = normalizePromptClassToken(promptClass);
  const providerToken = provider === "openai" ? "OPENAI" : "ANTHROPIC";
  const aliases = Array.isArray(MODEL_ENV_ALIASES?.[promptClass]?.[provider])
    ? MODEL_ENV_ALIASES[promptClass][provider]
    : [];
  const keys = [
    `${providerToken}_MODEL_${promptToken}`,
    `AI_MODEL_${promptToken}_${providerToken}`,
    `AI_MODEL_${promptToken}`,
    ...aliases,
  ];

  if (provider === "anthropic") {
    keys.push("ANTHROPIC_MODEL");
  } else {
    keys.push("OPENAI_MODEL");
  }

  return keys;
}

function readFirstEnv(env, keys) {
  const source = env && typeof env === "object" ? env : process.env;
  for (const key of Array.isArray(keys) ? keys : []) {
    const value = asText(source?.[key]);
    if (value) return value;
  }
  return "";
}

export function resolveModelForPromptClass(promptClass, provider, env = process.env) {
  const safeProvider = asText(provider).toLowerCase();
  const promptEntry = findPromptEntry(promptClass);
  if (!promptEntry || !promptEntry[safeProvider]) {
    return safeProvider === "openai"
      ? OPENAI_MODEL_DEFAULTS.balanced
      : ANTHROPIC_MODEL_DEFAULTS.sonnet;
  }

  const override = readFirstEnv(env, buildEnvOverrideKeys(promptClass, safeProvider));
  if (override) return override;
  return promptEntry[safeProvider].defaultModel;
}

export function getBenchmarkCandidates(promptClass, provider) {
  const promptEntry = findPromptEntry(promptClass);
  const providerEntry = promptEntry?.[provider];
  return Array.isArray(providerEntry?.candidates) ? providerEntry.candidates.slice() : [];
}

export function resolvePricing(provider, model) {
  const safeProvider = asText(provider).toLowerCase();
  const safeModel = asText(model).toLowerCase();
  return (
    MODEL_PRICING_BY_PREFIX.find(
      (entry) => entry.provider === safeProvider && safeModel.startsWith(entry.prefix),
    ) || null
  );
}

export function estimateUsageCostUsd({ provider, model, usage }) {
  const pricing = resolvePricing(provider, model);
  if (!pricing) return null;

  const inputTokens = Number(usage?.input_tokens || usage?.inputTokens || 0);
  const outputTokens = Number(
    usage?.output_tokens ||
      usage?.outputTokens ||
      usage?.completion_tokens ||
      usage?.completionTokens ||
      0,
  );
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;

  const inputCost = (inputTokens / 1_000_000) * pricing.inputUsdPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputUsdPer1M;
  return Number((inputCost + outputCost).toFixed(8));
}

export function getDefaultShadowPrimaryProvider(env = process.env) {
  const requested = asText(env?.AI_SHADOW_PRIMARY_PROVIDER).toLowerCase();
  return AI_SINGLE_PROVIDER_OPTIONS.has(requested) ? requested : "anthropic";
}

export function resolveProviderMode(env = process.env) {
  const requested = asText(env?.AI_PROVIDER).toLowerCase();
  if (AI_PROVIDER_OPTIONS.has(requested)) return requested;
  return "anthropic";
}

export function getShadowProviderPair(env = process.env) {
  const primary = getDefaultShadowPrimaryProvider(env);
  return primary === "openai"
    ? { primary: "openai", secondary: "anthropic" }
    : { primary: "anthropic", secondary: "openai" };
}
