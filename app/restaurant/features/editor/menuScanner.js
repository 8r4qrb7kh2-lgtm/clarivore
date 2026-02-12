"use client";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function asText(value) {
  return String(value || "").trim();
}

function readImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image."));
    image.src = dataUrl;
  });
}

export function buildDefaultScannerCorners() {
  return {
    topLeft: { x: 50, y: 50 },
    topRight: { x: 950, y: 50 },
    bottomRight: { x: 950, y: 950 },
    bottomLeft: { x: 50, y: 950 },
  };
}

export async function fileToDataUrl(file) {
  if (!file) return "";
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

export async function normalizeImageForCornerDetection(dataUrl) {
  const image = await readImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 1000;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available.");
  }

  context.fillStyle = "#000";
  context.fillRect(0, 0, 1000, 1000);

  const scale = Math.min(1000 / image.width, 1000 / image.height);
  const scaledW = image.width * scale;
  const scaledH = image.height * scale;
  const offsetX = (1000 - scaledW) / 2;
  const offsetY = (1000 - scaledH) / 2;

  context.drawImage(image, offsetX, offsetY, scaledW, scaledH);

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.85),
    width: 1000,
    height: 1000,
    metrics: {
      offsetX,
      offsetY,
      scaledW,
      scaledH,
    },
  };
}

function mapDetectionCoordinate(value, padding, dimension) {
  if (!Number.isFinite(Number(value))) return 0;
  if (!Number.isFinite(Number(dimension)) || Number(dimension) <= 0) return 0;
  const relative = (Number(value) - Number(padding || 0)) / Number(dimension);
  return clamp(relative * 1000, 0, 1000);
}

export function mapDetectedCornersToOriginal(corners, metrics) {
  if (!corners || typeof corners !== "object") return buildDefaultScannerCorners();
  if (!metrics || !Number.isFinite(Number(metrics.scaledW)) || !Number.isFinite(Number(metrics.scaledH))) {
    return buildDefaultScannerCorners();
  }

  const readCorner = (value, fallback) => {
    const point = value && typeof value === "object" ? value : fallback;
    return {
      x: mapDetectionCoordinate(point?.x, metrics.offsetX, metrics.scaledW),
      y: mapDetectionCoordinate(point?.y, metrics.offsetY, metrics.scaledH),
    };
  };

  return {
    topLeft: readCorner(corners.topLeft, { x: 0, y: 0 }),
    topRight: readCorner(corners.topRight, { x: 1000, y: 0 }),
    bottomRight: readCorner(corners.bottomRight, { x: 1000, y: 1000 }),
    bottomLeft: readCorner(corners.bottomLeft, { x: 0, y: 1000 }),
  };
}

function mapCornerToImage(point, width, height) {
  return {
    x: clamp((Number(point?.x) || 0) / 1000, 0, 1) * width,
    y: clamp((Number(point?.y) || 0) / 1000, 0, 1) * height,
  };
}

function maybeWarpWithOpenCv(image, corners) {
  const cv = window.cv;
  if (!cv || typeof cv.imread !== "function") {
    return null;
  }

  try {
    const src = cv.imread(image);
    const dst = new cv.Mat();

    const tl = mapCornerToImage(corners.topLeft, image.width, image.height);
    const tr = mapCornerToImage(corners.topRight, image.width, image.height);
    const br = mapCornerToImage(corners.bottomRight, image.width, image.height);
    const bl = mapCornerToImage(corners.bottomLeft, image.width, image.height);

    const widthA = Math.hypot(br.x - bl.x, br.y - bl.y);
    const widthB = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const maxWidth = Math.max(1, Math.round(Math.max(widthA, widthB)));

    const heightA = Math.hypot(tr.x - br.x, tr.y - br.y);
    const heightB = Math.hypot(tl.x - bl.x, tl.y - bl.y);
    const maxHeight = Math.max(1, Math.round(Math.max(heightA, heightB)));

    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x,
      tl.y,
      tr.x,
      tr.y,
      br.x,
      br.y,
      bl.x,
      bl.y,
    ]);

    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0,
      0,
      maxWidth,
      0,
      maxWidth,
      maxHeight,
      0,
      maxHeight,
    ]);

    const matrix = cv.getPerspectiveTransform(srcTri, dstTri);
    cv.warpPerspective(src, dst, matrix, new cv.Size(maxWidth, maxHeight));

    const canvas = document.createElement("canvas");
    cv.imshow(canvas, dst);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);

    src.delete();
    dst.delete();
    srcTri.delete();
    dstTri.delete();
    matrix.delete();

    return dataUrl;
  } catch {
    return null;
  }
}

function fallbackCrop(image, corners) {
  const points = [
    mapCornerToImage(corners.topLeft, image.width, image.height),
    mapCornerToImage(corners.topRight, image.width, image.height),
    mapCornerToImage(corners.bottomRight, image.width, image.height),
    mapCornerToImage(corners.bottomLeft, image.width, image.height),
  ];

  const minX = Math.max(0, Math.min(...points.map((p) => p.x)));
  const maxX = Math.min(image.width, Math.max(...points.map((p) => p.x)));
  const minY = Math.max(0, Math.min(...points.map((p) => p.y)));
  const maxY = Math.min(image.height, Math.max(...points.map((p) => p.y)));

  const width = Math.max(1, Math.round(maxX - minX));
  const height = Math.max(1, Math.round(maxY - minY));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available.");
  }

  context.drawImage(image, minX, minY, width, height, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

export async function warpImageFromCorners(imageDataUrl, corners) {
  const image = await readImage(imageDataUrl);
  const normalizedCorners = corners || buildDefaultScannerCorners();

  const warpedWithCv = maybeWarpWithOpenCv(image, normalizedCorners);
  if (asText(warpedWithCv)) {
    return {
      dataUrl: warpedWithCv,
      usedFallback: false,
    };
  }

  return {
    dataUrl: fallbackCrop(image, normalizedCorners),
    usedFallback: true,
  };
}

export async function splitTallImageIntoSections(
  imageDataUrl,
  options = {},
) {
  const source = asText(imageDataUrl);
  if (!source) return [];

  const image = await readImage(source);
  const maxAspectRatio = Number(options?.maxAspectRatio) || 1.75;
  const maxSections = clamp(Number(options?.maxSections) || 5, 1, 8);
  const requestedSections = Number(options?.sections);

  const aspectRatio = image.height / Math.max(image.width, 1);
  const sectionCount = Number.isFinite(requestedSections) && requestedSections > 0
    ? clamp(Math.floor(requestedSections), 1, maxSections)
    : clamp(Math.ceil(aspectRatio / maxAspectRatio), 1, maxSections);

  if (sectionCount <= 1) {
    return [
      {
        dataUrl: source,
        yStart: 0,
        yEnd: 100,
        sectionIndex: 0,
      },
    ];
  }

  const stripHeight = Math.ceil(image.height / sectionCount);
  const sections = [];

  for (let index = 0; index < sectionCount; index += 1) {
    const sourceY = index * stripHeight;
    const sourceHeight = Math.min(stripHeight, image.height - sourceY);

    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = sourceHeight;

    const context = canvas.getContext("2d");
    if (!context) continue;

    context.drawImage(
      image,
      0,
      sourceY,
      image.width,
      sourceHeight,
      0,
      0,
      image.width,
      sourceHeight,
    );

    sections.push({
      dataUrl: canvas.toDataURL("image/jpeg", 0.9),
      yStart: (sourceY / image.height) * 100,
      yEnd: ((sourceY + sourceHeight) / image.height) * 100,
      sectionIndex: index,
    });
  }

  return sections;
}
