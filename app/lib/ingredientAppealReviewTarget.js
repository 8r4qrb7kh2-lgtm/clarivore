function asText(value) {
  return String(value ?? "").trim();
}

export function buildIngredientAppealReviewTarget({
  appealId,
  rowId,
} = {}) {
  const safeAppealId = asText(appealId);
  if (safeAppealId) {
    return `appeal:${safeAppealId}`;
  }

  const safeRowId = asText(rowId);
  if (safeRowId) {
    return `row:${safeRowId}`;
  }

  return "";
}

export function parseIngredientAppealReviewTarget(value) {
  const safeValue = asText(value);
  if (!safeValue) {
    return { type: "", value: "", legacy: false };
  }

  if (safeValue.startsWith("appeal:")) {
    return {
      type: "appeal",
      value: asText(safeValue.slice("appeal:".length)),
      legacy: false,
    };
  }

  if (safeValue.startsWith("row:")) {
    return {
      type: "row",
      value: asText(safeValue.slice("row:".length)),
      legacy: false,
    };
  }

  return {
    type: "appeal",
    value: safeValue,
    legacy: true,
  };
}
