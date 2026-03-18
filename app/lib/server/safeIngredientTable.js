import fsp from "node:fs/promises";
import path from "node:path";

const CONFIRMED_SAFE_INGREDIENTS_CSV_PATH = path.join(
  process.cwd(),
  "safe-ingredients-confirmed.csv",
);
const LEGACY_SAFE_INGREDIENTS_CSV_PATH = path.join(
  process.cwd(),
  "safe-ingredients.csv",
);
const INGREDIENT_CATALOG_JSONL_PATH = path.join(
  process.cwd(),
  "ml",
  "seeds",
  "ingredient_catalog_seed.jsonl",
);
const MAX_MATCHES_PER_CANDIDATE = 5;

let cachedTable = null;
let cachedTableSignature = "";
let cachedTablePromise = null;

function asText(value) {
  return String(value ?? "").trim();
}

function dedupeStrings(values) {
  const out = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = asText(value);
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  });
  return out;
}

function asciiText(value) {
  return asText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeLookupTerm(value) {
  return asciiText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function singularizeLookupWord(value) {
  const word = normalizeLookupTerm(value);
  if (!word) return "";
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (
    word.endsWith("s") &&
    !word.endsWith("ss") &&
    !word.endsWith("us") &&
    !word.endsWith("is")
  ) {
    return word.slice(0, -1);
  }
  return word;
}

function pluralizeLookupWord(value) {
  const word = normalizeLookupTerm(value);
  if (!word) return "";
  if (word.endsWith("s")) return word;
  if (
    word.endsWith("ch") ||
    word.endsWith("sh") ||
    word.endsWith("x") ||
    word.endsWith("z")
  ) {
    return `${word}es`;
  }
  if (word.endsWith("y") && word.length > 1 && !/[aeiou]y$/.test(word)) {
    return `${word.slice(0, -1)}ies`;
  }
  return `${word}s`;
}

function buildLookupVariants(value) {
  const base = normalizeLookupTerm(value);
  if (!base) return [];

  const variants = new Set([base]);
  const words = base.split(" ").filter(Boolean);
  if (!words.length) return Array.from(variants);

  const lastWord = words[words.length - 1];
  const singularLastWord = singularizeLookupWord(lastWord);
  const pluralLastWord = pluralizeLookupWord(lastWord);

  if (singularLastWord && singularLastWord !== lastWord) {
    variants.add([...words.slice(0, -1), singularLastWord].join(" "));
  }
  if (pluralLastWord && pluralLastWord !== lastWord) {
    variants.add([...words.slice(0, -1), pluralLastWord].join(" "));
  }

  return Array.from(variants).filter(Boolean);
}

function parseCsvRows(content) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const ch = content[index];

    if (inQuotes) {
      if (ch === "\"") {
        if (content[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (ch === "\r") {
      continue;
    }

    field += ch;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function parseJsonlRows(content) {
  return content
    .split(/\r?\n/)
    .map((line) => asText(line))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function normalizeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
}

function buildSourceLabel(source) {
  if (source?.kind === "confirmed-csv") return "safe-ingredient-manual-audit";
  if (source?.kind === "legacy-csv") return "safe-ingredient-csv";
  if (source?.kind === "jsonl") return "ingredient-catalog-seed";
  return path.basename(asText(source?.path || source)) || "safe-ingredient-table";
}

function emptySafeIngredientTable({
  sourcePath = CONFIRMED_SAFE_INGREDIENTS_CSV_PATH,
  sourceLabel = buildSourceLabel(sourcePath),
  status = "missing",
  versionKey = "missing",
  error = "",
} = {}) {
  return {
    sourcePath,
    sourceLabel,
    status,
    versionKey,
    rowCount: 0,
    error: asText(error),
    rowsByLookupTerm: new Map(),
  };
}

function buildLookupTerms({
  canonicalName,
  normalizedName,
  recordLookupTerms = [],
  aliases = [],
}) {
  return dedupeStrings([
    ...buildLookupVariants(canonicalName),
    ...buildLookupVariants(normalizedName),
    ...(Array.isArray(recordLookupTerms) ? recordLookupTerms : []).flatMap((value) =>
      buildLookupVariants(value),
    ),
    ...(Array.isArray(aliases) ? aliases : []).flatMap((value) => buildLookupVariants(value)),
  ]);
}

function buildCatalogSeedRow(record, index) {
  if (record?.is_ready === false) return null;

  const canonicalName =
    asText(record?.canonical_name) ||
    asText(record?.ingredient) ||
    asText(record?.ingredient_name);
  const normalizedName = normalizeLookupTerm(
    record?.normalized_name ||
      record?.ingredient_key ||
      canonicalName,
  );
  if (!canonicalName && !normalizedName) return null;

  const lookupTerms = buildLookupTerms({
    canonicalName,
    normalizedName,
    recordLookupTerms: Array.isArray(record?.lookup_terms) ? record.lookup_terms : [],
    aliases: Array.isArray(record?.aliases) ? record.aliases : [],
  });
  if (!lookupTerms.length) return null;

  return {
    id: `${normalizedName || canonicalName || "row"}:${index}`,
    canonicalName: canonicalName || normalizedName,
    normalizedName: normalizedName || normalizeLookupTerm(canonicalName),
    lookupCount: normalizeInteger(record?.lookup_count),
    lookupTerms,
    seedSource: asText(record?.seed_source) || "ingredient_catalog_seed",
  };
}

function buildConfirmedCsvRow(record, index, sourceLabel) {
  if (asText(record?.manual_audit_status).toLowerCase() !== "confirmed_safe") {
    return null;
  }

  const canonicalName = asText(record?.ingredient);
  const normalizedName = normalizeLookupTerm(record?.ingredient_key || canonicalName);
  if (!canonicalName && !normalizedName) return null;

  const lookupTerms = buildLookupTerms({
    canonicalName,
    normalizedName,
  });
  if (!lookupTerms.length) return null;

  return {
    id: `${normalizedName || canonicalName || "row"}:${index}`,
    canonicalName: canonicalName || normalizedName,
    normalizedName: normalizedName || normalizeLookupTerm(canonicalName),
    lookupCount: normalizeInteger(record?.product_occurrences),
    lookupTerms,
    seedSource: sourceLabel,
  };
}

function buildLegacyCsvRow(record, index, sourceLabel) {
  const canonicalName = asText(record?.ingredient);
  const normalizedName = normalizeLookupTerm(
    record?.ingredient_key || canonicalName,
  );
  if (!canonicalName && !normalizedName) return null;

  const lookupTerms = buildLookupTerms({
    canonicalName,
    normalizedName,
  });
  if (!lookupTerms.length) return null;

  return {
    id: `${normalizedName || canonicalName || "row"}:${index}`,
    canonicalName: canonicalName || normalizedName,
    normalizedName: normalizedName || normalizeLookupTerm(canonicalName),
    lookupCount: normalizeInteger(record?.product_occurrences),
    lookupTerms,
    seedSource: sourceLabel,
  };
}

async function resolveSourceFile() {
  const candidates = [
    { path: CONFIRMED_SAFE_INGREDIENTS_CSV_PATH, kind: "confirmed-csv" },
    { path: LEGACY_SAFE_INGREDIENTS_CSV_PATH, kind: "legacy-csv" },
    { path: INGREDIENT_CATALOG_JSONL_PATH, kind: "jsonl" },
  ];

  for (const candidate of candidates) {
    try {
      const stat = await fsp.stat(candidate.path);
      if (stat?.isFile?.()) {
        return {
          ...candidate,
          stat,
          label: buildSourceLabel(candidate),
        };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn("Safe ingredient table: failed to stat source", candidate.path, error);
      }
    }
  }

  return null;
}

function buildVersionKey(source) {
  return `${source.kind}:${Math.trunc(Number(source?.stat?.size) || 0)}:${Math.trunc(
    Number(source?.stat?.mtimeMs) || 0,
  )}`;
}

async function readJsonlSafeIngredientTable(source) {
  const content = await fsp.readFile(source.path, "utf8");
  const rows = parseJsonlRows(content);
  const rowsByLookupTerm = new Map();
  let rowCount = 0;

  rows.forEach((record, index) => {
    const normalizedRow = buildCatalogSeedRow(record, index);
    if (!normalizedRow) return;
    rowCount += 1;
    normalizedRow.lookupTerms.forEach((term) => {
      const existing = rowsByLookupTerm.get(term) || [];
      existing.push(normalizedRow);
      rowsByLookupTerm.set(term, existing);
    });
  });

  rowsByLookupTerm.forEach((rowsForTerm, term) => {
    rowsByLookupTerm.set(
      term,
      rowsForTerm.sort((left, right) => {
        const bySupport = right.lookupCount - left.lookupCount;
        if (bySupport !== 0) return bySupport;
        return left.canonicalName.localeCompare(right.canonicalName);
      }),
    );
  });

  return {
    sourcePath: source.path,
    sourceLabel: source.label,
    status: "loaded",
    versionKey: buildVersionKey(source),
    rowCount,
    error: "",
    rowsByLookupTerm,
  };
}

async function readCsvSafeIngredientTable(source) {
  const content = await fsp.readFile(source.path, "utf8");
  const rows = parseCsvRows(content);
  if (!rows.length) {
    return emptySafeIngredientTable({
      sourcePath: source.path,
      sourceLabel: source.label,
      status: "empty",
      versionKey: buildVersionKey(source),
    });
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((value) => asText(value));
  const rowsByLookupTerm = new Map();
  let rowCount = 0;

  dataRows.forEach((values, index) => {
    const record = {};
    headers.forEach((header, headerIndex) => {
      record[header] = values[headerIndex] ?? "";
    });

    const normalizedRow =
      source.kind === "confirmed-csv"
        ? buildConfirmedCsvRow(record, index, source.label)
        : buildLegacyCsvRow(record, index, source.label);
    if (!normalizedRow) return;

    rowCount += 1;
    normalizedRow.lookupTerms.forEach((term) => {
      const existing = rowsByLookupTerm.get(term) || [];
      existing.push(normalizedRow);
      rowsByLookupTerm.set(term, existing);
    });
  });

  rowsByLookupTerm.forEach((rowsForTerm, term) => {
    rowsByLookupTerm.set(
      term,
      rowsForTerm.sort((left, right) => {
        const bySupport = right.lookupCount - left.lookupCount;
        if (bySupport !== 0) return bySupport;
        return left.canonicalName.localeCompare(right.canonicalName);
      }),
    );
  });

  return {
    sourcePath: source.path,
    sourceLabel: source.label,
    status: "loaded",
    versionKey: buildVersionKey(source),
    rowCount,
    error: "",
    rowsByLookupTerm,
  };
}

async function readSafeIngredientTable() {
  const source = await resolveSourceFile();
  if (!source) {
    return emptySafeIngredientTable();
  }

  try {
    if (source.kind === "jsonl") {
      return await readJsonlSafeIngredientTable(source);
    }
    return await readCsvSafeIngredientTable(source);
  } catch (error) {
    console.warn("Safe ingredient table: failed to read source", source.path, error);
    return emptySafeIngredientTable({
      sourcePath: source.path,
      sourceLabel: source.label,
      status: "error",
      versionKey: buildVersionKey(source),
      error: error?.message,
    });
  }
}

async function readSafeIngredientTableSignature() {
  const source = await resolveSourceFile();
  if (!source) return "missing";
  return `${source.path}:${buildVersionKey(source)}`;
}

export async function loadSafeIngredientTable() {
  const signature = await readSafeIngredientTableSignature();
  if (cachedTable && cachedTableSignature === signature) {
    return cachedTable;
  }

  if (cachedTablePromise) {
    return await cachedTablePromise;
  }

  cachedTablePromise = (async () => {
    const table = await readSafeIngredientTable();
    cachedTable = table;
    cachedTableSignature = signature;
    return table;
  })();

  try {
    return await cachedTablePromise;
  } finally {
    cachedTablePromise = null;
  }
}

export async function findSafeIngredientTableMatches(candidateTexts) {
  const safeCandidateTexts = dedupeStrings(candidateTexts);
  const table = await loadSafeIngredientTable();

  if (!safeCandidateTexts.length) {
    return {
      matchedCandidateCount: 0,
      matchedCandidateTexts: [],
      matchedEntriesByCandidateText: {},
      sourceLabel: table.sourceLabel,
      sourcePath: table.sourcePath,
      tableStatus: table.status,
      tableVersionKey: table.versionKey,
      tableRowCount: table.rowCount,
      tableError: table.error,
    };
  }

  if (
    table.status !== "loaded" ||
    !table.rowsByLookupTerm ||
    typeof table.rowsByLookupTerm.get !== "function"
  ) {
    return {
      matchedCandidateCount: 0,
      matchedCandidateTexts: [],
      matchedEntriesByCandidateText: {},
      sourceLabel: table.sourceLabel,
      sourcePath: table.sourcePath,
      tableStatus: table.status,
      tableVersionKey: table.versionKey,
      tableRowCount: table.rowCount,
      tableError: table.error,
    };
  }

  const matchedEntriesByCandidateText = {};

  safeCandidateTexts.forEach((candidateText) => {
    const variants = buildLookupVariants(candidateText);
    if (!variants.length) return;

    const dedupedMatches = new Map();
    variants.forEach((variant) => {
      const rows = table.rowsByLookupTerm.get(variant) || [];
      rows.forEach((row) => {
        if (!row?.id || dedupedMatches.has(row.id)) return;
        dedupedMatches.set(row.id, row);
      });
    });

    const matches = Array.from(dedupedMatches.values())
      .sort((left, right) => {
        const bySupport = right.lookupCount - left.lookupCount;
        if (bySupport !== 0) return bySupport;
        return left.canonicalName.localeCompare(right.canonicalName);
      })
      .slice(0, MAX_MATCHES_PER_CANDIDATE)
      .map((row) => ({
        canonicalName: row.canonicalName,
        normalizedName: row.normalizedName,
        lookupCount: row.lookupCount,
        seedSource: row.seedSource || table.sourceLabel,
      }));

    if (matches.length) {
      matchedEntriesByCandidateText[candidateText] = matches;
    }
  });

  return {
    matchedCandidateCount: Object.keys(matchedEntriesByCandidateText).length,
    matchedCandidateTexts: Object.keys(matchedEntriesByCandidateText),
    matchedEntriesByCandidateText,
    sourceLabel: table.sourceLabel,
    sourcePath: table.sourcePath,
    tableStatus: table.status,
    tableVersionKey: table.versionKey,
    tableRowCount: table.rowCount,
    tableError: table.error,
  };
}

export function resetSafeIngredientTableCache() {
  cachedTable = null;
  cachedTableSignature = "";
  cachedTablePromise = null;
}

export function getCachedSafeIngredientTableSignature() {
  return cachedTableSignature;
}
