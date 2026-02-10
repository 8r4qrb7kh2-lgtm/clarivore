import { isManagerOrOwnerUser } from "./managerRestaurants";

function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function getRestaurantLastConfirmedDate(restaurant) {
  if (!restaurant || typeof restaurant !== "object") return null;
  return toDate(restaurant.last_confirmed || restaurant.lastConfirmed);
}

export function isRestaurantRecentlyConfirmed(
  restaurant,
  { maxAgeDays = 30, now = new Date() } = {},
) {
  const lastConfirmed = getRestaurantLastConfirmedDate(restaurant);
  if (!lastConfirmed) return false;

  const threshold = new Date(now);
  threshold.setDate(threshold.getDate() - maxAgeDays);
  return lastConfirmed >= threshold;
}

export function filterRestaurantsByVisibility(
  restaurants,
  { user = null, maxAgeDays = 30, now = new Date() } = {},
) {
  const list = Array.isArray(restaurants) ? restaurants : [];
  if (isManagerOrOwnerUser(user)) return list;

  return list.filter((restaurant) =>
    isRestaurantRecentlyConfirmed(restaurant, { maxAgeDays, now }),
  );
}
