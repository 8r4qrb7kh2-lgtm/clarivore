function asText(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeInlineText(value) {
  return asText(value)
    .replace(/\s+/g, " ")
    .replace(/^ingredients?\s*:\s*/i, "")
    .trim();
}

function normalizeParagraphText(value) {
  const lines = asText(value)
    .split(/\n|;/)
    .map((entry) => normalizeInlineText(entry))
    .filter(Boolean);
  return lines.join(", ");
}

function readAppliedBrand(ingredient) {
  const brands = Array.isArray(ingredient?.brands) ? ingredient.brands : [];
  if (!brands.length) return null;

  const appliedToken = normalizeToken(
    ingredient?.appliedBrandItem || ingredient?.appliedBrand || ingredient?.brandName,
  );

  if (appliedToken) {
    const matchedBrand =
      brands.find((brand) => {
        return normalizeToken(brand?.name || brand?.productName || brand?.brandName) === appliedToken;
      }) || null;
    if (matchedBrand) return matchedBrand;
  }

  return brands[0] || null;
}

function readBrandIngredientText(ingredient) {
  const brand = readAppliedBrand(ingredient);
  if (!brand) return "";

  const lines = Array.isArray(brand?.ingredientsList) && brand.ingredientsList.length
    ? brand.ingredientsList
    : Array.isArray(ingredient?.ingredientsList) && ingredient.ingredientsList.length
      ? ingredient.ingredientsList
      : [brand?.ingredientList || ingredient?.ingredientList];

  return lines
    .map((entry) => normalizeInlineText(entry))
    .filter(Boolean)
    .join(", ");
}

function readIngredientsSummaryDetail(dish) {
  const details = dish?.details && typeof dish.details === "object" ? dish.details : {};

  for (const [key, value] of Object.entries(details)) {
    const normalizedKey = normalizeToken(key);
    if (!normalizedKey) continue;
    if (
      normalizedKey === "ingredientssummary" ||
      normalizedKey === "ingredients" ||
      normalizedKey === "recipeingredients"
    ) {
      return normalizeParagraphText(value);
    }
  }

  return "";
}

export function buildDishIngredientParagraph(dish) {
  const ingredients = Array.isArray(dish?.ingredients) ? dish.ingredients : [];
  const rowText = ingredients
    .map((ingredient) => {
      const ingredientName = normalizeInlineText(ingredient?.name);
      const brandIngredients = readBrandIngredientText(ingredient);

      if (ingredientName && brandIngredients) {
        return `${ingredientName} (${brandIngredients})`;
      }
      if (ingredientName) {
        return ingredientName;
      }
      return brandIngredients;
    })
    .filter(Boolean);

  if (rowText.length) {
    return rowText.join(", ");
  }

  return readIngredientsSummaryDetail(dish);
}

export function computeMobileDishPanelMaxHeight({
  viewportHeight,
  overlayBottom,
  defaultMaxHeight,
  minimumHeight = 120,
  hardMinimumHeight = 80,
  gap = 12,
}) {
  const safeViewportHeight = Number(viewportHeight);
  const safeDefaultMaxHeight = Number(defaultMaxHeight);

  if (!Number.isFinite(safeViewportHeight) || safeViewportHeight <= 0) {
    return 0;
  }

  const resolvedDefaultMaxHeight = clamp(
    Number.isFinite(safeDefaultMaxHeight) ? safeDefaultMaxHeight : safeViewportHeight,
    0,
    safeViewportHeight,
  );

  if (!Number.isFinite(Number(overlayBottom))) {
    return resolvedDefaultMaxHeight;
  }

  const safeOverlayBottom = clamp(Number(overlayBottom), 0, safeViewportHeight);
  const safeGap = Math.max(0, Number(gap) || 0);
  const resolvedHardMinimumHeight = clamp(
    Number.isFinite(Number(hardMinimumHeight)) ? Number(hardMinimumHeight) : 0,
    0,
    resolvedDefaultMaxHeight,
  );
  const resolvedMinimumHeight = clamp(
    Number.isFinite(Number(minimumHeight)) ? Number(minimumHeight) : 0,
    resolvedHardMinimumHeight,
    resolvedDefaultMaxHeight,
  );
  const availableHeight = safeViewportHeight - safeOverlayBottom - safeGap;

  if (availableHeight >= resolvedDefaultMaxHeight) {
    return resolvedDefaultMaxHeight;
  }

  if (availableHeight >= resolvedMinimumHeight) {
    return clamp(availableHeight, resolvedMinimumHeight, resolvedDefaultMaxHeight);
  }

  return clamp(availableHeight, resolvedHardMinimumHeight, resolvedDefaultMaxHeight);
}

export default {
  buildDishIngredientParagraph,
  computeMobileDishPanelMaxHeight,
};
