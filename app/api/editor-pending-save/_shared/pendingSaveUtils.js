import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;
export const prisma = globalForPrisma.__clarivorePrisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__clarivorePrisma = prisma;
}

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

export function normalizeIngredientRow(row, index) {
  return {
    rowIndex: Number.isFinite(Number(row?.rowIndex))
      ? Math.max(Math.floor(Number(row.rowIndex)), 0)
      : index,
    name: asText(row?.name) || `Ingredient ${index + 1}`,
    allergens: normalizeStringList(row?.allergens),
    crossContaminationAllergens: normalizeStringList(row?.crossContaminationAllergens),
    diets: normalizeStringList(row?.diets),
    crossContaminationDiets: normalizeStringList(row?.crossContaminationDiets),
    removable: Boolean(row?.removable),
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
