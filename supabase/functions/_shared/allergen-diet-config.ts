import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type AllergenRow = {
  key: string | null;
  label: string | null;
  emoji: string | null;
  sort_order: number | null;
  is_active: boolean | null;
};

type DietRow = {
  key: string | null;
  label: string | null;
  emoji: string | null;
  sort_order: number | null;
  is_active: boolean | null;
  is_supported: boolean | null;
  is_ai_enabled: boolean | null;
};

type AllergenAliasRow = {
  alias: string | null;
  allergen?: { key?: string | null } | null;
};

type DietAliasRow = {
  alias: string | null;
  diet?: { key?: string | null; label?: string | null } | null;
};

type DietConflictRow = {
  diet?: { label?: string | null } | null;
  allergen?: { key?: string | null } | null;
};

export type AllergenDietConfig = {
  allergens: AllergenRow[];
  diets: DietRow[];
  allergenAliases: Record<string, string>;
  dietAliases: Record<string, string>;
  dietAllergenConflicts: Record<string, string[]>;
  allergenLabels: Record<string, string>;
  allergenEmoji: Record<string, string>;
  dietEmoji: Record<string, string>;
  supportedDiets: string[];
  aiDiets: string[];
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache: { value: AllergenDietConfig | null; loadedAt: number } = {
  value: null,
  loadedAt: 0,
};

const norm = (value?: string | null) =>
  (value || "").toString().trim().toLowerCase();

const buildConfig = ({
  allergens = [],
  diets = [],
  allergenAliases = [],
  dietAliases = [],
  dietConflicts = [],
}: {
  allergens?: AllergenRow[];
  diets?: DietRow[];
  allergenAliases?: AllergenAliasRow[];
  dietAliases?: DietAliasRow[];
  dietConflicts?: DietConflictRow[];
} = {}): AllergenDietConfig => {
  const allergenLabels: Record<string, string> = {};
  const allergenEmoji: Record<string, string> = {};
  const allergenOrder = new Map<string, number>();
  const cleanedAllergens: AllergenRow[] = [];

  allergens.forEach((row) => {
    const key = norm(row?.key);
    if (!key) return;
    cleanedAllergens.push(row);
    if (!allergenOrder.has(key)) {
      allergenOrder.set(key, allergenOrder.size);
    }
    allergenLabels[key] = row?.label ? String(row.label) : key;
    if (row?.emoji) {
      allergenEmoji[key] = String(row.emoji);
    }
  });

  const allergenAliasesMap: Record<string, string> = {};
  allergenAliases.forEach((row) => {
    const alias = norm(row?.alias);
    const key = norm(row?.allergen?.key);
    if (alias && key) {
      allergenAliasesMap[alias] = key;
    }
  });

  const dietEmoji: Record<string, string> = {};
  const dietAliasesMap: Record<string, string> = {};
  const supportedDiets: string[] = [];
  const aiDiets: string[] = [];
  const cleanedDiets: DietRow[] = [];

  diets.forEach((row) => {
    const label = row?.label ? String(row.label) : "";
    const key = norm(row?.key || label);
    if (!key) return;
    cleanedDiets.push(row);
    if (label && row?.is_supported !== false) {
      supportedDiets.push(label);
    }
    if (label && row?.is_ai_enabled !== false) {
      aiDiets.push(label);
    }
    if (row?.emoji) {
      dietEmoji[key] = String(row.emoji);
      const labelKey = norm(label);
      if (labelKey && !dietEmoji[labelKey]) {
        dietEmoji[labelKey] = String(row.emoji);
      }
    }
  });

  dietAliases.forEach((row) => {
    const alias = norm(row?.alias);
    const label = row?.diet?.label;
    if (alias && label) {
      dietAliasesMap[alias] = String(label);
    }
  });

  const dietAllergenConflicts: Record<string, string[]> = {};
  dietConflicts.forEach((row) => {
    const dietLabel = row?.diet?.label;
    const allergenKey = norm(row?.allergen?.key);
    if (!dietLabel || !allergenKey) return;
    if (!dietAllergenConflicts[dietLabel]) {
      dietAllergenConflicts[dietLabel] = [];
    }
    if (!dietAllergenConflicts[dietLabel].includes(allergenKey)) {
      dietAllergenConflicts[dietLabel].push(allergenKey);
    }
  });

  Object.keys(dietAllergenConflicts).forEach((diet) => {
    dietAllergenConflicts[diet].sort((a, b) => {
      const aIndex = allergenOrder.has(a) ? allergenOrder.get(a)! : 999;
      const bIndex = allergenOrder.has(b) ? allergenOrder.get(b)! : 999;
      return aIndex - bIndex;
    });
  });

  return {
    allergens: cleanedAllergens,
    diets: cleanedDiets,
    allergenAliases: allergenAliasesMap,
    dietAliases: dietAliasesMap,
    dietAllergenConflicts,
    allergenLabels,
    allergenEmoji,
    dietEmoji,
    supportedDiets,
    aiDiets,
  };
};

export async function fetchAllergenDietConfig(): Promise<AllergenDietConfig> {
  const now = Date.now();
  if (cache.value && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.value;
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return buildConfig();
  }

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const [allergensRes, allergenAliasesRes, dietsRes, dietAliasesRes, dietConflictsRes] =
    await Promise.all([
      client
        .from("allergens")
        .select("key, label, emoji, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      client
        .from("allergen_aliases")
        .select("alias, allergen:allergen_id ( key )"),
      client
        .from("diets")
        .select(
          "key, label, emoji, sort_order, is_active, is_supported, is_ai_enabled",
        )
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      client.from("diet_aliases").select("alias, diet:diet_id ( label, key )"),
      client
        .from("diet_allergen_conflicts")
        .select("diet:diet_id ( label ), allergen:allergen_id ( key )"),
    ]);

  const config = buildConfig({
    allergens: Array.isArray(allergensRes.data) ? allergensRes.data : [],
    diets: Array.isArray(dietsRes.data) ? dietsRes.data : [],
    allergenAliases: Array.isArray(allergenAliasesRes.data)
      ? allergenAliasesRes.data
      : [],
    dietAliases: Array.isArray(dietAliasesRes.data) ? dietAliasesRes.data : [],
    dietConflicts: Array.isArray(dietConflictsRes.data)
      ? dietConflictsRes.data
      : [],
  });

  cache.value = config;
  cache.loadedAt = now;
  return config;
}
