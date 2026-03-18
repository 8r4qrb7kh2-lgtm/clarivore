import fsp from "node:fs/promises";
import path from "node:path";

const SAFE_INGREDIENTS_CSV_PATH = path.join(process.cwd(), "safe-ingredients.csv");
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

function normalizeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
}

function emptySafeIngredientTable({
  status = "missing",
  versionKey = "missing",
  error = "",
} = {}) {
  return {
    sourcePath: SAFE_INGREDIENTS_CSV_PATH,
    sourceLabel: "safe-ingredients.csv",
    status,
    versionKey,
    rowCount: 0,
    error: asText(error),
    rowsByLookupTerm: new Map(),
  };
}

function buildSafeIngredientRow(record, index) {
  const ingredient = asText(record?.ingredient);
  const ingredientKey = asText(record?.ingredient_key);
  if (!ingredient && !ingredientKey) return null;

  const productOccurrences = normalizeInteger(record?.product_occurrences);
  const lookupTerms = dedupeStrings([
    ingredientKey,
    ingredient,
    ...buildLookupVariants(ingredientKey),
    ...buildLookupVariants(ingredient),
  ]);

  if (!lookupTerms.length) return null;

  return {
    id: `${ingredientKey || ingredient || "row"}:${index}`,
    ingredient,
    ingredientKey,
    productOccurrences,
    lookupTerms,
  };
}

async function readSafeIngredientTable() {
  let stat;
  try {
    stat = await fsp.stat(SAFE_INGREDIENTS_CSV_PATH);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return emptySafeIngredientTable();
    }
    console.warn("Safe ingredient table: failed to stat CSV", error);
    return emptySafeIngredientTable({
      status: "error",
      versionKey: "error",
      error: error?.message,
    });
  }

  const versionKey = `${Math.trunc(Number(stat.size) || 0)}:${Math.trunc(Number(stat.mtimeMs) || 0)}`;
  const content = await fsp.readFile(SAFE_INGREDIENTS_CSV_PATH, "utf8");
  const rows = parseCsvRows(content);
  if (!rows.length) {
    return emptySafeIngredientTable({
      status: "empty",
      versionKey,
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

    const normalizedRow = buildSafeIngredientRow(record, index);
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
        const bySupport = right.productOccurrences - left.productOccurrences;
        if (bySupport !== 0) return bySupport;
        return left.ingredient.localeCompare(right.ingredient);
      }),
    );
  });

  return {
    sourcePath: SAFE_INGREDIENTS_CSV_PATH,
    sourceLabel: "safe-ingredients.csv",
    status: "loaded",
    versionKey,
    rowCount,
    error: "",
    rowsByLookupTerm,
  };
}

async function readSafeIngredientTableSignature() {
  try {
    const stat = await fsp.stat(SAFE_INGREDIENTS_CSV_PATH);
    return `${Math.trunc(Number(stat.size) || 0)}:${Math.trunc(Number(stat.mtimeMs) || 0)}`;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "missing";
    }
    return "error";
  }
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
        const bySupport = right.productOccurrences - left.productOccurrences;
        if (bySupport !== 0) return bySupport;
        return left.ingredient.localeCompare(right.ingredient);
      })
      .slice(0, MAX_MATCHES_PER_CANDIDATE)
      .map((row) => ({
        canonicalName: row.ingredient,
        normalizedName: row.ingredientKey,
        lookupCount: row.productOccurrences,
        seedSource: table.sourceLabel,
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
