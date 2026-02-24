import { PENDING_CHANGE_KEY_PREFIX } from "../constants";
import { asText, normalizeToken } from "./text";

// Settings and change-log formatting helpers.
// These are shared by save flows and restore flows.

export function createEmptySettingsDraft(restaurant) {
  // Settings draft always starts from trimmed string values.
  return {
    website: asText(restaurant?.website),
    phone: asText(restaurant?.phone),
    delivery_url: asText(restaurant?.delivery_url),
    menu_url: asText(restaurant?.menu_url),
  };
}

export function serializeSettingsDraft(value) {
  // Serialize only fields relevant to settings dirty-state checks.
  return JSON.stringify({
    website: asText(value?.website),
    phone: asText(value?.phone),
    delivery_url: asText(value?.delivery_url),
    menu_url: asText(value?.menu_url),
  });
}

export function parseChangeLogPayload(log) {
  // Support both object and JSON-string log payloads from historical records.
  const raw = log?.changes;
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function decodePendingChangeLine(line) {
  // Decode "__pc__:<key>::<message>" format into a structured object.
  const text = asText(line);
  if (!text.startsWith(PENDING_CHANGE_KEY_PREFIX)) {
    return {
      key: "",
      text,
    };
  }

  const separatorIndex = text.indexOf("::", PENDING_CHANGE_KEY_PREFIX.length);
  if (separatorIndex < 0) {
    return {
      key: "",
      text,
    };
  }

  const encodedKey = text.slice(PENDING_CHANGE_KEY_PREFIX.length, separatorIndex);
  const decodedKey = asText(decodeURIComponent(encodedKey));
  return {
    key: decodedKey,
    text: asText(text.slice(separatorIndex + 2)),
  };
}

export function encodePendingChangeLine(text, key) {
  // Encode a pending-change line with an optional stable key for dedupe/replace.
  const safeText = asText(text);
  const safeKey = asText(key);
  if (!safeText) return "";
  if (!safeKey) return safeText;
  return `${PENDING_CHANGE_KEY_PREFIX}${encodeURIComponent(safeKey)}::${safeText}`;
}

function buildOverlayNameByKey(...overlayCollections) {
  const output = new Map();
  overlayCollections.forEach((overlays) => {
    (Array.isArray(overlays) ? overlays : []).forEach((overlay) => {
      const name = asText(overlay?.id || overlay?.name || overlay?.dishName);
      if (!name) return;

      const keyCandidates = [
        overlay?.overlayKey,
        overlay?._editorKey,
        overlay?.id,
        overlay?.name,
        overlay?.dishName,
      ];
      keyCandidates.forEach((value) => {
        const token = normalizeToken(value);
        if (!token || output.has(token)) return;
        output.set(token, name);
      });
    });
  });
  return output;
}

function parseOverlayTokenFromPendingKey(key) {
  const safeKey = asText(key);
  if (!safeKey) return "";

  if (safeKey.startsWith("overlay-position:")) {
    return normalizeToken(safeKey.slice("overlay-position:".length));
  }
  if (safeKey.startsWith("overlay:")) {
    const parts = safeKey.split(":");
    return normalizeToken(parts[1]);
  }
  if (safeKey.startsWith("ingredient-row:")) {
    const parts = safeKey.split(":");
    return normalizeToken(parts[1]);
  }
  if (safeKey.startsWith("ingredient-flag:")) {
    const parts = safeKey.split(":");
    return normalizeToken(parts[1]);
  }
  return "";
}

function stripLeadingDishPrefix(text) {
  const safeText = asText(text);
  const splitIndex = safeText.indexOf(":");
  if (splitIndex <= 0) return safeText;

  const maybePrefix = asText(safeText.slice(0, splitIndex));
  const remainder = asText(safeText.slice(splitIndex + 1));
  if (!maybePrefix || !remainder) return safeText;

  const skipPrefixes = new Set([
    "menupages",
    "menuimages",
    "menuanalysis",
    "ingredientrowadded",
    "ingredientrowremoved",
    "changesto",
  ]);
  if (skipPrefixes.has(normalizeToken(maybePrefix))) {
    return safeText;
  }
  return remainder;
}

export function buildDefaultChangeLogPayload({
  author,
  pendingChanges,
  snapshot,
  overlays,
  baselineOverlays,
}) {
  // Group pending-change lines into general messages and item-specific messages.
  // The grouped format keeps change-log cards readable in UI.
  const grouped = {};
  const general = [];
  const overlayNameByKey = buildOverlayNameByKey(overlays, baselineOverlays);

  (Array.isArray(pendingChanges) ? pendingChanges : []).forEach((line) => {
    const decoded = decodePendingChangeLine(line);
    const text = decoded.text;
    if (!text) return;

    const keyedOverlayToken = parseOverlayTokenFromPendingKey(decoded.key);
    const keyedOverlayName = keyedOverlayToken ? overlayNameByKey.get(keyedOverlayToken) : "";
    if (keyedOverlayName) {
      if (!grouped[keyedOverlayName]) grouped[keyedOverlayName] = [];
      grouped[keyedOverlayName].push(stripLeadingDishPrefix(text) || text);
      return;
    }

    const splitIndex = text.indexOf(":");
    if (splitIndex > 0) {
      const itemName = asText(text.slice(0, splitIndex));
      const entry = asText(text.slice(splitIndex + 1));
      if (!itemName) {
        general.push(text);
        return;
      }
      if (!grouped[itemName]) grouped[itemName] = [];
      if (entry) grouped[itemName].push(entry);
      return;
    }

    general.push(text);
  });

  const payload = {
    author: author || "Manager",
    general,
    items: grouped,
  };

  if (snapshot && typeof snapshot === "object") {
    payload.snapshot = snapshot;
  }

  return payload;
}

export function computeDietBlockers(ingredients, diets) {
  // For each diet, list ingredient rows that block diet compliance.
  // The UI uses this to explain why a dish cannot claim a diet tag.
  const rows = Array.isArray(ingredients) ? ingredients : [];
  const dietList = Array.isArray(diets) ? diets : [];
  const output = {};

  dietList.forEach((diet) => {
    const blockers = rows
      .filter((ingredient) => {
        if (!Array.isArray(ingredient?.diets)) return true;
        return !ingredient.diets.includes(diet);
      })
      .map((ingredient) => ({
        ingredient: ingredient?.name || "Ingredient",
        removable: Boolean(ingredient?.removable),
      }));

    if (blockers.length) {
      output[diet] = blockers;
    }
  });

  return output;
}
