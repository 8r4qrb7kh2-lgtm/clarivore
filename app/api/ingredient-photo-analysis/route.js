import { corsJson, corsOptions } from "../_shared/cors";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsOptions();
}

function asText(value) {
  return String(value ?? "").trim();
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
  const textBlock = blocks.find((block) => block?.type === "text");
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
      model: "claude-sonnet-4-5-20250929",
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
      model: "claude-sonnet-4-5-20250929",
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
          const text = (word?.symbols || []).map((symbol) => symbol?.text || "").join("").trim();
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
          });
        });
      });
    });
  });

  return { words, pageWidth, pageHeight };
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

function toPercentLineData({ line, lineNumber, pageWidth, pageHeight }) {
  const safeWidth = Number(pageWidth) > 0 ? Number(pageWidth) : 1000;
  const safeHeight = Number(pageHeight) > 0 ? Number(pageHeight) : 1000;

  return {
    line_number: lineNumber,
    text: asText(line?.text),
    words: (Array.isArray(line?.words) ? line.words : []).map((word) => ({
      text: asText(word?.text),
      x_start: clamp((Number(word?.bbox?.x0) / safeWidth) * 100, 0, 100),
      x_end: clamp((Number(word?.bbox?.x1) / safeWidth) * 100, 0, 100),
      y_start: clamp((Number(word?.bbox?.y0) / safeHeight) * 100, 0, 100),
      y_end: clamp((Number(word?.bbox?.y1) / safeHeight) * 100, 0, 100),
    })),
    crop_coordinates: {
      x_start: clamp((Number(line?.bbox?.x0) / safeWidth) * 100, 0, 100),
      y_start: clamp((Number(line?.bbox?.y0) / safeHeight) * 100, 0, 100),
      x_end: clamp((Number(line?.bbox?.x1) / safeWidth) * 100, 0, 100),
      y_end: clamp((Number(line?.bbox?.y1) / safeHeight) * 100, 0, 100),
    },
  };
}

function buildSyntheticLineData(lines) {
  const safeLines = Array.isArray(lines) ? lines : [];
  const total = Math.max(safeLines.length, 1);

  return safeLines.map((text, index) => {
    const words = asText(text).split(/\s+/).filter(Boolean);
    const lineTop = clamp((index / total) * 100 + 2, 0, 99);
    const lineBottom = clamp(lineTop + Math.max(5, 88 / total), lineTop + 1, 100);
    const wordWidth = words.length ? 96 / words.length : 96;

    return {
      line_number: index + 1,
      text: asText(text),
      words: words.map((word, wordIndex) => {
        const xStart = clamp(2 + wordIndex * wordWidth, 0, 100);
        const xEnd = clamp(xStart + wordWidth - 0.5, xStart, 100);
        return {
          text: word,
          x_start: xStart,
          x_end: xEnd,
          y_start: lineTop,
          y_end: lineBottom,
        };
      }),
      crop_coordinates: {
        x_start: 2,
        x_end: 98,
        y_start: lineTop,
        y_end: lineBottom,
      },
    };
  });
}

function sanitizeTranscriptLines(rawLines) {
  return (Array.isArray(rawLines) ? rawLines : [])
    .map((line) => asText(line))
    .filter(Boolean);
}

async function getClaudeTranscription({
  apiKey,
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

function cleanToken(value) {
  return asText(value).toLowerCase().replace(/[.,;:!?()[\]{}'"`]/g, "");
}

function wordMatchesTranscript(wordText, transcriptText) {
  const cleanWord = cleanToken(wordText);
  if (!cleanWord) return false;

  const transcriptWords = asText(transcriptText)
    .toLowerCase()
    .split(/[\s,.:;()\[\]]+/)
    .filter((token) => token.length > 0);

  return transcriptWords.some(
    (token) =>
      token === cleanWord ||
      (cleanWord.length > 2 &&
        token.includes(cleanWord) &&
        cleanWord.length >= token.length * 0.7) ||
      (token.length > 2 &&
        cleanWord.includes(token) &&
        token.length >= cleanWord.length * 0.7),
  );
}

function buildLinesFromTranscriptMapping({
  transcriptLines,
  visualLines,
  lineMapping,
  visionWords,
  pageWidth,
  pageHeight,
}) {
  const mapped = Array.from({ length: transcriptLines.length }, () => null);

  for (let index = 0; index < transcriptLines.length; index += 1) {
    const transcriptText = transcriptLines[index];
    const visualIndex = Number(lineMapping[String(index)]);
    if (!Number.isFinite(visualIndex)) continue;
    if (visualIndex < 0 || visualIndex >= visualLines.length) continue;

    const visualLine = visualLines[visualIndex];
    const visualWords = Array.isArray(visualLine?.words) ? visualLine.words : [];
    if (!visualWords.length) continue;

    let matchingWords = visualWords.filter((word) =>
      wordMatchesTranscript(word.text, transcriptText),
    );

    const transcriptWords = asText(transcriptText)
      .toLowerCase()
      .split(/[\s,.:;()\[\]]+/)
      .filter((token) => token.length > 1);

    const transcriptWordCounts = {};
    transcriptWords.forEach((token) => {
      transcriptWordCounts[token] = (transcriptWordCounts[token] || 0) + 1;
    });

    const matchedWordCounts = {};
    matchingWords.forEach((word) => {
      const clean = cleanToken(word.text);
      if (!clean) return;
      matchedWordCounts[clean] = (matchedWordCounts[clean] || 0) + 1;
    });

    const missingWords = [];
    Object.entries(transcriptWordCounts).forEach(([token, neededCount]) => {
      const matchedCount = matchedWordCounts[token] || 0;
      const missingCount = neededCount - matchedCount;
      for (let i = 0; i < missingCount; i += 1) {
        missingWords.push(token);
      }
    });

    const usedBoxes = new Set(
      matchingWords.map((word) => `${word.bbox.x0},${word.bbox.y0}`),
    );

    const vlYMin = Math.min(...visualWords.map((word) => word.bbox.y0));
    const vlYMax = Math.max(...visualWords.map((word) => word.bbox.y1));
    const vlHeight = Math.max(vlYMax - vlYMin, 1);
    const yTolerance = vlHeight * 0.5;

    for (const missingWord of missingWords) {
      const candidates = visionWords.filter((word) => {
        const cleanVisionWord = cleanToken(word.text);
        const boxKey = `${word.bbox.x0},${word.bbox.y0}`;
        const exactMatch = cleanVisionWord === missingWord;
        const closeMatch =
          cleanVisionWord.length > 2 &&
          missingWord.length > 2 &&
          ((cleanVisionWord.includes(missingWord) &&
            missingWord.length >= cleanVisionWord.length * 0.7) ||
            (missingWord.includes(cleanVisionWord) &&
              cleanVisionWord.length >= missingWord.length * 0.7));
        const notUsed = !usedBoxes.has(boxKey);
        const withinYRange =
          word.centerY >= vlYMin - yTolerance &&
          word.centerY <= vlYMax + yTolerance;
        return (exactMatch || closeMatch) && notUsed && withinYRange;
      });

      if (!candidates.length) continue;

      const avgY =
        matchingWords.length > 0
          ? matchingWords.reduce((sum, word) => sum + word.centerY, 0) /
            matchingWords.length
          : (vlYMin + vlYMax) / 2;

      candidates.sort(
        (a, b) => Math.abs(a.centerY - avgY) - Math.abs(b.centerY - avgY),
      );

      const bestMatch = candidates[0];
      if (Math.abs(bestMatch.centerY - avgY) < vlHeight * 1.5) {
        matchingWords.push(bestMatch);
        usedBoxes.add(`${bestMatch.bbox.x0},${bestMatch.bbox.y0}`);
      }
    }

    const wordsForCrop = matchingWords.length > 0 ? matchingWords : visualWords;
    if (!wordsForCrop.length) continue;

    const x0 = Math.min(...wordsForCrop.map((word) => word.bbox.x0));
    const y0 = Math.min(...wordsForCrop.map((word) => word.bbox.y0));
    const x1 = Math.max(...wordsForCrop.map((word) => word.bbox.x1));
    const y1 = Math.max(...wordsForCrop.map((word) => word.bbox.y1));

    mapped[index] = toPercentLineData({
      line: {
        text: transcriptText,
        words: matchingWords,
        bbox: { x0, y0, x1, y1 },
      },
      lineNumber: index + 1,
      pageWidth,
      pageHeight,
    });
  }

  const synthetic = buildSyntheticLineData(transcriptLines);
  return mapped.map((line, index) => line || synthetic[index]);
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

  const parsed = parseImageData(imageData);
  if (!parsed) {
    return corsJson(
      { success: false, error: "Invalid imageData format." },
      { status: 400 },
    );
  }

  const anthropicApiKey = asText(process.env.ANTHROPIC_API_KEY);

  if (mode === "front-analysis") {
    if (!anthropicApiKey) {
      return corsJson(
        { success: false, error: "Front image analysis is not configured." },
        { status: 500 },
      );
    }

    try {
      const frontPrompt = `You identify product names from package-front photos.
Return ONLY valid JSON:
{
  "productName": "best guess product name",
  "confidence": "low|medium|high"
}
If uncertain, still return your best short productName and set confidence to "low".`;

      const frontText = await callAnthropicImage({
        apiKey: anthropicApiKey,
        mediaType: parsed.mediaType,
        base64Data: parsed.base64Data,
        systemPrompt: frontPrompt,
        userPrompt: "Extract the product name from this package-front image.",
        maxTokens: 600,
      });

      const frontObject = parseJsonObject(frontText) || {};
      const confidenceRaw = asText(frontObject?.confidence).toLowerCase();
      const confidence = ["low", "medium", "high"].includes(confidenceRaw)
        ? confidenceRaw
        : "low";

      return corsJson({
        success: true,
        productName: asText(frontObject?.productName),
        confidence,
      });
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

  const googleVisionApiKey = asText(process.env.GOOGLE_CLOUD_VISION_API_KEY);
  if (!anthropicApiKey || !googleVisionApiKey) {
    return corsJson(
      {
        success: false,
        error:
          "Ingredient photo analysis requires Claude and Google Vision configuration.",
      },
      { status: 500 },
    );
  }

  try {
    const quality = await getClaudeQualityAssessment({
      apiKey: anthropicApiKey,
      mediaType: parsed.mediaType,
      base64Data: parsed.base64Data,
      transcriptLines: [],
    });

    if (quality.accept === false) {
      return corsJson(
        {
          success: false,
          error:
            quality.message || "Photo quality is too low to read the ingredients.",
          quality,
        },
        { status: 200 },
      );
    }

    const claudeTranscript = await getClaudeTranscription({
      apiKey: anthropicApiKey,
      mediaType: parsed.mediaType,
      base64Data: parsed.base64Data,
    });

    if (!claudeTranscript.length) {
      return corsJson(
        {
          success: false,
          error: "Could not read the ingredient text clearly. Please retake the photo.",
          quality,
        },
        { status: 200 },
      );
    }

    const { words, pageWidth, pageHeight } = await getVisionWords({
      googleVisionApiKey,
      base64Data: parsed.base64Data,
    });

    if (!words.length) {
      return corsJson(
        {
          success: false,
          error:
            "Could not detect text line positions. Please retake the photo with the ingredient label filling the frame.",
          quality,
        },
        { status: 200 },
      );
    }

    const visualLines = groupVisualLines(words);
    if (!visualLines.length) {
      return corsJson(
        {
          success: false,
          error:
            "Could not map ingredient lines from the image. Please retake the photo.",
          quality,
        },
        { status: 200 },
      );
    }

    const lineMapping = await matchLinesToVisualLines({
      apiKey: anthropicApiKey,
      transcriptLines: claudeTranscript,
      visualLines,
    });

    const data = buildLinesFromTranscriptMapping({
      transcriptLines: claudeTranscript,
      visualLines,
      lineMapping,
      visionWords: words,
      pageWidth,
      pageHeight,
    });

    return corsJson(
      {
        success: true,
        data,
        claude_transcript: claudeTranscript,
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
