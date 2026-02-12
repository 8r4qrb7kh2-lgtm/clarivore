function asText(value) {
  return String(value || "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function includesPreference(values, preference) {
  const target = normalizeToken(preference);
  if (!target) return false;
  return (Array.isArray(values) ? values : []).some(
    (value) => normalizeToken(value) === target,
  );
}

function dedupeByToken(values) {
  const seen = new Set();
  const output = [];

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

function normalizeReason(value) {
  return asText(value).replace(/^contains\s+/i, "").replace(/^due to\s+/i, "");
}

function formatOxfordList(values) {
  const cleaned = dedupeByToken((values || []).map(normalizeReason)).filter(Boolean);
  if (!cleaned.length) return "";
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
}

function buildDueBullet(values, fallback = "due to flagged menu entry") {
  const phrase = formatOxfordList(Array.isArray(values) ? values : []);
  return phrase ? `due to ${phrase}` : fallback;
}

function lookupDetailByKey(dish, key) {
  if (!dish?.details || typeof dish.details !== "object") return "";
  const target = normalizeToken(key);
  if (!target) return "";

  for (const [detailKey, detailValue] of Object.entries(dish.details)) {
    if (String(detailKey || "").startsWith("__")) continue;
    if (normalizeToken(detailKey) === target) {
      return asText(detailValue);
    }
  }

  return "";
}

function lookupDetailByKeys(dish, keys) {
  for (const key of keys) {
    const detail = lookupDetailByKey(dish, key);
    if (detail) return detail;
  }
  return "";
}

function parseDetailReasons(detail) {
  return dedupeByToken(
    asText(detail)
      .split(/\n|;|,/)
      .map((part) => normalizeReason(part)),
  );
}

function readIngredientNames(dish, matcher) {
  const ingredients = Array.isArray(dish?.ingredients) ? dish.ingredients : [];
  return dedupeByToken(
    ingredients
      .filter((ingredient) => matcher(ingredient || {}))
      .map((ingredient) => ingredient?.name),
  );
}

export function buildAllergenRows(dish, savedAllergens) {
  if (!savedAllergens.length) return [];

  return savedAllergens.map((item) => {
    const contains =
      includesPreference(dish?.allergens, item.key) ||
      includesPreference(dish?.allergens, item.label);

    const detail = contains ? lookupDetailByKeys(dish, [item.key, item.label]) : "";
    const detailReasons = parseDetailReasons(detail);
    const ingredientReasons = contains
      ? readIngredientNames(dish, (ingredient) => {
          return (
            includesPreference(ingredient?.allergens, item.key) ||
            includesPreference(ingredient?.allergens, item.label)
          );
        })
      : [];

    return {
      key: item.key,
      tone: contains ? "bad" : "good",
      title: contains
        ? `${item.emoji || "⚠"} Contains ${item.label}`
        : `${item.emoji || "✓"} This dish is free of ${item.label}`,
      reasonBullet: contains
        ? buildDueBullet(detailReasons.length ? detailReasons : ingredientReasons)
        : "",
    };
  });
}

export function buildDietRows(dish, savedDiets) {
  if (!savedDiets.length) return [];

  return savedDiets.map((item) => {
    const compatible =
      includesPreference(dish?.diets, item.key) || includesPreference(dish?.diets, item.label);

    const detail = !compatible ? lookupDetailByKeys(dish, [item.key, item.label]) : "";
    const detailReasons = parseDetailReasons(detail);

    const blockers = Array.isArray(dish?.ingredientsBlockingDiets?.[item.label])
      ? dish.ingredientsBlockingDiets[item.label]
      : Array.isArray(dish?.ingredientsBlockingDiets?.[item.key])
        ? dish.ingredientsBlockingDiets[item.key]
        : [];

    const blockerReasons = blockers.map((entry) => entry?.ingredient || entry?.name || "");

    return {
      key: item.key,
      tone: compatible ? "good" : "bad",
      title: compatible
        ? `${item.emoji || "✓"} This dish is ${item.label}`
        : `${item.emoji || "⚠"} This dish is not ${item.label}`,
      reasonBullet: !compatible
        ? buildDueBullet(detailReasons.length ? detailReasons : blockerReasons)
        : "",
    };
  });
}

export function buildAllergenCrossRows(dish, savedAllergens) {
  const crossAllergens = Array.isArray(dish?.crossContaminationAllergens) ? dish.crossContaminationAllergens : [];

  return savedAllergens
    .filter((item) => {
      return (
        includesPreference(crossAllergens, item.key) ||
        includesPreference(crossAllergens, item.label)
      );
    })
    .map((item) => {
      const detail = lookupDetailByKeys(dish, [
        `cross contamination ${item.key}`,
        `cross contamination ${item.label}`,
        `cross ${item.key}`,
        `cross ${item.label}`,
        `crosscontamination ${item.key}`,
        `crosscontamination ${item.label}`,
      ]);

      const detailReasons = parseDetailReasons(detail);
      const ingredientReasons = readIngredientNames(dish, (ingredient) => {
        return (
          includesPreference(ingredient?.crossContaminationAllergens, item.key) ||
          includesPreference(ingredient?.crossContaminationAllergens, item.label)
        );
      });

      return {
        key: `cross-allergen-${item.key}`,
        tone: "cross",
        title: `Cross-contamination risk for ${item.label}`,
        reasonBullet: buildDueBullet(detailReasons.length ? detailReasons : ingredientReasons),
      };
    });
}

export function buildDietCrossRows(dish, savedDiets) {
  const crossDiets = Array.isArray(dish?.crossContaminationDiets)
    ? dish.crossContaminationDiets
    : [];

  return savedDiets
    .filter((item) => {
      return includesPreference(crossDiets, item.key) || includesPreference(crossDiets, item.label);
    })
    .map((item) => {
      const detail = lookupDetailByKeys(dish, [
        `cross contamination ${item.key}`,
        `cross contamination ${item.label}`,
        `cross ${item.key}`,
        `cross ${item.label}`,
        `crosscontamination ${item.key}`,
        `crosscontamination ${item.label}`,
      ]);

      const detailReasons = parseDetailReasons(detail);
      const ingredientReasons = readIngredientNames(dish, (ingredient) => {
        return (
          includesPreference(ingredient?.crossContaminationDiets, item.key) ||
          includesPreference(ingredient?.crossContaminationDiets, item.label)
        );
      });

      return {
        key: `cross-diet-${item.key}`,
        tone: "cross",
        title: `Cross-contamination risk for ${item.label}`,
        reasonBullet: buildDueBullet(detailReasons.length ? detailReasons : ingredientReasons),
      };
    });
}

export function mergeSectionRows(baseRows, crossRows) {
  const merged = [...(Array.isArray(baseRows) ? baseRows : [])];

  (Array.isArray(crossRows) ? crossRows : []).forEach((crossRow) => {
    const duplicateIndex = merged.findIndex((row) => {
      return normalizeToken(row?.title) === normalizeToken(crossRow?.title);
    });

    if (duplicateIndex >= 0) {
      merged.splice(duplicateIndex + 1, 0, crossRow);
    } else {
      merged.push(crossRow);
    }
  });

  return merged;
}

export default {
  buildAllergenRows,
  buildDietRows,
  buildAllergenCrossRows,
  buildDietCrossRows,
  mergeSectionRows,
};
