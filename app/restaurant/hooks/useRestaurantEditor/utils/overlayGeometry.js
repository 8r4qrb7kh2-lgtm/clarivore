import { asText } from "./text";
import { clamp } from "./text";

// Geometry helpers normalize overlay coordinates from many historical formats.
// The editor always works in percent space, so we convert incoming values to that space.

export function normalizeNumber(value, fallback = 0) {
  // Parse any value to number and fall back when parsing fails.
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function firstFiniteNumber(...values) {
  // Return the first finite numeric candidate from a fallback chain.
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeRectValue(value, fallback = 0) {
  // Rectangle percentages must always stay in 0..100.
  return clamp(normalizeNumber(value, fallback), 0, 100);
}

export function resolveOverlayScale(overlays) {
  // Heuristically infer coordinate scale from incoming numeric ranges.
  // This keeps old data formats readable without requiring migration.
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

export function resolvePageOffset(overlays, pageCount) {
  const values = (Array.isArray(overlays) ? overlays : [])
    .map((overlay) =>
      firstFiniteNumber(
        overlay?.pageIndex,
        overlay?.page,
        overlay?.pageNumber,
        overlay?.page_number,
      ))
    .filter((value) => Number.isFinite(value));

  if (!values.length) return 0;

  const minPage = Math.min(...values);
  const maxPage = Math.max(...values);
  const hasZero = values.some((value) => value === 0);

  // Old exports occasionally used 1-based pages. Shift them back to 0-based.
  if (!hasZero && minPage >= 1 && pageCount > 0 && maxPage <= pageCount) {
    return 1;
  }

  return 0;
}

function buildOverlayBoundsByPage(overlays, pageOffset = 0) {
  // Track the farthest right/bottom coordinates per page.
  // We use this to detect pixel-like payloads that were stored as "percent".
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

export function buildOverlayNormalizationContext(overlays, pageCount) {
  // Precompute expensive normalization clues once and reuse for each overlay.
  const pageOffset = resolvePageOffset(overlays, pageCount);
  return {
    scale: resolveOverlayScale(overlays),
    pageOffset,
    boundsByPage: buildOverlayBoundsByPage(overlays, pageOffset),
  };
}

export function normalizeOverlay(overlay, index, fallbackKey, context = {}) {
  // Normalize one raw overlay into the editor's expected shape.
  // The output always uses percent coordinates and stable collection fields.
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

  const xValue = Number.isFinite(rawX) ? rawX * scale * xScale : 8;
  const yValue = Number.isFinite(rawY) ? rawY * scale * yScale : 8;
  const wValue = Number.isFinite(rawW) ? rawW * scale * xScale : 20;
  const hValue = Number.isFinite(rawH) ? rawH * scale * yScale : 8;

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

export function ensureOverlayVisibility(overlay, pageCount = 1) {
  // Enforce geometry safety so an overlay is always selectable/renderable.
  // This is called after normalization and after edit operations.
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

  // If the overlay falls fully out of frame, pull it back to a visible default.
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
