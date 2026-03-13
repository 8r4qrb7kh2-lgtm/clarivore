import { isSafeIngredientCatalogEntry } from "./ingredientCatalog.js";

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

function singularizeAlias(value) {
  const token = asText(value).toLowerCase();
  if (!token) return "";
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("us") &&
    !token.endsWith("is")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

function addAlias(aliasMap, alias, allergenKey) {
  const token = canonicalToken(alias);
  const key = asText(allergenKey);
  if (!token || !key || aliasMap.has(token)) return;
  aliasMap.set(token, key);
}

function addBaseAliases(aliasMap, allergenKey, values) {
  (Array.isArray(values) ? values : []).forEach((value) => {
    const safe = asText(value);
    if (!safe) return;
    addAlias(aliasMap, safe, allergenKey);
    addAlias(aliasMap, safe.replace(/_/g, " "), allergenKey);

    const singular = singularizeAlias(safe);
    if (singular && singular !== safe.toLowerCase()) {
      addAlias(aliasMap, singular, allergenKey);
    }

    if (!safe.toLowerCase().endsWith("s")) {
      addAlias(aliasMap, `${safe}s`, allergenKey);
    }
  });
}

function findConfiguredAllergenKey(allergens, targetTokens) {
  const targets = new Set(
    (Array.isArray(targetTokens) ? targetTokens : [])
      .map((value) => canonicalToken(value))
      .filter(Boolean),
  );
  if (!targets.size) return "";

  for (const row of Array.isArray(allergens) ? allergens : []) {
    const allergenKey = asText(row?.key);
    if (!allergenKey) continue;
    const candidates = [
      allergenKey,
      row?.label,
      allergenKey.replace(/_/g, " "),
      asText(row?.label).replace(/_/g, " "),
    ];
    if (candidates.some((value) => targets.has(canonicalToken(value)))) {
      return allergenKey;
    }
  }

  return "";
}

export function buildCandidateListText(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => {
      const id = asText(candidate?.id);
      const kind = asText(candidate?.kind);
      const declarationType = asText(candidate?.declarationType);
      const riskType = asText(candidate?.riskType);
      const text = asText(candidate?.text);
      const meta = [kind, declarationType].filter(Boolean).join("/");
      return `${id} | ${meta || "candidate"} | risk=${riskType || "contained"} | text="${text}"`;
    })
    .join("\n");
}

export function partitionCandidatesByCatalogSafety({
  directCandidates,
  declarationCandidates,
  entriesByIngredient,
}) {
  const catalogSafeDirectCandidates = [];
  const aiCandidates = [];

  (Array.isArray(directCandidates) ? directCandidates : []).forEach((candidate) => {
    const entry = entriesByIngredient.get(asText(candidate?.text));
    if (isSafeIngredientCatalogEntry(entry)) {
      catalogSafeDirectCandidates.push(candidate);
      return;
    }
    aiCandidates.push(candidate);
  });

  (Array.isArray(declarationCandidates) ? declarationCandidates : []).forEach((candidate) => {
    aiCandidates.push(candidate);
  });

  return {
    catalogSafeDirectCandidates,
    aiCandidates,
  };
}

export function mapCandidateFlagsToPublicFlags(candidateFlags, candidateById) {
  const mergedByCandidate = new Map();

  (Array.isArray(candidateFlags) ? candidateFlags : []).forEach((flag) => {
    const candidateId = asText(flag?.candidate_id);
    const candidate = candidateById.get(candidateId);
    if (!candidate) return;

    const existing = mergedByCandidate.get(candidateId) || {
      ingredient: asText(candidate?.text),
      word_indices: Array.isArray(candidate?.wordIndices)
        ? candidate.wordIndices.map((value) => Number(value)).filter(Number.isFinite)
        : [],
      allergens: [],
      diets: [],
      risk_type: asText(candidate?.riskType) || "contained",
    };

    existing.allergens = dedupeStrings([
      ...existing.allergens,
      ...(Array.isArray(flag?.allergens) ? flag.allergens : []),
    ]);
    existing.diets = dedupeStrings([
      ...existing.diets,
      ...(Array.isArray(flag?.diets) ? flag.diets : []),
    ]);
    mergedByCandidate.set(candidateId, existing);
  });

  return Array.from(mergedByCandidate.values()).filter(
    (flag) => flag.allergens.length || flag.diets.length,
  );
}

export function buildAllergenAliasMap(allergens) {
  const aliasMap = new Map();
  const allergenRows = Array.isArray(allergens) ? allergens : [];

  allergenRows.forEach((row) => {
    const allergenKey = asText(row?.key);
    if (!allergenKey) return;
    addBaseAliases(aliasMap, allergenKey, [allergenKey, row?.label]);
  });

  const milkKey = findConfiguredAllergenKey(allergenRows, ["milk", "dairy"]);
  if (milkKey) {
    addBaseAliases(aliasMap, milkKey, ["milk", "milks", "dairy"]);
  }

  const peanutKey = findConfiguredAllergenKey(allergenRows, ["peanut"]);
  if (peanutKey) {
    addBaseAliases(aliasMap, peanutKey, ["peanut", "peanuts"]);
  }

  const treeNutKey = findConfiguredAllergenKey(allergenRows, ["tree nut", "tree_nut"]);
  if (treeNutKey) {
    addBaseAliases(aliasMap, treeNutKey, [
      "tree nut",
      "tree nuts",
      "treenut",
      "treenuts",
    ]);
  }

  const soyKey = findConfiguredAllergenKey(allergenRows, ["soy"]);
  if (soyKey) {
    addBaseAliases(aliasMap, soyKey, ["soy", "soybean", "soybeans"]);
  }

  const shellfishKey = findConfiguredAllergenKey(allergenRows, [
    "shellfish",
    "crustacean shellfish",
  ]);
  if (shellfishKey) {
    addBaseAliases(aliasMap, shellfishKey, [
      "shellfish",
      "crustacean",
      "crustaceans",
      "crustacean shellfish",
      "mollusc",
      "molluscs",
      "mollusk",
      "mollusks",
    ]);
  }

  const sesameKey = findConfiguredAllergenKey(allergenRows, ["sesame"]);
  if (sesameKey) {
    addBaseAliases(aliasMap, sesameKey, ["sesame", "sesame seed", "sesame seeds"]);
  }

  const eggKey = findConfiguredAllergenKey(allergenRows, ["egg"]);
  if (eggKey) {
    addBaseAliases(aliasMap, eggKey, ["egg", "eggs"]);
  }

  const wheatKey = findConfiguredAllergenKey(allergenRows, ["wheat"]);
  if (wheatKey) {
    addBaseAliases(aliasMap, wheatKey, ["wheat", "gluten"]);
  }

  return aliasMap;
}

export function buildDietsByAllergenIndex(dietAllergenConflicts) {
  const dietsByAllergen = new Map();
  const safeConflicts =
    dietAllergenConflicts && typeof dietAllergenConflicts === "object"
      ? dietAllergenConflicts
      : {};

  Object.entries(safeConflicts).forEach(([dietLabel, allergens]) => {
    const diet = asText(dietLabel);
    if (!diet) return;
    (Array.isArray(allergens) ? allergens : []).forEach((allergenKey) => {
      const key = asText(allergenKey);
      if (!key) return;
      const existing = dietsByAllergen.get(key) || [];
      dietsByAllergen.set(key, dedupeStrings([...existing, diet]));
    });
  });

  return dietsByAllergen;
}

export function resolveExplicitDeclarationCandidates({
  declarationCandidates,
  allergenAliasMap,
  dietsByAllergen,
}) {
  const resolvedFlags = [];
  const unresolvedCandidates = [];
  const aliasMap = allergenAliasMap instanceof Map ? allergenAliasMap : new Map();
  const dietIndex = dietsByAllergen instanceof Map ? dietsByAllergen : new Map();

  (Array.isArray(declarationCandidates) ? declarationCandidates : []).forEach((candidate) => {
    const candidateText = asText(candidate?.text);
    const allergenKey = aliasMap.get(canonicalToken(candidateText));
    if (!allergenKey) {
      unresolvedCandidates.push(candidate);
      return;
    }

    resolvedFlags.push({
      ingredient: candidateText,
      word_indices: Array.isArray(candidate?.wordIndices)
        ? candidate.wordIndices.map((value) => Number(value)).filter(Number.isFinite)
        : [],
      allergens: [allergenKey],
      diets: dedupeStrings(dietIndex.get(allergenKey) || []),
      risk_type: asText(candidate?.riskType) || "contained",
    });
  });

  return {
    resolvedFlags,
    unresolvedCandidates,
  };
}
