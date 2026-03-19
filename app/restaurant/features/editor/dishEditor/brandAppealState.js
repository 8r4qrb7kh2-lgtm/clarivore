import { normalizeIngredientBrandAppeal } from "../../../../lib/ingredientBrandAppeal.js";
export { normalizeIngredientBrandAppeal };

function asText(value) {
  return String(value ?? "").trim();
}

function createAppealId() {
  if (typeof globalThis?.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `appeal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildPendingIngredientBrandAppeal({
  existingAppeal,
  managerMessage,
  photoDataUrl,
  submittedAt,
  appealId,
}) {
  const normalizedExisting = normalizeIngredientBrandAppeal(existingAppeal);
  const shouldReuseExisting = normalizedExisting?.status === "pending";

  return normalizeIngredientBrandAppeal({
    ...(shouldReuseExisting ? normalizedExisting : {}),
    id: asText(appealId) || (shouldReuseExisting ? asText(normalizedExisting?.id) : "") || createAppealId(),
    reviewStatus: "pending",
    managerMessage,
    photoUrl: "",
    photoDataUrl,
    photoAttached: Boolean(asText(photoDataUrl)),
    submittedAt: asText(submittedAt),
    reviewedAt: "",
    reviewedBy: "",
    reviewNotes: "",
  });
}

export function applyIngredientBrandAppeal(ingredient, appeal) {
  const next = ingredient && typeof ingredient === "object" ? { ...ingredient } : {};
  const normalizedAppeal = normalizeIngredientBrandAppeal(appeal);
  if (!normalizedAppeal) {
    delete next.brandAppeal;
    return next;
  }

  next.brandAppeal = normalizedAppeal;
  return next;
}

export function clearIngredientBrandAppeal(ingredient) {
  const next = ingredient && typeof ingredient === "object" ? { ...ingredient } : {};
  delete next.brandAppeal;
  return next;
}

export function isIngredientBrandAppealPending(ingredient) {
  const normalizedAppeal = normalizeIngredientBrandAppeal(ingredient?.brandAppeal);
  return normalizedAppeal?.status === "pending";
}
