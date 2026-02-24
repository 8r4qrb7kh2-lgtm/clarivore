import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  asText,
  getStateHashForSave,
  normalizeIngredientRow,
  normalizeStringList,
  normalizeToken,
  prisma,
  readOverlayDishName,
  readOverlayIngredients,
  toDishKey,
  toJsonSafe,
} from "../../editor-pending-save/_shared/pendingSaveUtils.js";
import { fetchRestaurantMenuStateFromTablesWithPrisma } from "../../../lib/server/restaurantMenuStateServer.js";

export { asText, prisma };

export const RESTAURANT_WRITE_BATCH_TABLE = "public.restaurant_write_batches";
export const RESTAURANT_WRITE_OP_TABLE = "public.restaurant_write_ops";

export const WRITE_SCOPE_TYPES = {
  RESTAURANT: "RESTAURANT",
  ADMIN_GLOBAL: "ADMIN_GLOBAL",
};

export const RESTAURANT_WRITE_OPERATION_TYPES = {
  MENU_STATE_REPLACE: "MENU_STATE_REPLACE",
  RESTAURANT_SETTINGS_UPDATE: "RESTAURANT_SETTINGS_UPDATE",
  CONFIRM_INFO: "CONFIRM_INFO",
  BRAND_REPLACEMENT: "BRAND_REPLACEMENT",
  RESTAURANT_CREATE: "RESTAURANT_CREATE",
  RESTAURANT_DELETE: "RESTAURANT_DELETE",
  MONITORING_STATS_UPDATE: "MONITORING_STATS_UPDATE",
};

const RESTAURANT_SCOPED_OPS = new Set([
  RESTAURANT_WRITE_OPERATION_TYPES.MENU_STATE_REPLACE,
  RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_SETTINGS_UPDATE,
  RESTAURANT_WRITE_OPERATION_TYPES.CONFIRM_INFO,
  RESTAURANT_WRITE_OPERATION_TYPES.BRAND_REPLACEMENT,
  RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_DELETE,
]);

const ADMIN_ONLY_OPS = new Set([
  RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_CREATE,
  RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_DELETE,
]);

const SYSTEM_ONLY_OPS = new Set([
  RESTAURANT_WRITE_OPERATION_TYPES.MONITORING_STATS_UPDATE,
]);

const ALL_OPERATION_TYPES = new Set(Object.values(RESTAURANT_WRITE_OPERATION_TYPES));
const WRITE_MAINTENANCE_MODE_ENV = "CLARIVORE_WRITE_MAINTENANCE_MODE";
const WRITE_MAINTENANCE_MESSAGE =
  "Restaurant write maintenance mode is enabled. Please retry after maintenance.";
const INGREDIENT_PROVENANCE_SOURCES = {
  SMART_DETECTED: "smart_detected",
  MANUAL_OVERRIDE: "manual_override",
};
const INGREDIENT_PROVENANCE_LABELS = {
  [INGREDIENT_PROVENANCE_SOURCES.SMART_DETECTED]: "smart-detected",
  [INGREDIENT_PROVENANCE_SOURCES.MANUAL_OVERRIDE]: "manual override",
};

function parseBearerToken(request) {
  const authHeader = request.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
}

function toBooleanFlag(value) {
  const normalized = asText(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isWriteMaintenanceModeEnabled() {
  return toBooleanFlag(process.env[WRITE_MAINTENANCE_MODE_ENV]);
}

export function getWriteMaintenanceMessage() {
  return WRITE_MAINTENANCE_MESSAGE;
}

function parseJsonValue(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function toSafeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.floor(numeric);
}

function toSafeNonNegativeInteger(value, fallback = 0) {
  const numeric = toSafeInteger(value, fallback);
  if (!Number.isFinite(Number(numeric))) return fallback;
  return Math.max(Number(numeric), 0);
}

function toSafeVersion(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(Math.floor(numeric), 0);
}

function slugifyName(value) {
  return asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeScopeType(value) {
  const token = asText(value).toUpperCase();
  if (token === WRITE_SCOPE_TYPES.RESTAURANT) return WRITE_SCOPE_TYPES.RESTAURANT;
  if (token === WRITE_SCOPE_TYPES.ADMIN_GLOBAL) return WRITE_SCOPE_TYPES.ADMIN_GLOBAL;
  return "";
}

function normalizeOperationType(value) {
  const token = asText(value).toUpperCase();
  if (!token || !ALL_OPERATION_TYPES.has(token)) return "";
  return token;
}

function resolveScopeKey(scopeType, restaurantId) {
  if (scopeType === WRITE_SCOPE_TYPES.RESTAURANT) {
    return asText(restaurantId);
  }
  if (scopeType === WRITE_SCOPE_TYPES.ADMIN_GLOBAL) {
    return "admin-global";
  }
  return "";
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function includesToken(values, targetToken) {
  const normalizedTarget = normalizeToken(targetToken);
  if (!normalizedTarget) return false;
  return (Array.isArray(values) ? values : []).some(
    (value) => normalizeToken(value) === normalizedTarget,
  );
}

function readTokenState({
  containsValues,
  crossValues,
  token,
}) {
  if (includesToken(containsValues, token)) return "contains";
  if (includesToken(crossValues, token)) return "cross";
  return "none";
}

function resolveIngredientProvenanceSource({ selectedState, smartState }) {
  return selectedState === smartState
    ? INGREDIENT_PROVENANCE_SOURCES.SMART_DETECTED
    : INGREDIENT_PROVENANCE_SOURCES.MANUAL_OVERRIDE;
}

function readIngredientProvenanceLabel(source) {
  return INGREDIENT_PROVENANCE_LABELS[source] || INGREDIENT_PROVENANCE_LABELS[INGREDIENT_PROVENANCE_SOURCES.MANUAL_OVERRIDE];
}

const MENU_STATE_CHANGED_FIELD_KEYS = {
  OVERLAYS: "overlays",
  MENU_IMAGES: "menuImages",
};

const MENU_STATE_ALLOWED_CHANGED_FIELDS = new Set(
  Object.values(MENU_STATE_CHANGED_FIELD_KEYS),
);

function hasOwnPropertyValue(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeMenuStateChangedFields(changedFields) {
  const output = [];
  const seen = new Set();
  (Array.isArray(changedFields) ? changedFields : []).forEach((value) => {
    const token = asText(value);
    if (!MENU_STATE_ALLOWED_CHANGED_FIELDS.has(token) || seen.has(token)) return;
    seen.add(token);
    output.push(token);
  });
  return output;
}

function normalizeMenuImageValues(operationPayload) {
  const menuImages = (Array.isArray(operationPayload?.menuImages)
    ? operationPayload.menuImages
    : []
  )
    .map((value) => asText(value))
    .filter(Boolean);
  const menuImage = asText(operationPayload?.menuImage) || menuImages[0] || "";
  const menuImagesProvided =
    operationPayload?.menuImagesProvided === true ||
    menuImages.length > 0 ||
    asText(operationPayload?.menuImage).length > 0;
  if (menuImagesProvided && !menuImages.length && menuImage) {
    menuImages.push(menuImage);
  }

  return {
    menuImage,
    menuImages,
    menuImagesProvided,
  };
}

function toOverlayDishKey(overlay) {
  const overlayKey = asText(overlay?.overlayKey || overlay?._editorKey);
  if (overlayKey) {
    return toDishKey(overlayKey);
  }
  const name = readOverlayDishName(overlay);
  return toDishKey(name);
}

function sanitizePersistedImageValue(value) {
  const text = asText(value);
  if (!text) return "";
  return text;
}

function normalizeBrandEntryForStorage(brand) {
  const safe = brand && typeof brand === "object" ? toJsonSafe(brand, {}) : {};
  const name = asText(safe?.name || safe?.productName);
  if (!name) return null;
  const normalized = {
    ...safe,
    name,
    allergens: normalizeStringList(safe?.allergens),
    diets: normalizeStringList(safe?.diets),
    crossContaminationAllergens: normalizeStringList(safe?.crossContaminationAllergens),
    crossContaminationDiets: normalizeStringList(safe?.crossContaminationDiets),
    ingredientsList: (Array.isArray(safe?.ingredientsList) ? safe.ingredientsList : [])
      .map((value) => asText(value))
      .filter(Boolean),
  };

  const brandImage = sanitizePersistedImageValue(safe?.brandImage);
  if (brandImage) normalized.brandImage = brandImage;
  else delete normalized.brandImage;

  const ingredientsImage = sanitizePersistedImageValue(safe?.ingredientsImage);
  if (ingredientsImage) normalized.ingredientsImage = ingredientsImage;
  else delete normalized.ingredientsImage;

  const image = sanitizePersistedImageValue(safe?.image);
  if (image) normalized.image = image;
  else delete normalized.image;

  return normalized;
}

function readFirstBrandEntryForStorage(values) {
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeBrandEntryForStorage(value);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeIngredientForStorage(row, index) {
  const safe = row && typeof row === "object" ? toJsonSafe(row, {}) : {};
  const normalized = normalizeIngredientRow(safe, index);
  const firstBrand = readFirstBrandEntryForStorage(
    normalized?.brands || safe?.brands,
  );

  const next = {
    ...safe,
    rowIndex: normalized.rowIndex,
    name: normalized.name,
    allergens: normalized.allergens,
    crossContaminationAllergens: normalized.crossContaminationAllergens,
    diets: normalized.diets,
    crossContaminationDiets: normalized.crossContaminationDiets,
    aiDetectedAllergens: normalized.aiDetectedAllergens,
    aiDetectedCrossContaminationAllergens: normalized.aiDetectedCrossContaminationAllergens,
    aiDetectedDiets: normalized.aiDetectedDiets,
    aiDetectedCrossContaminationDiets: normalized.aiDetectedCrossContaminationDiets,
    removable: Boolean(normalized.removable),
    brands: firstBrand ? [firstBrand] : [],
  };

  const brandImage = sanitizePersistedImageValue(safe?.brandImage);
  if (brandImage) next.brandImage = brandImage;
  else delete next.brandImage;

  const ingredientsImage = sanitizePersistedImageValue(safe?.ingredientsImage);
  if (ingredientsImage) next.ingredientsImage = ingredientsImage;
  else delete next.ingredientsImage;

  const image = sanitizePersistedImageValue(safe?.image);
  if (image) next.image = image;
  else delete next.image;

  return next;
}

function normalizeOverlayForStorage(overlay) {
  const safe = toJsonSafe(overlay, {});
  const name = readOverlayDishName(safe) || "Dish";
  const pageIndex = Number.isFinite(Number(safe?.pageIndex))
    ? Math.max(Math.floor(Number(safe.pageIndex)), 0)
    : 0;

  return {
    ...safe,
    id: name,
    name,
    pageIndex,
    ingredients: readOverlayIngredients(safe).map((row, index) =>
      normalizeIngredientForStorage(row, index),
    ),
  };
}

function normalizeOverlayListForStorage(overlays) {
  const output = [];
  const seen = new Set();

  (Array.isArray(overlays) ? overlays : []).forEach((overlay) => {
    const normalized = normalizeOverlayForStorage(overlay);
    const key = toOverlayDishKey(normalized);
    if (!key || seen.has(key)) return;
    seen.add(key);
    output.push(normalized);
  });

  return output;
}

function buildOverlayOrderAndMap(overlays) {
  const byKey = new Map();
  const order = [];
  const seen = new Set();

  normalizeOverlayListForStorage(overlays).forEach((overlay) => {
    const key = toOverlayDishKey(overlay);
    if (!key) return;
    if (!seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
    byKey.set(key, overlay);
  });

  return { byKey, order };
}

function normalizeOverlayKeyList(values) {
  const seen = new Set();
  const output = [];

  (Array.isArray(values) ? values : []).forEach((value) => {
    const key = toDishKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    output.push(key);
  });

  return output;
}

function applyOverlayDelta({
  baseOverlays,
  overlayUpserts,
  overlayDeletes,
  overlayOrder,
  overlayOrderProvided,
}) {
  const baseIndex = buildOverlayOrderAndMap(baseOverlays);
  const nextByKey = new Map(baseIndex.byKey);
  const deleteKeys = new Set(normalizeOverlayKeyList(overlayDeletes));
  const upsertKeysInOrder = [];

  deleteKeys.forEach((key) => {
    nextByKey.delete(key);
  });

  normalizeOverlayListForStorage(overlayUpserts).forEach((overlay) => {
    const key = toOverlayDishKey(overlay);
    if (!key) return;
    nextByKey.set(key, overlay);
    if (!upsertKeysInOrder.includes(key)) {
      upsertKeysInOrder.push(key);
    }
  });

  const finalOrder = [];
  const seen = new Set();
  const preferredOrder = overlayOrderProvided ? normalizeOverlayKeyList(overlayOrder) : [];

  if (overlayOrderProvided) {
    preferredOrder.forEach((key) => {
      if (!nextByKey.has(key) || seen.has(key)) return;
      seen.add(key);
      finalOrder.push(key);
    });
  }

  [...baseIndex.order, ...upsertKeysInOrder, ...Array.from(nextByKey.keys())].forEach((key) => {
    if (!nextByKey.has(key) || seen.has(key)) return;
    seen.add(key);
    finalOrder.push(key);
  });

  return finalOrder.map((key) => nextByKey.get(key)).filter(Boolean);
}

function buildDishRowMap(overlays) {
  const dishMap = new Map();
  (Array.isArray(overlays) ? overlays : []).forEach((overlay) => {
    const dishName = readOverlayDishName(overlay);
    if (!dishName) return;

    const dishKey = toOverlayDishKey(overlay);
    if (!dishKey) return;
    const normalizedRows = readOverlayIngredients(overlay).map((row, index) =>
      normalizeIngredientRow(row, index),
    );

    const rowMap = new Map();
    normalizedRows.forEach((row, index) => {
      const safeIndex = Number.isFinite(Number(row.rowIndex))
        ? Math.max(Math.floor(Number(row.rowIndex)), 0)
        : index;
      rowMap.set(safeIndex, { ...row, rowIndex: safeIndex });
    });

    dishMap.set(dishKey, {
      dishName,
      rowMap,
      rowCount: normalizedRows.length,
    });
  });
  return dishMap;
}

function readIngredientRowName(row, fallbackName) {
  return asText(row?.name) || asText(fallbackName) || "Ingredient";
}

function readIngredientRowAppliedBrandItem(row) {
  const direct = asText(row?.appliedBrandItem || row?.appliedBrand || row?.brandName);
  if (direct) return direct;
  for (const brand of Array.isArray(row?.brands) ? row.brands : []) {
    const brandName = asText(brand?.name || brand?.productName);
    if (brandName) return brandName;
  }
  return "";
}

function collectIngredientSelectionLines({
  containsValues,
  crossValues,
  smartContainsValues,
  smartCrossValues,
  containsLabel,
}) {
  const selectedEntries = new Map();
  normalizeStringList(containsValues).forEach((value) => {
    const token = normalizeToken(value);
    if (!token || selectedEntries.has(token)) return;
    selectedEntries.set(token, {
      label: value,
      token,
      selectedState: "contains",
    });
  });
  normalizeStringList(crossValues).forEach((value) => {
    const token = normalizeToken(value);
    if (!token || selectedEntries.has(token)) return;
    selectedEntries.set(token, {
      label: value,
      token,
      selectedState: "cross",
    });
  });

  return Array.from(selectedEntries.values())
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((entry) => {
      const smartState = readTokenState({
        containsValues: smartContainsValues,
        crossValues: smartCrossValues,
        token: entry.token,
      });
      const source = resolveIngredientProvenanceSource({
        selectedState: entry.selectedState,
        smartState,
      });
      const stateLabel =
        entry.selectedState === "contains" ? containsLabel : "cross-contamination risk";
      return `${entry.label} - ${stateLabel} (${readIngredientProvenanceLabel(source)})`;
    });
}

function formatIngredientRowReviewSnapshot({ dishName, row, fallbackName }) {
  const safeDishName = asText(dishName) || "none";
  const safeIngredientName = readIngredientRowName(row, fallbackName) || "none";
  const allergenLines = collectIngredientSelectionLines({
    containsValues: row?.allergens,
    crossValues: row?.crossContaminationAllergens,
    smartContainsValues: row?.aiDetectedAllergens,
    smartCrossValues: row?.aiDetectedCrossContaminationAllergens,
    containsLabel: "contains",
  });
  const dietLines = collectIngredientSelectionLines({
    containsValues: row?.diets,
    crossValues: row?.crossContaminationDiets,
    smartContainsValues: row?.aiDetectedDiets,
    smartCrossValues: row?.aiDetectedCrossContaminationDiets,
    containsLabel: "compatible",
  });
  const appliedBrandItem = readIngredientRowAppliedBrandItem(row) || "none";

  const lines = [
    `Dish name: ${safeDishName}`,
    `Ingredient row name: ${safeIngredientName}`,
  ];

  if (allergenLines.length) {
    lines.push("Allergens:");
    allergenLines.forEach((line) => lines.push(`- ${line}`));
  } else {
    lines.push("Allergens: none");
  }

  if (dietLines.length) {
    lines.push("Diets:");
    dietLines.forEach((line) => lines.push(`- ${line}`));
  } else {
    lines.push("Diets: none");
  }

  lines.push(`Removability: ${Boolean(row?.removable) ? "removable" : "non-removable"}`);
  lines.push(`Applied brand item: ${appliedBrandItem}`);

  return lines.join("\n");
}

function buildIngredientRowSummary({ dishName, ingredientName, changeKind }) {
  const safeDishName = asText(dishName) || "Dish";
  const safeIngredientName = asText(ingredientName) || "Ingredient";
  if (changeKind === "added") {
    return `${safeDishName}: Ingredient row added: ${safeIngredientName}`;
  }
  if (changeKind === "removed") {
    return `${safeDishName}: Ingredient row removed: ${safeIngredientName}`;
  }
  return `${safeDishName}: Changes to ${safeIngredientName}`;
}

function buildMenuChangeRows({ baselineOverlays, overlays }) {
  const baselineDishMap = buildDishRowMap(baselineOverlays);
  const currentDishMap = buildDishRowMap(overlays);
  const allDishKeys = Array.from(
    new Set([...baselineDishMap.keys(), ...currentDishMap.keys()]),
  );

  const output = [];

  allDishKeys.forEach((dishKey) => {
    const baselineDish = baselineDishMap.get(dishKey) || {
      dishName: "Dish",
      rowMap: new Map(),
      rowCount: 0,
    };
    const currentDish = currentDishMap.get(dishKey) || {
      dishName: baselineDish.dishName,
      rowMap: new Map(),
      rowCount: 0,
    };

    const dishName = asText(currentDish.dishName || baselineDish.dishName) || "Dish";
    const maxRows = Math.max(baselineDish.rowCount, currentDish.rowCount);

    for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
      const beforeRow = baselineDish.rowMap.get(rowIndex) || null;
      const afterRow = currentDish.rowMap.get(rowIndex) || null;
      const fallbackIngredientName = `Ingredient ${rowIndex + 1}`;

      if (!beforeRow && !afterRow) continue;

      if (!beforeRow && afterRow) {
        const ingredientName = readIngredientRowName(afterRow, fallbackIngredientName);
        output.push({
          dishName,
          rowIndex,
          ingredientName,
          changeType: "ingredient_row_added",
          fieldKey: "ingredient_row",
          beforeValue: null,
          afterValue: formatIngredientRowReviewSnapshot({
            dishName,
            row: afterRow,
            fallbackName: fallbackIngredientName,
          }),
          summary: buildIngredientRowSummary({
            dishName,
            ingredientName,
            changeKind: "added",
          }),
        });
        continue;
      }

      if (beforeRow && !afterRow) {
        const ingredientName = readIngredientRowName(beforeRow, fallbackIngredientName);
        output.push({
          dishName,
          rowIndex,
          ingredientName,
          changeType: "ingredient_row_removed",
          fieldKey: "ingredient_row",
          beforeValue: formatIngredientRowReviewSnapshot({
            dishName,
            row: beforeRow,
            fallbackName: fallbackIngredientName,
          }),
          afterValue: null,
          summary: buildIngredientRowSummary({
            dishName,
            ingredientName,
            changeKind: "removed",
          }),
        });
        continue;
      }

      const beforeValue = formatIngredientRowReviewSnapshot({
        dishName,
        row: beforeRow,
        fallbackName: fallbackIngredientName,
      });
      const afterValue = formatIngredientRowReviewSnapshot({
        dishName,
        row: afterRow,
        fallbackName: fallbackIngredientName,
      });
      if (valuesEqual(beforeValue, afterValue)) continue;

      const ingredientName = readIngredientRowName(
        afterRow,
        readIngredientRowName(beforeRow, fallbackIngredientName),
      );
      output.push({
        dishName,
        rowIndex,
        ingredientName,
        changeType: "ingredient_row_changed",
        fieldKey: "ingredient_row",
        beforeValue,
        afterValue,
        summary: buildIngredientRowSummary({
          dishName,
          ingredientName,
          changeKind: "changed",
        }),
      });
    }
  });

  return output;
}

function summarizeChangeLine(value) {
  if (typeof value === "string") return asText(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => summarizeChangeLine(entry)).filter(Boolean).join(", ");
  }
  if (!value || typeof value !== "object") return "";

  const message = asText(
    value?.message ||
      value?.summary ||
      value?.text ||
      value?.description ||
      value?.title,
  );
  if (message) return message;

  const detailParts = [
    asText(value?.ingredient || value?.ingredientName || value?.name),
    asText(value?.action || value?.type || value?.operation),
    asText(value?.category || value?.classification || value?.mode),
  ].filter(Boolean);
  if (detailParts.length) {
    return detailParts.join(" · ");
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function shouldSkipDishSummaryLine(rawSummary) {
  const summary = asText(rawSummary);
  if (!summary) return true;

  const normalized = summary.toLowerCase();
  if (normalized.startsWith("ingredient row added:")) return true;
  if (normalized.startsWith("ingredient row removed:")) return true;
  if (normalized.startsWith("changes to ")) return true;

  // Dish item summaries with a secondary colon are ingredient-scoped legacy lines,
  // e.g. "apple: Applied AI ingredient analysis".
  const firstColon = summary.indexOf(":");
  if (firstColon > 0 && firstColon < summary.length - 1) {
    return true;
  }

  return false;
}

function readSummaryRowBeforeValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = ["before", "previous", "prev", "from"];
  for (const key of keys) {
    if (hasOwnPropertyValue(value, key)) {
      return value[key];
    }
  }
  return null;
}

function readSummaryRowAfterValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = ["after", "next", "current", "to"];
  for (const key of keys) {
    if (hasOwnPropertyValue(value, key)) {
      return value[key];
    }
  }
  return null;
}

function appendSummaryRowsFromChangePayload(output, changePayload) {
  const payload = changePayload && typeof changePayload === "object" ? changePayload : {};
  const general = Array.isArray(payload?.general)
    ? payload.general
    : payload?.general != null
      ? [payload.general]
      : [];
  general.forEach((line, index) => {
    const summary = summarizeChangeLine(line);
    if (!summary) return;
    output.push({
      id: `summary:general:${index}`,
      changeType: "change_summary",
      fieldKey: "summary",
      beforeValue: readSummaryRowBeforeValue(line),
      afterValue: readSummaryRowAfterValue(line),
      summary,
    });
  });

  const items = payload?.items && typeof payload.items === "object" ? payload.items : {};
  Object.entries(items).forEach(([dishName, changes]) => {
    const safeDishName = asText(dishName) || "Dish";
    const lines = Array.isArray(changes) ? changes : [changes];
    lines.forEach((line, index) => {
      const rawSummary = summarizeChangeLine(line);
      if (!rawSummary) return;
      if (shouldSkipDishSummaryLine(rawSummary)) return;
      const prefixedSummary =
        safeDishName &&
        !normalizeToken(rawSummary).startsWith(normalizeToken(safeDishName))
          ? `${safeDishName}: ${rawSummary}`
          : rawSummary;
      output.push({
        id: `summary:item:${normalizeToken(safeDishName) || "dish"}:${index}`,
        dishName: safeDishName,
        changeType: "change_summary",
        fieldKey: "summary",
        beforeValue: readSummaryRowBeforeValue(line),
        afterValue: readSummaryRowAfterValue(line),
        summary: prefixedSummary,
      });
    });
  });
}

function buildMenuChangedFieldFallbackRows(changedFields) {
  const changed = new Set(normalizeMenuStateChangedFields(changedFields));
  const rows = [];
  if (changed.has(MENU_STATE_CHANGED_FIELD_KEYS.MENU_IMAGES)) {
    rows.push({
      id: "fallback:menu-images",
      changeType: "menuImagesChanged",
      fieldKey: "menuImages",
      summary: "Menu images updated",
      beforeValue: null,
      afterValue: null,
    });
  }
  return rows;
}

function normalizeMenuImagePageList(values, pageCount = Number.POSITIVE_INFINITY) {
  const safePageCount = Number.isFinite(Number(pageCount)) ? Math.max(Math.floor(Number(pageCount)), 0) : Number.POSITIVE_INFINITY;
  const output = [];
  const seen = new Set();

  (Array.isArray(values) ? values : []).forEach((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const safeIndex = Math.max(0, Math.floor(numeric));
    if (safePageCount !== Number.POSITIVE_INFINITY && safeIndex >= safePageCount) return;
    if (seen.has(safeIndex)) return;
    seen.add(safeIndex);
    output.push(safeIndex);
  });

  return output;
}

function readMenuImageSummaryMetadata({ summary, dishName, pageCount }) {
  const safeSummary = asText(summary);
  const safeDishName = asText(dishName);
  const safePageCount = Math.max(Number(pageCount) || 0, 0);
  if (!safeSummary || !safePageCount) return null;

  const summaryWithDishPrefix =
    safeDishName && !safeSummary.toLowerCase().startsWith(`${safeDishName.toLowerCase()}:`)
      ? `${safeDishName}: ${safeSummary}`
      : safeSummary;

  const readTrailingPageRefs = (count) => {
    const safeCount = Math.max(Number(count) || 0, 0);
    if (!safeCount) return [];
    const startIndex = Math.max(safePageCount - safeCount, 0);
    return normalizeMenuImagePageList(
      Array.from({ length: safePageCount - startIndex }, (_, offset) => startIndex + offset),
      safePageCount,
    );
  };

  const replacementMatch = summaryWithDishPrefix.match(
    /menu images:\s*uploaded replacement image for page\s+(\d+)/i,
  );
  const replacementFromPageMatch = summaryWithDishPrefix.match(
    /menu pages:\s*replaced page\s+(\d+)\s+with\s+\d+\s+section(?:s)?/i,
  );
  if (replacementMatch || replacementFromPageMatch) {
    const matchedPage = replacementMatch?.[1] || replacementFromPageMatch?.[1];
    const pageNumber = Math.max(Number(matchedPage) || 0, 1);
    const refs = normalizeMenuImagePageList([pageNumber - 1], safePageCount);
    if (!refs.length) return null;
    return {
      menuImagePages: refs,
      summary: `Uploaded replacement image for page ${pageNumber}`,
      dishName: "Menu images",
    };
  }

  const newImagesMatch = summaryWithDishPrefix.match(
    /menu images:\s*uploaded\s+(\d+)\s+new image(?:s)?/i,
  );
  const addedPagesMatch = summaryWithDishPrefix.match(
    /menu pages:\s*added\s+(\d+)\s+page(?:s)?/i,
  );
  if (newImagesMatch || addedPagesMatch) {
    const matchedCount = newImagesMatch?.[1] || addedPagesMatch?.[1];
    const count = Math.max(Number(matchedCount) || 0, 0);
    const refs = readTrailingPageRefs(count);
    if (!refs.length) return null;
    return {
      menuImagePages: refs,
      summary: `Uploaded ${count} new image${count === 1 ? "" : "s"}`,
      dishName: "Menu images",
    };
  }

  return null;
}

function attachMenuImagePageRefsToSummaryRows(summaryRows, menuImages, changedFields) {
  const safeRows = Array.isArray(summaryRows) ? summaryRows : [];
  const safePageCount = (Array.isArray(menuImages) ? menuImages : [])
    .map((value) => asText(value))
    .filter(Boolean).length;
  if (!safeRows.length || !safePageCount) return safeRows;

  let attachedAny = false;
  const withDetectedRefs = safeRows.map((row) => {
    const metadata = readMenuImageSummaryMetadata({
      summary: row?.summary,
      dishName: row?.dishName,
      pageCount: safePageCount,
    });
    if (!metadata?.menuImagePages?.length) return row;
    attachedAny = true;
    return {
      ...row,
      dishName: asText(metadata?.dishName) || asText(row?.dishName),
      summary: asText(metadata?.summary) || asText(row?.summary),
      changeType: asText(row?.changeType) || "menuImagesChanged",
      fieldKey: asText(row?.fieldKey) || "menuImages",
      menuImagePages: metadata.menuImagePages,
    };
  });

  if (attachedAny) return withDetectedRefs;

  const changedFieldSet = new Set(normalizeMenuStateChangedFields(changedFields));
  if (!changedFieldSet.has(MENU_STATE_CHANGED_FIELD_KEYS.MENU_IMAGES)) {
    return withDetectedRefs;
  }

  // Fallback for generic "Menu images updated" rows when upload-specific text is unavailable.
  const fallbackIndex = safePageCount - 1;
  return withDetectedRefs.map((row) => {
    if (normalizeToken(row?.summary) !== normalizeToken("Menu images updated")) {
      return row;
    }
    return {
      ...row,
      dishName: "Menu images",
      summary: "Menu images updated",
      changeType: asText(row?.changeType) || "menuImagesChanged",
      fieldKey: asText(row?.fieldKey) || "menuImages",
      menuImagePages: [fallbackIndex],
    };
  });
}

function toReviewRowDedupeKey(row) {
  const explicit = asText(row?.key);
  if (explicit) {
    return `key:${normalizeToken(explicit) || explicit.toLowerCase()}`;
  }
  const summary = asText(row?.summary);
  const summaryToken = normalizeToken(summary);
  if (summaryToken) {
    return `summary:${summaryToken}`;
  }
  const fallbackTokens = [
    normalizeToken(row?.dishName),
    normalizeToken(row?.ingredientName),
    normalizeToken(row?.fieldKey),
    normalizeToken(row?.changeType),
  ].filter(Boolean);
  return fallbackTokens.length ? `fields:${fallbackTokens.join(":")}` : "";
}

function finalizeMenuReviewRows(rows) {
  const output = [];
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const summary = asText(row?.summary);
    if (!summary && row?.beforeValue == null && row?.afterValue == null) return;
    const dedupeKey = toReviewRowDedupeKey(row);
    if (dedupeKey && seen.has(dedupeKey)) return;
    if (dedupeKey) {
      seen.add(dedupeKey);
    }

    const menuImagePages = normalizeMenuImagePageList(
      Array.isArray(row?.menuImagePages)
        ? row.menuImagePages
        : row?.menuImagePage != null
          ? [row.menuImagePage]
          : [],
    );

    output.push({
      id: asText(row?.id) || `row:${output.length}`,
      sortOrder: output.length,
      dishName: asText(row?.dishName),
      rowIndex:
        Number.isFinite(Number(row?.rowIndex)) && Number(row?.rowIndex) >= 0
          ? Math.floor(Number(row.rowIndex))
          : null,
      ingredientName: asText(row?.ingredientName),
      changeType: asText(row?.changeType),
      fieldKey: asText(row?.fieldKey),
      beforeValue: hasOwnPropertyValue(row, "beforeValue") ? row.beforeValue : null,
      afterValue: hasOwnPropertyValue(row, "afterValue") ? row.afterValue : null,
      summary: summary || "Updated",
      menuImagePages,
    });
  });
  return output;
}

function buildMenuReviewRows({
  changePayload,
  changedFields,
  ingredientRows,
  menuImages,
}) {
  const summaryRows = [];
  appendSummaryRowsFromChangePayload(summaryRows, changePayload);
  const hasIngredientRows = Array.isArray(ingredientRows) && ingredientRows.length > 0;
  if (!summaryRows.length && !hasIngredientRows) {
    summaryRows.push(...buildMenuChangedFieldFallbackRows(changedFields));
  }
  const summaryRowsWithMenuRefs = attachMenuImagePageRefsToSummaryRows(
    summaryRows,
    menuImages,
    changedFields,
  );

  const ingredientReviewRows = (Array.isArray(ingredientRows) ? ingredientRows : []).map(
    (row, index) => ({
      id: `detail:${index}`,
      dishName: row?.dishName,
      rowIndex: row?.rowIndex,
      ingredientName: row?.ingredientName,
      changeType: row?.changeType,
      fieldKey: row?.fieldKey,
      beforeValue: row?.beforeValue,
      afterValue: row?.afterValue,
      summary: asText(row?.summary),
    }),
  );

  return finalizeMenuReviewRows([...summaryRowsWithMenuRefs, ...ingredientReviewRows]);
}

function buildIngredientRowsFromOverlays(overlays) {
  const output = [];

  (Array.isArray(overlays) ? overlays : []).forEach((overlay) => {
    const dishName = readOverlayDishName(overlay);
    const dishKey = toDishKey(dishName);
    if (!dishName || !dishKey) return;

    const ingredients = readOverlayIngredients(overlay).map((row, index) =>
      normalizeIngredientForStorage(row, index),
    );

    ingredients.forEach((ingredient, index) => {
      const appliedBrandItem = readIngredientRowAppliedBrandItem(ingredient);
      const appliedBrand = resolveAppliedBrandFromIngredient(ingredient, appliedBrandItem);
      output.push({
        dishKey,
        dishName,
        rowIndex: index,
        rowText: asText(ingredient.name) || `Ingredient ${index + 1}`,
        removable: Boolean(ingredient.removable),
        allergens: Array.isArray(ingredient.allergens) ? ingredient.allergens : [],
        crossContaminationAllergens: Array.isArray(ingredient.crossContaminationAllergens)
          ? ingredient.crossContaminationAllergens
          : [],
        diets: Array.isArray(ingredient.diets) ? ingredient.diets : [],
        crossContaminationDiets: Array.isArray(ingredient.crossContaminationDiets)
          ? ingredient.crossContaminationDiets
          : [],
        aiDetectedAllergens: Array.isArray(ingredient.aiDetectedAllergens)
          ? ingredient.aiDetectedAllergens
          : [],
        aiDetectedCrossContaminationAllergens: Array.isArray(ingredient.aiDetectedCrossContaminationAllergens)
          ? ingredient.aiDetectedCrossContaminationAllergens
          : [],
        aiDetectedDiets: Array.isArray(ingredient.aiDetectedDiets)
          ? ingredient.aiDetectedDiets
          : [],
        aiDetectedCrossContaminationDiets: Array.isArray(ingredient.aiDetectedCrossContaminationDiets)
          ? ingredient.aiDetectedCrossContaminationDiets
          : [],
        appliedBrandItem,
        ingredientPayload: toJsonSafe(ingredient, {}),
        appliedBrand,
      });
    });
  });

  return output;
}

function toSafeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toSafeOverlayPageIndex(value) {
  return Math.max(Math.floor(toSafeNumber(value, 0)), 0);
}

function buildMenuPageRowsFromState(menuImages, overlays) {
  const explicitImages = (Array.isArray(menuImages) ? menuImages : [])
    .map((value) => asText(value))
    .filter(Boolean);

  const maxOverlayPageIndex = (Array.isArray(overlays) ? overlays : []).reduce((max, overlay) => {
    return Math.max(max, toSafeOverlayPageIndex(overlay?.pageIndex));
  }, 0);

  const requiredLength = Math.max(explicitImages.length, maxOverlayPageIndex + 1, 1);
  const fallbackImage = explicitImages[0] || "";
  const rows = [];

  for (let pageIndex = 0; pageIndex < requiredLength; pageIndex += 1) {
    const imageUrl = asText(explicitImages[pageIndex] || fallbackImage);
    rows.push({
      pageIndex,
      imageUrl: imageUrl || null,
    });
  }

  return rows;
}

function buildMenuDishRowsFromOverlays(overlays) {
  const rows = [];

  (Array.isArray(overlays) ? overlays : []).forEach((overlay) => {
    const dishName = readOverlayDishName(overlay);
    const dishKey = toDishKey(dishName);
    if (!dishName || !dishKey) return;

    rows.push({
      dishKey,
      dishName,
      pageIndex: toSafeOverlayPageIndex(overlay?.pageIndex),
      x: toSafeNumber(overlay?.x, 0),
      y: toSafeNumber(overlay?.y, 0),
      w: toSafeNumber(overlay?.w, 0),
      h: toSafeNumber(overlay?.h, 0),
      dishText: asText(overlay?.text) || null,
      description: asText(overlay?.description) || null,
      detailsJson: toJsonSafe(overlay?.details, {}),
      allergens: normalizeStringList(overlay?.allergens),
      diets: normalizeStringList(overlay?.diets),
      crossContaminationAllergens: normalizeStringList(overlay?.crossContaminationAllergens),
      crossContaminationDiets: normalizeStringList(overlay?.crossContaminationDiets),
      removableJson: toJsonSafe(overlay?.removable, []),
      ingredientsBlockingDietsJson: toJsonSafe(
        overlay?.ingredientsBlockingDiets || overlay?.ingredients_blocking_diets,
        {},
      ),
      payloadJson: toJsonSafe(overlay, {}),
    });
  });

  return rows;
}

function resolveAppliedBrandFromIngredient(ingredient, appliedBrandItem) {
  const brands = (Array.isArray(ingredient?.brands) ? ingredient.brands : [])
    .map((brand) => normalizeBrandEntryForStorage(brand))
    .filter(Boolean);
  const appliedToken = normalizeToken(appliedBrandItem);

  let brand = null;
  if (appliedToken) {
    brand = brands.find((entry) => normalizeToken(entry?.name) === appliedToken) || null;
  }
  if (!brand) {
    brand = brands[0] || null;
  }

  const brandName = asText(brand?.name || appliedBrandItem);
  if (!brandName) return null;

  const brandImage = sanitizePersistedImageValue(
    brand?.brandImage || ingredient?.brandImage,
  );
  const ingredientsImage = sanitizePersistedImageValue(
    brand?.ingredientsImage || ingredient?.ingredientsImage,
  );
  const image = sanitizePersistedImageValue(brand?.image || ingredient?.image);

  return {
    brandName,
    barcode: asText(brand?.barcode || ingredient?.barcode) || null,
    brandImage: brandImage || null,
    ingredientsImage: ingredientsImage || null,
    image: image || null,
    ingredientList: asText(brand?.ingredientList || ingredient?.ingredientList) || null,
    ingredientsList: normalizeStringList(
      Array.isArray(brand?.ingredientsList) && brand.ingredientsList.length
        ? brand.ingredientsList
        : ingredient?.ingredientsList,
    ),
    allergens: normalizeStringList(
      Array.isArray(brand?.allergens) && brand.allergens.length
        ? brand.allergens
        : ingredient?.allergens,
    ),
    crossContaminationAllergens: normalizeStringList(
      Array.isArray(brand?.crossContaminationAllergens) && brand.crossContaminationAllergens.length
        ? brand.crossContaminationAllergens
        : ingredient?.crossContaminationAllergens,
    ),
    diets: normalizeStringList(
      Array.isArray(brand?.diets) && brand.diets.length
        ? brand.diets
        : ingredient?.diets,
    ),
    crossContaminationDiets: normalizeStringList(
      Array.isArray(brand?.crossContaminationDiets) && brand.crossContaminationDiets.length
        ? brand.crossContaminationDiets
        : ingredient?.crossContaminationDiets,
    ),
    brandPayload: toJsonSafe(brand || { name: brandName }, {}),
  };
}

function buildTokenMap(items, labelSelector) {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const label = asText(labelSelector(item));
    const token = normalizeToken(label);
    if (!token) return;
    map.set(token, item.id);
  });
  return map;
}

export async function ensureRestaurantWriteInfrastructure(client = prisma) {
  if (!client || typeof client.$executeRawUnsafe !== "function") return;

  await client.$executeRawUnsafe(`
    ALTER TABLE public.restaurants
    ADD COLUMN IF NOT EXISTS write_version bigint NOT NULL DEFAULT 0
  `);

  await client.$executeRawUnsafe(`
    ALTER TABLE public.restaurants
    ALTER COLUMN write_version SET DEFAULT 0
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${RESTAURANT_WRITE_BATCH_TABLE} (
      id uuid PRIMARY KEY,
      scope_type text NOT NULL,
      scope_key text NOT NULL,
      restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
      created_by uuid NOT NULL,
      author text,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'discarded', 'failed')),
      base_write_version bigint,
      review_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      applied_at timestamptz,
      discarded_at timestamptz
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS restaurant_write_batches_scope_idx
    ON ${RESTAURANT_WRITE_BATCH_TABLE} (scope_type, scope_key, created_by, created_at DESC)
  `);

  await client.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS restaurant_write_batches_pending_scope_idx
    ON ${RESTAURANT_WRITE_BATCH_TABLE} (scope_type, scope_key, created_by)
    WHERE status = 'pending'
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${RESTAURANT_WRITE_OP_TABLE} (
      id uuid PRIMARY KEY,
      batch_id uuid NOT NULL REFERENCES ${RESTAURANT_WRITE_BATCH_TABLE}(id) ON DELETE CASCADE,
      sort_order integer NOT NULL DEFAULT 0,
      operation_type text NOT NULL,
      operation_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      summary text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (batch_id, operation_type)
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS restaurant_write_ops_batch_idx
    ON ${RESTAURANT_WRITE_OP_TABLE} (batch_id, sort_order, created_at)
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.restaurant_menu_pages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
      page_index integer NOT NULL,
      image_url text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (restaurant_id, page_index)
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS restaurant_menu_pages_restaurant_idx
    ON public.restaurant_menu_pages (restaurant_id)
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.restaurant_menu_dishes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
      dish_key text NOT NULL,
      dish_name text NOT NULL,
      page_index integer NOT NULL DEFAULT 0,
      x double precision NOT NULL DEFAULT 0,
      y double precision NOT NULL DEFAULT 0,
      w double precision NOT NULL DEFAULT 0,
      h double precision NOT NULL DEFAULT 0,
      dish_text text,
      description text,
      details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      allergens text[] NOT NULL DEFAULT '{}'::text[],
      diets text[] NOT NULL DEFAULT '{}'::text[],
      cross_contamination_allergens text[] NOT NULL DEFAULT '{}'::text[],
      cross_contamination_diets text[] NOT NULL DEFAULT '{}'::text[],
      removable_json jsonb NOT NULL DEFAULT '[]'::jsonb,
      ingredients_blocking_diets_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (restaurant_id, dish_key)
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS restaurant_menu_dishes_restaurant_idx
    ON public.restaurant_menu_dishes (restaurant_id)
  `);
  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS restaurant_menu_dishes_restaurant_page_idx
    ON public.restaurant_menu_dishes (restaurant_id, page_index)
  `);
  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS restaurant_menu_dishes_restaurant_name_idx
    ON public.restaurant_menu_dishes (restaurant_id, dish_name)
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.restaurant_menu_ingredient_rows (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
      dish_id uuid REFERENCES public.restaurant_menu_dishes(id) ON DELETE SET NULL,
      dish_name text NOT NULL,
      row_index integer NOT NULL,
      row_text text,
      applied_brand_item text,
      ingredient_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (restaurant_id, dish_name, row_index)
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS restaurant_menu_ingredient_rows_restaurant_idx
    ON public.restaurant_menu_ingredient_rows (restaurant_id)
  `);
  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS restaurant_menu_ingredient_rows_dish_idx
    ON public.restaurant_menu_ingredient_rows (dish_id)
  `);
  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS restaurant_menu_ingredient_rows_restaurant_dish_idx
    ON public.restaurant_menu_ingredient_rows (restaurant_id, dish_name)
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.restaurant_menu_ingredient_brand_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
      ingredient_row_id uuid NOT NULL UNIQUE REFERENCES public.restaurant_menu_ingredient_rows(id) ON DELETE CASCADE,
      dish_name text NOT NULL,
      row_index integer NOT NULL,
      brand_name text NOT NULL,
      barcode text,
      brand_image text,
      ingredients_image text,
      image text,
      ingredient_list text,
      ingredients_list text[] NOT NULL DEFAULT '{}'::text[],
      allergens text[] NOT NULL DEFAULT '{}'::text[],
      cross_contamination_allergens text[] NOT NULL DEFAULT '{}'::text[],
      diets text[] NOT NULL DEFAULT '{}'::text[],
      cross_contamination_diets text[] NOT NULL DEFAULT '{}'::text[],
      brand_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS restaurant_menu_ingredient_brand_items_restaurant_idx
    ON public.restaurant_menu_ingredient_brand_items (restaurant_id)
  `);
  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS restaurant_menu_ingredient_brand_items_restaurant_dish_idx
    ON public.restaurant_menu_ingredient_brand_items (restaurant_id, dish_name)
  `);

  await client.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'set_updated_at'
          AND n.nspname = 'public'
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'set_restaurant_write_batches_updated_at'
        ) THEN
          CREATE TRIGGER set_restaurant_write_batches_updated_at
          BEFORE UPDATE ON ${RESTAURANT_WRITE_BATCH_TABLE}
          FOR EACH ROW
          EXECUTE FUNCTION public.set_updated_at();
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'set_restaurant_write_ops_updated_at'
        ) THEN
          CREATE TRIGGER set_restaurant_write_ops_updated_at
          BEFORE UPDATE ON ${RESTAURANT_WRITE_OP_TABLE}
          FOR EACH ROW
          EXECUTE FUNCTION public.set_updated_at();
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'set_restaurant_menu_pages_updated_at'
        ) THEN
          CREATE TRIGGER set_restaurant_menu_pages_updated_at
          BEFORE UPDATE ON public.restaurant_menu_pages
          FOR EACH ROW
          EXECUTE FUNCTION public.set_updated_at();
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'set_restaurant_menu_dishes_updated_at'
        ) THEN
          CREATE TRIGGER set_restaurant_menu_dishes_updated_at
          BEFORE UPDATE ON public.restaurant_menu_dishes
          FOR EACH ROW
          EXECUTE FUNCTION public.set_updated_at();
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'set_restaurant_menu_ingredient_rows_updated_at'
        ) THEN
          CREATE TRIGGER set_restaurant_menu_ingredient_rows_updated_at
          BEFORE UPDATE ON public.restaurant_menu_ingredient_rows
          FOR EACH ROW
          EXECUTE FUNCTION public.set_updated_at();
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'set_restaurant_menu_ingredient_brand_items_updated_at'
        ) THEN
          CREATE TRIGGER set_restaurant_menu_ingredient_brand_items_updated_at
          BEFORE UPDATE ON public.restaurant_menu_ingredient_brand_items
          FOR EACH ROW
          EXECUTE FUNCTION public.set_updated_at();
        END IF;
      END IF;
    END $$;
  `);

  await client.$executeRawUnsafe(`
    ALTER TABLE ${RESTAURANT_WRITE_BATCH_TABLE}
    ENABLE ROW LEVEL SECURITY
  `);
  await client.$executeRawUnsafe(`
    ALTER TABLE ${RESTAURANT_WRITE_OP_TABLE}
    ENABLE ROW LEVEL SECURITY
  `);
}

function getSupabaseAuthClient() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authKey = serviceRoleKey || anonKey;

  if (!supabaseUrl || !authKey) {
    throw new Error("Supabase server credentials missing");
  }

  return createClient(supabaseUrl, authKey, {
    auth: { persistSession: false },
  });
}

export async function requireAuthenticatedSession(request) {
  const token = parseBearerToken(request);
  if (!token) {
    throw new Error("Missing authorization token");
  }

  const supabase = getSupabaseAuthClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    throw new Error("Invalid user session");
  }

  return {
    userId: userData.user.id,
    userEmail: asText(userData.user.email),
    user: userData.user,
  };
}

export async function isAppAdminUser(client, userId) {
  const safeUserId = asText(userId);
  if (!safeUserId) return false;

  let rows;
  try {
    rows = await client.$queryRawUnsafe(
      `
      SELECT 1
      FROM public.app_admins
      WHERE user_id = $1::uuid
      LIMIT 1
    `,
      safeUserId,
    );
  } catch (error) {
    const message = asText(error?.message).toLowerCase();
    if (message.includes("app_admins") && message.includes("does not exist")) {
      return false;
    }
    throw error;
  }

  return Boolean(rows?.[0]);
}

export async function requireAdminSession(request) {
  const session = await requireAuthenticatedSession(request);
  const isAdmin = await isAppAdminUser(prisma, session.userId);
  if (!isAdmin) {
    throw new Error("Admin access required");
  }
  return {
    ...session,
    isAdmin: true,
  };
}

export async function requireRestaurantAccessSession(request, restaurantId) {
  const safeRestaurantId = asText(restaurantId);
  if (!safeRestaurantId) {
    throw new Error("restaurantId is required");
  }

  const session = await requireAuthenticatedSession(request);
  const isAdmin = await isAppAdminUser(prisma, session.userId);
  if (isAdmin) {
    return {
      ...session,
      isAdmin: true,
    };
  }

  const manager = await prisma.restaurant_managers.findFirst({
    where: {
      user_id: session.userId,
      restaurant_id: safeRestaurantId,
    },
  });

  if (!manager) {
    throw new Error("Not authorized");
  }

  return {
    ...session,
    isAdmin: false,
  };
}

export async function getRestaurantWriteVersion(
  client,
  restaurantId,
  { lock = false } = {},
) {
  const safeRestaurantId = asText(restaurantId);
  if (!safeRestaurantId) {
    throw new Error("restaurantId is required");
  }

  const rows = await client.$queryRawUnsafe(
    `
    SELECT id, COALESCE(write_version, 0) AS write_version
    FROM public.restaurants
    WHERE id = $1::uuid
    ${lock ? "FOR UPDATE" : ""}
    LIMIT 1
  `,
    safeRestaurantId,
  );

  const row = rows?.[0] || null;
  if (!row?.id) {
    throw new Error("Restaurant not found");
  }

  return {
    id: asText(row.id),
    writeVersion: toSafeVersion(row.write_version, 0),
  };
}

function normalizeMenuStatePayload(operationPayload) {
  const hasOverlayDeltaPayload =
    Array.isArray(operationPayload?.overlayUpserts) ||
    Array.isArray(operationPayload?.overlayDeletes) ||
    operationPayload?.overlayOrderProvided === true;
  const overlays = hasOverlayDeltaPayload
    ? []
    : normalizeOverlayListForStorage(operationPayload?.overlays);
  const baselineOverlays = hasOverlayDeltaPayload
    ? normalizeOverlayListForStorage(operationPayload?.overlayBaselines)
    : normalizeOverlayListForStorage(operationPayload?.baselineOverlays);
  const overlayUpserts = hasOverlayDeltaPayload
    ? normalizeOverlayListForStorage(operationPayload?.overlayUpserts)
    : [];
  const overlayDeletes = hasOverlayDeltaPayload
    ? normalizeOverlayKeyList(operationPayload?.overlayDeletes)
    : [];
  const overlayOrderProvided = hasOverlayDeltaPayload
    ? operationPayload?.overlayOrderProvided === true
    : false;
  const overlayOrder = hasOverlayDeltaPayload && overlayOrderProvided
    ? normalizeOverlayKeyList(operationPayload?.overlayOrder)
    : [];
  const { menuImagesProvided, menuImages, menuImage } = normalizeMenuImageValues(operationPayload);
  const changedFieldsProvided = Array.isArray(operationPayload?.changedFields);
  const changedFields = normalizeMenuStateChangedFields(operationPayload?.changedFields);

  const stateHash = asText(operationPayload?.stateHash) || (
    hasOverlayDeltaPayload
      ? ""
      : getStateHashForSave({
          overlays,
          menuImages,
        })
  );

  const changePayload = toJsonSafe(operationPayload?.changePayload, {});
  const ingredientRows = hasOverlayDeltaPayload
    ? buildMenuChangeRows({ baselineOverlays, overlays: overlayUpserts })
    : buildMenuChangeRows({ baselineOverlays, overlays });
  const rows = buildMenuReviewRows({
    changePayload,
    changedFields,
    ingredientRows,
    menuImages,
  });

  return {
    overlays: toJsonSafe(overlays, []),
    baselineOverlays: toJsonSafe(baselineOverlays, []),
    overlayUpserts: toJsonSafe(overlayUpserts, []),
    overlayDeletes: toJsonSafe(overlayDeletes, []),
    overlayOrder: toJsonSafe(overlayOrder, []),
    overlayOrderProvided,
    menuImage,
    menuImages,
    menuImagesProvided,
    changedFieldsProvided,
    changedFields: toJsonSafe(changedFields, []),
    stateHash,
    changePayload,
    rows: toJsonSafe(rows, []),
    rowCount: rows.length,
  };
}

function normalizeRestaurantSettingsPayload(operationPayload) {
  return {
    website: asText(operationPayload?.website) || null,
    phone: asText(operationPayload?.phone) || null,
    delivery_url: asText(operationPayload?.delivery_url) || null,
    menu_url: asText(operationPayload?.menu_url) || null,
    map_location: asText(operationPayload?.map_location) || null,
    changePayload: toJsonSafe(operationPayload?.changePayload, {}),
  };
}

function normalizeConfirmInfoPayload(operationPayload) {
  const confirmedAt = asText(operationPayload?.confirmedAt) || new Date().toISOString();
  return {
    confirmedAt,
    photos: (Array.isArray(operationPayload?.photos) ? operationPayload.photos : [])
      .map((value) => asText(value))
      .filter(Boolean),
    changePayload: toJsonSafe(operationPayload?.changePayload, {}),
  };
}

function normalizeBrandReplacementPayload(operationPayload) {
  const overlays = Array.isArray(operationPayload?.overlays) ? operationPayload.overlays : [];
  const { menuImagesProvided, menuImages, menuImage } = normalizeMenuImageValues(operationPayload);

  return {
    overlays: toJsonSafe(overlays, []),
    menuImage,
    menuImages,
    menuImagesProvided,
    changePayload: toJsonSafe(operationPayload?.changePayload, {}),
  };
}

function normalizeRestaurantCreatePayload(operationPayload) {
  const name = asText(operationPayload?.name);
  const slug = asText(operationPayload?.slug) || slugifyName(name);
  const menuImage = asText(operationPayload?.menuImage);
  const menuImages = (Array.isArray(operationPayload?.menuImages)
    ? operationPayload.menuImages
    : []
  )
    .map((value) => asText(value))
    .filter(Boolean);
  if (!menuImages.length && menuImage) {
    menuImages.push(menuImage);
  }

  return {
    name,
    slug,
    menuImage,
    menuImages,
    overlays: toJsonSafe(
      Array.isArray(operationPayload?.overlays) ? operationPayload.overlays : [],
      [],
    ),
    website: asText(operationPayload?.website) || null,
    phone: asText(operationPayload?.phone) || null,
    delivery_url: asText(operationPayload?.delivery_url) || null,
    menu_url: asText(operationPayload?.menu_url) || null,
    map_location: asText(operationPayload?.map_location) || null,
  };
}

function normalizeRestaurantDeletePayload(operationPayload, restaurantId) {
  return {
    restaurantId: asText(operationPayload?.restaurantId) || asText(restaurantId),
  };
}

function normalizeMonitoringStatsPayload(operationPayload, restaurantId) {
  return {
    restaurantId: asText(operationPayload?.restaurantId) || asText(restaurantId),
    lastChecked: asText(operationPayload?.lastChecked || operationPayload?.last_checked),
    totalChecksIncrement: Number.isFinite(Number(operationPayload?.totalChecksIncrement))
      ? toSafeNonNegativeInteger(operationPayload.totalChecksIncrement, 0)
      : null,
    emailsSentIncrement: Number.isFinite(Number(operationPayload?.emailsSentIncrement))
      ? toSafeNonNegativeInteger(operationPayload.emailsSentIncrement, 0)
      : null,
    totalChecks: Number.isFinite(Number(operationPayload?.totalChecks))
      ? toSafeNonNegativeInteger(operationPayload.totalChecks, 0)
      : null,
    emailsSent: Number.isFinite(Number(operationPayload?.emailsSent))
      ? toSafeNonNegativeInteger(operationPayload.emailsSent, 0)
      : null,
  };
}

export function normalizeOperationPayload({
  operationType,
  operationPayload,
  restaurantId,
}) {
  switch (operationType) {
    case RESTAURANT_WRITE_OPERATION_TYPES.MENU_STATE_REPLACE:
      return normalizeMenuStatePayload(operationPayload);
    case RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_SETTINGS_UPDATE:
      return normalizeRestaurantSettingsPayload(operationPayload);
    case RESTAURANT_WRITE_OPERATION_TYPES.CONFIRM_INFO:
      return normalizeConfirmInfoPayload(operationPayload);
    case RESTAURANT_WRITE_OPERATION_TYPES.BRAND_REPLACEMENT:
      return normalizeBrandReplacementPayload(operationPayload);
    case RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_CREATE:
      return normalizeRestaurantCreatePayload(operationPayload);
    case RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_DELETE:
      return normalizeRestaurantDeletePayload(operationPayload, restaurantId);
    case RESTAURANT_WRITE_OPERATION_TYPES.MONITORING_STATS_UPDATE:
      return normalizeMonitoringStatsPayload(operationPayload, restaurantId);
    default:
      return toJsonSafe(operationPayload, {});
  }
}

export function validateWriteStageRequest(body) {
  const scopeType = normalizeScopeType(body?.scopeType);
  const restaurantId = asText(body?.restaurantId);
  const operationType = normalizeOperationType(body?.operationType);
  const summary = asText(body?.summary) || operationType;
  const sortOrder = toSafeInteger(body?.sortOrder, 0);
  const expectedWriteVersion = Number.isFinite(Number(body?.expectedWriteVersion))
    ? toSafeVersion(body.expectedWriteVersion)
    : null;

  if (!scopeType) {
    throw new Error("scopeType is required");
  }

  if (!operationType) {
    throw new Error("operationType is required");
  }

  if (SYSTEM_ONLY_OPS.has(operationType)) {
    throw new Error("This operation type is internal only.");
  }

  if (scopeType === WRITE_SCOPE_TYPES.RESTAURANT && !restaurantId) {
    throw new Error("restaurantId is required for restaurant scope");
  }

  if (RESTAURANT_SCOPED_OPS.has(operationType) && !restaurantId) {
    throw new Error("restaurantId is required for this operation");
  }

  if (
    operationType === RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_CREATE &&
    scopeType !== WRITE_SCOPE_TYPES.ADMIN_GLOBAL
  ) {
    throw new Error("RESTAURANT_CREATE must use ADMIN_GLOBAL scope");
  }

  if (
    operationType === RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_DELETE &&
    scopeType !== WRITE_SCOPE_TYPES.RESTAURANT
  ) {
    throw new Error("RESTAURANT_DELETE must use RESTAURANT scope");
  }

  const scopeKey = resolveScopeKey(scopeType, restaurantId);
  if (!scopeKey) {
    throw new Error("Invalid write scope");
  }

  const normalizedPayload = normalizeOperationPayload({
    operationType,
    operationPayload: body?.operationPayload,
    restaurantId,
  });

  if (operationType === RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_CREATE) {
    if (!asText(normalizedPayload?.name) || !asText(normalizedPayload?.slug)) {
      throw new Error("Restaurant create payload requires name and slug");
    }
  }

  if (operationType === RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_DELETE) {
    if (!asText(normalizedPayload?.restaurantId)) {
      throw new Error("Restaurant delete payload requires restaurantId");
    }
  }

  if (operationType === RESTAURANT_WRITE_OPERATION_TYPES.MENU_STATE_REPLACE) {
    const hasOverlayDeltaPayload =
      Array.isArray(normalizedPayload?.overlayUpserts) ||
      Array.isArray(normalizedPayload?.overlayDeletes) ||
      normalizedPayload?.overlayOrderProvided === true;
    if (hasOverlayDeltaPayload && !asText(normalizedPayload?.stateHash)) {
      throw new Error("Menu state delta payload requires stateHash");
    }
  }

  return {
    scopeType,
    scopeKey,
    restaurantId,
    operationType,
    operationPayload: normalizedPayload,
    summary,
    sortOrder,
    expectedWriteVersion,
  };
}

export async function authorizeWriteStage({
  request,
  operationType,
  restaurantId,
}) {
  if (SYSTEM_ONLY_OPS.has(operationType)) {
    throw new Error("This operation type is internal only.");
  }

  if (ADMIN_ONLY_OPS.has(operationType)) {
    return await requireAdminSession(request);
  }

  if (RESTAURANT_SCOPED_OPS.has(operationType)) {
    return await requireRestaurantAccessSession(request, restaurantId);
  }

  return await requireAuthenticatedSession(request);
}

export function buildReviewSummary(batch, operations) {
  const normalizedOps = (Array.isArray(operations) ? operations : []).map((operation) => ({
    id: asText(operation?.id),
    operationType: asText(operation?.operation_type || operation?.operationType),
    summary: asText(operation?.summary),
    sortOrder: toSafeInteger(operation?.sort_order ?? operation?.sortOrder, 0),
    createdAt: operation?.created_at || operation?.createdAt || null,
    payload: parseJsonValue(operation?.operation_payload ?? operation?.operationPayload, {}),
  }));

  const menuOp = normalizedOps.find(
    (operation) =>
      operation.operationType === RESTAURANT_WRITE_OPERATION_TYPES.MENU_STATE_REPLACE,
  );
  const menuRows = Array.isArray(menuOp?.payload?.rows) ? menuOp.payload.rows : [];

  const reviewSummary = {
    operationCount: normalizedOps.length,
    operationTypes: normalizedOps.map((operation) => operation.operationType),
    summaries: normalizedOps.map((operation) => operation.summary).filter(Boolean),
    menuRows,
    rowCount: Number(menuOp?.payload?.rowCount) || menuRows.length,
    stateHash: asText(menuOp?.payload?.stateHash),
    baseWriteVersion: toSafeVersion(
      batch?.base_write_version ?? batch?.baseWriteVersion,
      0,
    ),
  };

  return reviewSummary;
}

export function mapBatchForResponse(batch) {
  if (!batch) return null;
  return {
    id: asText(batch.id),
    scopeType: asText(batch.scope_type),
    scopeKey: asText(batch.scope_key),
    restaurantId: asText(batch.restaurant_id),
    createdBy: asText(batch.created_by),
    author: asText(batch.author),
    status: asText(batch.status),
    baseWriteVersion: toSafeVersion(batch.base_write_version, 0),
    reviewSummary: parseJsonValue(batch.review_summary, {}),
    createdAt: batch.created_at || null,
    updatedAt: batch.updated_at || null,
    appliedAt: batch.applied_at || null,
    discardedAt: batch.discarded_at || null,
  };
}

export function mapOperationsForResponse(operations) {
  return (Array.isArray(operations) ? operations : []).map((operation) => ({
    id: asText(operation.id),
    batchId: asText(operation.batch_id),
    operationType: asText(operation.operation_type),
    summary: asText(operation.summary),
    sortOrder: toSafeInteger(operation.sort_order, 0),
    payload: parseJsonValue(operation.operation_payload, {}),
    createdAt: operation.created_at || null,
    updatedAt: operation.updated_at || null,
  }));
}

export async function loadPendingBatchForScope({
  client = prisma,
  scopeType,
  scopeKey,
  userId,
}) {
  const batchRows = await client.$queryRawUnsafe(
    `
    SELECT *
    FROM ${RESTAURANT_WRITE_BATCH_TABLE}
    WHERE scope_type = $1
      AND scope_key = $2
      AND created_by = $3::uuid
      AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `,
    scopeType,
    scopeKey,
    userId,
  );

  const batch = batchRows?.[0] || null;
  if (!batch) {
    return { batch: null, operations: [] };
  }

  const operations = await client.$queryRawUnsafe(
    `
    SELECT *
    FROM ${RESTAURANT_WRITE_OP_TABLE}
    WHERE batch_id = $1::uuid
    ORDER BY sort_order ASC, created_at ASC
  `,
    batch.id,
  );

  return {
    batch,
    operations: Array.isArray(operations) ? operations : [],
  };
}

export async function syncIngredientStatusFromOverlays(tx, restaurantId, overlays, options = {}) {
  const safeRestaurantId = asText(restaurantId);
  if (!safeRestaurantId) {
    return {
      rows: 0,
      allergens: 0,
      diets: 0,
      menuPages: 0,
      menuDishes: 0,
      menuIngredientRows: 0,
      menuBrandItems: 0,
    };
  }

  const normalizedOverlays = normalizeOverlayListForStorage(overlays);
  const menuImages = (Array.isArray(options?.menuImages) ? options.menuImages : [])
    .map((value) => asText(value))
    .filter(Boolean);
  const ingredientRows = buildIngredientRowsFromOverlays(normalizedOverlays);

  // Dual-write target tables: pages, dishes, ingredient rows, and selected brand assignments.
  await tx.restaurant_menu_ingredient_brand_items.deleteMany({
    where: { restaurant_id: safeRestaurantId },
  });
  await tx.restaurant_menu_ingredient_rows.deleteMany({
    where: { restaurant_id: safeRestaurantId },
  });
  await tx.restaurant_menu_dishes.deleteMany({
    where: { restaurant_id: safeRestaurantId },
  });
  await tx.restaurant_menu_pages.deleteMany({
    where: { restaurant_id: safeRestaurantId },
  });

  const menuPageRows = buildMenuPageRowsFromState(menuImages, normalizedOverlays);
  if (menuPageRows.length) {
    await tx.restaurant_menu_pages.createMany({
      data: menuPageRows.map((row) => ({
        restaurant_id: safeRestaurantId,
        page_index: row.pageIndex,
        image_url: row.imageUrl,
      })),
    });
  }

  const menuDishRows = buildMenuDishRowsFromOverlays(normalizedOverlays);
  if (menuDishRows.length) {
    await tx.restaurant_menu_dishes.createMany({
      data: menuDishRows.map((row) => ({
        restaurant_id: safeRestaurantId,
        dish_key: row.dishKey,
        dish_name: row.dishName,
        page_index: row.pageIndex,
        x: row.x,
        y: row.y,
        w: row.w,
        h: row.h,
        dish_text: row.dishText,
        description: row.description,
        details_json: row.detailsJson,
        allergens: row.allergens,
        diets: row.diets,
        cross_contamination_allergens: row.crossContaminationAllergens,
        cross_contamination_diets: row.crossContaminationDiets,
        removable_json: row.removableJson,
        ingredients_blocking_diets_json: row.ingredientsBlockingDietsJson,
        payload_json: row.payloadJson,
      })),
    });
  }

  const insertedMenuDishes = await tx.restaurant_menu_dishes.findMany({
    where: { restaurant_id: safeRestaurantId },
    select: { id: true, dish_key: true },
  });
  const menuDishIdByKey = new Map();
  insertedMenuDishes.forEach((row) => {
    const key = asText(row.dish_key);
    if (!key) return;
    menuDishIdByKey.set(key, row.id);
  });

  const menuIngredientRows = ingredientRows.map((row) => ({
    restaurant_id: safeRestaurantId,
    dish_id: menuDishIdByKey.get(asText(row.dishKey)) || null,
    dish_name: row.dishName,
    row_index: row.rowIndex,
    row_text: row.rowText || null,
    applied_brand_item: row.appliedBrandItem || null,
    ingredient_payload: toJsonSafe(row.ingredientPayload, {}),
  }));

  if (menuIngredientRows.length) {
    await tx.restaurant_menu_ingredient_rows.createMany({
      data: menuIngredientRows,
    });
  }

  const insertedMenuIngredientRows = await tx.restaurant_menu_ingredient_rows.findMany({
    where: { restaurant_id: safeRestaurantId },
    select: { id: true, dish_name: true, row_index: true },
  });
  const menuIngredientRowIdByDishAndIndex = new Map();
  insertedMenuIngredientRows.forEach((row) => {
    menuIngredientRowIdByDishAndIndex.set(
      `${asText(row.dish_name)}::${Number(row.row_index)}`,
      row.id,
    );
  });

  const menuBrandRows = [];
  ingredientRows.forEach((row) => {
    const menuIngredientRowId = menuIngredientRowIdByDishAndIndex.get(
      `${asText(row.dishName)}::${Number(row.rowIndex)}`,
    );
    if (!menuIngredientRowId) return;
    if (!row.appliedBrand?.brandName) return;

    menuBrandRows.push({
      restaurant_id: safeRestaurantId,
      ingredient_row_id: menuIngredientRowId,
      dish_name: row.dishName,
      row_index: row.rowIndex,
      brand_name: row.appliedBrand.brandName,
      barcode: row.appliedBrand.barcode,
      brand_image: row.appliedBrand.brandImage,
      ingredients_image: row.appliedBrand.ingredientsImage,
      image: row.appliedBrand.image,
      ingredient_list: row.appliedBrand.ingredientList,
      ingredients_list: row.appliedBrand.ingredientsList,
      allergens: row.appliedBrand.allergens,
      cross_contamination_allergens: row.appliedBrand.crossContaminationAllergens,
      diets: row.appliedBrand.diets,
      cross_contamination_diets: row.appliedBrand.crossContaminationDiets,
      brand_payload: toJsonSafe(row.appliedBrand.brandPayload, {}),
    });
  });

  if (menuBrandRows.length) {
    await tx.restaurant_menu_ingredient_brand_items.createMany({
      data: menuBrandRows,
    });
  }

  await tx.dish_ingredient_rows.deleteMany({
    where: {
      restaurant_id: safeRestaurantId,
    },
  });

  const allergenRows = await tx.allergens.findMany({
    where: { is_active: true },
    select: { id: true, key: true },
  });

  const dietRows = await tx.diets.findMany({
    where: { is_active: true, is_supported: true },
    select: { id: true, label: true },
  });

  const allergenIdByToken = buildTokenMap(allergenRows, (item) => item.key);
  const dietIdByToken = buildTokenMap(dietRows, (item) => item.label);
  const supportedDietLabels = dietRows.map((row) => row.label);

  if (ingredientRows.length) {
    await tx.dish_ingredient_rows.createMany({
      data: ingredientRows.map((row) => ({
        restaurant_id: safeRestaurantId,
        dish_name: row.dishName,
        row_index: row.rowIndex,
        row_text: row.rowText || null,
      })),
    });
  }

  const insertedRows = await tx.dish_ingredient_rows.findMany({
    where: { restaurant_id: safeRestaurantId },
    select: { id: true, dish_name: true, row_index: true },
  });

  const ingredientRowIdByDishAndIndex = new Map();
  insertedRows.forEach((row) => {
    ingredientRowIdByDishAndIndex.set(
      `${asText(row.dish_name)}::${Number(row.row_index)}`,
      row.id,
    );
  });

  const allergenEntries = [];
  const dietEntries = [];

  ingredientRows.forEach((row) => {
    const rowId = ingredientRowIdByDishAndIndex.get(
      `${asText(row.dishName)}::${Number(row.rowIndex)}`,
    );
    if (!rowId) return;

    const selectedAllergenContains = Array.isArray(row.allergens) ? row.allergens : [];
    const selectedAllergenCross = Array.isArray(row.crossContaminationAllergens)
      ? row.crossContaminationAllergens
      : [];
    const smartAllergenContains = Array.isArray(row.aiDetectedAllergens)
      ? row.aiDetectedAllergens
      : [];
    const smartAllergenCross = Array.isArray(row.aiDetectedCrossContaminationAllergens)
      ? row.aiDetectedCrossContaminationAllergens
      : [];

    const allergenStatusByToken = new Map();
    selectedAllergenContains.forEach((value) => {
      const token = normalizeToken(value);
      if (!token) return;
      allergenStatusByToken.set(token, {
        is_violation: true,
        is_cross_contamination: false,
      });
    });

    selectedAllergenCross.forEach((value) => {
      const token = normalizeToken(value);
      if (!token) return;
      const current = allergenStatusByToken.get(token) || {
        is_violation: false,
        is_cross_contamination: false,
      };
      current.is_cross_contamination = true;
      allergenStatusByToken.set(token, current);
    });

    allergenStatusByToken.forEach((status, token) => {
      const allergenId = allergenIdByToken.get(token);
      if (!allergenId) return;
      const selectedState = readTokenState({
        containsValues: selectedAllergenContains,
        crossValues: selectedAllergenCross,
        token,
      });
      const smartState = readTokenState({
        containsValues: smartAllergenContains,
        crossValues: smartAllergenCross,
        token,
      });
      const source = resolveIngredientProvenanceSource({
        selectedState,
        smartState,
      });
      allergenEntries.push({
        ingredient_row_id: rowId,
        allergen_id: allergenId,
        is_violation: Boolean(status.is_violation),
        is_cross_contamination: Boolean(status.is_cross_contamination),
        is_removable: Boolean(row.removable),
        source,
      });
    });

    const selectedCompatibleDiets = Array.isArray(row.diets) ? row.diets : [];
    const selectedCrossDiets = Array.isArray(row.crossContaminationDiets)
      ? row.crossContaminationDiets
      : [];
    const smartCompatibleDiets = Array.isArray(row.aiDetectedDiets)
      ? row.aiDetectedDiets
      : [];
    const smartCrossDiets = Array.isArray(row.aiDetectedCrossContaminationDiets)
      ? row.aiDetectedCrossContaminationDiets
      : [];

    const compatibleDietTokens = new Set(
      selectedCompatibleDiets.map((value) => normalizeToken(value)).filter(Boolean),
    );
    const crossDietTokens = new Set(
      selectedCrossDiets.map((value) => normalizeToken(value)).filter(Boolean),
    );

    supportedDietLabels.forEach((label) => {
      const labelToken = normalizeToken(label);
      if (!labelToken) return;
      const dietId = dietIdByToken.get(labelToken);
      if (!dietId) return;

      const selectedState = crossDietTokens.has(labelToken)
        ? "cross"
        : compatibleDietTokens.has(labelToken)
          ? "contains"
          : "none";
      const smartState = readTokenState({
        containsValues: smartCompatibleDiets,
        crossValues: smartCrossDiets,
        token: labelToken,
      });
      const source = resolveIngredientProvenanceSource({
        selectedState,
        smartState,
      });

      if (crossDietTokens.has(labelToken)) {
        dietEntries.push({
          ingredient_row_id: rowId,
          diet_id: dietId,
          is_violation: false,
          is_cross_contamination: true,
          is_removable: Boolean(row.removable),
          source,
        });
        return;
      }

      if (!compatibleDietTokens.has(labelToken)) {
        dietEntries.push({
          ingredient_row_id: rowId,
          diet_id: dietId,
          is_violation: true,
          is_cross_contamination: false,
          is_removable: Boolean(row.removable),
          source,
        });
      }
    });
  });

  if (allergenEntries.length) {
    await tx.dish_ingredient_allergens.createMany({ data: allergenEntries });
  }
  if (dietEntries.length) {
    await tx.dish_ingredient_diets.createMany({ data: dietEntries });
  }

  return {
    rows: ingredientRows.length,
    allergens: allergenEntries.length,
    diets: dietEntries.length,
    menuPages: menuPageRows.length,
    menuDishes: menuDishRows.length,
    menuIngredientRows: menuIngredientRows.length,
    menuBrandItems: menuBrandRows.length,
  };
}

export async function bumpRestaurantWriteVersion(tx, restaurantId) {
  const safeRestaurantId = asText(restaurantId);
  if (!safeRestaurantId) return 0;

  await setRestaurantWriteContext(tx);

  const rows = await tx.$queryRawUnsafe(
    `
    UPDATE public.restaurants
    SET write_version = COALESCE(write_version, 0) + 1
    WHERE id = $1::uuid
    RETURNING write_version
  `,
    safeRestaurantId,
  );

  return toSafeVersion(rows?.[0]?.write_version, 0);
}

export async function setRestaurantWriteContext(tx) {
  if (!tx || typeof tx.$executeRawUnsafe !== "function") return;
  await tx.$executeRawUnsafe(`
    SELECT set_config('app.restaurant_write_context', 'gateway', true)
  `);
}

async function readRestaurantMenuStateSnapshot(tx, restaurantId) {
  const state = await fetchRestaurantMenuStateFromTablesWithPrisma(tx, restaurantId);
  const overlays = normalizeOverlayListForStorage(state?.overlays);
  const menuImages = (Array.isArray(state?.menuImages) ? state.menuImages : [])
    .map((value) => asText(value))
    .filter(Boolean);
  return {
    overlays,
    menuImages,
  };
}

function buildPersistedMenuChangePayload({
  inputChangePayload,
  overlays,
  menuImages,
  reviewRows,
}) {
  const payload = toJsonSafe(inputChangePayload, {});
  const snapshot = payload?.snapshot;
  const shouldInjectSnapshot =
    !snapshot ||
    (typeof snapshot === "object" && asText(snapshot?.mode) === "server_generated");

  if (shouldInjectSnapshot) {
    payload.snapshot = {
      overlays: toJsonSafe(overlays, []),
      menuImages: toJsonSafe(menuImages, []),
    };
  }

  payload.reviewRows = toJsonSafe(
    Array.isArray(reviewRows) ? reviewRows : payload?.reviewRows,
    [],
  );

  return payload;
}

export async function applyWriteOperations({
  tx,
  batch,
  operations,
  userEmail,
}) {
  await setRestaurantWriteContext(tx);

  const touchedRestaurantIds = new Set();
  const deletedRestaurantIds = new Set();
  const createdRestaurants = [];
  const operationResults = [];

  for (const operation of operations) {
    const operationType = asText(operation?.operation_type);
    const payload = parseJsonValue(operation?.operation_payload, {});
    const summary = asText(operation?.summary);

    switch (operationType) {
      case RESTAURANT_WRITE_OPERATION_TYPES.MENU_STATE_REPLACE: {
        const restaurantId = asText(batch?.restaurant_id);
        const hasOverlayDeltaPayload =
          Array.isArray(payload?.overlayUpserts) ||
          Array.isArray(payload?.overlayDeletes) ||
          payload?.overlayOrderProvided === true;
        const changedFieldsProvided = hasOwnPropertyValue(payload, "changedFieldsProvided")
          ? payload?.changedFieldsProvided === true
          : Array.isArray(payload?.changedFields);
        const changedFields = normalizeMenuStateChangedFields(payload?.changedFields);
        const changedFieldSet = new Set(changedFields);
        const shouldUpdateOverlays = changedFieldsProvided
          ? changedFieldSet.has(MENU_STATE_CHANGED_FIELD_KEYS.OVERLAYS)
          : true;
        const currentMenuState = await readRestaurantMenuStateSnapshot(tx, restaurantId);
        let overlays = shouldUpdateOverlays
          ? normalizeOverlayListForStorage(payload?.overlays)
          : currentMenuState.overlays;
        const { menuImages, menuImagesProvided } = normalizeMenuImageValues(payload);
        const shouldUpdateMenuImages = changedFieldsProvided
          ? changedFieldSet.has(MENU_STATE_CHANGED_FIELD_KEYS.MENU_IMAGES)
          : menuImagesProvided;

        if (hasOverlayDeltaPayload) {
          const mergedOverlays = applyOverlayDelta({
            baseOverlays: currentMenuState.overlays,
            overlayUpserts: payload?.overlayUpserts,
            overlayDeletes: payload?.overlayDeletes,
            overlayOrder: payload?.overlayOrder,
            overlayOrderProvided: payload?.overlayOrderProvided === true,
          });
          overlays = shouldUpdateOverlays ? mergedOverlays : currentMenuState.overlays;
        }

        const persistedMenuImages = shouldUpdateMenuImages
          ? menuImages
          : currentMenuState.menuImages;
        const shouldSyncMenuState = shouldUpdateOverlays || shouldUpdateMenuImages;
        const persistedChangePayload = buildPersistedMenuChangePayload({
          inputChangePayload: payload?.changePayload,
          overlays,
          menuImages: persistedMenuImages,
          reviewRows: Array.isArray(payload?.rows) ? payload.rows : [],
        });

        const syncResult = shouldSyncMenuState
          ? await syncIngredientStatusFromOverlays(
              tx,
              restaurantId,
              overlays,
              { menuImages: persistedMenuImages },
            )
          : {
              rows: 0,
              allergens: 0,
              diets: 0,
              menuPages: 0,
              menuDishes: 0,
              menuIngredientRows: 0,
              menuBrandItems: 0,
            };

        await tx.change_logs.create({
          data: {
            restaurant_id: restaurantId,
            type: "update",
            description: asText(batch?.author) || "Manager",
            changes: persistedChangePayload,
            user_email: userEmail || null,
            photos: [],
            timestamp: new Date(),
          },
        });

        touchedRestaurantIds.add(restaurantId);
        operationResults.push({
          operationType,
          summary,
          changedFields,
          ...syncResult,
        });
        break;
      }

      case RESTAURANT_WRITE_OPERATION_TYPES.BRAND_REPLACEMENT: {
        const restaurantId = asText(batch?.restaurant_id);
        const hasOverlayDeltaPayload =
          Array.isArray(payload?.overlayUpserts) ||
          Array.isArray(payload?.overlayDeletes) ||
          payload?.overlayOrderProvided === true;
        const currentMenuState = await readRestaurantMenuStateSnapshot(tx, restaurantId);
        let overlays = normalizeOverlayListForStorage(payload?.overlays);

        if (hasOverlayDeltaPayload) {
          overlays = applyOverlayDelta({
            baseOverlays: currentMenuState.overlays,
            overlayUpserts: payload?.overlayUpserts,
            overlayDeletes: payload?.overlayDeletes,
            overlayOrder: payload?.overlayOrder,
            overlayOrderProvided: payload?.overlayOrderProvided === true,
          });
        }

        const { menuImages, menuImagesProvided } = normalizeMenuImageValues(payload);
        const persistedMenuImages = menuImagesProvided ? menuImages : currentMenuState.menuImages;
        const persistedChangePayload = buildPersistedMenuChangePayload({
          inputChangePayload: payload?.changePayload,
          overlays,
          menuImages: persistedMenuImages,
          reviewRows: Array.isArray(payload?.rows) ? payload.rows : [],
        });

        const syncResult = await syncIngredientStatusFromOverlays(
          tx,
          restaurantId,
          overlays,
          { menuImages: persistedMenuImages },
        );

        await tx.change_logs.create({
          data: {
            restaurant_id: restaurantId,
            type: "update",
            description: asText(batch?.author) || "Manager",
            changes: persistedChangePayload,
            user_email: userEmail || null,
            photos: [],
            timestamp: new Date(),
          },
        });

        touchedRestaurantIds.add(restaurantId);
        operationResults.push({
          operationType,
          summary,
          ...syncResult,
        });
        break;
      }

      case RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_SETTINGS_UPDATE: {
        const restaurantId = asText(batch?.restaurant_id);
        const nextSettings = {
          website: asText(payload?.website) || null,
          phone: asText(payload?.phone) || null,
          delivery_url: asText(payload?.delivery_url) || null,
          menu_url: asText(payload?.menu_url) || null,
          map_location: asText(payload?.map_location) || null,
        };

        await tx.restaurants.update({
          where: { id: restaurantId },
          data: nextSettings,
        });

        await tx.change_logs.create({
          data: {
            restaurant_id: restaurantId,
            type: "update",
            description: asText(batch?.author) || "Manager",
            changes: toJsonSafe(payload?.changePayload, nextSettings),
            user_email: userEmail || null,
            photos: [],
            timestamp: new Date(),
          },
        });

        touchedRestaurantIds.add(restaurantId);
        operationResults.push({
          operationType,
          summary,
        });
        break;
      }

      case RESTAURANT_WRITE_OPERATION_TYPES.CONFIRM_INFO: {
        const restaurantId = asText(batch?.restaurant_id);
        const confirmedAt = asText(payload?.confirmedAt) || new Date().toISOString();

        await tx.restaurants.update({
          where: { id: restaurantId },
          data: {
            last_confirmed: new Date(confirmedAt),
          },
        });

        await tx.change_logs.create({
          data: {
            restaurant_id: restaurantId,
            type: "confirm",
            description: asText(batch?.author) || "Manager",
            changes: toJsonSafe(payload?.changePayload, {}),
            user_email: userEmail || null,
            photos: toJsonSafe(
              (Array.isArray(payload?.photos) ? payload.photos : [])
                .map((value) => asText(value))
                .filter(Boolean),
              [],
            ),
            timestamp: new Date(confirmedAt),
          },
        });

        touchedRestaurantIds.add(restaurantId);
        operationResults.push({
          operationType,
          summary,
          confirmedAt,
        });
        break;
      }

      case RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_CREATE: {
        const createMenuImages = (Array.isArray(payload?.menuImages) ? payload.menuImages : [])
          .map((value) => asText(value))
          .filter(Boolean);
        const createMenuImage = asText(payload?.menuImage);
        if (!createMenuImages.length && createMenuImage) {
          createMenuImages.push(createMenuImage);
        }
        const createOverlays = normalizeOverlayListForStorage(payload?.overlays);

        const created = await tx.restaurants.create({
          data: {
            name: asText(payload?.name),
            slug: asText(payload?.slug),
            website: asText(payload?.website) || null,
            phone: asText(payload?.phone) || null,
            delivery_url: asText(payload?.delivery_url) || null,
            menu_url: asText(payload?.menu_url) || null,
            map_location: asText(payload?.map_location) || null,
            last_confirmed: null,
          },
          select: {
            id: true,
            slug: true,
          },
        });

        await tx.$executeRawUnsafe(
          `
          UPDATE public.restaurants
          SET write_version = 1
          WHERE id = $1::uuid
        `,
          created.id,
        );

        const syncResult = await syncIngredientStatusFromOverlays(
          tx,
          created.id,
          createOverlays,
          { menuImages: createMenuImages },
        );

        createdRestaurants.push({
          id: asText(created.id),
          slug: asText(created.slug),
          writeVersion: 1,
        });

        operationResults.push({
          operationType,
          summary,
          restaurantId: asText(created.id),
          slug: asText(created.slug),
          ...syncResult,
        });
        break;
      }

      case RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_DELETE: {
        const restaurantId = asText(payload?.restaurantId || batch?.restaurant_id);
        if (!restaurantId) {
          throw new Error("Restaurant delete operation missing restaurant id.");
        }

        await tx.restaurants.delete({
          where: { id: restaurantId },
        });

        deletedRestaurantIds.add(restaurantId);
        operationResults.push({
          operationType,
          summary,
          restaurantId,
        });
        break;
      }

      case RESTAURANT_WRITE_OPERATION_TYPES.MONITORING_STATS_UPDATE: {
        const restaurantId = asText(payload?.restaurantId || batch?.restaurant_id);
        if (!restaurantId) {
          throw new Error("Monitoring stats update operation missing restaurant id.");
        }

        const updateData = {};
        const lastCheckedRaw = asText(payload?.lastChecked || payload?.last_checked);
        if (lastCheckedRaw) {
          updateData.last_checked = new Date(lastCheckedRaw);
        } else {
          updateData.last_checked = new Date();
        }

        if (Number.isFinite(Number(payload?.totalChecksIncrement))) {
          const increment = toSafeNonNegativeInteger(payload.totalChecksIncrement, 0);
          updateData.total_checks = { increment };
        } else if (Number.isFinite(Number(payload?.totalChecks))) {
          updateData.total_checks = toSafeNonNegativeInteger(payload.totalChecks, 0);
        }

        if (Number.isFinite(Number(payload?.emailsSentIncrement))) {
          const increment = toSafeNonNegativeInteger(payload.emailsSentIncrement, 0);
          updateData.emails_sent = { increment };
        } else if (Number.isFinite(Number(payload?.emailsSent))) {
          updateData.emails_sent = toSafeNonNegativeInteger(payload.emailsSent, 0);
        }

        await tx.restaurants.update({
          where: { id: restaurantId },
          data: updateData,
        });

        operationResults.push({
          operationType,
          summary,
          restaurantId,
          totalChecksIncrement: Number.isFinite(Number(payload?.totalChecksIncrement))
            ? toSafeNonNegativeInteger(payload.totalChecksIncrement, 0)
            : null,
          emailsSentIncrement: Number.isFinite(Number(payload?.emailsSentIncrement))
            ? toSafeNonNegativeInteger(payload.emailsSentIncrement, 0)
            : null,
        });
        break;
      }

      default:
        throw new Error(`Unsupported operation type: ${operationType}`);
    }
  }

  const nextWriteVersions = [];
  for (const restaurantId of touchedRestaurantIds) {
    if (deletedRestaurantIds.has(restaurantId)) continue;
    const writeVersion = await bumpRestaurantWriteVersion(tx, restaurantId);
    nextWriteVersions.push({
      restaurantId,
      writeVersion,
    });
  }

  return {
    operationResults,
    nextWriteVersions,
    createdRestaurants,
  };
}
