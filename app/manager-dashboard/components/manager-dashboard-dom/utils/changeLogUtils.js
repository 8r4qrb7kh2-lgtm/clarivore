// These helpers transform raw change_log rows into UI-friendly objects.
// The goal is to accept mixed backend payload shapes and always return a safe, predictable structure.

function getChangeText(change) {
  // The backend may send a plain string already ready for display.
  if (typeof change === "string") return change;

  // If the entry is missing or not an object, we cannot safely read nested fields.
  if (!change || typeof change !== "object") return "";

  // The payload has evolved over time, so we support several known field shapes.
  if (typeof change.text === "string") return change.text;
  if (change.text && typeof change.text.text === "string") return change.text.text;
  if (typeof change.label === "string") return change.label;
  if (typeof change.message === "string") return change.message;

  // Legacy change rows sometimes only include ingredient metadata.
  if (change.details && typeof change.details.ingredient === "string") {
    return `Ingredient update: ${change.details.ingredient}`;
  }

  // Unknown format: return empty to skip rendering noisy placeholders.
  return "";
}

export function parseChangeLogEntry(log) {
  // The `changes` field may be JSON text, an object, or missing.
  const parsedChanges = (() => {
    if (!log?.changes) return null;
    if (typeof log.changes === "object") return log.changes;

    try {
      return JSON.parse(log.changes);
    } catch {
      // Invalid JSON is treated as no details so the UI still renders safely.
      return null;
    }
  })();

  // Fallback values guarantee stable output even when rows are partially populated.
  const author = parsedChanges?.author || "Unknown";
  const timestamp = log?.timestamp
    ? new Date(log.timestamp).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  // Collect dish-specific edits into `{ dishName, lines[] }` rows for easy rendering.
  const dishChanges = [];
  const dishItems = parsedChanges?.items && typeof parsedChanges.items === "object"
    ? parsedChanges.items
    : {};

  Object.entries(dishItems).forEach(([dishName, changes]) => {
    const lines = (Array.isArray(changes) ? changes : [])
      .map(getChangeText)
      .filter(Boolean);
    dishChanges.push({ dishName, lines });
  });

  // Collect top-level "general" edits in display order.
  const generalChanges = (Array.isArray(parsedChanges?.general) ? parsedChanges.general : [])
    .map(getChangeText)
    .filter(Boolean);

  return {
    // Stable id fallback keeps React keys reliable when log.id is missing.
    id: log?.id || `${log?.timestamp || ""}-${author}`,
    author,
    timestamp,
    dishChanges,
    generalChanges,
    // Flag used to decide whether to show detailed lists or generic "Menu updated" text.
    hasDetails: dishChanges.length > 0 || generalChanges.length > 0,
  };
}
