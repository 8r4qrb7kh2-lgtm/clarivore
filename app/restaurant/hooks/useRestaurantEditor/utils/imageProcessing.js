import { asText } from "./text";
import { clamp } from "./text";

// Browser image helpers for loading, measuring, and geometry mapping.
// These are async because they rely on network/image decode APIs.

export async function toDataUrlFromImage(source) {
  // Convert either remote URLs or existing data URLs into a data URL.
  // Downstream image pipelines only operate on data URLs.
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

export async function readImageDimensions(dataUrl) {
  // Decode image dimensions in the browser without mutating the source.
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

export async function normalizeImageToLetterboxedSquare(source, targetSize = 1000) {
  // Normalize arbitrary image dimensions to a square canvas with letterboxing.
  // We return placement metrics so remap geometry can be projected correctly.
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

export function cloneSnapshotList(value) {
  // Deep clone via JSON for snapshot payloads that contain plain data.
  return JSON.parse(JSON.stringify(Array.isArray(value) ? value : []));
}

export function buildPageMoveIndexMap(pageCount, fromIndex, toIndex) {
  // Build a page index remap table for reorder operations.
  // mapping[oldIndex] -> newIndex after the move.
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

export function matchOverlayByDishName(overlays, dishName) {
  // Route query helper: find an overlay by flexible dish-name matching.
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
