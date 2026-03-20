function parseIngredientRows(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry && typeof entry === "object");
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry && typeof entry === "object")
      : [];
  } catch {
    return [];
  }
}

export function readOverlayIngredientRows(overlay) {
  const directRows = parseIngredientRows(overlay?.ingredients);
  if (directRows.length) return directRows;
  return parseIngredientRows(overlay?.aiIngredients);
}

export function getOverlayPublicationState(overlay) {
  const ingredientRows = readOverlayIngredientRows(overlay);
  const totalIngredientRows = ingredientRows.length;
  // Only an explicit false should unpublish a dish so legacy rows without
  // confirmation data do not disappear until a manager re-saves them.
  const unconfirmedIngredientRows = ingredientRows.filter(
    (ingredient) => ingredient?.confirmed === false,
  ).length;

  return {
    totalIngredientRows,
    unconfirmedIngredientRows,
    isPublished: totalIngredientRows === 0 || unconfirmedIngredientRows === 0,
  };
}

export function isOverlayPublished(overlay) {
  return getOverlayPublicationState(overlay).isPublished;
}

export function filterPublishedOverlays(overlays) {
  return (Array.isArray(overlays) ? overlays : []).filter((overlay) =>
    isOverlayPublished(overlay),
  );
}

export function buildOverlayPublicationSummary(overlays) {
  const list = Array.isArray(overlays) ? overlays : [];
  const publishedOverlayCount = list.filter((overlay) => isOverlayPublished(overlay)).length;

  return {
    totalOverlayCount: list.length,
    publishedOverlayCount,
    unpublishedOverlayCount: Math.max(list.length - publishedOverlayCount, 0),
  };
}
