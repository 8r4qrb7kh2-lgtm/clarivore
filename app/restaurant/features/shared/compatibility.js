function asText(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeList(list, normalizer) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const values = [];
  list.forEach((item) => {
    const normalized = normalizer(item);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    values.push(normalized);
  });
  return values;
}

function resolveDietLookupToken(value, normalizeDietLabel) {
  const normalized = asText(
    typeof normalizeDietLabel === "function" ? normalizeDietLabel(value) : "",
  );
  return normalizeToken(normalized || value);
}

function readDietBlockers(item, diet, normalizeDietLabel) {
  const map =
    item?.ingredientsBlockingDiets && typeof item.ingredientsBlockingDiets === "object"
      ? item.ingredientsBlockingDiets
      : null;
  if (!map) return [];

  const target = resolveDietLookupToken(diet, normalizeDietLabel);
  if (!target) return [];

  for (const [key, value] of Object.entries(map)) {
    if (resolveDietLookupToken(key, normalizeDietLabel) !== target) continue;
    if (Array.isArray(value)) return value;
    return [];
  }

  return [];
}

export function createCompatibilityEngine(config = {}) {
  const normalizeAllergen =
    typeof config.normalizeAllergen === "function"
      ? config.normalizeAllergen
      : (value) => asText(value);

  const normalizeDietLabel =
    typeof config.normalizeDietLabel === "function"
      ? config.normalizeDietLabel
      : (value) => asText(value);

  const getDietAllergenConflicts =
    typeof config.getDietAllergenConflicts === "function"
      ? config.getDietAllergenConflicts
      : () => [];

  function computeStatus(item, selectedAllergens, selectedDiets) {
    const userAllergens = normalizeList(selectedAllergens, normalizeAllergen);
    const userDiets = normalizeList(selectedDiets, normalizeDietLabel);

    const hasAllergenRequirements = userAllergens.length > 0;
    const hasDietRequirements = userDiets.length > 0;

    if (!hasAllergenRequirements && !hasDietRequirements) {
      return "neutral";
    }

    const itemAllergens = normalizeList(item?.allergens, normalizeAllergen);
    const removableAllergens = new Set(
      normalizeList(
        (item?.removable || []).map((entry) => entry?.allergen || ""),
        normalizeAllergen,
      ),
    );
    const dietSet = new Set(normalizeList(item?.diets, normalizeDietLabel));

    const allergenHits = itemAllergens.filter((allergen) =>
      userAllergens.includes(allergen),
    );

    const hardAllergenHits = allergenHits.filter(
      (allergen) => !removableAllergens.has(allergen),
    );

    if (hardAllergenHits.length > 0) {
      return "unsafe";
    }

    const unmetDiets = userDiets.filter((diet) => !dietSet.has(diet));

    let canAccommodateUnmetDiets = false;
    if (unmetDiets.length > 0) {
      canAccommodateUnmetDiets = unmetDiets.every((diet) => {
        const conflicts = getDietAllergenConflicts(diet).map(normalizeAllergen);
        const itemConflicts = itemAllergens.filter((allergen) =>
          conflicts.includes(allergen),
        );

        const allConflictsRemovable =
          itemConflicts.length > 0 &&
          itemConflicts.every((allergen) => removableAllergens.has(allergen));

        const dietBlocks = readDietBlockers(item, diet, normalizeDietLabel);

        const allDietBlocksRemovable =
          dietBlocks.length > 0 &&
          dietBlocks.every((entry) => Boolean(entry?.removable));

        if (!itemConflicts.length && !dietBlocks.length) {
          return false;
        }

        if (itemConflicts.length && !allConflictsRemovable) {
          return false;
        }

        if (dietBlocks.length && !allDietBlocksRemovable) {
          return false;
        }

        return true;
      });
    }

    if (unmetDiets.length > 0 && !canAccommodateUnmetDiets) {
      return "unsafe";
    }

    if (allergenHits.length > 0 || unmetDiets.length > 0) {
      return "removable";
    }

    return "safe";
  }

  function hasCrossContamination(item, selectedAllergens, selectedDiets) {
    const userAllergens = normalizeList(selectedAllergens, normalizeAllergen);
    const userDiets = normalizeList(selectedDiets, normalizeDietLabel);

    const crossAllergens = normalizeList(item?.crossContaminationAllergens, normalizeAllergen);
    const crossDiets = normalizeList(
      item?.crossContaminationDiets,
      normalizeDietLabel,
    );

    const allergenCrossHit = crossAllergens.some((allergen) =>
      userAllergens.includes(allergen),
    );
    const dietCrossHit = crossDiets.some((diet) => userDiets.includes(diet));

    return allergenCrossHit || dietCrossHit;
  }

  return {
    computeStatus,
    hasCrossContamination,
  };
}

export default createCompatibilityEngine;
