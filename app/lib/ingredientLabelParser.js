function asText(value) {
  return String(value ?? "").trim();
}

function normalizeSpaces(value) {
  return asText(value).replace(/\s+/g, " ").trim();
}

function normalizeWordToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const STOP_PREFIXES = [
  "contains 2% or less of",
  "contains less than 2% of",
  "one or more of the following",
  "less than 2% of",
  "2% or less of",
  "allergen information",
  "ingredients",
  "ingredient",
  "made with",
];

const DECLARATION_PATTERNS = [
  {
    declarationType: "contains",
    riskType: "contained",
    regex:
      /\bcontains one or more of the following\b\s*[:\-]?\s*([^.;]+)/gi,
  },
  {
    declarationType: "may-contain",
    riskType: "cross-contamination",
    regex: /\bmay contain\b\s*[:\-]?\s*([^.;]+)/gi,
  },
  {
    declarationType: "traces-of",
    riskType: "cross-contamination",
    regex: /\btraces of\b\s*[:\-]?\s*([^.;]+)/gi,
  },
  {
    declarationType: "facility",
    riskType: "cross-contamination",
    regex:
      /\bprocessed in a facility(?: that)? (?:also )?(?:processes|handles)\b\s*[:\-]?\s*([^.;]+)/gi,
  },
  {
    declarationType: "shared-equipment",
    riskType: "cross-contamination",
    regex:
      /\bmanufactured on shared equipment with\b\s*[:\-]?\s*([^.;]+)/gi,
  },
  {
    declarationType: "shared-equipment",
    riskType: "cross-contamination",
    regex: /\bshared equipment with\b\s*[:\-]?\s*([^.;]+)/gi,
  },
  {
    declarationType: "shared-line",
    riskType: "cross-contamination",
    regex: /\bshared line with\b\s*[:\-]?\s*([^.;]+)/gi,
  },
  {
    declarationType: "contains",
    riskType: "contained",
    regex: /\bcontains\b\s*[:\-]?\s*([^.;]+)/gi,
  },
];

const QUANTIFIED_CONTAINS_PREFIX_RE =
  /^contains\s+(?:(?:less than\s+)?\d+%\s+of|\d+%\s+or\s+less\s+of)\b/i;

function trimOuterPunctuation(value) {
  return asText(value).replace(/^[\s.,;:[\]{}-]+|[\s.,;:[\]{}-]+$/g, "").trim();
}

function buildTranscriptWords(transcriptLines) {
  const normalizedLines = (Array.isArray(transcriptLines) ? transcriptLines : [])
    .map((line) => normalizeSpaces(line))
    .filter(Boolean);

  const words = [];
  let joinedText = "";
  normalizedLines.forEach((line, lineIndex) => {
    line.split(/\s+/).filter(Boolean).forEach((token, tokenIndex) => {
      if (joinedText) joinedText += " ";
      const start = joinedText.length;
      joinedText += token;
      words.push({
        index: words.length,
        text: token,
        lineIndex,
        tokenIndex,
        start,
        end: joinedText.length,
      });
    });
  });

  return {
    normalizedLines,
    words,
    joinedText,
  };
}

function buildIndexedWordList(words) {
  return (Array.isArray(words) ? words : [])
    .map((word) => `${Number(word?.index) || 0}: "${asText(word?.text)}"`)
    .join("\n");
}

function findWordIndicesForRange(words, start, end) {
  return (Array.isArray(words) ? words : [])
    .filter((word) => Number(word?.start) < end && Number(word?.end) > start)
    .map((word) => Number(word?.index))
    .filter((index) => Number.isFinite(index))
    .sort((left, right) => left - right);
}

function splitTopLevelRanges(text, { splitOnAnd = false } = {}) {
  const safeText = String(text ?? "");
  const parts = [];
  let start = 0;
  let depth = 0;
  const lower = safeText.toLowerCase();

  const pushRange = (end) => {
    const next = safeText.slice(start, end);
    if (next.trim()) {
      parts.push({ start, end, text: next });
    }
  };

  for (let index = 0; index < safeText.length; index += 1) {
    const ch = safeText[index];
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")" && depth > 0) {
      depth -= 1;
      continue;
    }

    if (depth === 0 && (ch === "," || ch === ";")) {
      pushRange(index);
      start = index + 1;
      continue;
    }

    if (
      splitOnAnd &&
      depth === 0 &&
      lower.startsWith(" and ", index)
    ) {
      pushRange(index);
      start = index + 5;
      index += 4;
    }
  }

  pushRange(safeText.length);
  return parts;
}

function stripLeadingPrefixWords(words, indices) {
  const safeIndices = Array.isArray(indices) ? [...indices] : [];
  if (!safeIndices.length) return safeIndices;

  const normalizedTokens = safeIndices.map((index) =>
    normalizeWordToken(words[index]?.text),
  );

  for (const prefix of STOP_PREFIXES) {
    const prefixTokens = prefix.split(" ").map(normalizeWordToken).filter(Boolean);
    if (!prefixTokens.length || prefixTokens.length > normalizedTokens.length) continue;
    let matches = true;
    for (let index = 0; index < prefixTokens.length; index += 1) {
      if (normalizedTokens[index] !== prefixTokens[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return safeIndices.slice(prefixTokens.length);
    }
  }

  if (normalizedTokens[0] === "and") {
    return safeIndices.slice(1);
  }

  return safeIndices;
}

function candidateTextFromWordIndices(words, indices) {
  const tokens = (Array.isArray(indices) ? indices : [])
    .map((index) => asText(words[index]?.text))
    .filter(Boolean);
  return trimOuterPunctuation(tokens.join(" "));
}

function buildDirectCandidates(words, joinedText, declarationRanges) {
  const candidates = [];
  const safeRanges = Array.isArray(declarationRanges) ? declarationRanges : [];
  let declarationIndex = 0;
  let currentStart = 0;
  let depth = 0;

  const flushSegment = (end) => {
    if (end <= currentStart) {
      currentStart = Math.max(currentStart, end);
      return;
    }
    const wordIndices = stripLeadingPrefixWords(
      words,
      findWordIndicesForRange(words, currentStart, end),
    );
    const text = candidateTextFromWordIndices(words, wordIndices);
    if (!text || !wordIndices.length) {
      currentStart = end;
      return;
    }
    candidates.push({
      id: `direct:${candidates.length}`,
      kind: "direct",
      riskType: "contained",
      text,
      wordIndices,
    });
    currentStart = end;
  };

  for (let index = 0; index < joinedText.length; index += 1) {
    const nextDeclaration = safeRanges[declarationIndex] || null;
    if (nextDeclaration && index === nextDeclaration.start) {
      flushSegment(index);
      currentStart = nextDeclaration.end;
      index = nextDeclaration.end - 1;
      declarationIndex += 1;
      continue;
    }

    const ch = joinedText[index];
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")" && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth === 0 && (ch === "," || ch === ";")) {
      flushSegment(index);
      currentStart = index + 1;
    }
  }

  flushSegment(joinedText.length);
  return candidates;
}

function findDeclarationRanges(joinedText) {
  const matches = [];

  DECLARATION_PATTERNS.forEach((pattern) => {
    let match;
    while ((match = pattern.regex.exec(joinedText))) {
      const content = asText(match[1]);
      if (!content) continue;
      const fullText = asText(match[0]);
      if (QUANTIFIED_CONTAINS_PREFIX_RE.test(fullText)) continue;
      const start = Number(match.index) || 0;
      const matchedEnd = start + fullText.length;
      let end = matchedEnd;
      while (end < joinedText.length && /[\s.,;:()-]/.test(joinedText[end])) {
        end += 1;
      }
      const contentStart = matchedEnd - content.length;
      matches.push({
        declarationType: pattern.declarationType,
        riskType: pattern.riskType,
        start,
        end,
        contentStart,
        contentEnd: end,
        text: fullText,
      });
    }
  });

  matches.sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    return right.end - left.end;
  });

  const filtered = [];
  let lastEnd = -1;
  matches.forEach((match) => {
    if (match.start < lastEnd) return;
    filtered.push(match);
    lastEnd = match.end;
  });
  return filtered;
}

function buildDeclarationCandidates(words, declarationRanges, joinedText) {
  const candidates = [];
  (Array.isArray(declarationRanges) ? declarationRanges : []).forEach((range) => {
    const contentText = joinedText.slice(range.contentStart, range.contentEnd);
    const parts = splitTopLevelRanges(contentText, { splitOnAnd: true });
    parts.forEach((part) => {
      const globalStart = range.contentStart + part.start;
      const globalEnd = range.contentStart + part.end;
      const wordIndices = findWordIndicesForRange(words, globalStart, globalEnd);
      const text = candidateTextFromWordIndices(words, wordIndices);
      if (!text || !wordIndices.length) return;
      candidates.push({
        id: `declaration:${candidates.length}`,
        kind: "declaration",
        declarationType: range.declarationType,
        riskType: range.riskType,
        text,
        wordIndices,
      });
    });
  });
  return candidates;
}

export function parseIngredientLabelTranscript(transcriptLines) {
  const { normalizedLines, words, joinedText } = buildTranscriptWords(transcriptLines);
  const declarationRanges = findDeclarationRanges(joinedText);
  const directCandidates = buildDirectCandidates(words, joinedText, declarationRanges);
  const declarationCandidates = buildDeclarationCandidates(
    words,
    declarationRanges,
    joinedText,
  );

  return {
    transcriptLines: normalizedLines,
    joinedText,
    words,
    indexedWordList: buildIndexedWordList(words),
    directCandidates,
    declarationCandidates,
    parsedIngredientsList: directCandidates.map((candidate) => candidate.text),
  };
}

export const __test = {
  buildTranscriptWords,
  buildIndexedWordList,
  buildDirectCandidates,
  buildDeclarationCandidates,
  findDeclarationRanges,
  splitTopLevelRanges,
  stripLeadingPrefixWords,
  QUANTIFIED_CONTAINS_PREFIX_RE,
};
