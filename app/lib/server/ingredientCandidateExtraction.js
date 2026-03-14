import { parseIngredientLabelTranscript } from "../ingredientLabelParser.js";

const DECLARATION_TYPES = new Set([
  "contains",
  "may-contain",
  "traces-of",
  "facility",
  "shared-equipment",
  "shared-line",
]);

const RISK_TYPES = new Set(["contained", "cross-contamination"]);

function asText(value) {
  return String(value ?? "").trim();
}

function trimOuterPunctuation(value) {
  return asText(value).replace(/^[\s.,;:[\]{}-]+|[\s.,;:[\]{}-]+$/g, "").trim();
}

function canonicalToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function singularizeToken(value) {
  const token = canonicalToken(value);
  if (!token) return "";
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("us") &&
    !token.endsWith("is")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

function tokensEquivalent(left, right) {
  const a = canonicalToken(left);
  const b = canonicalToken(right);
  if (!a || !b) return false;
  return a === b || singularizeToken(a) === singularizeToken(b);
}

function tokenizeText(value) {
  return asText(value)
    .split(/[^A-Za-z0-9]+/)
    .map((token) => canonicalToken(token))
    .filter(Boolean);
}

function sanitizeWordIndices(indices, wordCount) {
  const seen = new Set();
  return (Array.isArray(indices) ? indices : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value < wordCount)
    .sort((left, right) => left - right)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function validateWordIndices(words, text, indices) {
  const safeIndices = sanitizeWordIndices(indices, Array.isArray(words) ? words.length : 0);
  const phraseTokens = tokenizeText(text);
  if (!phraseTokens.length || phraseTokens.length !== safeIndices.length) return false;

  const wordTokens = safeIndices
    .map((index) => canonicalToken(words[index]?.text))
    .filter(Boolean);
  if (wordTokens.length !== phraseTokens.length) return false;

  return wordTokens.every((token, index) => tokensEquivalent(token, phraseTokens[index]));
}

function findWordIndicesForText(words, text, usedIndices = new Set()) {
  const phraseTokens = tokenizeText(text);
  if (!phraseTokens.length) return [];

  const wordTokens = (Array.isArray(words) ? words : []).map((word) => canonicalToken(word?.text));
  let bestMatch = [];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let start = 0; start < wordTokens.length; start += 1) {
    if (!tokensEquivalent(wordTokens[start], phraseTokens[0])) continue;
    if (usedIndices.has(start)) continue;

    const matched = [start];
    let cursor = start + 1;
    let failed = false;

    for (let tokenIndex = 1; tokenIndex < phraseTokens.length; tokenIndex += 1) {
      while (cursor < wordTokens.length && usedIndices.has(cursor)) {
        cursor += 1;
      }
      if (cursor >= wordTokens.length) {
        failed = true;
        break;
      }
      if (!tokensEquivalent(wordTokens[cursor], phraseTokens[tokenIndex])) {
        failed = true;
        break;
      }
      matched.push(cursor);
      cursor += 1;
    }

    if (failed || matched.length !== phraseTokens.length) continue;

    const span = matched[matched.length - 1] - matched[0];
    const contiguousBonus = span === matched.length - 1 ? 10 : 0;
    const score = contiguousBonus - matched[0] * 0.001;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = matched;
    }
  }

  return bestMatch;
}

export function normalizeDirectIngredients(value) {
  const list = Array.isArray(value?.direct_ingredients)
    ? value.direct_ingredients
    : Array.isArray(value?.directIngredients)
      ? value.directIngredients
      : [];
  return list;
}

export function normalizeDeclarationCandidates(value) {
  const list = Array.isArray(value?.declaration_candidates)
    ? value.declaration_candidates
    : Array.isArray(value?.declarationCandidates)
      ? value.declarationCandidates
      : [];
  return list;
}

export function normalizeCandidateExtractionPayload(value) {
  if (!value || typeof value !== "object") return null;

  const source =
    value?.value && typeof value.value === "object" && !Array.isArray(value.value)
      ? value.value
      : value;
  const hasKnownKey =
    Object.prototype.hasOwnProperty.call(source, "direct_ingredients") ||
    Object.prototype.hasOwnProperty.call(source, "directIngredients") ||
    Object.prototype.hasOwnProperty.call(source, "declaration_candidates") ||
    Object.prototype.hasOwnProperty.call(source, "declarationCandidates");

  if (!hasKnownKey) return null;

  return {
    direct_ingredients: normalizeDirectIngredients(source),
    declaration_candidates: normalizeDeclarationCandidates(source),
  };
}

function createDirectCandidate(item, index, words, usedIndices) {
  const text = trimOuterPunctuation(
    typeof item === "string" ? item : item?.text || item?.ingredient,
  );
  if (!text) return null;

  const proposedIndices = sanitizeWordIndices(
    typeof item === "object" ? item?.word_indices || item?.wordIndices : [],
    words.length,
  );
  const wordIndices = validateWordIndices(words, text, proposedIndices)
    ? proposedIndices
    : findWordIndicesForText(words, text, usedIndices);
  wordIndices.forEach((value) => usedIndices.add(value));

  return {
    id: `direct:${index}`,
    kind: "direct",
    riskType: "contained",
    text,
    wordIndices,
  };
}

function normalizeDeclarationType(value) {
  const type = asText(value).toLowerCase();
  return DECLARATION_TYPES.has(type) ? type : "";
}

function normalizeRiskType(value) {
  const type = asText(value).toLowerCase();
  return RISK_TYPES.has(type) ? type : "cross-contamination";
}

function createDeclarationCandidate(item, index, words, usedIndices) {
  const text = trimOuterPunctuation(
    typeof item === "string" ? item : item?.text || item?.ingredient,
  );
  if (!text) return null;

  const proposedIndices = sanitizeWordIndices(
    typeof item === "object" ? item?.word_indices || item?.wordIndices : [],
    words.length,
  );
  const wordIndices = validateWordIndices(words, text, proposedIndices)
    ? proposedIndices
    : findWordIndicesForText(words, text, usedIndices);
  wordIndices.forEach((value) => usedIndices.add(value));

  return {
    id: `declaration:${index}`,
    kind: "declaration",
    declarationType: normalizeDeclarationType(item?.declaration_type || item?.declarationType),
    riskType: normalizeRiskType(item?.risk_type || item?.riskType),
    text,
    wordIndices,
  };
}

function dedupeCandidates(candidates, kind) {
  const out = [];
  const seen = new Set();

  (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    if (!candidate) return;
    const key = [
      kind,
      canonicalToken(candidate.text),
      asText(candidate.riskType),
      asText(candidate.declarationType),
    ].join(":");
    if (!candidate.text || seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  });

  return out.map((candidate, index) => ({
    ...candidate,
    id: `${kind === "direct" ? "direct" : "declaration"}:${index}`,
  }));
}

export function buildParsedTranscriptFromCandidateExtraction({
  transcriptLines,
  extractionPayload,
  fallbackParsedTranscript,
}) {
  const fallback = fallbackParsedTranscript || parseIngredientLabelTranscript(transcriptLines);
  const words = Array.isArray(fallback?.words) ? fallback.words : [];
  const directUsedIndices = new Set();
  const declarationUsedIndices = new Set();

  const directCandidates = dedupeCandidates(
    normalizeDirectIngredients(extractionPayload).map((item, index) =>
      createDirectCandidate(item, index, words, directUsedIndices),
    ),
    "direct",
  );

  const declarationCandidates = dedupeCandidates(
    normalizeDeclarationCandidates(extractionPayload).map((item, index) =>
      createDeclarationCandidate(item, index, words, declarationUsedIndices),
    ),
    "declaration",
  );

  return {
    ...fallback,
    directCandidates,
    declarationCandidates,
    parsedIngredientsList: directCandidates.map((candidate) => candidate.text),
    extractionMethod: "ai",
  };
}
