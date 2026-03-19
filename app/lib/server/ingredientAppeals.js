import {
  normalizeIngredientBrandAppeal,
  parseIngredientBrandAppealSnapshot,
} from "../ingredientBrandAppeal.js";

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toTimestamp(value) {
  const parsed = Date.parse(asText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseJsonValue(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseIngredientNameFromSummary(summary) {
  const safeSummary = asText(summary);
  if (!safeSummary) return "";

  const forMatch = safeSummary.match(/brand assignment appeal for (.+)$/i);
  if (forMatch?.[1]) return asText(forMatch[1]);

  const prefixMatch = safeSummary.match(/^[^:]+:\s*(.+)$/);
  if (prefixMatch?.[1] && prefixMatch[1] !== safeSummary) {
    return parseIngredientNameFromSummary(prefixMatch[1]);
  }

  return "";
}

function buildAppealCompositeKey(appeal) {
  const restaurantId = asText(appeal?.restaurant_id);
  const dishName = normalizeToken(appeal?.dish_name);
  const ingredientName = normalizeToken(appeal?.ingredient_name);
  const submittedAt = asText(appeal?.submitted_at);
  if (!restaurantId || !dishName || !ingredientName || !submittedAt) return "";
  return `${restaurantId}::${dishName}::${ingredientName}::${submittedAt}`;
}

function buildAppealLooseKey(appeal) {
  const restaurantId = asText(appeal?.restaurant_id);
  const dishName = normalizeToken(appeal?.dish_name);
  const ingredientName = normalizeToken(appeal?.ingredient_name);
  if (!restaurantId || !dishName || !ingredientName) return "";
  return `${restaurantId}::${dishName}::${ingredientName}`;
}

function choosePreferredEntry(left, right) {
  const leftTimestamp = Math.max(
    toTimestamp(left?.reviewed_at),
    toTimestamp(left?.submitted_at),
    toTimestamp(left?.history_timestamp),
  );
  const rightTimestamp = Math.max(
    toTimestamp(right?.reviewed_at),
    toTimestamp(right?.submitted_at),
    toTimestamp(right?.history_timestamp),
  );
  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp >= rightTimestamp ? left : right;
  }

  if (Boolean(left?.reviewable) !== Boolean(right?.reviewable)) {
    return left?.reviewable ? left : right;
  }

  return left;
}

function mergeAppealEntries(left, right) {
  const preferred = choosePreferredEntry(left, right);
  const fallback = preferred === left ? right : left;

  return {
    id: asText(preferred?.id || fallback?.id),
    appeal_id: asText(preferred?.appeal_id || fallback?.appeal_id),
    restaurant_id: asText(preferred?.restaurant_id || fallback?.restaurant_id),
    dish_name: asText(preferred?.dish_name || fallback?.dish_name),
    ingredient_name: asText(preferred?.ingredient_name || fallback?.ingredient_name),
    submitted_at: asText(preferred?.submitted_at || fallback?.submitted_at),
    review_status: asText(preferred?.review_status || fallback?.review_status || "pending"),
    reviewed_at: asText(preferred?.reviewed_at || fallback?.reviewed_at),
    reviewed_by: asText(preferred?.reviewed_by || fallback?.reviewed_by),
    manager_message: asText(preferred?.manager_message || fallback?.manager_message),
    photo_url: asText(preferred?.photo_url || fallback?.photo_url),
    review_notes: asText(preferred?.review_notes || fallback?.review_notes),
    restaurants:
      (preferred?.restaurants && typeof preferred.restaurants === "object")
        ? preferred.restaurants
        : (fallback?.restaurants && typeof fallback.restaurants === "object")
          ? fallback.restaurants
          : null,
    reviewable: Boolean(left?.reviewable) || Boolean(right?.reviewable),
    history_only: Boolean(left?.history_only) && Boolean(right?.history_only),
    history_timestamp: asText(preferred?.history_timestamp || fallback?.history_timestamp),
  };
}

function sortAppealsNewestFirst(left, right) {
  const leftTimestamp = Math.max(
    toTimestamp(left?.submitted_at),
    toTimestamp(left?.reviewed_at),
    toTimestamp(left?.history_timestamp),
  );
  const rightTimestamp = Math.max(
    toTimestamp(right?.submitted_at),
    toTimestamp(right?.reviewed_at),
    toTimestamp(right?.history_timestamp),
  );
  return rightTimestamp - leftTimestamp;
}

function buildCurrentAppealEntry(row) {
  const payload =
    row?.ingredient_payload && typeof row.ingredient_payload === "object"
      ? row.ingredient_payload
      : {};
  const appeal = normalizeIngredientBrandAppeal(payload.brandAppeal);
  if (!appeal) return null;

  return {
    id: appeal.id || asText(row?.id),
    appeal_id: appeal.id,
    restaurant_id: asText(row?.restaurant_id),
    dish_name: asText(row?.dish_name),
    ingredient_name: asText(payload.name || row?.row_text),
    submitted_at: asText(appeal.submittedAt),
    review_status: asText(appeal.status || "pending"),
    reviewed_at: asText(appeal.reviewedAt),
    reviewed_by: asText(appeal.reviewedBy),
    manager_message: asText(appeal.managerMessage),
    photo_url: asText(appeal.photoUrl),
    review_notes: asText(appeal.reviewNotes),
    restaurants: null,
    reviewable: true,
    history_only: false,
    history_timestamp: "",
  };
}

function collectCurrentAppeals(rows) {
  const byKey = new Map();
  const byComposite = new Map();
  const byLoose = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const entry = buildCurrentAppealEntry(row);
    if (!entry) return;

    const primaryKey = asText(entry.appeal_id || entry.id) || buildAppealCompositeKey(entry);
    const existing = primaryKey ? byKey.get(primaryKey) : null;
    const merged = existing ? mergeAppealEntries(existing, entry) : entry;

    if (primaryKey) {
      byKey.set(primaryKey, merged);
    }
    const compositeKey = buildAppealCompositeKey(merged);
    if (compositeKey) {
      byComposite.set(compositeKey, primaryKey);
    }
    const looseKey = buildAppealLooseKey(merged);
    if (looseKey) {
      byLoose.set(looseKey, primaryKey);
    }
  });

  return {
    byKey,
    byComposite,
    byLoose,
  };
}

function createHistoryAppealEntry({
  restaurantId,
  dishName,
  ingredientName,
  appealId,
  appeal,
  logTimestamp,
}) {
  const normalizedAppeal = normalizeIngredientBrandAppeal({
    ...(appeal && typeof appeal === "object" ? appeal : {}),
    id: asText(appealId || appeal?.id),
    submittedAt: asText(appeal?.submittedAt || logTimestamp),
  });
  if (!normalizedAppeal) return null;

  return {
    id: "",
    appeal_id: asText(normalizedAppeal.id),
    restaurant_id: asText(restaurantId),
    dish_name: asText(dishName),
    ingredient_name: asText(ingredientName),
    submitted_at: asText(normalizedAppeal.submittedAt || logTimestamp),
    review_status: asText(normalizedAppeal.status || "pending"),
    reviewed_at: asText(normalizedAppeal.reviewedAt),
    reviewed_by: asText(normalizedAppeal.reviewedBy),
    manager_message: asText(normalizedAppeal.managerMessage),
    photo_url: asText(normalizedAppeal.photoUrl),
    review_notes: asText(normalizedAppeal.reviewNotes),
    restaurants: null,
    reviewable: false,
    history_only: true,
    history_timestamp: asText(logTimestamp),
  };
}

function extractHistoryAppealEntry({
  restaurantId,
  dishName,
  ingredientName,
  appealId,
  beforeValue,
  afterValue,
  logTimestamp,
}) {
  const beforeAppeal = parseIngredientBrandAppealSnapshot(beforeValue);
  const afterAppeal = parseIngredientBrandAppealSnapshot(afterValue);
  if (!afterAppeal) {
    return null;
  }

  return createHistoryAppealEntry({
    restaurantId,
    dishName,
    ingredientName,
    appealId,
    appeal: {
      ...afterAppeal,
      submittedAt: asText(afterAppeal?.submittedAt || beforeAppeal?.submittedAt || logTimestamp),
    },
    logTimestamp,
  });
}

function extractHistoryAppealsFromReviewRows(payload, restaurantId, logTimestamp) {
  return (Array.isArray(payload?.reviewRows) ? payload.reviewRows : [])
    .filter((row) => asText(row?.fieldKey) === "brandAppeal")
    .map((row) =>
      extractHistoryAppealEntry({
        restaurantId,
        dishName: asText(row?.dishName),
        ingredientName: asText(row?.ingredientName || parseIngredientNameFromSummary(row?.summary)),
        appealId: row?.appealId,
        beforeValue: row?.beforeValue,
        afterValue: row?.afterValue,
        logTimestamp,
      }),
    )
    .filter(Boolean);
}

function extractHistoryAppealsFromItems(payload, restaurantId, logTimestamp) {
  const items = payload?.items && typeof payload.items === "object" ? payload.items : {};
  const output = [];

  Object.entries(items).forEach(([dishName, changes]) => {
    const safeDishName = asText(dishName);
    (Array.isArray(changes) ? changes : [changes]).forEach((change) => {
      if (!change || typeof change !== "object") return;
      const summary = asText(change?.summary || change?.message || change?.text);
      if (!/brand assignment appeal/i.test(summary)) return;

      const ingredientName = parseIngredientNameFromSummary(summary);
      const entry = extractHistoryAppealEntry({
        restaurantId,
        dishName: safeDishName,
        ingredientName,
        appealId: change?.appealId,
        beforeValue: change?.before,
        afterValue: change?.after,
        logTimestamp,
      });
      if (entry) {
        output.push(entry);
      }
    });
  });

  return output;
}

function mergeHistoryAppealsIntoCurrent(currentState, historyEntries) {
  const historyByComposite = new Map();

  (Array.isArray(historyEntries) ? historyEntries : []).forEach((entry) => {
    const compositeKey = buildAppealCompositeKey(entry);
    const looseKey = buildAppealLooseKey(entry);
    const currentPrimaryKey =
      (compositeKey && currentState.byComposite.get(compositeKey)) ||
      (looseKey && currentState.byLoose.get(looseKey)) ||
      "";

    if (currentPrimaryKey && currentState.byKey.has(currentPrimaryKey)) {
      const merged = mergeAppealEntries(currentState.byKey.get(currentPrimaryKey), entry);
      currentState.byKey.set(currentPrimaryKey, merged);
      return;
    }

    if (!compositeKey) return;
    const existing = historyByComposite.get(compositeKey);
    historyByComposite.set(
      compositeKey,
      existing ? mergeAppealEntries(existing, entry) : entry,
    );
  });

  return historyByComposite;
}

export async function listIngredientAppealsForAdmin(dbClient, options = {}) {
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Math.min(Math.floor(Number(options.limit)), 500))
    : 200;
  const logLimit = Number.isFinite(Number(options.logLimit))
    ? Math.max(50, Math.min(Math.floor(Number(options.logLimit)), 2000))
    : 1000;

  const rowResults = await dbClient.$queryRawUnsafe(
    `
      SELECT id, restaurant_id, dish_name, row_index, row_text, ingredient_payload, updated_at
      FROM public.restaurant_menu_ingredient_rows
      WHERE ingredient_payload -> 'brandAppeal' IS NOT NULL
      ORDER BY updated_at DESC, row_index ASC
    `,
  );

  const currentState = collectCurrentAppeals(Array.isArray(rowResults) ? rowResults : []);

  const changeLogs = await dbClient.change_logs.findMany({
    select: {
      id: true,
      restaurant_id: true,
      changes: true,
      timestamp: true,
    },
    orderBy: [
      { timestamp: "desc" },
      { id: "desc" },
    ],
    take: logLimit,
  });

  const historyEntries = [];
  (Array.isArray(changeLogs) ? changeLogs : []).forEach((log) => {
    const payload = parseJsonValue(log?.changes);
    if (!payload || typeof payload !== "object") return;
    const restaurantId = asText(log?.restaurant_id);
    const logTimestamp = asText(log?.timestamp);
    historyEntries.push(
      ...extractHistoryAppealsFromReviewRows(payload, restaurantId, logTimestamp),
      ...extractHistoryAppealsFromItems(payload, restaurantId, logTimestamp),
    );
  });

  const historyByComposite = mergeHistoryAppealsIntoCurrent(currentState, historyEntries);

  const combined = [
    ...Array.from(currentState.byKey.values()),
    ...Array.from(historyByComposite.values()),
  ]
    .sort(sortAppealsNewestFirst)
    .slice(0, limit);

  const restaurantIds = Array.from(
    new Set(combined.map((entry) => asText(entry.restaurant_id)).filter(Boolean)),
  );
  const restaurantLookup = new Map();
  if (restaurantIds.length) {
    const restaurants = await dbClient.restaurants.findMany({
      where: { id: { in: restaurantIds } },
      select: { id: true, name: true, slug: true },
    });
    (Array.isArray(restaurants) ? restaurants : []).forEach((restaurant) => {
      restaurantLookup.set(asText(restaurant.id), restaurant);
    });
  }

  return combined.map((entry, index) => ({
    ...entry,
    id: asText(entry.id || entry.appeal_id) || `history-appeal-${index}`,
    restaurants: restaurantLookup.get(asText(entry.restaurant_id)) || null,
  }));
}

export async function loadIngredientAppealRowsById(dbClient, appealId) {
  const safeAppealId = asText(appealId);
  if (!safeAppealId) return [];

  return await dbClient.$queryRawUnsafe(
    `
      SELECT id, restaurant_id, dish_name, row_index, row_text, ingredient_payload
      FROM public.restaurant_menu_ingredient_rows
      WHERE ingredient_payload -> 'brandAppeal' ->> 'id' = $1
      ORDER BY row_index ASC
    `,
    safeAppealId,
  );
}
