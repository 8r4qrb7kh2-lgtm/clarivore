import { corsJson, corsOptions } from "../_shared/cors";

export const runtime = "nodejs";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const REMAP_CANVAS_SIZE = 1000;

function asText(value) {
  return String(value ?? "").trim();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundCoord(value, digits = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseFiniteNumber(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const text = asText(value);
  if (!text) return null;
  const normalized = text.replace(/%/g, "").replace(/,/g, "");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function pickFinite(...values) {
  for (const value of values) {
    const parsed = parseFiniteNumber(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseImageData(imageData) {
  const value = asText(imageData);
  if (!value) return null;

  if (value.startsWith("data:") && value.includes(",")) {
    const [header, base64Data] = value.split(",", 2);
    const mediaType = asText(header.split(";")[0]?.replace("data:", "")) || "image/jpeg";
    if (!base64Data) return null;
    return { mediaType, base64Data };
  }

  return {
    mediaType: "image/jpeg",
    base64Data: value,
  };
}

function extractBalancedJsonObjects(value) {
  const out = [];
  const text = asText(value);
  if (!text) return out;

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }

    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (character === "}") {
      if (depth <= 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return out;
}

function parseClaudeJson(responseText) {
  const value = asText(responseText);
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    // Continue with fallback parsing.
  }

  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // Continue with fallback parsing.
    }
  }

  const balancedObjects = extractBalancedJsonObjects(value);
  for (let index = balancedObjects.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(balancedObjects[index]);
    } catch {
      // Continue with next candidate.
    }
  }

  return null;
}

function isObjectLike(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePoint(value) {
  if (Array.isArray(value)) {
    const [xRaw, yRaw] = value;
    const x = parseFiniteNumber(xRaw);
    const y = parseFiniteNumber(yRaw);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    return null;
  }

  if (!isObjectLike(value)) return null;
  const x = pickFinite(value.x, value.left, value.cx, value.centerX, value.center_x);
  const y = pickFinite(value.y, value.top, value.cy, value.centerY, value.center_y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function rectFromPointList(points) {
  const list = (Array.isArray(points) ? points : []).map((point) => parsePoint(point)).filter(Boolean);
  if (list.length < 2) return null;

  const xs = list.map((point) => point.x);
  const ys = list.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX;
  const h = maxY - minY;

  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return {
    x: minX,
    y: minY,
    w,
    h,
  };
}

function rectFromEdges(source) {
  if (!isObjectLike(source)) return null;
  const left = pickFinite(source.left, source.x, source.x0, source.minX, source.min_x, source.l);
  const top = pickFinite(source.top, source.y, source.y0, source.minY, source.min_y, source.t);
  const right = pickFinite(source.right, source.x1, source.maxX, source.max_x, source.r);
  const bottom = pickFinite(source.bottom, source.y1, source.maxY, source.max_y, source.b);

  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom)
  ) {
    return null;
  }

  const w = right - left;
  const h = bottom - top;
  if (w <= 0 || h <= 0) return null;

  return {
    x: left,
    y: top,
    w,
    h,
  };
}

function rectFromCenter(source) {
  if (!isObjectLike(source)) return null;
  const centerX = pickFinite(source.centerX, source.center_x, source.cx, source.midX, source.mid_x);
  const centerY = pickFinite(source.centerY, source.center_y, source.cy, source.midY, source.mid_y);
  const w = pickFinite(source.w, source.width, source.relativeW, source.relative_w);
  const h = pickFinite(source.h, source.height, source.relativeH, source.relative_h);

  if (
    !Number.isFinite(centerX) ||
    !Number.isFinite(centerY) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w <= 0 ||
    h <= 0
  ) {
    return null;
  }

  return {
    x: centerX - w / 2,
    y: centerY - h / 2,
    w,
    h,
  };
}

function extractRectFromObject(source) {
  if (!isObjectLike(source)) return null;

  const x = pickFinite(source.x, source.left, source.relativeX, source.relative_x);
  const y = pickFinite(source.y, source.top, source.relativeY, source.relative_y);
  const w = pickFinite(source.w, source.width, source.relativeW, source.relative_w);
  const h = pickFinite(source.h, source.height, source.relativeH, source.relative_h);
  if (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(w) &&
    Number.isFinite(h) &&
    w > 0 &&
    h > 0
  ) {
    return { x, y, w, h };
  }

  const fromEdges = rectFromEdges(source);
  if (fromEdges) return fromEdges;

  const fromCenter = rectFromCenter(source);
  if (fromCenter) return fromCenter;

  const pointListKeys = ["vertices", "points", "polygon", "coords", "coordinates"];
  for (const key of pointListKeys) {
    const fromPointList = rectFromPointList(source[key]);
    if (fromPointList) return fromPointList;
  }

  if (isObjectLike(source.corners)) {
    const corners = source.corners;
    const fromCorners = rectFromPointList([
      corners.topLeft || corners.top_left,
      corners.topRight || corners.top_right,
      corners.bottomRight || corners.bottom_right,
      corners.bottomLeft || corners.bottom_left,
    ]);
    if (fromCorners) return fromCorners;
  }

  const fromCornerPoints = rectFromPointList([
    source.topLeft || source.top_left,
    source.topRight || source.top_right,
    source.bottomRight || source.bottom_right,
    source.bottomLeft || source.bottom_left,
  ]);
  if (fromCornerPoints) return fromCornerPoints;

  return null;
}

function normalizeCoordSpace(value) {
  const token = normalizeToken(value);
  if (!token) return "";
  if (token === "ratio" || token.includes("normalizedratio")) return "ratio";
  if (token === "percent" || token === "percentage" || token.includes("pct")) return "percent";
  if (token === "pixels" || token === "pixel" || token === "px") return "pixels";
  if (token === "thousand" || token.includes("thousand")) return "thousand";
  return "";
}

function hasThousandScaleHint(entry) {
  const candidates = [
    entry?.scale,
    entry?.coordinateScale,
    entry?.coordinate_scale,
    entry?.bounds?.scale,
    entry?.bbox?.scale,
    entry?.box?.scale,
    entry?.rect?.scale,
  ];

  for (const candidate of candidates) {
    const numeric = parseFiniteNumber(candidate);
    if (Number.isFinite(numeric) && numeric >= 900 && numeric <= 1100) {
      return true;
    }
  }

  const textHints = [
    entry?.units,
    entry?.unit,
    entry?.coordSpace,
    entry?.coord_space,
    entry?.space,
    entry?.bounds?.units,
    entry?.bbox?.units,
  ];
  return textHints.some((value) => normalizeCoordSpace(value) === "thousand");
}

function inferCoordSpace(rect, entry) {
  const x = Number(rect?.x);
  const y = Number(rect?.y);
  const w = Number(rect?.w);
  const h = Number(rect?.h);
  const values = [x, y, w, h].filter((value) => Number.isFinite(value));
  if (!values.length) return "";

  const maxCoord = Math.max(...values.map((value) => Math.abs(value)));
  const minCoord = Math.min(...values);
  const nonNegative = minCoord >= 0;

  if (nonNegative && maxCoord <= 1.2) return "ratio";
  if (nonNegative && maxCoord <= 100.5) return "percent";
  if (maxCoord >= 1400) return "pixels";
  if (hasThousandScaleHint(entry) && maxCoord > 100 && maxCoord <= 1200) return "thousand";
  return "";
}

function extractRawRect(entry) {
  const candidates = [
    entry,
    entry?.bounds,
    entry?.bbox,
    entry?.box,
    entry?.rect,
    entry?.region,
    entry?.location,
    entry?.position,
    entry?.frame,
    entry?.geometry,
    entry?.boundingBox,
    entry?.bounding_box,
    entry?.coordinates,
  ];

  for (const candidate of candidates) {
    const rect = extractRectFromObject(candidate);
    if (rect) return rect;
  }

  return null;
}

function sanitizeDetectedDish(entry) {
  const name = asText(
    entry?.name || entry?.dishName || entry?.item || entry?.label || entry?.title,
  );
  if (!name) return null;

  const rawRect = extractRawRect(entry);
  if (!rawRect) return null;

  const rawX = Number(rawRect.x);
  const rawY = Number(rawRect.y);
  const rawW = Number(rawRect.w);
  const rawH = Number(rawRect.h);

  if (
    !Number.isFinite(rawX) ||
    !Number.isFinite(rawY) ||
    !Number.isFinite(rawW) ||
    !Number.isFinite(rawH) ||
    rawW <= 0 ||
    rawH <= 0
  ) {
    return null;
  }

  const explicitCoordSpace = normalizeCoordSpace(
    entry?.coordSpace ||
      entry?.coord_space ||
      entry?.space ||
      entry?.units ||
      entry?.unit,
  );
  const inferredCoordSpace = inferCoordSpace(rawRect, entry);
  const coordSpace = explicitCoordSpace || inferredCoordSpace;

  const output = {
    name,
    x: roundCoord(rawX),
    y: roundCoord(rawY),
    w: roundCoord(rawW),
    h: roundCoord(rawH),
  };

  if (coordSpace) {
    output.coordSpace = coordSpace;
  }

  return output;
}

function dedupeDishes(dishes) {
  const seen = new Set();
  return (Array.isArray(dishes) ? dishes : []).filter((dish) => {
    const token = normalizeToken(dish?.name);
    if (!token || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

function extractTextContent(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const text = blocks
    .filter(
      (block) =>
        block &&
        typeof block === "object" &&
        typeof block.text === "string" &&
        (block.type === "text" || block.type === "output_text" || !block.type),
    )
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text || asText(payload?.content);
}

function readFirstEnv(keys) {
  for (const key of keys) {
    const value = asText(process.env[key]);
    if (value) return value;
  }
  return "";
}

function summarizeCoordModes(items) {
  return (Array.isArray(items) ? items : []).reduce((accumulator, item) => {
    const key = asText(item?._mode) || "unknown";
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function buildAnthropicImageBlock(image) {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: image.mediaType,
      data: image.base64Data,
    },
  };
}

async function callAnthropicMessages({
  apiKey,
  model,
  systemPrompt,
  content,
  maxTokens = 4000,
}) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: asText(model) || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content,
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

  return {
    payload,
    responseText: extractTextContent(payload),
  };
}

function parseVisionWord(word) {
  const text = asText(
    (Array.isArray(word?.symbols) ? word.symbols : [])
      .map((symbol) => asText(symbol?.text))
      .join(""),
  );
  const vertices = Array.isArray(word?.boundingBox?.vertices) ? word.boundingBox.vertices : [];
  if (!text || vertices.length < 4) return null;

  const xs = vertices.map((vertex) => Number(vertex?.x) || 0);
  const ys = vertices.map((vertex) => Number(vertex?.y) || 0);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const width = Math.max(x1 - x0, 1);
  const height = Math.max(y1 - y0, 1);

  return {
    text,
    bbox: { x0, y0, x1, y1 },
    centerX: x0 + width / 2,
    centerY: y0 + height / 2,
    width,
    height,
  };
}

function groupVisionLines(words) {
  const sorted = (Array.isArray(words) ? words : [])
    .filter(Boolean)
    .sort((a, b) => a.centerY - b.centerY || a.bbox.x0 - b.bbox.x0);
  if (!sorted.length) return [];

  const heights = sorted.map((word) => Math.max(Number(word.height) || 0, 1)).sort((a, b) => a - b);
  const mid = Math.floor(heights.length / 2);
  const medianHeight =
    heights.length % 2 === 0 ? (heights[mid - 1] + heights[mid]) / 2 : heights[mid];
  const yTolerance = Math.max(12, medianHeight * 0.75);

  const grouped = [];
  sorted.forEach((word) => {
    const last = grouped[grouped.length - 1];
    if (!last) {
      grouped.push({ words: [word], centerY: word.centerY });
      return;
    }

    if (Math.abs(word.centerY - last.centerY) <= yTolerance) {
      last.words.push(word);
      const centerSum = last.words.reduce((sum, item) => sum + item.centerY, 0);
      last.centerY = centerSum / last.words.length;
      return;
    }

    grouped.push({ words: [word], centerY: word.centerY });
  });

  return grouped
    .map((group, index) => {
      const lineWords = [...group.words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
      const text = lineWords.map((item) => item.text).join(" ").trim();
      if (!text) return null;

      const x0 = Math.min(...lineWords.map((item) => item.bbox.x0));
      const x1 = Math.max(...lineWords.map((item) => item.bbox.x1));
      const y0 = Math.min(...lineWords.map((item) => item.bbox.y0));
      const y1 = Math.max(...lineWords.map((item) => item.bbox.y1));

      return {
        index,
        text,
        bbox: { x0, y0, x1, y1 },
        wordCount: lineWords.length,
      };
    })
    .filter(Boolean);
}

function compactVisionForPrompt(vision, { maxWords = 280, maxLines = 140 } = {}) {
  const words = Array.isArray(vision?.words) ? vision.words : [];
  const lines = Array.isArray(vision?.lines) ? vision.lines : [];

  return {
    pageWidth: Number.isFinite(Number(vision?.pageWidth)) ? Number(vision.pageWidth) : REMAP_CANVAS_SIZE,
    pageHeight: Number.isFinite(Number(vision?.pageHeight)) ? Number(vision.pageHeight) : REMAP_CANVAS_SIZE,
    totalWordCount: words.length,
    totalLineCount: lines.length,
    lines: lines.slice(0, maxLines).map((line) => ({
      text: line.text,
      bbox: {
        x0: roundCoord(line?.bbox?.x0, 2),
        y0: roundCoord(line?.bbox?.y0, 2),
        x1: roundCoord(line?.bbox?.x1, 2),
        y1: roundCoord(line?.bbox?.y1, 2),
      },
      wordCount: Number(line?.wordCount) || 0,
    })),
    words: words.slice(0, maxWords).map((word) => ({
      text: word.text,
      bbox: {
        x0: roundCoord(word?.bbox?.x0, 2),
        y0: roundCoord(word?.bbox?.y0, 2),
        x1: roundCoord(word?.bbox?.x1, 2),
        y1: roundCoord(word?.bbox?.y1, 2),
      },
    })),
  };
}

async function getVisionAnalysis({ googleVisionApiKey, base64Data }) {
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(googleVisionApiKey)}`,
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
      "Google Vision OCR request failed.";
    throw new Error(message);
  }

  const responseError = asText(payload?.responses?.[0]?.error?.message);
  if (responseError) {
    throw new Error(responseError);
  }

  const annotation = payload?.responses?.[0]?.fullTextAnnotation;
  const firstPage = annotation?.pages?.[0] || {};
  const pageWidth =
    Number.isFinite(Number(firstPage?.width)) && Number(firstPage?.width) > 0
      ? Number(firstPage.width)
      : REMAP_CANVAS_SIZE;
  const pageHeight =
    Number.isFinite(Number(firstPage?.height)) && Number(firstPage?.height) > 0
      ? Number(firstPage.height)
      : REMAP_CANVAS_SIZE;

  const words = [];
  (annotation?.pages || []).forEach((page) => {
    (page?.blocks || []).forEach((block) => {
      (block?.paragraphs || []).forEach((paragraph) => {
        (paragraph?.words || []).forEach((word) => {
          const parsedWord = parseVisionWord(word);
          if (!parsedWord) return;
          words.push(parsedWord);
        });
      });
    });
  });

  const lines = groupVisionLines(words);
  return {
    words,
    lines,
    pageWidth,
    pageHeight,
  };
}

function convertRectToThousand({
  x,
  y,
  w,
  h,
  coordSpace,
  imageWidth,
  imageHeight,
}) {
  const values = [x, y, w, h].map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) return null;

  let [nextX, nextY, nextW, nextH] = values;
  if (nextW <= 0 || nextH <= 0) return null;

  const nonNegative = Math.min(nextX, nextY, nextW, nextH) >= 0;
  const maxAbs = Math.max(Math.abs(nextX), Math.abs(nextY), Math.abs(nextW), Math.abs(nextH));

  const hasDimensions =
    Number.isFinite(Number(imageWidth)) &&
    Number.isFinite(Number(imageHeight)) &&
    Number(imageWidth) > 0 &&
    Number(imageHeight) > 0;

  const widthValue = Number(imageWidth);
  const heightValue = Number(imageHeight);

  const fitsPercent =
    nonNegative &&
    nextX <= 100.5 &&
    nextY <= 100.5 &&
    nextW <= 100.5 &&
    nextH <= 100.5 &&
    nextX + nextW <= 100.5 &&
    nextY + nextH <= 100.5;

  const fitsThousand =
    nonNegative &&
    nextX <= 1200 &&
    nextY <= 1200 &&
    nextW <= 1200 &&
    nextH <= 1200 &&
    nextX + nextW <= 1200 &&
    nextY + nextH <= 1200;

  const looksPixels =
    hasDimensions &&
    nonNegative &&
    nextX <= widthValue * 1.1 &&
    nextW <= widthValue * 1.1 &&
    nextY <= heightValue * 1.1 &&
    nextH <= heightValue * 1.1 &&
    nextX + nextW <= widthValue * 1.1 &&
    nextY + nextH <= heightValue * 1.1;

  let mode = normalizeCoordSpace(coordSpace);
  if (!mode) {
    if (nonNegative && maxAbs <= 1.2) {
      mode = "ratio";
    } else if (fitsPercent) {
      mode = "percent";
    } else if (looksPixels) {
      mode = "pixels";
    } else if (fitsThousand) {
      mode = "thousand";
    }
  }

  if (mode === "ratio") {
    nextX *= 1000;
    nextY *= 1000;
    nextW *= 1000;
    nextH *= 1000;
  } else if (mode === "percent") {
    nextX *= 10;
    nextY *= 10;
    nextW *= 10;
    nextH *= 10;
  } else if (mode === "pixels") {
    if (!hasDimensions) return null;
    nextX = (nextX / widthValue) * 1000;
    nextY = (nextY / heightValue) * 1000;
    nextW = (nextW / widthValue) * 1000;
    nextH = (nextH / heightValue) * 1000;
  } else if (mode === "thousand") {
    // Already in target space.
  } else {
    return null;
  }

  nextX = clamp(nextX, 0, REMAP_CANVAS_SIZE);
  nextY = clamp(nextY, 0, REMAP_CANVAS_SIZE);
  if (nextX > REMAP_CANVAS_SIZE - 1) nextX = REMAP_CANVAS_SIZE - 1;
  if (nextY > REMAP_CANVAS_SIZE - 1) nextY = REMAP_CANVAS_SIZE - 1;

  nextW = clamp(nextW, 1, REMAP_CANVAS_SIZE - nextX);
  nextH = clamp(nextH, 1, REMAP_CANVAS_SIZE - nextY);

  return {
    x: roundCoord(nextX),
    y: roundCoord(nextY),
    w: roundCoord(nextW),
    h: roundCoord(nextH),
    mode: mode || "unknown",
  };
}

function sanitizeRemapOverlay(entry, options = {}) {
  const name = asText(
    entry?.name || entry?.dishName || entry?.item || entry?.label || entry?.title,
  );
  if (!name) return null;

  const rawRect = extractRawRect(entry);
  if (!rawRect) return null;

  const explicitCoordSpace = normalizeCoordSpace(
    entry?.coordSpace ||
      entry?.coord_space ||
      entry?.space ||
      entry?.units ||
      entry?.unit,
  );
  const inferredCoordSpace = inferCoordSpace(rawRect, entry);
  const coordSpace = explicitCoordSpace || inferredCoordSpace;

  const normalized = convertRectToThousand({
    x: rawRect.x,
    y: rawRect.y,
    w: rawRect.w,
    h: rawRect.h,
    coordSpace,
    imageWidth: options.imageWidth,
    imageHeight: options.imageHeight,
  });

  if (!normalized) return null;

  return {
    name,
    x: normalized.x,
    y: normalized.y,
    w: normalized.w,
    h: normalized.h,
    coordSpace: "thousand",
    _mode: normalized.mode,
  };
}

function compactOverlayHints(overlays, limit = 220) {
  return (Array.isArray(overlays) ? overlays : [])
    .slice(0, limit)
    .map((overlay) => ({
      name: asText(overlay?.name),
      x: roundCoord(overlay?.x, 2),
      y: roundCoord(overlay?.y, 2),
      w: roundCoord(overlay?.w, 2),
      h: roundCoord(overlay?.h, 2),
    }))
    .filter((overlay) => overlay.name);
}

function parseRemapArrays(parsed) {
  const updatedRaw = Array.isArray(parsed?.updatedOverlays)
    ? parsed.updatedOverlays
    : Array.isArray(parsed?.updated)
      ? parsed.updated
      : Array.isArray(parsed?.repositioned)
        ? parsed.repositioned
        : [];

  const newRaw = Array.isArray(parsed?.newOverlays)
    ? parsed.newOverlays
    : Array.isArray(parsed?.newDishes)
      ? parsed.newDishes
      : Array.isArray(parsed?.addedOverlays)
        ? parsed.addedOverlays
        : Array.isArray(parsed?.dishes)
          ? parsed.dishes
          : [];

  return {
    updatedRaw,
    newRaw,
  };
}

function normalizeRemapResponse({
  parsed,
  imageWidth,
  imageHeight,
  oldOverlayTokens,
}) {
  const { updatedRaw, newRaw } = parseRemapArrays(parsed);

  const sanitizedUpdatedRaw = updatedRaw
    .map((entry) =>
      sanitizeRemapOverlay(entry, {
        imageWidth,
        imageHeight,
      }),
    )
    .filter(Boolean);

  const sanitizedNewRaw = newRaw
    .map((entry) =>
      sanitizeRemapOverlay(entry, {
        imageWidth,
        imageHeight,
      }),
    )
    .filter(Boolean);

  const updatedOverlays = [];
  const promotedNew = [];
  const seenUpdatedTokens = new Set();

  sanitizedUpdatedRaw.forEach((overlay) => {
    const token = normalizeToken(overlay?.name);
    if (!token || seenUpdatedTokens.has(token)) return;

    if (oldOverlayTokens.size && !oldOverlayTokens.has(token)) {
      promotedNew.push(overlay);
      return;
    }

    seenUpdatedTokens.add(token);
    updatedOverlays.push(overlay);
  });

  const newOverlays = [];
  const seenNewTokens = new Set();
  [...promotedNew, ...sanitizedNewRaw].forEach((overlay) => {
    const token = normalizeToken(overlay?.name);
    if (!token) return;
    if (seenUpdatedTokens.has(token) || seenNewTokens.has(token)) return;
    seenNewTokens.add(token);
    newOverlays.push(overlay);
  });

  const modeCounts = summarizeCoordModes([...updatedOverlays, ...newOverlays]);
  const cleanUpdated = updatedOverlays.map((overlay) => ({
    name: overlay.name,
    x: overlay.x,
    y: overlay.y,
    w: overlay.w,
    h: overlay.h,
    coordSpace: "thousand",
  }));
  const cleanNew = newOverlays.map((overlay) => ({
    name: overlay.name,
    x: overlay.x,
    y: overlay.y,
    w: overlay.w,
    h: overlay.h,
    coordSpace: "thousand",
  }));

  return {
    updatedOverlays: cleanUpdated,
    newOverlays: cleanNew,
    dishes: [...cleanUpdated, ...cleanNew],
    rawDishCount: updatedRaw.length + newRaw.length,
    validDishCount: cleanUpdated.length + cleanNew.length,
    modeCounts,
  };
}

async function runDefaultDishDetection({
  anthropicApiKey,
  model,
  parsedImage,
}) {
  const systemPrompt = `You are a restaurant menu OCR + localization assistant.
Return ONLY valid JSON.

You must detect visible dish/menu item names and output a tight bounding box for each item.
Coordinates must be percentages of the full image:
- x: left position (0-100)
- y: top position (0-100)
- w: width (0-100)
- h: height (0-100)

Required output schema:
{
  "dishes": [
    { "name": "Dish name", "x": 0, "y": 0, "w": 0, "h": 0 }
  ]
}

Rules:
- Include only real menu dishes/items.
- Exclude section headers, category labels, prices-only rows, and decorative text.
- Keep one entry per dish name.
- If uncertain, omit the item.
- No markdown, no commentary, no extra keys.`;

  const userPrompt =
    "Analyze this menu image and return dish names with tight bounding boxes.";

  const { responseText } = await callAnthropicMessages({
    apiKey: anthropicApiKey,
    model,
    systemPrompt,
    maxTokens: 4000,
    content: [
      buildAnthropicImageBlock(parsedImage),
      {
        type: "text",
        text: userPrompt,
      },
    ],
  });

  const parsedResult = parseClaudeJson(responseText);
  const rawDishes = Array.isArray(parsedResult?.dishes)
    ? parsedResult.dishes
    : Array.isArray(parsedResult?.items)
      ? parsedResult.items
      : [];

  const rawDishCount = rawDishes.length;
  const dishes = dedupeDishes(rawDishes.map((entry) => sanitizeDetectedDish(entry)).filter(Boolean));

  return {
    success: true,
    dishes,
    rawDishCount,
    validDishCount: dishes.length,
  };
}

async function runRemapPipeline({
  anthropicApiKey,
  googleVisionApiKey,
  model,
  body,
}) {
  const newImageInput = parseImageData(body?.newImageData || body?.imageData);
  if (!newImageInput) {
    throw new Error("newImageData is required for remap mode.");
  }

  const oldImageInput = parseImageData(body?.oldImageData || "");

  const requestedWidth = Number.isFinite(Number(body?.imageWidth))
    ? Number(body.imageWidth)
    : REMAP_CANVAS_SIZE;
  const requestedHeight = Number.isFinite(Number(body?.imageHeight))
    ? Number(body.imageHeight)
    : REMAP_CANVAS_SIZE;

  const baselineOverlays = dedupeDishes(
    (Array.isArray(body?.overlays) ? body.overlays : [])
      .map((entry) =>
        sanitizeRemapOverlay(entry, {
          imageWidth: requestedWidth,
          imageHeight: requestedHeight,
        }),
      )
      .filter(Boolean),
  );

  const oldOverlayTokens = new Set(
    baselineOverlays.map((overlay) => normalizeToken(overlay?.name)).filter(Boolean),
  );

  const [newVision, oldVision] = await Promise.all([
    getVisionAnalysis({
      googleVisionApiKey,
      base64Data: newImageInput.base64Data,
    }),
    oldImageInput
      ? getVisionAnalysis({
          googleVisionApiKey,
          base64Data: oldImageInput.base64Data,
        })
      : Promise.resolve(null),
  ]);

  const remapContext = {
    pageIndex: Number.isFinite(Number(body?.pageIndex)) ? Number(body.pageIndex) : null,
    targetCoordinateSpace:
      "All overlay coordinates MUST be x/y/w/h on a 0-1000 letterboxed canvas for the NEW image.",
    oldOverlayHints: compactOverlayHints(baselineOverlays),
    newImageVision: compactVisionForPrompt(newVision),
    oldImageVision: oldVision ? compactVisionForPrompt(oldVision) : null,
  };

  const systemPrompt = `You are a menu-overlay remapping assistant.
Return ONLY valid JSON.

You will receive:
- Existing dish overlays from an OLD menu image.
- OCR geometry/text for OLD and NEW menu images.

Task:
1) Reposition overlays for dishes that still exist onto the NEW image.
2) Propose overlays for NEW dishes not present in old overlays.

Output schema:
{
  "updatedOverlays": [
    {"name":"Dish Name","x":0,"y":0,"w":0,"h":0}
  ],
  "newOverlays": [
    {"name":"Dish Name","x":0,"y":0,"w":0,"h":0}
  ]
}

Strict rules:
- Coordinates MUST be in 0-1000 for the NEW image letterboxed canvas.
- Use tight boxes around the dish line (name + optional price line area only).
- Include only actual dish items.
- Exclude section headers, category labels, and decorative text.
- Keep one entry per dish name.
- If uncertain, omit the dish.
- No markdown, no commentary, no extra root keys.`;

  const userPrompt = `Remap overlays using this context JSON:\n${JSON.stringify(remapContext)}`;

  const content = [];
  if (oldImageInput) {
    content.push({
      type: "text",
      text: "OLD MENU IMAGE (reference for existing overlays)",
    });
    content.push(buildAnthropicImageBlock(oldImageInput));
  }

  content.push({
    type: "text",
    text: "NEW MENU IMAGE (target for output coordinates)",
  });
  content.push(buildAnthropicImageBlock(newImageInput));
  content.push({
    type: "text",
    text: userPrompt,
  });

  const { responseText } = await callAnthropicMessages({
    apiKey: anthropicApiKey,
    model,
    systemPrompt,
    content,
    maxTokens: 5000,
  });

  const parsed = parseClaudeJson(responseText);
  if (!parsed) {
    throw new Error("Failed to parse remap analysis output.");
  }

  const normalized = normalizeRemapResponse({
    parsed,
    imageWidth: requestedWidth,
    imageHeight: requestedHeight,
    oldOverlayTokens,
  });

  if (process.env.NODE_ENV !== "production") {
    console.debug("[menu-image-analysis] remap", {
      pageIndex: remapContext.pageIndex,
      baselineOverlayCount: baselineOverlays.length,
      oldVisionWords: oldVision?.words?.length || 0,
      newVisionWords: newVision?.words?.length || 0,
      rawDishCount: normalized.rawDishCount,
      validDishCount: normalized.validDishCount,
      updatedCount: normalized.updatedOverlays.length,
      newCount: normalized.newOverlays.length,
      modeCounts: normalized.modeCounts,
    });
  }

  return {
    success: true,
    dishes: normalized.dishes,
    updatedOverlays: normalized.updatedOverlays,
    newOverlays: normalized.newOverlays,
    rawDishCount: normalized.rawDishCount,
    validDishCount: normalized.validDishCount,
  };
}

export function OPTIONS() {
  return corsOptions();
}

export async function POST(request) {
  let body = null;
  try {
    body = await request.json();
  } catch {
    return corsJson(
      {
        success: false,
        error: "Invalid JSON payload.",
        dishes: [],
        updatedOverlays: [],
        newOverlays: [],
        rawDishCount: 0,
        validDishCount: 0,
      },
      { status: 400 },
    );
  }

  const anthropicApiKey = readFirstEnv(["ANTHROPIC_API_KEY"]);
  if (!anthropicApiKey) {
    return corsJson(
      {
        success: false,
        error: "ANTHROPIC_API_KEY is not configured.",
        dishes: [],
        updatedOverlays: [],
        newOverlays: [],
        rawDishCount: 0,
        validDishCount: 0,
      },
      { status: 500 },
    );
  }

  const mode = normalizeToken(body?.mode);
  const model = asText(process.env.ANTHROPIC_MODEL) || DEFAULT_ANTHROPIC_MODEL;

  try {
    if (mode === "remap") {
      const googleVisionApiKey = readFirstEnv(["GOOGLE_VISION_API_KEY"]);
      if (!googleVisionApiKey) {
        throw new Error("GOOGLE_VISION_API_KEY is not configured.");
      }

      const result = await runRemapPipeline({
        anthropicApiKey,
        googleVisionApiKey,
        model,
        body,
      });

      return corsJson(result, { status: 200 });
    }

    const imageData = asText(body?.imageData);
    if (!imageData) {
      return corsJson(
        {
          success: false,
          error: "imageData is required.",
          dishes: [],
          updatedOverlays: [],
          newOverlays: [],
          rawDishCount: 0,
          validDishCount: 0,
        },
        { status: 400 },
      );
    }

    const parsedImage = parseImageData(imageData);
    if (!parsedImage) {
      return corsJson(
        {
          success: false,
          error: "Unable to parse menu image payload.",
          dishes: [],
          updatedOverlays: [],
          newOverlays: [],
          rawDishCount: 0,
          validDishCount: 0,
        },
        { status: 400 },
      );
    }

    const result = await runDefaultDishDetection({
      anthropicApiKey,
      model,
      parsedImage,
    });

    return corsJson(
      {
        ...result,
        updatedOverlays: [],
        newOverlays: [],
      },
      { status: 200 },
    );
  } catch (error) {
    return corsJson(
      {
        success: false,
        error: asText(error?.message) || "Failed to analyze menu image.",
        dishes: [],
        updatedOverlays: [],
        newOverlays: [],
        rawDishCount: 0,
        validDishCount: 0,
      },
      { status: 500 },
    );
  }
}
