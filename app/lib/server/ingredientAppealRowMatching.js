function asText(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readIngredientPayloadName(row) {
  const payload = row?.ingredient_payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const payloadName = asText(payload.name);
    if (payloadName) return payloadName;
  }
  return asText(row?.row_text);
}

export function selectIngredientRowsForAppeal({
  rows,
  dishName,
  ingredientName,
}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) return [];

  const dishToken = normalizeToken(dishName);
  const ingredientToken = normalizeToken(ingredientName);

  const dishRows = dishToken
    ? safeRows.filter((row) => normalizeToken(row?.dish_name) === dishToken)
    : safeRows;
  if (dishToken && !dishRows.length) {
    return [];
  }

  if (!ingredientToken) {
    return dishRows;
  }

  return dishRows.filter(
    (row) => normalizeToken(readIngredientPayloadName(row)) === ingredientToken,
  );
}
