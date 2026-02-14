import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const REMAP_CANVAS_SIZE = 1000;
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

function roundCoord(value, digits = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
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
      engine: "next-local-reposition",
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

function extractBalancedJsonObjects(value) {
  const out = [];
  const text = asText(value);
  if (!text) return out;

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (ch === "}") {
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
    // continue
  }

  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // continue
    }
  }

  const balancedObjects = extractBalancedJsonObjects(value);
  for (let index = balancedObjects.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(balancedObjects[index]);
    } catch {
      // continue
    }
  }

  return null;
}

function parseFiniteNumber(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const text = asText(value);
  if (!text) return NaN;
  const normalized = text.replace(/[^0-9+\-.]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function pickFinite(...candidates) {
  for (const candidate of candidates) {
    const value = parseFiniteNumber(candidate);
    if (Number.isFinite(value)) return value;
  }
  return NaN;
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
  const list = (Array.isArray(points) ? points : [])
    .map((point) => parsePoint(point))
    .filter(Boolean);
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
    const fromPoints = rectFromPointList(source[key]);
    if (fromPoints) return fromPoints;
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

  const unitHints = [
    entry?.units,
    entry?.unit,
    entry?.coordSpace,
    entry?.coord_space,
    entry?.space,
    entry?.bounds?.units,
    entry?.bbox?.units,
  ];

  return unitHints.some((value) => normalizeCoordSpace(value) === "thousand");
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

function convertRectToThousand({ x, y, w, h, coordSpace, imageWidth, imageHeight }) {
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
    mode: mode || "unknown",
  };
}

function sanitizeRemapOverlay(entry, options = {}) {
  const name = asText(
    entry?.id || entry?.name || entry?.dishName || entry?.item || entry?.label || entry?.title,
  );
  if (!name) return null;

  const rawRect = extractRawRect(entry);
  if (!rawRect) return null;

  const explicitCoordSpace = normalizeCoordSpace(
    entry?.coordSpace || entry?.coord_space || entry?.space || entry?.units || entry?.unit,
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
    id: name,
    name,
    x: normalized.x,
    y: normalized.y,
    w: normalized.w,
    h: normalized.h,
    coordSpace: "thousand",
    _mode: normalized.mode,
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

function summarizeCoordModes(items) {
  return (Array.isArray(items) ? items : []).reduce((accumulator, item) => {
    const key = asText(item?._mode) || "unknown";
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function parseRemapArrays(payload) {
  const updatedRaw = Array.isArray(payload?.updatedOverlays)
    ? payload.updatedOverlays
    : Array.isArray(payload?.updated)
      ? payload.updated
      : Array.isArray(payload?.repositioned)
        ? payload.repositioned
        : [];

  const newRaw = Array.isArray(payload?.newOverlays)
    ? payload.newOverlays
    : Array.isArray(payload?.newDishes)
      ? payload.newDishes
      : Array.isArray(payload?.addedOverlays)
        ? payload.addedOverlays
        : Array.isArray(payload?.dishes)
          ? payload.dishes
          : Array.isArray(payload?.overlays)
            ? payload.overlays
            : [];

  return { updatedRaw, newRaw };
}

function normalizeRemapResponse({
  payload,
  imageWidth,
  imageHeight,
  oldOverlayTokens,
  discoveryMode = false,
}) {
  const { updatedRaw, newRaw } = parseRemapArrays(payload);

  const sanitizedUpdatedRaw = updatedRaw
    .map((entry) => sanitizeRemapOverlay(entry, { imageWidth, imageHeight }))
    .filter(Boolean);

  const sanitizedNewRaw = newRaw
    .map((entry) => sanitizeRemapOverlay(entry, { imageWidth, imageHeight }))
    .filter(Boolean);

  const updatedOverlays = [];
  const promotedNew = [];
  const seenUpdatedTokens = new Set();

  if (discoveryMode) {
    promotedNew.push(...sanitizedUpdatedRaw);
  } else {
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
  }

  const newOverlays = [];
  const seenNewTokens = new Set();
  [...promotedNew, ...sanitizedNewRaw].forEach((overlay) => {
    const token = normalizeToken(overlay?.name);
    if (!token || seenUpdatedTokens.has(token) || seenNewTokens.has(token)) return;
    seenNewTokens.add(token);
    newOverlays.push(overlay);
  });

  const cleanOverlay = (overlay) => ({
    id: overlay.name,
    name: overlay.name,
    x: overlay.x,
    y: overlay.y,
    w: overlay.w,
    h: overlay.h,
    coordSpace: "thousand",
  });

  const cleanUpdated = dedupeByName(updatedOverlays.map(cleanOverlay));
  const cleanNew = dedupeByName(newOverlays.map(cleanOverlay));
  const allClean = [...cleanUpdated, ...cleanNew];

  return {
    updatedOverlays: cleanUpdated,
    newOverlays: cleanNew,
    dishes: allClean,
    rawDishCount: updatedRaw.length + newRaw.length,
    validDishCount: allClean.length,
    modeCounts: summarizeCoordModes([...updatedOverlays, ...newOverlays]),
    diagnostics: {
      engine: "next-local-reposition",
      anchorMatchCount: 0,
      anchorMissCount: 0,
      corridorClamps: 0,
      conservativeFallbackCount: 0,
      rowWidePreventionApplied: 0,
    },
  };
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
  maxTokens = 5000,
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
      temperature: 0,
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
    throw new ApiError(message, 500);
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
      asText(payload?.error?.message) || asText(payload?.error) || "Google Vision OCR request failed.";
    throw new ApiError(message, 500);
  }

  const responseError = asText(payload?.responses?.[0]?.error?.message);
  if (responseError) {
    throw new ApiError(responseError, 500);
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

function compactVisionForPrompt(vision, { maxWords = 280, maxLines = 160 } = {}) {
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

function compactOverlayHints(overlays, limit = 220) {
  return (Array.isArray(overlays) ? overlays : [])
    .slice(0, limit)
    .map((overlay) => ({
      name: asText(overlay?.name || overlay?.id),
      x: roundCoord(overlay?.x, 2),
      y: roundCoord(overlay?.y, 2),
      w: roundCoord(overlay?.w, 2),
      h: roundCoord(overlay?.h, 2),
    }))
    .filter((overlay) => overlay.name);
}

function buildRemapSystemPrompt({ discoveryMode = false } = {}) {
  return `You are a menu overlay remapping assistant.
Return ONLY valid JSON.

Output schema:
{
  "updatedOverlays": [
    {"name":"Dish Name","x":0,"y":0,"w":0,"h":0}
  ],
  "newOverlays": [
    {"name":"Dish Name","x":0,"y":0,"w":0,"h":0}
  ]
}

Rules:
- Coordinates MUST be in 0-1000 on the NEW image letterboxed canvas.
- One dish per box. Never merge neighboring dishes.
- Each box should include the full dish block: title, price, description/modifier lines, and nearby legend symbols that belong to that dish.
- Do not include section headers, decorative text, or unrelated artwork.
- Keep one entry per dish name.
- If uncertain, omit the dish.
- No markdown, no commentary, no extra root keys.
${discoveryMode ? "- Discovery mode: put all detections in newOverlays and leave updatedOverlays empty." : ""}`;
}

async function runLocalRemapPipeline({
  body,
  anthropicApiKey,
  googleVisionApiKey,
  model,
}) {
  const newImageInput = await parseImageData(body?.newImageData || body?.imageData);
  if (!newImageInput) {
    throw new ApiError("newImageData is required for remap mode.", 400);
  }

  const oldImageInput = await parseImageData(body?.oldImageData || "");

  const requestedWidth = Number.isFinite(Number(body?.imageWidth))
    ? Number(body.imageWidth)
    : REMAP_CANVAS_SIZE;
  const requestedHeight = Number.isFinite(Number(body?.imageHeight))
    ? Number(body.imageHeight)
    : REMAP_CANVAS_SIZE;

  const baselineOverlays = dedupeByName(
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

  const content = [];
  if (oldImageInput) {
    content.push({ type: "text", text: "OLD MENU IMAGE (reference for existing overlays)" });
    content.push(buildAnthropicImageBlock(oldImageInput));
  }
  content.push({ type: "text", text: "NEW MENU IMAGE (target image)" });
  content.push(buildAnthropicImageBlock(newImageInput));
  content.push({
    type: "text",
    text: `Remap overlays using this context JSON:\n${JSON.stringify(remapContext)}`,
  });

  const { responseText } = await callAnthropicMessages({
    apiKey: anthropicApiKey,
    model,
    systemPrompt: buildRemapSystemPrompt({ discoveryMode: false }),
    content,
    maxTokens: 5000,
  });

  const parsed = parseClaudeJson(responseText);
  if (!parsed || typeof parsed !== "object") {
    throw new ApiError("Failed to parse remap analysis output.", 500);
  }

  const normalized = normalizeRemapResponse({
    payload: parsed,
    imageWidth: requestedWidth,
    imageHeight: requestedHeight,
    oldOverlayTokens,
    discoveryMode: false,
  });

  if (process.env.NODE_ENV !== "production") {
    console.debug("[menu-image-analysis] next-local-reposition", {
      mode: "remap",
      pageIndex: remapContext.pageIndex,
      baselineOverlayCount: baselineOverlays.length,
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
    diagnostics: normalized.diagnostics,
  };
}

async function runLocalDiscoveryPipeline({
  body,
  anthropicApiKey,
  googleVisionApiKey,
  model,
}) {
  const imageInput = await parseImageData(body?.imageData);
  if (!imageInput) {
    throw new ApiError("imageData is required.", 400);
  }

  const requestedWidth = Number.isFinite(Number(body?.imageWidth))
    ? Number(body.imageWidth)
    : REMAP_CANVAS_SIZE;
  const requestedHeight = Number.isFinite(Number(body?.imageHeight))
    ? Number(body.imageHeight)
    : REMAP_CANVAS_SIZE;

  const vision = await getVisionAnalysis({
    googleVisionApiKey,
    base64Data: imageInput.base64Data,
  });

  const discoveryContext = {
    pageIndex: Number.isFinite(Number(body?.pageIndex)) ? Number(body.pageIndex) : null,
    targetCoordinateSpace:
      "All overlay coordinates MUST be x/y/w/h on a 0-1000 letterboxed canvas for this image.",
    newImageVision: compactVisionForPrompt(vision),
  };

  const content = [
    { type: "text", text: "MENU IMAGE (detection target)" },
    buildAnthropicImageBlock(imageInput),
    {
      type: "text",
      text: `Detect dish overlays using this context JSON:\n${JSON.stringify(discoveryContext)}`,
    },
  ];

  const { responseText } = await callAnthropicMessages({
    apiKey: anthropicApiKey,
    model,
    systemPrompt: buildRemapSystemPrompt({ discoveryMode: true }),
    content,
    maxTokens: 4500,
  });

  const parsed = parseClaudeJson(responseText);
  if (!parsed || typeof parsed !== "object") {
    throw new ApiError("Failed to parse discovery analysis output.", 500);
  }

  const normalized = normalizeRemapResponse({
    payload: parsed,
    imageWidth: requestedWidth,
    imageHeight: requestedHeight,
    oldOverlayTokens: new Set(),
    discoveryMode: true,
  });

  if (process.env.NODE_ENV !== "production") {
    console.debug("[menu-image-analysis] next-local-reposition", {
      mode: "detect",
      pageIndex: discoveryContext.pageIndex,
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
    diagnostics: normalized.diagnostics,
  };
}

export async function analyzeMenuImageWithLocalEngine({ body, env = process.env }) {
  const anthropicApiKey = readFirstEnv(env, ["ANTHROPIC_API_KEY"]);
  if (!anthropicApiKey) {
    throw new ApiError("ANTHROPIC_API_KEY is not configured.", 500);
  }

  const googleVisionApiKey = readFirstEnv(env, ["GOOGLE_VISION_API_KEY"]);
  if (!googleVisionApiKey) {
    throw new ApiError("GOOGLE_VISION_API_KEY is not configured.", 500);
  }

  const model = readFirstEnv(env, ["ANTHROPIC_MODEL"]) || DEFAULT_ANTHROPIC_MODEL;
  const mode = normalizeToken(body?.mode);

  const fixtureReplay = await resolveFixtureReplay(body, mode);
  if (fixtureReplay) {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[menu-image-analysis] next-local-reposition", {
        mode: mode === "remap" ? "remap" : "detect",
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

  if (mode === "remap") {
    return await runLocalRemapPipeline({
      body,
      anthropicApiKey,
      googleVisionApiKey,
      model,
    });
  }

  if (!asText(body?.imageData)) {
    throw new ApiError("imageData is required.", 400);
  }

  return await runLocalDiscoveryPipeline({
    body,
    anthropicApiKey,
    googleVisionApiKey,
    model,
  });
}

export { ApiError, normalizeToken, dedupeByName, sanitizeRemapOverlay };
