function normalizeScalar(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

function normalizeObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return normalizeScalar(input);
  }

  const keys = Object.keys(input).sort();
  const output = {};

  keys.forEach((key) => {
    const value = input[key];
    if (Array.isArray(value)) {
      output[key] = value.map(normalizeScalar);
      return;
    }
    if (value && typeof value === "object") {
      output[key] = normalizeObject(value);
      return;
    }
    output[key] = normalizeScalar(value);
  });

  return output;
}

export const queryKeys = {
  auth: {
    user: (routeId = "") => ["auth", "user", { routeId: normalizeScalar(routeId) }],
  },
  restaurant: {
    boot: (slug = "", inviteToken = "", qr = false, guest = false) => [
      "restaurant",
      "boot",
      {
        slug: normalizeScalar(slug),
        inviteToken: normalizeScalar(inviteToken),
        qr: Boolean(qr),
        guest: Boolean(guest),
      },
    ],
    overlays: (restaurantId = "") => [
      "restaurant",
      "overlays",
      { restaurantId: normalizeScalar(restaurantId) },
    ],
    orders: (restaurantId = "", userId = "") => [
      "restaurant",
      "orders",
      {
        restaurantId: normalizeScalar(restaurantId),
        userId: normalizeScalar(userId),
      },
    ],
  },
  favorites: {
    page: (userId = "") => ["favorites", "page", { userId: normalizeScalar(userId) }],
  },
  dishes: {
    search: (userId = "", filters = {}, query = "") => [
      "dishes",
      "search",
      {
        userId: normalizeScalar(userId),
        filters: normalizeObject(filters),
        query: normalizeScalar(query),
      },
    ],
  },
};

export default queryKeys;
