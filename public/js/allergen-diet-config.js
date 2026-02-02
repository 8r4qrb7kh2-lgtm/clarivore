(function () {
  "use strict";

  const norm = (value) => String(value ?? "").trim().toLowerCase();
  const titleCase = (value) =>
    String(value || "")
      .split(" ")
      .map((part) =>
        part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : "",
      )
      .join(" ");

  const buildConfig = ({
    allergens = [],
    diets = [],
    allergenAliases = [],
    dietAliases = [],
    dietConflicts = [],
  } = {}) => {
    const ALLERGENS = [];
    const ALLERGEN_LABELS = {};
    const ALLERGEN_EMOJI = {};
    const ALLERGEN_ALIASES = {};
    const allergenOrder = new Map();

    allergens.forEach((row) => {
      const key = norm(row?.key);
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

    allergenAliases.forEach((row) => {
      const alias = norm(row?.alias);
      const target = norm(row?.allergen?.key || row?.allergen_key || row?.allergen);
      if (alias && target) {
        ALLERGEN_ALIASES[alias] = target;
      }
    });

    const DIETS = [];
    const DIET_EMOJI = {};
    const DIET_ALIASES = {};
    const DIET_ALLERGEN_CONFLICTS = {};

    diets.forEach((row) => {
      const label = row?.label ? String(row.label) : "";
      const key = norm(row?.key || label);
      if (label && row?.is_supported !== false) {
        DIETS.push(label);
      }
      if (row?.emoji) {
        DIET_EMOJI[key] = String(row.emoji);
        const labelKey = norm(label);
        if (labelKey && !DIET_EMOJI[labelKey]) {
          DIET_EMOJI[labelKey] = String(row.emoji);
        }
      }
    });

    dietAliases.forEach((row) => {
      const alias = norm(row?.alias);
      const target = row?.diet?.label || row?.diet_label || row?.diet;
      if (alias && target) {
        DIET_ALIASES[alias] = String(target);
      }
    });

    dietConflicts.forEach((row) => {
      const dietLabel = row?.diet?.label || row?.diet_label || row?.diet;
      const allergenKey = norm(
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
      const raw = norm(value);
      if (!raw) return "";
      const alias = ALLERGEN_ALIASES[raw];
      if (alias) return alias;
      if (ALLERGENS.includes(raw)) return raw;
      return "";
    };

    const normalizeDietLabel = (value) => {
      const raw = norm(value);
      if (!raw) return "";
      const alias = DIET_ALIASES[raw];
      if (alias) return alias;
      const match = DIETS.find((diet) => diet.toLowerCase() === raw);
      return match || "";
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

    const formatPreferenceLabel = (value) => {
      const allergen = normalizeAllergen(value);
      if (allergen) return formatAllergenLabel(allergen);
      const diet = normalizeDietLabel(value);
      if (diet) return formatDietLabel(diet);
      return titleCase(value);
    };

    const getAllergenEmoji = (value) => {
      const normalized = normalizeAllergen(value);
      return normalized ? ALLERGEN_EMOJI[normalized] || "" : "";
    };

    const getDietEmoji = (value) => {
      const normalized = normalizeDietLabel(value) || value;
      const key = norm(normalized);
      return DIET_EMOJI[key] || "";
    };

    const getDietAllergenConflicts = (diet) => {
      const normalized = normalizeDietLabel(diet);
      if (normalized && DIET_ALLERGEN_CONFLICTS[normalized]) {
        return DIET_ALLERGEN_CONFLICTS[normalized];
      }
      const raw = norm(diet);
      const entry = Object.keys(DIET_ALLERGEN_CONFLICTS).find(
        (key) => key.toLowerCase() === raw,
      );
      return entry ? DIET_ALLERGEN_CONFLICTS[entry] : [];
    };

    return {
      ALLERGENS,
      ALLERGEN_LABELS,
      ALLERGEN_EMOJI,
      ALLERGEN_ALIASES,
      DIETS,
      DIET_EMOJI,
      DIET_ALIASES,
      DIET_ALLERGEN_CONFLICTS,
      normalizeAllergen,
      normalizeDietLabel,
      formatAllergenLabel,
      formatDietLabel,
      formatPreferenceLabel,
      getAllergenEmoji,
      getDietEmoji,
      getDietAllergenConflicts,
    };
  };

  const waitForSupabaseClient = (timeoutMs = 4000) =>
    new Promise((resolve) => {
      if (typeof window === "undefined") {
        resolve(null);
        return;
      }
      if (window.supabaseClient) {
        resolve(window.supabaseClient);
        return;
      }
      const start = Date.now();
      const check = () => {
        if (window.supabaseClient) {
          resolve(window.supabaseClient);
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });

  const fetchConfigRows = async (client) => {
    const [
      allergensRes,
      allergenAliasesRes,
      dietsRes,
      dietAliasesRes,
      dietConflictsRes,
    ] = await Promise.all([
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

    const errors = [
      allergensRes.error,
      allergenAliasesRes.error,
      dietsRes.error,
      dietAliasesRes.error,
      dietConflictsRes.error,
    ].filter(Boolean);

    return {
      data: {
        allergens: Array.isArray(allergensRes.data) ? allergensRes.data : [],
        allergenAliases: Array.isArray(allergenAliasesRes.data)
          ? allergenAliasesRes.data
          : [],
        diets: Array.isArray(dietsRes.data) ? dietsRes.data : [],
        dietAliases: Array.isArray(dietAliasesRes.data)
          ? dietAliasesRes.data
          : [],
        dietConflicts: Array.isArray(dietConflictsRes.data)
          ? dietConflictsRes.data
          : [],
      },
      errors,
    };
  };

  let configPromise = null;

  const loadAllergenDietConfig = async (options = {}) => {
    if (typeof window === "undefined") {
      return buildConfig();
    }
    if (window.ALLERGEN_DIET_CONFIG?._loaded) {
      return window.ALLERGEN_DIET_CONFIG;
    }
    if (configPromise) {
      return configPromise;
    }

    configPromise = (async () => {
      const client =
        options.supabaseClient ||
        window.supabaseClient ||
        (await waitForSupabaseClient(options.timeoutMs));

      if (!client) {
        console.warn("Allergen/diet config: Supabase client unavailable.");
        const fallback = buildConfig();
        fallback._loaded = false;
        window.ALLERGEN_DIET_CONFIG = fallback;
        return fallback;
      }

      try {
        const { data, errors } = await fetchConfigRows(client);
        if (errors.length) {
          console.warn(
            "Allergen/diet config: fetch errors",
            errors.map((err) => err.message || err),
          );
        }
        const config = buildConfig(data);
        config._loaded = true;
        window.ALLERGEN_DIET_CONFIG = config;
        return config;
      } catch (err) {
        console.warn("Allergen/diet config: fetch failed", err);
        const fallback = buildConfig();
        fallback._loaded = false;
        window.ALLERGEN_DIET_CONFIG = fallback;
        return fallback;
      }
    })();

    return configPromise;
  };

  if (typeof window !== "undefined") {
    window.loadAllergenDietConfig = loadAllergenDietConfig;
    if (!window.ALLERGEN_DIET_CONFIG) {
      window.ALLERGEN_DIET_CONFIG = buildConfig();
    }
  }
})();
