import { asText, dedupeTokenList, normalizeToken } from "./text";

// Canonicalization helpers keep allergen/diet inputs stable across old and new payloads.
// The goal is to map many text variants to one predictable value.

export function buildCanonicalTokenLookup(values) {
  // Build a token -> original label map for fast canonical lookups.
  // First value wins so the UI label stays stable.
  const map = new Map();

  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = asText(value);
    if (!text) return;

    const token = normalizeToken(text);
    if (!token || map.has(token)) return;

    map.set(token, text);
  });

  return map;
}

export function findDietAlias(token, lookup) {
  // Support common shorthand/typo aliases that are not exact token matches.
  if (!token || !(lookup instanceof Map) || !lookup.size) return "";
  const entries = Array.from(lookup.entries());

  if (
    token === "gf" ||
    token.includes("glutenfree") ||
    token.includes("nogluten") ||
    token.includes("glutenless") ||
    token.includes("withoutgluten") ||
    token.includes("freefromgluten")
  ) {
    const matched = entries.find(([dietToken]) => dietToken.includes("glutenfree"));
    return matched?.[1] || "";
  }

  if (token === "pescetarian") {
    const matched = entries.find(([dietToken]) => dietToken.includes("pescatarian"));
    return matched?.[1] || "";
  }

  return "";
}

export function resolveCanonicalValue(value, options = {}) {
  // Resolve a user-facing value into a known canonical label.
  // Resolution order: strict normalizer -> direct token lookup -> alias resolver.
  const text = asText(value);
  if (!text) return "";

  const {
    strictNormalizer,
    tokenLookup,
    aliasResolver,
  } = options;

  // First preference: app-specific normalizer from config.
  if (typeof strictNormalizer === "function") {
    const strictValue = asText(strictNormalizer(text));
    if (strictValue) return strictValue;
  }

  // Second preference: direct token lookup.
  const token = normalizeToken(text);
  if (!token) return "";
  if (tokenLookup instanceof Map && tokenLookup.has(token)) {
    return tokenLookup.get(token) || "";
  }

  // Last preference: alias mapping for known shorthand terms.
  if (typeof aliasResolver === "function") {
    const alias = asText(aliasResolver(token));
    if (alias) return alias;
  }

  return "";
}

export function normalizeCanonicalList(values, resolveValue) {
  // Normalize each entry, drop unknown values, then deduplicate.
  const list = (Array.isArray(values) ? values : [])
    .map((value) => resolveValue(value))
    .filter(Boolean);
  return dedupeTokenList(list);
}
