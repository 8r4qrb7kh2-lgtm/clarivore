const asText = (value) => String(value ?? "").trim();
const titleCase = (value) =>
  String(value || "")
    .split(" ")
    .map((part) =>
      part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : "",
    )
    .join(" ");

export const buildAllergenDietConfig = ({
  allergens = [],
  diets = [],
  dietConflicts = [],
} = {}) => {
  const ALLERGENS = [];
  const ALLERGEN_LABELS = {};
  const ALLERGEN_EMOJI = {};
  const allergenOrder = new Map();

  allergens.forEach((row) => {
    const key = asText(row?.key);
    if (!key) return;
    if (!ALLERGENS.includes(key)) {
      allergenOrder.set(key, ALLERGENS.length);
      ALLERGENS.push(key);
    }
    const label = row?.label ? String(row.label) : titleCase(key);
    ALLERGEN_LABELS[key] = label;
    if (row?.emoji) {
      ALLERGEN_EMOJI[key] = String(row.emoji);
    }
  });

  const DIETS = [];
  const DIET_EMOJI = {};
  const DIET_ALLERGEN_CONFLICTS = {};

  diets.forEach((row) => {
    const label = asText(row?.label);
    if (label && row?.is_supported !== false) {
      DIETS.push(label);
    }
    if (row?.emoji && label) {
      DIET_EMOJI[label] = String(row.emoji);
    }
  });

  dietConflicts.forEach((row) => {
    const dietLabel = asText(row?.diet?.label || row?.diet_label || row?.diet);
    const allergenKey = asText(
      row?.allergen?.key || row?.allergen_key || row?.allergen,
    );
    if (!dietLabel || !allergenKey) return;
    if (!DIET_ALLERGEN_CONFLICTS[dietLabel]) {
      DIET_ALLERGEN_CONFLICTS[dietLabel] = [];
    }
    if (!DIET_ALLERGEN_CONFLICTS[dietLabel].includes(allergenKey)) {
      DIET_ALLERGEN_CONFLICTS[dietLabel].push(allergenKey);
    }
  });

  Object.keys(DIET_ALLERGEN_CONFLICTS).forEach((diet) => {
    DIET_ALLERGEN_CONFLICTS[diet].sort((a, b) => {
      const aIndex = allergenOrder.has(a) ? allergenOrder.get(a) : 999;
      const bIndex = allergenOrder.has(b) ? allergenOrder.get(b) : 999;
      return aIndex - bIndex;
    });
  });

  const normalizeAllergen = (value) => {
    const raw = asText(value);
    if (!raw) return "";
    return ALLERGENS.includes(raw) ? raw : "";
  };

  const normalizeDietLabel = (value) => {
    const raw = asText(value);
    if (!raw) return "";
    return DIETS.includes(raw) ? raw : "";
  };

  const formatAllergenLabel = (value) => {
    const normalized = normalizeAllergen(value);
    if (normalized && ALLERGEN_LABELS[normalized]) {
      return ALLERGEN_LABELS[normalized];
    }
    return titleCase(value);
  };

  const formatDietLabel = (value) => {
    const normalized = normalizeDietLabel(value);
    if (normalized) return normalized;
    return titleCase(value);
  };

  const getAllergenEmoji = (value) => {
    const normalized = normalizeAllergen(value);
    return normalized ? ALLERGEN_EMOJI[normalized] || "" : "";
  };

  const getDietEmoji = (value) => {
    const normalized = normalizeDietLabel(value);
    return normalized ? DIET_EMOJI[normalized] || "" : "";
  };

  const getDietAllergenConflicts = (diet) => {
    const normalized = normalizeDietLabel(diet);
    if (normalized && DIET_ALLERGEN_CONFLICTS[normalized]) {
      return DIET_ALLERGEN_CONFLICTS[normalized];
    }
    return [];
  };

  return {
    ALLERGENS,
    DIETS,
    normalizeAllergen,
    normalizeDietLabel,
    formatAllergenLabel,
    formatDietLabel,
    getAllergenEmoji,
    getDietEmoji,
    getDietAllergenConflicts,
  };
};

let configPromise = null;

export const loadAllergenDietConfig = async (supabaseClient) => {
  if (!supabaseClient) {
    return buildAllergenDietConfig();
  }
  if (configPromise) {
    return configPromise;
  }

  configPromise = (async () => {
    try {
      const [allergensRes, dietsRes, conflictsRes] = await Promise.all([
        supabaseClient
          .from("allergens")
          .select("key, label, emoji, sort_order, is_active")
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
        supabaseClient
          .from("diets")
          .select(
            "key, label, emoji, sort_order, is_active, is_supported, is_ai_enabled",
          )
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
        supabaseClient
          .from("diet_allergen_conflicts")
          .select("diet:diet_id ( label ), allergen:allergen_id ( key )"),
      ]);

      return buildAllergenDietConfig({
        allergens: Array.isArray(allergensRes.data) ? allergensRes.data : [],
        diets: Array.isArray(dietsRes.data) ? dietsRes.data : [],
        dietConflicts: Array.isArray(conflictsRes.data)
          ? conflictsRes.data
          : [],
      });
    } catch (error) {
      console.warn("Allergen/diet config: fetch failed", error);
      return buildAllergenDietConfig();
    }
  })();

  return configPromise;
};
