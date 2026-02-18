import { firstFiniteNumber } from "./overlayGeometry";
import { asText, clamp, normalizeCoordSpace, normalizeToken } from "./text";

// Menu analysis helpers convert detector/remap outputs into normalized percent-space boxes.
// They are intentionally pure so the async analysis hook can stay focused on control flow.

export function normalizeDetectedRect(dish, imageDimensions) {
  // Normalize detector output into percent-space coordinates.
  // Supports multiple coordinate systems because upstream models evolved over time.
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

  // Model payload may include explicit units; normalize those first.
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

  // Heuristic checks for implicit coordinate units when explicit unit is missing.
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

  // Pick the best coordinate mode from explicit or inferred clues.
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

  // Convert into percent units expected by editor overlay geometry.
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
}

function resolveRemapRectToThousand(dish, imageDimensions) {
  // Remap responses are easier to merge when normalized to 1000-space first.
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

  // Normalize optional explicit coord-space label from remap payload.
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

  // Pick conversion mode using explicit unit first, heuristics second.
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
}

export function normalizeRemappedRect(dish, metrics, imageDimensions) {
  // Project remap coordinates from letterboxed-square space back to percent overlay space.
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
}

export function toLegacyOverlayHint(overlay, metrics) {
  // Convert current overlay percent box into legacy thousand-space hint box.
  // Remap mode uses these hints as anchors for matching across image versions.
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
}

export function normalizeDetectedDishes(rawDishes, imageDimensions) {
  // Normalize and dedupe dishes by tokenized name.
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
}

export function scoreRemapDishQuality(dishes) {
  // Assign a coarse quality score used to decide whether detect-fallback is needed.
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
}

export function getSourcePageOverlays(sourceIndex, baselineOverlayList) {
  // Pull overlays that came from the baseline source page during remap flows.
  if (sourceIndex === null) return [];

  return baselineOverlayList.filter((overlay) => {
    const page = firstFiniteNumber(
      overlay?.pageIndex,
      overlay?.page,
      overlay?.pageNumber,
      overlay?.page_number,
    );
    return (Number.isFinite(page) ? Math.floor(page) : 0) === sourceIndex;
  });
}
