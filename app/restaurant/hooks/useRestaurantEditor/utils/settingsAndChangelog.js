import { PENDING_CHANGE_KEY_PREFIX } from "../constants";
import { asText } from "./text";

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

export function buildDefaultChangeLogPayload({ author, pendingChanges, snapshot }) {
  // Group pending-change lines into general messages and item-specific messages.
  // The grouped format keeps change-log cards readable in UI.
  const grouped = {};
  const general = [];

  (Array.isArray(pendingChanges) ? pendingChanges : []).forEach((line) => {
    const text = decodePendingChangeLine(line).text;
    if (!text) return;

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

  if (!general.length && !Object.keys(grouped).length) {
    general.push("Menu overlays updated");
  }

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
