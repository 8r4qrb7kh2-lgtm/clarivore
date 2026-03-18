import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;
const MISSING_DATABASE_URL_MESSAGE = "Database configuration missing: DATABASE_URL.";

function hasDatabaseUrl() {
  return String(process.env.DATABASE_URL || "").trim().length > 0;
}

function createPrismaClient() {
  if (!hasDatabaseUrl()) {
    throw new Error(MISSING_DATABASE_URL_MESSAGE);
  }

  const existingClient = globalForPrisma.__clarivorePrisma;
  if (existingClient) {
    return existingClient;
  }

  const client = new PrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__clarivorePrisma = client;
  }
  return client;
}

export function isDatabaseConfigured() {
  return hasDatabaseUrl();
}

export function getMissingDatabaseUrlMessage() {
  return MISSING_DATABASE_URL_MESSAGE;
}

export const prisma = new Proxy(
  {},
  {
    get(_target, property) {
      const client = createPrismaClient();
      const value = client[property];
      return typeof value === "function" ? value.bind(client) : value;
    },
  },
);

export function asText(value) {
  return String(value || "").trim();
}

export function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeStringList(values) {
  const seen = new Set();
  const output = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = asText(value);
    const token = normalizeToken(text);
    if (!token || seen.has(token)) return;
    seen.add(token);
    output.push(text);
  });
  return output.sort((left, right) => left.localeCompare(right));
}

export function toDishKey(value) {
  const text = asText(value);
  return normalizeToken(text) || text;
}

export function readOverlayDishName(overlay) {
  return asText(overlay?.id || overlay?.name || overlay?.dishName);
}

export function readOverlayIngredients(overlay) {
  return Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];
}

function normalizeBrandEntry(brand) {
  const safe = brand && typeof brand === "object" ? brand : {};
  const name = asText(safe?.name || safe?.productName);
  if (!name) return null;
  return {
    ...safe,
    name,
  };
}

function readFirstBrandEntry(values) {
  const list = Array.isArray(values) ? values : [];
  for (const value of list) {
    const normalized = normalizeBrandEntry(value);
    if (normalized) return normalized;
  }
  return null;
}

export function normalizeIngredientRow(row, index) {
  const firstBrand = readFirstBrandEntry(row?.brands);
  const appliedBrandItem = asText(
    firstBrand?.name || row?.appliedBrandItem || row?.appliedBrand || row?.brandName,
  );

  return {
    rowIndex: Number.isFinite(Number(row?.rowIndex))
      ? Math.max(Math.floor(Number(row.rowIndex)), 0)
      : index,
    name: asText(row?.name) || `Ingredient ${index + 1}`,
    allergens: normalizeStringList(row?.allergens),
    crossContaminationAllergens: normalizeStringList(row?.crossContaminationAllergens),
    diets: normalizeStringList(row?.diets),
    crossContaminationDiets: normalizeStringList(row?.crossContaminationDiets),
    aiDetectedAllergens: normalizeStringList(
      row?.aiDetectedAllergens || row?.allergens,
    ),
    aiDetectedCrossContaminationAllergens: normalizeStringList(
      row?.aiDetectedCrossContaminationAllergens || row?.crossContaminationAllergens,
    ),
    aiDetectedDiets: normalizeStringList(row?.aiDetectedDiets || row?.diets),
    aiDetectedCrossContaminationDiets: normalizeStringList(
      row?.aiDetectedCrossContaminationDiets || row?.crossContaminationDiets,
    ),
    removable: Boolean(row?.removable),
    brands: firstBrand ? [firstBrand] : [],
    appliedBrandItem,
  };
}

export function getStateHashForSave({ overlays, menuImages }) {
  const safeOverlays = Array.isArray(overlays) ? overlays : [];
  const safeMenuImages = Array.isArray(menuImages) ? menuImages.filter(Boolean) : [];
  return JSON.stringify({ overlays: safeOverlays, menuImages: safeMenuImages });
}

export function toJsonSafe(value, fallback) {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}
