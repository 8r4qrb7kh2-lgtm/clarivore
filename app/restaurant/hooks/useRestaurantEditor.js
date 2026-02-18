"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const HISTORY_LIMIT = 50;
const PENDING_CHANGE_KEY_PREFIX = "__pc__:";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function asText(value) {
  return String(value || "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeLegacyMatchKey(value) {
  return asText(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizeCoordSpace(value) {
  const token = normalizeToken(value);
  if (!token) return "";
  if (token === "ratio" || token.includes("normalizedratio")) return "ratio";
  if (token === "percent" || token === "percentage" || token.includes("pct")) return "percent";
  if (token === "pixel" || token === "pixels" || token === "px") return "pixels";
  if (token === "thousand" || token.includes("thousand")) return "thousand";
  return "";
}

function dedupeTokenList(values) {
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

function buildCanonicalTokenLookup(values) {
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

function findDietAlias(token, lookup) {
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

function resolveCanonicalValue(value, options = {}) {
  const text = asText(value);
  if (!text) return "";
  const {
    strictNormalizer,
    tokenLookup,
    aliasResolver,
  } = options;

  if (typeof strictNormalizer === "function") {
    const strictValue = asText(strictNormalizer(text));
    if (strictValue) return strictValue;
  }

  const token = normalizeToken(text);
  if (!token) return "";

  if (tokenLookup instanceof Map && tokenLookup.has(token)) {
    return tokenLookup.get(token) || "";
  }

  if (typeof aliasResolver === "function") {
    const alias = asText(aliasResolver(token));
    if (alias) return alias;
  }

  return "";
}

function normalizeCanonicalList(values, resolveValue) {
  const list = (Array.isArray(values) ? values : [])
    .map((value) => resolveValue(value))
    .filter(Boolean);
  return dedupeTokenList(list);
}

function hasAssignedBrand(ingredient) {
  return (Array.isArray(ingredient?.brands) ? ingredient.brands : []).some(
    (brand) => asText(brand?.name),
  );
}

function buildOverlayBrandRequirementIssues(overlay) {
  const issues = [];
  const overlayName = asText(overlay?.id || overlay?.name) || "Dish";
  const rows = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];

  rows.forEach((ingredient, index) => {
    if (!ingredient?.brandRequired) return;
    if (hasAssignedBrand(ingredient)) return;
    const ingredientName = asText(ingredient?.name) || `Ingredient ${index + 1}`;
    const reason = asText(ingredient?.brandRequirementReason);
    issues.push({
      overlayName,
      ingredientName,
      reason,
      message: reason
        ? `${overlayName}: ${ingredientName} requires brand assignment (${reason})`
        : `${overlayName}: ${ingredientName} requires brand assignment`,
    });
  });

  return issues;
}

function buildBrandRequirementIssues(overlays) {
  return (Array.isArray(overlays) ? overlays : []).flatMap((overlay) =>
    buildOverlayBrandRequirementIssues(overlay),
  );
}

function buildOverlayIngredientConfirmationIssues(overlay) {
  const issues = [];
  const overlayName = asText(overlay?.id || overlay?.name) || "Dish";
  const rows = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];

  rows.forEach((ingredient, index) => {
    if (ingredient?.confirmed === true) return;
    const ingredientName = asText(ingredient?.name) || `Ingredient ${index + 1}`;
    issues.push({
      overlayName,
      ingredientName,
      message: `${overlayName}: ${ingredientName} must be confirmed before saving`,
    });
  });

  return issues;
}

function buildIngredientConfirmationIssues(overlays) {
  return (Array.isArray(overlays) ? overlays : []).flatMap((overlay) =>
    buildOverlayIngredientConfirmationIssues(overlay),
  );
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeRectValue(value, fallback = 0) {
  return clamp(normalizeNumber(value, fallback), 0, 100);
}

function resolveOverlayScale(overlays) {
  const values = [];

  (Array.isArray(overlays) ? overlays : []).forEach((overlay) => {
    const candidates = [
      overlay?.x,
      overlay?.y,
      overlay?.w,
      overlay?.h,
      overlay?.left,
      overlay?.top,
      overlay?.width,
      overlay?.height,
    ];

    candidates.forEach((value) => {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) values.push(Math.abs(parsed));
    });
  });

  if (!values.length) return "percent";
  const maxCoord = Math.max(...values);
  if (maxCoord > 0 && maxCoord <= 1.2) return "ratio";
  if (maxCoord > 150 && maxCoord <= 1200) return "thousand";
  return "percent";
}

function resolvePageOffset(overlays, pageCount) {
  const values = (Array.isArray(overlays) ? overlays : [])
    .map((overlay) =>
      firstFiniteNumber(
        overlay?.pageIndex,
        overlay?.page,
        overlay?.pageNumber,
        overlay?.page_number,
      ),
    )
    .filter((value) => Number.isFinite(value));

  if (!values.length) return 0;
  const minPage = Math.min(...values);
  const maxPage = Math.max(...values);
  const hasZero = values.some((value) => value === 0);

  // Legacy exports occasionally store page numbers as 1-based.
  if (!hasZero && minPage >= 1 && pageCount > 0 && maxPage <= pageCount) {
    return 1;
  }
  return 0;
}

function buildOverlayBoundsByPage(overlays, pageOffset = 0) {
  const byPage = new Map();

  (Array.isArray(overlays) ? overlays : []).forEach((overlay) => {
    const rawPage = firstFiniteNumber(
      overlay?.pageIndex,
      overlay?.page,
      overlay?.pageNumber,
      overlay?.page_number,
    );
    const pageIndex = Number.isFinite(rawPage)
      ? Math.max(0, Math.floor(rawPage - pageOffset))
      : 0;

    const rawX = firstFiniteNumber(overlay?.x, overlay?.left);
    const rawY = firstFiniteNumber(overlay?.y, overlay?.top);
    const rawW = firstFiniteNumber(overlay?.w, overlay?.width);
    const rawH = firstFiniteNumber(overlay?.h, overlay?.height);
    if (
      !Number.isFinite(rawX) ||
      !Number.isFinite(rawY) ||
      !Number.isFinite(rawW) ||
      !Number.isFinite(rawH)
    ) {
      return;
    }

    const safeX = Math.max(0, rawX);
    const safeY = Math.max(0, rawY);
    const safeW = Math.max(0, rawW);
    const safeH = Math.max(0, rawH);
    const right = safeX + safeW;
    const bottom = safeY + safeH;

    const existing = byPage.get(pageIndex) || { maxRight: 0, maxBottom: 0 };
    existing.maxRight = Math.max(existing.maxRight, right, safeX, safeW);
    existing.maxBottom = Math.max(existing.maxBottom, bottom, safeY, safeH);
    byPage.set(pageIndex, existing);
  });

  return byPage;
}

function buildOverlayNormalizationContext(overlays, pageCount) {
  const pageOffset = resolvePageOffset(overlays, pageCount);
  return {
    scale: resolveOverlayScale(overlays),
    pageOffset,
    boundsByPage: buildOverlayBoundsByPage(overlays, pageOffset),
  };
}

function normalizeOverlay(overlay, index, fallbackKey, context = {}) {
  const fallbackName = `Dish ${index + 1}`;
  const rawName = asText(overlay?.id || overlay?.name || fallbackName);
  const name = rawName || fallbackName;

  const scale =
    context?.scale === "ratio"
      ? 100
      : context?.scale === "thousand"
        ? 0.1
        : 1;

  const rawPage = firstFiniteNumber(
    overlay?.pageIndex,
    overlay?.page,
    overlay?.pageNumber,
    overlay?.page_number,
  );
  const pageOffset = Number(context?.pageOffset) || 0;
  const pageIndex = Number.isFinite(rawPage)
    ? Math.max(0, Math.floor(rawPage - pageOffset))
    : 0;

  const rawX = firstFiniteNumber(overlay?.x, overlay?.left);
  const rawY = firstFiniteNumber(overlay?.y, overlay?.top);
  const rawW = firstFiniteNumber(overlay?.w, overlay?.width);
  const rawH = firstFiniteNumber(overlay?.h, overlay?.height);

  const pageBounds = context?.boundsByPage instanceof Map
    ? context.boundsByPage.get(pageIndex)
    : null;
  const pixelLikeBounds =
    context?.scale === "percent" &&
    pageBounds &&
    (Number(pageBounds.maxRight) > 110 || Number(pageBounds.maxBottom) > 110);
  const xScale = pixelLikeBounds && Number(pageBounds.maxRight) > 0
    ? 100 / Number(pageBounds.maxRight)
    : 1;
  const yScale = pixelLikeBounds && Number(pageBounds.maxBottom) > 0
    ? 100 / Number(pageBounds.maxBottom)
    : 1;
  const xValue = Number.isFinite(rawX)
    ? rawX * scale * xScale
    : 8;
  const yValue = Number.isFinite(rawY)
    ? rawY * scale * yScale
    : 8;
  const wValue = Number.isFinite(rawW)
    ? rawW * scale * xScale
    : 20;
  const hValue = Number.isFinite(rawH)
    ? rawH * scale * yScale
    : 8;

  return {
    ...overlay,
    _editorKey:
      asText(overlay?._editorKey) || fallbackKey || `ov-${Date.now()}-${index}`,
    id: name,
    name,
    description: asText(overlay?.description),
    x: normalizeRectValue(xValue, 8),
    y: normalizeRectValue(yValue, 8),
    w: clamp(normalizeRectValue(wValue, 20), 0.5, 100),
    h: clamp(normalizeRectValue(hValue, 8), 0.5, 100),
    pageIndex,
    allergens: Array.isArray(overlay?.allergens) ? overlay.allergens.filter(Boolean) : [],
    diets: Array.isArray(overlay?.diets) ? overlay.diets.filter(Boolean) : [],
    removable: Array.isArray(overlay?.removable) ? overlay.removable.filter(Boolean) : [],
    crossContaminationAllergens: Array.isArray(overlay?.crossContaminationAllergens)
      ? overlay.crossContaminationAllergens.filter(Boolean)
      : [],
    crossContaminationDiets: Array.isArray(overlay?.crossContaminationDiets)
      ? overlay.crossContaminationDiets.filter(Boolean)
      : [],
    details: overlay?.details && typeof overlay.details === "object" ? overlay.details : {},
    ingredients: Array.isArray(overlay?.ingredients) ? overlay.ingredients : [],
    ingredientsBlockingDiets:
      overlay?.ingredientsBlockingDiets &&
      typeof overlay.ingredientsBlockingDiets === "object"
        ? overlay.ingredientsBlockingDiets
        : {},
  };
}

function ensureOverlayVisibility(overlay, pageCount = 1) {
  const maxPageIndex = Math.max(Number(pageCount) - 1, 0);
  const next = { ...overlay };

  const pageIndex = Number.isFinite(Number(next.pageIndex))
    ? Number(next.pageIndex)
    : 0;
  next.pageIndex = clamp(Math.floor(pageIndex), 0, maxPageIndex);

  let x = normalizeRectValue(next.x, 8);
  let y = normalizeRectValue(next.y, 8);
  let w = clamp(normalizeRectValue(next.w, 20), 0.5, 100);
  let h = clamp(normalizeRectValue(next.h, 8), 0.5, 100);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
    x = 8;
    y = 8;
    w = 20;
    h = 8;
  }

  if (x + w <= 0.5 || y + h <= 0.5 || x >= 99.5 || y >= 99.5) {
    x = 8;
    y = 8;
    w = Math.max(w, 20);
    h = Math.max(h, 8);
  }

  w = clamp(w, 0.5, 100);
  h = clamp(h, 0.5, 100);
  x = clamp(x, 0, 100 - w);
  y = clamp(y, 0, 100 - h);

  next.x = x;
  next.y = y;
  next.w = w;
  next.h = h;

  return next;
}

function buildMenuImages(restaurant) {
  const explicit = Array.isArray(restaurant?.menu_images)
    ? restaurant.menu_images.filter(Boolean)
    : Array.isArray(restaurant?.menuImages)
      ? restaurant.menuImages.filter(Boolean)
      : [];

  if (!explicit.length && restaurant?.menu_image) {
    explicit.push(restaurant.menu_image);
  }
  if (!explicit.length && restaurant?.menuImage) {
    explicit.push(restaurant.menuImage);
  }

  if (!explicit.length) {
    explicit.push("");
  }

  return explicit;
}

function sanitizePersistedImageValue(value) {
  const text = asText(value);
  if (!text) return "";
  if (text.toLowerCase().startsWith("data:image")) return "";
  return text;
}

function normalizeBrandForWrite(brand) {
  const safe = brand && typeof brand === "object" ? { ...brand } : {};
  const name = asText(safe?.name || safe?.productName);
  if (!name) return null;

  const normalized = {
    ...safe,
    name,
    allergens: dedupeTokenList(safe?.allergens),
    diets: dedupeTokenList(safe?.diets),
    crossContaminationAllergens: dedupeTokenList(safe?.crossContaminationAllergens),
    crossContaminationDiets: dedupeTokenList(safe?.crossContaminationDiets),
    ingredientsList: Array.isArray(safe?.ingredientsList)
      ? safe.ingredientsList.map((entry) => asText(entry)).filter(Boolean)
      : [],
  };

  const brandImage = sanitizePersistedImageValue(safe?.brandImage);
  if (brandImage) normalized.brandImage = brandImage;
  else delete normalized.brandImage;

  const ingredientsImage = sanitizePersistedImageValue(safe?.ingredientsImage);
  if (ingredientsImage) normalized.ingredientsImage = ingredientsImage;
  else delete normalized.ingredientsImage;

  const image = sanitizePersistedImageValue(safe?.image);
  if (image) normalized.image = image;
  else delete normalized.image;

  return normalized;
}

function readFirstBrandForWrite(values) {
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeBrandForWrite(value);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeIngredientForWrite(ingredient, index) {
  const safe = ingredient && typeof ingredient === "object" ? { ...ingredient } : {};
  const firstBrand = readFirstBrandForWrite(safe?.brands);
  const brandImage = sanitizePersistedImageValue(safe?.brandImage);
  const ingredientsImage = sanitizePersistedImageValue(safe?.ingredientsImage);
  const image = sanitizePersistedImageValue(safe?.image);

  const normalized = {
    ...safe,
    rowIndex: Number.isFinite(Number(safe?.rowIndex))
      ? Math.max(Math.floor(Number(safe.rowIndex)), 0)
      : index,
    name: asText(safe?.name) || `Ingredient ${index + 1}`,
    allergens: dedupeTokenList(safe?.allergens),
    diets: dedupeTokenList(safe?.diets),
    crossContaminationAllergens: dedupeTokenList(safe?.crossContaminationAllergens),
    crossContaminationDiets: dedupeTokenList(safe?.crossContaminationDiets),
    aiDetectedAllergens: dedupeTokenList(safe?.aiDetectedAllergens || safe?.allergens),
    aiDetectedDiets: dedupeTokenList(safe?.aiDetectedDiets || safe?.diets),
    aiDetectedCrossContaminationAllergens: dedupeTokenList(
      safe?.aiDetectedCrossContaminationAllergens || safe?.crossContaminationAllergens,
    ),
    aiDetectedCrossContaminationDiets: dedupeTokenList(
      safe?.aiDetectedCrossContaminationDiets || safe?.crossContaminationDiets,
    ),
    removable: Boolean(safe?.removable),
    confirmed: safe?.confirmed === true,
    brands: firstBrand ? [firstBrand] : [],
  };

  if (brandImage) normalized.brandImage = brandImage;
  else delete normalized.brandImage;

  if (ingredientsImage) normalized.ingredientsImage = ingredientsImage;
  else delete normalized.ingredientsImage;

  if (image) normalized.image = image;
  else delete normalized.image;

  return normalized;
}

function stripEditorOverlay(overlay) {
  const next = { ...overlay };
  delete next._editorKey;

  const name = asText(next.name || next.id || "Dish");
  next.id = name;
  next.name = name;
  next.pageIndex = Math.max(0, Math.floor(normalizeNumber(next.pageIndex, 0)));
  next.x = normalizeRectValue(next.x, 0);
  next.y = normalizeRectValue(next.y, 0);
  next.w = clamp(normalizeRectValue(next.w, 1), 0.5, 100);
  next.h = clamp(normalizeRectValue(next.h, 1), 0.5, 100);
  next.ingredients = (Array.isArray(next.ingredients) ? next.ingredients : []).map(
    (ingredient, index) => normalizeIngredientForWrite(ingredient, index),
  );

  return next;
}

function toOverlayDishKey(overlay) {
  const name = asText(overlay?.id || overlay?.name || overlay?.dishName);
  if (!name) return "";
  const token = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return token || name;
}

function buildOverlayOrderAndMap(overlays) {
  const byKey = new Map();
  const order = [];
  const seen = new Set();

  (Array.isArray(overlays) ? overlays : []).forEach((overlay) => {
    const normalized = stripEditorOverlay(overlay);
    const key = toOverlayDishKey(normalized);
    if (!key) return;
    if (!seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
    byKey.set(key, normalized);
  });

  return { byKey, order };
}

function overlaysEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildOverlayDeltaPayload({ baselineOverlays, overlays }) {
  const baselineIndex = buildOverlayOrderAndMap(baselineOverlays);
  const currentIndex = buildOverlayOrderAndMap(overlays);
  const overlayUpserts = [];
  const overlayDeletes = [];
  const overlayBaselines = [];
  const baselineAdded = new Set();

  currentIndex.byKey.forEach((nextOverlay, key) => {
    const previousOverlay = baselineIndex.byKey.get(key);
    if (!previousOverlay || !overlaysEqual(previousOverlay, nextOverlay)) {
      overlayUpserts.push(nextOverlay);
      if (previousOverlay && !baselineAdded.has(key)) {
        overlayBaselines.push(previousOverlay);
        baselineAdded.add(key);
      }
    }
  });

  baselineIndex.byKey.forEach((previousOverlay, key) => {
    if (currentIndex.byKey.has(key)) return;
    overlayDeletes.push(key);
    if (!baselineAdded.has(key)) {
      overlayBaselines.push(previousOverlay);
      baselineAdded.add(key);
    }
  });

  const overlayOrderProvided =
    JSON.stringify(currentIndex.order) !== JSON.stringify(baselineIndex.order);

  return {
    overlayUpserts,
    overlayDeletes,
    overlayBaselines,
    overlayOrder: overlayOrderProvided ? currentIndex.order : [],
    overlayOrderProvided,
    hasOverlayChanges:
      overlayUpserts.length > 0 || overlayDeletes.length > 0 || overlayOrderProvided,
  };
}

function serializeEditorState(overlays, menuImages) {
  return JSON.stringify({
    overlays: (Array.isArray(overlays) ? overlays : []).map(stripEditorOverlay),
    menuImages: Array.isArray(menuImages) ? menuImages.filter(Boolean) : [],
  });
}

function normalizeMenuImageList(menuImages) {
  return (Array.isArray(menuImages) ? menuImages : [])
    .map((value) => asText(value))
    .filter(Boolean);
}

function serializeMenuImageList(menuImages) {
  return JSON.stringify(normalizeMenuImageList(menuImages));
}

function getUtf8ByteLength(value) {
  const text = asText(value);
  if (!text) return 0;
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length;
  }
}

async function compressMenuImageDataUrl(
  source,
  { targetMaxBytes = 220_000, maxDimension = 1600 } = {},
) {
  const input = asText(source);
  if (!input || !input.startsWith("data:image")) return input;
  if (getUtf8ByteLength(input) <= targetMaxBytes) return input;

  return await new Promise((resolve) => {
    const image = new Image();

    image.onload = () => {
      const naturalWidth = Number(image.naturalWidth || image.width || 0);
      const naturalHeight = Number(image.naturalHeight || image.height || 0);
      if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
        resolve(input);
        return;
      }
      if (naturalWidth <= 0 || naturalHeight <= 0) {
        resolve(input);
        return;
      }

      const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
      let width = Math.max(1, Math.floor(naturalWidth * scale));
      let height = Math.max(1, Math.floor(naturalHeight * scale));

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(input);
        return;
      }

      let best = input;
      let bestBytes = getUtf8ByteLength(input);
      const qualities = [0.82, 0.74, 0.66, 0.58];

      for (let pass = 0; pass < 4; pass += 1) {
        canvas.width = width;
        canvas.height = height;
        context.clearRect(0, 0, width, height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        try {
          context.drawImage(image, 0, 0, width, height);
        } catch {
          resolve(input);
          return;
        }

        for (const quality of qualities) {
          const candidate = canvas.toDataURL("image/jpeg", quality);
          const candidateBytes = getUtf8ByteLength(candidate);
          if (candidateBytes < bestBytes) {
            best = candidate;
            bestBytes = candidateBytes;
          }
          if (candidateBytes <= targetMaxBytes) {
            resolve(candidate);
            return;
          }
        }

        if (width <= 720 || height <= 720) {
          break;
        }

        width = Math.max(720, Math.floor(width * 0.82));
        height = Math.max(720, Math.floor(height * 0.82));
      }

      resolve(best);
    };

    image.onerror = () => resolve(input);
    image.src = input;
  });
}

async function optimizeMenuImagesForWrite(
  menuImages,
  { perImageMaxBytes = 220_000, totalMaxBytes = 850_000 } = {},
) {
  const normalized = normalizeMenuImageList(menuImages);
  if (!normalized.length) return [];

  let output = await Promise.all(
    normalized.map((image) =>
      compressMenuImageDataUrl(image, { targetMaxBytes: perImageMaxBytes }),
    ),
  );

  const totalBytes = output.reduce((sum, image) => sum + getUtf8ByteLength(image), 0);
  if (totalBytes <= totalMaxBytes) {
    return output;
  }

  const tightenedPerImage = Math.max(
    90_000,
    Math.floor(totalMaxBytes / Math.max(output.length, 1)),
  );
  output = await Promise.all(
    output.map((image) =>
      compressMenuImageDataUrl(image, {
        targetMaxBytes: tightenedPerImage,
        maxDimension: 1400,
      }),
    ),
  );
  return output;
}

function parseSerializedEditorState(serialized) {
  const text = asText(serialized);
  if (!text) {
    return {
      overlays: [],
      menuImages: [],
    };
  }

  try {
    const parsed = JSON.parse(text);
    return {
      overlays: Array.isArray(parsed?.overlays) ? parsed.overlays : [],
      menuImages: Array.isArray(parsed?.menuImages) ? parsed.menuImages : [],
    };
  } catch {
    return {
      overlays: [],
      menuImages: [],
    };
  }
}

function createEmptySettingsDraft(restaurant) {
  return {
    website: asText(restaurant?.website),
    phone: asText(restaurant?.phone),
    delivery_url: asText(restaurant?.delivery_url),
    menu_url: asText(restaurant?.menu_url),
  };
}

function serializeSettingsDraft(value) {
  return JSON.stringify({
    website: asText(value?.website),
    phone: asText(value?.phone),
    delivery_url: asText(value?.delivery_url),
    menu_url: asText(value?.menu_url),
  });
}

function parseChangeLogPayload(log) {
  const raw = log?.changes;
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function decodePendingChangeLine(line) {
  const text = asText(line);
  if (!text.startsWith(PENDING_CHANGE_KEY_PREFIX)) {
    return {
      key: "",
      text,
    };
  }

  const separatorIndex = text.indexOf("::", PENDING_CHANGE_KEY_PREFIX.length);
  if (separatorIndex < 0) {
    return {
      key: "",
      text,
    };
  }

  const encodedKey = text.slice(PENDING_CHANGE_KEY_PREFIX.length, separatorIndex);
  const decodedKey = asText(decodeURIComponent(encodedKey));
  return {
    key: decodedKey,
    text: asText(text.slice(separatorIndex + 2)),
  };
}

function encodePendingChangeLine(text, key) {
  const safeText = asText(text);
  const safeKey = asText(key);
  if (!safeText) return "";
  if (!safeKey) return safeText;
  return `${PENDING_CHANGE_KEY_PREFIX}${encodeURIComponent(safeKey)}::${safeText}`;
}

function buildDefaultChangeLogPayload({ author, pendingChanges, snapshot }) {
  const grouped = {};
  const general = [];
  (Array.isArray(pendingChanges) ? pendingChanges : []).forEach((line) => {
    const text = decodePendingChangeLine(line).text;
    if (!text) return;
    const splitIndex = text.indexOf(":");
    if (splitIndex > 0) {
      const itemName = asText(text.slice(0, splitIndex));
      const entry = asText(text.slice(splitIndex + 1));
      if (!itemName) {
        general.push(text);
        return;
      }
      if (!grouped[itemName]) grouped[itemName] = [];
      if (entry) grouped[itemName].push(entry);
      return;
    }
    general.push(text);
  });

  if (!general.length && !Object.keys(grouped).length) {
    general.push("Menu overlays updated");
  }

  const payload = {
    author: author || "Manager",
    general,
    items: grouped,
  };

  if (snapshot && typeof snapshot === "object") {
    payload.snapshot = snapshot;
  }

  return payload;
}

function computeDietBlockers(ingredients, diets) {
  const rows = Array.isArray(ingredients) ? ingredients : [];
  const dietList = Array.isArray(diets) ? diets : [];
  const output = {};

  dietList.forEach((diet) => {
    const blockers = rows
      .filter((ingredient) => {
        if (!Array.isArray(ingredient?.diets)) return true;
        return !ingredient.diets.includes(diet);
      })
      .map((ingredient) => ({
        ingredient: ingredient?.name || "Ingredient",
        removable: Boolean(ingredient?.removable),
      }));

    if (blockers.length) {
      output[diet] = blockers;
    }
  });

  return output;
}

async function toDataUrlFromImage(source) {
  const text = asText(source);
  if (!text) return "";
  if (text.startsWith("data:")) return text;

  try {
    const response = await fetch(text);
    if (!response.ok) return "";
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image blob"));
      reader.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
}

async function readImageDimensions(dataUrl) {
  const source = asText(dataUrl);
  if (!source) return null;

  return await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = Number(image.naturalWidth || image.width || 0);
      const height = Number(image.naturalHeight || image.height || 0);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        resolve(null);
        return;
      }
      resolve({ width, height });
    };
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

async function normalizeImageToLetterboxedSquare(source, targetSize = 1000) {
  const dataUrl = await toDataUrlFromImage(source);
  if (!dataUrl) return null;

  return await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const naturalWidth = Number(image.naturalWidth || image.width || 0);
      const naturalHeight = Number(image.naturalHeight || image.height || 0);
      if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
        resolve(null);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = targetSize;
      canvas.height = targetSize;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(null);
        return;
      }

      context.fillStyle = "#000000";
      context.fillRect(0, 0, targetSize, targetSize);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

      const scale = Math.min(targetSize / naturalWidth, targetSize / naturalHeight);
      const width = naturalWidth * scale;
      const height = naturalHeight * scale;
      const x = (targetSize - width) / 2;
      const y = (targetSize - height) / 2;

      try {
        context.drawImage(image, x, y, width, height);
      } catch {
        resolve(null);
        return;
      }

      resolve({
        dataUrl: canvas.toDataURL("image/jpeg", 0.92),
        metrics: { x, y, w: width, h: height, scale },
        imageWidth: naturalWidth,
        imageHeight: naturalHeight,
      });
    };
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

function cloneSnapshotList(value) {
  return JSON.parse(JSON.stringify(Array.isArray(value) ? value : []));
}

function buildPageMoveIndexMap(pageCount, fromIndex, toIndex) {
  const safeCount = Math.max(Number(pageCount) || 0, 1);
  const safeFrom = clamp(Number(fromIndex) || 0, 0, safeCount - 1);
  const safeTo = clamp(Number(toIndex) || 0, 0, safeCount - 1);
  const mapping = Array.from({ length: safeCount }, (_, index) => index);
  if (safeFrom === safeTo) return mapping;

  mapping.forEach((_, oldIndex) => {
    if (oldIndex === safeFrom) {
      mapping[oldIndex] = safeTo;
      return;
    }

    if (safeFrom < safeTo && oldIndex > safeFrom && oldIndex <= safeTo) {
      mapping[oldIndex] = oldIndex - 1;
      return;
    }

    if (safeFrom > safeTo && oldIndex >= safeTo && oldIndex < safeFrom) {
      mapping[oldIndex] = oldIndex + 1;
    }
  });

  return mapping;
}

function matchOverlayByDishName(overlays, dishName) {
  const target = asText(dishName).toLowerCase();
  if (!target) return null;
  return (
    (Array.isArray(overlays) ? overlays : []).find((overlay) => {
      const id = asText(overlay?.id || overlay?.name).toLowerCase();
      if (!id) return false;
      if (id === target) return true;
      const normalizedId = id.replace(/[^a-z0-9]/g, "");
      const normalizedTarget = target.replace(/[^a-z0-9]/g, "");
      return normalizedId && normalizedTarget && normalizedId === normalizedTarget;
    }) || null
  );
}

export function useRestaurantEditor({
  restaurant,
  overlays,
  permissions,
  config,
  previewPreferences,
  params,
  callbacks,
}) {
  const canEdit = Boolean(permissions?.canEdit);

  const [draftOverlays, setDraftOverlays] = useState([]);
  const [draftMenuImages, setDraftMenuImages] = useState([""]);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [zoomScale, setZoomScale] = useState(1);
  const [selectedOverlayKey, setSelectedOverlayKey] = useState("");
  const [pendingChanges, setPendingChanges] = useState([]);
  const [pendingSaveBatchId, setPendingSaveBatchId] = useState("");
  const [pendingSaveRows, setPendingSaveRows] = useState([]);
  const [pendingSaveStateHash, setPendingSaveStateHash] = useState("");
  const [pendingSaveError, setPendingSaveError] = useState("");
  const [pendingSavePreparing, setPendingSavePreparing] = useState(false);

  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle");

  const [dishEditorOpen, setDishEditorOpen] = useState(false);
  const [dishAiAssistOpen, setDishAiAssistOpen] = useState(false);
  const [changeLogOpen, setChangeLogOpen] = useState(false);
  const [pendingTableOpen, setPendingTableOpen] = useState(false);
  const [confirmInfoOpen, setConfirmInfoOpen] = useState(false);
  const [menuPagesOpen, setMenuPagesOpen] = useState(false);
  const [restaurantSettingsOpen, setRestaurantSettingsOpen] = useState(false);
  const [detectWizardOpen, setDetectWizardOpen] = useState(false);

  const [changeLogs, setChangeLogs] = useState([]);
  const [loadingChangeLogs, setLoadingChangeLogs] = useState(false);
  const [changeLogError, setChangeLogError] = useState("");
  const changeLogLoadedForOpenRef = useRef(false);
  const [pendingTableRows, setPendingTableRows] = useState([]);
  const [pendingTableBatch, setPendingTableBatch] = useState(null);
  const [loadingPendingTable, setLoadingPendingTable] = useState(false);
  const [pendingTableError, setPendingTableError] = useState("");
  const pendingTableLoadedForOpenRef = useRef(false);
  const pendingTableLoadPromiseRef = useRef(null);

  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState("");

  const [restaurantSettingsDraft, setRestaurantSettingsDraft] = useState(
    createEmptySettingsDraft(restaurant),
  );
  const [settingsSaveBusy, setSettingsSaveBusy] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState("");

  const [detectWizardState, setDetectWizardState] = useState({
    loading: false,
    dishes: [],
    currentIndex: 0,
    error: "",
  });
  const [initialDishResolved, setInitialDishResolved] = useState(false);

  const [aiAssistDraft, setAiAssistDraftState] = useState({
    text: "",
    imageData: "",
    loading: false,
    error: "",
    result: null,
  });

  const baselineRef = useRef("");
  const settingsBaselineRef = useRef("");
  const hydratedRestaurantIdRef = useRef("");
  const historyRef = useRef([]);
  const saveStatusTimerRef = useRef(0);
  const pendingSaveSyncTimerRef = useRef(0);
  const [historyIndex, setHistoryIndex] = useState(0);

  const overlaysRef = useRef(draftOverlays);
  const menuImagesRef = useRef(draftMenuImages);
  const pendingChangesRef = useRef(pendingChanges);
  const aiAssistDraftRef = useRef(aiAssistDraft);

  useEffect(() => {
    overlaysRef.current = draftOverlays;
  }, [draftOverlays]);

  useEffect(() => {
    menuImagesRef.current = draftMenuImages;
  }, [draftMenuImages]);

  useEffect(() => {
    pendingChangesRef.current = pendingChanges;
  }, [pendingChanges]);

  useEffect(() => {
    aiAssistDraftRef.current = aiAssistDraft;
  }, [aiAssistDraft]);

  const setAiAssistDraft = useCallback((nextValue) => {
    const current = aiAssistDraftRef.current;
    const nextDraft =
      typeof nextValue === "function" ? nextValue(current) : nextValue;
    aiAssistDraftRef.current = nextDraft;
    setAiAssistDraftState(nextDraft);
  }, []);

  const clearSaveStatusTimer = useCallback(() => {
    if (saveStatusTimerRef.current) {
      window.clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = 0;
    }
  }, []);

  useEffect(() => {
    return () => clearSaveStatusTimer();
  }, [clearSaveStatusTimer]);

  useEffect(() => {
    return () => {
      if (pendingSaveSyncTimerRef.current) {
        window.clearTimeout(pendingSaveSyncTimerRef.current);
        pendingSaveSyncTimerRef.current = 0;
      }
    };
  }, []);

  const appendPendingChange = useCallback((line, options = {}) => {
    const text = asText(line);
    const key = asText(options?.key);
    if (!text) return;
    setPendingChanges((current) => {
      const encoded = encodePendingChangeLine(text, key);
      if (!key) {
        return [...current, encoded];
      }

      const filtered = current.filter((entry) => decodePendingChangeLine(entry).key !== key);
      return [...filtered, encoded];
    });
  }, []);

  const clearPendingSaveBatch = useCallback(() => {
    setPendingSaveBatchId("");
    setPendingSaveRows([]);
    setPendingSaveStateHash("");
    setPendingSaveError("");
    setPendingSavePreparing(false);
  }, []);

  const captureSnapshot = useCallback(() => {
    return {
      overlays: cloneSnapshotList(overlaysRef.current),
      menuImages: cloneSnapshotList(menuImagesRef.current),
      pendingChanges: [...(pendingChangesRef.current || [])],
    };
  }, []);

  const createDraftSnapshot = useCallback(() => {
    return {
      overlays: cloneSnapshotList(overlaysRef.current),
      menuImages: cloneSnapshotList(menuImagesRef.current),
      pendingChanges: [...(pendingChangesRef.current || [])],
      selectedOverlayKey: asText(selectedOverlayKey),
      activePageIndex: Number(activePageIndex) || 0,
      history: cloneSnapshotList(historyRef.current),
      historyIndex: Number(historyIndex) || 0,
    };
  }, [activePageIndex, historyIndex, selectedOverlayKey]);

  const pushHistory = useCallback(() => {
    const snapshot = captureSnapshot();
    const serialized = serializeEditorState(snapshot.overlays, snapshot.menuImages);

    const currentList = historyRef.current.slice(0, historyIndex + 1);
    const last = currentList[currentList.length - 1];
    if (last && serializeEditorState(last.overlays, last.menuImages) === serialized) {
      return;
    }

    currentList.push(snapshot);
    while (currentList.length > HISTORY_LIMIT) {
      currentList.shift();
    }

    historyRef.current = currentList;
    setHistoryIndex(currentList.length - 1);
  }, [captureSnapshot, historyIndex]);

  const restoreHistorySnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    const images = Array.isArray(snapshot.menuImages) && snapshot.menuImages.length
      ? snapshot.menuImages
      : [""];
    const context = buildOverlayNormalizationContext(snapshot.overlays, images.length);
    const overlaysList = Array.isArray(snapshot.overlays)
      ? snapshot.overlays.map((overlay, index) =>
          ensureOverlayVisibility(
            normalizeOverlay(
              overlay,
              index,
              overlay?._editorKey || `ov-${Date.now()}-${index}`,
              context,
            ),
            images.length,
          ),
        )
      : [];

    overlaysRef.current = overlaysList;
    menuImagesRef.current = images;
    pendingChangesRef.current = Array.isArray(snapshot.pendingChanges)
      ? [...snapshot.pendingChanges]
      : [];

    setDraftOverlays(overlaysList);
    setDraftMenuImages(images);
    setPendingChanges(pendingChangesRef.current);
    setSelectedOverlayKey((current) => {
      if (current && overlaysList.some((overlay) => overlay._editorKey === current)) {
        return current;
      }
      return overlaysList[0]?._editorKey || "";
    });
    setActivePageIndex((current) =>
      clamp(current, 0, Math.max(images.length - 1, 0)),
    );
  }, []);

  const restoreDraftSnapshot = useCallback((snapshot) => {
    if (!snapshot || typeof snapshot !== "object") return { success: false };

    const nextSnapshot = {
      overlays: cloneSnapshotList(snapshot.overlays),
      menuImages: cloneSnapshotList(snapshot.menuImages),
      pendingChanges: Array.isArray(snapshot.pendingChanges)
        ? [...snapshot.pendingChanges]
        : [],
    };
    if (!nextSnapshot.menuImages.length) {
      nextSnapshot.menuImages = [""];
    }

    restoreHistorySnapshot(nextSnapshot);

    const restoredOverlays = Array.isArray(nextSnapshot.overlays)
      ? nextSnapshot.overlays
      : [];
    const selectedKey = asText(snapshot.selectedOverlayKey);
    const restoredSelectedKey =
      selectedKey &&
      restoredOverlays.some((overlay) => overlay?._editorKey === selectedKey)
        ? selectedKey
        : restoredOverlays[0]?._editorKey || "";
    setSelectedOverlayKey(restoredSelectedKey);

    const restoredPage = clamp(
      Number(snapshot.activePageIndex) || 0,
      0,
      Math.max(nextSnapshot.menuImages.length - 1, 0),
    );
    setActivePageIndex(restoredPage);

    const historyList = Array.isArray(snapshot.history) && snapshot.history.length
      ? cloneSnapshotList(snapshot.history).map((entry) => ({
          overlays: cloneSnapshotList(entry?.overlays),
          menuImages: cloneSnapshotList(entry?.menuImages),
          pendingChanges: Array.isArray(entry?.pendingChanges)
            ? [...entry.pendingChanges]
            : [],
        }))
      : [nextSnapshot];

    historyRef.current = historyList;
    setHistoryIndex(
      clamp(
        Number(snapshot.historyIndex) || 0,
        0,
        Math.max(historyList.length - 1, 0),
      ),
    );

    return { success: true };
  }, [restoreHistorySnapshot]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    const snapshot = historyRef.current[nextIndex];
    if (!snapshot) return;
    restoreHistorySnapshot(snapshot);
    setHistoryIndex(nextIndex);
  }, [historyIndex, restoreHistorySnapshot]);

  const undoPendingChange = useCallback((changeIndex) => {
    const safeIndex = Math.floor(Number(changeIndex));
    if (!Number.isFinite(safeIndex) || safeIndex < 0) {
      return { success: false };
    }

    const currentPending = Array.isArray(pendingChangesRef.current)
      ? pendingChangesRef.current
      : [];
    if (!currentPending.length || safeIndex >= currentPending.length) {
      return { success: false };
    }

    const targetPendingCount = safeIndex;
    let targetHistoryIndex = -1;

    for (let index = historyIndex; index >= 0; index -= 1) {
      const snapshot = historyRef.current[index];
      const snapshotPendingCount = Array.isArray(snapshot?.pendingChanges)
        ? snapshot.pendingChanges.length
        : 0;
      if (snapshotPendingCount <= targetPendingCount) {
        targetHistoryIndex = index;
        break;
      }
    }

    if (targetHistoryIndex < 0) {
      return { success: false };
    }

    const targetSnapshot = historyRef.current[targetHistoryIndex];
    if (!targetSnapshot) {
      return { success: false };
    }

    restoreHistorySnapshot(targetSnapshot);
    setHistoryIndex(targetHistoryIndex);
    return {
      success: true,
      undoneCount: Math.max(currentPending.length - targetPendingCount, 0),
    };
  }, [historyIndex, restoreHistorySnapshot]);

  const redo = useCallback(() => {
    if (historyIndex >= historyRef.current.length - 1) return;
    const nextIndex = historyIndex + 1;
    const snapshot = historyRef.current[nextIndex];
    if (!snapshot) return;
    restoreHistorySnapshot(snapshot);
    setHistoryIndex(nextIndex);
  }, [historyIndex, restoreHistorySnapshot]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historyRef.current.length - 1;

  useEffect(() => {
    const nextOverlaysRaw = Array.isArray(overlays)
      ? overlays
      : Array.isArray(restaurant?.overlays)
        ? restaurant.overlays
        : [];

    const nextMenuImages = buildMenuImages(restaurant);
    const context = buildOverlayNormalizationContext(nextOverlaysRaw, nextMenuImages.length);
    const nextOverlays = nextOverlaysRaw.map((overlay, index) =>
      ensureOverlayVisibility(
        normalizeOverlay(
          overlay,
          index,
          overlay?._editorKey || `ov-${Date.now()}-${index}`,
          context,
        ),
        nextMenuImages.length,
      ),
    );

    const nextBaseline = serializeEditorState(nextOverlays, nextMenuImages);
    const settingsDraft = createEmptySettingsDraft(restaurant);
    const nextSettingsBaseline = serializeSettingsDraft(settingsDraft);
    const nextRestaurantId = asText(restaurant?.id);

    const shouldReinitialize =
      nextBaseline !== baselineRef.current ||
      nextSettingsBaseline !== settingsBaselineRef.current ||
      nextRestaurantId !== hydratedRestaurantIdRef.current;

    if (!shouldReinitialize) {
      setChangeLogOpen(Boolean(params?.openLog));
      setConfirmInfoOpen(Boolean(params?.openConfirm));
      return;
    }

    baselineRef.current = nextBaseline;
    settingsBaselineRef.current = nextSettingsBaseline;
    hydratedRestaurantIdRef.current = nextRestaurantId;

    setDraftOverlays(nextOverlays);
    setDraftMenuImages(nextMenuImages);
    setActivePageIndex(0);
    setZoomScale(1);
    setSelectedOverlayKey(nextOverlays[0]?._editorKey || "");
    setPendingChanges([]);
    clearPendingSaveBatch();
    setSaveError("");
    setIsSaving(false);
    clearSaveStatusTimer();
    setSaveStatus("idle");

    setRestaurantSettingsDraft(settingsDraft);
    setSettingsSaveError("");

    const firstSnapshot = {
      overlays: JSON.parse(JSON.stringify(nextOverlays)),
      menuImages: [...nextMenuImages],
      pendingChanges: [],
    };
    historyRef.current = [firstSnapshot];
    setHistoryIndex(0);

    setDishEditorOpen(false);
    setDishAiAssistOpen(false);
    setChangeLogOpen(Boolean(params?.openLog));
    setConfirmInfoOpen(Boolean(params?.openConfirm));
    setMenuPagesOpen(false);
    setRestaurantSettingsOpen(false);
    setDetectWizardOpen(false);
    setDetectWizardState({
      loading: false,
      dishes: [],
      currentIndex: 0,
      error: "",
    });
    setInitialDishResolved(false);

    setAiAssistDraft({
      text: "",
      imageData: "",
      loading: false,
      error: "",
      result: null,
    });
  }, [
    clearPendingSaveBatch,
    clearSaveStatusTimer,
    overlays,
    restaurant?.id,
    restaurant?.overlays,
    restaurant?.menu_images,
    restaurant?.menu_image,
    restaurant?.menuImages,
    restaurant?.menuImage,
    restaurant?.website,
    restaurant?.phone,
    restaurant?.delivery_url,
    restaurant?.menu_url,
    params?.openConfirm,
    params?.openLog,
    setAiAssistDraft,
  ]);

  const editorStateSerialized = useMemo(
    () => serializeEditorState(draftOverlays, draftMenuImages),
    [draftMenuImages, draftOverlays],
  );

  useEffect(() => {
    if (!pendingSaveBatchId || !pendingSaveStateHash) return;
    if (editorStateSerialized === pendingSaveStateHash) return;
    clearPendingSaveBatch();
  }, [
    clearPendingSaveBatch,
    editorStateSerialized,
    pendingSaveBatchId,
    pendingSaveStateHash,
  ]);

  const isDirty = editorStateSerialized !== baselineRef.current;
  const settingsDirty =
    serializeSettingsDraft(restaurantSettingsDraft) !== settingsBaselineRef.current;

  const getBaselineSnapshot = useCallback(() => {
    return parseSerializedEditorState(baselineRef.current);
  }, []);

  useEffect(() => {
    if (!isDirty) return;
    if (saveStatus === "saving") return;
    if (saveStatus !== "idle") {
      clearSaveStatusTimer();
      setSaveStatus("idle");
    }
  }, [clearSaveStatusTimer, isDirty, saveStatus]);

  const selectedOverlay = useMemo(() => {
    if (!selectedOverlayKey) return draftOverlays[0] || null;
    return (
      draftOverlays.find((overlay) => overlay._editorKey === selectedOverlayKey) ||
      draftOverlays[0] ||
      null
    );
  }, [draftOverlays, selectedOverlayKey]);

  const allergenTokenLookup = useMemo(
    () => buildCanonicalTokenLookup(config?.ALLERGENS),
    [config?.ALLERGENS],
  );
  const dietTokenLookup = useMemo(
    () => buildCanonicalTokenLookup(config?.DIETS),
    [config?.DIETS],
  );

  const normalizeAllergenValue = useCallback(
    (value) =>
      resolveCanonicalValue(value, {
        strictNormalizer: config?.normalizeAllergen,
        tokenLookup: allergenTokenLookup,
      }),
    [allergenTokenLookup, config?.normalizeAllergen],
  );

  const normalizeDietValue = useCallback(
    (value) =>
      resolveCanonicalValue(value, {
        strictNormalizer: config?.normalizeDietLabel,
        tokenLookup: dietTokenLookup,
        aliasResolver: (token) => findDietAlias(token, dietTokenLookup),
      }),
    [config?.normalizeDietLabel, dietTokenLookup],
  );

  const normalizeAllergenList = useCallback(
    (values) => normalizeCanonicalList(values, normalizeAllergenValue),
    [normalizeAllergenValue],
  );

  const normalizeDietList = useCallback(
    (values) => normalizeCanonicalList(values, normalizeDietValue),
    [normalizeDietValue],
  );

  const selectedOverlayIndex = useMemo(() => {
    if (!selectedOverlay?._editorKey) return -1;
    return draftOverlays.findIndex(
      (overlay) => overlay._editorKey === selectedOverlay._editorKey,
    );
  }, [draftOverlays, selectedOverlay?._editorKey]);

  const selectedPageIndex = selectedOverlay
    ? clamp(
        Number.isFinite(Number(selectedOverlay.pageIndex))
          ? Number(selectedOverlay.pageIndex)
          : 0,
        0,
        Math.max(draftMenuImages.length - 1, 0),
      )
    : activePageIndex;

  const overlaysByPage = useMemo(() => {
    const pages = Array.from({ length: Math.max(draftMenuImages.length, 1) }, (_, index) => ({
      pageIndex: index,
      image: draftMenuImages[index] || "",
      overlays: [],
    }));

    draftOverlays.forEach((overlay) => {
      const page = clamp(
        Number.isFinite(Number(overlay.pageIndex)) ? Number(overlay.pageIndex) : 0,
        0,
        Math.max(pages.length - 1, 0),
      );
      pages[page].overlays.push(overlay);
    });

    return pages;
  }, [draftMenuImages, draftOverlays]);

  const applyOverlayList = useCallback((updater) => {
    setDraftOverlays((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      overlaysRef.current = next;
      return next;
    });
  }, []);

  const updateOverlay = useCallback((overlayKey, patch, options = {}) => {
    if (!overlayKey) return;

    applyOverlayList((current) =>
      current.map((overlay, index) => {
        if (overlay._editorKey !== overlayKey) return overlay;
        const next = ensureOverlayVisibility(
          normalizeOverlay(
            {
              ...overlay,
              ...(typeof patch === "function" ? patch(overlay) : patch),
            },
            index,
            overlay._editorKey,
          ),
          menuImagesRef.current.length,
        );

        // Keep within bounds after resize/drag edits.
        next.w = clamp(next.w, 0.5, 100);
        next.h = clamp(next.h, 0.5, 100);
        next.x = clamp(next.x, 0, 100 - next.w);
        next.y = clamp(next.y, 0, 100 - next.h);

        return next;
      }),
    );

    if (options?.changeText) {
      appendPendingChange(options.changeText, {
        key: options?.changeKey,
      });
    }

    if (options?.recordHistory) {
      queueMicrotask(() => pushHistory());
    }
  }, [appendPendingChange, applyOverlayList, pushHistory]);

  const addOverlay = useCallback(() => {
    const nextKey = `ov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    applyOverlayList((current) => {
      const nextIndex = current.length;
      const next = [
        ...current,
        ensureOverlayVisibility(
          normalizeOverlay(
            {
              _editorKey: nextKey,
              id: `Dish ${nextIndex + 1}`,
              name: `Dish ${nextIndex + 1}`,
              description: "",
              x: 10,
              y: 10,
              w: 22,
              h: 8,
              pageIndex: activePageIndex,
              allergens: [],
              diets: [],
              removable: [],
              crossContaminationAllergens: [],
              crossContaminationDiets: [],
              details: {},
              ingredients: [],
            },
            nextIndex,
            nextKey,
          ),
          menuImagesRef.current.length,
        ),
      ];
      return next;
    });

    setSelectedOverlayKey(nextKey);
    appendPendingChange(`Dish ${draftOverlays.length + 1}: Added overlay`);
    queueMicrotask(() => pushHistory());
  }, [
    activePageIndex,
    appendPendingChange,
    applyOverlayList,
    draftOverlays.length,
    pushHistory,
  ]);

  const removeOverlay = useCallback((overlayKey) => {
    const overlay = overlaysRef.current.find((item) => item._editorKey === overlayKey);
    const overlayName = asText(overlay?.id || overlay?.name || "Dish");

    applyOverlayList((current) => current.filter((item) => item._editorKey !== overlayKey));
    setSelectedOverlayKey((current) => {
      if (current !== overlayKey) return current;
      const fallback = overlaysRef.current.find((item) => item._editorKey !== overlayKey);
      return fallback?._editorKey || "";
    });

    appendPendingChange(`${overlayName}: Removed overlay`);
    queueMicrotask(() => pushHistory());
  }, [appendPendingChange, applyOverlayList, pushHistory]);

  const selectOverlay = useCallback((overlayKey) => {
    setSelectedOverlayKey(asText(overlayKey));
  }, []);

  const openDishEditor = useCallback((overlayKey) => {
    if (!overlayKey) return;
    setSelectedOverlayKey(overlayKey);
    setDishEditorOpen(true);
  }, []);

  const closeDishEditor = useCallback(() => {
    setDishEditorOpen(false);
    setDishAiAssistOpen(false);
    setAiAssistDraft({
      text: "",
      imageData: "",
      loading: false,
      error: "",
      result: null,
    });
  }, [setAiAssistDraft]);

  const updateSelectedOverlay = useCallback(
    (patch, options = {}) => {
      if (!selectedOverlay?._editorKey) return;
      updateOverlay(selectedOverlay._editorKey, patch, options);
    },
    [selectedOverlay?._editorKey, updateOverlay],
  );

  const toggleSelectedAllergen = useCallback((allergenKey) => {
    const key = asText(allergenKey);
    if (!key || !selectedOverlay?._editorKey) return;

    updateOverlay(selectedOverlay._editorKey, (overlay) => {
      const nextSet = new Set(overlay.allergens || []);
      if (nextSet.has(key)) {
        nextSet.delete(key);
      } else {
        nextSet.add(key);
      }

      const nextDetails = { ...(overlay.details || {}) };
      if (!nextSet.has(key)) {
        delete nextDetails[key];
      }

      const nextRemovable = (overlay.removable || []).filter(
        (item) => asText(item?.allergen) !== key,
      );

      const nextCross = (overlay.crossContaminationAllergens || []).filter(
        (item) => asText(item) !== key,
      );

      return {
        allergens: Array.from(nextSet),
        details: nextDetails,
        removable: nextRemovable,
        crossContaminationAllergens: nextSet.has(key)
          ? overlay.crossContaminationAllergens || []
          : nextCross,
      };
    });
  }, [selectedOverlay?._editorKey, updateOverlay]);

  const setSelectedAllergenDetail = useCallback((allergenKey, value) => {
    const key = asText(allergenKey);
    if (!key || !selectedOverlay?._editorKey) return;

    updateOverlay(selectedOverlay._editorKey, (overlay) => ({
      details: {
        ...(overlay.details || {}),
        [key]: asText(value),
      },
    }));
  }, [selectedOverlay?._editorKey, updateOverlay]);

  const setSelectedAllergenRemovable = useCallback((allergenKey, checked) => {
    const key = asText(allergenKey);
    if (!key || !selectedOverlay?._editorKey) return;

    updateOverlay(selectedOverlay._editorKey, (overlay) => {
      const existing = Array.isArray(overlay.removable) ? overlay.removable : [];
      const filtered = existing.filter((item) => asText(item?.allergen) !== key);
      if (checked) {
        filtered.push({
          allergen: key,
          component: asText((overlay.details || {})[key]) || key,
        });
      }
      return {
        removable: filtered,
      };
    });
  }, [selectedOverlay?._editorKey, updateOverlay]);

  const setSelectedAllergenCrossContamination = useCallback((allergenKey, checked) => {
    const key = asText(allergenKey);
    if (!key || !selectedOverlay?._editorKey) return;

    updateOverlay(selectedOverlay._editorKey, (overlay) => {
      const set = new Set(Array.isArray(overlay.crossContaminationAllergens) ? overlay.crossContaminationAllergens : []);
      if (checked) {
        set.add(key);
      } else {
        set.delete(key);
      }
      return {
        crossContaminationAllergens: Array.from(set),
      };
    });
  }, [selectedOverlay?._editorKey, updateOverlay]);

  const toggleSelectedDiet = useCallback((dietLabel) => {
    const diet = asText(dietLabel);
    if (!diet || !selectedOverlay?._editorKey) return;

    updateOverlay(selectedOverlay._editorKey, (overlay) => {
      const set = new Set(overlay.diets || []);
      if (set.has(diet)) set.delete(diet);
      else set.add(diet);
      return { diets: Array.from(set) };
    });
  }, [selectedOverlay?._editorKey, updateOverlay]);

  const addMenuPages = useCallback((images, options = {}) => {
    const values = (Array.isArray(images) ? images : [])
      .map((value) => asText(value))
      .filter(Boolean);
    if (!values.length) {
      return { added: 0, startIndex: menuImagesRef.current.length };
    }

    const currentLength = Math.max(menuImagesRef.current.length, 1);
    const requestedIndex = Number(options?.atIndex);
    const insertAt = Number.isFinite(requestedIndex)
      ? clamp(Math.floor(requestedIndex), 0, currentLength)
      : currentLength;

    setDraftMenuImages((current) => {
      const next = [...current];
      next.splice(insertAt, 0, ...values);
      menuImagesRef.current = next;
      return next;
    });

    if (insertAt < currentLength) {
      applyOverlayList((current) =>
        current.map((overlay) => {
          const page = Number.isFinite(Number(overlay.pageIndex))
            ? Number(overlay.pageIndex)
            : 0;
          if (page >= insertAt) {
            return { ...overlay, pageIndex: page + values.length };
          }
          return overlay;
        }),
      );
    }

    setActivePageIndex((current) => {
      if (Number.isFinite(Number(options?.focusIndex))) {
        return clamp(
          insertAt + Math.floor(Number(options.focusIndex)),
          0,
          Math.max(menuImagesRef.current.length - 1, 0),
        );
      }
      return clamp(current, 0, Math.max(menuImagesRef.current.length - 1, 0));
    });

    appendPendingChange(
      `Menu pages: Added ${values.length} page${values.length === 1 ? "" : "s"}`,
    );
    appendPendingChange(
      `Menu images: Uploaded ${values.length} new image${values.length === 1 ? "" : "s"}`,
    );
    queueMicrotask(() => pushHistory());

    return {
      added: values.length,
      startIndex: insertAt,
    };
  }, [appendPendingChange, applyOverlayList, pushHistory]);

  const addMenuPage = useCallback((imageDataUrl) => {
    const value = asText(imageDataUrl);
    if (!value) return;
    addMenuPages([value]);
  }, [addMenuPages]);

  const replaceMenuPageWithSections = useCallback((index, sections) => {
    const entries = (Array.isArray(sections) ? sections : [])
      .map((section) => {
        if (typeof section === "string") {
          return {
            dataUrl: asText(section),
            yStart: 0,
            yEnd: 100,
          };
        }

        const dataUrl = asText(section?.dataUrl || section?.image);
        const rawStart = Number(section?.yStart ?? section?.bounds?.yStart ?? 0);
        const rawEnd = Number(section?.yEnd ?? section?.bounds?.yEnd ?? 100);
        return {
          dataUrl,
          yStart: clamp(Number.isFinite(rawStart) ? rawStart : 0, 0, 100),
          yEnd: clamp(Number.isFinite(rawEnd) ? rawEnd : 100, 0, 100),
        };
      })
      .filter((entry) => entry.dataUrl);

    if (!entries.length) return { replaced: false, sectionCount: 0 };

    const normalizedEntries = entries.map((entry, entryIndex) => {
      const defaultStart = (entryIndex * 100) / entries.length;
      const defaultEnd = ((entryIndex + 1) * 100) / entries.length;
      const yStart = Number.isFinite(entry.yStart) ? entry.yStart : defaultStart;
      const yEnd = Number.isFinite(entry.yEnd) ? entry.yEnd : defaultEnd;
      const safeStart = clamp(Math.min(yStart, yEnd), 0, 100);
      const safeEnd = clamp(Math.max(yStart, yEnd), 0, 100);
      return {
        dataUrl: entry.dataUrl,
        yStart: safeStart,
        yEnd: safeEnd <= safeStart ? Math.min(100, safeStart + 0.1) : safeEnd,
      };
    });

    const targetIndex = clamp(
      Number(index) || 0,
      0,
      Math.max(menuImagesRef.current.length - 1, 0),
    );
    const delta = normalizedEntries.length - 1;
    const nextPageCount = Math.max(menuImagesRef.current.length + delta, 1);

    setDraftMenuImages((current) => {
      const next = [...current];
      next.splice(
        targetIndex,
        1,
        ...normalizedEntries.map((entry) => entry.dataUrl),
      );
      menuImagesRef.current = next.length ? next : [""];
      return menuImagesRef.current;
    });

    applyOverlayList((current) =>
      current.map((overlay) => {
        const page = Number.isFinite(Number(overlay.pageIndex))
          ? Number(overlay.pageIndex)
          : 0;

        if (page < targetIndex) {
          return ensureOverlayVisibility(overlay, nextPageCount);
        }

        if (page > targetIndex) {
          return ensureOverlayVisibility(
            { ...overlay, pageIndex: page + delta },
            nextPageCount,
          );
        }

        if (normalizedEntries.length === 1) {
          return ensureOverlayVisibility(
            { ...overlay, pageIndex: targetIndex },
            nextPageCount,
          );
        }

        const top = clamp(Number(overlay.y) || 0, 0, 100);
        const height = clamp(Number(overlay.h) || 1, 0.5, 100);
        const bottom = clamp(top + height, 0, 100);
        const centerY = top + height / 2;

        let targetSectionIndex = 0;
        let bestOverlap = -1;

        normalizedEntries.forEach((entry, entryIndex) => {
          const overlap = Math.max(
            0,
            Math.min(bottom, entry.yEnd) - Math.max(top, entry.yStart),
          );
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            targetSectionIndex = entryIndex;
          }
        });

        if (bestOverlap <= 0) {
          const fallbackIndex = normalizedEntries.findIndex(
            (entry) => centerY >= entry.yStart && centerY <= entry.yEnd,
          );
          if (fallbackIndex >= 0) targetSectionIndex = fallbackIndex;
        }

        const section =
          normalizedEntries[targetSectionIndex] || normalizedEntries[0] || null;
        if (!section) {
          return ensureOverlayVisibility(
            { ...overlay, pageIndex: targetIndex },
            nextPageCount,
          );
        }

        const sectionSpan = Math.max(section.yEnd - section.yStart, 0.1);
        const clippedTop = clamp(top, section.yStart, section.yEnd);
        const clippedBottom = clamp(bottom, section.yStart, section.yEnd);
        let sectionTop = ((clippedTop - section.yStart) / sectionSpan) * 100;
        let sectionBottom = ((clippedBottom - section.yStart) / sectionSpan) * 100;

        if (sectionBottom - sectionTop < 0.5) {
          const center = ((centerY - section.yStart) / sectionSpan) * 100;
          sectionTop = clamp(center - 1, 0, 99.5);
          sectionBottom = clamp(center + 1, sectionTop + 0.5, 100);
        }

        return ensureOverlayVisibility(
          {
            ...overlay,
            pageIndex: targetIndex + targetSectionIndex,
            y: sectionTop,
            h: Math.max(0.5, sectionBottom - sectionTop),
          },
          nextPageCount,
        );
      }),
    );

    setActivePageIndex((current) => {
      if (current < targetIndex) return current;
      if (current === targetIndex) return targetIndex;
      return clamp(current + delta, 0, Math.max(nextPageCount - 1, 0));
    });

    appendPendingChange(
      `Menu pages: Replaced page ${targetIndex + 1} with ${normalizedEntries.length} section${normalizedEntries.length === 1 ? "" : "s"}`,
    );
    appendPendingChange(
      `Menu images: Uploaded replacement image for page ${targetIndex + 1}`,
    );
    queueMicrotask(() => pushHistory());

    return { replaced: true, sectionCount: normalizedEntries.length };
  }, [appendPendingChange, applyOverlayList, pushHistory]);

  const replaceMenuPage = useCallback((index, imageDataUrl) => {
    const value = asText(imageDataUrl);
    if (!value) return;
    replaceMenuPageWithSections(index, [value]);
  }, [replaceMenuPageWithSections]);

  const removeMenuPage = useCallback((index) => {
    const targetIndex = clamp(Number(index) || 0, 0, Math.max(draftMenuImages.length - 1, 0));

    setDraftMenuImages((current) => {
      const next = current.filter((_, i) => i !== targetIndex);
      if (!next.length) {
        next.push("");
      }
      menuImagesRef.current = next;
      return next;
    });

    applyOverlayList((current) => {
      const next = current
        .filter((overlay) => {
          const page = Number.isFinite(Number(overlay.pageIndex))
            ? Number(overlay.pageIndex)
            : 0;
          return page !== targetIndex;
        })
        .map((overlay) => {
          const page = Number.isFinite(Number(overlay.pageIndex))
            ? Number(overlay.pageIndex)
            : 0;
          if (page > targetIndex) {
            return { ...overlay, pageIndex: page - 1 };
          }
          return overlay;
        });
      return next;
    });

    setActivePageIndex((current) => clamp(current, 0, Math.max(menuImagesRef.current.length - 1, 0)));
    appendPendingChange(`Menu pages: Removed page ${targetIndex + 1}`);
    queueMicrotask(() => pushHistory());
  }, [appendPendingChange, applyOverlayList, draftMenuImages.length, pushHistory]);

  const moveMenuPage = useCallback((fromIndex, toIndex) => {
    const pageCount = Math.max(menuImagesRef.current.length, 1);
    const safeFrom = clamp(Number(fromIndex) || 0, 0, pageCount - 1);
    const safeTo = clamp(Number(toIndex) || 0, 0, pageCount - 1);
    if (safeFrom === safeTo) {
      return { moved: false, fromIndex: safeFrom, toIndex: safeTo };
    }

    const indexMap = buildPageMoveIndexMap(pageCount, safeFrom, safeTo);

    setDraftMenuImages((current) => {
      const next = [...current];
      const [movedImage] = next.splice(safeFrom, 1);
      next.splice(safeTo, 0, movedImage || "");
      menuImagesRef.current = next.length ? next : [""];
      return menuImagesRef.current;
    });

    applyOverlayList((current) =>
      current.map((overlay) => {
        const page = clamp(
          Number.isFinite(Number(overlay.pageIndex)) ? Number(overlay.pageIndex) : 0,
          0,
          pageCount - 1,
        );
        const mapped = Number.isFinite(Number(indexMap[page])) ? Number(indexMap[page]) : page;
        return ensureOverlayVisibility(
          {
            ...overlay,
            pageIndex: mapped,
          },
          pageCount,
        );
      }),
    );

    setActivePageIndex((current) => {
      const safeCurrent = clamp(Number(current) || 0, 0, pageCount - 1);
      const mapped = Number.isFinite(Number(indexMap[safeCurrent]))
        ? Number(indexMap[safeCurrent])
        : safeCurrent;
      return clamp(mapped, 0, pageCount - 1);
    });

    appendPendingChange(`Menu pages: Moved page ${safeFrom + 1} to ${safeTo + 1}`);
    queueMicrotask(() => pushHistory());

    return { moved: true, fromIndex: safeFrom, toIndex: safeTo };
  }, [appendPendingChange, applyOverlayList, pushHistory]);

  const analyzeMenuPagesAndMergeOverlays = useCallback(async ({
    pageIndices,
    removeUnmatchedPageIndices,
    requireDetectionsForPageIndices,
    pageSourceIndexMap,
    baselineMenuImages,
    baselineOverlays,
  } = {}) => {
    if (!callbacks?.onAnalyzeMenuImage) {
      return {
        success: false,
        updatedCount: 0,
        addedCount: 0,
        removedCount: 0,
        errors: ["Menu image analysis callback is not configured."],
        pageResults: [],
      };
    }

    const pageCount = Math.max(menuImagesRef.current.length, 1);
    const candidatePages =
      Array.isArray(pageIndices) && pageIndices.length
        ? pageIndices
        : Array.from({ length: pageCount }, (_, index) => index);
    const targetPages = Array.from(
      new Set(
        candidatePages
          .map((index) => Number(index))
          .filter((index) => Number.isFinite(index))
          .map((index) => clamp(Math.floor(index), 0, pageCount - 1)),
      ),
    );

    if (!targetPages.length) {
      return {
        success: false,
        updatedCount: 0,
        addedCount: 0,
        removedCount: 0,
        errors: ["No menu pages were selected for analysis."],
        pageResults: [],
      };
    }

    const removeUnmatchedPages = new Set(
      (Array.isArray(removeUnmatchedPageIndices) ? removeUnmatchedPageIndices : [])
        .map((index) => Number(index))
        .filter((index) => Number.isFinite(index))
        .map((index) => clamp(Math.floor(index), 0, pageCount - 1)),
    );
    const requiredDetectionPages = new Set(
      (Array.isArray(requireDetectionsForPageIndices) ? requireDetectionsForPageIndices : [])
        .map((index) => Number(index))
        .filter((index) => Number.isFinite(index))
        .map((index) => clamp(Math.floor(index), 0, pageCount - 1)),
    );

    const sourceIndexMap = Array.isArray(pageSourceIndexMap) ? pageSourceIndexMap : [];
    const baselineImageList = Array.isArray(baselineMenuImages) ? baselineMenuImages : [];
    const baselineOverlayList = Array.isArray(baselineOverlays) ? baselineOverlays : [];
    const useRemapMode = baselineImageList.length > 0 && sourceIndexMap.length > 0;

    const pageDetections = [];
    const pageResults = [];
    const errors = [];

    const normalizeDetectedRect = (dish, imageDimensions) => {
      const name = asText(dish?.name || dish?.dishName);
      if (!name) return null;

      const xValue = Number(dish?.x);
      const yValue = Number(dish?.y);
      const wValue = Number(dish?.w);
      const hValue = Number(dish?.h);
      if (
        !Number.isFinite(xValue) ||
        !Number.isFinite(yValue) ||
        !Number.isFinite(wValue) ||
        !Number.isFinite(hValue) ||
        wValue <= 0 ||
        hValue <= 0
      ) {
        return null;
      }

      const explicitCoordSpace = normalizeCoordSpace(
        dish?.coordSpace ||
          dish?.coord_space ||
          dish?.space ||
          dish?.units ||
          dish?.unit,
      );
      const values = [xValue, yValue, wValue, hValue];
      const minValue = Math.min(...values);
      const maxAbsValue = Math.max(...values.map((value) => Math.abs(value)));
      const nonNegative = minValue >= 0;

      const looksRatio = nonNegative && maxAbsValue <= 1.2;
      const fitsPercent =
        nonNegative &&
        xValue <= 100.5 &&
        yValue <= 100.5 &&
        wValue <= 100.5 &&
        hValue <= 100.5 &&
        xValue + wValue <= 100.5 &&
        yValue + hValue <= 100.5;
      const looksThousand =
        nonNegative &&
        maxAbsValue > 100 &&
        maxAbsValue <= 1200 &&
        xValue + wValue <= 1200 &&
        yValue + hValue <= 1200;

      const imageWidth = Number(imageDimensions?.width);
      const imageHeight = Number(imageDimensions?.height);
      const hasImageDimensions =
        Number.isFinite(imageWidth) &&
        Number.isFinite(imageHeight) &&
        imageWidth > 0 &&
        imageHeight > 0;
      const matchesPixelScale =
        hasImageDimensions &&
        nonNegative &&
        (maxAbsValue > 100 || xValue + wValue > 100.5 || yValue + hValue > 100.5) &&
        xValue <= imageWidth * 1.1 &&
        wValue <= imageWidth * 1.1 &&
        yValue <= imageHeight * 1.1 &&
        hValue <= imageHeight * 1.1 &&
        xValue + wValue <= imageWidth * 1.1 &&
        yValue + hValue <= imageHeight * 1.1;

      let mode = explicitCoordSpace;
      if (!mode) {
        if (looksRatio) {
          mode = "ratio";
        } else if (fitsPercent) {
          mode = "percent";
        } else if (matchesPixelScale) {
          mode = "pixels";
        } else if (looksThousand) {
          mode = "thousand";
        }
      }

      let x = xValue;
      let y = yValue;
      let w = wValue;
      let h = hValue;

      if (mode === "ratio") {
        x *= 100;
        y *= 100;
        w *= 100;
        h *= 100;
      } else if (mode === "pixels") {
        if (!hasImageDimensions) return null;
        x = (xValue / imageWidth) * 100;
        y = (yValue / imageHeight) * 100;
        w = (wValue / imageWidth) * 100;
        h = (hValue / imageHeight) * 100;
      } else if (mode === "thousand") {
        x = xValue / 10;
        y = yValue / 10;
        w = wValue / 10;
        h = hValue / 10;
      } else if (mode !== "percent") {
        return null;
      }

      x = clamp(x, 0, 100);
      y = clamp(y, 0, 100);
      w = clamp(w, 0.5, 100);
      h = clamp(h, 0.5, 100);

      if (x > 99.5) x = 99.5;
      if (y > 99.5) y = 99.5;

      w = clamp(w, 0.5, 100 - x);
      h = clamp(h, 0.5, 100 - y);

      return {
        name,
        x,
        y,
        w,
        h,
        _mode: mode || "unknown",
      };
    };

    const resolveRemapRectToThousand = (dish, imageDimensions) => {
      const name = asText(dish?.name || dish?.dishName);
      if (!name) return null;

      const xValue = Number(dish?.x);
      const yValue = Number(dish?.y);
      const wValue = Number(dish?.w);
      const hValue = Number(dish?.h);
      if (
        !Number.isFinite(xValue) ||
        !Number.isFinite(yValue) ||
        !Number.isFinite(wValue) ||
        !Number.isFinite(hValue) ||
        wValue <= 0 ||
        hValue <= 0
      ) {
        return null;
      }

      const explicitCoordSpace = normalizeCoordSpace(
        dish?.coordSpace ||
          dish?.coord_space ||
          dish?.space ||
          dish?.units ||
          dish?.unit,
      );
      const values = [xValue, yValue, wValue, hValue];
      const minValue = Math.min(...values);
      const maxAbsValue = Math.max(...values.map((value) => Math.abs(value)));
      const nonNegative = minValue >= 0;
      const looksRatio = nonNegative && maxAbsValue <= 1.2;
      const fitsPercent =
        nonNegative &&
        xValue <= 100.5 &&
        yValue <= 100.5 &&
        wValue <= 100.5 &&
        hValue <= 100.5 &&
        xValue + wValue <= 100.5 &&
        yValue + hValue <= 100.5;
      const looksThousand =
        nonNegative &&
        maxAbsValue <= 1200 &&
        xValue + wValue <= 1200 &&
        yValue + hValue <= 1200;

      const imageWidth = Number(imageDimensions?.width);
      const imageHeight = Number(imageDimensions?.height);
      const hasImageDimensions =
        Number.isFinite(imageWidth) &&
        Number.isFinite(imageHeight) &&
        imageWidth > 0 &&
        imageHeight > 0;
      const matchesPixelScale =
        hasImageDimensions &&
        nonNegative &&
        xValue <= imageWidth * 1.1 &&
        wValue <= imageWidth * 1.1 &&
        yValue <= imageHeight * 1.1 &&
        hValue <= imageHeight * 1.1 &&
        xValue + wValue <= imageWidth * 1.1 &&
        yValue + hValue <= imageHeight * 1.1;

      let mode = explicitCoordSpace;
      if (!mode) {
        if (looksRatio) {
          mode = "ratio";
        } else if (fitsPercent) {
          mode = "percent";
        } else if (matchesPixelScale) {
          mode = "pixels";
        } else if (looksThousand) {
          mode = "thousand";
        }
      }

      let x = xValue;
      let y = yValue;
      let w = wValue;
      let h = hValue;

      if (mode === "ratio") {
        x *= 1000;
        y *= 1000;
        w *= 1000;
        h *= 1000;
      } else if (mode === "percent") {
        x *= 10;
        y *= 10;
        w *= 10;
        h *= 10;
      } else if (mode === "pixels") {
        if (!hasImageDimensions) return null;
        x = (x / imageWidth) * 1000;
        y = (y / imageHeight) * 1000;
        w = (w / imageWidth) * 1000;
        h = (h / imageHeight) * 1000;
      } else if (mode !== "thousand") {
        return null;
      }

      x = clamp(x, 0, 1000);
      y = clamp(y, 0, 1000);
      if (x > 999) x = 999;
      if (y > 999) y = 999;
      w = clamp(w, 1, 1000 - x);
      h = clamp(h, 1, 1000 - y);

      return {
        name,
        x,
        y,
        w,
        h,
        _mode: mode || "unknown",
      };
    };

    const normalizeRemappedRect = (dish, metrics, imageDimensions) => {
      const normalized = resolveRemapRectToThousand(dish, imageDimensions);
      if (!normalized) return null;

      const xOffset = Number(metrics?.x);
      const yOffset = Number(metrics?.y);
      const width = Number(metrics?.w);
      const height = Number(metrics?.h);
      if (
        !Number.isFinite(xOffset) ||
        !Number.isFinite(yOffset) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        return null;
      }

      let x = ((normalized.x - xOffset) / width) * 100;
      let y = ((normalized.y - yOffset) / height) * 100;
      let w = (normalized.w / width) * 100;
      let h = (normalized.h / height) * 100;

      x = clamp(x, 0, 100);
      y = clamp(y, 0, 100);
      w = clamp(w, 0.5, 100);
      h = clamp(h, 0.5, 100);
      if (x > 99.5) x = 99.5;
      if (y > 99.5) y = 99.5;
      w = clamp(w, 0.5, 100 - x);
      h = clamp(h, 0.5, 100 - y);

      return {
        name: normalized.name,
        x,
        y,
        w,
        h,
        _mode: normalized._mode || "unknown",
      };
    };

    const toLegacyOverlayHint = (overlay, metrics) => {
      const name = asText(overlay?.id || overlay?.name);
      if (!name) return null;

      const xValue = Number(overlay?.x);
      const yValue = Number(overlay?.y);
      const wValue = Number(overlay?.w);
      const hValue = Number(overlay?.h);
      if (
        !Number.isFinite(xValue) ||
        !Number.isFinite(yValue) ||
        !Number.isFinite(wValue) ||
        !Number.isFinite(hValue) ||
        wValue <= 0 ||
        hValue <= 0
      ) {
        return null;
      }

      const x = clamp(xValue, 0, 100);
      const y = clamp(yValue, 0, 100);
      const w = clamp(wValue, 0.1, 100);
      const h = clamp(hValue, 0.1, 100);
      const metricsX = Number(metrics?.x);
      const metricsY = Number(metrics?.y);
      const metricsW = Number(metrics?.w);
      const metricsH = Number(metrics?.h);
      if (
        !Number.isFinite(metricsX) ||
        !Number.isFinite(metricsY) ||
        !Number.isFinite(metricsW) ||
        !Number.isFinite(metricsH) ||
        metricsW <= 0 ||
        metricsH <= 0
      ) {
        return null;
      }

      return {
        name,
        x: (x / 100) * metricsW + metricsX,
        y: (y / 100) * metricsH + metricsY,
        w: (w / 100) * metricsW,
        h: (h / 100) * metricsH,
        coordSpace: "thousand",
      };
    };

    const normalizeDetectedDishes = (rawDishes, imageDimensions) => {
      const seenDishTokens = new Set();
      return (Array.isArray(rawDishes) ? rawDishes : [])
        .map((dish) => normalizeDetectedRect(dish, imageDimensions))
        .filter(Boolean)
        .filter((dish) => {
          const token = normalizeToken(dish.name);
          if (!token || seenDishTokens.has(token)) return false;
          seenDishTokens.add(token);
          return true;
        });
    };

    const scoreRemapDishQuality = (dishes) => {
      const normalized = Array.isArray(dishes) ? dishes.filter(Boolean) : [];
      const dishCount = normalized.length;
      if (!dishCount) {
        return {
          dishCount: 0,
          suspiciousCount: 0,
          suspiciousRatio: 0,
          isLowQuality: false,
        };
      }

      let suspiciousCount = 0;
      normalized.forEach((dish) => {
        const x = Number(dish?.x);
        const y = Number(dish?.y);
        const w = Number(dish?.w);
        const h = Number(dish?.h);
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          !Number.isFinite(w) ||
          !Number.isFinite(h)
        ) {
          suspiciousCount += 1;
          return;
        }

        const edgeClamped = x <= 0.5 || y <= 0.5 || x + w >= 99.5 || y + h >= 99.5;
        const area = w * h;
        const degenerate = w <= 1.2 || h <= 1.2 || area <= 1.5;
        const oversized = area >= 65;
        if (edgeClamped || degenerate || oversized) {
          suspiciousCount += 1;
        }
      });

      const suspiciousRatio = suspiciousCount / dishCount;
      return {
        dishCount,
        suspiciousCount,
        suspiciousRatio,
        isLowQuality: dishCount >= 4 && suspiciousRatio >= 0.45,
      };
    };

    for (const pageIndex of targetPages) {
      const imageSource = asText(menuImagesRef.current[pageIndex]);
      if (!imageSource) {
        const message = "No menu image available.";
        errors.push(`Page ${pageIndex + 1}: ${message}`);
        pageResults.push({
          pageIndex,
          success: false,
          rawDishCount: 0,
          validDishCount: 0,
          removedUnmatched: removeUnmatchedPages.has(pageIndex),
          requiredDetections: requiredDetectionPages.has(pageIndex),
          error: message,
        });
        continue;
      }

      if (useRemapMode) {
        // eslint-disable-next-line no-await-in-loop
        const newNormalized = await normalizeImageToLetterboxedSquare(imageSource, 1000);
        if (!newNormalized?.dataUrl || !newNormalized?.metrics) {
          const message = "Failed to prepare new menu image for remap analysis.";
          errors.push(`Page ${pageIndex + 1}: ${message}`);
          pageResults.push({
            pageIndex,
            success: false,
            rawDishCount: 0,
            validDishCount: 0,
            removedUnmatched: removeUnmatchedPages.has(pageIndex),
            requiredDetections: requiredDetectionPages.has(pageIndex),
            error: message,
          });
          continue;
        }

        const sourceIndexRaw = Number(sourceIndexMap[pageIndex]);
        const sourceIndex = Number.isFinite(sourceIndexRaw) &&
          sourceIndexRaw >= 0 &&
          sourceIndexRaw < baselineImageList.length
          ? Math.floor(sourceIndexRaw)
          : null;

        let oldNormalized = null;
        if (sourceIndex !== null) {
          const oldImageSource = asText(baselineImageList[sourceIndex]);
          if (oldImageSource) {
            // eslint-disable-next-line no-await-in-loop
            oldNormalized = await normalizeImageToLetterboxedSquare(oldImageSource, 1000);
            if (!oldNormalized?.dataUrl || !oldNormalized?.metrics) {
              // Legacy reposition flow can run from the new image alone.
              // If old-image normalization fails (for example due to CORS), keep going.
              oldNormalized = null;
              if (process.env.NODE_ENV !== "production") {
                console.warn("[restaurant-editor] remap old-image normalization failed; continuing without old-image hints", {
                  pageIndex: pageIndex + 1,
                  sourceIndex,
                });
              }
            }
          }
        }

        const sourcePageOverlays = sourceIndex === null
          ? []
          : baselineOverlayList.filter((overlay) => {
              const page = firstFiniteNumber(
                overlay?.pageIndex,
                overlay?.page,
                overlay?.pageNumber,
                overlay?.page_number,
              );
              return (Number.isFinite(page) ? Math.floor(page) : 0) === sourceIndex;
            });
        const transformedOverlays = oldNormalized?.metrics
          ? sourcePageOverlays
              .map((overlay) => toLegacyOverlayHint(overlay, oldNormalized.metrics))
              .filter(Boolean)
          : [];

        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await callbacks.onAnalyzeMenuImage({
            mode: "remap",
            oldImageData: oldNormalized?.dataUrl || "",
            newImageData: newNormalized.dataUrl,
            overlays: transformedOverlays,
            imageWidth: 1000,
            imageHeight: 1000,
            pageIndex,
          });

          if (!result?.success) {
            const rawDishCount = Number.isFinite(Number(result?.rawDishCount))
              ? Number(result.rawDishCount)
              : Array.isArray(result?.updatedOverlays) || Array.isArray(result?.newOverlays)
                ? (Array.isArray(result?.updatedOverlays) ? result.updatedOverlays.length : 0) +
                  (Array.isArray(result?.newOverlays) ? result.newOverlays.length : 0)
                : 0;
            const message = asText(result?.error) || "Menu remap analysis failed.";
            errors.push(`Page ${pageIndex + 1}: ${message}`);
            pageResults.push({
              pageIndex,
              success: false,
              rawDishCount,
              validDishCount: 0,
              removedUnmatched: removeUnmatchedPages.has(pageIndex),
              requiredDetections: requiredDetectionPages.has(pageIndex),
              error: message,
            });
            continue;
          }

          const rawUpdated = Array.isArray(result?.updatedOverlays)
            ? result.updatedOverlays
            : [];
          let rawNew = Array.isArray(result?.newOverlays)
            ? result.newOverlays
            : [];
          if (!rawUpdated.length && !rawNew.length && Array.isArray(result?.dishes)) {
            rawNew = result.dishes;
          }

          const seenUpdated = new Set();
          const updatedDishes = rawUpdated
            .map((dish) =>
              normalizeRemappedRect(
                dish,
                newNormalized.metrics,
                { width: newNormalized.imageWidth, height: newNormalized.imageHeight },
              ),
            )
            .filter(Boolean)
            .filter((dish) => {
              const token = normalizeToken(dish?.name);
              if (!token || seenUpdated.has(token)) return false;
              seenUpdated.add(token);
              return true;
            });

          const seenNew = new Set();
          const updatedTokens = new Set(updatedDishes.map((dish) => normalizeToken(dish?.name)));
          const newDishes = rawNew
            .map((dish) =>
              normalizeRemappedRect(
                dish,
                newNormalized.metrics,
                { width: newNormalized.imageWidth, height: newNormalized.imageHeight },
              ),
            )
            .filter(Boolean)
            .filter((dish) => {
              const token = normalizeToken(dish?.name);
              if (!token || updatedTokens.has(token) || seenNew.has(token)) return false;
              seenNew.add(token);
              return true;
            });

          const rawDishCount = Number.isFinite(Number(result?.rawDishCount))
            ? Number(result.rawDishCount)
            : rawUpdated.length + rawNew.length;
          const validDishCount = updatedDishes.length + newDishes.length;
          const remapQuality = scoreRemapDishQuality([...updatedDishes, ...newDishes]);
          const diagnostics = result?.diagnostics && typeof result.diagnostics === "object"
            ? result.diagnostics
            : null;

          if (process.env.NODE_ENV !== "production") {
            const modeCounts = [...updatedDishes, ...newDishes].reduce((accumulator, dish) => {
              const key = asText(dish?._mode) || "unknown";
              accumulator[key] = (accumulator[key] || 0) + 1;
              return accumulator;
            }, {});
            console.debug("[restaurant-editor] menu remap normalization", {
              pageIndex: pageIndex + 1,
              sourceIndex,
              rawDishCount,
              validDishCount,
              updatedCount: updatedDishes.length,
              newCount: newDishes.length,
              modeCounts,
              anchorMatchCount: Number(diagnostics?.anchorMatchCount || 0),
              anchorMissCount: Number(diagnostics?.anchorMissCount || 0),
              corridorClamps: Number(diagnostics?.corridorClamps || 0),
              conservativeFallbackCount: Number(diagnostics?.conservativeFallbackCount || 0),
              rowWidePreventionApplied: Number(diagnostics?.rowWidePreventionApplied || 0),
              remapQuality,
            });
          }

          if (remapQuality.isLowQuality) {
            // Low-confidence remap boxes are replaced by a fresh detect pass on the new page.
            // eslint-disable-next-line no-await-in-loop
            const fallbackResult = await callbacks.onAnalyzeMenuImage({
              mode: "detect",
              imageData: newNormalized.dataUrl,
              imageWidth: 1000,
              imageHeight: 1000,
              pageIndex,
            });

            if (!fallbackResult?.success) {
              const message =
                asText(fallbackResult?.error) ||
                "Low-quality remap fallback detection failed.";
              errors.push(`Page ${pageIndex + 1}: ${message}`);
              pageResults.push({
                pageIndex,
                success: false,
                rawDishCount,
                validDishCount,
                removedUnmatched: removeUnmatchedPages.has(pageIndex),
                requiredDetections: requiredDetectionPages.has(pageIndex),
                analysisMode: "detect-fallback",
                fallbackUsed: true,
                error: message,
              });
              continue;
            }

            const fallbackRawDishCount = Number.isFinite(Number(fallbackResult?.rawDishCount))
              ? Number(fallbackResult.rawDishCount)
              : Array.isArray(fallbackResult?.dishes)
                ? fallbackResult.dishes.length
                : 0;
            const fallbackSeenTokens = new Set();
            const fallbackDishes = (Array.isArray(fallbackResult?.dishes) ? fallbackResult.dishes : [])
              .map((dish) =>
                normalizeRemappedRect(
                  dish,
                  newNormalized.metrics,
                  { width: newNormalized.imageWidth, height: newNormalized.imageHeight },
                ),
              )
              .filter(Boolean)
              .filter((dish) => {
                const token = normalizeToken(dish?.name);
                if (!token || fallbackSeenTokens.has(token)) return false;
                fallbackSeenTokens.add(token);
                return true;
              });
            const fallbackValidDishCount = fallbackDishes.length;

            if (requiredDetectionPages.has(pageIndex) && fallbackValidDishCount === 0) {
              const pageError =
                `Page ${pageIndex + 1}: Low-quality remap fallback detected no valid dish overlays. Try a clearer image or retry analysis.`;
              errors.push(pageError);
              pageResults.push({
                pageIndex,
                success: false,
                rawDishCount: fallbackRawDishCount,
                validDishCount: fallbackValidDishCount,
                removedUnmatched: removeUnmatchedPages.has(pageIndex),
                requiredDetections: true,
                analysisMode: "detect-fallback",
                fallbackUsed: true,
                error: pageError,
              });
              continue;
            }

            const fallbackDetectedTokens = new Set(
              fallbackDishes.map((dish) => normalizeToken(dish?.name)).filter(Boolean),
            );
            pageDetections.push({
              pageIndex,
              mode: "detect",
              dishes: fallbackDishes,
              detectedTokens: fallbackDetectedTokens,
            });
            pageResults.push({
              pageIndex,
              success: true,
              rawDishCount: fallbackRawDishCount,
              validDishCount: fallbackValidDishCount,
              removedUnmatched: removeUnmatchedPages.has(pageIndex),
              requiredDetections: requiredDetectionPages.has(pageIndex),
              analysisMode: "detect-fallback",
              fallbackUsed: true,
              error: "",
            });
            continue;
          }

          if (requiredDetectionPages.has(pageIndex) && validDishCount === 0) {
            const pageError =
              `Page ${pageIndex + 1}: No valid dish overlays detected. Try a clearer image or retry analysis.`;
            errors.push(pageError);
            pageResults.push({
              pageIndex,
              success: false,
              rawDishCount,
              validDishCount,
              removedUnmatched: removeUnmatchedPages.has(pageIndex),
              requiredDetections: true,
              analysisMode: "remap",
              fallbackUsed: false,
              error: pageError,
            });
            continue;
          }

          const detectedTokens = new Set(
            [...updatedDishes, ...newDishes]
              .map((dish) => normalizeToken(dish?.name))
              .filter(Boolean),
          );
          pageDetections.push({
            pageIndex,
            mode: "remap",
            updatedDishes,
            newDishes,
            replacePageOverlays: updatedDishes.length === 0 && newDishes.length > 0,
            detectedTokens,
          });
          pageResults.push({
            pageIndex,
            success: true,
            rawDishCount,
            validDishCount,
            removedUnmatched: removeUnmatchedPages.has(pageIndex),
            requiredDetections: requiredDetectionPages.has(pageIndex),
            analysisMode: "remap",
            fallbackUsed: false,
            error: "",
          });
          continue;
        } catch (error) {
          const message = asText(error?.message) || "Menu remap analysis failed.";
          errors.push(`Page ${pageIndex + 1}: ${message}`);
          pageResults.push({
            pageIndex,
            success: false,
            rawDishCount: 0,
            validDishCount: 0,
            removedUnmatched: removeUnmatchedPages.has(pageIndex),
            requiredDetections: requiredDetectionPages.has(pageIndex),
            error: message,
          });
          continue;
        }
      }

      // eslint-disable-next-line no-await-in-loop
      const imageData = await toDataUrlFromImage(imageSource);
      if (!imageData) {
        const message = "Failed to prepare image for analysis.";
        errors.push(`Page ${pageIndex + 1}: ${message}`);
        pageResults.push({
          pageIndex,
          success: false,
          rawDishCount: 0,
          validDishCount: 0,
          removedUnmatched: removeUnmatchedPages.has(pageIndex),
          requiredDetections: requiredDetectionPages.has(pageIndex),
          error: message,
        });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const imageDimensions = await readImageDimensions(imageData);

      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await callbacks.onAnalyzeMenuImage({
          imageData,
          imageWidth: Number(imageDimensions?.width) || undefined,
          imageHeight: Number(imageDimensions?.height) || undefined,
          pageIndex,
        });
        if (!result?.success) {
          const rawDishCount = Number.isFinite(Number(result?.rawDishCount))
            ? Number(result.rawDishCount)
            : Array.isArray(result?.dishes)
              ? result.dishes.length
              : 0;
          errors.push(
            `Page ${pageIndex + 1}: ${asText(result?.error) || "Menu image analysis failed."}`,
          );
          pageResults.push({
            pageIndex,
            success: false,
            rawDishCount,
            validDishCount: 0,
            removedUnmatched: removeUnmatchedPages.has(pageIndex),
            requiredDetections: requiredDetectionPages.has(pageIndex),
            error: asText(result?.error) || "Menu image analysis failed.",
          });
          continue;
        }

        const rawDishCount = Number.isFinite(Number(result?.rawDishCount))
          ? Number(result.rawDishCount)
          : Array.isArray(result?.dishes)
            ? result.dishes.length
            : 0;
        const dishes = normalizeDetectedDishes(result?.dishes, imageDimensions);
        const validDishCount = dishes.length;

        if (process.env.NODE_ENV !== "production") {
          const modeCounts = dishes.reduce((accumulator, dish) => {
            const key = asText(dish?._mode) || "unknown";
            accumulator[key] = (accumulator[key] || 0) + 1;
            return accumulator;
          }, {});
          console.debug("[restaurant-editor] menu analysis normalization", {
            pageIndex: pageIndex + 1,
            rawDishCount,
            validDishCount,
            modeCounts,
          });
        }

        if (requiredDetectionPages.has(pageIndex) && validDishCount === 0) {
          const pageError =
            `Page ${pageIndex + 1}: No valid dish overlays detected. Try a clearer image or retry analysis.`;
          errors.push(pageError);
          pageResults.push({
            pageIndex,
            success: false,
            rawDishCount,
            validDishCount,
            removedUnmatched: removeUnmatchedPages.has(pageIndex),
            requiredDetections: true,
            analysisMode: "detect",
            fallbackUsed: false,
            error: pageError,
          });
          continue;
        }

        pageDetections.push({
          pageIndex,
          mode: "detect",
          dishes,
          detectedTokens: new Set(dishes.map((dish) => normalizeToken(dish?.name))),
        });
        pageResults.push({
          pageIndex,
          success: true,
          rawDishCount,
          validDishCount,
          removedUnmatched: removeUnmatchedPages.has(pageIndex),
          requiredDetections: requiredDetectionPages.has(pageIndex),
          analysisMode: "detect",
          fallbackUsed: false,
          error: "",
        });
      } catch (error) {
        const message = asText(error?.message) || "Menu image analysis failed.";
        errors.push(`Page ${pageIndex + 1}: ${message}`);
        pageResults.push({
          pageIndex,
          success: false,
          rawDishCount: 0,
          validDishCount: 0,
          removedUnmatched: removeUnmatchedPages.has(pageIndex),
          requiredDetections: requiredDetectionPages.has(pageIndex),
          error: message,
        });
      }
    }

    if (errors.length) {
      return {
        success: false,
        updatedCount: 0,
        addedCount: 0,
        removedCount: 0,
        errors,
        pageResults,
      };
    }

    let updatedCount = 0;
    let addedCount = 0;
    let removedCount = 0;

    applyOverlayList((current) => {
      const next = [...current];

      pageDetections.forEach((detection) => {
        const pageIndex = Number(detection?.pageIndex) || 0;

        if (detection?.mode === "remap") {
          const detectedTokens = detection?.detectedTokens instanceof Set
            ? detection.detectedTokens
            : new Set();

          if (detection?.replacePageOverlays) {
            for (let index = next.length - 1; index >= 0; index -= 1) {
              const overlay = next[index];
              const page = Number.isFinite(Number(overlay?.pageIndex))
                ? Number(overlay.pageIndex)
                : 0;
              if (page !== pageIndex) continue;
              next.splice(index, 1);
              removedCount += 1;
            }
          }

          const usedMatchIndexes = new Set();
          const mergeDish = (dish) => {
            const token = normalizeToken(dish?.name);
            if (!token) return;
            const dishMatchKey = normalizeLegacyMatchKey(dish?.name);

            const matchedIndex = next.findIndex((overlay, index) => {
              if (usedMatchIndexes.has(index)) return false;
              const page = Number.isFinite(Number(overlay?.pageIndex))
                ? Number(overlay.pageIndex)
                : 0;
              if (page !== pageIndex) return false;
              const overlayMatchKey = normalizeLegacyMatchKey(overlay?.id || overlay?.name);
              if (dishMatchKey && overlayMatchKey && overlayMatchKey === dishMatchKey) {
                return true;
              }
              const overlayToken = normalizeToken(overlay?.id || overlay?.name);
              return overlayToken === token;
            });

            if (matchedIndex >= 0) {
              usedMatchIndexes.add(matchedIndex);
              const existing = next[matchedIndex];
              next[matchedIndex] = ensureOverlayVisibility(
                {
                  ...existing,
                  id: asText(existing?.id) || dish.name,
                  name: asText(existing?.name) || dish.name,
                  x: dish.x,
                  y: dish.y,
                  w: dish.w,
                  h: dish.h,
                  pageIndex,
                },
                pageCount,
              );
              updatedCount += 1;
              return;
            }

            const nextOverlayKey = `ov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const nextOverlay = ensureOverlayVisibility(
              normalizeOverlay(
                {
                  _editorKey: nextOverlayKey,
                  id: dish.name,
                  name: dish.name,
                  description: "",
                  x: dish.x,
                  y: dish.y,
                  w: dish.w,
                  h: dish.h,
                  pageIndex,
                  allergens: [],
                  diets: [],
                  removable: [],
                  crossContaminationAllergens: [],
                  crossContaminationDiets: [],
                  details: {},
                  ingredients: [],
                },
                next.length,
                nextOverlayKey,
              ),
              pageCount,
            );
            next.push(nextOverlay);
            addedCount += 1;
          };

          (Array.isArray(detection.updatedDishes) ? detection.updatedDishes : []).forEach(mergeDish);
          (Array.isArray(detection.newDishes) ? detection.newDishes : []).forEach(mergeDish);

          if (removeUnmatchedPages.has(pageIndex)) {
            for (let index = next.length - 1; index >= 0; index -= 1) {
              const overlay = next[index];
              const page = Number.isFinite(Number(overlay?.pageIndex))
                ? Number(overlay.pageIndex)
                : 0;
              if (page !== pageIndex) continue;
              const token = normalizeToken(overlay?.id || overlay?.name);
              if (!token || !detectedTokens.has(token)) {
                next.splice(index, 1);
                removedCount += 1;
              }
            }
          }

          return;
        }

        const dishes = Array.isArray(detection?.dishes) ? detection.dishes : [];
        const detectedTokens = detection?.detectedTokens instanceof Set
          ? detection.detectedTokens
          : new Set();

        if (removeUnmatchedPages.has(pageIndex)) {
          for (let index = next.length - 1; index >= 0; index -= 1) {
            const overlay = next[index];
            const page = Number.isFinite(Number(overlay?.pageIndex))
              ? Number(overlay.pageIndex)
              : 0;
            if (page !== pageIndex) continue;
            const token = normalizeToken(overlay?.id || overlay?.name);
            if (!token || !detectedTokens.has(token)) {
              next.splice(index, 1);
              removedCount += 1;
            }
          }
        }

        if (!dishes.length) return;
        const usedMatchIndexes = new Set();

        dishes.forEach((dish) => {
          const dishToken = normalizeToken(dish.name);
          if (!dishToken) return;

          const matchedIndex = next.findIndex((overlay, index) => {
            if (usedMatchIndexes.has(index)) return false;
            const page = Number.isFinite(Number(overlay.pageIndex))
              ? Number(overlay.pageIndex)
              : 0;
            if (page !== pageIndex) return false;
            const overlayToken = normalizeToken(overlay?.id || overlay?.name);
            return overlayToken === dishToken;
          });

          if (matchedIndex >= 0) {
            usedMatchIndexes.add(matchedIndex);
            const existing = next[matchedIndex];
            next[matchedIndex] = ensureOverlayVisibility(
              {
                ...existing,
                id: asText(existing?.id) || dish.name,
                name: asText(existing?.name) || dish.name,
                x: dish.x,
                y: dish.y,
                w: dish.w,
                h: dish.h,
                pageIndex,
              },
              pageCount,
            );
            updatedCount += 1;
            return;
          }

          const nextOverlayKey = `ov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const nextOverlay = ensureOverlayVisibility(
            normalizeOverlay(
              {
                _editorKey: nextOverlayKey,
                id: dish.name,
                name: dish.name,
                description: "",
                x: dish.x,
                y: dish.y,
                w: dish.w,
                h: dish.h,
                pageIndex,
                allergens: [],
                diets: [],
                removable: [],
                crossContaminationAllergens: [],
                crossContaminationDiets: [],
                details: {},
                ingredients: [],
              },
              next.length,
              nextOverlayKey,
            ),
            pageCount,
          );

          next.push(nextOverlay);
          addedCount += 1;
        });
      });

      return next;
    });

    if (updatedCount || addedCount) {
      appendPendingChange(
        `Menu analysis: Updated ${updatedCount} overlay${updatedCount === 1 ? "" : "s"}, added ${addedCount} overlay${addedCount === 1 ? "" : "s"}, removed ${removedCount} overlay${removedCount === 1 ? "" : "s"}.`,
      );
    } else if (removedCount) {
      appendPendingChange(
        `Menu analysis: Removed ${removedCount} unmatched overlay${removedCount === 1 ? "" : "s"}.`,
      );
    } else {
      appendPendingChange("Menu analysis: No dishes detected on selected pages.");
    }

    queueMicrotask(() => pushHistory());

    return {
      success: true,
      updatedCount,
      addedCount,
      removedCount,
      errors: [],
      pageResults,
    };
  }, [appendPendingChange, applyOverlayList, callbacks, pushHistory]);

  const jumpToPage = useCallback((index) => {
    setActivePageIndex((current) =>
      clamp(Number(index) || current, 0, Math.max(menuImagesRef.current.length - 1, 0)),
    );
  }, []);

  const zoomIn = useCallback(() => {
    setZoomScale((current) => clamp(Number((current + 0.25).toFixed(2)), 0.5, 3));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomScale((current) => clamp(Number((current - 0.25).toFixed(2)), 0.5, 3));
  }, []);

  const zoomReset = useCallback(() => {
    setZoomScale(1);
  }, []);

  const loadChangeLogs = useCallback(async () => {
    const onLoadChangeLogs = callbacks?.onLoadChangeLogs;
    if (!onLoadChangeLogs || !restaurant?.id) return;
    setLoadingChangeLogs(true);
    setChangeLogError("");

    try {
      const logs = await onLoadChangeLogs(restaurant.id);
      setChangeLogs(Array.isArray(logs) ? logs : []);
    } catch (error) {
      setChangeLogError(error?.message || "Failed to load change log.");
    } finally {
      setLoadingChangeLogs(false);
    }
  }, [callbacks?.onLoadChangeLogs, restaurant?.id]);

  const loadPendingTable = useCallback(async () => {
    const onLoadPendingSaveTable = callbacks?.onLoadPendingSaveTable;
    if (!onLoadPendingSaveTable || !restaurant?.id) return;
    if (pendingTableLoadPromiseRef.current) {
      return pendingTableLoadPromiseRef.current;
    }

    setLoadingPendingTable(true);
    setPendingTableError("");

    const request = (async () => {
      try {
        const result = await onLoadPendingSaveTable(restaurant.id);
        setPendingTableBatch(
          result?.batch && typeof result.batch === "object" ? result.batch : null,
        );
        setPendingTableRows(Array.isArray(result?.rows) ? result.rows : []);
      } catch (error) {
        setPendingTableError(error?.message || "Failed to load pending table.");
        setPendingTableBatch(null);
        setPendingTableRows([]);
      } finally {
        setLoadingPendingTable(false);
        pendingTableLoadPromiseRef.current = null;
      }
    })();

    pendingTableLoadPromiseRef.current = request;
    return request;
  }, [callbacks?.onLoadPendingSaveTable, restaurant?.id]);

  useEffect(() => {
    if (!changeLogOpen) {
      changeLogLoadedForOpenRef.current = false;
      return;
    }
    if (changeLogLoadedForOpenRef.current) return;
    changeLogLoadedForOpenRef.current = true;
    loadChangeLogs();
  }, [changeLogOpen, loadChangeLogs]);

  useEffect(() => {
    if (!pendingTableOpen) {
      pendingTableLoadedForOpenRef.current = false;
      return;
    }
    if (pendingTableLoadedForOpenRef.current) return;
    pendingTableLoadedForOpenRef.current = true;
    loadPendingTable();
  }, [loadPendingTable, pendingTableOpen]);

  const restoreFromChangeLog = useCallback((log) => {
    const parsed = parseChangeLogPayload(log);
    const snapshot =
      parsed?.snapshot ||
      parsed?.__editorSnapshot ||
      (parsed?.meta && typeof parsed.meta === "object" ? parsed.meta.snapshot : null);

    const nextSnapshot = snapshot && typeof snapshot === "object"
      ? {
          overlays: Array.isArray(snapshot.overlays) ? snapshot.overlays : [],
          menuImages: Array.isArray(snapshot.menuImages)
            ? snapshot.menuImages
            : Array.isArray(snapshot.menu_images)
              ? snapshot.menu_images
              : [],
          pendingChanges: ["Restored overlays from previous version"],
        }
      : null;

    if (!nextSnapshot) return { success: false };

    restoreHistorySnapshot(nextSnapshot);
    appendPendingChange("Restored overlays from previous version");
    queueMicrotask(() => pushHistory());
    return { success: true };
  }, [appendPendingChange, pushHistory, restoreHistorySnapshot]);

  const save = useCallback(async () => {
    if (!canEdit || !restaurant?.id) {
      setSaveError("You do not have permission to edit this restaurant.");
      setSaveStatus("error");
      return { success: false };
    }

    if (!callbacks?.onApplyPendingSave) {
      setSaveError("Write gateway save callback is not configured.");
      setSaveStatus("error");
      return { success: false };
    }

    clearSaveStatusTimer();
    setSaveError("");
    setSaveStatus("saving");
    setIsSaving(true);

    try {
      const ingredientConfirmationIssues = buildIngredientConfirmationIssues(
        overlaysRef.current,
      );
      if (ingredientConfirmationIssues.length) {
        const firstIssue = ingredientConfirmationIssues[0];
        setSaveError(
          firstIssue?.message ||
            "Every ingredient row must be confirmed before saving.",
        );
        setSaveStatus("error");
        return { success: false };
      }

      const cleanedOverlays = (overlaysRef.current || []).map(stripEditorOverlay);
      const cleanedMenuImages = normalizeMenuImageList(menuImagesRef.current);
      const baselineSnapshot = parseSerializedEditorState(baselineRef.current);
      const baselineMenuImages = normalizeMenuImageList(baselineSnapshot?.menuImages);
      const menuImagesChanged =
        serializeMenuImageList(cleanedMenuImages) !==
        serializeMenuImageList(baselineMenuImages);
      const optimizedMenuImages = menuImagesChanged
        ? await optimizeMenuImagesForWrite(cleanedMenuImages)
        : cleanedMenuImages;
      const optimizedChanged =
        serializeMenuImageList(optimizedMenuImages) !==
        serializeMenuImageList(cleanedMenuImages);
      if (optimizedChanged) {
        menuImagesRef.current = optimizedMenuImages;
        setDraftMenuImages(optimizedMenuImages);
      }
      const menuImage = optimizedMenuImages[0] || "";

      const author =
        asText(callbacks?.getAuthorName?.()) || asText(callbacks?.authorName) || "Manager";

      const stateHash = serializeEditorState(cleanedOverlays, optimizedMenuImages);
      const changePayload = buildDefaultChangeLogPayload({
        author,
        pendingChanges: pendingChangesRef.current,
        snapshot: {
          mode: "server_generated",
          stateHash,
        },
      });

      if (!pendingSaveBatchId) {
        setSaveError("No pending save batch found. Review changes before confirming save.");
        setSaveStatus("error");
        return { success: false };
      }

      if (pendingSaveStateHash && pendingSaveStateHash !== stateHash) {
        setSaveError("Changes were edited after review. Please re-open save review.");
        setSaveStatus("error");
        return { success: false };
      }

      await callbacks.onApplyPendingSave({
        batchId: pendingSaveBatchId,
        overlays: cleanedOverlays,
        menuImages: menuImagesChanged ? optimizedMenuImages : [],
        menuImage: menuImagesChanged ? menuImage : "",
        menuImagesProvided: menuImagesChanged,
        changePayload,
        stateHash,
      });

      baselineRef.current = serializeEditorState(cleanedOverlays, optimizedMenuImages);
      setPendingChanges([]);
      clearPendingSaveBatch();

      const snapshotAfterSave = {
        overlays: JSON.parse(JSON.stringify(overlaysRef.current || [])),
        menuImages: JSON.parse(JSON.stringify(optimizedMenuImages || [])),
        pendingChanges: [],
      };

      historyRef.current = [snapshotAfterSave];
      setHistoryIndex(0);

      setSaveStatus("saved");
      saveStatusTimerRef.current = window.setTimeout(() => {
        saveStatusTimerRef.current = 0;
        setSaveStatus("idle");
      }, 900);

      return { success: true };
    } catch (error) {
      const message = error?.message || "Failed to save editor changes.";
      setSaveError(message);
      setSaveStatus("error");
      return { success: false, error };
    } finally {
      setIsSaving(false);
    }
  }, [
    callbacks,
    canEdit,
    clearPendingSaveBatch,
    clearSaveStatusTimer,
    pendingSaveBatchId,
    pendingSaveStateHash,
    restaurant?.id,
    setDraftMenuImages,
  ]);

  const preparePendingSave = useCallback(async () => {
    if (!canEdit || !restaurant?.id) {
      setPendingSaveError("You do not have permission to edit this restaurant.");
      return { success: false };
    }

    if (!callbacks?.onPreparePendingSave) {
      setPendingSaveError("Pending-save preparation callback is not configured.");
      return { success: false };
    }

    if (pendingSavePreparing) {
      return {
        success: Boolean(pendingSaveBatchId),
        batchId: pendingSaveBatchId,
        rows: Array.isArray(pendingSaveRows) ? pendingSaveRows : [],
      };
    }

    try {
      const cleanedOverlays = (overlaysRef.current || []).map(stripEditorOverlay);
      const cleanedMenuImages = normalizeMenuImageList(menuImagesRef.current);
      const baselineSnapshot = parseSerializedEditorState(baselineRef.current);
      const baselineOverlays = Array.isArray(baselineSnapshot?.overlays)
        ? baselineSnapshot.overlays
        : [];
      const overlayDelta = buildOverlayDeltaPayload({
        baselineOverlays,
        overlays: cleanedOverlays,
      });
      const baselineMenuImages = normalizeMenuImageList(baselineSnapshot?.menuImages);
      const menuImagesChanged =
        serializeMenuImageList(cleanedMenuImages) !==
        serializeMenuImageList(baselineMenuImages);
      const optimizedMenuImages = menuImagesChanged
        ? await optimizeMenuImagesForWrite(cleanedMenuImages)
        : cleanedMenuImages;
      const optimizedChanged =
        serializeMenuImageList(optimizedMenuImages) !==
        serializeMenuImageList(cleanedMenuImages);
      if (optimizedChanged) {
        menuImagesRef.current = optimizedMenuImages;
        setDraftMenuImages(optimizedMenuImages);
      }

      const author =
        asText(callbacks?.getAuthorName?.()) || asText(callbacks?.authorName) || "Manager";

      const changePayload = buildDefaultChangeLogPayload({
        author,
        pendingChanges: pendingChangesRef.current,
        snapshot: {
          mode: "server_generated",
        },
      });

      const stateHash = serializeEditorState(cleanedOverlays, optimizedMenuImages);
      const changedFields = [];
      if (overlayDelta.hasOverlayChanges) {
        changedFields.push("overlays");
      }
      if (menuImagesChanged) {
        changedFields.push("menuImages");
      }

      if (pendingSaveBatchId && pendingSaveStateHash === stateHash) {
        return {
          success: true,
          batchId: pendingSaveBatchId,
          rows: Array.isArray(pendingSaveRows) ? pendingSaveRows : [],
        };
      }

      setPendingSavePreparing(true);
      setPendingSaveError("");
      setSaveError("");

      const result = await callbacks.onPreparePendingSave({
        overlays: cleanedOverlays,
        baselineOverlays,
        overlayUpserts: overlayDelta.overlayUpserts,
        overlayDeletes: overlayDelta.overlayDeletes,
        overlayBaselines: overlayDelta.overlayBaselines,
        overlayOrder: overlayDelta.overlayOrder,
        overlayOrderProvided: overlayDelta.overlayOrderProvided,
        hasOverlayChanges: overlayDelta.hasOverlayChanges,
        changedFields,
        menuImage: menuImagesChanged ? optimizedMenuImages[0] || "" : "",
        menuImages: menuImagesChanged ? optimizedMenuImages : [],
        menuImagesProvided: menuImagesChanged,
        changePayload,
        stateHash,
      });

      const nextBatchId = asText(result?.batchId);
      if (!nextBatchId) {
        throw new Error("Failed to stage pending save batch.");
      }

      setPendingSaveBatchId(nextBatchId);
      setPendingSaveRows(Array.isArray(result?.rows) ? result.rows : []);
      setPendingSaveStateHash(asText(result?.stateHash) || stateHash);
      setPendingSaveError("");

      return {
        success: true,
        batchId: nextBatchId,
        rows: Array.isArray(result?.rows) ? result.rows : [],
      };
    } catch (error) {
      const message = error?.message || "Failed to prepare pending save.";
      setPendingSaveError(message);
      setSaveError(message);
      setSaveStatus("error");
      return { success: false, error };
    } finally {
      setPendingSavePreparing(false);
    }
  }, [
    callbacks,
    canEdit,
    pendingSaveBatchId,
    pendingSavePreparing,
    pendingSaveRows,
    pendingSaveStateHash,
    restaurant?.id,
    setDraftMenuImages,
  ]);

  useEffect(() => {
    if (!canEdit) return;
    if (!callbacks?.onPreparePendingSave) return;
    if (isSaving || pendingSavePreparing) return;

    const shouldSync = isDirty || Boolean(pendingSaveBatchId);
    if (!shouldSync) return;

    if (pendingSaveSyncTimerRef.current) {
      window.clearTimeout(pendingSaveSyncTimerRef.current);
      pendingSaveSyncTimerRef.current = 0;
    }

    pendingSaveSyncTimerRef.current = window.setTimeout(() => {
      pendingSaveSyncTimerRef.current = 0;
      preparePendingSave();
    }, 700);

    return () => {
      if (pendingSaveSyncTimerRef.current) {
        window.clearTimeout(pendingSaveSyncTimerRef.current);
        pendingSaveSyncTimerRef.current = 0;
      }
    };
  }, [
    callbacks?.onPreparePendingSave,
    canEdit,
    editorStateSerialized,
    isDirty,
    isSaving,
    pendingSaveBatchId,
    pendingSavePreparing,
    preparePendingSave,
  ]);

  const discardUnsavedChanges = useCallback(() => {
    clearSaveStatusTimer();

    const baselineSnapshot = historyRef.current[0];
    if (baselineSnapshot) {
      restoreHistorySnapshot({
        overlays: JSON.parse(JSON.stringify(baselineSnapshot.overlays || [])),
        menuImages: JSON.parse(JSON.stringify(baselineSnapshot.menuImages || [])),
        pendingChanges: [],
      });
    }

    setPendingChanges([]);
    clearPendingSaveBatch();
    setSaveError("");
    setIsSaving(false);
    setSaveStatus("idle");

    return { success: true };
  }, [clearPendingSaveBatch, clearSaveStatusTimer, restoreHistorySnapshot]);

  const confirmInfo = useCallback(async (photos) => {
    if (!callbacks?.onConfirmInfo || !restaurant?.id) {
      setConfirmError("Confirm callback is not configured.");
      return { success: false };
    }

    const safePhotos = (Array.isArray(photos) ? photos : [])
      .map((value) => asText(value))
      .filter(Boolean);
    if (!safePhotos.length) {
      setConfirmError("Upload at least one menu photo before confirming.");
      return { success: false };
    }

    setConfirmBusy(true);
    setConfirmError("");

    try {
      const payload = {
        restaurantId: restaurant.id,
        timestamp: new Date().toISOString(),
        photos: safePhotos,
      };
      const result = await callbacks.onConfirmInfo(payload);
      return { success: true, result };
    } catch (error) {
      setConfirmError(error?.message || "Failed to confirm information.");
      return { success: false, error };
    } finally {
      setConfirmBusy(false);
    }
  }, [callbacks, restaurant?.id]);

  const saveRestaurantSettings = useCallback(async () => {
    if (!callbacks?.onSaveRestaurantSettings || !restaurant?.id) {
      setSettingsSaveError("Restaurant settings callback is not configured.");
      return { success: false };
    }

    setSettingsSaveBusy(true);
    setSettingsSaveError("");

    try {
      const payload = {
        website: asText(restaurantSettingsDraft.website),
        phone: asText(restaurantSettingsDraft.phone),
        delivery_url: asText(restaurantSettingsDraft.delivery_url),
        menu_url: asText(restaurantSettingsDraft.menu_url),
      };

      await callbacks.onSaveRestaurantSettings({
        restaurantId: restaurant.id,
        ...payload,
      });

      settingsBaselineRef.current = serializeSettingsDraft(payload);
      return { success: true };
    } catch (error) {
      setSettingsSaveError(error?.message || "Failed to save restaurant settings.");
      return { success: false, error };
    } finally {
      setSettingsSaveBusy(false);
    }
  }, [callbacks, restaurant?.id, restaurantSettingsDraft]);

  const applyAiResultToSelectedOverlay = useCallback(async (result) => {
    if (!selectedOverlay?._editorKey || !result) {
      return { success: false };
    }

    const baseIngredients = (Array.isArray(result.ingredients) ? result.ingredients : []).map(
      (ingredient, index) => {
        const rowName = asText(ingredient?.name) || `Ingredient ${index + 1}`;
        const containsAllergens = normalizeAllergenList(ingredient?.allergens);
        const containsDiets = normalizeDietList(ingredient?.diets);
        const crossAllergens = normalizeAllergenList(
          ingredient?.crossContaminationAllergens,
        );
        const crossDiets = normalizeDietList(ingredient?.crossContaminationDiets);
        return {
          ...ingredient,
          name: rowName,
          allergens: containsAllergens,
          diets: containsDiets,
          crossContaminationAllergens: crossAllergens,
          crossContaminationDiets: crossDiets,
          aiDetectedAllergens: normalizeAllergenList(
            ingredient?.aiDetectedAllergens || containsAllergens,
          ),
          aiDetectedDiets: normalizeDietList(
            ingredient?.aiDetectedDiets || containsDiets,
          ),
          aiDetectedCrossContaminationAllergens: normalizeAllergenList(
            ingredient?.aiDetectedCrossContaminationAllergens || crossAllergens,
          ),
          aiDetectedCrossContaminationDiets: normalizeDietList(
            ingredient?.aiDetectedCrossContaminationDiets || crossDiets,
          ),
          brands: Array.isArray(ingredient?.brands) ? ingredient.brands : [],
          brandRequired: Boolean(ingredient?.brandRequired),
          brandRequirementReason: asText(ingredient?.brandRequirementReason),
          confirmed: false,
        };
      },
    );

    const scanRequirementFallbackReason =
      "Automatic scan-requirement analysis failed; assign a brand item.";
    const dishName = asText(selectedOverlay.id || selectedOverlay.name);
    const uniqueByToken = new Map();
    baseIngredients.forEach((ingredient) => {
      const name = asText(ingredient?.name);
      const token = normalizeToken(name);
      if (!token || uniqueByToken.has(token)) return;
      uniqueByToken.set(token, name);
    });

    const requirementByToken = new Map();
    await Promise.all(
      Array.from(uniqueByToken.entries()).map(async ([token, ingredientName]) => {
        try {
          if (!callbacks?.onAnalyzeIngredientScanRequirement) {
            throw new Error("Ingredient scan requirement callback is not configured.");
          }
          const scanResult = await callbacks.onAnalyzeIngredientScanRequirement({
            ingredientName,
            dishName,
          });
          if (typeof scanResult?.needsScan !== "boolean") {
            throw new Error("Invalid scan requirement result.");
          }
          const needsScan = Boolean(scanResult.needsScan);
          requirementByToken.set(token, {
            brandRequired: needsScan,
            brandRequirementReason: needsScan ? asText(scanResult.reasoning) : "",
          });
        } catch (_error) {
          requirementByToken.set(token, {
            brandRequired: true,
            brandRequirementReason: scanRequirementFallbackReason,
          });
        }
      }),
    );

    const ingredients = baseIngredients.map((ingredient) => {
      const token = normalizeToken(ingredient?.name);
      const requirement = token ? requirementByToken.get(token) : null;
      if (!requirement) {
        return {
          ...ingredient,
          brandRequired: true,
          brandRequirementReason: scanRequirementFallbackReason,
        };
      }
      return {
        ...ingredient,
        brandRequired: Boolean(requirement.brandRequired),
        brandRequirementReason: asText(requirement.brandRequirementReason),
      };
    });

    const allergens = Array.from(
      new Set(
        ingredients
          .flatMap((ingredient) =>
            Array.isArray(ingredient?.allergens) ? ingredient.allergens : [],
          )
          .filter(Boolean),
      ),
    );

    const candidateDiets = dedupeTokenList([
      ...(Array.isArray(config?.DIETS) ? config.DIETS : []),
      ...normalizeDietList(result?.dietaryOptions),
      ...ingredients.flatMap((ingredient) =>
        Array.isArray(ingredient?.diets) ? ingredient.diets : [],
      ),
    ]);
    const diets = ingredients.length
      ? candidateDiets.filter((diet) =>
          ingredients.every((ingredient) => {
            if (!Array.isArray(ingredient?.diets)) return false;
            return ingredient.diets.some(
              (value) => normalizeToken(value) === normalizeToken(diet),
            );
          }),
        )
      : [];

    const details = {};
    allergens.forEach((allergen) => {
      const matched = ingredients
        .filter((ingredient) =>
          Array.isArray(ingredient?.allergens)
            ? ingredient.allergens.includes(allergen)
            : false,
        )
        .map((ingredient) => asText(ingredient?.name))
        .filter(Boolean);
      if (matched.length) {
        details[allergen] = `Contains ${Array.from(new Set(matched)).join(", ")}`;
      }
    });

    const ingredientsBlockingDiets = computeDietBlockers(
      ingredients,
      candidateDiets,
    );
    const crossContaminationAllergens = Array.from(
      new Set(
        ingredients
          .flatMap((ingredient) =>
            Array.isArray(ingredient?.crossContaminationAllergens)
              ? ingredient.crossContaminationAllergens
              : [],
          )
          .filter(Boolean),
      ),
    );
    const crossContaminationDiets = Array.from(
      new Set(
        ingredients
          .flatMap((ingredient) =>
            Array.isArray(ingredient?.crossContaminationDiets)
              ? ingredient.crossContaminationDiets
              : [],
          )
          .filter(Boolean),
      ),
    );

    updateOverlay(selectedOverlay._editorKey, {
      allergens,
      diets,
      details,
      ingredients,
      removable: [],
      crossContaminationAllergens,
      crossContaminationDiets,
      ingredientsBlockingDiets,
    });

    const selectedDishName = asText(selectedOverlay.id || selectedOverlay.name || "Dish");
    const firstIngredientRowName = asText(
      ingredients.find((ingredient) => asText(ingredient?.name))?.name || "Ingredient row",
    );
    appendPendingChange(
      `${selectedDishName}: ${firstIngredientRowName}: Applied AI ingredient analysis`,
      {
        key: `ai-analysis:${normalizeToken(selectedDishName)}:${normalizeToken(firstIngredientRowName)}`,
      },
    );
    queueMicrotask(() => pushHistory());
    return { success: true };
  }, [
    appendPendingChange,
    callbacks?.onAnalyzeIngredientScanRequirement,
    config?.DIETS,
    normalizeAllergenList,
    normalizeDietList,
    pushHistory,
    selectedOverlay,
    updateOverlay,
  ]);

  const runAiDishAnalysis = useCallback(async ({ overrideText } = {}) => {
    if (!selectedOverlay || !callbacks?.onAnalyzeDish) return { success: false };

    const draftSnapshot = aiAssistDraftRef.current || {};
    const draftText = asText(
      overrideText !== undefined ? overrideText : draftSnapshot.text,
    );
    const draftImageData = asText(draftSnapshot.imageData);
    if (!draftText && !draftImageData) {
      setAiAssistDraft((current) => ({
        ...current,
        loading: false,
        error: "Add recipe text or upload an ingredient photo before processing.",
      }));
      return { success: false };
    }

    const payload = {
      dishName: selectedOverlay.id || selectedOverlay.name,
      text: draftText,
      // The UI presents text OR image input. If text exists, force text mode.
      imageData: draftText ? "" : draftImageData,
    };

    setAiAssistDraft((current) => ({
      ...current,
      loading: true,
      error: "",
      result: null,
    }));

    try {
      const result = await callbacks.onAnalyzeDish(payload);

      setAiAssistDraft((current) => ({
        ...current,
        imageData: payload.imageData,
        loading: false,
        result,
      }));

      return { success: true, result };
    } catch (error) {
      setAiAssistDraft((current) => ({
        ...current,
        loading: false,
        error: error?.message || "Failed to analyze dish.",
      }));
      return { success: false, error };
    }
  }, [callbacks, selectedOverlay, setAiAssistDraft]);

  const analyzeIngredientName = useCallback(async ({
    ingredientName,
    dishName,
  }) => {
    if (!callbacks?.onAnalyzeIngredientName) {
      return {
        success: false,
        error: new Error("Ingredient name analysis callback is not configured."),
      };
    }

    const safeIngredientName = asText(ingredientName);
    if (!safeIngredientName) {
      return {
        success: false,
        error: new Error("Ingredient name is required."),
      };
    }

    try {
      const result = await callbacks.onAnalyzeIngredientName({
        ingredientName: safeIngredientName,
        dishName:
          asText(dishName) ||
          asText(selectedOverlay?.id || selectedOverlay?.name),
      });

      const allergens = normalizeAllergenList(result?.allergens);
      const diets = normalizeDietList(result?.diets);

      return {
        success: true,
        result: {
          allergens,
          diets,
          crossContaminationAllergens: normalizeAllergenList(
            result?.crossContaminationAllergens,
          ),
          crossContaminationDiets: normalizeDietList(
            result?.crossContaminationDiets,
          ),
          aiDetectedAllergens: normalizeAllergenList(
            result?.aiDetectedAllergens || allergens,
          ),
          aiDetectedDiets: normalizeDietList(result?.aiDetectedDiets || diets),
          aiDetectedCrossContaminationAllergens: normalizeAllergenList(
            result?.aiDetectedCrossContaminationAllergens ||
              result?.crossContaminationAllergens,
          ),
          aiDetectedCrossContaminationDiets: normalizeDietList(
            result?.aiDetectedCrossContaminationDiets ||
              result?.crossContaminationDiets,
          ),
          reasoning: asText(result?.reasoning),
        },
      };
    } catch (error) {
      return { success: false, error };
    }
  }, [
    callbacks,
    normalizeAllergenList,
    normalizeDietList,
    selectedOverlay?.id,
    selectedOverlay?.name,
  ]);

  const analyzeIngredientScanRequirement = useCallback(async ({
    ingredientName,
    dishName,
  }) => {
    if (!callbacks?.onAnalyzeIngredientScanRequirement) {
      return {
        success: false,
        error: new Error("Ingredient scan requirement callback is not configured."),
      };
    }

    const safeIngredientName = asText(ingredientName);
    if (!safeIngredientName) {
      return {
        success: false,
        error: new Error("Ingredient name is required."),
      };
    }

    try {
      const result = await callbacks.onAnalyzeIngredientScanRequirement({
        ingredientName: safeIngredientName,
        dishName:
          asText(dishName) ||
          asText(selectedOverlay?.id || selectedOverlay?.name),
      });
      return {
        success: true,
        result: {
          needsScan: Boolean(result?.needsScan),
          reasoning: asText(result?.reasoning),
        },
      };
    } catch (error) {
      return { success: false, error };
    }
  }, [callbacks, selectedOverlay?.id, selectedOverlay?.name]);

  const submitIngredientAppeal = useCallback(async ({
    dishName,
    ingredientName,
    managerMessage,
    photoDataUrl,
  }) => {
    if (!callbacks?.onSubmitIngredientAppeal) {
      return {
        success: false,
        error: new Error("Ingredient appeal callback is not configured."),
      };
    }

    const safeDishName =
      asText(dishName) || asText(selectedOverlay?.id || selectedOverlay?.name);
    const safeIngredientName = asText(ingredientName);
    const safeManagerMessage = asText(managerMessage);
    const safePhotoDataUrl = asText(photoDataUrl);

    if (!safeDishName || !safeIngredientName || !safeManagerMessage || !safePhotoDataUrl) {
      return {
        success: false,
        error: new Error("Dish, ingredient, appeal message, and appeal photo are required."),
      };
    }

    try {
      const result = await callbacks.onSubmitIngredientAppeal({
        restaurantId: asText(restaurant?.id),
        dishName: safeDishName,
        ingredientName: safeIngredientName,
        managerMessage: safeManagerMessage,
        photoDataUrl: safePhotoDataUrl,
      });
      return { success: true, result };
    } catch (error) {
      return { success: false, error };
    }
  }, [callbacks, restaurant?.id, selectedOverlay?.id, selectedOverlay?.name]);

  const openIngredientLabelScan = useCallback(async ({
    ingredientName,
    onPhaseChange,
  }) => {
    if (!callbacks?.onOpenIngredientLabelScan) {
      return {
        success: false,
        error: new Error("Ingredient label scan callback is not configured."),
      };
    }

    try {
      const result = await callbacks.onOpenIngredientLabelScan({
        ingredientName: asText(ingredientName),
        onPhaseChange: typeof onPhaseChange === "function" ? onPhaseChange : undefined,
      });
      if (!result) return { success: true, result: null };

      const allergens = normalizeAllergenList(result?.allergens);
      const diets = normalizeDietList(result?.diets);
      const crossContaminationAllergens = normalizeAllergenList(
        result?.crossContaminationAllergens,
      );
      const crossContaminationDiets = normalizeDietList(
        result?.crossContaminationDiets,
      );

      const productName = asText(result?.productName) || asText(ingredientName);
      const normalizedResult = {
        ...result,
        productName,
        allergens,
        diets,
        crossContaminationAllergens,
        crossContaminationDiets,
        aiDetectedAllergens: normalizeAllergenList(
          result?.aiDetectedAllergens || allergens,
        ),
        aiDetectedDiets: normalizeDietList(result?.aiDetectedDiets || diets),
        aiDetectedCrossContaminationAllergens: normalizeAllergenList(
          result?.aiDetectedCrossContaminationAllergens ||
            crossContaminationAllergens,
        ),
        aiDetectedCrossContaminationDiets: normalizeDietList(
          result?.aiDetectedCrossContaminationDiets || crossContaminationDiets,
        ),
      };

      return { success: true, result: normalizedResult };
    } catch (error) {
      return { success: false, error };
    }
  }, [callbacks, normalizeAllergenList, normalizeDietList]);

  const resumeIngredientLabelScan = useCallback(async ({ sessionId }) => {
    if (!callbacks?.onResumeIngredientLabelScan) {
      return {
        success: false,
        error: new Error("Resume ingredient label scan callback is not configured."),
      };
    }

    const safeSessionId = asText(sessionId);
    if (!safeSessionId) {
      return {
        success: false,
        error: new Error("Ingredient label scan session id is required."),
      };
    }

    try {
      const result = await callbacks.onResumeIngredientLabelScan({
        sessionId: safeSessionId,
      });
      return {
        success: result?.success !== false,
        result: result || null,
      };
    } catch (error) {
      return { success: false, error };
    }
  }, [callbacks]);


  const detectMenuCorners = useCallback(async ({ imageData, width, height }) => {
    if (!callbacks?.onDetectMenuCorners) {
      return {
        success: false,
        error: "Corner detection callback is not configured.",
      };
    }

    try {
      const result = await callbacks.onDetectMenuCorners({
        imageData,
        width,
        height,
      });
      return {
        success: Boolean(result?.success),
        corners: result?.corners || null,
        description: asText(result?.description),
        error: asText(result?.error),
      };
    } catch (error) {
      return {
        success: false,
        corners: null,
        error: error?.message || "Failed to detect menu corners.",
      };
    }
  }, [callbacks]);

  const runDetectDishes = useCallback(async () => {
    if (!callbacks?.onDetectMenuDishes) return { success: false };

    const image = draftMenuImages[activePageIndex] || "";
    const imageData = await toDataUrlFromImage(image);
    if (!imageData) {
      setDetectWizardState({
        loading: false,
        dishes: [],
        currentIndex: 0,
        error: "No menu image available for dish detection.",
      });
      setDetectWizardOpen(true);
      return { success: false };
    }

    setDetectWizardState((current) => ({
      ...current,
      loading: true,
      error: "",
      dishes: [],
      currentIndex: 0,
    }));
    setDetectWizardOpen(true);

    try {
      const result = await callbacks.onDetectMenuDishes({
        imageData,
        pageIndex: activePageIndex,
      });

      const dishes = Array.isArray(result?.dishes)
        ? result.dishes.map((dish, index) => ({
            name: asText(dish?.name || `Dish ${index + 1}`),
            mapped: false,
          }))
        : [];

      setDetectWizardState({
        loading: false,
        dishes,
        currentIndex: 0,
        error: dishes.length ? "" : "No dishes detected.",
      });

      return { success: dishes.length > 0, result };
    } catch (error) {
      setDetectWizardState({
        loading: false,
        dishes: [],
        currentIndex: 0,
        error: error?.message || "Failed to detect dishes.",
      });
      return { success: false, error };
    }
  }, [activePageIndex, callbacks, draftMenuImages]);

  const mapDetectedDish = useCallback((rect) => {
    const dishes = Array.isArray(detectWizardState.dishes) ? detectWizardState.dishes : [];
    if (!dishes.length) return null;

    const target = dishes[detectWizardState.currentIndex];
    if (!target?.name) return null;

    const nextOverlayKey = `ov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextOverlay = ensureOverlayVisibility(
      normalizeOverlay(
        {
          _editorKey: nextOverlayKey,
          id: target.name,
          name: target.name,
          description: "",
          x: clamp(Number(rect?.x) || 0, 0, 99),
          y: clamp(Number(rect?.y) || 0, 0, 99),
          w: clamp(Number(rect?.w) || 8, 1, 100),
          h: clamp(Number(rect?.h) || 6, 1, 100),
          pageIndex: activePageIndex,
          allergens: [],
          diets: [],
          removable: [],
          crossContaminationAllergens: [],
          crossContaminationDiets: [],
          details: {},
        },
        draftOverlays.length,
        nextOverlayKey,
      ),
      menuImagesRef.current.length,
    );

    applyOverlayList((current) => [...current, nextOverlay]);
    setSelectedOverlayKey(nextOverlayKey);

    appendPendingChange(`${nextOverlay.id}: Added overlay manually`);

    setDetectWizardState((current) => {
      const nextDishes = current.dishes.map((dish, index) =>
        index === current.currentIndex ? { ...dish, mapped: true } : dish,
      );

      let nextIndex = current.currentIndex;
      const forward = nextDishes.findIndex((dish, index) => index > current.currentIndex && !dish.mapped);
      if (forward >= 0) {
        nextIndex = forward;
      } else {
        const any = nextDishes.findIndex((dish) => !dish.mapped);
        nextIndex = any >= 0 ? any : current.currentIndex;
      }

      return {
        ...current,
        dishes: nextDishes,
        currentIndex: nextIndex,
      };
    });

    queueMicrotask(() => pushHistory());
    return nextOverlay;
  }, [
    activePageIndex,
    appendPendingChange,
    applyOverlayList,
    detectWizardState.currentIndex,
    detectWizardState.dishes,
    draftOverlays.length,
    pushHistory,
  ]);

  const setDetectWizardIndex = useCallback((nextIndex) => {
    setDetectWizardState((current) => ({
      ...current,
      currentIndex: clamp(
        Number(nextIndex) || 0,
        0,
        Math.max(current.dishes.length - 1, 0),
      ),
    }));
  }, []);

  const closeDetectWizard = useCallback(() => {
    setDetectWizardOpen(false);
    setDetectWizardState({
      loading: false,
      dishes: [],
      currentIndex: 0,
      error: "",
    });
  }, []);

  useEffect(() => {
    if (initialDishResolved) return;
    if (!params?.dishName || !draftOverlays.length) return;
    const match = matchOverlayByDishName(draftOverlays, params.dishName);
    if (!match) return;
    setSelectedOverlayKey(match._editorKey);
    setActivePageIndex(match.pageIndex || 0);
    setDishEditorOpen(true);
    if (params?.openAI) {
      setDishAiAssistOpen(true);
      if (params?.ingredientName) {
        setAiAssistDraft((current) => ({
          ...current,
          text: `Ingredient focus: ${asText(params.ingredientName)}`,
        }));
      }
    }
    setInitialDishResolved(true);
  }, [
    draftOverlays,
    initialDishResolved,
    params?.dishName,
    params?.ingredientName,
    params?.openAI,
    setAiAssistDraft,
  ]);

  useEffect(() => {
    if (!canEdit) return undefined;

    const handleKeyDown = (event) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      if (!modifier) return;

      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if (
        event.key.toLowerCase() === "y" ||
        (event.key.toLowerCase() === "z" && event.shiftKey)
      ) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canEdit, redo, undo]);

  useEffect(() => {
    if (!isDirty) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const getBrandRequirementIssues = useCallback((overlay) => {
    if (overlay) {
      return buildOverlayBrandRequirementIssues(overlay);
    }
    return buildBrandRequirementIssues(overlaysRef.current);
  }, []);

  const getIngredientConfirmationIssues = useCallback((overlay) => {
    if (overlay) {
      return buildOverlayIngredientConfirmationIssues(overlay);
    }
    return buildIngredientConfirmationIssues(overlaysRef.current);
  }, []);

  return {
    canEdit,
    overlays: draftOverlays,
    draftOverlays,
    draftMenuImages,
    overlaysByPage,
    selectedOverlay,
    selectedOverlayIndex,
    selectedOverlayKey,
    selectedPageIndex,
    activePageIndex,
    zoomScale,

    pendingChanges,
    pendingSaveBatchId,
    pendingSaveRows,
    pendingSaveError,
    pendingSavePreparing,
    getBaselineSnapshot,
    isDirty,
    saveError,
    isSaving,
    saveStatus,

    canUndo,
    canRedo,
    undo,
    undoPendingChange,
    redo,
    pushHistory,

    selectOverlay,
    updateOverlay,
    updateSelectedOverlay,
    addOverlay,
    removeOverlay,

    openDishEditor,
    closeDishEditor,
    dishEditorOpen,

    dishAiAssistOpen,
    setDishAiAssistOpen,
    aiAssistDraft,
    setAiAssistDraft,
    runAiDishAnalysis,
    applyAiResultToSelectedOverlay,
    analyzeIngredientName,
    analyzeIngredientScanRequirement,
    submitIngredientAppeal,
    openIngredientLabelScan,
    resumeIngredientLabelScan,
    detectMenuCorners,

    toggleSelectedAllergen,
    setSelectedAllergenDetail,
    setSelectedAllergenRemovable,
    setSelectedAllergenCrossContamination,
    toggleSelectedDiet,

    jumpToPage,
    setActivePageIndex,
    zoomIn,
    zoomOut,
    zoomReset,
    setZoomScale,

    save,
    preparePendingSave,
    clearPendingSaveBatch,
    discardUnsavedChanges,
    confirmInfo,
    confirmBusy,
    confirmError,
    confirmInfoOpen,
    setConfirmInfoOpen,

    changeLogOpen,
    setChangeLogOpen,
    changeLogs,
    loadingChangeLogs,
    changeLogError,
    loadChangeLogs,
    restoreFromChangeLog,

    pendingTableOpen,
    setPendingTableOpen,
    pendingTableRows,
    pendingTableBatch,
    loadingPendingTable,
    pendingTableError,
    loadPendingTable,

    menuPagesOpen,
    setMenuPagesOpen,
    createDraftSnapshot,
    restoreDraftSnapshot,
    addMenuPages,
    addMenuPage,
    replaceMenuPage,
    replaceMenuPageWithSections,
    removeMenuPage,
    moveMenuPage,
    analyzeMenuPagesAndMergeOverlays,

    restaurantSettingsOpen,
    setRestaurantSettingsOpen,
    restaurantSettingsDraft,
    setRestaurantSettingsDraft,
    saveRestaurantSettings,
    settingsDirty,
    settingsSaveBusy,
    settingsSaveError,

    detectWizardOpen,
    setDetectWizardOpen,
    detectWizardState,
    runDetectDishes,
    mapDetectedDish,
    setDetectWizardIndex,
    closeDetectWizard,
    getBrandRequirementIssues,
    getIngredientConfirmationIssues,

    config: {
      allergens: Array.isArray(config?.ALLERGENS) ? config.ALLERGENS : [],
      diets: Array.isArray(config?.DIETS) ? config.DIETS : [],
      normalizeAllergen: normalizeAllergenValue,
      normalizeDietLabel: normalizeDietValue,
      normalizeAllergenList,
      normalizeDietList,
      formatAllergenLabel:
        typeof config?.formatAllergenLabel === "function"
          ? config.formatAllergenLabel
          : (value) => asText(value),
      formatDietLabel:
        typeof config?.formatDietLabel === "function"
          ? config.formatDietLabel
          : (value) => asText(value),
      getAllergenEmoji:
        typeof config?.getAllergenEmoji === "function"
          ? config.getAllergenEmoji
          : () => "",
      getDietEmoji:
        typeof config?.getDietEmoji === "function"
          ? config.getDietEmoji
          : () => "",
      getDietAllergenConflicts:
        typeof config?.getDietAllergenConflicts === "function"
          ? config.getDietAllergenConflicts
          : () => [],
      savedAllergens: (Array.isArray(previewPreferences?.allergies)
        ? previewPreferences.allergies
        : []
      ).map((value) => ({
        key: value,
        label:
          typeof config?.formatAllergenLabel === "function"
            ? config.formatAllergenLabel(value)
            : asText(value),
        emoji:
          typeof config?.getAllergenEmoji === "function"
            ? config.getAllergenEmoji(value)
            : "",
      })),
      savedDiets: (Array.isArray(previewPreferences?.diets) ? previewPreferences.diets : []).map(
        (value) => ({
          key: value,
          label:
            typeof config?.formatDietLabel === "function"
              ? config.formatDietLabel(value)
              : asText(value),
          emoji:
            typeof config?.getDietEmoji === "function" ? config.getDietEmoji(value) : "",
        }),
      ),
    },
  };
}

export default useRestaurantEditor;
