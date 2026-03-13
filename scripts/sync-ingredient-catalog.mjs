import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SEED_FILE = "ml/seeds/ingredient_catalog_seed.jsonl";
const INSERT_BATCH_SIZE = 500;
const TRANSACTION_MAX_WAIT_MS = 30_000;
const TRANSACTION_TIMEOUT_MS = 300_000;

function asText(value) {
  return String(value ?? "").trim();
}

function parseArgs(argv) {
  const output = {
    seedFile: DEFAULT_SEED_FILE,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--seed-file" && argv[index + 1]) {
      output.seedFile = argv[index + 1];
      index += 1;
    }
  }

  return output;
}

function readJsonlRows(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function normalizeStringList(values) {
  const seen = new Set();
  const output = [];

  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = asText(value);
    if (!text || seen.has(text)) return;
    seen.add(text);
    output.push(text);
  });

  return output;
}

function normalizeMetadata(metadata) {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata
    : {};
}

function normalizeRow(row) {
  const normalizedName = asText(row?.normalized_name);
  if (!normalizedName) {
    throw new Error("Catalog row missing normalized_name.");
  }
  const canonicalName = asText(row?.canonical_name) || normalizedName;
  const aliases = normalizeStringList(row?.aliases);
  const lookupTerms = normalizeStringList(row?.lookup_terms);
  const allergens = normalizeStringList(row?.allergens);
  const diets = normalizeStringList(row?.diets);
  const seedSource = asText(row?.seed_source) || "manual_seed";
  const metadata = normalizeMetadata(row?.metadata);

  return {
    canonical_name: canonicalName,
    normalized_name: normalizedName,
    aliases,
    lookup_terms: lookupTerms.length ? lookupTerms : [normalizedName],
    lookup_count: Number.isFinite(Number(row?.lookup_count))
      ? Math.max(0, Math.trunc(Number(row.lookup_count)))
      : 0,
    allergens,
    diets,
    is_ready: row?.is_ready !== false,
    seed_source: seedSource,
    metadata,
  };
}

function chunkRows(rows, chunkSize) {
  const output = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    output.push(rows.slice(index, index + chunkSize));
  }
  return output;
}

function assertUniqueNormalizedNames(rows) {
  const seen = new Map();
  for (const row of rows) {
    const normalizedName = asText(row?.normalized_name);
    if (!normalizedName) continue;
    const previous = seen.get(normalizedName);
    if (!previous) {
      seen.set(normalizedName, row);
      continue;
    }
    throw new Error(
      `Seed contains duplicate normalized_name "${normalizedName}" for canonical rows "${asText(previous.canonical_name)}" and "${asText(row?.canonical_name)}".`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const resolvedSeedFile = path.resolve(process.cwd(), args.seedFile);
  if (!fs.existsSync(resolvedSeedFile)) {
    throw new Error(`Seed file not found: ${resolvedSeedFile}`);
  }

  const prisma = new PrismaClient();
  try {
    const rows = readJsonlRows(resolvedSeedFile).map(normalizeRow);
    assertUniqueNormalizedNames(rows);
    let inserted = 0;

    await prisma.$transaction(
      async (tx) => {
        await tx.ingredient_catalog_entries.deleteMany({});

        for (const batch of chunkRows(rows, INSERT_BATCH_SIZE)) {
          if (!batch.length) continue;
          await tx.ingredient_catalog_entries.createMany({
            data: batch,
          });
          inserted += batch.length;
          console.log(`Inserted ${inserted}/${rows.length} ingredient catalog rows...`);
        }
      },
      {
        maxWait: TRANSACTION_MAX_WAIT_MS,
        timeout: TRANSACTION_TIMEOUT_MS,
      },
    );

    console.log("Ingredient catalog sync complete.");
    console.log(`Rows inserted: ${inserted}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Ingredient catalog sync failed:", error);
  process.exitCode = 1;
});
