import { asText, dedupeTokenList } from "./text";
import { clamp } from "./text";
import { normalizeNumber, normalizeRectValue } from "./overlayGeometry";

// Write-time normalization helpers.
// These helpers sanitize client-side editor state into API-safe payloads.

export function buildMenuImages(restaurant) {
  // Collect menu images from canonical restaurant fields.
  // We always return at least one entry so page-based UI has a stable shape.
  const explicit = Array.isArray(restaurant?.menuImages)
    ? restaurant.menuImages.filter(Boolean)
    : [];

  if (!explicit.length && restaurant?.menuImage) {
    explicit.push(restaurant.menuImage);
  }

  if (!explicit.length) {
    explicit.push("");
  }

  return explicit;
}

function sanitizePersistedImageValue(value) {
  // Persisted brand/ingredient image fields should store URLs, not data URLs.
  const text = asText(value);
  if (!text) return "";
  if (text.toLowerCase().startsWith("data:image")) return "";
  return text;
}

function normalizeBrandForWrite(brand) {
  // Reduce brand payload to a safe, write-ready structure.
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
  // API currently expects one normalized brand row per ingredient.
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeBrandForWrite(value);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeIngredientForWrite(ingredient, index) {
  // Normalize one ingredient row before writing overlays back to server.
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

export function stripEditorOverlay(overlay) {
  // Remove editor-only fields and normalize geometry/ingredients for API writes.
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
  // Generate a stable comparison key for overlay identity checks.
  const name = asText(overlay?.id || overlay?.name || overlay?.dishName);
  if (!name) return "";
  const token = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return token || name;
}

function buildOverlayOrderAndMap(overlays) {
  // Build keyed lookup + order list used for delta generation.
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
  // Deep compare plain overlay objects via deterministic JSON representation.
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildOverlayDeltaPayload({ baselineOverlays, overlays }) {
  // Compute upserts/deletes/order changes between baseline and current overlays.
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

export function serializeEditorState(overlays, menuImages) {
  // Canonical serialization used for dirty-state and pending-save hash checks.
  return JSON.stringify({
    overlays: (Array.isArray(overlays) ? overlays : []).map(stripEditorOverlay),
    menuImages: Array.isArray(menuImages) ? menuImages.filter(Boolean) : [],
  });
}

export function normalizeMenuImageList(menuImages) {
  // Keep only non-empty image strings for write payloads.
  return (Array.isArray(menuImages) ? menuImages : [])
    .map((value) => asText(value))
    .filter(Boolean);
}

export function serializeMenuImageList(menuImages) {
  // Stable serialization wrapper for menu image list equality checks.
  return JSON.stringify(normalizeMenuImageList(menuImages));
}

function getUtf8ByteLength(value) {
  // Measure serialized payload size in UTF-8 bytes.
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
  // Adaptive JPEG compression loop used to keep menu image writes under gateway limits.
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

      // The loop gradually lowers quality and dimensions until we meet the byte budget.
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

export async function optimizeMenuImagesForWrite(
  menuImages,
  { perImageMaxBytes = 220_000, totalMaxBytes = 850_000 } = {},
) {
  // First compress per image, then tighten further if the total batch is still too large.
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

export function parseSerializedEditorState(serialized) {
  // Safe parser for editor state snapshots stored in refs.
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
