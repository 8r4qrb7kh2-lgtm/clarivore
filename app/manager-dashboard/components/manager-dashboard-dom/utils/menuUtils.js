// Utilities here normalize dish keys and compute dietary safety decisions.
// They are reused by analytics, heatmap calculations, and modal summaries.

export function normalizeDishKey(value) {
  // Normalized keys let us match records from different tables reliably.
  return String(value || "").trim().toLowerCase();
}

export function getOverlayDishName(overlay, fallbackIndex = 0) {
  // Overlay naming has multiple historical field names; we check them in priority order.
  return (
    overlay?.id ||
    overlay?.dish_name ||
    overlay?.label ||
    overlay?.name ||
    `Dish ${fallbackIndex + 1}`
  );
}

export function computeDishStatusForUser(
  dishOverlay,
  userAllergens,
  userDiets,
  normalizeAllergen,
  normalizeDietLabel,
) {
  // Missing overlay means we cannot classify, so return neutral.
  if (!dishOverlay) return "neutral";

  // Dish constraints: which allergens are present and which of those are removable.
  const dishAllergens = (dishOverlay.allergens || [])
    .map(normalizeAllergen)
    .filter(Boolean);
  const removableAllergens = (dishOverlay.removable || [])
    .map((entry) => normalizeAllergen(entry?.allergen || ""))
    .filter(Boolean);
  const dishDiets = new Set((dishOverlay.diets || []).map(normalizeDietLabel).filter(Boolean));

  // User constraints normalized to the same vocabulary as dish values.
  const normalizedUserAllergens = (userAllergens || [])
    .map(normalizeAllergen)
    .filter(Boolean);
  const normalizedUserDiets = (userDiets || [])
    .map(normalizeDietLabel)
    .filter(Boolean);

  // Conflict detection is split into non-removable allergens and unmet diets.
  const conflictingAllergens = normalizedUserAllergens.filter((allergen) =>
    dishAllergens.includes(allergen),
  );
  const unsafeAllergens = conflictingAllergens.filter(
    (allergen) => !removableAllergens.includes(allergen),
  );
  const removableConflicts = conflictingAllergens.filter((allergen) =>
    removableAllergens.includes(allergen),
  );
  const unmetDiets = normalizedUserDiets.filter((diet) => !dishDiets.has(diet));

  // Priority: unsafe > removable > safe.
  if (unsafeAllergens.length > 0 || unmetDiets.length > 0) {
    return "unsafe";
  }
  if (removableConflicts.length > 0) {
    return "removable";
  }
  return "safe";
}

export function resolveAllergenMetricKeys(row, normalizeAllergen) {
  // Some analytics rows use dynamic keys like `users_with_tree_nut_allergy`.
  // This helper maps normalized allergen labels back to those keys.
  const keys = {};
  if (!row || typeof row !== "object") return keys;

  const prefix = "users_with_";
  const suffix = "_allergy";

  Object.keys(row).forEach((key) => {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) return;
    const raw = key.slice(prefix.length, -suffix.length).replace(/_/g, " ");
    const normalized = normalizeAllergen(raw);
    if (normalized && !keys[normalized]) {
      keys[normalized] = key;
    }
  });

  return keys;
}
