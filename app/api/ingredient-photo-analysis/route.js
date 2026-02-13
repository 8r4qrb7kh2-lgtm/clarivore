import { corsJson, corsOptions } from "../_shared/cors";

export const runtime = "nodejs";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

export function OPTIONS() {
  return corsOptions();
}

function asText(value) {
  return String(value ?? "").trim();
}

function readFirstEnv(names) {
  const keys = Array.isArray(names) ? names : [];
  for (const name of keys) {
    const key = asText(name);
    if (!key) continue;
    const value = asText(process.env[key]);
    if (value) return value;
  }
  return "";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseImageData(imageData) {
  const value = asText(imageData);
  if (!value.startsWith("data:") || !value.includes(",")) return null;
  const [header, base64Data] = value.split(",", 2);
  const mediaType = asText(header.split(";")[0]?.replace("data:", "")) || "image/jpeg";
  if (!base64Data) return null;
  return {
    mediaType,
    base64Data,
  };
}

function pickTextBlock(content) {
  const blocks = Array.isArray(content) ? content : [];
  const textBlock = blocks.find(
    (block) => block?.type === "text" || block?.type === "output_text",
  );
  return asText(textBlock?.text);
}

function parseJsonObject(text) {
  const value = asText(text);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      try {
        return JSON.parse(fencedMatch[1]);
      } catch {
        return null;
      }
    }
    const objectMatch = value.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }
}

function parseJsonArray(text) {
  const value = asText(text);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      try {
        const parsed = JSON.parse(fencedMatch[1]);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    const arrayMatch = value.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return [];
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

function normalizeConfidence(value) {
  const raw = asText(value).toLowerCase();
  if (["low", "medium", "high"].includes(raw)) return raw;
  return "low";
}

function normalizeQualityAssessment(raw) {
  const acceptRaw = raw?.accept;
  const needsRetake = raw?.needs_retake === true;
  let accept =
    acceptRaw === false || acceptRaw === "false" || needsRetake ? false : true;
  let confidence =
    typeof raw?.confidence === "string" ? raw.confidence.toLowerCase() : null;
  if (!["low", "medium", "high"].includes(confidence || "")) {
    confidence = null;
  }
  const reasons = Array.isArray(raw?.reasons)
    ? raw.reasons
        .map((reason) => asText(reason))
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const warnings = Array.isArray(raw?.warnings)
    ? raw.warnings
        .map((warning) => asText(warning))
        .filter(Boolean)
        .slice(0, 6)
    : [];
  let message = asText(raw?.message);

  if (accept && confidence !== "high") {
    accept = false;
    if (!reasons.length) {
      reasons.push("quality confidence not high");
    }
  }

  if (!accept && !message) {
    const issueText = reasons.length ? ` Issues: ${reasons.join("; ")}.` : "";
    message =
      "Photo quality is too low to read the ingredients confidently." +
      issueText +
      " Please retake the photo: fill the frame with the full ingredient list, keep it in focus, and avoid glare or shadows.";
  }

  const warningMessage = warnings.length
    ? `Warning: ${warnings.join("; ")}. Consider retaking the photo for best results.`
    : "";

  return {
    accept,
    confidence,
    reasons,
    warnings,
    message,
    warningMessage,
  };
}

async function callAnthropicImage({
  apiKey,
  model,
  mediaType,
  base64Data,
  systemPrompt,
  userPrompt,
  maxTokens = 4096,
}) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: asText(model) || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: "text",
              text: userPrompt,
            },
          ],
        },
      ],
    }),
  });

  const payloadText = await response.text();
  let payload = null;
  try {
    payload = payloadText ? JSON.parse(payloadText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      asText(payload?.error?.message) ||
      asText(payload?.error) ||
      asText(payloadText) ||
      "Anthropic API request failed.";
    throw new Error(message);
  }

  return pickTextBlock(payload?.content);
}

async function callAnthropicText({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  maxTokens = 1600,
}) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: asText(model) || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: userPrompt,
            },
          ],
        },
      ],
    }),
  });

  const payloadText = await response.text();
  let payload = null;
  try {
    payload = payloadText ? JSON.parse(payloadText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      asText(payload?.error?.message) ||
      asText(payload?.error) ||
      asText(payloadText) ||
      "Anthropic API request failed.";
    throw new Error(message);
  }

  return pickTextBlock(payload?.content);
}

async function getVisionWords({ googleVisionApiKey, base64Data }) {
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(
      googleVisionApiKey,
    )}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64Data },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          },
        ],
      }),
    },
  );

  const payloadText = await response.text();
  const payload = payloadText ? JSON.parse(payloadText) : {};
  if (!response.ok) {
    const message =
      asText(payload?.error?.message) ||
      asText(payload?.error) ||
      "Google Vision OCR request failed.";
    throw new Error(message);
  }

  const annotation = payload?.responses?.[0]?.fullTextAnnotation;
  const firstPage = annotation?.pages?.[0] || {};
  const pageWidth =
    Number.isFinite(Number(firstPage?.width)) && Number(firstPage?.width) > 0
      ? Number(firstPage.width)
      : 1000;
  const pageHeight =
    Number.isFinite(Number(firstPage?.height)) && Number(firstPage?.height) > 0
      ? Number(firstPage.height)
      : 1000;

  const words = [];
  (annotation?.pages || []).forEach((page) => {
    (page?.blocks || []).forEach((block) => {
      (block?.paragraphs || []).forEach((paragraph) => {
        (paragraph?.words || []).forEach((word) => {
          const text = (word?.symbols || [])
            .map((symbol) => symbol?.text || "")
            .join("")
            .trim();
          const vertices = Array.isArray(word?.boundingBox?.vertices)
            ? word.boundingBox.vertices
            : [];
          if (!text || vertices.length < 4) return;

          const xs = vertices.map((v) => Number(v?.x) || 0);
          const ys = vertices.map((v) => Number(v?.y) || 0);
          const x0 = Math.min(...xs);
          const x1 = Math.max(...xs);
          const y0 = Math.min(...ys);
          const y1 = Math.max(...ys);
          words.push({
            text,
            bbox: { x0, x1, y0, y1 },
            centerY: (y0 + y1) / 2,
            height: Math.max(y1 - y0, 1),
          });
        });
      });
    });
  });

  return { words, pageWidth, pageHeight };
}

function splitWords(value) {
  return asText(value)
    .split(/\s+/)
    .map((token) => asText(token))
    .filter(Boolean);
}

function cleanToken(value) {
  return asText(value).toLowerCase().replace(/[.,;:!?()[\]{}'"`]/g, "");
}

function scoreWordSimilarity(sourceWord, targetToken) {
  const source = cleanToken(sourceWord);
  const target = cleanToken(targetToken);
  if (!source || !target) return 0;
  if (source === target) return 1;
  if (source.includes(target) || target.includes(source)) {
    const minLen = Math.min(source.length, target.length);
    const maxLen = Math.max(source.length, target.length);
    if (minLen / maxLen >= 0.65) return 0.8;
  }
  return 0;
}

function dedupeWordsByPosition(words) {
  const seen = new Set();
  return (Array.isArray(words) ? words : []).filter((word) => {
    const key = `${Math.round(Number(word?.bbox?.x0) || 0)}:${Math.round(Number(word?.bbox?.y0) || 0)}:${cleanToken(word?.text)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupVisualLines(words) {
  const sorted = [...words].sort(
    (a, b) => a.centerY - b.centerY || a.bbox.x0 - b.bbox.x0,
  );

  const yGroups = [];
  let currentGroup = [];
  let groupStartY = -100;

  sorted.forEach((word) => {
    if (!currentGroup.length || Math.abs(word.centerY - groupStartY) <= 15) {
      currentGroup.push(word);
      if (groupStartY < -90) groupStartY = word.centerY;
      return;
    }
    yGroups.push(currentGroup);
    currentGroup = [word];
    groupStartY = word.centerY;
  });

  if (currentGroup.length) yGroups.push(currentGroup);

  const lines = [];
  yGroups.forEach((group) => {
    const row = [...group].sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const text = row.map((word) => word.text).join(" ").trim();
    if (!text) return;

    const x0 = Math.min(...row.map((word) => word.bbox.x0));
    const x1 = Math.max(...row.map((word) => word.bbox.x1));
    const y0 = Math.min(...row.map((word) => word.bbox.y0));
    const y1 = Math.max(...row.map((word) => word.bbox.y1));

    lines.push({
      text,
      words: row,
      bbox: { x0, x1, y0, y1 },
    });
  });

  return lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
}

function toPercentLineData({
  line,
  lineNumber,
  pageWidth,
  pageHeight,
  normalizeWidth,
  normalizeHeight,
}) {
  const safePageWidth = Number(pageWidth) > 0 ? Number(pageWidth) : 1000;
  const safePageHeight = Number(pageHeight) > 0 ? Number(pageHeight) : 1000;
  const safeNormalizeWidth = Number(normalizeWidth) > 0 ? Number(normalizeWidth) : safePageWidth;
  const safeNormalizeHeight = Number(normalizeHeight) > 0 ? Number(normalizeHeight) : safePageHeight;
  const scaleX = safeNormalizeWidth / safePageWidth;
  const scaleY = safeNormalizeHeight / safePageHeight;

  const words = (Array.isArray(line?.words) ? line.words : [])
    .map((word) => {
      const x0 = Number(word?.bbox?.x0) * scaleX;
      const x1 = Number(word?.bbox?.x1) * scaleX;
      const y0 = Number(word?.bbox?.y0) * scaleY;
      const y1 = Number(word?.bbox?.y1) * scaleY;
      if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(y0) || !Number.isFinite(y1)) {
        return null;
      }
      return {
        text: asText(word?.text),
        x_start: clamp((x0 / safeNormalizeWidth) * 100, 0, 100),
        x_end: clamp((x1 / safeNormalizeWidth) * 100, 0, 100),
        y_start: clamp((y0 / safeNormalizeHeight) * 100, 0, 100),
        y_end: clamp((y1 / safeNormalizeHeight) * 100, 0, 100),
      };
    })
    .filter((word) => word && word.text);

  const lineX0 = Number(line?.bbox?.x0) * scaleX;
  const lineX1 = Number(line?.bbox?.x1) * scaleX;
  const lineY0 = Number(line?.bbox?.y0) * scaleY;
  const lineY1 = Number(line?.bbox?.y1) * scaleY;

  return {
    line_number: lineNumber,
    text: asText(line?.text),
    words,
    crop_coordinates: {
      x_start: clamp((lineX0 / safeNormalizeWidth) * 100, 0, 100),
      y_start: clamp((lineY0 / safeNormalizeHeight) * 100, 0, 100),
      x_end: clamp((lineX1 / safeNormalizeWidth) * 100, 0, 100),
      y_end: clamp((lineY1 / safeNormalizeHeight) * 100, 0, 100),
    },
  };
}

function findBestVisualLineIndex(transcriptText, visualLines, usedVisualIndices) {
  const transcriptTokens = splitWords(transcriptText).map((token) => cleanToken(token));
  if (!transcriptTokens.length) return -1;

  let bestIndex = -1;
  let bestScore = 0;

  visualLines.forEach((line, lineIndex) => {
    if (usedVisualIndices.has(lineIndex)) return;
    const visualTokens = splitWords(line?.text).map((token) => cleanToken(token));
    if (!visualTokens.length) return;

    let matches = 0;
    transcriptTokens.forEach((token) => {
      if (!token) return;
      if (visualTokens.some((visual) => visual === token || visual.includes(token) || token.includes(visual))) {
        matches += 1;
      }
    });

    const score = matches / transcriptTokens.length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = lineIndex;
    }
  });

  return bestScore >= 0.2 ? bestIndex : -1;
}

function matchTranscriptToOrderedWords({
  transcriptText,
  visualLine,
  visionWords,
}) {
  const transcriptTokens = splitWords(transcriptText);
  const visualWords = Array.isArray(visualLine?.words)
    ? [...visualLine.words].sort((a, b) => a.bbox.x0 - b.bbox.x0)
    : [];
  if (!visualWords.length || !transcriptTokens.length) {
    return {
      words: visualWords,
      bbox: visualLine?.bbox || null,
    };
  }

  const lineYMin = Math.min(...visualWords.map((word) => word.bbox.y0));
  const lineYMax = Math.max(...visualWords.map((word) => word.bbox.y1));
  const lineHeight = Math.max(lineYMax - lineYMin, 1);
  const yTolerance = lineHeight * 0.7;

  const contextualWords = dedupeWordsByPosition([
    ...visualWords,
    ...(Array.isArray(visionWords)
      ? visionWords.filter((word) =>
          word.centerY >= lineYMin - yTolerance &&
          word.centerY <= lineYMax + yTolerance,
        )
      : []),
  ]).sort((a, b) => a.bbox.x0 - b.bbox.x0);

  const usedIndices = new Set();
  const matched = [];
  let lastX = Number.NEGATIVE_INFINITY;

  transcriptTokens.forEach((token) => {
    let bestIndex = -1;
    let bestScore = -Infinity;

    contextualWords.forEach((candidate, candidateIndex) => {
      if (usedIndices.has(candidateIndex)) return;

      const tokenScore = scoreWordSimilarity(candidate?.text, token);
      if (tokenScore <= 0) return;

      const x0 = Number(candidate?.bbox?.x0);
      const x1 = Number(candidate?.bbox?.x1);
      if (!Number.isFinite(x0) || !Number.isFinite(x1)) return;

      // Keep sequence monotonic across transcript tokens.
      if (x0 < lastX - 2) return;

      const gapPenalty = Number.isFinite(lastX)
        ? Math.max(0, x0 - lastX) * 0.02
        : 0;
      const sourceBoost = visualWords.includes(candidate) ? 5 : 0;
      const score = tokenScore * 100 + sourceBoost - gapPenalty;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = candidateIndex;
      }
    });

    if (bestIndex >= 0) {
      usedIndices.add(bestIndex);
      const chosen = contextualWords[bestIndex];
      matched.push(chosen);
      lastX = Number(chosen?.bbox?.x1);
    }
  });

  const words = matched.length
    ? matched.sort((a, b) => a.bbox.x0 - b.bbox.x0)
    : visualWords;

  if (!words.length) {
    return {
      words: [],
      bbox: null,
    };
  }

  const leftWord = words[0];
  const rightWord = words[words.length - 1];
  const y0 = Math.min(...words.map((word) => word.bbox.y0));
  const y1 = Math.max(...words.map((word) => word.bbox.y1));
  const lineSpan = Math.max(rightWord.bbox.x1 - leftWord.bbox.x0, 1);
  const horizontalPad = Math.max(2, lineSpan * 0.03);

  const bbox = {
    x0: leftWord.bbox.x0 - horizontalPad,
    x1: rightWord.bbox.x1 + horizontalPad,
    y0: y0 - Math.max(1, (y1 - y0) * 0.08),
    y1: y1 + Math.max(1, (y1 - y0) * 0.08),
  };

  return {
    words,
    bbox,
  };
}

function buildLinesFromTranscriptMapping({
  transcriptLines,
  visualLines,
  lineMapping,
  visionWords,
  pageWidth,
  pageHeight,
  normalizeWidth,
  normalizeHeight,
}) {
  const built = [];
  const usedVisualIndices = new Set();

  transcriptLines.forEach((transcriptText, index) => {
    let visualIndex = Number(lineMapping[String(index)]);
    if (!Number.isFinite(visualIndex) || visualIndex < 0 || visualIndex >= visualLines.length) {
      visualIndex = findBestVisualLineIndex(transcriptText, visualLines, usedVisualIndices);
    }
    if (!Number.isFinite(visualIndex) || visualIndex < 0 || visualIndex >= visualLines.length) {
      return;
    }

    usedVisualIndices.add(visualIndex);
    const visualLine = visualLines[visualIndex];
    const matched = matchTranscriptToOrderedWords({
      transcriptText,
      visualLine,
      visionWords,
    });

    if (!matched?.bbox || !Array.isArray(matched.words) || !matched.words.length) {
      return;
    }

    const x0 = clamp(Number(matched.bbox.x0), 0, pageWidth);
    const x1 = clamp(Number(matched.bbox.x1), 0, pageWidth);
    const y0 = clamp(Number(matched.bbox.y0), 0, pageHeight);
    const y1 = clamp(Number(matched.bbox.y1), 0, pageHeight);

    if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(y0) || !Number.isFinite(y1)) {
      return;
    }
    if (x1 <= x0 || y1 <= y0) {
      return;
    }

    const lineData = toPercentLineData({
      line: {
        text: transcriptText,
        words: matched.words,
        bbox: { x0, x1, y0, y1 },
      },
      lineNumber: index + 1,
      pageWidth,
      pageHeight,
      normalizeWidth,
      normalizeHeight,
    });

    built.push(lineData);
  });

  return built;
}

function isValidLineData(line) {
  const coords = line?.crop_coordinates || {};
  const xStart = Number(coords?.x_start);
  const xEnd = Number(coords?.x_end);
  const yStart = Number(coords?.y_start);
  const yEnd = Number(coords?.y_end);
  if (!Number.isFinite(xStart) || !Number.isFinite(xEnd) || !Number.isFinite(yStart) || !Number.isFinite(yEnd)) {
    return false;
  }
  if (xEnd <= xStart || yEnd <= yStart) return false;
  return Array.isArray(line?.words) && line.words.length > 0 && asText(line?.text).length > 0;
}

function sanitizeTranscriptLines(rawLines) {
  return (Array.isArray(rawLines) ? rawLines : [])
    .map((line) => asText(line))
    .filter(Boolean);
}

async function getClaudeTranscription({
  apiKey,
  model,
  mediaType,
  base64Data,
}) {
  const systemPrompt = `You are an OCR assistant. Your job is to accurately transcribe text from images of ingredient lists or food labels.

Output ONLY a JSON array where each element represents one visual line of text as it appears in the image.
Each line should be the exact text content, preserving the original line breaks as they appear visually.

Example output format:
["INGREDIENTS: Almonds, Dark Chocolate", "(chocolate liquor, cane sugar, cocoa butter,", "vanilla). Organic Coconut.", "CONTAINS: Tree nuts"]

Rules:
- Each array element = one visual line from the image
- Preserve exact spelling and punctuation
- Include ONLY text related to: ingredients, allergen information, allergy warnings, dietary claims
- EXCLUDE: company names, addresses, phone numbers, websites, UPC codes, weight/volume, nutrition facts, logos, brand names, origin info, or unrelated text
- Do not combine multiple visual lines into one
- Do not split one visual line into multiple entries
- Output ONLY the JSON array, no other text`;

  const text = await callAnthropicImage({
    apiKey,
    model,
    mediaType,
    base64Data,
    systemPrompt,
    userPrompt:
      "Transcribe each line of text from this ingredient label. Return as a JSON array with one element per visual line.",
    maxTokens: 3200,
  });

  return sanitizeTranscriptLines(parseJsonArray(text));
}

async function getClaudeQualityAssessment({
  apiKey,
  model,
  mediaType,
  base64Data,
  transcriptLines,
}) {
  const systemPrompt = `You are a quality-control assistant for ingredient-label photos.

Your job is to decide whether the image is readable enough to confidently extract the COMPLETE ingredient list.

Decide "accept": false if any of these are true:
- The ingredient list is cut off or missing parts
- Text is blurry, out of focus, or too small to read
- Glare, shadows, or distortion makes parts unreadable
- The image does not clearly show an ingredient list
- Any portion of the ingredient list is obscured, scribbled over, or partially blocked

Be strict. Accept only if you can read the full ingredient list end-to-end with high confidence.
If you are not highly confident the list is complete and legible, set "accept": false.
Only set "accept": true when "confidence" is "high".

Return ONLY valid JSON with this schema:
{
  "accept": true|false,
  "confidence": "low"|"medium"|"high",
  "reasons": ["short reason phrases if reject"],
  "warnings": ["short warning phrases if accept but imperfect"],
  "message": "short user-facing sentence if reject"
}

Notes:
- Use the IMAGE as the source of truth.
- The transcript may be incomplete or inaccurate; use it only as a hint.`;

  const transcriptText = Array.isArray(transcriptLines)
    ? transcriptLines.join("\n")
    : "";

  const text = await callAnthropicImage({
    apiKey,
    model,
    mediaType,
    base64Data,
    systemPrompt,
    userPrompt: `Assess photo quality for ingredient-list readability.\n\nTranscript (may be inaccurate):\n${transcriptText}`,
    maxTokens: 1200,
  });

  return normalizeQualityAssessment(parseJsonObject(text) || {});
}

async function matchLinesToVisualLines({
  apiKey,
  model,
  transcriptLines,
  visualLines,
}) {
  const systemPrompt = `You are a text matching assistant. You will receive:
1. Transcript lines - accurate text from Claude's reading of the image
2. Visual lines - OCR-detected text grouped by position (may have errors/typos)

Your job is to match each transcript line to the visual line that represents the same text.

Output a JSON object where:
- Keys are transcript line indices (0, 1, 2, etc.)
- Values are the corresponding visual line index

Rules:
- Match based on text similarity (the visual line text may have OCR errors)
- Each transcript line should match to exactly ONE visual line
- If a transcript line has no good match, use -1
- Visual lines may be unused (they might be addresses, nutrition info, etc.)

Example output:
{"0": 5, "1": 6, "2": 7, "3": 8, "4": -1}

Output ONLY the JSON object, nothing else.`;

  const transcriptDesc = transcriptLines
    .map((line, index) => `Transcript ${index}: "${line}"`)
    .join("\n");
  const visualDesc = visualLines
    .map((line, index) => `Visual ${index}: "${line.text}"`)
    .join("\n");

  const text = await callAnthropicText({
    apiKey,
    model,
    systemPrompt,
    userPrompt:
      `Match each transcript line to its corresponding visual line.\n\nTRANSCRIPT LINES:\n${transcriptDesc}\n\nVISUAL LINES:\n${visualDesc}\n\nReturn a JSON object mapping transcript indices to visual line indices.`,
    maxTokens: 1200,
  });

  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Could not parse transcript-to-visual line mapping.");
  }

  const mapping = {};
  transcriptLines.forEach((_, index) => {
    const raw = parsed[String(index)] ?? parsed[index];
    const numeric = Number(raw);
    mapping[String(index)] = Number.isFinite(numeric) ? Math.trunc(numeric) : -1;
  });
  return mapping;
}

function deriveFrontNameFromVisionWords({ words, pageHeight }) {
  const filtered = (Array.isArray(words) ? words : [])
    .filter((word) => asText(word?.text))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  if (!filtered.length) return "";

  const groups = [];
  let current = [];
  let anchorY = Number.NEGATIVE_INFINITY;

  filtered.forEach((word) => {
    if (!current.length) {
      current.push(word);
      anchorY = word.centerY;
      return;
    }
    if (Math.abs(word.centerY - anchorY) <= Math.max(14, word.height * 0.8)) {
      current.push(word);
      return;
    }
    groups.push(current);
    current = [word];
    anchorY = word.centerY;
  });
  if (current.length) groups.push(current);

  const blocked = /(nutrition|ingredients|contains|allergen|serving|calories|barcode|warning|may\s+contain)/i;

  const lines = groups
    .map((group) => {
      const ordered = [...group].sort((a, b) => a.bbox.x0 - b.bbox.x0);
      const text = ordered.map((word) => asText(word.text)).join(" ").replace(/\s+/g, " ").trim();
      if (!text) return null;
      const y0 = Math.min(...ordered.map((word) => word.bbox.y0));
      const avgHeight =
        ordered.reduce((sum, word) => sum + Math.max(word.bbox.y1 - word.bbox.y0, 1), 0) /
        ordered.length;
      const uppercaseCount = text.replace(/[^A-Z]/g, "").length;
      const alphaCount = text.replace(/[^A-Za-z]/g, "").length || 1;
      const uppercaseRatio = uppercaseCount / alphaCount;
      return {
        text,
        y0,
        avgHeight,
        wordCount: ordered.length,
        uppercaseRatio,
      };
    })
    .filter(Boolean)
    .filter((line) => !blocked.test(line.text))
    .filter((line) => line.y0 <= Number(pageHeight || 1000) * 0.45);

  if (!lines.length) return "";

  lines.sort((a, b) => {
    const scoreA = a.avgHeight * 3 + a.uppercaseRatio * 30 - a.y0 * 0.01 + a.wordCount;
    const scoreB = b.avgHeight * 3 + b.uppercaseRatio * 30 - b.y0 * 0.01 + b.wordCount;
    return scoreB - scoreA;
  });

  const primary = lines[0];
  if (!primary) return "";

  const siblings = lines
    .filter((line) => line !== primary)
    .sort((a, b) => a.y0 - b.y0)
    .filter(
      (line) =>
        line.y0 > primary.y0 &&
        line.y0 - primary.y0 <= Math.max(26, primary.avgHeight * 2.2) &&
        line.wordCount <= 4,
    );

  const combined = [primary.text, ...siblings.slice(0, 1).map((line) => line.text)]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return combined;
}

async function analyzeFrontProductName({
  anthropicApiKey,
  anthropicModel,
  googleVisionApiKey,
  mediaType,
  base64Data,
}) {
  let productName = "";
  let confidence = "low";

  const systemPrompt = `You are extracting the retail product name from a package front photo.
Return ONLY valid JSON with this exact schema:
{
  "productName": "string",
  "confidence": "low"|"medium"|"high"
}
Rules:
- Prefer the main marketed product name visible on the package front.
- Do NOT return nutrition labels, ingredient paragraphs, warnings, or slogans.
- If uncertain, return low confidence.`;

  const text = await callAnthropicImage({
    apiKey: anthropicApiKey,
    model: anthropicModel,
    mediaType,
    base64Data,
    systemPrompt,
    userPrompt:
      "Identify the product name shown on the front of this package.",
    maxTokens: 500,
  });

  const parsed = parseJsonObject(text) || {};
  productName = asText(parsed?.productName);
  confidence = normalizeConfidence(parsed?.confidence);

  if ((!productName || confidence === "low") && googleVisionApiKey) {
    const { words, pageHeight } = await getVisionWords({
      googleVisionApiKey,
      base64Data,
    });
    const fallbackName = deriveFrontNameFromVisionWords({ words, pageHeight });
    if (!productName && fallbackName) {
      productName = fallbackName;
      confidence = "medium";
    }
  }

  return {
    productName,
    confidence,
  };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsJson(
      { success: false, error: "Invalid JSON payload." },
      { status: 400 },
    );
  }

  const imageData = asText(body?.imageData);
  const mode = asText(body?.mode);
  const imageWidthRaw = Number(body?.imageWidth);
  const imageHeightRaw = Number(body?.imageHeight);
  const imageWidth = Number.isFinite(imageWidthRaw) && imageWidthRaw > 0
    ? imageWidthRaw
    : null;
  const imageHeight = Number.isFinite(imageHeightRaw) && imageHeightRaw > 0
    ? imageHeightRaw
    : null;

  if (!imageData || (mode !== "full-analysis" && mode !== "front-analysis")) {
    return corsJson(
      {
        success: false,
        error:
          'Expected { imageData, mode: "full-analysis" } or { imageData, mode: "front-analysis" }.',
      },
      { status: 400 },
    );
  }

  const parsedImage = parseImageData(imageData);
  if (!parsedImage) {
    return corsJson(
      { success: false, error: "Invalid imageData format." },
      { status: 400 },
    );
  }

  const anthropicApiKey = readFirstEnv(["ANTHROPIC_API_KEY"]);
  const googleVisionApiKey = readFirstEnv(["GOOGLE_VISION_API_KEY"]);
  const anthropicModel =
    readFirstEnv(["ANTHROPIC_MODEL"]) || DEFAULT_ANTHROPIC_MODEL;

  if (!anthropicApiKey) {
    return corsJson(
      {
        success: false,
        error: "ANTHROPIC_API_KEY is not configured.",
      },
      { status: 500 },
    );
  }

  if (mode === "front-analysis") {
    try {
      const front = await analyzeFrontProductName({
        anthropicApiKey,
        anthropicModel,
        googleVisionApiKey,
        mediaType: parsedImage.mediaType,
        base64Data: parsedImage.base64Data,
      });

      return corsJson(
        {
          success: true,
          productName: asText(front?.productName),
          confidence: normalizeConfidence(front?.confidence),
        },
        { status: 200 },
      );
    } catch (error) {
      return corsJson(
        {
          success: false,
          error: asText(error?.message) || "Failed front image analysis.",
        },
        { status: 500 },
      );
    }
  }

  if (!googleVisionApiKey) {
    return corsJson(
      {
        success: false,
        error: "GOOGLE_VISION_API_KEY is not configured.",
      },
      { status: 500 },
    );
  }

  try {
    const transcriptLines = await getClaudeTranscription({
      apiKey: anthropicApiKey,
      model: anthropicModel,
      mediaType: parsedImage.mediaType,
      base64Data: parsedImage.base64Data,
    });

    const quality = await getClaudeQualityAssessment({
      apiKey: anthropicApiKey,
      model: anthropicModel,
      mediaType: parsedImage.mediaType,
      base64Data: parsedImage.base64Data,
      transcriptLines,
    });

    if (!quality.accept) {
      return corsJson(
        {
          success: false,
          error:
            quality.message ||
            "Could not read the ingredient text clearly. Please retake the photo.",
          quality,
        },
        { status: 200 },
      );
    }

    if (!transcriptLines.length) {
      return corsJson(
        {
          success: false,
          error: "No ingredient lines were transcribed. Please retake the photo.",
          quality,
        },
        { status: 200 },
      );
    }

    const vision = await getVisionWords({
      googleVisionApiKey,
      base64Data: parsedImage.base64Data,
    });

    if (!vision.words.length) {
      return corsJson(
        {
          success: false,
          error: "No text detected in this image. Please retake the photo.",
          quality,
        },
        { status: 200 },
      );
    }

    const visualLines = groupVisualLines(vision.words);
    const lineMapping = await matchLinesToVisualLines({
      apiKey: anthropicApiKey,
      model: anthropicModel,
      transcriptLines,
      visualLines,
    });

    const lines = buildLinesFromTranscriptMapping({
      transcriptLines,
      visualLines,
      lineMapping,
      visionWords: vision.words,
      pageWidth: vision.pageWidth,
      pageHeight: vision.pageHeight,
      normalizeWidth: imageWidth || vision.pageWidth,
      normalizeHeight: imageHeight || vision.pageHeight,
    }).filter(isValidLineData);

    if (!lines.length) {
      return corsJson(
        {
          success: false,
          error: "Could not map ingredient text to line regions. Please retake the photo.",
          quality,
        },
        { status: 200 },
      );
    }

    return corsJson(
      {
        success: true,
        data: lines,
        claude_transcript: lines.map((line) => asText(line?.text)).filter(Boolean),
        quality,
      },
      { status: 200 },
    );
  } catch (error) {
    return corsJson(
      {
        success: false,
        error: asText(error?.message) || "Failed to analyze ingredient image.",
      },
      { status: 500 },
    );
  }
}
