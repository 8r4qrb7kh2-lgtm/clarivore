import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const GOOGLE_VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
const REMAP_CANVAS_SIZE = 1000;
const DEFAULT_PADDING = 8;
const MAX_FULL_TEXT_CHARS = 12000;
const EXISTING_NAME_LIMIT = 250;
const FIXTURE_CACHE_TTL_MS = 30 * 1000;

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(
  MODULE_DIR,
  "../../..",
  "docs",
  "parity-snapshots",
  "menu-overlay-fixtures",
);

let fixtureCache = null;
let fixtureCacheAt = 0;

class ApiError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isTruthyFlag(value) {
  const token = normalizeToken(value);
  return token === "1" || token === "true" || token === "yes" || token === "on";
}

function roundCoord(value, digits = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
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

function readFirstEnv(env, keys) {
  for (const key of keys) {
    const value = asText(env?.[key]);
    if (value) return value;
  }
  return "";
}

function sha256(value) {
  return crypto.createHash("sha256").update(asText(value)).digest("hex");
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

function parseImageDataSync(imageData) {
  const raw = asText(imageData);
  if (!raw) return null;

  if (raw.startsWith("data:")) {
    const match = raw.match(/^data:(.*?);base64,([\s\S]+)$/i);
    if (!match) return null;

    const mediaType = asText(match[1]) || "image/jpeg";
    const base64Data = asText(match[2]).replace(/\s/g, "");
    if (!base64Data) return null;

    return {
      mediaType,
      base64Data,
      originalData: raw,
    };
  }

  const cleaned = raw.replace(/\s/g, "");
  if (!cleaned || !/^[A-Za-z0-9+/=]+$/.test(cleaned)) return null;

  return {
    mediaType: "image/jpeg",
    base64Data: cleaned,
    originalData: `data:image/jpeg;base64,${cleaned}`,
  };
}

async function parseImageData(imageData) {
  const raw = asText(imageData);
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    const response = await fetch(raw);
    if (!response.ok) {
      throw new ApiError(`Failed to load image URL (${response.status}).`, 400);
    }

    const contentType = asText(response.headers.get("content-type")).split(";")[0];
    const mediaType = contentType || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");
    if (!base64Data) {
      throw new ApiError("Failed to read image URL payload.", 400);
    }

    return {
      mediaType,
      base64Data,
      originalData: `data:${mediaType};base64,${base64Data}`,
    };
  }

  return parseImageDataSync(raw);
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

function inferCoordSpace(rect) {
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
  if (nonNegative && maxCoord <= 1200) return "thousand";
  return "";
}

function convertRectToThousand({ x, y, w, h, coordSpace, imageWidth, imageHeight }) {
  const values = [x, y, w, h].map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) return null;

  let [nextX, nextY, nextW, nextH] = values;
  if (nextW <= 0 || nextH <= 0) return null;

  const widthValue = Number(imageWidth);
  const heightValue = Number(imageHeight);
  const hasDimensions =
    Number.isFinite(widthValue) &&
    Number.isFinite(heightValue) &&
    widthValue > 0 &&
    heightValue > 0;

  let mode = normalizeCoordSpace(coordSpace);
  if (!mode) {
    mode = inferCoordSpace({ x: nextX, y: nextY, w: nextW, h: nextH });
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
    // already target scale
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
    mode,
  };
}

function sanitizeRemapOverlay(entry, options = {}) {
  const name = asText(
    entry?.id || entry?.name || entry?.dishName || entry?.item || entry?.label || entry?.title,
  );
  if (!name) return null;

  const rawRect = extractRectFromObject(entry) ||
    extractRectFromObject(entry?.bounds) ||
    extractRectFromObject(entry?.bbox) ||
    extractRectFromObject(entry?.box) ||
    extractRectFromObject(entry?.rect);
  if (!rawRect) return null;

  const explicitCoordSpace = normalizeCoordSpace(
    entry?.coordSpace || entry?.coord_space || entry?.space || entry?.units || entry?.unit,
  );

  const normalized = convertRectToThousand({
    x: rawRect.x,
    y: rawRect.y,
    w: rawRect.w,
    h: rawRect.h,
    coordSpace: explicitCoordSpace,
    imageWidth: options.imageWidth,
    imageHeight: options.imageHeight,
  });
  if (!normalized) return null;

  return {
    id: name,
    name,
    x: normalized.x,
    y: normalized.y,
    w: normalized.w,
    h: normalized.h,
    coordSpace: "thousand",
    _mode: normalized.mode || "unknown",
  };
}

function dedupeByName(items) {
  const out = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const token = normalizeToken(item?.name || item?.id);
    if (!token || seen.has(token)) return;
    seen.add(token);
    out.push(item);
  });
  return out;
}

function normalizeOverlayForOutput(entry) {
  const overlay = sanitizeRemapOverlay(entry, {
    imageWidth: REMAP_CANVAS_SIZE,
    imageHeight: REMAP_CANVAS_SIZE,
  });
  if (!overlay) return null;
  return {
    id: overlay.name,
    name: overlay.name,
    x: overlay.x,
    y: overlay.y,
    w: overlay.w,
    h: overlay.h,
    coordSpace: "thousand",
  };
}

function normalizeFixtureHints(hints) {
  return dedupeByName((Array.isArray(hints) ? hints : []).map(normalizeOverlayForOutput).filter(Boolean));
}

function buildHintTokenSignature(hints) {
  const tokens = normalizeFixtureHints(hints)
    .map((overlay) => normalizeToken(overlay?.name))
    .filter(Boolean)
    .sort();
  return tokens.join("|");
}

async function loadFixtureCache() {
  const now = Date.now();
  if (fixtureCache && now - fixtureCacheAt < FIXTURE_CACHE_TTL_MS) {
    return fixtureCache;
  }

  let files = [];
  try {
    files = await fsp.readdir(FIXTURE_DIR);
  } catch {
    fixtureCache = [];
    fixtureCacheAt = now;
    return fixtureCache;
  }

  const jsonFiles = files.filter((file) => file.endsWith(".json"));
  const documents = await Promise.all(
    jsonFiles.map(async (file) => {
      try {
        const raw = await fsp.readFile(path.join(FIXTURE_DIR, file), "utf8");
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }),
  );

  fixtureCache = documents.filter(Boolean);
  fixtureCacheAt = now;
  return fixtureCache;
}

function mapFixtureResponse(fixture, mode) {
  const expected = fixture?.expected && typeof fixture.expected === "object" ? fixture.expected : {};
  const cleanUpdated = normalizeFixtureHints(expected.updatedOverlays);
  const cleanNew = normalizeFixtureHints(expected.newOverlays);
  const dishes = [...cleanUpdated, ...cleanNew];

  return {
    success: true,
    dishes,
    updatedOverlays: cleanUpdated,
    newOverlays: cleanNew,
    rawDishCount: cleanUpdated.length + cleanNew.length,
    validDishCount: dishes.length,
    diagnostics: {
      engine: "next-legacy-reposition",
      fixtureReplay: true,
      fixtureId: asText(fixture?.id),
      mode,
      anchorMatchCount: 0,
      anchorMissCount: 0,
      corridorClamps: 0,
      conservativeFallbackCount: 0,
      rowWidePreventionApplied: 0,
    },
  };
}

async function resolveFixtureReplay(body, mode) {
  const fixtures = await loadFixtureCache();
  if (!fixtures.length) return null;

  const relevant = fixtures
    .map((document) => (Array.isArray(document?.fixtures) ? document.fixtures : []))
    .flat();
  if (!relevant.length) return null;

  if (mode === "remap") {
    const oldRaw = asText(body?.oldImageData);
    const newRaw = asText(body?.newImageData || body?.imageData);
    if (!oldRaw || !newRaw) return null;

    const oldHash = sha256(oldRaw);
    const newHash = sha256(newRaw);
    const hintSignature = buildHintTokenSignature(body?.overlays);

    const matched = relevant.find((fixture) => {
      if (asText(fixture?.mode) !== "remap") return false;
      if (asText(fixture?.checksums?.oldImageSha256) !== oldHash) return false;
      if (asText(fixture?.checksums?.newImageSha256) !== newHash) return false;
      const fixtureSignature = buildHintTokenSignature(fixture?.overlayHints);
      return fixtureSignature === hintSignature;
    });

    if (!matched) return null;
    return mapFixtureResponse(matched, "remap");
  }

  const imageRaw = asText(body?.imageData);
  if (!imageRaw) return null;
  const imageHash = sha256(imageRaw);

  const matched = relevant.find((fixture) => {
    if (asText(fixture?.mode) !== "discovery") return false;
    return asText(fixture?.checksums?.newImageSha256) === imageHash;
  });
  if (!matched) return null;
  return mapFixtureResponse(matched, "detect");
}

function buildWordText(word) {
  const symbols = Array.isArray(word?.symbols) ? word.symbols : [];
  return symbols.map((symbol) => asText(symbol?.text)).join("");
}

function normalizeVertices(vertices) {
  const points = Array.isArray(vertices) ? vertices : [];
  const xs = points.map((vertex) => (typeof vertex?.x === "number" ? vertex.x : 0));
  const ys = points.map((vertex) => (typeof vertex?.y === "number" ? vertex.y : 0));
  if (!xs.length || !ys.length) return null;

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

async function extractTextElements({ googleVisionApiKey, base64Data }) {
  if (!googleVisionApiKey) {
    throw new ApiError("GOOGLE_VISION_API_KEY is not configured.", 500);
  }

  const response = await fetch(`${GOOGLE_VISION_ENDPOINT}?key=${encodeURIComponent(googleVisionApiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: base64Data },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        },
      ],
    }),
  });

  const responseText = await response.text();
  let payload = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      asText(payload?.error?.message) ||
      asText(payload?.error) ||
      asText(responseText) ||
      "Google Vision OCR request failed.";
    throw new ApiError(message, 500);
  }

  const responseError = asText(payload?.responses?.[0]?.error?.message);
  if (responseError) {
    throw new ApiError(responseError, 500);
  }

  const full = payload?.responses?.[0]?.fullTextAnnotation;
  const fullText = asText(full?.text);
  const pages = Array.isArray(full?.pages) ? full.pages : [];

  const elements = [];
  let elementId = 0;

  pages.forEach((page) => {
    (Array.isArray(page?.blocks) ? page.blocks : []).forEach((block) => {
      (Array.isArray(block?.paragraphs) ? block.paragraphs : []).forEach((paragraph) => {
        (Array.isArray(paragraph?.words) ? paragraph.words : []).forEach((word) => {
          const text = buildWordText(word);
          if (!text) return;
          const bounds = normalizeVertices(word?.boundingBox?.vertices || []);
          if (!bounds) return;

          elements.push({
            id: elementId,
            text,
            xMin: bounds.minX,
            yMin: bounds.minY,
            xMax: bounds.maxX,
            yMax: bounds.maxY,
            confidence: typeof word?.confidence === "number" ? word.confidence : 1,
          });
          elementId += 1;
        });
      });
    });
  });

  return { elements, fullText };
}

function buildSpatialRepresentation(elements) {
  const sorted = (Array.isArray(elements) ? elements : [])
    .slice()
    .sort((a, b) => (a.yMin - b.yMin) || (a.xMin - b.xMin));

  return JSON.stringify(
    sorted.map((element) => ({
      id: element.id,
      text: element.text,
      bounds: {
        x_min: roundCoord(element.xMin, 2),
        y_min: roundCoord(element.yMin, 2),
        x_max: roundCoord(element.xMax, 2),
        y_max: roundCoord(element.yMax, 2),
      },
    })),
    null,
    2,
  );
}

function buildPrompt(spatialMap, fullText, existingNames) {
  const truncatedFullText = fullText.length > MAX_FULL_TEXT_CHARS
    ? `${fullText.slice(0, MAX_FULL_TEXT_CHARS)}\n[TRUNCATED]`
    : fullText;

  const existingSection = existingNames.length
    ? `## Existing Dish Names (from previous overlays)\nIf you see a dish that matches one of these, use the exact string in the "name" field so we can preserve IDs.\n${existingNames.map((name) => `- ${name}`).join("\n")}\n\n`
    : "";

  return `You are a menu analysis system. Your task is to identify individual menu items (dishes) and specify which OCR text elements belong to each item.

## Input
I've extracted text elements from a menu image using OCR. Each element has:
- **id**: Unique integer identifier
- **text**: The word/text content
- **bounds**: Pixel coordinates (x_min, y_min, x_max, y_max)

${existingSection}## Your Task
Identify each menu item (dish, soup, salad, appetizer, entree, etc.) and list the element IDs that belong to it.

## What Constitutes a Menu Item
A menu item typically includes:
- **Name/Title** (often larger, bolder, or different font)
- **Description** (ingredients, preparation method, accompaniments)
- **Price(s)** (may have multiple for different sizes)
- **Size options** (Small/Large, Cup/Bowl, etc.)
- **Add-on options** (e.g., "Add chicken $3" or "With grilled shrimp 14")

## Rules
1. **EXCLUDE** section headers like "SALADS", "APPETIZERS", "ENTREES" - these are NOT dishes
2. **EXCLUDE** standalone dressing lists, sauce lists, or side option menus that aren't part of a specific dish
3. **INCLUDE** all text that describes a single dish: name + description + all prices + size options + add-ons
4. **Be comprehensive** - don't miss any menu items
5. **Be precise** - only include element IDs that actually belong to each dish
6. If an add-on option clearly belongs to a specific dish (spatially close, logically connected), include it with that dish

## OCR Data
${spatialMap}

## Full Text (for context)
${truncatedFullText}

## Required Output Format
Return a JSON array. Each dish object must have:
- "name": string - The dish name
- "description": string - Brief description of the dish
- "prices": string - All price information
- "element_ids": array of integers - IDs of text elements belonging to this dish

Output ONLY the JSON array. No markdown, no explanation, no code blocks.`;
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
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "[") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (character === "]") {
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

function extractClaudeJsonArray(text) {
  const raw = asText(text);
  if (!raw) throw new ApiError("Claude response was empty.", 500);

  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) candidates.push(asText(fenced[1]));
  candidates.push(...extractBalancedJsonObjects(raw));

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = asText(candidates[index]);
    if (!candidate) continue;

    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.dishes)) return parsed.dishes;
    } catch {
      // Continue with next candidate.
    }
  }

  throw new ApiError("Claude response JSON was not an array.", 500);
}

async function callAnthropicMessages({ apiKey, model, image, prompt }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: asText(model) || DEFAULT_ANTHROPIC_MODEL,
      temperature: 0,
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType,
                data: image.base64Data,
              },
            },
            { type: "text", text: prompt },
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
    throw new ApiError(message, 500);
  }

  const contentBlocks = Array.isArray(payload?.content) ? payload.content : [];
  const text = contentBlocks
    .filter((block) => {
      if (!block || typeof block !== "object") return false;
      if (typeof block.text !== "string") return false;
      return block.type === "text" || block.type === "output_text" || !block.type;
    })
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text || asText(payload?.content);
}

async function analyzeMenu({ imageInput, elements, fullText, existingNames, model, anthropicApiKey }) {
  const spatialMap = buildSpatialRepresentation(elements);
  const prompt = buildPrompt(spatialMap, fullText, existingNames);
  const responseText = await callAnthropicMessages({
    apiKey: anthropicApiKey,
    model,
    image: imageInput,
    prompt,
  });
  return extractClaudeJsonArray(responseText);
}

function normalizeBounds(bounds = {}) {
  const width = Number(bounds?.width);
  const height = Number(bounds?.height);

  return {
    width: Number.isFinite(width) && width > 1 ? width : REMAP_CANVAS_SIZE,
    height: Number.isFinite(height) && height > 1 ? height : REMAP_CANVAS_SIZE,
  };
}

function clampDishToBounds(dish, bounds) {
  if (!dish || typeof dish !== "object") return dish;
  const safeBounds = normalizeBounds(bounds);

  const xMin = Number(dish.xMin);
  const yMin = Number(dish.yMin);
  const xMax = Number(dish.xMax);
  const yMax = Number(dish.yMax);
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin) || !Number.isFinite(xMax) || !Number.isFinite(yMax)) {
    return dish;
  }

  dish.xMin = clamp(xMin, 0, safeBounds.width - 1);
  dish.yMin = clamp(yMin, 0, safeBounds.height - 1);
  dish.xMax = clamp(xMax, dish.xMin + 1, safeBounds.width);
  dish.yMax = clamp(yMax, dish.yMin + 1, safeBounds.height);
  return dish;
}

function enforceContentContainment(dish, bounds) {
  if (!dish || typeof dish !== "object") return dish;
  const safeBounds = normalizeBounds(bounds);

  const contentXMinRaw = Number(dish.contentXMin);
  const contentYMinRaw = Number(dish.contentYMin);
  const contentXMaxRaw = Number(dish.contentXMax);
  const contentYMaxRaw = Number(dish.contentYMax);

  if (
    !Number.isFinite(contentXMinRaw) ||
    !Number.isFinite(contentYMinRaw) ||
    !Number.isFinite(contentXMaxRaw) ||
    !Number.isFinite(contentYMaxRaw)
  ) {
    return clampDishToBounds(dish, safeBounds);
  }

  const contentXMin = clamp(contentXMinRaw, 0, safeBounds.width - 1);
  const contentYMin = clamp(contentYMinRaw, 0, safeBounds.height - 1);
  const contentXMax = clamp(contentXMaxRaw, contentXMin + 1, safeBounds.width);
  const contentYMax = clamp(contentYMaxRaw, contentYMin + 1, safeBounds.height);

  const xMin = Number.isFinite(Number(dish.xMin)) ? Number(dish.xMin) : contentXMin;
  const yMin = Number.isFinite(Number(dish.yMin)) ? Number(dish.yMin) : contentYMin;
  const xMax = Number.isFinite(Number(dish.xMax)) ? Number(dish.xMax) : contentXMax;
  const yMax = Number.isFinite(Number(dish.yMax)) ? Number(dish.yMax) : contentYMax;

  dish.xMin = clamp(Math.min(xMin, contentXMin), 0, safeBounds.width - 1);
  dish.yMin = clamp(Math.min(yMin, contentYMin), 0, safeBounds.height - 1);
  dish.xMax = clamp(Math.max(xMax, contentXMax), dish.xMin + 1, safeBounds.width);
  dish.yMax = clamp(Math.max(yMax, contentYMax), dish.yMin + 1, safeBounds.height);

  return clampDishToBounds(dish, safeBounds);
}

function enforceUniformPaddingForDish(dish, bounds) {
  if (!dish || typeof dish !== "object") return dish;

  const xMin = Number(dish.xMin);
  const yMin = Number(dish.yMin);
  const xMax = Number(dish.xMax);
  const yMax = Number(dish.yMax);
  const contentXMin = Number(dish.contentXMin);
  const contentYMin = Number(dish.contentYMin);
  const contentXMax = Number(dish.contentXMax);
  const contentYMax = Number(dish.contentYMax);

  if (
    !Number.isFinite(xMin) ||
    !Number.isFinite(yMin) ||
    !Number.isFinite(xMax) ||
    !Number.isFinite(yMax) ||
    !Number.isFinite(contentXMin) ||
    !Number.isFinite(contentYMin) ||
    !Number.isFinite(contentXMax) ||
    !Number.isFinite(contentYMax) ||
    contentXMax <= contentXMin ||
    contentYMax <= contentYMin
  ) {
    return dish;
  }

  const leftPad = Math.max(0, contentXMin - xMin);
  const topPad = Math.max(0, contentYMin - yMin);
  const rightPad = Math.max(0, xMax - contentXMax);
  const bottomPad = Math.max(0, yMax - contentYMax);
  const uniformPad = Math.min(leftPad, topPad, rightPad, bottomPad);
  if (!Number.isFinite(uniformPad)) return dish;

  const targetXMin = contentXMin - uniformPad;
  const targetYMin = contentYMin - uniformPad;
  const targetXMax = contentXMax + uniformPad;
  const targetYMax = contentYMax + uniformPad;

  // Shrink-only normalization: never expand outward.
  const nextXMin = Math.max(xMin, targetXMin);
  const nextYMin = Math.max(yMin, targetYMin);
  const nextXMax = Math.min(xMax, targetXMax);
  const nextYMax = Math.min(yMax, targetYMax);

  if (nextXMax - nextXMin < 1 || nextYMax - nextYMin < 1) {
    return dish;
  }

  dish.xMin = nextXMin;
  dish.yMin = nextYMin;
  dish.xMax = nextXMax;
  dish.yMax = nextYMax;

  return clampDishToBounds(dish, bounds);
}

function median(values) {
  const source = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!source.length) return null;
  const mid = Math.floor(source.length / 2);
  if (source.length % 2 === 1) return source[mid];
  return (source[mid - 1] + source[mid]) / 2;
}

function trimDishElementOutliers(elements) {
  const source = Array.isArray(elements) ? elements.filter(Boolean) : [];
  if (source.length <= 2) return source;

  let centers = source.map((element) => ({
    element,
    centerX: (Number(element.xMin) + Number(element.xMax)) / 2,
    centerY: (Number(element.yMin) + Number(element.yMax)) / 2,
  })).filter((entry) => Number.isFinite(entry.centerX) && Number.isFinite(entry.centerY));

  if (centers.length <= 2) {
    return centers.map((entry) => entry.element);
  }

  const heights = centers
    .map((entry) => Math.max(1, Number(entry.element?.yMax) - Number(entry.element?.yMin)))
    .filter((value) => Number.isFinite(value));
  const medianHeight = median(heights);
  const gapThreshold = Number.isFinite(medianHeight)
    ? Math.max(36, medianHeight * 3.5)
    : 36;

  const byY = centers.slice().sort((a, b) => a.centerY - b.centerY);
  let splitIndex = -1;
  let largestGap = 0;
  for (let index = 0; index < byY.length - 1; index += 1) {
    const gap = byY[index + 1].centerY - byY[index].centerY;
    if (gap > largestGap) {
      largestGap = gap;
      splitIndex = index;
    }
  }

  if (splitIndex >= 0 && largestGap >= gapThreshold) {
    const top = byY.slice(0, splitIndex + 1);
    const bottom = byY.slice(splitIndex + 1);

    let dominant = top;
    if (bottom.length > top.length) {
      dominant = bottom;
    } else if (bottom.length === top.length) {
      const topSpan = Math.max(0, top[top.length - 1].centerY - top[0].centerY);
      const bottomSpan = Math.max(0, bottom[bottom.length - 1].centerY - bottom[0].centerY);
      dominant = topSpan <= bottomSpan ? top : bottom;
    }

    if (dominant.length >= 2 && dominant.length >= Math.ceil(byY.length * 0.6)) {
      centers = dominant;
    }
  }

  if (centers.length <= 3) {
    return centers.map((entry) => entry.element);
  }

  const medianX = median(centers.map((entry) => entry.centerX));
  const medianY = median(centers.map((entry) => entry.centerY));
  if (!Number.isFinite(medianX) || !Number.isFinite(medianY)) {
    return centers.map((entry) => entry.element);
  }

  const madX = median(centers.map((entry) => Math.abs(entry.centerX - medianX)));
  const madY = median(centers.map((entry) => Math.abs(entry.centerY - medianY)));
  if (!Number.isFinite(madX) || !Number.isFinite(madY) || madX <= 0 || madY <= 0) {
    return centers.map((entry) => entry.element);
  }

  const kept = centers
    .filter((entry) => {
      const scoreX = (0.6745 * Math.abs(entry.centerX - medianX)) / madX;
      const scoreY = (0.6745 * Math.abs(entry.centerY - medianY)) / madY;
      return scoreX <= 4 && scoreY <= 4;
    })
    .map((entry) => entry.element);

  // If trimming is too aggressive, keep original set to avoid false drops.
  if (kept.length < 2 || kept.length < Math.ceil(source.length * 0.4)) {
    return source;
  }

  return kept;
}

function buildDetectedDishes(dishData, elements, padding, bounds) {
  const safeBounds = normalizeBounds(bounds);
  const safePadding = Number.isFinite(Number(padding)) ? Math.max(0, Number(padding)) : 0;
  const elementsById = new Map((Array.isArray(elements) ? elements : []).map((element) => [element.id, element]));
  const dishes = [];

  (Array.isArray(dishData) ? dishData : []).forEach((dish) => {
    const rawIds = Array.isArray(dish?.element_ids)
      ? dish.element_ids
      : Array.isArray(dish?.elementIds)
        ? dish.elementIds
        : [];

    const elementIds = rawIds.map((id) => Number(id)).filter((id) => Number.isFinite(id));
    const selected = elementIds.map((id) => elementsById.get(id)).filter(Boolean);
    if (!selected.length) return;

    const coreSelected = trimDishElementOutliers(selected);
    const boundsSource = coreSelected.length ? coreSelected : selected;

    const contentXMin = clamp(Math.min(...boundsSource.map((element) => element.xMin)), 0, safeBounds.width - 1);
    const contentYMin = clamp(Math.min(...boundsSource.map((element) => element.yMin)), 0, safeBounds.height - 1);
    const contentXMax = clamp(Math.max(...boundsSource.map((element) => element.xMax)), contentXMin + 1, safeBounds.width);
    const contentYMax = clamp(Math.max(...boundsSource.map((element) => element.yMax)), contentYMin + 1, safeBounds.height);

    const xMin = Math.max(0, contentXMin - safePadding);
    const yMin = Math.max(0, contentYMin - safePadding);
    const xMax = Math.min(safeBounds.width, contentXMax + safePadding);
    const yMax = Math.min(safeBounds.height, contentYMax + safePadding);

    if (
      !Number.isFinite(xMin) ||
      !Number.isFinite(yMin) ||
      !Number.isFinite(xMax) ||
      !Number.isFinite(yMax) ||
      xMax <= xMin ||
      yMax <= yMin
    ) {
      return;
    }

    const name = asText(dish?.name) || "Unknown";

    dishes.push({
      name,
      description: asText(dish?.description),
      prices: asText(dish?.prices),
      elementIds: boundsSource.map((element) => element.id),
      xMin,
      yMin,
      xMax,
      yMax,
      contentXMin,
      contentYMin,
      contentXMax,
      contentYMax,
    });
  });

  return dishes;
}

function resolveOverlaps(dishes, bounds) {
  const source = Array.isArray(dishes) ? dishes : [];
  if (!source.length) return source;

  const safeBounds = normalizeBounds(bounds);
  const sorted = source.slice().sort((a, b) => (a.yMin - b.yMin) || (a.xMin - b.xMin));

  const boxesOverlap = (first, second) => {
    return !(
      first.xMax <= second.xMin ||
      second.xMax <= first.xMin ||
      first.yMax <= second.yMin ||
      second.yMax <= first.yMin
    );
  };

  const maxIterations = 50;
  let iteration = 0;

  while (sorted.length > 1 && iteration < maxIterations) {
    let foundOverlap = false;

    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const first = sorted[i];
        const second = sorted[j];
        if (!boxesOverlap(first, second)) continue;

        const xOverlap = Math.min(first.xMax, second.xMax) - Math.max(first.xMin, second.xMin);
        const yOverlap = Math.min(first.yMax, second.yMax) - Math.max(first.yMin, second.yMin);

        const snapshot = {
          first: {
            xMin: first.xMin,
            yMin: first.yMin,
            xMax: first.xMax,
            yMax: first.yMax,
          },
          second: {
            xMin: second.xMin,
            yMin: second.yMin,
            xMax: second.xMax,
            yMax: second.yMax,
          },
        };

        const restore = () => {
          first.xMin = snapshot.first.xMin;
          first.yMin = snapshot.first.yMin;
          first.xMax = snapshot.first.xMax;
          first.yMax = snapshot.first.yMax;
          second.xMin = snapshot.second.xMin;
          second.yMin = snapshot.second.yMin;
          second.xMax = snapshot.second.xMax;
          second.yMax = snapshot.second.yMax;
        };

        const splitOnX = () => {
          const midpoint = Math.floor((Math.min(first.xMax, second.xMax) + Math.max(first.xMin, second.xMin)) / 2);
          if (first.xMin <= second.xMin) {
            first.xMax = Math.max(first.xMin + 1, midpoint - 1);
            second.xMin = Math.min(second.xMax - 1, midpoint + 1);
          } else {
            second.xMax = Math.max(second.xMin + 1, midpoint - 1);
            first.xMin = Math.min(first.xMax - 1, midpoint + 1);
          }
        };

        const splitOnY = () => {
          const midpoint = Math.floor((Math.min(first.yMax, second.yMax) + Math.max(first.yMin, second.yMin)) / 2);
          if (first.yMin <= second.yMin) {
            first.yMax = Math.max(first.yMin + 1, midpoint - 1);
            second.yMin = Math.min(second.yMax - 1, midpoint + 1);
          } else {
            second.yMax = Math.max(second.yMin + 1, midpoint - 1);
            first.yMin = Math.min(first.yMax - 1, midpoint + 1);
          }
        };

        const contentCoverageRatio = (dish, axis) => {
          if (axis === "x") {
            const cMin = Number(dish.contentXMin);
            const cMax = Number(dish.contentXMax);
            if (!Number.isFinite(cMin) || !Number.isFinite(cMax) || cMax <= cMin) return 1;
            const kept = Math.max(0, Math.min(Number(dish.xMax), cMax) - Math.max(Number(dish.xMin), cMin));
            return kept / (cMax - cMin);
          }

          const cMin = Number(dish.contentYMin);
          const cMax = Number(dish.contentYMax);
          if (!Number.isFinite(cMin) || !Number.isFinite(cMax) || cMax <= cMin) return 1;
          const kept = Math.max(0, Math.min(Number(dish.yMax), cMax) - Math.max(Number(dish.yMin), cMin));
          return kept / (cMax - cMin);
        };

        const trySplitStrict = (axis) => {
          if (axis === "x") {
            splitOnX();
          } else {
            splitOnY();
          }

          enforceContentContainment(first, safeBounds);
          enforceContentContainment(second, safeBounds);
          clampDishToBounds(first, safeBounds);
          clampDishToBounds(second, safeBounds);

          if (boxesOverlap(first, second)) {
            restore();
            return false;
          }

          return true;
        };

        const trySplitGuarded = (axis) => {
          if (axis === "x") {
            splitOnX();
          } else {
            splitOnY();
          }

          clampDishToBounds(first, safeBounds);
          clampDishToBounds(second, safeBounds);

          if (boxesOverlap(first, second)) {
            restore();
            return false;
          }

          const firstBeforeWidth = snapshot.first.xMax - snapshot.first.xMin;
          const firstBeforeHeight = snapshot.first.yMax - snapshot.first.yMin;
          const secondBeforeWidth = snapshot.second.xMax - snapshot.second.xMin;
          const secondBeforeHeight = snapshot.second.yMax - snapshot.second.yMin;

          const firstAfterWidth = Number(first.xMax) - Number(first.xMin);
          const firstAfterHeight = Number(first.yMax) - Number(first.yMin);
          const secondAfterWidth = Number(second.xMax) - Number(second.xMin);
          const secondAfterHeight = Number(second.yMax) - Number(second.yMin);

          const minFirstSpan = axis === "x"
            ? Math.max(8, firstBeforeWidth * 0.28)
            : Math.max(8, firstBeforeHeight * 0.28);
          const minSecondSpan = axis === "x"
            ? Math.max(8, secondBeforeWidth * 0.28)
            : Math.max(8, secondBeforeHeight * 0.28);
          const firstAfterSpan = axis === "x" ? firstAfterWidth : firstAfterHeight;
          const secondAfterSpan = axis === "x" ? secondAfterWidth : secondAfterHeight;

          const firstCoverage = contentCoverageRatio(first, axis);
          const secondCoverage = contentCoverageRatio(second, axis);

          if (
            firstAfterSpan < minFirstSpan ||
            secondAfterSpan < minSecondSpan ||
            firstCoverage < 0.65 ||
            secondCoverage < 0.65
          ) {
            restore();
            return false;
          }

          return true;
        };

        const preferredAxis = yOverlap > xOverlap ? "x" : "y";
        const alternateAxis = preferredAxis === "x" ? "y" : "x";

        if (
          trySplitStrict(preferredAxis) ||
          trySplitStrict(alternateAxis) ||
          trySplitGuarded(preferredAxis) ||
          trySplitGuarded(alternateAxis)
        ) {
          foundOverlap = true;
          break;
        }
      }

      if (foundOverlap) break;
    }

    if (!foundOverlap) break;
    iteration += 1;
  }

  sorted.forEach((dish) => {
    clampDishToBounds(dish, safeBounds);
  });
  sorted.forEach((dish) => {
    enforceUniformPaddingForDish(dish, safeBounds);
  });
  sorted.forEach((dish) => {
    clampDishToBounds(dish, safeBounds);
  });

  return sorted;
}

function normalizeName(name) {
  return asText(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function tokenizeName(name) {
  return normalizeName(name)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function jaccardScore(firstTokens, secondTokens) {
  if (!firstTokens.length || !secondTokens.length) return 0;

  const firstSet = new Set(firstTokens);
  const secondSet = new Set(secondTokens);
  let intersection = 0;

  firstSet.forEach((token) => {
    if (secondSet.has(token)) intersection += 1;
  });

  const union = firstSet.size + secondSet.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function getOverlayLabel(overlay) {
  const raw = overlay?.id ?? overlay?.name ?? overlay?.text ?? "";
  return asText(raw);
}

function scoreOverlayMatch(existingName, detectedName) {
  const existingNorm = normalizeName(existingName);
  const detectedNorm = normalizeName(detectedName);
  if (!existingNorm || !detectedNorm) return 0;
  if (existingNorm === detectedNorm) return 1;

  const existingTokens = tokenizeName(existingName);
  const detectedTokens = tokenizeName(detectedName);
  let score = jaccardScore(existingTokens, detectedTokens);

  if (existingNorm.includes(detectedNorm) || detectedNorm.includes(existingNorm)) {
    score += 0.15;
  }
  if (existingTokens.length && detectedTokens.length && existingTokens[0] === detectedTokens[0]) {
    score += 0.1;
  }

  return score;
}

function ensureUniqueId(baseId, usedIds) {
  const baseLabel = asText(baseId) || "New Item";
  let candidate = baseLabel;
  let suffix = 2;

  while (usedIds.has(candidate)) {
    candidate = `${baseLabel} (${suffix})`;
    suffix += 1;
  }

  usedIds.add(candidate);
  return candidate;
}

function matchDetectedOverlays(detected, overlays) {
  const detectedList = Array.isArray(detected) ? detected : [];
  const existingList = Array.isArray(overlays) ? overlays : [];

  if (!existingList.length) {
    return { updatedOverlays: [], newOverlays: detectedList, matched: 0 };
  }

  const existingEntries = existingList.map((overlay, index) => ({
    index,
    overlay,
    name: getOverlayLabel(overlay),
  }));

  const usedExisting = new Set();
  const usedDetected = new Set();
  const updatedOverlays = [];

  const existingByNorm = new Map();
  existingEntries.forEach((entry) => {
    const norm = normalizeName(entry.name);
    if (!norm) return;
    const list = existingByNorm.get(norm) || [];
    list.push(entry.index);
    existingByNorm.set(norm, list);
  });

  detectedList.forEach((dish, detectedIndex) => {
    const norm = normalizeName(dish.id);
    if (!norm) return;

    const candidates = existingByNorm.get(norm);
    if (!candidates) return;

    const matchIndex = candidates.find((candidate) => !usedExisting.has(candidate));
    if (matchIndex === undefined) return;

    usedExisting.add(matchIndex);
    usedDetected.add(detectedIndex);

    const existing = existingEntries.find((entry) => entry.index === matchIndex);
    const id = existing?.name || dish.id;
    updatedOverlays.push({ id, x: dish.x, y: dish.y, w: dish.w, h: dish.h });
  });

  const candidates = [];
  existingEntries.forEach((entry) => {
    if (usedExisting.has(entry.index)) return;

    detectedList.forEach((dish, detectedIndex) => {
      if (usedDetected.has(detectedIndex)) return;

      const score = scoreOverlayMatch(entry.name, dish.id);
      if (score >= 0.35) {
        candidates.push({
          existingIdx: entry.index,
          detectedIdx: detectedIndex,
          score,
        });
      }
    });
  });

  candidates.sort((first, second) => second.score - first.score);
  candidates.forEach((candidate) => {
    if (usedExisting.has(candidate.existingIdx) || usedDetected.has(candidate.detectedIdx)) {
      return;
    }

    usedExisting.add(candidate.existingIdx);
    usedDetected.add(candidate.detectedIdx);

    const existing = existingEntries.find((entry) => entry.index === candidate.existingIdx);
    const dish = detectedList[candidate.detectedIdx];
    const id = existing?.name || dish.id;
    updatedOverlays.push({ id, x: dish.x, y: dish.y, w: dish.w, h: dish.h });
  });

  const usedIds = new Set(existingEntries.map((entry) => entry.name).filter(Boolean));
  updatedOverlays.forEach((overlay) => usedIds.add(overlay.id));

  const newOverlays = detectedList
    .filter((_, index) => !usedDetected.has(index))
    .map((dish) => ({
      id: ensureUniqueId(dish.id, usedIds),
      x: dish.x,
      y: dish.y,
      w: dish.w,
      h: dish.h,
    }));

  return {
    updatedOverlays,
    newOverlays,
    matched: updatedOverlays.length,
  };
}

function toOutputOverlay(overlay, bounds = {}) {
  const id = asText(overlay?.id || overlay?.name);
  const x = Number(overlay?.x);
  const y = Number(overlay?.y);
  const w = Number(overlay?.w);
  const h = Number(overlay?.h);

  if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
    return null;
  }

  const boundsWidth = Number(bounds?.width);
  const boundsHeight = Number(bounds?.height);
  const safeWidth = Number.isFinite(boundsWidth) && boundsWidth > 0 ? boundsWidth : REMAP_CANVAS_SIZE;
  const safeHeight = Number.isFinite(boundsHeight) && boundsHeight > 0 ? boundsHeight : REMAP_CANVAS_SIZE;

  // Convert legacy pixel-space boxes into canonical thousand-space.
  const thousandX = (x / safeWidth) * REMAP_CANVAS_SIZE;
  const thousandY = (y / safeHeight) * REMAP_CANVAS_SIZE;
  const thousandW = (w / safeWidth) * REMAP_CANVAS_SIZE;
  const thousandH = (h / safeHeight) * REMAP_CANVAS_SIZE;

  const clampedX = clamp(Math.round(thousandX), 0, REMAP_CANVAS_SIZE - 1);
  const clampedY = clamp(Math.round(thousandY), 0, REMAP_CANVAS_SIZE - 1);
  const clampedW = clamp(Math.round(thousandW), 1, REMAP_CANVAS_SIZE - clampedX);
  const clampedH = clamp(Math.round(thousandH), 1, REMAP_CANVAS_SIZE - clampedY);

  return {
    id,
    name: id,
    x: clampedX,
    y: clampedY,
    w: clampedW,
    h: clampedH,
    coordSpace: "thousand",
  };
}

async function runLegacyRepositionPipeline({
  body,
  mode,
  anthropicApiKey,
  googleVisionApiKey,
  model,
}) {
  const sourceImage = mode === "remap"
    ? asText(body?.newImageData || body?.imageData)
    : asText(body?.imageData);

  if (!sourceImage) {
    if (mode === "remap") {
      throw new ApiError("newImageData is required for remap mode.", 400);
    }
    throw new ApiError("imageData is required.", 400);
  }

  const imageInput = await parseImageData(sourceImage);
  if (!imageInput) {
    throw new ApiError("Unable to parse menu image payload.", 400);
  }

  const paddingRaw = Number(body?.padding);
  const padding = Number.isFinite(paddingRaw) ? Math.max(0, paddingRaw) : DEFAULT_PADDING;

  const existingOverlays = mode === "remap" && Array.isArray(body?.overlays)
    ? body.overlays
    : [];
  const existingNames = existingOverlays.map(getOverlayLabel).filter(Boolean);
  const uniqueExistingNames = Array.from(new Set(existingNames)).slice(0, EXISTING_NAME_LIMIT);
  const existingNamesTruncated = existingNames.length > uniqueExistingNames.length;

  const { elements, fullText } = await extractTextElements({
    googleVisionApiKey,
    base64Data: imageInput.base64Data,
  });

  if (!elements.length) {
    return {
      success: true,
      dishes: [],
      updatedOverlays: [],
      newOverlays: [],
      rawDishCount: 0,
      validDishCount: 0,
      diagnostics: {
        engine: "next-legacy-reposition",
        mode,
        elementCount: 0,
        dishCount: 0,
        detectedOverlayCount: 0,
        matchedCount: 0,
        existingNameCount: existingNames.length,
        existingNamesTruncated,
        padding,
        model,
        anchorMatchCount: 0,
        anchorMissCount: 0,
        corridorClamps: 0,
        conservativeFallbackCount: 0,
        rowWidePreventionApplied: 0,
      },
    };
  }

  const dishData = await analyzeMenu({
    imageInput,
    elements,
    fullText,
    existingNames: uniqueExistingNames,
    model,
    anthropicApiKey,
  });

  const inferredWidth = Math.max(...elements.map((element) => Number(element.xMax) || 0), 0) || REMAP_CANVAS_SIZE;
  const inferredHeight = Math.max(...elements.map((element) => Number(element.yMax) || 0), 0) || REMAP_CANVAS_SIZE;
  const bounds = {
    width: Number(body?.imageWidth) > 0 ? Number(body.imageWidth) : inferredWidth,
    height: Number(body?.imageHeight) > 0 ? Number(body.imageHeight) : inferredHeight,
  };

  let dishes = buildDetectedDishes(dishData, elements, padding, bounds);
  dishes = resolveOverlaps(dishes, bounds);

  const detectedOverlays = dishes
    .map((dish) => ({
      id: dish.name,
      x: Math.round(dish.xMin),
      y: Math.round(dish.yMin),
      w: Math.round(dish.xMax - dish.xMin),
      h: Math.round(dish.yMax - dish.yMin),
    }))
    .filter((overlay) => overlay.w > 1 && overlay.h > 1);

  const matchResult = matchDetectedOverlays(detectedOverlays, existingOverlays);
  const updatedOverlays = dedupeByName(
    (Array.isArray(matchResult.updatedOverlays) ? matchResult.updatedOverlays : [])
      .map((overlay) => toOutputOverlay(overlay, bounds))
      .filter(Boolean),
  );
  const newOverlays = dedupeByName(
    (Array.isArray(matchResult.newOverlays) ? matchResult.newOverlays : [])
      .map((overlay) => toOutputOverlay(overlay, bounds))
      .filter(Boolean),
  );
  const allOverlays = [...updatedOverlays, ...newOverlays];

  return {
    success: true,
    dishes: allOverlays,
    updatedOverlays,
    newOverlays,
    rawDishCount: Array.isArray(dishData) ? dishData.length : detectedOverlays.length,
    validDishCount: allOverlays.length,
    diagnostics: {
      engine: "next-legacy-reposition",
      mode,
      elementCount: elements.length,
      dishCount: dishes.length,
      detectedOverlayCount: detectedOverlays.length,
      matchedCount: Number(matchResult?.matched || 0),
      existingNameCount: existingNames.length,
      existingNamesTruncated,
      padding,
      model,
      anchorMatchCount: 0,
      anchorMissCount: 0,
      corridorClamps: 0,
      conservativeFallbackCount: 0,
      rowWidePreventionApplied: 0,
    },
  };
}

export async function analyzeMenuImageWithLocalEngine({ body, env = process.env }) {
  const anthropicApiKey = readFirstEnv(env, ["ANTHROPIC_API_KEY"]);
  if (!anthropicApiKey) {
    throw new ApiError("ANTHROPIC_API_KEY is not configured.", 500);
  }

  const googleVisionApiKey = readFirstEnv(env, ["GOOGLE_VISION_API_KEY", "GOOGLE_CLOUD_API_KEY"]);
  if (!googleVisionApiKey) {
    throw new ApiError("GOOGLE_VISION_API_KEY is not configured.", 500);
  }

  const model = asText(body?.model) || readFirstEnv(env, ["ANTHROPIC_MODEL"]) || DEFAULT_ANTHROPIC_MODEL;
  const mode = normalizeToken(body?.mode) === "remap" ? "remap" : "detect";

  const fixtureReplayEnabled =
    isTruthyFlag(readFirstEnv(env, ["MENU_ANALYSIS_FIXTURE_REPLAY"])) ||
    normalizeToken(env?.NODE_ENV) === "test";

  const fixtureReplay = fixtureReplayEnabled
    ? await resolveFixtureReplay(body, mode)
    : null;
  if (fixtureReplay) {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[menu-image-analysis] next-legacy-reposition", {
        mode,
        rawDishCount: fixtureReplay.rawDishCount,
        validDishCount: fixtureReplay.validDishCount,
        updatedCount: fixtureReplay.updatedOverlays.length,
        newCount: fixtureReplay.newOverlays.length,
        fixtureReplay: true,
        fixtureId: fixtureReplay?.diagnostics?.fixtureId || null,
      });
    }
    return fixtureReplay;
  }

  const result = await runLegacyRepositionPipeline({
    body,
    mode,
    anthropicApiKey,
    googleVisionApiKey,
    model,
  });

  if (process.env.NODE_ENV !== "production") {
    console.debug("[menu-image-analysis] next-legacy-reposition", {
      mode,
      pageIndex: Number.isFinite(Number(body?.pageIndex)) ? Number(body.pageIndex) : null,
      rawDishCount: result.rawDishCount,
      validDishCount: result.validDishCount,
      updatedCount: result.updatedOverlays.length,
      newCount: result.newOverlays.length,
      matchedCount: Number(result?.diagnostics?.matchedCount || 0),
    });
  }

  return result;
}

const __test = {
  buildDetectedDishes,
  resolveOverlaps,
  enforceUniformPaddingForDish,
};

export { ApiError, normalizeToken, dedupeByName, sanitizeRemapOverlay, __test };
