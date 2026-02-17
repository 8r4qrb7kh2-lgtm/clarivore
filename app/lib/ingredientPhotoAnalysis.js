import { analyzeAllergensWithLabelCropper } from "./ingredientAllergenAnalysis.js";
import { createIngredientNormalizer } from "./ingredientNormalizer.js";

export function initIngredientPhotoAnalysis(deps = {}) {
  const esc =
    typeof deps.esc === "function" ? deps.esc : (value) => String(value ?? "");
  const asText = (value) => String(value ?? "").trim();
  const state = deps.state || {};
  const aiAssistState = deps.aiAssistState || {};
  const activePhotoAnalyses = deps.activePhotoAnalyses || new Map();
  const collectAiTableData =
    typeof deps.collectAiTableData === "function"
      ? deps.collectAiTableData
      : () => [];
  const renderAiTable =
    typeof deps.renderAiTable === "function" ? deps.renderAiTable : () => {};
  const aiAssistSetStatus =
    typeof deps.aiAssistSetStatus === "function"
      ? deps.aiAssistSetStatus
      : () => {};
  const ensureAiAssistElements =
    typeof deps.ensureAiAssistElements === "function"
      ? deps.ensureAiAssistElements
      : () => {};
  const normalizeDietLabel =
    typeof deps.normalizeDietLabel === "function"
      ? deps.normalizeDietLabel
      : (value) => {
          const raw = String(value ?? "").trim();
          if (!raw) return "";
          if (!DIETS.length) return raw;
          return DIETS.includes(raw) ? raw : "";
        };
  const compressImage =
    typeof deps.compressImage === "function"
      ? deps.compressImage
      : async () => "";
  const getIssueReportMeta =
    typeof deps.getIssueReportMeta === "function"
      ? deps.getIssueReportMeta
      : () => ({});
  const ALLERGENS = Array.isArray(deps.ALLERGENS) ? deps.ALLERGENS : [];
  const DIETS = Array.isArray(deps.DIETS) ? deps.DIETS : [];
  const normalizeAllergen =
    typeof deps.normalizeAllergen === "function"
      ? deps.normalizeAllergen
      : (value) => {
          const raw = String(value || "").trim();
          if (!raw) return "";
          if (!ALLERGENS.length) return raw;
          return ALLERGENS.includes(raw) ? raw : "";
        };
  const formatAllergenLabel =
    typeof deps.formatAllergenLabel === "function"
      ? deps.formatAllergenLabel
      : (value) => {
          const resolved = normalizeAllergen(value);
          if (!resolved) return String(value || "");
          return resolved
            .split(" ")
            .map((part) =>
              part ? part.charAt(0).toUpperCase() + part.slice(1) : "",
            )
            .join(" ");
        };
  const getDietAllergenConflicts =
    typeof deps.getDietAllergenConflicts === "function"
      ? deps.getDietAllergenConflicts
      : () => [];
  const ingredientNormalizer = createIngredientNormalizer({
    normalizeAllergen,
    normalizeDietLabel,
    ALLERGENS,
    DIETS,
  });
  // Rotate an image by the given angle (in degrees) - from slant-corrector
  // Kept as standalone utility for future use
  function rotateImage(imgSrc, angleDegrees) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const angleRad = (angleDegrees * Math.PI) / 180;

        // Calculate new canvas size to fit rotated image
        const sin = Math.abs(Math.sin(angleRad));
        const cos = Math.abs(Math.cos(angleRad));
        const newWidth = Math.ceil(img.width * cos + img.height * sin);
        const newHeight = Math.ceil(img.width * sin + img.height * cos);

        canvas.width = newWidth;
        canvas.height = newHeight;

        // Move to center, rotate, then draw image centered
        ctx.translate(newWidth / 2, newHeight / 2);
        ctx.rotate(angleRad);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);

        resolve(canvas.toDataURL("image/jpeg", 0.92));
      };
      img.onerror = reject;
      img.src = imgSrc;
    });
  }

  async function prepareIngredientAnalysisImage(
    imageDataUrl,
    maxEdge = 1200,
    quality = 0.92,
  ) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const sourceWidth = Math.max(
          1,
          Math.round(img.naturalWidth || img.width || 0),
        );
        const sourceHeight = Math.max(
          1,
          Math.round(img.naturalHeight || img.height || 0),
        );
        const edgeLimit =
          Number.isFinite(Number(maxEdge)) && Number(maxEdge) > 0
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
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        resolve({
          imageData: canvas.toDataURL("image/jpeg", quality),
          imageWidth: targetWidth,
          imageHeight: targetHeight,
        });
      };
      img.onerror = reject;
      img.src = imageDataUrl;
    });
  }

  async function waitForOpenCvReady(timeoutMs = 2000) {
    if (typeof cv === "undefined") return false;
    if (cv.Mat) return true;
    return new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(!!cv.Mat);
        }
      }, timeoutMs);
      cv.onRuntimeInitialized = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve(true);
      };
    });
  }

  // Detect slant angle using OpenCV Hough Line Transform
  // Uses ROI (center 60%) and adaptive thresholding to focus on text lines
  async function detectSlantAngle(imageDataUrl) {
    const ready = await waitForOpenCvReady();
    if (!ready) {
      console.warn("OpenCV not ready, skipping slant detection");
      return 0;
    }

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          // Scale down for performance (like Python's 800px max)
          const maxDim = 800;
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);

          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);

          const src = cv.imread(canvas);
          const gray = new cv.Mat();

          // Convert to grayscale
          cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

          // Extract center 60% ROI to focus on text and avoid background noise
          const cx = Math.floor(w / 2);
          const cy = Math.floor(h / 2);
          const roiW = Math.floor(w * 0.6);
          const roiH = Math.floor(h * 0.6);
          const roiX = cx - Math.floor(roiW / 2);
          const roiY = cy - Math.floor(roiH / 2);

          const roi = gray.roi(new cv.Rect(roiX, roiY, roiW, roiH));

          // Use adaptive thresholding instead of Canny (better for text detection)
          const thresh = new cv.Mat();
          cv.adaptiveThreshold(
            roi,
            thresh,
            255,
            cv.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv.THRESH_BINARY_INV,
            51,
            10,
          );

          // Detect lines using Hough Transform
          const lines = new cv.Mat();
          cv.HoughLinesP(thresh, lines, 1, Math.PI / 180, 50, 50, 10);

          const angles = [];

          for (let i = 0; i < lines.rows; i++) {
            const x1 = lines.data32S[i * 4];
            const y1 = lines.data32S[i * 4 + 1];
            const x2 = lines.data32S[i * 4 + 2];
            const y2 = lines.data32S[i * 4 + 3];

            // Calculate angle in degrees
            let angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);

            // Normalize angle to [-90, 90] range
            if (angle > 90) angle -= 180;
            if (angle < -90) angle += 180;

            // Only consider near-horizontal lines (text lines)
            if (Math.abs(angle) < 30) {
              angles.push(angle);
            }
          }

          // Clean up
          src.delete();
          gray.delete();
          roi.delete();
          thresh.delete();
          lines.delete();

          if (angles.length === 0) {
            console.log("No text lines detected for slant correction");
            resolve(0);
            return;
          }

          // Use median angle (robust against outliers)
          angles.sort((a, b) => a - b);
          const medianAngle = angles[Math.floor(angles.length / 2)];

          // Debug output
          const positiveCount = angles.filter((a) => a > 0).length;
          const negativeCount = angles.filter((a) => a < 0).length;
          console.log(
            `Slant detection: ${angles.length} lines, ${positiveCount} positive, ${negativeCount} negative`,
          );
          console.log(`Median slant angle: ${medianAngle.toFixed(2)}°`);

          // Return correction angle (negative of detected slant)
          resolve(-medianAngle);
        } catch (err) {
          console.error("Slant detection error:", err);
          resolve(0);
        }
      };
      img.onerror = () => resolve(0);
      img.src = imageDataUrl;
    });
  }

  // Claude API call helper
  async function callClaudeForAnalysis(
    messages,
    systemPrompt = "",
    options = {},
  ) {
    void messages;
    void systemPrompt;
    void options;
    throw new Error(
      "Direct browser AI calls are disabled. Use /api/ingredient-photo-analysis.",
    );
  }

  // Step 1: Get Claude's transcription of the image
  async function getClaudeTranscription(imageBase64, mediaType) {
    const systemPrompt = `You are an OCR assistant. Your job is to accurately transcribe text from images of ingredient lists or food labels.

  Output ONLY a JSON array where each element represents one visual line of text as it appears in the image.
  Each line should be the exact text content, preserving the original line breaks as they appear visually.

  Example output format:
  ["INGREDIENTS: Almonds, Dark Chocolate", "(chocolate liquor, cane sugar, cocoa butter,", "vanilla). Organic Coconut.", "CONTAINS: Tree nuts"]

  Rules:
  - Each array element = one visual line from the image
  - Preserve exact spelling and punctuation
  - Include ONLY text related to: ingredients, allergen information, allergy warnings, dietary claims
  - EXCLUDE: company names, addresses, phone numbers, websites, UPC codes, weight/volume, nutrition facts, logos, brand names, origin info, or anything else like that
  - Do not combine multiple visual lines into one
  - Do not split one visual line into multiple entries
  - Output ONLY the JSON array, no other text`;

    const response = await callClaudeForAnalysis(
      [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType || "image/png",
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: "Transcribe each line of text from this ingredient label. Return as a JSON array with one element per visual line.",
            },
          ],
        },
      ],
      systemPrompt,
    );

    // Parse JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("Could not parse Claude transcription response");
    }
    return JSON.parse(jsonMatch[0]);
  }

  function normalizeQualityAssessment(raw) {
    const acceptRaw = raw?.accept;
    const needsRetake = raw?.needs_retake === true;
    let accept =
      acceptRaw === false || acceptRaw === "false" || needsRetake ? false : true;
    let confidence =
      typeof raw?.confidence === "string" ? raw.confidence.toLowerCase() : null;
    if (!["low", "medium", "high"].includes(confidence || "")) {
      confidence = null;
    }
    const reasons = Array.isArray(raw?.reasons)
      ? raw.reasons
          .map((r) => String(r || "").trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    const warnings = Array.isArray(raw?.warnings)
      ? raw.warnings
          .map((w) => String(w || "").trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    let message = typeof raw?.message === "string" ? raw.message.trim() : "";

    if (accept && confidence !== "high") {
      accept = false;
      if (!reasons.length) {
        reasons.push("quality confidence not high");
      }
    }

    if (!accept && !message) {
      const issueText = reasons.length ? ` Issues: ${reasons.join("; ")}.` : "";
      message =
        "Photo quality is too low to read the ingredients confidently." +
        issueText +
        " Please retake the photo: fill the frame with the full ingredient list, keep it in focus, and avoid glare or shadows.";
    }

    const warningMessage = warnings.length
      ? `Warning: ${warnings.join("; ")}. Consider retaking the photo for best results.`
      : "";

    return {
      accept,
      confidence,
      reasons,
      warnings,
      message,
      warningMessage,
    };
  }

  async function getClaudeQualityAssessment(
    imageBase64,
    mediaType,
    claudeLines,
  ) {
    const systemPrompt = `You are a quality-control assistant for ingredient-label photos.

Your job is to decide whether the image is readable enough to confidently extract the COMPLETE ingredient list.

Decide "accept": false if any of these are true:
- The ingredient list is cut off or missing parts
- Text is blurry, out of focus, or too small to read
- Glare, shadows, or distortion makes parts unreadable
- The image does not clearly show an ingredient list
- Any portion of the ingredient list is obscured, scribbled over, or partially blocked

Be strict. Accept only if you can read the full ingredient list end-to-end with high confidence.
If you are not highly confident the list is complete and legible, set "accept": false.
Only set "accept": true when "confidence" is "high".

Return ONLY valid JSON with this schema:
{
  "accept": true|false,
  "confidence": "low"|"medium"|"high",
  "reasons": ["short reason phrases if reject"],
  "warnings": ["short warning phrases if accept but imperfect"],
  "message": "short user-facing sentence if reject"
}

Notes:
- Use the IMAGE as the source of truth.
- The transcript may be incomplete or inaccurate; use it only as a hint.`;

    const transcriptText = Array.isArray(claudeLines)
      ? claudeLines.join("\n")
      : "";

    const response = await callClaudeForAnalysis(
      [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType || "image/png",
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: `Assess photo quality for ingredient-list readability.\n\nTranscript (may be inaccurate):\n${transcriptText}`,
            },
          ],
        },
      ],
      systemPrompt,
    );

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not parse Claude quality response");
    }
    return normalizeQualityAssessment(JSON.parse(jsonMatch[0]));
  }

  // Step 2: Run Google Cloud Vision to get word bounding boxes
  async function getVisionWords(imageBase64) {
    void imageBase64;
    throw new Error(
      "Direct browser OCR calls are disabled. Use /api/ingredient-photo-analysis.",
    );
  }

  // Step 3: Use Claude to match transcript lines to visual lines
  async function matchLinesToVisualLines(claudeLines, visualLines) {
    const systemPrompt = `You are a text matching assistant. You will receive:
  1. Transcript lines - accurate text from Claude's reading of the image
  2. Visual lines - OCR-detected text grouped by position (may have errors/typos)

  Your job is to match each transcript line to the visual line that represents the same text.

  Output a JSON object where:
  - Keys are transcript line indices (0, 1, 2, etc.)
  - Values are the corresponding visual line index

  Rules:
  - Match based on text similarity (the visual line text may have OCR errors)
  - Each transcript line should match to exactly ONE visual line
  - If a transcript line has no good match, use -1
  - Visual lines may be unused (they might be addresses, nutrition info, etc.)

  Example output:
  {"0": 5, "1": 6, "2": 7, "3": 8, "4": -1}

  Output ONLY the JSON object, nothing else.`;

    const transcriptDesc = claudeLines
      .map((line, i) => `Transcript ${i}: "${line}"`)
      .join("\n");
    const visualDesc = visualLines
      .map((vl, i) => `Visual ${i}: "${vl.text}"`)
      .join("\n");

    const response = await callClaudeForAnalysis(
      [
        {
          role: "user",
          content: `Match each transcript line to its corresponding visual line.\n\nTRANSCRIPT LINES:\n${transcriptDesc}\n\nVISUAL LINES:\n${visualDesc}\n\nReturn a JSON object mapping transcript indices to visual line indices.`,
        },
      ],
      systemPrompt,
    );

    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      throw new Error("Could not parse line matching response");
    }
    return JSON.parse(jsonMatch[0]);
  }

  // Step 4: Find missing words and build final line data
  function findMissingWordsAndBuildLines(
    claudeLines,
    visualLines,
    lineMapping,
    visionWords,
  ) {
    // Helper function to check if a word matches any word in the transcript
    function wordMatchesTranscript(wordText, transcriptText) {
      const cleanWord = wordText.toLowerCase().replace(/[.,;:!?()[\]{}'"]/g, "");
      if (cleanWord.length === 0) return false;

      const transcriptWords = transcriptText
        .toLowerCase()
        .split(/[\s,.:;()\[\]]+/)
        .filter((w) => w.length > 0);

      return transcriptWords.some(
        (tw) =>
          tw === cleanWord ||
          (cleanWord.length > 2 &&
            tw.includes(cleanWord) &&
            cleanWord.length >= tw.length * 0.7) ||
          (tw.length > 2 &&
            cleanWord.includes(tw) &&
            tw.length >= cleanWord.length * 0.7),
      );
    }

    const lines = [];

    for (let i = 0; i < claudeLines.length; i++) {
      const visualIdx = lineMapping[i.toString()];
      if (
        visualIdx === undefined ||
        visualIdx === -1 ||
        visualIdx >= visualLines.length
      )
        continue;

      const vl = visualLines[visualIdx];
      const transcriptText = claudeLines[i];

      // Filter words to only those that match whole words in Claude's transcript
      let matchingWords = vl.words.filter((w) =>
        wordMatchesTranscript(w.text, transcriptText),
      );

      // Find missing words from transcript - count occurrences to handle duplicates like "organic organic"
      const transcriptWords = transcriptText
        .toLowerCase()
        .split(/[\s,.:;()\[\]]+/)
        .filter((w) => w.length > 1);

      // Count how many times each word appears in transcript
      const transcriptWordCounts = {};
      transcriptWords.forEach((tw) => {
        transcriptWordCounts[tw] = (transcriptWordCounts[tw] || 0) + 1;
      });

      // Count how many times each word was matched
      const matchedWordCounts = {};
      matchingWords.forEach((w) => {
        const clean = w.text.toLowerCase().replace(/[.,;:!?()[\]{}'"]/g, "");
        matchedWordCounts[clean] = (matchedWordCounts[clean] || 0) + 1;
      });

      // Build list of missing words (including duplicates we need to find)
      const missingWords = [];
      for (const [word, neededCount] of Object.entries(transcriptWordCounts)) {
        const matchedCount = matchedWordCounts[word] || 0;
        const missing = neededCount - matchedCount;
        for (let i = 0; i < missing; i++) {
          missingWords.push(word);
        }
      }

      const usedBboxes = new Set(
        matchingWords.map((w) => `${w.bbox.x0},${w.bbox.y0}`),
      );

      // Use visual line's Y bounds as reference for acceptable Y range
      const vlYMin = Math.min(...vl.words.map((w) => w.bbox.y0));
      const vlYMax = Math.max(...vl.words.map((w) => w.bbox.y1));
      const vlHeight = vlYMax - vlYMin;
      const yTolerance = vlHeight * 0.5; // Allow 50% of line height as tolerance

      for (const missingWord of missingWords) {
        const matches = visionWords.filter((w) => {
          const wTextClean = w.text
            .toLowerCase()
            .replace(/[.,;:!?()[\]{}'"]/g, "");
          const bboxKey = `${w.bbox.x0},${w.bbox.y0}`;
          const isExactMatch = wTextClean === missingWord;
          const isCloseMatch =
            wTextClean.length > 2 &&
            missingWord.length > 2 &&
            ((wTextClean.includes(missingWord) &&
              missingWord.length >= wTextClean.length * 0.7) ||
              (missingWord.includes(wTextClean) &&
                wTextClean.length >= missingWord.length * 0.7));
          const notUsed = !usedBboxes.has(bboxKey);
          // Check if word is within the visual line's Y range (with tolerance)
          const withinYRange =
            w.centerY >= vlYMin - yTolerance && w.centerY <= vlYMax + yTolerance;
          return (isExactMatch || isCloseMatch) && notUsed && withinYRange;
        });

        if (matches.length > 0) {
          const avgY =
            matchingWords.length > 0
              ? matchingWords.reduce((sum, w) => sum + w.centerY, 0) /
                matchingWords.length
              : (vlYMin + vlYMax) / 2;

          matches.sort(
            (a, b) => Math.abs(a.centerY - avgY) - Math.abs(b.centerY - avgY),
          );
          const bestMatch = matches[0];

          // Tighter check: only accept if within line height of the average Y
          if (Math.abs(bestMatch.centerY - avgY) < vlHeight * 1.5) {
            matchingWords.push(bestMatch);
            usedBboxes.add(`${bestMatch.bbox.x0},${bestMatch.bbox.y0}`);
          }
        }
      }

      const wordsForBbox = matchingWords.length > 0 ? matchingWords : vl.words;

      const x0 = Math.min(...wordsForBbox.map((w) => w.bbox.x0));
      const y0 = Math.min(...wordsForBbox.map((w) => w.bbox.y0));
      const x1 = Math.max(...wordsForBbox.map((w) => w.bbox.x1));
      const y1 = Math.max(...wordsForBbox.map((w) => w.bbox.y1));

      lines.push({
        text: claudeLines[i],
        bbox: { x0, y0, x1, y1 },
        words: matchingWords,
      });
    }

    return lines;
  }
  // Main analysis function via Next.js runtime endpoint.
  async function analyzeWithLabelCropper(imageDataUrl, onStatus, imageMeta = {}) {
    onStatus?.("Analyzing ingredient image...");
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
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const responsePayload = await response.json();
    if (!response.ok) {
      return {
        success: false,
        error: responsePayload?.error || "Failed to analyze ingredient image.",
        quality: responsePayload?.quality || null,
      };
    }

    return {
      success: Boolean(responsePayload?.success),
      data: Array.isArray(responsePayload?.data) ? responsePayload.data : [],
      claude_transcript: Array.isArray(responsePayload?.claude_transcript)
        ? responsePayload.claude_transcript
        : [],
      quality: responsePayload?.quality || null,
      error: responsePayload?.error || "",
    };
  }

  // Full ingredient photo analysis pipeline:
  // 1. Apply slant correction (rotateImage)
  // 2. Resize to bounded dimensions and analyze extracted lines/bounding boxes
  // 3. Analyze allergens
  // Returns: { lines: [...], allergenFlags: [...], correctedImage: dataUrl }
  async function analyzeIngredientPhoto(imageDataUrl, onStatus, options = {}) {
    const skipAllergenAnalysis = options && options.skipAllergenAnalysis === true;
    const skipSlantCorrection = options && options.skipSlantCorrection === true;
    onStatus?.(
      skipSlantCorrection ? "Preparing image..." : "Checking image orientation...",
    );

    // Step 1: Detect and correct slant angle
    let correctedImage = imageDataUrl;
    if (!skipSlantCorrection) {
      const slantAngle = await detectSlantAngle(imageDataUrl);
      if (Math.abs(slantAngle) > 1) {
        onStatus?.("Straightening image...");
        correctedImage = await rotateImage(imageDataUrl, slantAngle);
      }
    }

    // Step 2: Use a bounded-size image for analysis/display so crop coordinates
    // and rendered image always share the same pixel space.
    const preparedImage = await prepareIngredientAnalysisImage(
      correctedImage,
      1200,
      0.92,
    );
    const analysisImageData = preparedImage.imageData;

    // Analyze lines (passes status updates)
    const analysisResult = await analyzeWithLabelCropper(
      analysisImageData,
      onStatus,
      {
        imageWidth: preparedImage.imageWidth,
        imageHeight: preparedImage.imageHeight,
      },
    );

    if (!analysisResult.success) {
      throw new Error(
        analysisResult.error || "Failed to extract ingredient lines",
      );
    }
    if (!analysisResult.data) {
      throw new Error("Failed to extract ingredient lines");
    }

    const lines = analysisResult.data;
    // Use exactly the same text that will be displayed under each cropped image
    // This ensures allergen word indices match the displayed words
    const transcript = lines.map((l) => l.text);

    onStatus?.("Analyzing ingredients");

    // Step 3: Analyze allergens
    let allergenFlags = [];
    if (!skipAllergenAnalysis) {
      const allergenResult = await analyzeAllergensWithLabelCropper(transcript);
      allergenFlags =
        allergenResult.success && allergenResult.data?.flags
          ? allergenResult.data.flags
          : [];
    }

    return {
      lines: lines,
      allergenFlags: allergenFlags,
      correctedImage: analysisImageData,
      transcript: transcript,
      allergenAnalysisPending: skipAllergenAnalysis,
      quality: analysisResult.quality,
    };
  }

  // Open brand identification choice modal
  function openBrandIdentificationChoice(rowIdx) {
    ensureAiAssistElements();
    const rows = collectAiTableData();
    if (!rows[rowIdx]) {
      aiAssistSetStatus("Select an ingredient first.", "warn");
      return;
    }

    const ingredientName = rows[rowIdx].name;
    if (!ingredientName) {
      aiAssistSetStatus(
        "Add an ingredient name before identifying a brand.",
        "warn",
      );
      return;
    }

    const brands = rows[rowIdx].brands || [];
    if (brands.length > 0) {
      aiAssistSetStatus(
        "An item has already been added for this ingredient. Remove it first if you want to add a different one.",
        "warn",
      );
      return;
    }
    showIngredientPhotoUploadModal(rowIdx, ingredientName, null);
  }

  // Show ingredient photo upload modal with label-cropper integration
  function showIngredientPhotoUploadModal(
    rowIdx,
    ingredientName,
    barcode,
    preloadedData = null,
    options = {},
  ) {
    ensureAiAssistElements();
    const inlineResults = options && options.inlineResults === true;
    const skipRowUpdates = options && options.skipRowUpdates === true;
    const onApplyResults =
      options && typeof options.onApplyResults === "function"
        ? options.onApplyResults
        : null;

    // Track state
    let capturedPhoto = null;
    let analysisResult = null;
    let mediaStream = null;
    let wordSpanMap = {}; // Maps global word index to span element
    let lineWordDataMap = {};
    let lineTextContainers = {};
    let activeWordEditor = null;
    let nextGlobalWordIndex = 0;
    let lineLayoutHandlers = [];
    let resizeHandler = null;
    let reanalysisRequestId = 0;
    let analysisOverlay = null;
    let analysisOverlayMessage = null;
    let analysisPending = false;

    // Create modal
    const photoModal = document.createElement("div");
    photoModal.id = "ingredientPhotoModal";
    photoModal.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.95);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
      padding-top: max(20px, env(safe-area-inset-top));
      padding-bottom: max(20px, env(safe-area-inset-bottom));
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
      overscroll-behavior: contain;
    `;

    photoModal.innerHTML = `
      <div style="width:100%;max-width:700px;display:flex;flex-direction:column;gap:16px">
        <div style="text-align:center">
          <h3 style="margin:0 0 8px 0;font-size:1.4rem;color:#fff">Capture Ingredient List</h3>
          <div style="margin:0;color:#a8b2d6;font-size:0.95rem">
            Ingredient: <strong style="color:#fff">${esc(ingredientName)}</strong>
          </div>
          <p id="photoInstructionText" style="margin:8px 0 0 0;color:#a8b2d6;font-size:0.9rem">
            Take a photo of the ingredient list on the product packaging
          </p>
        </div>

        <div style="position:relative;background:#000;border-radius:12px;overflow:hidden">
          <video id="ingredientCameraVideo" autoplay playsinline muted style="width:100%;max-height:50vh;display:none;object-fit:cover"></video>
          <canvas id="ingredientCameraCanvas" style="display:none"></canvas>
          <img id="ingredientPhotoPreview" style="width:100%;max-height:50vh;object-fit:contain;display:none" alt="Preview">
        </div>

        <div id="photoButtonsContainer" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button type="button" class="btn ingredientCameraBtn" style="background:#4c5ad4;padding:10px 20px">📷 Use Camera</button>
          <button type="button" class="btn ingredientUploadBtn" style="background:#4c5ad4;padding:10px 20px">📁 Upload Photo</button>
          <button type="button" class="btn ingredientCaptureBtn" style="background:#17663a;padding:10px 20px;display:none">📸 Capture</button>
          <button type="button" class="btn ingredientAnalyzeBtn" style="background:#17663a;padding:10px 20px;display:none">🔍 Analyze</button>
          <button type="button" class="btn ingredientCancelBtn" style="background:#ef4444;padding:10px 20px">Cancel</button>
          <input type="file" id="ingredientFileInput" accept="image/*" style="display:none">
        </div>

        <div id="photoStatusDiv" style="text-align:center;color:#a8b2d6;font-size:0.9rem;min-height:24px"></div>

        <!-- Full image with bounding boxes -->
        <div id="fullImageSection" style="display:none">
          <div style="background:rgba(76,90,212,0.1);border:1px solid rgba(76,90,212,0.3);border-radius:12px;padding:16px">
            <div style="font-weight:600;color:#fff;margin-bottom:12px">Detected Lines</div>
            <div id="fullImageContainer" style="position:relative;display:inline-block;width:100%"></div>
          </div>
        </div>

        <!-- Cropped lines display -->
        <div id="croppedLinesSection" style="display:none">
          <div style="background:rgba(76,90,212,0.1);border:1px solid rgba(76,90,212,0.3);border-radius:12px;padding:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <div style="font-weight:600;color:#fff">Extracted Ingredient Lines</div>
              <div id="confirmationStatus" style="font-size:0.85rem;color:#a8b2d6"></div>
            </div>
            <div style="margin-bottom:10px;color:#94a3b8;font-size:0.85rem">Tap a word to edit it. Tap between words to add missing text.</div>
            <div id="croppedLinesContainer" style="display:flex;flex-direction:column;gap:16px"></div>
          </div>
        </div>

        <!-- Allergen results display -->
        <div id="allergenResultsSection" style="display:none">
          <div style="background:rgba(76,90,212,0.1);border:1px solid rgba(76,90,212,0.3);border-radius:12px;padding:16px">
            <div style="font-weight:600;color:#fff;margin-bottom:12px">Allergen and Diet Analysis</div>
            <div id="allergenResultsContainer"></div>
          </div>
        </div>

        <!-- Apply button -->
        <div id="applyButtonContainer" style="display:none;justify-content:center;gap:12px;flex-wrap:wrap">
          <button type="button" class="btn applyResultsBtn" style="background:#17663a;padding:12px 24px;font-size:1rem">📷 Capture image of item front</button>
          <button type="button" class="btn retakePhotoBtn" style="background:#6b7280;padding:12px 24px">↩ Retake Photo</button>
          <button type="button" class="btn reportPhotoIssueBtn" style="background:#dc2626;padding:12px 24px">⚠️ Something's not right</button>
        </div>
      </div>
    `;

    document.body.appendChild(photoModal);

    // Get elements
    const video = photoModal.querySelector("#ingredientCameraVideo");
    const canvas = photoModal.querySelector("#ingredientCameraCanvas");
    const preview = photoModal.querySelector("#ingredientPhotoPreview");
    const statusDiv = photoModal.querySelector("#photoStatusDiv");
    const buttonsContainer = photoModal.querySelector("#photoButtonsContainer");
    const cameraBtn = photoModal.querySelector(".ingredientCameraBtn");
    const uploadBtn = photoModal.querySelector(".ingredientUploadBtn");
    const captureBtn = photoModal.querySelector(".ingredientCaptureBtn");
    const analyzeBtn = photoModal.querySelector(".ingredientAnalyzeBtn");
    const cancelBtn = photoModal.querySelector(".ingredientCancelBtn");
    const fileInput = photoModal.querySelector("#ingredientFileInput");
    const fullImageSection = photoModal.querySelector("#fullImageSection");
    const fullImageContainer = photoModal.querySelector("#fullImageContainer");
    const croppedLinesSection = photoModal.querySelector("#croppedLinesSection");
    const croppedLinesContainer = photoModal.querySelector(
      "#croppedLinesContainer",
    );
    const confirmationStatus = photoModal.querySelector("#confirmationStatus");
    const allergenResultsSection = photoModal.querySelector(
      "#allergenResultsSection",
    );
    const allergenResultsContainer = photoModal.querySelector(
      "#allergenResultsContainer",
    );
    const applyButtonContainer = photoModal.querySelector(
      "#applyButtonContainer",
    );
    const applyBtn = photoModal.querySelector(".applyResultsBtn");

    // Track line confirmations
    let lineConfirmations = {};
    let lineCardMap = {};
    let lineConfirmButtons = {};
    const retakeBtn = photoModal.querySelector(".retakePhotoBtn");
    const reportPhotoIssueBtn = photoModal.querySelector(".reportPhotoIssueBtn");

    const stopCamera = () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
      }
      video.srcObject = null;
    };

    const closeModal = () => {
      stopCamera();
      cancelPendingReanalysis();
      if (resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
        resizeHandler = null;
      }
      if (photoModal.parentNode) photoModal.remove();
    };

    const showButtons = (...btns) => {
      [cameraBtn, uploadBtn, captureBtn, analyzeBtn].forEach(
        (b) => (b.style.display = "none"),
      );
      btns.forEach((b) => (b.style.display = "inline-block"));
    };

    // Handle preloaded data (from "View Results" button)
    if (preloadedData && preloadedData.analysisResult) {
      analysisResult = preloadedData.analysisResult;
      capturedPhoto = preloadedData.originalPhoto;
      const correctedPreview = analysisResult.correctedImage || capturedPhoto;
      const pendingAnalysis =
        analysisResult.allergenAnalysisPending === true ||
        (!analysisResult.allergenFlags?.length &&
          analysisResult.allergenAnalysisPending !== false);

      // Show the original photo
      if (correctedPreview) {
        preview.src = correctedPreview;
        preview.style.display = "block";
      }

      // Display the cropped lines and allergen results
      displayCroppedLines(
        analysisResult.lines,
        correctedPreview || capturedPhoto,
        analysisResult.allergenFlags,
      );
      if (!pendingAnalysis) {
        displayAllergenResults(analysisResult.allergenFlags);
        statusDiv.textContent = "Allergen and diet analysis complete!";
        statusDiv.style.color = "#4ade80";
      } else {
        statusDiv.textContent =
          "Text extracted. Running allergen and diet analysis...";
        statusDiv.style.color = "#a8b2d6";
      }

      // Hide camera/upload buttons, show apply/retake buttons
      buttonsContainer.style.display = "none";
      applyButtonContainer.style.display = "flex";
    }

    // Camera button
    cameraBtn.addEventListener("click", async () => {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        video.srcObject = mediaStream;
        video.style.display = "block";
        preview.style.display = "none";
        showButtons(captureBtn);
      } catch (err) {
        statusDiv.textContent = "Camera access denied: " + err.message;
        statusDiv.style.color = "#ef4444";
      }
    });

    // Capture button
    captureBtn.addEventListener("click", () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      capturedPhoto = canvas.toDataURL("image/jpeg", 0.92);
      stopCamera();
      video.style.display = "none";
      preview.src = capturedPhoto;
      preview.style.display = "block";
      showButtons(analyzeBtn);
      statusDiv.textContent = "Photo captured. Click Analyze to process.";
      statusDiv.style.color = "#a8b2d6";
    });

    // Upload button
    uploadBtn.addEventListener("click", () => fileInput.click());

    // File input
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        // Normalize orientation using canvas
        const tempImg = new Image();
        tempImg.onload = () => {
          const c = document.createElement("canvas");
          c.width = tempImg.naturalWidth;
          c.height = tempImg.naturalHeight;
          c.getContext("2d").drawImage(tempImg, 0, 0);
          capturedPhoto = c.toDataURL("image/jpeg", 0.92);
          preview.src = capturedPhoto;
          preview.style.display = "block";
          video.style.display = "none";
          showButtons(analyzeBtn);
          statusDiv.textContent = "Photo loaded. Click Analyze to process.";
          fileInput.value = "";
        };
        tempImg.src = evt.target.result;
      };
      reader.readAsDataURL(file);
    });

    async function runInlineIngredientAnalysis(photoToAnalyze) {
      statusDiv.textContent = "Analyzing...";
      statusDiv.style.color = "#a8b2d6";
      try {
        const result = await analyzeIngredientPhoto(
          photoToAnalyze,
          (status) => {
            statusDiv.textContent = status;
          },
          { skipAllergenAnalysis: true },
        );
        analysisResult = result;
        const correctedPreview = result.correctedImage || photoToAnalyze;
        if (correctedPreview) {
          preview.src = correctedPreview;
          preview.style.display = "block";
        }
        displayCroppedLines(
          result.lines,
          correctedPreview || photoToAnalyze,
          result.allergenFlags,
        );
        const pendingAnalysis =
          result.allergenAnalysisPending === true ||
          (!result.allergenFlags?.length &&
            result.allergenAnalysisPending !== false);
        const qualityWarning = result.quality?.warningMessage;
        if (!pendingAnalysis) {
          displayAllergenResults(result.allergenFlags);
          statusDiv.textContent = qualityWarning
            ? `${qualityWarning} Allergen and diet analysis complete.`
            : "Allergen and diet analysis complete!";
          statusDiv.style.color = qualityWarning ? "#f59e0b" : "#4ade80";
          hideAnalysisOverlay();
        } else {
          statusDiv.textContent = qualityWarning
            ? `Text extracted. ${qualityWarning}`
            : "Text extracted. Running allergen and diet analysis...";
          statusDiv.style.color = qualityWarning ? "#f59e0b" : "#a8b2d6";
        }
        buttonsContainer.style.display = "none";
        applyButtonContainer.style.display = "flex";
      } catch (err) {
        console.error("Analysis error:", err);
        const msg = err?.message || "Unable to analyze the photo.";
        statusDiv.textContent = msg;
        statusDiv.style.color = "#ef4444";
        hideAnalysisOverlay();
      }
    }

    // Analyze button - closes modal immediately and runs analysis in background
    analyzeBtn.addEventListener("click", async () => {
      if (!capturedPhoto) return;

      const photoToAnalyze = capturedPhoto;

      if (inlineResults) {
        await runInlineIngredientAnalysis(photoToAnalyze);
        return;
      }

      // Close modal immediately and show loading bar on ingredient row
      closeModal();

      // Show loading bar on the ingredient row
      showPhotoAnalysisLoadingInRow(rowIdx, ingredientName);

      try {
        // Run analysis in background
        const result = await analyzeIngredientPhoto(
          photoToAnalyze,
          (status) => {
            updatePhotoAnalysisLoadingStatus(rowIdx, status);
          },
          { skipAllergenAnalysis: true, skipSlantCorrection: true },
        );

        // Show "View Results" button instead of auto-applying
        showPhotoAnalysisResultButton(
          rowIdx,
          ingredientName,
          result,
          photoToAnalyze,
        );
      } catch (err) {
        console.error("Analysis error:", err);
        const msg = err?.message || "Unable to analyze the photo.";
        updatePhotoAnalysisLoadingStatus(rowIdx, msg);
        setTimeout(() => hidePhotoAnalysisLoadingInRow(rowIdx), 2500);
        aiAssistSetStatus(msg, "error");
      }
    });

    // Display cropped lines with word highlighting
    // Helper to update confirmation status and Apply button
    function updateConfirmationUI(totalLines) {
      const confirmedCount = Object.values(lineConfirmations).filter(
        (v) => v,
      ).length;
      const allConfirmed = confirmedCount === totalLines;
      const readyToApply = allConfirmed && !analysisPending;

      confirmationStatus.textContent = `${confirmedCount}/${totalLines} lines confirmed`;
      confirmationStatus.style.color = allConfirmed ? "#22c55e" : "#f59e0b";

      if (readyToApply) {
        applyBtn.disabled = false;
        applyBtn.style.opacity = "1";
        applyBtn.style.cursor = "pointer";
      } else {
        applyBtn.disabled = true;
        applyBtn.style.opacity = "0.5";
        applyBtn.style.cursor = "not-allowed";
      }
    }

    function setLineConfirmationState(
      lineIdx,
      isConfirmed,
      totalLinesOverride = null,
    ) {
      lineConfirmations[lineIdx] = !!isConfirmed;
      const confirmBtn = lineConfirmButtons[lineIdx];
      const lineDiv = lineCardMap[lineIdx];
      if (confirmBtn) {
        if (isConfirmed) {
          confirmBtn.style.background = "#17663a";
          confirmBtn.style.borderColor = "#22c55e";
          confirmBtn.style.color = "#fff";
          confirmBtn.textContent = "✓ Confirmed";
        } else {
          confirmBtn.style.background = "#f59e0b";
          confirmBtn.style.borderColor = "#d97706";
          confirmBtn.style.color = "#fff";
          confirmBtn.textContent = "Confirm";
        }
      }
      if (lineDiv) {
        lineDiv.style.border = isConfirmed ? "2px solid #22c55e" : "none";
      }
      const totalLines =
        totalLinesOverride ??
        (analysisResult?.lines?.length || Object.keys(lineConfirmations).length);
      updateConfirmationUI(totalLines);
    }

    function refreshTranscriptFromWords() {
      if (!analysisResult || !Array.isArray(analysisResult.lines)) return [];
      const transcript = analysisResult.lines.map((line, idx) => {
        const words = lineWordDataMap[idx];
        if (Array.isArray(words) && words.length) {
          const updated = buildLineText(idx);
          line.text = updated;
          return updated;
        }
        return line.text || "";
      });
      analysisResult.transcript = transcript;
      return transcript;
    }

    function reindexWordData() {
      let globalIndex = 0;
      const lineIndices = Object.keys(lineWordDataMap)
        .map((key) => Number(key))
        .filter((key) => !Number.isNaN(key))
        .sort((a, b) => a - b);
      lineIndices.forEach((lineIdx) => {
        const wordData = lineWordDataMap[lineIdx] || [];
        const sorted = wordData
          .map((word, idx) => ({ word, idx }))
          .sort((a, b) => a.word.centerPct - b.word.centerPct || a.idx - b.idx);
        sorted.forEach((entry) => {
          entry.word.globalIndex = globalIndex++;
        });
      });
      nextGlobalWordIndex = globalIndex;
    }

    function ensureAnalysisOverlay() {
      if (analysisOverlay) return;
      const styleTag = document.createElement("style");
      styleTag.textContent =
        "@keyframes labelAnalysisSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }";
      photoModal.appendChild(styleTag);

      analysisOverlay = document.createElement("div");
      analysisOverlay.style.cssText = [
        "position: fixed",
        "inset: 0",
        "background: rgba(8, 12, 26, 0.72)",
        "z-index: 10020",
        "display: none",
        "align-items: center",
        "justify-content: center",
      ].join(";");

      analysisOverlay.innerHTML = `
        <div style="background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(148, 163, 184, 0.3); border-radius: 14px; padding: 20px 26px; display: flex; flex-direction: column; align-items: center; gap: 12px; color: #e2e8f0;">
          <div style="width: 38px; height: 38px; border-radius: 50%; border: 4px solid rgba(226,232,240,0.2); border-top-color: #e2e8f0; animation: labelAnalysisSpin 1s linear infinite;"></div>
          <div id="labelAnalysisOverlayMessage" style="font-size: 0.95rem; font-weight: 600;">Updating analysis...</div>
        </div>
      `;

      analysisOverlayMessage = analysisOverlay.querySelector(
        "#labelAnalysisOverlayMessage",
      );
      photoModal.appendChild(analysisOverlay);
    }

    function showAnalysisOverlay(message) {
      ensureAnalysisOverlay();
      if (analysisOverlayMessage) {
        analysisOverlayMessage.textContent = message || "Updating analysis...";
      }
      analysisOverlay.style.display = "flex";
    }

    function hideAnalysisOverlay() {
      if (analysisOverlay) {
        analysisOverlay.style.display = "none";
      }
    }

    function setAllergenResultsPending(message) {
      allergenResultsContainer.innerHTML = `<div style="color:#a8b2d6;padding:12px;">${esc(message || "Analyzing allergens...")}</div>`;
      allergenResultsSection.style.display = "block";
    }

    async function runAllergenReanalysis({
      showOverlay = false,
      statusMessage = "Updating analysis...",
    } = {}) {
      if (!analysisResult || !Array.isArray(analysisResult.lines)) return;
      const transcript = refreshTranscriptFromWords();
      if (!transcript.length) {
        analysisResult.allergenFlags = [];
        renderAllLineWords();
        displayAllergenResults([]);
        return;
      }

      const requestId = ++reanalysisRequestId;
      analysisPending = true;
      if (analysisResult) {
        analysisResult.allergenAnalysisPending = true;
      }
      updateConfirmationUI(transcript.length);
      setAllergenResultsPending(statusMessage);
      statusDiv.textContent = statusMessage;
      statusDiv.style.color = "#a8b2d6";
      if (showOverlay) showAnalysisOverlay(statusMessage);

      try {
        const result = await analyzeAllergensWithLabelCropper(transcript);
        if (requestId !== reanalysisRequestId) return;
        const flags =
          result.success && result.data?.flags ? result.data.flags : [];
        analysisResult.allergenFlags = flags;
        reindexWordData();
        renderAllLineWords();
        displayAllergenResults(flags);
        statusDiv.textContent = "Allergen and diet analysis complete!";
        statusDiv.style.color = "#4ade80";
      } catch (err) {
        if (requestId !== reanalysisRequestId) return;
        console.error("Allergen analysis failed:", err);
        statusDiv.textContent = "Analysis update failed. Using previous results.";
        statusDiv.style.color = "#f59e0b";
      } finally {
        if (requestId === reanalysisRequestId) {
          if (analysisResult) {
            analysisResult.allergenAnalysisPending = false;
          }
          analysisPending = false;
          updateConfirmationUI(transcript.length);
        }
        if (showOverlay) hideAnalysisOverlay();
      }
    }

    function cancelPendingReanalysis() {
      reanalysisRequestId += 1;
      analysisPending = false;
      hideAnalysisOverlay();
    }

    function handleLineWordsChanged(lineIdx) {
      setLineConfirmationState(lineIdx, false);
      refreshTranscriptFromWords();
      reindexWordData();
      analysisResult.allergenFlags = [];
      renderAllLineWords();
      runAllergenReanalysis({
        showOverlay: true,
        statusMessage: "Updating analysis...",
      });
    }

    function buildLineText(lineIdx) {
      const wordData = lineWordDataMap[lineIdx] || [];
      return wordData
        .map((word, idx) => ({ word, idx }))
        .sort((a, b) => a.word.centerPct - b.word.centerPct || a.idx - b.idx)
        .map((entry) => entry.word.text)
        .filter(Boolean)
        .join(" ")
        .trim();
    }

    function layoutLineWords(lineIdx) {
      const container = lineTextContainers[lineIdx];
      if (!container) return;
      const textDiv = container.textDiv;
      const wordData = lineWordDataMap[lineIdx] || [];
      const totalChars = wordData.reduce(
        (sum, word) => sum + (word.text ? word.text.length : 0),
        0,
      );
      const availableWidth = textDiv.clientWidth || 1;
      const baseFontSize = window.innerWidth < 600 ? 10 : 11;
      const computedSize = Math.floor(
        (availableWidth / Math.max(totalChars, 1)) * 1.6,
      );
      const fontSize = Math.max(6, Math.min(baseFontSize, computedSize));
      wordData.forEach((word, idx) => {
        const span = textDiv.querySelector(`span[data-word-idx="${idx}"]`);
        if (!span) return;
        span.style.left = `${word.centerPct}%`;
        span.style.transform = "translateX(-50%)";
        span.style.top = "0px";
        span.style.fontSize = `${fontSize}px`;
      });
      textDiv.style.height = `${Math.round(fontSize * 1.6)}px`;
    }

    function renderLineWords(lineIdx) {
      const container = lineTextContainers[lineIdx];
      if (!container) return;
      const textDiv = container.textDiv;
      const wordData = lineWordDataMap[lineIdx] || [];
      textDiv.innerHTML = "";
      wordData.forEach((word, idx) => {
        const span = document.createElement("span");
        span.textContent = word.text;
        span.dataset.globalIndex = word.globalIndex;
        span.dataset.wordIdx = idx;
        span.style.cssText =
          "position:absolute;color:#e2e8f0;white-space:nowrap;font-weight:500;cursor:text;";
        span.addEventListener("click", (event) => {
          event.stopPropagation();
          if (activeWordEditor) return;
          openWordEditor(lineIdx, idx, word.centerPct);
        });
        wordSpanMap[word.globalIndex] = span;
        textDiv.appendChild(span);
      });
      requestAnimationFrame(() => layoutLineWords(lineIdx));
    }

    function renderAllLineWords() {
      wordSpanMap = {};
      Object.keys(lineTextContainers).forEach((key) => {
        const lineIdx = Number(key);
        if (!Number.isNaN(lineIdx)) {
          renderLineWords(lineIdx);
        }
      });
      applyAllergenHighlighting(
        Array.isArray(analysisResult?.allergenFlags)
          ? analysisResult.allergenFlags
          : [],
      );
    }

    function openWordEditor(lineIdx, wordIdx = null, centerPct = 50) {
      const container = lineTextContainers[lineIdx];
      if (!container) return;
      const textDiv = container.textDiv;
      const safeCenter = Math.max(0, Math.min(100, centerPct));
      if (activeWordEditor) {
        return;
      }

      const editorWrap = document.createElement("div");
      editorWrap.style.cssText = [
        "position:absolute",
        "left:" + safeCenter + "%",
        "top:0",
        "transform:translateX(-50%)",
        "display:flex",
        "flex-direction:column",
        "align-items:center",
        "gap:6px",
        "z-index:3",
      ].join(";");
      editorWrap.addEventListener("click", (event) => event.stopPropagation());

      const originalRawText =
        wordIdx !== null ? lineWordDataMap[lineIdx]?.[wordIdx]?.text || "" : "";
      const hasTrailingComma = wordIdx !== null && originalRawText.endsWith(",");
      const editableText = hasTrailingComma
        ? originalRawText.slice(0, -1)
        : originalRawText;

      const input = document.createElement("input");
      input.type = "text";
      input.value = wordIdx !== null ? editableText : "";
      input.placeholder = wordIdx !== null ? "Edit word" : "Add word";
      input.style.cssText =
        "min-width:70px;max-width:160px;padding:4px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.7);background:#0b1020;color:#fff;font-size:12px;";
      input.addEventListener("click", (event) => event.stopPropagation());

      const actionRow = document.createElement("div");
      actionRow.style.cssText = "display:flex;gap:8px;";

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.textContent = "Save";
      saveBtn.style.cssText =
        "padding:4px 10px;border-radius:6px;border:none;background:#22c55e;color:#0b1020;font-size:11px;font-weight:700;cursor:pointer;";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = "Cancel";
      cancelBtn.style.cssText =
        "padding:4px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.6);background:transparent;color:#e2e8f0;font-size:11px;font-weight:600;cursor:pointer;";

      actionRow.appendChild(saveBtn);
      actionRow.appendChild(cancelBtn);
      editorWrap.appendChild(input);
      editorWrap.appendChild(actionRow);
      textDiv.appendChild(editorWrap);

      const originalPadding = textDiv.style.paddingBottom;
      textDiv.style.paddingBottom = "28px";

      const finish = (commit) => {
        if (!editorWrap.parentNode) return;
        const value = input.value.trim();
        editorWrap.remove();
        textDiv.style.paddingBottom = originalPadding;
        activeWordEditor = null;
        if (commit) {
          let didChange = false;
          if (wordIdx !== null) {
            const cleanedValue = value.replace(/,+$/, "");
            if (cleanedValue) {
              const nextText = hasTrailingComma
                ? `${cleanedValue},`
                : cleanedValue;
              if (nextText !== originalRawText) {
                lineWordDataMap[lineIdx][wordIdx].text = nextText;
                didChange = true;
              }
            }
          } else if (value) {
            lineWordDataMap[lineIdx].push({
              text: value,
              centerPct: safeCenter,
              hasPosition: true,
              globalIndex: nextGlobalWordIndex++,
            });
            didChange = true;
          }
          if (didChange) {
            handleLineWordsChanged(lineIdx);
          }
        }
      };

      saveBtn.addEventListener("click", () => finish(true));
      cancelBtn.addEventListener("click", () => finish(false));

      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      });

      activeWordEditor = { close: finish };
      input.focus();
      input.select();
    }

    function displayCroppedLines(lines, imageDataUrl, allergenFlags) {
      croppedLinesContainer.innerHTML = "";
      fullImageContainer.innerHTML = "";
      wordSpanMap = {};
      lineConfirmations = {};
      lineCardMap = {};
      lineConfirmButtons = {};
      lineWordDataMap = {};
      lineTextContainers = {};
      activeWordEditor = null;
      nextGlobalWordIndex = 0;
      analysisPending = false;
      let globalWordIndex = 0;
      lineLayoutHandlers = [];
      if (resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
        resizeHandler = null;
      }

      // Initialize confirmations for all lines
      lines.forEach((line, idx) => {
        lineConfirmations[idx] = false;
      });

      // Create an image element to crop from
      const sourceImg = new Image();
      sourceImg.src = imageDataUrl;

      sourceImg.onload = () => {
        // Draw full image with bounding boxes
        const fullCanvas = document.createElement("canvas");
        fullCanvas.width = sourceImg.naturalWidth;
        fullCanvas.height = sourceImg.naturalHeight;
        const ctx = fullCanvas.getContext("2d");
        ctx.drawImage(sourceImg, 0, 0);

        // Draw bounding boxes for each line - all same color, thick lines
        const boxColor = "#4c5ad4";
        lines.forEach((line, lineIdx) => {
          const coords = line.crop_coordinates;
          const x = (coords.x_start / 100) * sourceImg.naturalWidth;
          const y = (coords.y_start / 100) * sourceImg.naturalHeight;
          const w =
            ((coords.x_end - coords.x_start) / 100) * sourceImg.naturalWidth;
          const h =
            ((coords.y_end - coords.y_start) / 100) * sourceImg.naturalHeight;

          ctx.strokeStyle = boxColor;
          ctx.lineWidth = 6;
          ctx.strokeRect(x, y, w, h);

          // Draw line number label
          ctx.fillStyle = boxColor;
          ctx.fillRect(x, y - 28, 36, 28);
          ctx.fillStyle = "#fff";
          ctx.font = "bold 16px Arial";
          ctx.fillText(`${lineIdx + 1}`, x + 10, y - 8);
        });

        // Add full image to container
        const fullImg = document.createElement("img");
        fullImg.src = fullCanvas.toDataURL("image/png");
        fullImg.style.cssText = "width:100%;border-radius:8px;";
        fullImageContainer.appendChild(fullImg);
        fullImageSection.style.display = "block";

        // Render each cropped line with confirm button
        lines.forEach((line, lineIdx) => {
          const coords = line.crop_coordinates;
          const x = (coords.x_start / 100) * sourceImg.naturalWidth;
          const y = (coords.y_start / 100) * sourceImg.naturalHeight;
          const w =
            ((coords.x_end - coords.x_start) / 100) * sourceImg.naturalWidth;
          const h =
            ((coords.y_end - coords.y_start) / 100) * sourceImg.naturalHeight;

          // Create cropped canvas
          const cropCanvas = document.createElement("canvas");
          cropCanvas.width = w;
          cropCanvas.height = h;
          cropCanvas
            .getContext("2d")
            .drawImage(sourceImg, x, y, w, h, 0, 0, w, h);

          const lineDiv = document.createElement("div");
          lineDiv.style.cssText =
            "background:#1a1f35;border-radius:8px;padding:12px;display:flex;gap:12px;align-items:flex-start;";
          lineDiv.dataset.lineIdx = lineIdx;
          lineCardMap[lineIdx] = lineDiv;

          // Left side: line content
          const lineContent = document.createElement("div");
          lineContent.style.cssText = "flex:1;min-width:0;";

          const lineLabel = document.createElement("div");
          lineLabel.style.cssText =
            "color:#a8b2d6;font-size:0.8rem;margin-bottom:8px;";
          lineLabel.innerHTML = `<span style="display:inline-block;width:8px;height:8px;background:${boxColor};border-radius:50%;margin-right:6px;"></span>Line ${line.line_number}`;
          lineContent.appendChild(lineLabel);

          // Wrapper keeps image and text aligned to same width
          const lineContentWrapper = document.createElement("div");
          lineContentWrapper.style.cssText =
            "display:inline-block;max-width:100%;min-width:50%;";

          const cropImg = document.createElement("img");
          cropImg.src = cropCanvas.toDataURL("image/png");
          cropImg.style.cssText =
            "width:100%;border-radius:4px;background:#000;display:block;";
          lineContentWrapper.appendChild(cropImg);

          // Add word text with spans for highlighting
          // Use Claude's transcript words (matches backend word indices) but Vision positions
          const transcriptWords = line.text
            .split(/\s+/)
            .filter((w) => w.length > 0);
          const visionWords = line.words || [];

          if (transcriptWords.length > 0) {
            const textDiv = document.createElement("div");
            textDiv.style.cssText =
              "margin-top:8px;position:relative;width:100%;";
            textDiv.dataset.lineIdx = lineIdx;
            textDiv.addEventListener("click", (event) => {
              if (activeWordEditor) return;
              if (event.target !== textDiv) return;
              const rect = textDiv.getBoundingClientRect();
              const clickPct = rect.width
                ? ((event.clientX - rect.left) / rect.width) * 100
                : 50;
              openWordEditor(lineIdx, null, Math.max(0, Math.min(100, clickPct)));
            });

            // Crop bounds for position calculations
            const cropXStart = coords.x_start;
            const cropXEnd = coords.x_end;
            const cropWidth = cropXEnd - cropXStart;

            // Match transcript words to Vision words for positioning
            const usedVisionIndices = new Set();
            const wordData = transcriptWords.map((wordText, wordIdx) => {
              // Find best matching Vision word (by text similarity)
              const cleanTranscript = wordText
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "");
              let bestMatch = null;
              let bestScore = 0;

              visionWords.forEach((vw, vi) => {
                if (usedVisionIndices.has(vi)) return;
                const cleanVision = vw.text
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, "");
                // Check if one contains the other or they're similar
                let score = 0;
                if (cleanVision === cleanTranscript) score = 100;
                else if (
                  cleanVision.includes(cleanTranscript) ||
                  cleanTranscript.includes(cleanVision)
                ) {
                  score =
                    50 + Math.min(cleanVision.length, cleanTranscript.length);
                }
                if (score > bestScore) {
                  bestScore = score;
                  bestMatch = { vw, vi };
                }
              });

              if (bestMatch && bestScore > 0) {
                usedVisionIndices.add(bestMatch.vi);
                // Convert Vision position to crop-relative
                const wordCenterPct =
                  (bestMatch.vw.x_start + bestMatch.vw.x_end) / 2;
                const centerPctInCrop =
                  ((wordCenterPct - cropXStart) / cropWidth) * 100;
                return {
                  text: wordText,
                  centerPct: centerPctInCrop,
                  hasPosition: true,
                  globalIndex: globalWordIndex + wordIdx,
                };
              }
              return {
                text: wordText,
                centerPct: 50,
                hasPosition: false,
                globalIndex: globalWordIndex + wordIdx,
              };
            });
            lineWordDataMap[lineIdx] = wordData;
            lineTextContainers[lineIdx] = { textDiv };
            renderLineWords(lineIdx);
            globalWordIndex += transcriptWords.length;

            lineContentWrapper.appendChild(textDiv);

            lineLayoutHandlers.push(() => layoutLineWords(lineIdx));
            requestAnimationFrame(() => layoutLineWords(lineIdx));
          }

          lineContent.appendChild(lineContentWrapper);

          // Right side: confirm button (yellow until confirmed)
          const confirmBtn = document.createElement("button");
          confirmBtn.type = "button";
          confirmBtn.className = "lineConfirmBtn";
          confirmBtn.dataset.lineIdx = lineIdx;
          confirmBtn.style.cssText = `
            padding: 8px 16px;
            background: #f59e0b;
            border: 2px solid #d97706;
            border-radius: 6px;
            color: #fff;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.2s;
            flex-shrink: 0;
          `;
          confirmBtn.textContent = "Confirm";
          lineConfirmButtons[lineIdx] = confirmBtn;

          confirmBtn.addEventListener("click", () => {
            const idx = parseInt(confirmBtn.dataset.lineIdx);
            setLineConfirmationState(idx, !lineConfirmations[idx], lines.length);
          });

          lineDiv.appendChild(lineContent);
          lineDiv.appendChild(confirmBtn);
          croppedLinesContainer.appendChild(lineDiv);
        });

        nextGlobalWordIndex = globalWordIndex;

        if (lineLayoutHandlers.length > 0) {
          resizeHandler = () => {
            lineLayoutHandlers.forEach((handler) => handler());
          };
          window.addEventListener("resize", resizeHandler);
        }

        const resolvedFlags = Array.isArray(allergenFlags) ? allergenFlags : [];
        const shouldReanalyze =
          analysisResult?.allergenAnalysisPending === true ||
          (!resolvedFlags.length &&
            analysisResult?.allergenAnalysisPending !== false);
        analysisResult.allergenFlags = resolvedFlags;
        analysisResult.allergenAnalysisPending = shouldReanalyze;
        applyAllergenHighlighting(resolvedFlags);
        croppedLinesSection.style.display = "block";

        // Hide the raw image preview since we now show the annotated version
        preview.style.display = "none";

        // Initialize confirmation UI
        updateConfirmationUI(lines.length);
        if (shouldReanalyze) {
          requestAnimationFrame(() => {
            runAllergenReanalysis({
              showOverlay: true,
              statusMessage: "Analyzing ingredients...",
            });
          });
        }
      };
    }

    // Apply highlighting to flagged words
    function applyAllergenHighlighting(flags) {
      flags.forEach((flag) => {
        const indices = Array.isArray(flag.word_indices)
          ? flag.word_indices
          : [flag.word_indices];
        const isContained = flag.risk_type === "contained";
        const color = isContained ? "#ef4444" : "#fbbf24";

        indices.forEach((idx) => {
          const span = wordSpanMap[idx];
          if (span) {
            span.style.textDecoration = "underline";
            span.style.textDecorationColor = color;
            span.style.textDecorationThickness = "2px";
            span.style.fontWeight = "600";
          }
        });
      });
    }

    // Display allergen results
    function displayAllergenResults(flags) {
      const safeFlags = Array.isArray(flags) ? flags : [];
      if (safeFlags.length === 0) {
        allergenResultsContainer.innerHTML =
          '<div style="color:#4ade80;padding:12px;">✓ No allergens or diet violations detected</div>';
      } else {
        const allergenGroups = new Map();
        const dietGroups = new Map();
        const ensureGroup = (map, key) => {
          if (!map.has(key)) {
            map.set(key, {
              contained: new Set(),
              cross: new Set(),
            });
          }
          return map.get(key);
        };

        safeFlags.forEach((flag) => {
          const ingredient = asText(flag?.ingredient) || "Unknown ingredient";
          const isContained = flag?.risk_type === "contained";
          (Array.isArray(flag?.allergens) ? flag.allergens : []).forEach((allergen) => {
            const name = asText(formatAllergenLabel(allergen) || allergen);
            if (!name) return;
            const group = ensureGroup(allergenGroups, name);
            if (isContained) {
              group.contained.add(ingredient);
            } else {
              group.cross.add(ingredient);
            }
          });
          (Array.isArray(flag?.diets) ? flag.diets : []).forEach((diet) => {
            const name = asText(diet);
            if (!name) return;
            const group = ensureGroup(dietGroups, name);
            if (isContained) {
              group.contained.add(ingredient);
            } else {
              group.cross.add(ingredient);
            }
          });
        });

        const renderRiskList = (label, ingredients, accentColor) => {
          if (!ingredients.length) return "";
          const bullets = ingredients
            .map((ingredient) => `<li>${esc(ingredient)}</li>`)
            .join("");
          return `
            <div style="margin-top:8px;">
              <div style="font-size:0.78rem;font-weight:700;color:${accentColor};text-transform:uppercase;letter-spacing:0.03em;">${label}</div>
              <ul style="margin:4px 0 0 18px;padding:0;color:#e2e8f0;font-size:0.84rem;">${bullets}</ul>
            </div>
          `;
        };

        const renderGroupedSection = (title, groups, containedLabel) => {
          if (!groups.size) return "";
          const cards = Array.from(groups.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([name, group]) => {
              const contained = Array.from(group.contained).sort((a, b) =>
                a.localeCompare(b),
              );
              const cross = Array.from(group.cross).sort((a, b) =>
                a.localeCompare(b),
              );
              return `
                <div style="background:rgba(15,23,42,0.45);border:1px solid rgba(148,163,184,0.25);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
                  <div style="font-weight:600;color:#fff;">${esc(name)}</div>
                  ${renderRiskList(containedLabel, contained, "#ef4444")}
                  ${renderRiskList("Cross-contamination", cross, "#fbbf24")}
                </div>
              `;
            })
            .join("");

          return `
            <div style="margin-bottom:14px;">
              <div style="font-weight:700;color:#fff;margin-bottom:8px;">${title}</div>
              ${cards}
            </div>
          `;
        };

        const allergenSection = renderGroupedSection(
          "Allergens",
          allergenGroups,
          "Contains",
        );
        const dietSection = renderGroupedSection(
          "Diets",
          dietGroups,
          "Violation",
        );

        if (!allergenSection && !dietSection) {
          allergenResultsContainer.innerHTML =
            '<div style="color:#4ade80;padding:12px;">✓ No allergens or diet violations detected</div>';
        } else {
          allergenResultsContainer.innerHTML = `${allergenSection}${dietSection}`;
        }
      }
      allergenResultsSection.style.display = "block";
    }

    // Retake photo
    retakeBtn.addEventListener("click", () => {
      cancelPendingReanalysis();
      capturedPhoto = null;
      analysisResult = null;
      preview.style.display = "none";
      croppedLinesSection.style.display = "none";
      allergenResultsSection.style.display = "none";
      applyButtonContainer.style.display = "none";
      buttonsContainer.style.display = "flex";
      showButtons(cameraBtn, uploadBtn);
      statusDiv.textContent = "";
      fileInput.value = "";
    });

    // Helper function to apply the analysis results
    async function applyAnalysisResults(
      frontImageDataUrl = null,
      productName = null,
    ) {
      if (!analysisResult) return;

      // Get the allergen/diet data from the analysis
      const flags = analysisResult.allergenFlags;
      const containedAllergens = new Set();
      const crossContaminationAllergens = new Set();
      const violatedDiets = new Set();
      const crossContaminationDiets = new Set();
      const confirmedLines = Array.isArray(analysisResult.lines)
        ? analysisResult.lines.filter((_, idx) => lineConfirmations[idx])
        : [];
      const fallbackLines = Array.isArray(analysisResult.transcript)
        ? analysisResult.transcript
        : [];
      const ingredientText = confirmedLines.length
        ? confirmedLines.map((line) => line.text).join(" ")
        : fallbackLines.join(" ");
      const ingredientLines = (
        confirmedLines.length
          ? confirmedLines.map((line) => line.text)
          : fallbackLines
      )
        .map((text) => String(text || "").trim())
        .filter(Boolean);
      const labelImage = analysisResult.correctedImage || capturedPhoto || "";

      const addCrossContaminationDiets = (list) => {
        (Array.isArray(list) ? list : []).forEach((diet) => {
          if (diet !== undefined && diet !== null && diet !== "") {
            crossContaminationDiets.add(diet);
          }
        });
      };

      const resolveFlagAllergens = (list) =>
        Array.isArray(list) ? list : [];

      flags.forEach((flag) => {
        const flagAllergens = Array.isArray(flag.allergens) ? flag.allergens : [];
        const flagDiets = Array.isArray(flag.diets) ? flag.diets : [];
        const isContained = flag.risk_type === "contained";
        const resolvedAllergens = resolveFlagAllergens(flagAllergens);

        if (isContained) {
          resolvedAllergens.forEach((a) => {
            if (a !== undefined && a !== null && a !== "") {
              containedAllergens.add(a);
            }
          });
          flagDiets.forEach((d) => {
            if (d !== undefined && d !== null && d !== "") {
              violatedDiets.add(d);
            }
          });
        } else {
          // Cross-contamination
          resolvedAllergens.forEach((a) => {
            if (a !== undefined && a !== null && a !== "") {
              crossContaminationAllergens.add(a);
            }
          });
          addCrossContaminationDiets(flagDiets);
        }
      });

      // Keep overlaps so a single allergen/diet can carry both
      // "contains" and "cross-contamination" flags when needed.

      const allDiets = DIETS.slice();
      const compliantDiets = allDiets.filter(
        (d) => !violatedDiets.has(d) && !crossContaminationDiets.has(d),
      );
      let compressedImage = "";
      if (frontImageDataUrl) {
        compressedImage = await compressImage(frontImageDataUrl, 1200, 0.92);
      }

      if (skipRowUpdates) {
        if (onApplyResults) {
          await onApplyResults({
            ingredientName,
            ingredientText,
            allergens: Array.from(containedAllergens),
            crossContaminationAllergens: Array.from(crossContaminationAllergens),
            diets: compliantDiets,
            crossContaminationDiets: Array.from(crossContaminationDiets),
            brandImage: compressedImage,
            ingredientsImage: labelImage,
            ingredientsList: ingredientLines,
            productName: productName || "",
          });
        }
        return;
      }

      // Update the ingredient row
      const data = collectAiTableData();
      if (data[rowIdx]) {
        data[rowIdx].allergens = Array.from(containedAllergens);
        data[rowIdx].crossContaminationAllergens = Array.from(crossContaminationAllergens);

        // Set compliant diets (those NOT violated by contained allergens)
        data[rowIdx].diets = compliantDiets;
        data[rowIdx].crossContaminationDiets = Array.from(crossContaminationDiets);
        data[rowIdx].ingredientsImage = labelImage;
        data[rowIdx].ingredientsList = ingredientLines;

        data[rowIdx].confirmed = false;
        data[rowIdx].aiDetectedAllergens = Array.from(containedAllergens);
        data[rowIdx].aiDetectedCrossContaminationAllergens =
          Array.from(crossContaminationAllergens);
        data[rowIdx].aiDetectedDiets = data[rowIdx].diets;
        data[rowIdx].aiDetectedCrossContaminationDiets = Array.from(crossContaminationDiets);

        // Save front image and create brand entry if provided
        if (frontImageDataUrl) {
          data[rowIdx].brandImage = compressedImage;

          // If product name is provided, create/update a brand entry
          if (productName) {
            if (!data[rowIdx].brands) {
              data[rowIdx].brands = [];
            }
            // Add a new brand with the product name and compressed image
            const newBrand = {
              name: productName,
              brandImage: compressedImage,
              ingredientsImage: labelImage,
              ingredientsList: ingredientLines,
              allergens: Array.from(containedAllergens),
              crossContaminationAllergens: Array.from(crossContaminationAllergens),
              diets: data[rowIdx].diets,
              crossContaminationDiets: Array.from(crossContaminationDiets),
            };
            data[rowIdx].brands.push(newBrand);
          }
        }

        // Clean up stored results BEFORE re-rendering so restoration doesn't bring it back
        if (
          aiAssistState.photoAnalysisResults &&
          aiAssistState.photoAnalysisResults[rowIdx]
        ) {
          delete aiAssistState.photoAnalysisResults[rowIdx];
        }

        renderAiTable(data);
        aiAssistSetStatus("Photo analysis applied successfully!", "success");
        aiAssistState.savedToDish = false;
      }

      // Remove the "View Results" button from the ingredient row (in case it wasn't cleaned by re-render)
      hidePhotoAnalysisLoadingInRow(rowIdx);
    }

    // Capture front image button - opens modal to capture front of product
    applyBtn.addEventListener("click", () => {
      if (!analysisResult) return;

      // Create front image capture modal
      const frontModal = document.createElement("div");
      frontModal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.95); z-index: 10002;
        display: flex; flex-direction: column; align-items: center;
        justify-content: flex-start;
        padding: 20px; overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-y;
        overscroll-behavior: contain;
      `;

      frontModal.innerHTML = `
        <div style="width:100%;max-width:500px;display:flex;flex-direction:column;gap:16px">
          <div style="text-align:center">
            <h3 style="margin:0 0 8px 0;font-size:1.3rem;color:#fff">Capture Item Front</h3>
            <p style="margin:0;color:#a8b2d6;font-size:0.9rem">Take a photo of the front of the product for the thumbnail</p>
          </div>

          <div style="position:relative;background:#000;border-radius:12px;overflow:hidden;min-height:200px">
            <video id="frontCameraVideo" autoplay playsinline muted style="width:100%;max-height:50vh;display:none;object-fit:cover"></video>
            <img id="frontPhotoPreview" style="width:100%;max-height:50vh;object-fit:contain;display:none" alt="Preview">
            <div id="frontPlaceholder" style="display:flex;align-items:center;justify-content:center;height:200px;color:#64748b">
              No image selected
            </div>
          </div>

          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <button type="button" class="btn frontCameraBtn" style="background:#4c5ad4;padding:10px 20px">📷 Use Camera</button>
            <button type="button" class="btn frontUploadBtn" style="background:#4c5ad4;padding:10px 20px">📁 Upload Photo</button>
            <button type="button" class="btn frontCaptureBtn" style="background:#17663a;padding:10px 20px;display:none">📸 Capture</button>
            <input type="file" id="frontFileInput" accept="image/*" style="display:none">
          </div>

          <div class="frontAnalyzingArea" style="display:none;padding:12px;background:rgba(76,90,212,0.1);border-radius:8px;border:1px solid rgba(76,90,212,0.3)">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:20px;height:20px;border:2px solid #4c5ad4;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite"></div>
              <span style="color:#a8b2d6;font-size:0.9rem">Identifying product...</span>
            </div>
          </div>

          <div class="frontProductNameArea" style="display:none;flex-direction:column;gap:8px">
            <label style="color:#a8b2d6;font-size:0.85rem">Product Name</label>
            <input type="text" class="frontProductNameInput" placeholder="Enter product name" style="width:100%;padding:12px;border-radius:8px;border:1px solid rgba(148,163,184,0.3);background:rgba(0,0,0,0.3);color:#fff;font-size:1rem;box-sizing:border-box">
            <div class="frontProductNameHint" style="color:#64748b;font-size:0.8rem;font-style:italic"></div>
          </div>

          <div class="frontActionBtns" style="display:none;flex-direction:column;gap:12px;justify-content:center;margin-top:8px">
            <div style="display:flex;gap:12px;justify-content:center">
              <button type="button" class="btn frontApplyBtn" style="background:#17663a;padding:12px 24px;font-size:1rem">✓ Save & Apply Results</button>
              <button type="button" class="btn frontRetakeBtn" style="background:#f59e0b;padding:12px 24px">📷 Retake Photo</button>
            </div>
            <div style="display:flex;justify-content:center">
              <button type="button" class="btn frontCancelBtn" style="background:#ef4444;padding:12px 24px">Cancel</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(frontModal);

      const frontVideo = frontModal.querySelector("#frontCameraVideo");
      const frontPreview = frontModal.querySelector("#frontPhotoPreview");
      const frontPlaceholder = frontModal.querySelector("#frontPlaceholder");
      const frontCameraBtn = frontModal.querySelector(".frontCameraBtn");
      const frontUploadBtn = frontModal.querySelector(".frontUploadBtn");
      const frontCaptureBtn = frontModal.querySelector(".frontCaptureBtn");
      const frontFileInput = frontModal.querySelector("#frontFileInput");
      const frontApplyBtn = frontModal.querySelector(".frontApplyBtn");
      const frontRetakeBtn = frontModal.querySelector(".frontRetakeBtn");
      const frontCancelBtn = frontModal.querySelector(".frontCancelBtn");
      const frontActionBtns = frontModal.querySelector(".frontActionBtns");
      const frontAnalyzingArea = frontModal.querySelector(".frontAnalyzingArea");
      const frontProductNameArea = frontModal.querySelector(
        ".frontProductNameArea",
      );
      const frontProductNameInput = frontModal.querySelector(
        ".frontProductNameInput",
      );
      const frontProductNameHint = frontModal.querySelector(
        ".frontProductNameHint",
      );
      const frontAnalyzingText = frontAnalyzingArea?.querySelector("span");

      let frontStream = null;
      let frontCapturedPhoto = null;
      let detectedProductName = null;

      // Analyze front image with Claude to detect product name
      async function analyzeFrontImage(imageDataUrl) {
        frontAnalyzingArea.style.display = "block";
        frontProductNameArea.style.display = "none";
        frontActionBtns.style.display = "none";

        try {
          const response = await fetch("/api/ingredient-photo-analysis", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageData: imageDataUrl,
              mode: "front-analysis",
            }),
          });
          const resultText = await response.text();
          let result = null;
          try {
            result = resultText ? JSON.parse(resultText) : null;
          } catch {
            result = null;
          }

          if (!response.ok) {
            throw new Error(
              result?.error ||
                result?.message ||
                "Front image analysis is unavailable.",
            );
          }

          detectedProductName = result?.productName || "";
          const confidence = result.confidence || "low";

          frontAnalyzingArea.style.display = "none";
          frontProductNameArea.style.display = "flex";
          frontActionBtns.style.display = "flex";

          if (detectedProductName && confidence !== "low") {
            frontProductNameInput.value = detectedProductName;
            frontProductNameHint.textContent =
              confidence === "high"
                ? "Product identified automatically"
                : "Please verify the product name";
            frontProductNameHint.style.color =
              confidence === "high" ? "#22c55e" : "#f59e0b";
          } else {
            frontProductNameInput.value = "";
            frontProductNameHint.textContent =
              "Could not identify product - please enter the name";
            frontProductNameHint.style.color = "#ef4444";
            frontProductNameInput.focus();
          }
        } catch (err) {
          console.error("Error analyzing front image:", err);
          frontAnalyzingArea.style.display = "none";
          frontProductNameArea.style.display = "flex";
          frontActionBtns.style.display = "flex";
          frontProductNameInput.value = "";
          frontProductNameHint.textContent =
            "Could not analyze image - please enter product name";
          frontProductNameHint.style.color = "#ef4444";
          frontProductNameInput.focus();
        }
      }

      const closeFrontModal = () => {
        if (frontStream) {
          frontStream.getTracks().forEach((track) => track.stop());
        }
        if (frontModal.parentNode) frontModal.remove();
      };

      // Camera button
      frontCameraBtn.addEventListener("click", async () => {
        try {
          frontStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: "environment",
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          });
          frontVideo.srcObject = frontStream;
          frontVideo.style.display = "block";
          frontPreview.style.display = "none";
          frontPlaceholder.style.display = "none";
          frontCameraBtn.style.display = "none";
          frontUploadBtn.style.display = "none";
          frontCaptureBtn.style.display = "inline-block";
        } catch (err) {
          alert("Could not access camera: " + err.message);
        }
      });

      // Capture button
      frontCaptureBtn.addEventListener("click", async () => {
        const canvas = document.createElement("canvas");
        canvas.width = frontVideo.videoWidth;
        canvas.height = frontVideo.videoHeight;
        canvas.getContext("2d").drawImage(frontVideo, 0, 0);
        frontCapturedPhoto = canvas.toDataURL("image/jpeg", 0.85);

        if (frontStream) {
          frontStream.getTracks().forEach((track) => track.stop());
          frontStream = null;
        }

        frontVideo.style.display = "none";
        frontPreview.src = frontCapturedPhoto;
        frontPreview.style.display = "block";
        frontCaptureBtn.style.display = "none";
        frontCameraBtn.style.display = "none";
        frontUploadBtn.style.display = "none";

        // Analyze the captured image
        await analyzeFrontImage(frontCapturedPhoto);
      });

      // Upload button
      frontUploadBtn.addEventListener("click", () => frontFileInput.click());

      frontFileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (ev) => {
          frontCapturedPhoto = ev.target.result;
          frontPreview.src = frontCapturedPhoto;
          frontPreview.style.display = "block";
          frontVideo.style.display = "none";
          frontPlaceholder.style.display = "none";
          frontCameraBtn.style.display = "none";
          frontUploadBtn.style.display = "none";

          // Analyze the uploaded image
          await analyzeFrontImage(frontCapturedPhoto);
          frontFileInput.value = "";
        };
        reader.readAsDataURL(file);
      });

      // Apply with front image
      frontApplyBtn.addEventListener("click", async () => {
        const productName = frontProductNameInput.value.trim();
        frontApplyBtn.disabled = true;
        frontRetakeBtn.disabled = true;
        frontCancelBtn.disabled = true;
        frontProductNameInput.disabled = true;
        frontApplyBtn.textContent = "Saving...";
        frontAnalyzingArea.style.display = "block";
        if (frontAnalyzingText) {
          frontAnalyzingText.textContent = "Applying results...";
        }
        try {
          await applyAnalysisResults(frontCapturedPhoto, productName);
          closeFrontModal();
          closeModal();
        } catch (err) {
          console.error("Failed to apply analysis results", err);
          frontAnalyzingArea.style.display = "none";
          frontProductNameHint.textContent =
            "Failed to apply results. Please try again.";
          frontProductNameHint.style.color = "#f87171";
          frontApplyBtn.textContent = "✓ Save & Apply Results";
          frontApplyBtn.disabled = false;
          frontRetakeBtn.disabled = false;
          frontCancelBtn.disabled = false;
          frontProductNameInput.disabled = false;
        }
      });

      // Retake photo - reset to initial state
      frontRetakeBtn.addEventListener("click", () => {
        frontCapturedPhoto = null;
        detectedProductName = null;
        frontPreview.style.display = "none";
        frontPreview.src = "";
        frontPlaceholder.style.display = "flex";
        frontActionBtns.style.display = "none";
        frontAnalyzingArea.style.display = "none";
        frontProductNameArea.style.display = "none";
        frontProductNameInput.value = "";
        frontCameraBtn.style.display = "inline-block";
        frontUploadBtn.style.display = "inline-block";
        frontFileInput.value = "";
      });

      // Cancel - go back to results
      frontCancelBtn.addEventListener("click", closeFrontModal);
    });

    // Cancel button
    cancelBtn.addEventListener("click", closeModal);

    // Report issue button - shows modal for user feedback
    reportPhotoIssueBtn.addEventListener("click", () => {
      const reportModal = document.createElement("div");
      reportModal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.8); z-index: 10002;
        display: flex; align-items: center; justify-content: center;
      `;

      reportModal.innerHTML = `
        <div style="background: #1e293b; padding: 24px; border-radius: 12px; width: 90%; max-width: 500px; border: 1px solid rgba(148, 163, 184, 0.2);">
          <h3 style="color: #fff; margin: 0 0 16px 0;">Report Issue</h3>
          <p style="color: #94a3b8; margin-bottom: 16px; font-size: 0.9rem;">Please describe what's wrong with the analysis.</p>
          <textarea style="width: 100%; height: 100px; background: rgba(0,0,0,0.2); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 8px; color: #fff; padding: 12px; margin-bottom: 16px; resize: vertical;" placeholder="e.g. The ingredient list is missing items, wrong allergens detected..."></textarea>
          <div style="display: flex; justify-content: flex-end; gap: 12px;">
            <button class="cancelReportBtn" style="padding: 8px 16px; background: transparent; border: 1px solid rgba(255,255,255,0.2); color: #fff; border-radius: 6px; cursor: pointer;">Cancel</button>
            <button class="sendReportBtn" style="padding: 8px 16px; background: #dc2626; border: none; color: #fff; border-radius: 6px; cursor: pointer; font-weight: 600;">Send Report</button>
          </div>
        </div>
      `;

      document.body.appendChild(reportModal);

      reportModal.querySelector(".cancelReportBtn").onclick = () =>
        document.body.removeChild(reportModal);

      reportModal.querySelector(".sendReportBtn").onclick = async function () {
        const msg = reportModal.querySelector("textarea").value;
        if (!msg) return;

        this.textContent = "Sending...";
        this.disabled = true;

        try {
          const reportMeta = getIssueReportMeta();
          const response = await fetch("/api/report-issue", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: msg,
              productName: ingredientName,
              context: "photo_analysis",
              analysisDetails: analysisResult,
              userEmail: reportMeta.userEmail,
              reporterName: reportMeta.reporterName,
              accountName: reportMeta.accountName,
              accountId: reportMeta.accountId,
              pageUrl: reportMeta.pageUrl,
              restaurantName: state.restaurant?.name || null,
            }),
          });

          if (!response.ok) {
            const responseText = await response.text();
            let payload = null;
            try {
              payload = responseText ? JSON.parse(responseText) : null;
            } catch {
              payload = null;
            }
            throw new Error(
              payload?.error || payload?.message || "Issue report request failed.",
            );
          }

          // Mark this ingredient as having a reported issue
          const data = collectAiTableData();
          if (data[rowIdx]) {
            data[rowIdx].issueReported = true;
          }
          renderAiTable(data);

          document.body.removeChild(reportModal);
          closeModal();
          aiAssistSetStatus("Issue reported. Thank you!", "success");
        } catch (e) {
          console.error("Failed to report issue:", e);
          this.textContent = "Error";
          setTimeout(() => {
            document.body.removeChild(reportModal);
            aiAssistSetStatus("Failed to send report.", "error");
          }, 1000);
        }
      };
    });

    // Click outside to close
    photoModal.addEventListener("click", (e) => {
      if (e.target === photoModal) closeModal();
    });
  }

  // Photo analysis loading functions
  function showPhotoAnalysisLoadingInRow(
    rowIdx,
    ingredientName,
    statusText = "Analyzing ingredients",
  ) {
    // Track this active photo analysis
    activePhotoAnalyses.set(rowIdx, { ingredientName, statusText });

    const aiAssistTable = document.getElementById("aiAssistTable");
    if (!aiAssistTable) return;
    const trElement = aiAssistTable.querySelector(`tr[data-index="${rowIdx}"]`);
    if (!trElement) return;
    const rowElement = trElement.querySelector(".aiIngredientRow");
    if (!rowElement) return;

    // Find the ingredient label card and replace its content with loading bar
    const allDivs = rowElement.querySelectorAll("div");
    let brandIdCard = null;
    allDivs.forEach((div) => {
      if (
        (div.textContent.includes("Brand assignment optional") ||
          div.textContent.includes("Brand assignment required")) &&
        div.style.background &&
        (div.style.background.includes("6b7280") ||
          div.style.background.includes("f59e0b"))
      ) {
        brandIdCard = div;
      }
    });

    // If no brand ID card found, look for parent divs with the right background
    if (!brandIdCard) {
      allDivs.forEach((div) => {
        if (
          div.textContent.includes("Brand assignment optional") ||
          div.textContent.includes("Brand assignment required")
        ) {
          // Check if this is a direct child with padding (the card itself)
          if (div.style.cssText && div.style.cssText.includes("padding")) {
            brandIdCard = div;
          }
        }
      });
    }

    if (brandIdCard) {
      // Store original content and replace with loading
      brandIdCard.dataset.originalHtml = brandIdCard.innerHTML;
      brandIdCard.dataset.originalStyle = brandIdCard.style.cssText;
      brandIdCard.classList.add("photoAnalysisLoadingArea");
      brandIdCard.style.cssText =
        "padding:12px 16px;background:rgba(34,197,94,0.1);border-radius:8px;border:1px solid rgba(34,197,94,0.3);margin-bottom:12px;";
      brandIdCard.innerHTML = `
        <style>
          @keyframes photoAnalysisSlide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(400%); }
          }
        </style>
        <div style="width:100%;background:rgba(34,197,94,0.2);border-radius:4px;height:8px;overflow:hidden;position:relative">
          <div class="photoAnalysisLoadingBarFill" style="background:linear-gradient(90deg, transparent, #22c55e, transparent);height:100%;width:25%;position:absolute;animation:photoAnalysisSlide 1.2s ease-in-out infinite"></div>
        </div>
        <div class="photoAnalysisLoadingStatus" style="font-size:0.85rem;color:#a8b2d6;margin-top:8px">${esc(statusText)}</div>
      `;
    }
  }

  function hidePhotoAnalysisLoadingInRow(rowIdx) {
    // Remove from tracking
    activePhotoAnalyses.delete(rowIdx);

    const aiAssistTable = document.getElementById("aiAssistTable");
    if (!aiAssistTable) return;
    const trElement = aiAssistTable.querySelector(`tr[data-index="${rowIdx}"]`);
    if (!trElement) return;

    // Restore original ingredient label card content
    const loadingArea = trElement.querySelector(".photoAnalysisLoadingArea");
    if (loadingArea && loadingArea.dataset.originalHtml) {
      loadingArea.innerHTML = loadingArea.dataset.originalHtml;
      loadingArea.style.cssText = loadingArea.dataset.originalStyle || "";
      loadingArea.classList.remove("photoAnalysisLoadingArea");
      delete loadingArea.dataset.originalHtml;
      delete loadingArea.dataset.originalStyle;
    }
  }

  function updatePhotoAnalysisLoadingStatus(rowIdx, statusText) {
    // Update tracking
    const existing = activePhotoAnalyses.get(rowIdx);
    if (existing) {
      existing.statusText = statusText;
    }

    const aiAssistTable = document.getElementById("aiAssistTable");
    if (!aiAssistTable) return;
    const trElement = aiAssistTable.querySelector(`tr[data-index="${rowIdx}"]`);
    if (!trElement) return;
    const statusEl = trElement.querySelector(".photoAnalysisLoadingStatus");
    if (statusEl) {
      statusEl.textContent = statusText;
    }
  }

  // Show "View Results" button after photo analysis completes
  function showPhotoAnalysisResultButton(
    rowIdx,
    ingredientName,
    analysisResult,
    originalPhoto,
  ) {
    const aiAssistTable = document.getElementById("aiAssistTable");
    if (!aiAssistTable) return;
    const trElement = aiAssistTable.querySelector(`tr[data-index="${rowIdx}"]`);
    if (!trElement) return;

    // Store result for later retrieval
    if (!aiAssistState.photoAnalysisResults) {
      aiAssistState.photoAnalysisResults = {};
    }
    aiAssistState.photoAnalysisResults[rowIdx] = {
      analysisResult,
      originalPhoto,
      ingredientName,
    };

    const analysisPending =
      analysisResult.allergenAnalysisPending === true ||
      (!analysisResult.allergenFlags?.length &&
        analysisResult.allergenAnalysisPending !== false);

    if (analysisPending) {
      const existingLoading = trElement.querySelector(
        ".photoAnalysisLoadingArea",
      );
      if (existingLoading) {
        const statusEl = existingLoading.querySelector(
          ".photoAnalysisLoadingStatus",
        );
        if (statusEl) statusEl.textContent = "Analyzing ingredients";
      } else {
        showPhotoAnalysisLoadingInRow(
          rowIdx,
          ingredientName,
          "Analyzing ingredients",
        );
      }

      if (!analysisResult.__analysisInFlight) {
        analysisResult.__analysisInFlight = true;
        const transcript = Array.isArray(analysisResult.transcript)
          ? analysisResult.transcript
          : Array.isArray(analysisResult.lines)
            ? analysisResult.lines.map((line) => line.text).filter(Boolean)
            : [];
        if (
          transcript.length &&
          typeof analyzeAllergensWithLabelCropper === "function"
        ) {
          analysisResult.transcript = transcript;
          analyzeAllergensWithLabelCropper(transcript)
            .then((result) => {
              const flags =
                result.success && result.data?.flags ? result.data.flags : [];
              analysisResult.allergenFlags = flags;
              analysisResult.allergenAnalysisPending = false;
              showPhotoAnalysisResultButton(
                rowIdx,
                ingredientName,
                analysisResult,
                originalPhoto,
              );
            })
            .catch((err) => {
              console.warn("Background allergen analysis failed:", err);
              analysisResult.allergenFlags = analysisResult.allergenFlags || [];
              analysisResult.allergenAnalysisPending = false;
              showPhotoAnalysisResultButton(
                rowIdx,
                ingredientName,
                analysisResult,
                originalPhoto,
              );
            })
            .finally(() => {
              analysisResult.__analysisInFlight = false;
            });
        } else {
          analysisResult.__analysisInFlight = false;
        }
      }
      return;
    }

    // Remove from tracking since analysis is complete
    activePhotoAnalyses.delete(rowIdx);

    // Replace loading area with results button - find or create in the brand cell area
    let loadingArea = trElement.querySelector(".photoAnalysisLoadingArea");
    if (!loadingArea) {
      // Find the brand cell to insert the results button
      const brandCell = trElement.querySelector(".aiBrandCell");
      if (brandCell) {
        loadingArea = document.createElement("div");
        loadingArea.className = "photoAnalysisLoadingArea";
        // Insert at the beginning of the brand cell
        brandCell.insertBefore(loadingArea, brandCell.firstChild);
      } else {
        // Fallback: create in the row element
        const rowElement = trElement.querySelector(".aiIngredientRow");
        if (rowElement) {
          loadingArea = document.createElement("div");
          loadingArea.className = "photoAnalysisLoadingArea";
          const nameCol = rowElement.querySelector(".aiIngredientNameCol");
          if (nameCol) {
            nameCol.appendChild(loadingArea);
          }
        }
      }
      if (!loadingArea) return; // Could not find a place to insert
    }

    const flagCount = analysisResult.allergenFlags?.length || 0;
    const flagText =
      flagCount > 0
        ? `${flagCount} flag${flagCount > 1 ? "s" : ""} found`
        : "No flags";
    const statusText = `Analysis complete - ${flagText}`;
    const statusColor = "#22c55e";
    const statusBg = "rgba(34,197,94,0.1)";
    const statusBorder = "rgba(34,197,94,0.3)";
    const statusIcon = "✓";

    loadingArea.style.cssText = `margin-bottom:12px;padding:12px 16px;background:${statusBg};border-radius:8px;border:1px solid ${statusBorder};width:100%;box-sizing:border-box;`;
    loadingArea.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="color:${statusColor};font-size:1rem">${statusIcon}</span>
          <span style="color:#e2e8f0;font-size:0.9rem">${statusText}</span>
        </div>
        <button class="viewPhotoResultsBtn" style="background:#22c55e;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600;font-size:0.9rem">View Results</button>
      </div>
    `;

    loadingArea
      .querySelector(".viewPhotoResultsBtn")
      .addEventListener("click", () => {
        // Open the photo modal with preloaded results
        showIngredientPhotoUploadModal(rowIdx, ingredientName, null, {
          analysisResult,
          originalPhoto,
        });
      });
  }

  const api = {
    rotateImage,
    analyzeWithLabelCropper,
    analyzeAllergensWithLabelCropper,
    analyzeIngredientPhoto,
    openBrandIdentificationChoice,
    showIngredientPhotoUploadModal,
    showPhotoAnalysisLoadingInRow,
    hidePhotoAnalysisLoadingInRow,
    updatePhotoAnalysisLoadingStatus,
    showPhotoAnalysisResultButton,
  };

  return api;
}
