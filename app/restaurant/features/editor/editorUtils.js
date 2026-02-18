// Primitive normalization helpers shared by editor, modals, and row components.
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function asText(value) {
  return String(value || "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseOverlayNumber(value) {
  const parsed =
    typeof value === "string" ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(parsed, 0, 100);
}

async function fileToDataUrl(file) {
  if (!file) return "";
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function normalizePageIndexList(values, pageCount = Number.POSITIVE_INFINITY) {
  const maxPage = Number.isFinite(Number(pageCount))
    ? Math.max(Number(pageCount) - 1, 0)
    : Number.POSITIVE_INFINITY;
  const seen = new Set();
  const output = [];

  (Array.isArray(values) ? values : []).forEach((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const safe = Math.max(0, Math.floor(numeric));
    if (safe > maxPage) return;
    if (seen.has(safe)) return;
    seen.add(safe);
    output.push(safe);
  });

  return output;
}

function remapPageIndexListForMove(values, fromIndex, toIndex, pageCount) {
  const safeCount = Math.max(Number(pageCount) || 0, 1);
  const safeFrom = clamp(Number(fromIndex) || 0, 0, safeCount - 1);
  const safeTo = clamp(Number(toIndex) || 0, 0, safeCount - 1);
  if (safeFrom === safeTo) {
    return normalizePageIndexList(values, safeCount);
  }

  const remapIndex = (index) => {
    if (index === safeFrom) return safeTo;
    if (safeFrom < safeTo && index > safeFrom && index <= safeTo) return index - 1;
    if (safeFrom > safeTo && index >= safeTo && index < safeFrom) return index + 1;
    return index;
  };

  return normalizePageIndexList(
    (Array.isArray(values) ? values : []).map((value) => remapIndex(Number(value) || 0)),
    safeCount,
  );
}

function remapPageIndexListForRemove(values, removedIndex, pageCountBefore) {
  const safeBefore = Math.max(Number(pageCountBefore) || 0, 1);
  const safeRemoved = clamp(Number(removedIndex) || 0, 0, safeBefore - 1);
  const safeAfter = Math.max(safeBefore - 1, 1);

  const remapped = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .filter((value) => value !== safeRemoved)
    .map((value) => (value > safeRemoved ? value - 1 : value));

  return normalizePageIndexList(remapped, safeAfter);
}

// Change log helpers tolerate legacy payloads and newer structured objects.
function parseChangePayload(log) {
  if (!log?.changes) return null;
  if (typeof log.changes === "object") return log.changes;
  if (typeof log.changes !== "string") return null;
  try {
    return JSON.parse(log.changes);
  } catch {
    return null;
  }
}

function summarizeForDedup(value) {
  const summary = formatChangeText(value);
  return normalizeToken(summary);
}

function collectRenderedChangeSummaryTokens(general, items) {
  const tokens = new Set();
  (Array.isArray(general) ? general : []).forEach((line) => {
    const token = summarizeForDedup(line);
    if (token) tokens.add(token);
  });

  Object.entries(items && typeof items === "object" ? items : {}).forEach(([dishName, changes]) => {
    const safeDishName = asText(dishName);
    const dishToken = normalizeToken(safeDishName);
    const lines = Array.isArray(changes) ? changes : [changes];
    lines.forEach((line) => {
      const summary = formatChangeText(line);
      const summaryToken = normalizeToken(summary);
      if (summaryToken) tokens.add(summaryToken);
      if (dishToken && summaryToken) {
        tokens.add(normalizeToken(`${safeDishName}: ${summary}`));
      }
    });
  });

  return tokens;
}

function formatChangeText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (!value) return "";
  if (Array.isArray(value)) {
    return value.map((entry) => formatChangeText(entry)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const message =
      value.message || value.summary || value.text || value.description || value.title;
    if (message) return String(message);
    const ingredient = value.ingredient || value.ingredientName || value.name;
    const action = value.action || value.type || value.operation;
    const category = value.category || value.classification || value.mode;
    const detailParts = [ingredient, action, category]
      .map((part) => String(part || "").trim())
      .filter(Boolean);
    if (detailParts.length) return detailParts.join(" · ");
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

function normalizeLegacyDiff(value) {
  if (value == null || value === "") return "None";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const text = value.map((entry) => formatChangeText(entry)).filter(Boolean).join(", ");
    return text || "None";
  }

  if (typeof value === "object") {
    const pairs = Object.entries(value)
      .map(([key, entry]) => {
        const text = formatChangeText(entry);
        return text ? `${key}: ${text}` : "";
      })
      .filter(Boolean);

    if (pairs.length) return pairs.join("\n");

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "None";
    }
  }

  return "None";
}

function renderChangeLine(line, key) {
  const summary = formatChangeText(line);
  const before =
    line && typeof line === "object"
      ? line.before ?? line.previous ?? line.prev ?? line.from
      : null;
  const after =
    line && typeof line === "object"
      ? line.after ?? line.next ?? line.current ?? line.to
      : null;
  const hasDiff = before != null || after != null;

  return (
    <li key={key}>
      {summary || "Updated"}
      {hasDiff ? (
        <div className="mt-1 whitespace-pre-line rounded-md border border-[#263260] bg-[rgba(10,18,50,0.72)] px-2 py-1 text-xs text-[#9fb0dd]">
          <div className="font-medium text-[#c6d5ff]">Before:</div>
          <div>{normalizeLegacyDiff(before)}</div>
          <div className="mt-1 font-medium text-[#c6d5ff]">After:</div>
          <div>{normalizeLegacyDiff(after)}</div>
        </div>
      ) : null}
    </li>
  );
}

function formatLogTimestamp(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Review-row parsing reconstructs pending-change metadata from serialized summary keys.
function formatPendingChangeLine(line) {
  const text = asText(line);
  if (!text.startsWith("__pc__:")) return text;
  const separatorIndex = text.indexOf("::", "__pc__:".length);
  if (separatorIndex < 0) return text;
  return asText(text.slice(separatorIndex + 2));
}

function stripDishPrefixFromSummary(summary, dishName) {
  const safeSummary = asText(summary);
  const safeDishName = asText(dishName);
  if (!safeSummary || !safeDishName) return safeSummary;
  const prefix = `${safeDishName}:`;
  if (!safeSummary.toLowerCase().startsWith(prefix.toLowerCase())) {
    return safeSummary;
  }
  return asText(safeSummary.slice(prefix.length)) || safeSummary;
}

function toDiffLines(value) {
  const text = normalizeLegacyDiff(value);
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => String(line));
  return lines.length ? lines : ["None"];
}

function markChangedLines(lines, comparisonLines) {
  const comparisonCounts = new Map();
  comparisonLines.forEach((line) => {
    comparisonCounts.set(line, (comparisonCounts.get(line) || 0) + 1);
  });

  return lines.map((line) => {
    const count = comparisonCounts.get(line) || 0;
    if (count > 0) {
      comparisonCounts.set(line, count - 1);
      return { line, changed: false };
    }
    return { line, changed: true };
  });
}

function buildLegacyDiffLineItems(beforeValue, afterValue) {
  const beforeLines = toDiffLines(beforeValue);
  const afterLines = toDiffLines(afterValue);
  return {
    beforeItems: markChangedLines(beforeLines, afterLines),
    afterItems: markChangedLines(afterLines, beforeLines),
  };
}

function groupReviewRowsByDish(rows) {
  const groups = [];
  const byDish = new Map();

  (Array.isArray(rows) ? rows : []).forEach((entry) => {
    const dishName = asText(entry?.dishName) || "General changes";
    if (!byDish.has(dishName)) {
      const group = { dishName, entries: [] };
      byDish.set(dishName, group);
      groups.push(group);
    }
    byDish.get(dishName).entries.push(entry);
  });

  return groups;
}

function getReviewRowKey(entry, index, prefix = "") {
  return `${prefix}${entry?.id || entry?.sortOrder || entry?.summary || index}`;
}

function ReviewRowDiffDetails({ beforeValue, afterValue }) {
  const { beforeItems, afterItems } = buildLegacyDiffLineItems(beforeValue, afterValue);

  return (
    <div className="mt-2 rounded-md border border-[#263260] bg-[rgba(10,18,50,0.72)] px-2 py-1 text-xs">
      <div className="font-medium text-[#c6d5ff]">Before:</div>
      <div className="mt-1 space-y-0.5">
        {beforeItems.map((item, index) => (
          <div
            key={`before-line-${index}`}
            className={`whitespace-pre-wrap ${item.changed ? "text-[#ff6b6b]" : "text-[#9fb0dd]"}`}
          >
            {item.line}
          </div>
        ))}
      </div>
      <div className="mt-2 font-medium text-[#c6d5ff]">After:</div>
      <div className="mt-1 space-y-0.5">
        {afterItems.map((item, index) => (
          <div
            key={`after-line-${index}`}
            className={`whitespace-pre-wrap ${item.changed ? "text-[#ff6b6b]" : "text-[#9fb0dd]"}`}
          >
            {item.line}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewRowGroupedList({
  rows,
  expandedRows,
  onToggleRow,
  rowKeyPrefix = "",
}) {
  const groupedChanges = groupReviewRowsByDish(rows);

  return (
    <div className="space-y-2">
      {groupedChanges.map((group) => (
        <div
          key={`${rowKeyPrefix}group-${group.dishName}`}
          className="rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.75)] px-3 py-2"
        >
          <div className="text-sm font-semibold text-[#e9eefc]">{group.dishName}</div>
          <ul className="mt-1 mb-0 list-disc pl-5 text-sm text-[#dce4ff] space-y-2">
            {group.entries.map((entry, index) => {
              const rowKey = getReviewRowKey(entry, index, rowKeyPrefix);
              const hasDiff = entry.beforeValue != null || entry.afterValue != null;
              const summary =
                stripDishPrefixFromSummary(entry.summary, group.dishName) || "Change recorded";
              return (
                <li key={rowKey}>
                  <div className="flex items-center justify-between gap-2">
                    <span>{summary}</span>
                    {hasDiff ? (
                      <Button
                        size="compact"
                        variant="outline"
                        onClick={() => onToggleRow(rowKey)}
                      >
                        {expandedRows[rowKey] ? "Hide details" : "Show details"}
                      </Button>
                    ) : null}
                  </div>
                  {expandedRows[rowKey] ? (
                    <ReviewRowDiffDetails
                      beforeValue={entry.beforeValue}
                      afterValue={entry.afterValue}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Pending-change line parser recognizes synthetic keys emitted by review-row builders.
function parsePendingChangeLine(line) {
  const text = asText(line);
  if (!text.startsWith("__pc__:")) {
    return {
      key: "",
      text,
    };
  }

  const separatorIndex = text.indexOf("::", "__pc__:".length);
  if (separatorIndex < 0) {
    return {
      key: "",
      text,
    };
  }

  const encodedKey = text.slice("__pc__:".length, separatorIndex);
  let key = "";
  try {
    key = asText(decodeURIComponent(encodedKey));
  } catch {
    key = asText(encodedKey);
  }
  return {
    key,
    text: asText(text.slice(separatorIndex + 2)),
  };
}

function parseIngredientFlagChangeKey(key) {
  const text = asText(key);
  if (!text.startsWith("ingredient-flag:")) return null;
  const parts = text.split(":");
  if (parts.length !== 5) return null;
  const [, dishToken, ingredientRef, type, valueToken] = parts;
  if (!dishToken || !ingredientRef || !type || !valueToken) return null;
  if (type !== "allergen" && type !== "diet") return null;
  const numericIngredientIndex = Number(ingredientRef);
  return {
    dishToken,
    ingredientToken: /^\d+$/.test(ingredientRef) ? "" : ingredientRef,
    ingredientIndex:
      Number.isFinite(numericIngredientIndex) && numericIngredientIndex >= 0
        ? Math.floor(numericIngredientIndex)
        : null,
    type,
    valueToken,
  };
}

function parseOverlayPositionChangeKey(key) {
  const text = asText(key);
  if (!text.startsWith("overlay-position:")) return null;
  const dishToken = asText(text.slice("overlay-position:".length));
  if (!dishToken) return null;
  return { dishToken };
}

function parseAiAppliedDishToken(lineText) {
  const text = asText(lineText);
  const suffix = ": Applied AI ingredient analysis";
  if (!text.endsWith(suffix)) return "";
  const prefix = asText(text.slice(0, -suffix.length));
  const dishName = asText(prefix.split(":")[0]);
  return normalizeToken(dishName);
}

function findOverlayByDishToken(overlays, dishToken) {
  const token = normalizeToken(dishToken);
  if (!token) return null;
  return (Array.isArray(overlays) ? overlays : []).find(
    (overlay) => normalizeToken(overlay?.id || overlay?.name) === token,
  ) || null;
}

function findIngredientByToken(overlay, ingredientToken) {
  const token = normalizeToken(ingredientToken);
  if (!token) return null;
  return (Array.isArray(overlay?.ingredients) ? overlay.ingredients : []).find(
    (ingredient) => normalizeToken(ingredient?.name) === token,
  ) || null;
}

function getIngredientTokenStateForComparison({
  overlays,
  dishToken,
  ingredientToken,
  ingredientIndex,
  type,
  valueToken,
}) {
  const overlay = findOverlayByDishToken(overlays, dishToken);
  const ingredientRows = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];
  const ingredient =
    Number.isFinite(Number(ingredientIndex)) && Number(ingredientIndex) >= 0
      ? ingredientRows[Math.floor(Number(ingredientIndex))]
      : findIngredientByToken(overlay, ingredientToken);
  const containsField = type === "diet" ? "diets" : "allergens";
  const crossField =
    type === "diet" ? "crossContaminationDiets" : "crossContaminationAllergens";
  return readTokenState({
    containsValues: ingredient?.[containsField],
    crossValues: ingredient?.[crossField],
    token: valueToken,
  });
}

function replaceIngredientNameInPendingLine(lineText, ingredientName) {
  const text = asText(lineText);
  const replacement = asText(ingredientName);
  if (!text || !replacement) return text;

  const firstColon = text.indexOf(":");
  if (firstColon < 0) return text;
  const secondColon = text.indexOf(":", firstColon + 1);
  if (secondColon < 0) return text;

  const dishPart = asText(text.slice(0, firstColon));
  const tail = asText(text.slice(secondColon + 1));
  if (!dishPart || !tail) return text;
  return `${dishPart}: ${replacement}: ${tail}`;
}

function resolvePendingChangeLineForDisplay({ lineText, parsedKey, overlays }) {
  const text = asText(lineText);
  if (!text) return "";

  const ingredientFlagKey = parseIngredientFlagChangeKey(parsedKey);
  if (ingredientFlagKey?.dishToken) {
    const overlay = findOverlayByDishToken(overlays, ingredientFlagKey.dishToken);
    const ingredientRows = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];
    const latestIngredientName =
      Number.isFinite(Number(ingredientFlagKey.ingredientIndex)) &&
      Number(ingredientFlagKey.ingredientIndex) >= 0
        ? asText(ingredientRows[Math.floor(Number(ingredientFlagKey.ingredientIndex))]?.name)
        : "";
    if (latestIngredientName) {
      return replaceIngredientNameInPendingLine(text, latestIngredientName);
    }
  }

  const addedIngredientMatch = text.match(/^(.*?):\s*Added ingredient\s+Ingredient\s+(\d+)$/i);
  if (addedIngredientMatch) {
    const dishName = asText(addedIngredientMatch[1]);
    const ingredientIndex = Math.max(Number(addedIngredientMatch[2]) - 1, 0);
    const overlay = findOverlayByDishToken(overlays, dishName);
    const latestIngredientName = asText(
      (Array.isArray(overlay?.ingredients) ? overlay.ingredients : [])[ingredientIndex]?.name,
    );
    if (latestIngredientName) {
      return `${dishName}: Added ingredient ${latestIngredientName}`;
    }
  }

  return text;
}

function normalizeOverlayRectSignature(overlay) {
  if (!overlay) return "";
  return JSON.stringify({
    pageIndex: Number.isFinite(Number(overlay.pageIndex)) ? Number(overlay.pageIndex) : 0,
    x: parseOverlayNumber(overlay.x),
    y: parseOverlayNumber(overlay.y),
    w: parseOverlayNumber(overlay.w),
    h: parseOverlayNumber(overlay.h),
  });
}

function summarizeAiSelectionTokens(overlay) {
  const ingredientRows = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];
  const allergenStates = new Map();
  const dietStates = new Map();

  ingredientRows.forEach((ingredient) => {
    dedupeTokenList(ingredient?.aiDetectedAllergens).forEach((token) => {
      allergenStates.set(token, "contains");
    });
    dedupeTokenList(ingredient?.aiDetectedCrossContaminationAllergens).forEach((token) => {
      if (allergenStates.get(token) !== "contains") {
        allergenStates.set(token, "cross");
      }
    });

    dedupeTokenList(ingredient?.aiDetectedDiets).forEach((token) => {
      dietStates.set(token, "contains");
    });
    dedupeTokenList(ingredient?.aiDetectedCrossContaminationDiets).forEach((token) => {
      if (dietStates.get(token) !== "contains") {
        dietStates.set(token, "cross");
      }
    });
  });

  const formatStateList = (map) =>
    Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, state]) => `${name} (${state === "contains" ? "contains" : "cross-contamination risk"})`);

  return {
    allergens: formatStateList(allergenStates),
    diets: formatStateList(dietStates),
  };
}

// Display builders normalize configured labels while keeping unknown tokens visible.
function buildAllergenDisplay(editor, overlay) {
  const configured = Array.isArray(editor.config?.allergens)
    ? editor.config.allergens
    : [];
  const fallback = Array.isArray(overlay?.allergens) ? overlay.allergens : [];
  const union = [...configured, ...fallback];
  const seen = new Set();
  return union.filter((item) => {
    const key = asText(item);
    if (!key) return false;
    const token = normalizeToken(key);
    if (!token || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

function buildDietDisplay(editor, overlay) {
  const configured = Array.isArray(editor.config?.diets) ? editor.config.diets : [];
  const fallback = Array.isArray(overlay?.diets) ? overlay.diets : [];
  const union = [...configured, ...fallback];
  const seen = new Set();
  return union.filter((item) => {
    const key = asText(item);
    if (!key) return false;
    const token = normalizeToken(key);
    if (!token || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

function dedupeTokenList(values) {
  const output = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = asText(value);
    if (!text) return;
    const token = normalizeToken(text);
    if (!token || seen.has(token)) return;
    seen.add(token);
    output.push(text);
  });
  return output;
}

function includesToken(values, target) {
  const token = normalizeToken(target);
  if (!token) return false;
  return (Array.isArray(values) ? values : []).some(
    (value) => normalizeToken(value) === token,
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

function nextTokenState(current) {
  if (current === "none") return "contains";
  if (current === "contains") return "cross";
  return "none";
}

function getChipToneClass({ selectedState, smartState }) {
  if (selectedState === "none" && smartState === "none") return "chip-none";
  if (selectedState !== "none" && selectedState === smartState) return "chip-smart";
  return "chip-manual";
}

function getChipBorderClass(selectedState) {
  if (selectedState === "contains") return "chip-contains";
  if (selectedState === "cross") return "chip-cross";
  return "";
}

function formatTokenStateLabel(state) {
  if (state === "contains") return "contains";
  if (state === "cross") return "cross-contamination";
  return "none";
}

function normalizeBrandForSignature(brand) {
  const normalized = normalizeBrandEntry(brand);
  if (!normalized) return null;
  return {
    name: normalized.name,
    allergens: dedupeTokenList(normalized.allergens),
    diets: dedupeTokenList(normalized.diets),
    crossContaminationAllergens: dedupeTokenList(
      normalized.crossContaminationAllergens,
    ),
    crossContaminationDiets: dedupeTokenList(normalized.crossContaminationDiets),
    ingredientsList: Array.isArray(normalized.ingredientsList)
      ? normalized.ingredientsList.map((line) => asText(line)).filter(Boolean)
      : [],
  };
}

function buildPersistedIngredientSignature(ingredient) {
  const base = ingredient && typeof ingredient === "object" ? ingredient : {};
  return JSON.stringify({
    name: asText(base.name),
    allergens: dedupeTokenList(base.allergens),
    diets: dedupeTokenList(base.diets),
    crossContaminationAllergens: dedupeTokenList(base.crossContaminationAllergens),
    crossContaminationDiets: dedupeTokenList(base.crossContaminationDiets),
    brands: (Array.isArray(base.brands) ? base.brands : [])
      .map((brand) => normalizeBrandForSignature(brand))
      .filter(Boolean),
    brandRequired: Boolean(base.brandRequired),
    brandRequirementReason: asText(base.brandRequirementReason),
    removable: Boolean(base.removable),
  });
}

function buildRowManualOverrideMessages({
  ingredient,
  allergens,
  diets,
  formatAllergenLabel,
  formatDietLabel,
}) {
  const allergenTokens = dedupeTokenList([
    ...(Array.isArray(allergens) ? allergens : []),
    ...(Array.isArray(ingredient?.allergens) ? ingredient.allergens : []),
    ...(Array.isArray(ingredient?.crossContaminationAllergens)
      ? ingredient.crossContaminationAllergens
      : []),
    ...(Array.isArray(ingredient?.aiDetectedAllergens)
      ? ingredient.aiDetectedAllergens
      : []),
    ...(Array.isArray(ingredient?.aiDetectedCrossContaminationAllergens)
      ? ingredient.aiDetectedCrossContaminationAllergens
      : []),
  ]);
  const dietTokens = dedupeTokenList([
    ...(Array.isArray(diets) ? diets : []),
    ...(Array.isArray(ingredient?.diets) ? ingredient.diets : []),
    ...(Array.isArray(ingredient?.crossContaminationDiets)
      ? ingredient.crossContaminationDiets
      : []),
    ...(Array.isArray(ingredient?.aiDetectedDiets) ? ingredient.aiDetectedDiets : []),
    ...(Array.isArray(ingredient?.aiDetectedCrossContaminationDiets)
      ? ingredient.aiDetectedCrossContaminationDiets
      : []),
  ]);

  const messages = [];

  allergenTokens.forEach((token) => {
    const selectedState = readTokenState({
      containsValues: ingredient?.allergens,
      crossValues: ingredient?.crossContaminationAllergens,
      token,
    });
    const smartState = readTokenState({
      containsValues: ingredient?.aiDetectedAllergens,
      crossValues: ingredient?.aiDetectedCrossContaminationAllergens,
      token,
    });
    if (selectedState === smartState) return;
    messages.push(
      `Manual override: ${formatAllergenLabel(token)} is currently ${formatTokenStateLabel(selectedState)} (smart: ${formatTokenStateLabel(smartState)})`,
    );
  });

  dietTokens.forEach((token) => {
    const selectedState = readTokenState({
      containsValues: ingredient?.diets,
      crossValues: ingredient?.crossContaminationDiets,
      token,
    });
    const smartState = readTokenState({
      containsValues: ingredient?.aiDetectedDiets,
      crossValues: ingredient?.aiDetectedCrossContaminationDiets,
      token,
    });
    if (selectedState === smartState) return;
    messages.push(
      `Manual override: ${formatDietLabel(token)} is currently ${formatTokenStateLabel(selectedState)} (smart: ${formatTokenStateLabel(smartState)})`,
    );
  });

  return dedupeTokenList(messages);
}

function buildRowConflictMessages({
  ingredient,
  allergens,
  diets,
  getDietAllergenConflicts,
  formatAllergenLabel,
  formatDietLabel,
}) {
  if (typeof getDietAllergenConflicts !== "function") return [];

  const selectedAllergenEntries = dedupeTokenList([
    ...(Array.isArray(allergens) ? allergens : []),
    ...(Array.isArray(ingredient?.allergens) ? ingredient.allergens : []),
    ...(Array.isArray(ingredient?.crossContaminationAllergens)
      ? ingredient.crossContaminationAllergens
      : []),
  ])
    .map((token) => {
      const state = readTokenState({
        containsValues: ingredient?.allergens,
        crossValues: ingredient?.crossContaminationAllergens,
        token,
      });
      return {
        token,
        state,
      };
    })
    .filter((entry) => entry.state !== "none");

  const selectedDietEntries = dedupeTokenList([
    ...(Array.isArray(diets) ? diets : []),
    ...(Array.isArray(ingredient?.diets) ? ingredient.diets : []),
    ...(Array.isArray(ingredient?.crossContaminationDiets)
      ? ingredient.crossContaminationDiets
      : []),
  ])
    .map((token) => {
      const state = readTokenState({
        containsValues: ingredient?.diets,
        crossValues: ingredient?.crossContaminationDiets,
        token,
      });
      return {
        token,
        state,
      };
    })
    .filter((entry) => entry.state !== "none");

  const resolveSelectedAllergenState = (target) => {
    const targetToken = normalizeToken(target);
    if (!targetToken) return "none";
    for (const entry of selectedAllergenEntries) {
      if (normalizeToken(entry.token) === targetToken) {
        return entry.state;
      }
    }
    return "none";
  };

  const messages = [];
  selectedDietEntries.forEach(({ token: diet, state: dietState }) => {
    const conflicts = dedupeTokenList(getDietAllergenConflicts(diet));
    conflicts.forEach((allergen) => {
      const allergenState = resolveSelectedAllergenState(allergen);
      if (allergenState === "none") return;

      const formattedDiet = formatDietLabel(diet);
      const formattedAllergen = formatAllergenLabel(allergen);
      if (dietState === "contains" && allergenState === "contains") {
        messages.push(
          `Conflict warning: ${formattedDiet} conflicts with ${formattedAllergen} because both are marked as contains.`,
        );
        return;
      }

      messages.push(
        `Cross-contamination warning: ${formattedDiet} may be compromised by ${formattedAllergen} (${formatTokenStateLabel(dietState)} diet selection and ${formatTokenStateLabel(allergenState)} allergen risk).`,
      );
    });
  });

  return dedupeTokenList(messages);
}

// Ingredient and brand normalizers guarantee a stable shape before state comparisons.
function normalizePreviewOptions(values, { formatLabel, getEmoji }) {
  return dedupeTokenList(values).map((value) => ({
    key: value,
    label: formatLabel(value),
    emoji: getEmoji(value),
  }));
}

function normalizeBrandEntry(brand) {
  const base = brand && typeof brand === "object" ? brand : {};
  const name = asText(base.name || base.productName);
  if (!name) return null;
  return {
    ...base,
    name,
    allergens: dedupeTokenList(base.allergens),
    diets: dedupeTokenList(base.diets),
    crossContaminationAllergens: dedupeTokenList(base.crossContaminationAllergens),
    crossContaminationDiets: dedupeTokenList(base.crossContaminationDiets),
    ingredientsList: Array.isArray(base.ingredientsList)
      ? base.ingredientsList.map((line) => asText(line)).filter(Boolean)
      : [],
  };
}

function normalizeIngredientEntry(ingredient, index) {
  const base = ingredient && typeof ingredient === "object" ? ingredient : {};
  const rawName =
    typeof base.name === "string"
      ? base.name
      : base.name == null
        ? ""
        : String(base.name);
  const normalizedName = rawName.trim() ? rawName : `Ingredient ${index + 1}`;
  const normalizedBrands = (Array.isArray(base.brands) ? base.brands : [])
    .map((brand) => normalizeBrandEntry(brand))
    .filter(Boolean);
  const firstBrand = normalizedBrands[0] || null;
  return {
    ...base,
    name: normalizedName,
    allergens: dedupeTokenList(base.allergens),
    diets: dedupeTokenList(base.diets),
    crossContaminationAllergens: dedupeTokenList(base.crossContaminationAllergens),
    crossContaminationDiets: dedupeTokenList(base.crossContaminationDiets),
    aiDetectedAllergens: dedupeTokenList(base.aiDetectedAllergens),
    aiDetectedDiets: dedupeTokenList(base.aiDetectedDiets),
    aiDetectedCrossContaminationAllergens: dedupeTokenList(
      base.aiDetectedCrossContaminationAllergens,
    ),
    aiDetectedCrossContaminationDiets: dedupeTokenList(
      base.aiDetectedCrossContaminationDiets,
    ),
    brands: firstBrand ? [firstBrand] : [],
    brandRequired: Boolean(base.brandRequired),
    brandRequirementReason: asText(base.brandRequirementReason),
    removable: Boolean(base.removable),
    confirmed: base.confirmed === true,
    contains: true,
  };
}

function computeIngredientDietBlockers(ingredients, diets) {
  const rows = Array.isArray(ingredients) ? ingredients : [];
  const list = dedupeTokenList(diets);
  const output = {};

  list.forEach((diet) => {
    const blockers = rows
      .filter((ingredient) => !includesToken(ingredient?.diets, diet))
      .map((ingredient) => ({
        ingredient: asText(ingredient?.name) || "Ingredient",
        removable: Boolean(ingredient?.removable),
      }));
    if (blockers.length) output[diet] = blockers;
  });

  return output;
}

// Dish-state derivation is the canonical reducer for ingredients -> allergens/diets/details.
function deriveDishStateFromIngredients({
  ingredients,
  existingDetails,
  configuredDiets,
}) {
  const rows = (Array.isArray(ingredients) ? ingredients : []).map((ingredient, index) =>
    normalizeIngredientEntry(ingredient, index),
  );
  const details =
    existingDetails && typeof existingDetails === "object" ? existingDetails : {};
  const nextDetails = { ...details };

  const allergenMap = new Map();
  const crossAllergenSet = new Set();
  const crossDietSet = new Set();
  const contributingRows = rows;

  rows.forEach((ingredient) => {
    const ingredientName = asText(ingredient?.name) || "Ingredient";
    dedupeTokenList(ingredient?.allergens).forEach((allergen) => {
      const token = normalizeToken(allergen);
      if (!token) return;
      const current = allergenMap.get(token) || {
        label: allergen,
        items: [],
        removableFlags: [],
      };
      current.items.push(ingredientName);
      current.removableFlags.push(Boolean(ingredient?.removable));
      allergenMap.set(token, current);
    });
    dedupeTokenList(ingredient?.crossContaminationAllergens).forEach((allergen) => {
      crossAllergenSet.add(allergen);
    });
    dedupeTokenList(ingredient?.crossContaminationDiets).forEach((diet) => {
      crossDietSet.add(diet);
    });
  });

  const allergens = Array.from(allergenMap.values()).map((entry) => entry.label);
  const removable = [];
  allergenMap.forEach((entry) => {
    const uniqueItems = dedupeTokenList(entry.items);
    nextDetails[entry.label] = `Contains ${uniqueItems.join(", ")}`;
    const allContributingRowsRemovable =
      entry.removableFlags.length > 0 && entry.removableFlags.every(Boolean);
    if (allContributingRowsRemovable) {
      removable.push({
        allergen: entry.label,
        component: uniqueItems.join(", "),
      });
    }
  });

  const candidateDiets = dedupeTokenList([
    ...(Array.isArray(configuredDiets) ? configuredDiets : []),
    ...contributingRows.flatMap((ingredient) => ingredient?.diets || []),
  ]);

  const diets = contributingRows.length
    ? candidateDiets.filter((diet) =>
        contributingRows.every(
          (ingredient) => includesToken(ingredient?.diets, diet),
        ),
      )
    : [];

  return {
    ingredients: rows,
    allergens,
    diets,
    details: nextDetails,
    removable,
    crossContaminationAllergens: Array.from(crossAllergenSet),
    crossContaminationDiets: Array.from(crossDietSet),
    ingredientsBlockingDiets: computeIngredientDietBlockers(
      contributingRows,
      candidateDiets,
    ),
  };
}


export {
  clamp,
  asText,
  normalizeToken,
  parseOverlayNumber,
  fileToDataUrl,
  normalizePageIndexList,
  remapPageIndexListForMove,
  remapPageIndexListForRemove,
  parseChangePayload,
  collectRenderedChangeSummaryTokens,
  formatChangeText,
  renderChangeLine,
  formatLogTimestamp,
  ReviewRowGroupedList,
  buildAllergenDisplay,
  buildDietDisplay,
  dedupeTokenList,
  readTokenState,
  nextTokenState,
  getChipToneClass,
  getChipBorderClass,
  buildPersistedIngredientSignature,
  buildRowManualOverrideMessages,
  buildRowConflictMessages,
  normalizePreviewOptions,
  normalizeBrandEntry,
  normalizeIngredientEntry,
  deriveDishStateFromIngredients,
};
