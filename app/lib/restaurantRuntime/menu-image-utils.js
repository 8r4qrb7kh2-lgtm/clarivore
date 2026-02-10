/**
 * Analyzes overlay bounding boxes to determine if image splitting is needed.
 * When boxes would be smaller than minPixelHeight on a reference mobile screen,
 * recommends splitting the image into horizontal strips.
 *
 * @param {Array} overlays - Array of overlay objects with x, y, w, h (0-1000 scale from AI)
 * @param {Object} imageMetrics - { x, y, w, h } letterbox metrics (content area within 1000x1000 canvas)
 * @param {number} minPixelHeight - Minimum acceptable box height in pixels (default 75)
 * @param {number} referenceWidth - Reference display width to calculate against (default 375 for mobile)
 * @returns {Object} { needsSplit: boolean, stripCount: number, smallestBoxHeight: number, avgBoxHeight: number }
 */
export function analyzeBoxSizes(
  overlays,
  imageMetrics,
  minPixelHeight = 75,
  referenceWidth = 375,
) {
  if (!overlays || overlays.length === 0) {
    return {
      needsSplit: false,
      stripCount: 1,
      smallestBoxHeight: Infinity,
      avgBoxHeight: Infinity,
    };
  }

  const contentW = imageMetrics.w || 1000;
  const contentH = imageMetrics.h || 1000;

  const aspectRatio = contentH / contentW;
  const displayHeight = referenceWidth * aspectRatio;

  let smallestBoxHeight = Infinity;
  let totalBoxHeight = 0;

  overlays.forEach((o) => {
    const boxHeightRatio = o.h / contentH;
    const boxPixelHeight = boxHeightRatio * displayHeight;

    if (boxPixelHeight < smallestBoxHeight) {
      smallestBoxHeight = boxPixelHeight;
    }
    totalBoxHeight += boxPixelHeight;
  });

  const avgBoxHeight = totalBoxHeight / overlays.length;

  if (smallestBoxHeight >= minPixelHeight) {
    return {
      needsSplit: false,
      stripCount: 1,
      smallestBoxHeight,
      avgBoxHeight,
    };
  }

  const scaleNeeded = minPixelHeight / smallestBoxHeight;
  const stripCount = Math.min(Math.max(Math.ceil(scaleNeeded), 1), 5);

  console.log(
    `[analyzeBoxSizes] smallest=${smallestBoxHeight.toFixed(1)}px, avg=${avgBoxHeight.toFixed(1)}px, scaleNeeded=${scaleNeeded.toFixed(2)}, strips=${stripCount}`,
  );

  return {
    needsSplit: stripCount > 1,
    stripCount,
    smallestBoxHeight,
    avgBoxHeight,
  };
}

/**
 * Splits an image into horizontal strips.
 *
 * @param {string} imageDataUrl - The source image as data URL
 * @param {number} stripCount - Number of strips to create
 * @returns {Promise<Array>} Array of { dataUrl, stripIndex, yStartFraction, yEndFraction }
 */
export async function splitImageIntoStrips(imageDataUrl, stripCount) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";

    img.onload = () => {
      const strips = [];
      const stripHeight = Math.ceil(img.height / stripCount);

      for (let i = 0; i < stripCount; i++) {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;

        const sourceY = i * stripHeight;
        const actualStripHeight = Math.min(stripHeight, img.height - sourceY);
        canvas.height = actualStripHeight;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(
          img,
          0,
          sourceY,
          img.width,
          actualStripHeight,
          0,
          0,
          img.width,
          actualStripHeight,
        );

        strips.push({
          dataUrl: canvas.toDataURL("image/jpeg", 0.85),
          stripIndex: i,
          yStartFraction: sourceY / img.height,
          yEndFraction: Math.min((sourceY + actualStripHeight) / img.height, 1),
          originalHeight: img.height,
          stripHeight: actualStripHeight,
        });
      }

      console.log(
        `[splitImageIntoStrips] Created ${strips.length} strips from ${img.width}x${img.height} image`,
      );
      resolve(strips);
    };

    img.onerror = () => reject(new Error("Failed to load image for splitting"));
    img.src = imageDataUrl;
  });
}

/**
 * Detects column boundaries in a menu by analyzing horizontal gaps in overlay positions.
 * @param {Array} overlays - Array of overlay objects with x, y, w, h (0-100 scale or 0-1000 scale)
 * @returns {Object} { columnCount, splitPoints: [x1, x2, ...] in 0-100 scale }
 */
export function detectColumns(overlays) {
  if (!overlays || overlays.length < 2) {
    return { columnCount: 1, splitPoints: [] };
  }

  const normalizedOverlays = overlays.map((o) => {
    const maxCoord = Math.max(o.x || 0, o.y || 0, o.w || 0, o.h || 0);
    const scale = maxCoord > 150 ? 0.1 : 1;
    return {
      x: (o.x || 0) * scale,
      w: (o.w || 0) * scale,
    };
  });

  const coverage = new Array(100).fill(0);
  normalizedOverlays.forEach((o) => {
    const startX = Math.max(0, Math.floor(o.x));
    const endX = Math.min(100, Math.ceil(o.x + o.w));
    for (let x = startX; x < endX; x++) {
      coverage[x]++;
    }
  });

  const gaps = [];
  let gapStart = -1;
  const minGapWidth = 3;

  for (let x = 10; x < 90; x++) {
    if (coverage[x] === 0) {
      if (gapStart === -1) gapStart = x;
    } else if (gapStart !== -1) {
      const gapWidth = x - gapStart;
      if (gapWidth >= minGapWidth) {
        gaps.push({
          start: gapStart,
          end: x,
          center: (gapStart + x) / 2,
          width: gapWidth,
        });
      }
      gapStart = -1;
    }
  }

  gaps.sort((a, b) => b.width - a.width);
  const significantGaps = gaps
    .filter((g) => g.width >= minGapWidth)
    .slice(0, 2);

  significantGaps.sort((a, b) => a.center - b.center);

  const splitPoints = significantGaps.map((g) => g.center);
  const columnCount = splitPoints.length + 1;

  console.log(
    `[detectColumns] Found ${columnCount} columns with split points:`,
    splitPoints,
    "Coverage gaps:",
    gaps,
  );

  return { columnCount, splitPoints };
}

/**
 * Splits an image into sections based on column boundaries and optional horizontal strips.
 * @param {string} imageDataUrl - The source image as data URL
 * @param {Array} columnSplitPoints - Array of x-coordinates (0-100 scale) for vertical splits
 * @param {number} horizontalStrips - Number of horizontal strips per column (default 1)
 * @returns {Promise<Array>} Array of { dataUrl, sectionIndex, col, row, bounds }
 */
export async function splitImageIntoSections(
  imageDataUrl,
  columnSplitPoints = [],
  horizontalStrips = 1,
) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";

    img.onload = () => {
      const sections = [];

      const colBoundaries = [0, ...columnSplitPoints, 100];
      const numCols = colBoundaries.length - 1;

      let sectionIndex = 0;

      for (let col = 0; col < numCols; col++) {
        const colStartPct = colBoundaries[col];
        const colEndPct = colBoundaries[col + 1];
        const colStartPx = Math.floor((colStartPct / 100) * img.width);
        const colEndPx = Math.floor((colEndPct / 100) * img.width);
        const colWidth = colEndPx - colStartPx;

        const stripHeight = Math.ceil(img.height / horizontalStrips);

        for (let row = 0; row < horizontalStrips; row++) {
          const rowStartPx = row * stripHeight;
          const rowEndPx = Math.min((row + 1) * stripHeight, img.height);
          const actualStripHeight = rowEndPx - rowStartPx;

          const canvas = document.createElement("canvas");
          canvas.width = colWidth;
          canvas.height = actualStripHeight;
          const ctx = canvas.getContext("2d");

          ctx.drawImage(
            img,
            colStartPx,
            rowStartPx,
            colWidth,
            actualStripHeight,
            0,
            0,
            colWidth,
            actualStripHeight,
          );

          sections.push({
            dataUrl: canvas.toDataURL("image/jpeg", 0.85),
            sectionIndex: sectionIndex,
            col: col,
            row: row,
            bounds: {
              xStart: colStartPct,
              xEnd: colEndPct,
              yStart: (rowStartPx / img.height) * 100,
              yEnd: (rowEndPx / img.height) * 100,
            },
            originalWidth: img.width,
            originalHeight: img.height,
            sectionWidth: colWidth,
            sectionHeight: actualStripHeight,
          });

          sectionIndex++;
        }
      }

      console.log(
        `[splitImageIntoSections] Created ${sections.length} sections (${numCols} cols x ${horizontalStrips} rows) from ${img.width}x${img.height} image`,
      );
      resolve(sections);
    };

    img.onerror = () =>
      reject(new Error("Failed to load image for section splitting"));
    img.src = imageDataUrl;
  });
}
