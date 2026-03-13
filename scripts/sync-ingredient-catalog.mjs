import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SEED_FILE = "ml/seeds/ingredient_catalog_seed.jsonl";
const SAFE_DIETS = ["Vegan", "Vegetarian", "Pescatarian", "Gluten-free"];
const SAFE_SEED_PREFIX = "openfoodfacts_safe_only_";
const INSERT_BATCH_SIZE = 500;

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

function hasSafeDietSet(diets) {
  const actual = new Set(normalizeStringList(diets));
  if (actual.size !== SAFE_DIETS.length) return false;
  return SAFE_DIETS.every((label) => actual.has(label));
}

function normalizeMetadata(metadata) {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata
    : {};
}

function assertSafeOnlyRow(row) {
  const metadata = normalizeMetadata(row?.metadata);
  const seedSource = asText(row?.seed_source || row?.seedSource);
  const allergens = normalizeStringList(row?.allergens);
  const diets = normalizeStringList(row?.diets);
  const catalogType = asText(metadata?.catalog_type || metadata?.catalogType);

  if (!seedSource.startsWith(SAFE_SEED_PREFIX)) {
    throw new Error(
      `Catalog row "${asText(row?.normalized_name)}" is not a safe-only OFF seed row.`,
    );
  }
  if (catalogType !== "safe_only") {
    throw new Error(
      `Catalog row "${asText(row?.normalized_name)}" is missing metadata.catalog_type=safe_only.`,
    );
  }
  if (allergens.length) {
    throw new Error(
      `Catalog row "${asText(row?.normalized_name)}" unexpectedly contains allergens.`,
    );
  }
  if (!hasSafeDietSet(diets)) {
    throw new Error(
      `Catalog row "${asText(row?.normalized_name)}" is missing the full safe diet set.`,
    );
  }
  if (row?.is_ready !== true) {
    throw new Error(
      `Catalog row "${asText(row?.normalized_name)}" must be marked is_ready=true.`,
    );
  }
}

function normalizeRow(row) {
  const normalizedName = asText(row?.normalized_name);
  if (!normalizedName) {
    throw new Error("Catalog row missing normalized_name.");
  }

  assertSafeOnlyRow(row);

  return {
    canonical_name: asText(row?.canonical_name) || normalizedName,
    normalized_name: normalizedName,
    aliases: normalizeStringList(row?.aliases),
    lookup_terms: normalizeStringList(row?.lookup_terms),
    lookup_count: Number.isFinite(Number(row?.lookup_count))
      ? Math.max(0, Math.trunc(Number(row.lookup_count)))
      : 0,
    allergens: [],
    diets: SAFE_DIETS,
    is_ready: true,
    seed_source: asText(row?.seed_source) || `${SAFE_SEED_PREFIX}v1`,
    metadata: normalizeMetadata(row?.metadata),
  };
}

function chunkRows(rows, chunkSize) {
  const output = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    output.push(rows.slice(index, index + chunkSize));
  }
  return output;
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
    let inserted = 0;

    await prisma.$transaction(async (tx) => {
      await tx.ingredient_catalog_entries.deleteMany({});

      for (const batch of chunkRows(rows, INSERT_BATCH_SIZE)) {
        if (!batch.length) continue;
        await tx.ingredient_catalog_entries.createMany({
          data: batch,
        });
        inserted += batch.length;
        console.log(`Inserted ${inserted}/${rows.length} ingredient catalog rows...`);
      }
    });

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
