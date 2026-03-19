function asText(value) {
  return String(value || "").trim();
}

export function clearIngredientBrandSelectionFields(ingredient) {
  const next = ingredient && typeof ingredient === "object" ? { ...ingredient } : {};
  next.brands = [];

  [
    "appliedBrandItem",
    "appliedBrand",
    "brandName",
    "barcode",
    "brandImage",
    "ingredientsImage",
    "image",
    "ingredientList",
    "ingredientsList",
    "parsedIngredientsList",
  ].forEach((key) => {
    delete next[key];
  });

  return next;
}

export function applyIngredientBrandSelectionFields(ingredient, brand) {
  const normalized = clearIngredientBrandSelectionFields(ingredient);
  const safeBrand = brand && typeof brand === "object" ? { ...brand } : null;
  const brandName = asText(safeBrand?.name || safeBrand?.productName);
  if (!brandName || !safeBrand) {
    return normalized;
  }

  normalized.brands = [safeBrand];
  normalized.appliedBrandItem = brandName;
  normalized.appliedBrand = brandName;
  normalized.brandName = brandName;

  const barcode = asText(safeBrand?.barcode);
  if (barcode) {
    normalized.barcode = barcode;
  }

  return normalized;
}
