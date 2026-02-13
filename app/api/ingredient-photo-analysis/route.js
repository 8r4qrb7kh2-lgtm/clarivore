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
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
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
    const match = value.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

function normalizeTranscriptEntries(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((item) => {
      if (typeof item === "string") {
        return { text: asText(item), type: "ingredient" };
      }
      if (!item || typeof item !== "object") return null;
      return {
        text: asText(item.text),
        type: asText(item.type).toLowerCase(),
      };
    })
    .filter((item) => item?.text);
}

function isLikelyNoiseLine(text) {
  const value = asText(text).toLowerCase();
  if (!value) return true;
  const noiseSignals = [
    "nutrition facts",
    "calories",
    "serving size",
    "daily value",
    "manufactured for",
    "visit ",
    "www.",
    "warning:",
    "do not use",
    "certified",
    "barcode",
    "phone",
    "packet",
    "protein cookie dough",
    "mix with water",
    "made with only",
  ];
  return noiseSignals.some((signal) => value.includes(signal));
}

function filterTranscriptEntries(entries) {
  const explicitAllowedTypes = new Set([
    "ingredient",
    "allergen_statement",
    "contains",
    "may_contain",
  ]);

  return entries.filter((entry) => {
    if (explicitAllowedTypes.has(entry.type)) return true;
    if (entry.type === "ignore") return false;

    const text = asText(entry.text);
    if (!text || isLikelyNoiseLine(text)) return false;
    if (!/[a-z]/i.test(text)) return false;

    const lower = text.toLowerCase();
    if (
      lower.includes("ingredient") ||
      lower.includes("contains") ||
      lower.includes("may contain")
    ) {
      return true;
    }

    // Keep short ingredient-like lines, drop long prose.
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    return wordCount > 0 && wordCount <= 14;
  });
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
        .map((r) => asText(r))
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const warnings = Array.isArray(raw?.warnings)
    ? raw.warnings
        .map((w) => asText(w))
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

async function callAnthropic({
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

async function getVisionWords({ googleVisionApiKey, base64Data }) {
  if (!googleVisionApiKey) {
    return { words: [], pageWidth: 1000, pageHeight: 1000 };
  }

  try {
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
      return { words: [], pageWidth: 1000, pageHeight: 1000 };
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
            const text = (word?.symbols || []).map((s) => s?.text || "").join("").trim();
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
  } catch {
    return { words: [], pageWidth: 1000, pageHeight: 1000 };
  }
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

function normalizeMatchText(value) {
  return asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreLineMatch(a, b) {
  const aTokens = normalizeMatchText(a);
  const bTokens = normalizeMatchText(b);
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let overlap = 0;
  aSet.forEach((token) => {
    if (bSet.has(token)) overlap += 1;
  });
  const unionSize = new Set([...aSet, ...bSet]).size || 1;
  return overlap / unionSize;
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

async function callSupabaseFunction(functionName, payload) {
  const supabaseUrl =
    asText(process.env.SUPABASE_URL) || asText(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseAnonKey =
    asText(process.env.SUPABASE_ANON_KEY) ||
    asText(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase function proxy is not configured.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseAnonKey}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify(payload || {}),
  });

  const payloadText = await response.text();
  let data = null;
  try {
    data = payloadText ? JSON.parse(payloadText) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      asText(data?.error) || asText(data?.message) || "Supabase function request failed.",
    );
  }

  return data || {};
}

function extractFallbackTranscriptFromDishEditor(result) {
  const rows = Array.isArray(result?.ingredients) ? result.ingredients : [];
  const lines = rows
    .map((ingredient) => {
      const name = asText(ingredient?.name);
      if (name) return name;
      const list = Array.isArray(ingredient?.ingredientsList)
        ? ingredient.ingredientsList.map((entry) => asText(entry)).filter(Boolean)
        : [];
      if (list.length) return list.join(", ");
      return "";
    })
    .filter(Boolean);
  return lines;
}

function mapTranscriptToLineData({ transcriptLines, visualLines, pageWidth, pageHeight }) {
  const used = new Set();
  const mapped = transcriptLines.map((lineText, index) => {
    let bestIndex = -1;
    let bestScore = -1;
    visualLines.forEach((visualLine, visualIndex) => {
      if (used.has(visualIndex)) return;
      const score = scoreLineMatch(lineText, visualLine.text);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = visualIndex;
      }
    });

    if (bestIndex >= 0 && (bestScore > 0 || index >= visualLines.length)) {
      used.add(bestIndex);
      const chosen = visualLines[bestIndex];
      return toPercentLineData({
        line: {
          ...chosen,
          text: asText(lineText) || asText(chosen.text),
        },
        lineNumber: index + 1,
        pageWidth,
        pageHeight,
      });
    }

    return null;
  });

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
          "Expected { imageData, mode: \"full-analysis\" } or { imageData, mode: \"front-analysis\" }.",
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
      const frontText = await callAnthropic({
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

  if (!anthropicApiKey) {
    try {
      const fallback = await callSupabaseFunction("dish-editor", {
        dishName: "Ingredient Label",
        text: "",
        imageData,
      });
      const transcript = filterTranscriptEntries(
        normalizeTranscriptEntries(extractFallbackTranscriptFromDishEditor(fallback)),
      ).map((entry) => entry.text);
      if (!transcript.length) {
        return corsJson(
          { success: false, error: "Ingredient photo analysis is not configured." },
          { status: 500 },
        );
      }

      return corsJson(
        {
          success: true,
          data: buildSyntheticLineData(transcript),
          claude_transcript: transcript,
          quality: {
            accept: true,
            confidence: "medium",
            reasons: [],
            warnings: [
              "Using fallback ingredient extraction without dedicated photo-analysis key.",
            ],
            message: "",
            warningMessage:
              "Using fallback ingredient extraction. Results may be less precise.",
          },
        },
        { status: 200 },
      );
    } catch (fallbackError) {
      return corsJson(
        {
          success: false,
          error:
            asText(fallbackError?.message) ||
            "Ingredient photo analysis is not configured.",
        },
        { status: 500 },
      );
    }
  }
  const googleVisionApiKey = asText(process.env.GOOGLE_CLOUD_VISION_API_KEY);

  try {
    const qualityPrompt = `You are a quality-control assistant for ingredient-label photos.
Return ONLY valid JSON:
{
  "accept": true|false,
  "confidence": "low"|"medium"|"high",
  "reasons": ["short reason phrases if reject"],
  "warnings": ["short warning phrases if accept but imperfect"],
  "message": "short user-facing sentence if reject"
}
Set accept=false if image is blurry, cut off, or not fully readable.`;
    const qualityText = await callAnthropic({
      apiKey: anthropicApiKey,
      mediaType: parsed.mediaType,
      base64Data: parsed.base64Data,
      systemPrompt: qualityPrompt,
      userPrompt: "Assess whether this ingredient-label image is readable enough.",
      maxTokens: 1200,
    });
    const quality = normalizeQualityAssessment(parseJsonObject(qualityText) || {});
    if (quality.accept === false) {
      return corsJson(
        {
          success: false,
          error:
            quality.message ||
            "Photo quality is too low to read the ingredients.",
          quality,
        },
        { status: 200 },
      );
    }

      const transcriptPrompt = `You are an OCR assistant for ingredient labels.
Return ONLY a JSON array. Each item must be:
{
  "text": "one visual line",
  "type": "ingredient" | "allergen_statement" | "ignore"
}
Rules:
- Keep only ingredient/allergen lines in "ingredient" or "allergen_statement".
- Mark nutrition facts, marketing copy, addresses, warnings, logos, and unrelated text as "ignore".
- Preserve exact visible wording for kept lines.`;
      const transcriptText = await callAnthropic({
        apiKey: anthropicApiKey,
        mediaType: parsed.mediaType,
        base64Data: parsed.base64Data,
        systemPrompt: transcriptPrompt,
        userPrompt:
          "Transcribe ingredient/allergen lines from this image and classify each line.",
        maxTokens: 4096,
      });
      const transcriptEntries = filterTranscriptEntries(
        normalizeTranscriptEntries(parseJsonArray(transcriptText)),
      );
      const claudeTranscript = transcriptEntries
        .map((entry) => asText(entry.text))
        .filter(Boolean);
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
    const visualLines = groupVisualLines(words);
    const data = visualLines.length
      ? mapTranscriptToLineData({
          transcriptLines: claudeTranscript,
          visualLines,
          pageWidth,
          pageHeight,
        })
      : buildSyntheticLineData(claudeTranscript);

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
