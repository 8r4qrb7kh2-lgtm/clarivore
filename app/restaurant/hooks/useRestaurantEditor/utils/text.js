// Basic text and numeric helpers shared across the editor modules.
// These helpers intentionally stay tiny and predictable.

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function asText(value) {
  return String(value || "").trim();
}

export function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeLegacyMatchKey(value) {
  return asText(value).toLowerCase().replace(/\s+/g, " ");
}

export function normalizeCoordSpace(value) {
  const token = normalizeToken(value);
  if (!token) return "";
  if (token === "ratio" || token.includes("normalizedratio")) return "ratio";
  if (token === "percent" || token === "percentage" || token.includes("pct")) return "percent";
  if (token === "pixel" || token === "pixels" || token === "px") return "pixels";
  if (token === "thousand" || token.includes("thousand")) return "thousand";
  return "";
}

export function dedupeTokenList(values) {
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
