export function createIngredientNormalizer(options = {}) {
  const normalizeAllergen =
    typeof options.normalizeAllergen === "function"
      ? options.normalizeAllergen
      : (value) => String(value ?? "").trim();
  const normalizeDietLabel =
    typeof options.normalizeDietLabel === "function"
      ? options.normalizeDietLabel
      : (value) => String(value ?? "").trim();
  const allergenKeys = Array.isArray(options.ALLERGENS)
    ? options.ALLERGENS.map((item) => String(item ?? "").trim())
    : [];
  const dietLabels = Array.isArray(options.DIETS)
    ? options.DIETS.map((item) => String(item ?? "").trim())
    : [];
  const allergenSet = new Set(allergenKeys.filter(Boolean));
  const dietLabelSet = new Set(dietLabels.filter(Boolean));

  const normalizeAllergenKey = (value) => {
    const normalized = normalizeAllergen(value);
    if (!normalized) return "";
    const key = String(normalized).trim();
    if (!key) return "";
    if (allergenSet.size && !allergenSet.has(key)) return "";
    return key;
  };

  const normalizeDietKey = (value) => {
    const normalized = normalizeDietLabel(value);
    if (!normalized) return "";
    const label = String(normalized).trim();
    if (!label) return "";
    if (!dietLabelSet.size) return label;
    return dietLabelSet.has(label) ? label : "";
  };

  const normalizeStringArray = (list, normalizer) => {
    const items = Array.isArray(list) ? list : [];
    const seen = new Set();
    const out = [];
    items.forEach((item) => {
      const normalized = normalizer ? normalizer(item) : String(item ?? "").trim();
      if (!normalized) return;
      if (seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    });
    return out;
  };

  const normalizeTextArray = (list) => {
    const items = Array.isArray(list) ? list : [];
    const seen = new Set();
    const out = [];
    items.forEach((item) => {
      const normalized = String(item ?? "").trim();
      if (!normalized) return;
      if (seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    });
    return out;
  };

  const pruneMayContain = (contains, mayContain) => {
    const containsSet = new Set(contains);
    return mayContain.filter((item) => !containsSet.has(item));
  };

  const sanitizeBrandEntry = (brand = {}) => {
    const allergens = normalizeStringArray(
      brand.allergens,
      normalizeAllergenKey,
    );
    const mayContainAllergens = pruneMayContain(
      allergens,
      normalizeStringArray(brand.mayContainAllergens, normalizeAllergenKey),
    );
    const diets = normalizeStringArray(brand.diets, normalizeDietKey);
    const mayContainDiets = pruneMayContain(
      diets,
      normalizeStringArray(brand.mayContainDiets, normalizeDietKey),
    );
    return {
      ...brand,
      name: String(brand.name ?? "").trim(),
      barcode: String(brand.barcode ?? "").trim(),
      brandImage: brand.brandImage ? String(brand.brandImage) : "",
      ingredientsImage: brand.ingredientsImage ? String(brand.ingredientsImage) : "",
      ingredientsList: normalizeTextArray(brand.ingredientsList),
      allergens,
      mayContainAllergens,
      diets,
      mayContainDiets,
    };
  };

  const sanitizeIngredientRow = (row = {}) => {
    const allergens = normalizeStringArray(row.allergens, normalizeAllergenKey);
    const mayContainAllergens = pruneMayContain(
      allergens,
      normalizeStringArray(row.mayContainAllergens, normalizeAllergenKey),
    );
    const diets = normalizeStringArray(row.diets, normalizeDietKey);
    const mayContainDiets = pruneMayContain(
      diets,
      normalizeStringArray(row.mayContainDiets, normalizeDietKey),
    );
    const aiDetectedAllergens = normalizeStringArray(
      row.aiDetectedAllergens,
      normalizeAllergenKey,
    );
    const aiDetectedMayContainAllergens = pruneMayContain(
      aiDetectedAllergens,
      normalizeStringArray(row.aiDetectedMayContainAllergens, normalizeAllergenKey),
    );
    const aiDetectedDiets = normalizeStringArray(
      row.aiDetectedDiets,
      normalizeDietKey,
    );
    const aiDetectedMayContainDiets = pruneMayContain(
      aiDetectedDiets,
      normalizeStringArray(row.aiDetectedMayContainDiets, normalizeDietKey),
    );
    const brands = Array.isArray(row.brands)
      ? row.brands
          .map((brand) => sanitizeBrandEntry(brand))
          .filter((brand) =>
            Boolean(
              brand.name ||
                brand.barcode ||
                brand.ingredientsList?.length ||
                brand.brandImage ||
                brand.ingredientsImage,
            ),
          )
      : [];

    return {
      ...row,
      name: String(row.name ?? "").trim(),
      ingredientsList: normalizeTextArray(row.ingredientsList),
      allergens,
      mayContainAllergens,
      diets,
      mayContainDiets,
      aiDetectedAllergens,
      aiDetectedMayContainAllergens,
      aiDetectedDiets,
      aiDetectedMayContainDiets,
      brands,
    };
  };

  const sanitizeIngredientRows = (rows) =>
    (Array.isArray(rows) ? rows : []).map((row) => sanitizeIngredientRow(row));

  return {
    normalizeAllergenKey,
    normalizeDietKey,
    normalizeStringArray,
    sanitizeIngredientRow,
    sanitizeIngredientRows,
    sanitizeBrandEntry,
  };
}
