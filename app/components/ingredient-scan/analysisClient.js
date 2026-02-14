import { loadScript } from "../../runtime/scriptLoader";
import { analyzeAllergensWithLabelCropper } from "../../lib/ingredientAllergenAnalysis";

const OPENCV_URL = "https://docs.opencv.org/4.5.2/opencv.js";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function asText(value) {
  return String(value ?? "").trim();
}

export async function ensureOpenCv() {
  if (typeof window === "undefined") return false;
  try {
    await loadScript(OPENCV_URL);
    return true;
  } catch {
    return false;
  }
}

async function waitForOpenCvReady(timeoutMs = 2200) {
  if (typeof window === "undefined" || typeof window.cv === "undefined") {
    return false;
  }
  if (window.cv?.Mat) return true;

  return await new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(Boolean(window.cv?.Mat));
      }
    }, timeoutMs);

    window.cv.onRuntimeInitialized = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(true);
    };
  });
}

export async function rotateImage(dataUrl, angleDegrees) {
  if (!dataUrl) return "";
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const radians = (angleDegrees * Math.PI) / 180;
        const sin = Math.abs(Math.sin(radians));
        const cos = Math.abs(Math.cos(radians));
        const newWidth = Math.ceil(image.width * cos + image.height * sin);
        const newHeight = Math.ceil(image.width * sin + image.height * cos);

        const canvas = document.createElement("canvas");
        canvas.width = newWidth;
        canvas.height = newHeight;

        const ctx = canvas.getContext("2d");
        ctx.translate(newWidth / 2, newHeight / 2);
        ctx.rotate(radians);
        ctx.drawImage(image, -image.width / 2, -image.height / 2);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = reject;
    image.src = dataUrl;
  });
}

export async function detectSlantAngle(imageDataUrl) {
  const hasOpenCv = await ensureOpenCv();
  if (!hasOpenCv) return 0;

  const ready = await waitForOpenCvReady();
  if (!ready) return 0;

  return await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const maxDimension = 800;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const width = Math.round(image.width * scale);
        const height = Math.round(image.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, width, height);

        const src = window.cv.imread(canvas);
        const gray = new window.cv.Mat();
        window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY);

        const centerX = Math.floor(width / 2);
        const centerY = Math.floor(height / 2);
        const roiW = Math.floor(width * 0.6);
        const roiH = Math.floor(height * 0.6);
        const roiX = centerX - Math.floor(roiW / 2);
        const roiY = centerY - Math.floor(roiH / 2);

        const roi = gray.roi(new window.cv.Rect(roiX, roiY, roiW, roiH));
        const thresh = new window.cv.Mat();
        window.cv.adaptiveThreshold(
          roi,
          thresh,
          255,
          window.cv.ADAPTIVE_THRESH_GAUSSIAN_C,
          window.cv.THRESH_BINARY_INV,
          15,
          10,
        );

        const lines = new window.cv.Mat();
        window.cv.HoughLinesP(
          thresh,
          lines,
          1,
          Math.PI / 180,
          50,
          60,
          10,
        );

        const angles = [];
        for (let i = 0; i < lines.rows; i += 1) {
          const x1 = lines.data32S[i * 4 + 0];
          const y1 = lines.data32S[i * 4 + 1];
          const x2 = lines.data32S[i * 4 + 2];
          const y2 = lines.data32S[i * 4 + 3];
          let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
          if (angle > 90) angle -= 180;
          if (angle < -90) angle += 180;
          if (Math.abs(angle) < 30) angles.push(angle);
        }

        src.delete();
        gray.delete();
        roi.delete();
        thresh.delete();
        lines.delete();

        if (!angles.length) {
          resolve(0);
          return;
        }

        angles.sort((a, b) => a - b);
        const median = angles[Math.floor(angles.length / 2)];
        resolve(-median);
      } catch {
        resolve(0);
      }
    };

    image.onerror = () => resolve(0);
    image.src = imageDataUrl;
  });
}

export async function prepareAnalysisImage(imageDataUrl, maxEdge = 1200, quality = 0.92) {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const sourceWidth = Math.max(1, Math.round(image.naturalWidth || image.width || 0));
        const sourceHeight = Math.max(1, Math.round(image.naturalHeight || image.height || 0));
        const edgeLimit = Number.isFinite(Number(maxEdge)) && Number(maxEdge) > 0
          ? Number(maxEdge)
          : 1200;
        const scale = Math.min(1, edgeLimit / Math.max(sourceWidth, sourceHeight));
        const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
        const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

        if (targetWidth === sourceWidth && targetHeight === sourceHeight) {
          resolve({
            imageData: imageDataUrl,
            imageWidth: sourceWidth,
            imageHeight: sourceHeight,
          });
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, targetWidth, targetHeight);

        resolve({
          imageData: canvas.toDataURL("image/jpeg", quality),
          imageWidth: targetWidth,
          imageHeight: targetHeight,
        });
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = reject;
    image.src = imageDataUrl;
  });
}

async function analyzeWithPhotoRoute(imageDataUrl, imageMeta = {}) {
  const payload = {
    imageData: imageDataUrl,
    mode: "full-analysis",
  };

  const imageWidth = Number(imageMeta?.imageWidth);
  const imageHeight = Number(imageMeta?.imageHeight);
  if (Number.isFinite(imageWidth) && imageWidth > 0) {
    payload.imageWidth = imageWidth;
  }
  if (Number.isFinite(imageHeight) && imageHeight > 0) {
    payload.imageHeight = imageHeight;
  }

  const response = await fetch("/api/ingredient-photo-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text();
  let parsed = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new Error(
      asText(parsed?.error) || asText(parsed?.message) || "Failed to analyze ingredient image.",
    );
  }

  return parsed || {};
}

export async function analyzeFrontProductName(imageDataUrl) {
  const response = await fetch("/api/ingredient-photo-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageData: imageDataUrl,
      mode: "front-analysis",
    }),
  });

  const bodyText = await response.text();
  let parsed = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok || parsed?.success === false) {
    const error = new Error(
      asText(parsed?.error) ||
        asText(parsed?.message) ||
        "Front image analysis is unavailable.",
    );
    error.status = response.status;
    throw error;
  }

  return {
    productName: asText(parsed?.productName),
    confidence: asText(parsed?.confidence).toLowerCase() || "low",
  };
}

export async function analyzeTranscriptFlags(transcriptLines) {
  const result = await analyzeAllergensWithLabelCropper(transcriptLines);
  if (!result?.success) {
    const message =
      asText(result?.error) || "Ingredient allergen analysis failed.";
    throw new Error(message);
  }
  return Array.isArray(result?.data?.flags) ? result.data.flags : [];
}

export async function analyzeIngredientLabelImage(
  imageDataUrl,
  {
    onStatus,
    skipAllergenAnalysis = false,
    skipSlantCorrection = false,
  } = {},
) {
  onStatus?.(
    skipSlantCorrection ? "Preparing image..." : "Checking image orientation...",
  );

  let correctedImage = imageDataUrl;
  if (!skipSlantCorrection) {
    const slantAngle = await detectSlantAngle(imageDataUrl);
    if (Math.abs(slantAngle) > 1) {
      onStatus?.("Straightening image...");
      correctedImage = await rotateImage(imageDataUrl, slantAngle);
    }
  }

  onStatus?.("Preparing image...");
  const prepared = await prepareAnalysisImage(correctedImage, 1200, 0.92);

  onStatus?.("Analyzing ingredient image...");
  const photoResult = await analyzeWithPhotoRoute(prepared.imageData, {
    imageWidth: prepared.imageWidth,
    imageHeight: prepared.imageHeight,
  });

  if (!photoResult?.success) {
    const errorMessage =
      asText(photoResult?.error) || "Failed to extract ingredient lines.";
    const error = new Error(errorMessage);
    error.quality = photoResult?.quality || null;
    throw error;
  }

  const lines = Array.isArray(photoResult?.data) ? photoResult.data : [];
  if (!lines.length) {
    throw new Error("No ingredient lines detected.");
  }

  const transcript = lines.map((line) => asText(line?.text)).filter(Boolean);

  onStatus?.("Analyzing ingredients");
  let allergenFlags = [];
  if (!skipAllergenAnalysis) {
    allergenFlags = await analyzeTranscriptFlags(transcript);
  }

  return {
    lines,
    transcript,
    allergenFlags,
    correctedImage: prepared.imageData,
    quality: photoResult?.quality || null,
    allergenAnalysisPending: skipAllergenAnalysis,
  };
}

export function buildWordLayout(line) {
  const text = asText(line?.text);
  const tokens = text.split(/\s+/).filter(Boolean);
  const crop = line?.crop_coordinates || {};
  const cropStart = Number(crop?.x_start);
  const cropEnd = Number(crop?.x_end);
  const cropSpan = Math.max(1, cropEnd - cropStart);

  const visionWords = Array.isArray(line?.words) ? line.words : [];
  const used = new Set();

  return tokens.map((token, tokenIndex) => {
    const cleanToken = token.toLowerCase().replace(/[^a-z0-9]/g, "");
    let bestIndex = -1;
    let bestScore = 0;

    visionWords.forEach((word, wordIndex) => {
      if (used.has(wordIndex)) return;
      const cleanWord = asText(word?.text).toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!cleanWord || !cleanToken) return;

      let score = 0;
      if (cleanWord === cleanToken) score = 100;
      else if (cleanWord.includes(cleanToken) || cleanToken.includes(cleanWord)) {
        const minLen = Math.min(cleanWord.length, cleanToken.length);
        const maxLen = Math.max(cleanWord.length, cleanToken.length);
        if (minLen / Math.max(maxLen, 1) >= 0.65) {
          score = 80;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestIndex = wordIndex;
      }
    });

    if (bestIndex >= 0) {
      used.add(bestIndex);
      const matched = visionWords[bestIndex];
      const center = (Number(matched?.x_start) + Number(matched?.x_end)) / 2;
      return {
        text: token,
        centerPct: clamp(((center - cropStart) / cropSpan) * 100, 0, 100),
      };
    }

    const fallbackCenter = ((tokenIndex + 0.5) / tokens.length) * 100;
    return {
      text: token,
      centerPct: clamp(fallbackCenter, 0, 100),
    };
  });
}

export function rebuildLineWordBoxes(line, nextText) {
  const crop = line?.crop_coordinates || {};
  const xStart = Number(crop?.x_start);
  const xEnd = Number(crop?.x_end);
  const yStart = Number(crop?.y_start);
  const yEnd = Number(crop?.y_end);

  const tokens = asText(nextText).split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return [];
  }

  const span = Math.max(1, xEnd - xStart);
  const step = span / tokens.length;

  return tokens.map((token, index) => {
    const start = xStart + step * index;
    const end = index === tokens.length - 1 ? xEnd : start + Math.max(step - 0.2, 0.2);
    return {
      text: token,
      x_start: clamp(start, xStart, xEnd),
      x_end: clamp(end, xStart, xEnd),
      y_start: yStart,
      y_end: yEnd,
    };
  });
}
