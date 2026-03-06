import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SEED_FILE = "ml/seeds/ingredient_catalog_seed.jsonl";

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

function normalizeRow(row) {
  const normalizedName = asText(row?.normalized_name);
  if (!normalizedName) {
    throw new Error("Catalog row missing normalized_name.");
  }

  return {
    canonical_name: asText(row?.canonical_name) || normalizedName,
    normalized_name: normalizedName,
    aliases: normalizeStringList(row?.aliases),
    lookup_terms: normalizeStringList(row?.lookup_terms),
    lookup_count: Number.isFinite(Number(row?.lookup_count))
      ? Math.max(0, Math.trunc(Number(row.lookup_count)))
      : 0,
    allergens: normalizeStringList(row?.allergens),
    diets: normalizeStringList(row?.diets),
    is_ready: row?.is_ready === true,
    seed_source: asText(row?.seed_source) || "corpus_seed",
    metadata:
      row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata
        : {},
  };
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
    let upserted = 0;
    let ready = 0;

    for (const row of rows) {
      await prisma.ingredient_catalog_entries.upsert({
        where: {
          normalized_name: row.normalized_name,
        },
        update: {
          canonical_name: row.canonical_name,
          aliases: row.aliases,
          lookup_terms: row.lookup_terms,
          lookup_count: row.lookup_count,
          allergens: row.allergens,
          diets: row.diets,
          is_ready: row.is_ready,
          seed_source: row.seed_source,
          metadata: row.metadata,
        },
        create: row,
      });

      upserted += 1;
      if (row.is_ready) ready += 1;
      if (upserted % 100 === 0) {
        console.log(`Upserted ${upserted}/${rows.length} ingredient catalog rows...`);
      }
    }

    console.log(`Ingredient catalog sync complete.`);
    console.log(`Rows upserted: ${upserted}`);
    console.log(`Ready rows: ${ready}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Ingredient catalog sync failed:", error);
  process.exitCode = 1;
});
