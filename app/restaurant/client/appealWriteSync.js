function asText(value) {
  return String(value ?? "").trim();
}

export function syncIngredientAppealWriteVersion({
  persistence,
  restaurantId,
  fallbackRestaurantId,
  payload,
}) {
  if (typeof persistence?.registerExternalRestaurantWrite !== "function") {
    return false;
  }

  const safeRestaurantId = asText(restaurantId) || asText(fallbackRestaurantId);
  const writeVersion = Number(payload?.restaurantWriteVersion);
  if (!safeRestaurantId || !Number.isFinite(writeVersion)) {
    return false;
  }

  persistence.registerExternalRestaurantWrite({
    restaurantId: safeRestaurantId,
    writeVersion,
  });
  return true;
}
