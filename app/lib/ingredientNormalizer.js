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
    const key = String(value ?? "").trim();
    if (!key) return "";
    return key;
  };

  const normalizeDietKey = (value) => {
    const label = String(value ?? "").trim();
    if (!label) return "";
    return label;
  };

  const normalizeStringArray = (list) => (Array.isArray(list) ? list : []);

  const normalizeTextArray = (list) => (Array.isArray(list) ? list : []);

  const pruneCrossSelections = (contains, crossRiskValues) => {
    if (!Array.isArray(crossRiskValues)) return [];
    const toToken = (value) => String(value ?? "").trim().toLowerCase();
    const containsTokens = new Set(
      (Array.isArray(contains) ? contains : [])
        .map((value) => toToken(normalizeAllergenKey(value) || normalizeDietKey(value)))
        .filter(Boolean),
    );
    return crossRiskValues.filter((value) => {
      const token = toToken(normalizeAllergenKey(value) || normalizeDietKey(value));
      return token && !containsTokens.has(token);
    });
  };

  const sanitizeBrandEntry = (brand = {}) =>
    brand && typeof brand === "object" ? { ...brand } : {};

  const sanitizeIngredientRow = (row = {}) =>
    row && typeof row === "object" ? { ...row } : {};

  const sanitizeIngredientRows = (rows) =>
    Array.isArray(rows) ? rows : [];

  return {
    normalizeAllergenKey,
    normalizeDietKey,
    normalizeStringArray,
    pruneCrossSelections,
    sanitizeIngredientRow,
    sanitizeIngredientRows,
    sanitizeBrandEntry,
  };
}
