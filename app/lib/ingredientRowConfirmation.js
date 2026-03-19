import { normalizeIngredientBrandAppeal } from "./ingredientBrandAppeal.js";

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dedupeTokenList(values) {
  const output = [];
  const seen = new Set();

  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = asText(value);
    if (!text) return;

    const token = normalizeToken(text);
    if (!token || seen.has(token)) return;

    seen.add(token);
    output.push(text);
  });

  return output;
}

function normalizeBrandForConfirmationSignature(brand) {
  const safe = brand && typeof brand === "object" ? brand : {};
  const name = asText(safe.name || safe.productName);
  if (!name) return null;

  return {
    name,
    allergens: dedupeTokenList(safe.allergens),
    diets: dedupeTokenList(safe.diets),
    crossContaminationAllergens: dedupeTokenList(safe.crossContaminationAllergens),
    crossContaminationDiets: dedupeTokenList(safe.crossContaminationDiets),
    ingredientsList: Array.isArray(safe.ingredientsList)
      ? safe.ingredientsList.map((line) => asText(line)).filter(Boolean)
      : [],
    parsedIngredientsList: Array.isArray(safe.parsedIngredientsList)
      ? safe.parsedIngredientsList.map((line) => asText(line)).filter(Boolean)
      : [],
  };
}

export function buildIngredientConfirmationSignature(ingredient) {
  const safe = ingredient && typeof ingredient === "object" ? ingredient : {};
  const normalizedAppeal = normalizeIngredientBrandAppeal(safe.brandAppeal);

  return JSON.stringify({
    name: asText(safe.name),
    allergens: dedupeTokenList(safe.allergens),
    diets: dedupeTokenList(safe.diets),
    crossContaminationAllergens: dedupeTokenList(safe.crossContaminationAllergens),
    crossContaminationDiets: dedupeTokenList(safe.crossContaminationDiets),
    aiDetectedAllergens: dedupeTokenList(safe.aiDetectedAllergens),
    aiDetectedDiets: dedupeTokenList(safe.aiDetectedDiets),
    aiDetectedCrossContaminationAllergens: dedupeTokenList(
      safe.aiDetectedCrossContaminationAllergens,
    ),
    aiDetectedCrossContaminationDiets: dedupeTokenList(
      safe.aiDetectedCrossContaminationDiets,
    ),
    brands: (Array.isArray(safe.brands) ? safe.brands : [])
      .map((brand) => normalizeBrandForConfirmationSignature(brand))
      .filter(Boolean),
    brandRequired: Boolean(safe.brandRequired),
    brandRequirementReason: asText(safe.brandRequirementReason),
    removable: Boolean(safe.removable),
    brandAppeal: normalizedAppeal,
  });
}

export function resetIngredientConfirmationIfChanged(previousIngredient, nextIngredient) {
  const nextSafe =
    nextIngredient && typeof nextIngredient === "object" ? { ...nextIngredient } : {};
  const previousSignature = buildIngredientConfirmationSignature(previousIngredient);
  const nextSignature = buildIngredientConfirmationSignature(nextSafe);
  if (previousSignature === nextSignature) {
    return nextSafe;
  }

  return {
    ...nextSafe,
    confirmed: false,
  };
}
