import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;
const prisma = globalForPrisma.__clarivorePrisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__clarivorePrisma = prisma;
}

const QUALIFIER_PREFIXES = [
  "freeze dried",
  "dehydrated",
  "pasteurized",
  "cultured",
  "organic",
  "fresh",
  "frozen",
  "dried",
  "dry",
  "raw",
];

const IRREGULAR_SINGULARS = {
  berries: "berry",
  carrots: "carrot",
  cultures: "culture",
  eggs: "egg",
  onions: "onion",
  potatoes: "potato",
  tomatoes: "tomato",
};

const SAFE_ONLY_EXACT_EXCEPTIONS = new Set([
  "cream of tartar",
  "eggplant",
  "eggplants",
]);

const SAFE_ONLY_COMPACT_EXCEPTIONS = [
  "buckwheat",
  "wheatgrass",
];

const SAFE_ONLY_TREE_NUT_COMPACT_TERMS = [
  "almond",
  "brazilnut",
  "cashew",
  "chestnut",
  "coconut",
  "hazelnut",
  "macadamia",
  "nutmilk",
  "pecan",
  "pinenut",
  "pistachio",
  "praline",
  "treenut",
  "walnut",
];

const SAFE_ONLY_PEANUT_COMPACT_TERMS = ["groundnut", "peanut"];

const SAFE_ONLY_SOY_COMPACT_TERMS = [
  "edamame",
  "miso",
  "natto",
  "shoyu",
  "soy",
  "soya",
  "soybean",
  "tamari",
  "tempeh",
  "tofu",
];

const SAFE_ONLY_SESAME_COMPACT_TERMS = ["benne", "gingelly", "sesame", "tahini"];

const SAFE_ONLY_EGG_COMPACT_TERMS = [
  "aioli",
  "albumen",
  "albumin",
  "egg",
  "lysozyme",
  "mayonnaise",
  "meringue",
  "ovalbumin",
];

const SAFE_ONLY_FISH_COMPACT_TERMS = [
  "anchovy",
  "bass",
  "bonito",
  "catfish",
  "cod",
  "fish",
  "haddock",
  "lumpfish",
  "mahi",
  "mackerel",
  "pollock",
  "salmon",
  "sardine",
  "snapper",
  "surimi",
  "swordfish",
  "tilapia",
  "trout",
  "tuna",
  "whitefish",
];

const SAFE_ONLY_SHELLFISH_COMPACT_TERMS = [
  "abalone",
  "clam",
  "crab",
  "crawfish",
  "crayfish",
  "cuttlefish",
  "krill",
  "lobster",
  "mollusc",
  "mollusk",
  "mussel",
  "octopus",
  "oyster",
  "prawn",
  "scallop",
  "shellfish",
  "shrimp",
  "squid",
];

const SAFE_ONLY_GLUTEN_COMPACT_TERMS = [
  "barley",
  "gluten",
  "rye",
  "spelt",
  "triticale",
  "wheat",
];

const SAFE_ONLY_MILK_COMPACT_TERMS = [
  "buttermilk",
  "casein",
  "caseinate",
  "cheese",
  "curd",
  "dairy",
  "ghee",
  "kefir",
  "lactose",
  "milk",
  "milkfat",
  "milksolid",
  "whey",
  "yoghurt",
  "yogurt",
];

const SAFE_ONLY_PLANT_BASE_COMPACTS = [
  "almond",
  "apple",
  "cashew",
  "cocoa",
  "coconut",
  "cookie",
  "hazelnut",
  "hemp",
  "macadamia",
  "nut",
  "oat",
  "pea",
  "peanut",
  "pecan",
  "pistachio",
  "pumpkinseed",
  "rice",
  "sesame",
  "soy",
  "sunflower",
  "walnut",
];

function asText(value) {
  return String(value ?? "").trim();
}

function asciiText(value) {
  return asText(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeSpaces(value) {
  return asText(value).replace(/\s+/g, " ").trim();
}

function normalizeLookupTerm(value) {
  return asciiText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compactLookupTerm(value) {
  return asciiText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function singularize(token) {
  const safe = asText(token).toLowerCase();
  if (!safe) return "";
  if (IRREGULAR_SINGULARS[safe]) return IRREGULAR_SINGULARS[safe];
  if (safe.length <= 3) return safe;
  if (safe.endsWith("ies") && safe.length > 4) return `${safe.slice(0, -3)}y`;
  if (safe.endsWith("oes") && safe.length > 4) return safe.slice(0, -2);
  if (
    safe.endsWith("s") &&
    !safe.endsWith("ss") &&
    !safe.endsWith("us") &&
    !safe.endsWith("is")
  ) {
    return safe.slice(0, -1);
  }
  return safe;
}

export function canonicalizeIngredientCatalogName(value) {
  let base = asciiText(value).toLowerCase();
  base = base.replace(/\([^)]*\)/g, " ");
  base = normalizeSpaces(base);

  let tokens = base.split(" ").filter(Boolean);
  for (const prefix of QUALIFIER_PREFIXES) {
    const prefixTokens = prefix.split(" ");
    const candidate = tokens.slice(0, prefixTokens.length).join(" ");
    if (candidate === prefix) {
      tokens = tokens.slice(prefixTokens.length);
      break;
    }
  }

  if (tokens.length) {
    tokens[tokens.length - 1] = singularize(tokens[tokens.length - 1]);
  }

  return normalizeLookupTerm(tokens.join(" "));
}

export function buildIngredientCatalogLookupTokens(value) {
  const raw = normalizeLookupTerm(value);
  const canonical = canonicalizeIngredientCatalogName(value);
  return Array.from(new Set([canonical, raw].filter(Boolean)));
}

function selectCatalogRow(row) {
  if (!row || typeof row !== "object") return null;
  return {
    id: asText(row.id),
    canonicalName: asText(row.canonical_name),
    normalizedName: asText(row.normalized_name),
    aliases: Array.isArray(row.aliases) ? row.aliases.map(asText).filter(Boolean) : [],
    lookupTerms: Array.isArray(row.lookup_terms)
      ? row.lookup_terms.map(asText).filter(Boolean)
      : [],
    lookupCount: Number.isFinite(Number(row.lookup_count))
      ? Number(row.lookup_count)
      : 0,
    allergens: Array.isArray(row.allergens)
      ? row.allergens.map(asText).filter(Boolean)
      : [],
    diets: Array.isArray(row.diets) ? row.diets.map(asText).filter(Boolean) : [],
    isReady: row.is_ready === true,
    seedSource: asText(row.seed_source),
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata
        : {},
  };
}

function normalizeTokenSet(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeLookupTerm(value))
      .filter(Boolean),
  );
}

function rowTextValue(row, camelKey, snakeKey) {
  return asText(row?.[camelKey] ?? row?.[snakeKey]);
}

function rowTextList(row, camelKey, snakeKey) {
  const values = Array.isArray(row?.[camelKey])
    ? row[camelKey]
    : Array.isArray(row?.[snakeKey])
      ? row[snakeKey]
      : [];

  return values
    .map(asText)
    .filter(Boolean);
}

function buildSafeOnlyValidationTexts(row) {
  const metadata =
    row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata
      : {};
  const surfaceForms = Array.isArray(metadata.surface_forms)
    ? metadata.surface_forms
        .map((entry) => asText(entry?.name))
        .filter(Boolean)
    : [];

  return Array.from(
    new Set(
      [
        rowTextValue(row, "canonicalName", "canonical_name"),
        rowTextValue(row, "normalizedName", "normalized_name"),
        ...rowTextList(row, "aliases", "aliases"),
        ...rowTextList(row, "lookupTerms", "lookup_terms"),
        ...surfaceForms,
      ]
        .map(normalizeSpaces)
        .filter(Boolean),
    ),
  );
}

function compactIncludesAny(value, terms) {
  return (Array.isArray(terms) ? terms : []).some((term) =>
    compactLookupTerm(value).includes(compactLookupTerm(term)),
  );
}

function hasSafeOnlyPlantDairyException(value) {
  const compact = compactLookupTerm(value);
  if (!compact) return false;

  if (
    compact.includes("nondairy") ||
    compact.includes("dairyfree") ||
    compact.includes("veganyogurt") ||
    compact.includes("vegancheese") ||
    compact.includes("veganbutter")
  ) {
    return true;
  }

  return SAFE_ONLY_PLANT_BASE_COMPACTS.some((base) => {
    const safeBase = compactLookupTerm(base);
    return (
      compact.includes(`${safeBase}milk`) ||
      compact.includes(`${safeBase}cream`) ||
      compact.includes(`${safeBase}cheese`) ||
      compact.includes(`${safeBase}yogurt`) ||
      compact.includes(`${safeBase}yoghurt`) ||
      compact.includes(`${safeBase}butter`)
    );
  });
}

function looksUnsafeForSafeOnlyCatalog(value) {
  const normalized = normalizeLookupTerm(value);
  const compact = compactLookupTerm(value);
  if (!normalized || !compact) return false;

  if (SAFE_ONLY_EXACT_EXCEPTIONS.has(normalized)) return false;

  const hasCompactException = SAFE_ONLY_COMPACT_EXCEPTIONS.some((token) =>
    compact.includes(token),
  );

  if (compactIncludesAny(compact, SAFE_ONLY_TREE_NUT_COMPACT_TERMS)) return true;
  if (compactIncludesAny(compact, SAFE_ONLY_PEANUT_COMPACT_TERMS)) return true;
  if (compactIncludesAny(compact, SAFE_ONLY_SOY_COMPACT_TERMS)) return true;
  if (compactIncludesAny(compact, SAFE_ONLY_SESAME_COMPACT_TERMS)) return true;

  if (!compact.startsWith("eggplant") && compactIncludesAny(compact, SAFE_ONLY_EGG_COMPACT_TERMS)) {
    return true;
  }

  if (compactIncludesAny(compact, SAFE_ONLY_SHELLFISH_COMPACT_TERMS)) return true;
  if (compactIncludesAny(compact, SAFE_ONLY_FISH_COMPACT_TERMS)) return true;

  if (
    !hasCompactException &&
    compactIncludesAny(compact, SAFE_ONLY_GLUTEN_COMPACT_TERMS) &&
    !compact.includes("glutenfree")
  ) {
    return true;
  }

  if (
    !hasSafeOnlyPlantDairyException(compact) &&
    compactIncludesAny(compact, SAFE_ONLY_MILK_COMPACT_TERMS)
  ) {
    return true;
  }

  return false;
}

export function isSafeIngredientCatalogEntry(row) {
  if (!row || typeof row !== "object") return false;

  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata
      : {};
  const catalogType = asText(metadata.catalog_type || metadata.catalogType);
  const supportedDietSet = normalizeTokenSet(metadata.supported_diets || metadata.supportedDiets);
  const dietSet = normalizeTokenSet(row.diets);
  const allergenSet = normalizeTokenSet(row.allergens);
  const seedSource = asText(row.seedSource || row.seed_source);

  if (row.isReady !== true || allergenSet.size !== 0) return false;
  if (!dietSet.size) return false;
  if (
    catalogType !== "safe_only" &&
    !seedSource.startsWith("openfoodfacts_safe_only_")
  ) {
    return false;
  }
  if (buildSafeOnlyValidationTexts(row).some((value) => looksUnsafeForSafeOnlyCatalog(value))) {
    return false;
  }
  if (!supportedDietSet.size) return true;
  if (supportedDietSet.size !== dietSet.size) return false;
  for (const value of supportedDietSet) {
    if (!dietSet.has(value)) return false;
  }
  return true;
}

function scoreCatalogRow(tokens, row) {
  const tokenSet = new Set(Array.isArray(tokens) ? tokens : []);
  if (!tokenSet.size || !row) return -1;
  if (tokenSet.has(row.normalizedName)) return 3;
  if (row.lookupTerms.some((term) => tokenSet.has(term))) return 2;
  return -1;
}

export async function findIngredientCatalogEntriesByNames(names, options = {}) {
  const safeNames = Array.isArray(names) ? names.map(asText).filter(Boolean) : [];
  if (!safeNames.length) return new Map();

  const tokenSet = new Set();
  const tokensByName = new Map();
  safeNames.forEach((name) => {
    const tokens = buildIngredientCatalogLookupTokens(name);
    tokensByName.set(name, tokens);
    tokens.forEach((token) => tokenSet.add(token));
  });

  if (!tokenSet.size) return new Map();

  const rows = await prisma.ingredient_catalog_entries.findMany({
    where: {
      ...(options?.readyOnly === false ? {} : { is_ready: true }),
      OR: [
        { normalized_name: { in: Array.from(tokenSet) } },
        { lookup_terms: { hasSome: Array.from(tokenSet) } },
      ],
    },
    select: {
      id: true,
      canonical_name: true,
      normalized_name: true,
      aliases: true,
      lookup_terms: true,
      lookup_count: true,
      allergens: true,
      diets: true,
      is_ready: true,
      seed_source: true,
      metadata: true,
    },
  });

  const catalogRows = rows.map(selectCatalogRow).filter(Boolean);
  const result = new Map();

  safeNames.forEach((name) => {
    const tokens = tokensByName.get(name) || [];
    let bestRow = null;
    let bestScore = -1;
    for (const row of catalogRows) {
      const score = scoreCatalogRow(tokens, row);
      if (score < 0) continue;
      if (
        score > bestScore ||
        (score === bestScore &&
          Number(row.lookupCount || 0) > Number(bestRow?.lookupCount || 0))
      ) {
        bestScore = score;
        bestRow = row;
      }
    }
    if (bestRow) {
      result.set(name, bestRow);
    }
  });

  return result;
}

export async function findIngredientCatalogEntryByName(name, options = {}) {
  const entries = await findIngredientCatalogEntriesByNames([name], options);
  return entries.get(asText(name)) || null;
}
