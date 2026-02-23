"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../ui";
import FrontProductCaptureModal from "./FrontProductCaptureModal";
import ConfirmToggleButton from "./ConfirmToggleButton";
import {
  analyzeIngredientLabelImage,
  analyzeTranscriptFlags,
  buildWordLayout,
  prepareAnalysisImage,
  rebuildLineWordBoxes,
} from "./analysisClient";

function asText(value) {
  return String(value ?? "").trim();
}

function isNativeIosCapacitor() {
  if (typeof window === "undefined") return false;
  const platform =
    typeof window.Capacitor?.getPlatform === "function"
      ? asText(window.Capacitor.getPlatform()).toLowerCase()
      : "";
  if (platform === "ios") return true;
  return (
    /iphone|ipad|ipod/i.test(window.navigator?.userAgent || "") &&
    /capacitor/i.test(window.navigator?.userAgent || "")
  );
}

async function readFileAsDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

function dedupeStrings(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => asText(value))
    .filter(Boolean)
    .filter((value) => {
      const token = value.toLowerCase();
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });
}

function splitWords(text) {
  return asText(text).split(/\s+/).filter(Boolean);
}

function clampPercentage(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function measureTokenWidthsPx(tokens, fontSizePx) {
  const safeTokens = Array.isArray(tokens) ? tokens : [];
  const safeFontSize = Math.max(1, Number(fontSizePx) || 1);
  if (!safeTokens.length) return [];

  if (typeof document === "undefined") {
    return safeTokens.map((token) => asText(token).length * safeFontSize * 0.58);
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return safeTokens.map((token) => asText(token).length * safeFontSize * 0.58);
  }
  context.font = `600 ${safeFontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  return safeTokens.map((token) => context.measureText(asText(token)).width);
}

function resolveTokenFontSizePx(tokenLayout, displayTokens, tokenStripWidthPx) {
  const safeTokens = Array.isArray(displayTokens) ? displayTokens : [];
  const safeLayout = Array.isArray(tokenLayout) ? tokenLayout : [];
  const width = Math.max(1, Number(tokenStripWidthPx) || 0);
  if (!safeTokens.length || !width) return 10;

  const totalChars = safeTokens.reduce((sum, token) => sum + asText(token).length, 0);
  const maxFontPx = width < 360 ? 10 : 11;
  const initialSize = Math.max(
    6,
    Math.min(maxFontPx, Math.floor((width / Math.max(totalChars, 1)) * 1.6)),
  );

  const widths = measureTokenWidthsPx(safeTokens, initialSize).map((value) =>
    Math.max(1, Number(value) || 1),
  );
  let scale = 1;
  const edgeInsetPx = 2;
  const pairGapPx = 2;
  const tokenPadPx = 4;

  for (let index = 0; index < safeLayout.length; index += 1) {
    const centerPct = clampPercentage(Number(safeLayout[index]?.centerPct));
    const centerPx = (centerPct / 100) * width;
    const tokenWidth = widths[index] + tokenPadPx;
    if (tokenWidth <= 0) continue;
    const leftScale = (2 * Math.max(centerPx - edgeInsetPx, 0)) / tokenWidth;
    const rightScale = (2 * Math.max(width - centerPx - edgeInsetPx, 0)) / tokenWidth;
    if (Number.isFinite(leftScale)) scale = Math.min(scale, leftScale);
    if (Number.isFinite(rightScale)) scale = Math.min(scale, rightScale);
  }

  for (let index = 0; index < safeLayout.length - 1; index += 1) {
    const leftCenter = (clampPercentage(Number(safeLayout[index]?.centerPct)) / 100) * width;
    const rightCenter =
      (clampPercentage(Number(safeLayout[index + 1]?.centerPct)) / 100) * width;
    const gap = rightCenter - leftCenter;
    const denom = widths[index] + widths[index + 1] + tokenPadPx * 2;
    if (denom <= 0) continue;
    const allowedScale = (2 * Math.max(gap - pairGapPx, 0)) / denom;
    if (Number.isFinite(allowedScale)) scale = Math.min(scale, allowedScale);
  }

  const nextSize = initialSize * Math.max(0.45, Math.min(1, scale));
  return Math.max(6, Math.min(maxFontPx, Number(nextSize.toFixed(2))));
}

function resolveLineTokenIndex(globalIndex, wordOffsets, tokenCounts) {
  const target = Number(globalIndex);
  if (!Number.isFinite(target) || target < 0) return null;
  for (let lineIndex = 0; lineIndex < wordOffsets.length; lineIndex += 1) {
    const start = Number(wordOffsets[lineIndex]) || 0;
    const count = Number(tokenCounts[lineIndex]) || 0;
    const end = start + Math.max(count - 1, 0);
    if (!count) continue;
    if (target >= start && target <= end) {
      return {
        lineIndex,
        tokenIndex: target - start,
      };
    }
  }
  return null;
}

function resolveInsertionIndexFromClick(tokenLayout, clickPct) {
  const safeTokens = Array.isArray(tokenLayout) ? tokenLayout : [];
  if (!safeTokens.length) return 0;

  const centers = safeTokens.map((token, tokenIndex) => {
    const fallback = ((tokenIndex + 0.5) / safeTokens.length) * 100;
    const center = Number(token?.centerPct);
    return clampPercentage(Number.isFinite(center) ? center : fallback);
  });

  const gapAnchors = [0];
  for (let index = 1; index < centers.length; index += 1) {
    gapAnchors.push((centers[index - 1] + centers[index]) / 2);
  }
  gapAnchors.push(100);

  const target = clampPercentage(clickPct);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  gapAnchors.forEach((anchor, gapIndex) => {
    const distance = Math.abs(anchor - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = gapIndex;
    }
  });
  return bestIndex;
}

async function buildAnnotatedImage(sourceImageData, lines) {
  if (!sourceImageData || !Array.isArray(lines) || !lines.length) {
    return sourceImageData;
  }

  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);

        lines.forEach((line, index) => {
          const crop = line?.crop_coordinates || {};
          const x = (Number(crop?.x_start) / 100) * image.naturalWidth;
          const y = (Number(crop?.y_start) / 100) * image.naturalHeight;
          const w =
            ((Number(crop?.x_end) - Number(crop?.x_start)) / 100) *
            image.naturalWidth;
          const h =
            ((Number(crop?.y_end) - Number(crop?.y_start)) / 100) *
            image.naturalHeight;

          context.strokeStyle = "#4c5ad4";
          context.lineWidth = 5;
          context.strokeRect(x, y, w, h);

          context.fillStyle = "#4c5ad4";
          context.fillRect(x, y - 24, 32, 24);
          context.fillStyle = "#fff";
          context.font = "bold 15px Arial";
          context.fillText(String(index + 1), x + 10, y - 7);
        });

        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = reject;
    image.src = sourceImageData;
  });
}

function CroppedLineCard({
  line,
  lineIndex,
  sourceImage,
  wordOffset,
  wordRiskMap,
  onToggleConfirm,
  onCommitTokens,
  editLocked,
}) {
  const [cropImageData, setCropImageData] = useState("");
  const [editorState, setEditorState] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [tokenStripWidthPx, setTokenStripWidthPx] = useState(0);
  const cropImageRef = useRef(null);
  const stripRef = useRef(null);
  const editInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function buildCrop() {
      if (!sourceImage || !line?.crop_coordinates) {
        setCropImageData("");
        return;
      }

      const crop = line.crop_coordinates;
      const image = new Image();
      image.crossOrigin = "anonymous";

      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = sourceImage;
      });

      if (cancelled) return;

      const x = (Number(crop?.x_start) / 100) * image.naturalWidth;
      const y = (Number(crop?.y_start) / 100) * image.naturalHeight;
      const w =
        ((Number(crop?.x_end) - Number(crop?.x_start)) / 100) *
        image.naturalWidth;
      const h =
        ((Number(crop?.y_end) - Number(crop?.y_start)) / 100) *
        image.naturalHeight;

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w));
      canvas.height = Math.max(1, Math.round(h));
      const context = canvas.getContext("2d");
      context.drawImage(image, x, y, w, h, 0, 0, canvas.width, canvas.height);

      if (!cancelled) {
        setCropImageData(canvas.toDataURL("image/png"));
      }
    }

    buildCrop().catch(() => {
      if (!cancelled) setCropImageData("");
    });

    return () => {
      cancelled = true;
    };
  }, [sourceImage, line]);

  const tokenLayout = useMemo(() => buildWordLayout(line), [line]);
  const displayTokens = useMemo(
    () => tokenLayout.map((token) => asText(token?.text)).filter(Boolean),
    [tokenLayout],
  );
  const tokenFontSizePx = useMemo(
    () => resolveTokenFontSizePx(tokenLayout, displayTokens, tokenStripWidthPx),
    [tokenLayout, displayTokens, tokenStripWidthPx],
  );
  const tokenStripHeightPx = useMemo(
    () => Math.max(22, Math.round(tokenFontSizePx * 1.7)),
    [tokenFontSizePx],
  );

  useEffect(() => {
    setEditorState(null);
  }, [line?.text, lineIndex]);

  useEffect(() => {
    if (!editorState || !editInputRef.current) return;
    editInputRef.current.focus();
    editInputRef.current.select();
  }, [editorState?.mode, editorState?.index, lineIndex]);

  function syncTokenStripWidth() {
    const image = cropImageRef.current;
    if (!image) return;
    const width = Math.round(image.getBoundingClientRect().width);
    setTokenStripWidthPx((current) => (current === width ? current : width));
  }

  useEffect(() => {
    if (!cropImageData) {
      setTokenStripWidthPx(0);
      return;
    }

    if (!cropImageRef.current) {
      setTokenStripWidthPx(0);
      return;
    }

    let frameId = null;
    const scheduleMeasure = () => {
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        if (frameId) window.cancelAnimationFrame(frameId);
        frameId = window.requestAnimationFrame(() => {
          syncTokenStripWidth();
        });
        return;
      }
      syncTokenStripWidth();
    };

    syncTokenStripWidth();

    let observer = null;
    if (typeof ResizeObserver !== "undefined" && cropImageRef.current) {
      observer = new ResizeObserver(() => {
        scheduleMeasure();
      });
      observer.observe(cropImageRef.current);
    }

    const handleWindowResize = () => {
      scheduleMeasure();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("resize", handleWindowResize);
    }

    return () => {
      if (observer) observer.disconnect();
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", handleWindowResize);
        if (frameId) window.cancelAnimationFrame(frameId);
      }
    };
  }, [cropImageData, lineIndex]);

  function openWordEditor(tokenIndex) {
    if (editLocked || savingEdit) return;
    const nextValue = displayTokens[tokenIndex] || "";
    setEditorState({
      mode: "replace",
      index: tokenIndex,
      value: nextValue,
    });
  }

  function openInsertEditor(event) {
    if (editLocked || savingEdit) return;
    const stripRect = stripRef.current?.getBoundingClientRect();
    const clickPct = stripRect?.width
      ? ((event.clientX - stripRect.left) / stripRect.width) * 100
      : 0;
    const insertIndex = resolveInsertionIndexFromClick(tokenLayout, clickPct);
    setEditorState({
      mode: "insert",
      index: insertIndex,
      value: "",
    });
  }

  async function saveEditorChanges() {
    if (!editorState || typeof onCommitTokens !== "function") {
      setEditorState(null);
      return;
    }

    const currentTokens = displayTokens;
    const inputTokens = splitWords(editorState.value);
    const nextTokens = [...currentTokens];

    if (editorState.mode === "replace") {
      const replaceAt = Math.min(
        Math.max(0, Number(editorState.index) || 0),
        Math.max(nextTokens.length - 1, 0),
      );
      nextTokens.splice(replaceAt, 1, ...inputTokens);
    } else {
      if (!inputTokens.length) return;
      const insertAt = Math.min(
        Math.max(0, Number(editorState.index) || 0),
        nextTokens.length,
      );
      nextTokens.splice(insertAt, 0, ...inputTokens);
    }

    const normalizedNext = nextTokens.map((token) => asText(token)).filter(Boolean);
    if (normalizedNext.join(" ") === currentTokens.join(" ")) {
      setEditorState(null);
      return;
    }

    setSavingEdit(true);
    try {
      await onCommitTokens(lineIndex, normalizedNext);
      setEditorState(null);
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div
      style={{
        background: "#1a1f35",
        borderRadius: 8,
        padding: "10px clamp(4px, 1.2vw, 12px)",
        width: "100%",
        boxSizing: "border-box",
        border: line?.confirmed
          ? "2px solid rgba(34,197,94,0.8)"
          : "1px solid rgba(148,163,184,0.25)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ color: "#a8b2d6", fontSize: "0.85rem" }}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              marginRight: 6,
              background: "#4c5ad4",
            }}
          />
          Line {lineIndex + 1}
        </div>
        <ConfirmToggleButton
          confirmed={line?.confirmed === true}
          pendingLabel="Confirm"
          confirmedLabel="Confirmed"
          disabled={editLocked || savingEdit}
          onClick={() => onToggleConfirm(lineIndex)}
        />
      </div>

      {cropImageData ? (
        <div
          style={{
            marginTop: 8,
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#000",
            minHeight: 88,
            padding: "6px clamp(2px, 0.8vw, 8px)",
          }}
        >
          <img
            ref={cropImageRef}
            src={cropImageData}
            alt={`Extracted line ${lineIndex + 1}`}
            onLoad={syncTokenStripWidth}
            style={{
              height: 72,
              width: "auto",
              maxWidth: "100%",
              objectFit: "contain",
              borderRadius: 4,
              display: "block",
              background: "#000",
            }}
          />
        </div>
      ) : null}

      <div
        ref={stripRef}
        onClick={openInsertEditor}
        style={{
          marginTop: 8,
          position: "relative",
          width: tokenStripWidthPx > 0 ? `${tokenStripWidthPx}px` : "100%",
          marginLeft: "auto",
          marginRight: "auto",
          minHeight: tokenStripHeightPx,
          cursor: editLocked || savingEdit ? "default" : "text",
        }}
      >
        {tokenLayout.map((token, tokenIndex) => {
          const globalIndex = wordOffset + tokenIndex;
          const risk = wordRiskMap.get(globalIndex) || "";
          const underlineColor = risk === "contained" ? "#ef4444" : risk === "cross-contamination" ? "#fbbf24" : "transparent";
          const isSelected =
            editorState?.mode === "replace" &&
            Number(editorState?.index) === tokenIndex;

          return (
            <button
              key={`${globalIndex}-${token.text}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openWordEditor(tokenIndex);
              }}
              disabled={editLocked || savingEdit}
              style={{
                position: "absolute",
                left: `${token.centerPct}%`,
                transform: "translateX(-50%)",
                top: 0,
                color: "#e2e8f0",
                fontWeight: 600,
                fontSize: `${tokenFontSizePx}px`,
                whiteSpace: "nowrap",
                textDecoration: risk ? "underline" : "none",
                textDecorationColor: underlineColor,
                textDecorationThickness: "2px",
                background: isSelected ? "rgba(124,156,255,0.22)" : "transparent",
                border: isSelected
                  ? "1px solid rgba(124,156,255,0.75)"
                  : "1px solid transparent",
                borderRadius: 4,
                padding: "0 1px",
              }}
            >
              {token.text}
            </button>
          );
        })}
      </div>

      {editorState ? (
        <div
          style={{
            marginTop: 10,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <input
            ref={editInputRef}
            type="text"
            value={editorState.value}
            onChange={(event) => {
              const nextValue = event.target.value;
              setEditorState((current) =>
                current
                  ? {
                      ...current,
                      value: nextValue,
                    }
                  : current,
              );
            }}
            placeholder={editorState.mode === "insert" ? "Enter word" : "Edit word"}
            disabled={editLocked || savingEdit}
            style={{
              flex: "1 1 220px",
              minWidth: 180,
              borderRadius: 8,
              border: "1px solid rgba(148,163,184,0.28)",
              background: "rgba(10,14,34,0.58)",
              color: "#e8ecfa",
              fontSize: "0.84rem",
              padding: "8px 10px",
            }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveEditorChanges();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setEditorState(null);
              }
            }}
          />
          <button
            type="button"
            className="btn"
            style={{ background: "#17663a", padding: "7px 12px", fontSize: "0.82rem" }}
            disabled={
              editLocked ||
              savingEdit ||
              (editorState.mode === "insert" && !splitWords(editorState.value).length)
            }
            onClick={saveEditorChanges}
          >
            {savingEdit ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="btn"
            style={{ background: "#6b7280", padding: "7px 12px", fontSize: "0.82rem" }}
            disabled={savingEdit}
            onClick={() => setEditorState(null)}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <div
        style={{
          marginTop: 6,
          color: "#94a3b8",
          fontSize: "0.74rem",
        }}
      >
        Click a word to edit it, or click empty space to insert a new word.
      </div>
    </div>
  );
}

function buildWordRiskMap(flags, lines, wordOffsets) {
  const map = new Map();
  const tokenCounts = (Array.isArray(lines) ? lines : []).map((line) =>
    splitWords(line?.text).length,
  );

  (Array.isArray(flags) ? flags : []).forEach((flag) => {
    const risk = asText(flag?.risk_type).toLowerCase().includes("cross")
      ? "cross-contamination"
      : "contained";
    const indices = Array.isArray(flag?.word_indices)
      ? flag.word_indices
      : [flag?.word_indices];
    indices.forEach((value) => {
      const idx = Number(value);
      if (!Number.isFinite(idx) || idx < 0) return;

      const resolved = resolveLineTokenIndex(idx, wordOffsets, tokenCounts);
      if (!resolved) return;

      const globalIndex =
        (Number(wordOffsets[resolved.lineIndex]) || 0) + resolved.tokenIndex;
      const current = map.get(globalIndex);
      if (current === "contained") return;
      if (risk === "contained") {
        map.set(globalIndex, "contained");
      } else if (!current) {
        map.set(globalIndex, "cross-contamination");
      }
    });
  });
  return map;
}

function buildGroupedResults(flags) {
  const safeFlags = Array.isArray(flags) ? flags : [];
  const allergenGroups = new Map();
  const dietGroups = new Map();

  const ensureGroup = (map, key) => {
    if (!map.has(key)) {
      map.set(key, {
        contains: new Set(),
        cross: new Set(),
      });
    }
    return map.get(key);
  };

  safeFlags.forEach((flag) => {
    const ingredient = asText(flag?.ingredient) || "Unknown ingredient";
    const isContains = asText(flag?.risk_type).toLowerCase().includes("cross")
      ? false
      : true;

    (Array.isArray(flag?.allergens) ? flag.allergens : []).forEach((allergen) => {
      const name = asText(allergen);
      if (!name) return;
      const group = ensureGroup(allergenGroups, name);
      if (isContains) {
        group.contains.add(ingredient);
      } else {
        group.cross.add(ingredient);
      }
    });

    (Array.isArray(flag?.diets) ? flag.diets : []).forEach((diet) => {
      const name = asText(diet);
      if (!name) return;
      const group = ensureGroup(dietGroups, name);
      if (isContains) {
        group.contains.add(ingredient);
      } else {
        group.cross.add(ingredient);
      }
    });
  });

  const sortEntries = (entries) => {
    return entries.sort((a, b) => {
      const aHasContains = a[1].contains.size > 0;
      const bHasContains = b[1].contains.size > 0;
      if (aHasContains !== bHasContains) {
        return bHasContains ? 1 : -1;
      }
      return a[0].localeCompare(b[0]);
    });
  };

  return {
    allergenEntries: sortEntries(Array.from(allergenGroups.entries())),
    dietEntries: sortEntries(Array.from(dietGroups.entries())),
  };
}

export default function IngredientScanModal({
  open,
  ingredientName,
  supportedDiets,
  backgroundMode = false,
  scanProfile = "default",
  onCancel,
  onRequestHide,
  onPhaseChange,
  onApply,
}) {
  const [capturedPhoto, setCapturedPhoto] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");
  const [analysisResult, setAnalysisResult] = useState(null);
  const [lines, setLines] = useState([]);
  const [allergenFlags, setAllergenFlags] = useState([]);
  const [analysisPending, setAnalysisPending] = useState(false);
  const [annotatedImage, setAnnotatedImage] = useState("");
  const [frontCaptureResult, setFrontCaptureResult] = useState(null);
  const [frontModalOpen, setFrontModalOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const analysisRunIdRef = useRef(0);
  const resolvedScanProfile = asText(scanProfile).toLowerCase() || "default";
  const useDishEditorBrandProfile = resolvedScanProfile === "dish_editor_brand";
  const requiresFrontCaptureFirst = useDishEditorBrandProfile;
  const hasFrontCapture = Boolean(asText(frontCaptureResult?.frontImageData));
  const ingredientCaptureLocked = requiresFrontCaptureFirst && !hasFrontCapture;

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (open) return;
    analysisRunIdRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    setAnalysisPending(false);
    setFrontModalOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open || !requiresFrontCaptureFirst || hasFrontCapture) return;
    setFrontModalOpen(true);
    setStatusText((current) =>
      current || "Capture the product front first, then capture the ingredient label.",
    );
  }, [open, requiresFrontCaptureFirst, hasFrontCapture]);

  useEffect(() => {
    if (!analysisResult?.correctedImage || !lines.length) {
      setAnnotatedImage(analysisResult?.correctedImage || "");
      return;
    }

    let cancelled = false;
    buildAnnotatedImage(analysisResult.correctedImage, lines)
      .then((dataUrl) => {
        if (!cancelled) setAnnotatedImage(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setAnnotatedImage(analysisResult.correctedImage);
      });

    return () => {
      cancelled = true;
    };
  }, [analysisResult?.correctedImage, lines]);

  const wordOffsets = useMemo(() => {
    let offset = 0;
    return lines.map((line) => {
      const current = offset;
      offset += splitWords(line?.text).length;
      return current;
    });
  }, [lines]);

  const wordRiskMap = useMemo(
    () => buildWordRiskMap(allergenFlags, lines, wordOffsets),
    [allergenFlags, lines, wordOffsets],
  );

  const groupedResults = useMemo(
    () => buildGroupedResults(allergenFlags),
    [allergenFlags],
  );

  const totalLines = lines.length;
  const confirmedLines = lines.filter((line) => line?.confirmed).length;
  const allConfirmed = totalLines > 0 && confirmedLines === totalLines;
  const captureActionState = useMemo(() => {
    if (cameraActive) return "camera_live";
    if (analysisResult || lines.length > 0) return "review_ready";
    if (capturedPhoto) return "photo_ready";
    return "initial";
  }, [analysisResult, cameraActive, capturedPhoto, lines.length]);

  function stopActiveCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }

  function resetCaptureState() {
    analysisRunIdRef.current += 1;
    setCapturedPhoto("");
    setAnalysisResult(null);
    setLines([]);
    setAllergenFlags([]);
    setAnalysisPending(false);
    setStatusText("");
    setErrorText("");
    stopActiveCamera();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function cancelLiveCamera() {
    stopActiveCamera();
    setErrorText("");
  }

  async function startCamera() {
    setErrorText("");
    if (isNativeIosCapacitor()) {
      setStatusText("Opening iOS camera picker...");
      fileInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch (error) {
      const errorName = asText(error?.name).toLowerCase();
      const shouldFallbackToPicker =
        errorName === "notallowederror" ||
        errorName === "notreadableerror" ||
        errorName === "overconstrainederror" ||
        errorName === "notfounderror" ||
        errorName === "securityerror";
      if (shouldFallbackToPicker) {
        setStatusText("Live camera preview is unavailable. Opening camera picker instead.");
        fileInputRef.current?.click();
        return;
      }
      setErrorText(error?.message || "Camera access failed.");
    }
  }

  async function captureFrame() {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 0;
    canvas.height = video.videoHeight || 0;
    if (!canvas.width || !canvas.height) {
      setErrorText("Camera is not ready yet.");
      return;
    }

    canvas.getContext("2d").drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

    stopActiveCamera();
    setCapturedPhoto(dataUrl);
    setStatusText("Photo captured. Click Analyze.");
    setErrorText("");
  }

  async function handleUploadChange(event) {
    const file = event.target.files?.[0] || null;
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      stopActiveCamera();
      setCapturedPhoto(dataUrl);
      setStatusText("Photo loaded. Click Analyze.");
      setErrorText("");
    } catch (error) {
      setErrorText(error?.message || "Failed to load image.");
    } finally {
      if (event?.target) {
        event.target.value = "";
      }
    }
  }

  async function runAllergenAnalysis(lineRows, statusMessage = "Analyzing ingredients...") {
    const runId = analysisRunIdRef.current + 1;
    analysisRunIdRef.current = runId;
    const isCurrentRun = () => analysisRunIdRef.current === runId;
    const setIfCurrent = (setter, value) => {
      if (isCurrentRun()) setter(value);
    };

    const transcript = (Array.isArray(lineRows) ? lineRows : [])
      .map((line) => asText(line?.text))
      .filter(Boolean);

    if (!transcript.length) {
      setIfCurrent(setAllergenFlags, []);
      setIfCurrent(setAnalysisPending, false);
      return;
    }

    setIfCurrent(setAnalysisPending, true);
    setIfCurrent(setErrorText, "");
    setIfCurrent(setStatusText, statusMessage);
    try {
      const flags = await analyzeTranscriptFlags(transcript);
      if (!isCurrentRun()) return;
      setAllergenFlags(Array.isArray(flags) ? flags : []);
      setStatusText("Allergen and diet analysis complete.");
    } catch (error) {
      if (!isCurrentRun()) return;
      const message = error?.message || "Allergen analysis failed.";
      setAllergenFlags([]);
      setStatusText(message);
      setErrorText(message);
      throw error;
    } finally {
      setIfCurrent(setAnalysisPending, false);
    }
  }

  async function analyzePhoto() {
    if (!capturedPhoto || analysisBusy || analysisPending || applying) return;
    setAnalysisBusy(true);
    setErrorText("");
    if (backgroundMode) {
      onPhaseChange?.({
        phase: "processing",
        message: "Analyzing ingredient label in background...",
      });
      onRequestHide?.();
    }

    try {
      const result = await analyzeIngredientLabelImage(capturedPhoto, {
        onStatus: (message) => setStatusText(message),
        skipAllergenAnalysis: true,
        skipSlantCorrection: useDishEditorBrandProfile,
      });

      const nextLines = (Array.isArray(result?.lines) ? result.lines : []).map((line) => ({
        ...line,
        confirmed: false,
      }));

      setAnalysisResult(result);
      setLines(nextLines);
      setAllergenFlags([]);
      setStatusText("Text extracted. Running allergen analysis...");

      await runAllergenAnalysis(nextLines);
      if (backgroundMode) {
        onPhaseChange?.({
          phase: "ready_for_review",
          message: "Scan is ready for review.",
        });
      }
    } catch (error) {
      const message = error?.message || "Unable to analyze the photo.";
      setErrorText(message);
      if (backgroundMode) {
        onPhaseChange?.({
          phase: "failed",
          message,
          error: message,
        });
      }
    } finally {
      setAnalysisBusy(false);
    }
  }

  async function commitLineTokens(lineIndex, tokens) {
    const nextTokens = (Array.isArray(tokens) ? tokens : [])
      .map((token) => asText(token))
      .filter(Boolean);

    let nextLines = [];
    setLines((current) => {
      nextLines = current.map((line, idx) => {
        const nextText = idx === lineIndex ? nextTokens.join(" ") : asText(line?.text);
        return {
          ...line,
          text: nextText,
          words: rebuildLineWordBoxes(line, nextText),
          confirmed: false,
        };
      });
      return nextLines;
    });

    if (!nextLines.length) return;
    setAllergenFlags([]);
    try {
      await runAllergenAnalysis(nextLines, "Updating analysis...");
    } catch {
      // Error state is handled by runAllergenAnalysis.
    }
  }

  function toggleLineConfirmed(lineIndex) {
    setLines((current) =>
      current.map((line, idx) => {
        if (idx !== lineIndex) return line;
        return {
          ...line,
          confirmed: !line.confirmed,
        };
      }),
    );
  }

  async function applyResults(front) {
    if (applying) return;

    setApplying(true);
    setErrorText("");

    try {
      const finalLines = lines
        .map((line) => asText(line?.text))
        .filter(Boolean);

      const ingredientText = finalLines.join(" ");
      const containedAllergens = new Set();
      const crossAllergens = new Set();
      const violatedDiets = new Set();
      const crossDiets = new Set();

      allergenFlags.forEach((flag) => {
        const isContains = asText(flag?.risk_type).toLowerCase().includes("cross")
          ? false
          : true;

        (Array.isArray(flag?.allergens) ? flag.allergens : []).forEach((allergen) => {
          const name = asText(allergen);
          if (!name) return;
          if (isContains) containedAllergens.add(name);
          else crossAllergens.add(name);
        });

        (Array.isArray(flag?.diets) ? flag.diets : []).forEach((diet) => {
          const name = asText(diet);
          if (!name) return;
          if (isContains) {
            violatedDiets.add(name);
          } else {
            crossDiets.add(name);
          }
        });
      });

      const diets = dedupeStrings(
        (Array.isArray(supportedDiets) ? supportedDiets : []).filter(
          (diet) => !violatedDiets.has(diet) && !crossDiets.has(diet),
        ),
      );

      let persistedBrandImage = asText(front?.frontImageData);
      if (persistedBrandImage) {
        try {
          const compressed = await prepareAnalysisImage(persistedBrandImage, 640, 0.62);
          persistedBrandImage = asText(compressed?.imageData) || persistedBrandImage;
        } catch {
          // Keep original capture if compression fails.
        }
      }

      let persistedIngredientsImage = asText(analysisResult?.correctedImage);
      if (persistedIngredientsImage) {
        try {
          const compressed = await prepareAnalysisImage(persistedIngredientsImage, 900, 0.72);
          persistedIngredientsImage =
            asText(compressed?.imageData) || persistedIngredientsImage;
        } catch {
          // Keep original corrected image if compression fails.
        }
      }

      await onApply?.({
        ingredientName: asText(ingredientName),
        ingredientText,
        allergens: Array.from(containedAllergens),
        crossContaminationAllergens: Array.from(crossAllergens),
        diets,
        crossContaminationDiets: Array.from(crossDiets),
        brandImage: persistedBrandImage,
        ingredientsImage: persistedIngredientsImage,
        ingredientsList: finalLines,
        productName: asText(front?.productName),
      });
      return;
    } catch (error) {
      setErrorText(error?.message || "Failed to apply analysis.");
      setApplying(false);
      return;
    }
  }

  return (
    <>
      <Modal
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) return;
          const hasReviewState =
            Boolean(analysisResult) ||
            lines.length > 0 ||
            analysisBusy ||
            analysisPending ||
            applying;
          if (backgroundMode && hasReviewState) {
            onRequestHide?.();
            return;
          }
          onCancel?.();
        }}
        title="Capture Ingredient List"
        className="w-[calc(100vw-1.5rem)] max-w-[860px] max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-3 sm:p-5"
        closeOnEsc={!analysisBusy && !analysisPending && !applying}
        closeOnOverlay={!analysisBusy && !analysisPending && !applying}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%" }}>
          <div style={{ color: "#a8b2d6", fontSize: "0.92rem" }}>
            Ingredient: <strong style={{ color: "#fff" }}>{ingredientName}</strong>
          </div>

          <div
            style={{
              position: "relative",
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid rgba(148,163,184,0.24)",
              background: "#000",
              minHeight: 300,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {cameraActive ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                style={{ width: "100%", maxHeight: 420, objectFit: "contain" }}
              />
            ) : analysisResult?.correctedImage ? (
              <img
                src={annotatedImage || analysisResult.correctedImage}
                alt="Detected ingredient lines"
                style={{ width: "100%", maxHeight: 420, objectFit: "contain" }}
              />
            ) : capturedPhoto ? (
              <img
                src={capturedPhoto}
                alt="Ingredient label preview"
                style={{ width: "100%", maxHeight: 420, objectFit: "contain" }}
              />
            ) : (
              <div style={{ color: "#94a3b8", fontSize: "0.9rem" }}>
                {ingredientCaptureLocked
                  ? "Capture the product front first to continue."
                  : "Capture or upload an ingredient label photo."}
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "nowrap",
              overflowX: "auto",
              justifyContent: "center",
              alignItems: "center",
              gap: 8,
            }}
          >
            {ingredientCaptureLocked ? (
              <button
                type="button"
                className="btn"
                style={{ background: "#4c5ad4" }}
                disabled={analysisBusy || analysisPending || applying}
                onClick={() => setFrontModalOpen(true)}
              >
                Capture image of item front
              </button>
            ) : (
              <>
                {captureActionState === "initial" ? (
                  <>
                    <button
                      type="button"
                      className="btn"
                      style={{ background: "#4c5ad4" }}
                      disabled={analysisBusy || analysisPending || applying}
                      onClick={startCamera}
                    >
                      Use Camera
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ background: "#4c5ad4" }}
                      disabled={analysisBusy || analysisPending || applying}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Upload Photo
                    </button>
                  </>
                ) : null}

                {captureActionState === "camera_live" ? (
                  <>
                    <button
                      type="button"
                      className="btn"
                      style={{ background: "#17663a" }}
                      disabled={analysisBusy || analysisPending || applying}
                      onClick={captureFrame}
                    >
                      Capture
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ background: "#6b7280" }}
                      disabled={analysisBusy || analysisPending || applying}
                      onClick={cancelLiveCamera}
                    >
                      Cancel Camera
                    </button>
                  </>
                ) : null}

                {captureActionState === "photo_ready" ? (
                  <>
                    <button
                      type="button"
                      className="btn"
                      style={{ background: "#17663a" }}
                      disabled={!capturedPhoto || analysisBusy || analysisPending || applying}
                      onClick={analyzePhoto}
                    >
                      {analysisBusy ? "Analyzing..." : "Analyze"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ background: "#6b7280" }}
                      disabled={analysisBusy || analysisPending || applying}
                      onClick={resetCaptureState}
                    >
                      Retake
                    </button>
                  </>
                ) : null}

                {captureActionState === "review_ready" ? (
                  <button
                    type="button"
                    className="btn"
                    style={{ background: "#6b7280" }}
                    disabled={analysisBusy || analysisPending || applying}
                    onClick={resetCaptureState}
                  >
                    Retake
                  </button>
                ) : null}
              </>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={handleUploadChange}
            />
          </div>

          {statusText ? (
            <div style={{ color: "#a8b2d6", fontSize: "0.87rem" }}>{statusText}</div>
          ) : null}

          {errorText ? (
            <div
              style={{
                border: "1px solid rgba(239,68,68,0.5)",
                background: "rgba(127,29,29,0.28)",
                color: "#fecaca",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: "0.86rem",
              }}
            >
              {errorText}
            </div>
          ) : null}

          {lines.length ? (
            <div
              style={{
                background: "rgba(76,90,212,0.08)",
                border: "1px solid rgba(76,90,212,0.3)",
                borderRadius: 12,
                padding: "12px clamp(6px, 1.5vw, 14px)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                width: "100%",
                boxSizing: "border-box",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 600, color: "#fff" }}>Extracted Ingredient Lines</div>
                <div
                  style={{
                    color: allConfirmed ? "#22c55e" : "#f59e0b",
                    fontSize: "0.85rem",
                  }}
                >
                  {confirmedLines}/{totalLines} lines confirmed
                </div>
              </div>

              {lines.map((line, index) => (
                <CroppedLineCard
                  key={`line-${index}`}
                  line={line}
                  lineIndex={index}
                  sourceImage={analysisResult?.correctedImage || capturedPhoto}
                  wordOffset={wordOffsets[index] || 0}
                  wordRiskMap={wordRiskMap}
                  onToggleConfirm={toggleLineConfirmed}
                  onCommitTokens={commitLineTokens}
                  editLocked={analysisBusy || analysisPending || applying}
                />
              ))}
            </div>
          ) : null}

          {lines.length ? (
            <div
              style={{
                background: "rgba(76,90,212,0.08)",
                border: "1px solid rgba(76,90,212,0.3)",
                borderRadius: 12,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ fontWeight: 600, color: "#fff" }}>Allergen and Diet Analysis</div>

              {!allergenFlags.length && !analysisPending && !errorText ? (
                <div style={{ color: "#4ade80", fontSize: "0.86rem" }}>
                  No allergens or diet violations detected.
                </div>
              ) : (
                <>
                  <div style={{ color: "#fff", fontWeight: 600 }}>Allergens</div>
                  {groupedResults.allergenEntries.map(([name, group]) => {
                    const contains = Array.from(group.contains).sort((a, b) => a.localeCompare(b));
                    const cross = Array.from(group.cross).sort((a, b) => a.localeCompare(b));
                    return (
                      <div
                        key={`allergen-${name}`}
                        style={{
                          border: "1px solid rgba(148,163,184,0.28)",
                          borderRadius: 8,
                          padding: "10px 12px",
                          background: "rgba(15,23,42,0.45)",
                        }}
                      >
                        <div style={{ color: "#fff", fontWeight: 600 }}>{name}</div>
                        {contains.length ? (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ color: "#ef4444", fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase" }}>
                              Contains
                            </div>
                            <ul style={{ margin: "4px 0 0 18px", color: "#e2e8f0", fontSize: "0.84rem" }}>
                              {contains.map((item) => (
                                <li key={`${name}-contains-${item}`}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {cross.length ? (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ color: "#fbbf24", fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase" }}>
                              Cross-contamination
                            </div>
                            <ul style={{ margin: "4px 0 0 18px", color: "#e2e8f0", fontSize: "0.84rem" }}>
                              {cross.map((item) => (
                                <li key={`${name}-cross-${item}`}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  <div style={{ color: "#fff", fontWeight: 600, marginTop: 4 }}>Diets</div>
                  {groupedResults.dietEntries.map(([name, group]) => {
                    const contains = Array.from(group.contains).sort((a, b) => a.localeCompare(b));
                    const cross = Array.from(group.cross).sort((a, b) => a.localeCompare(b));
                    return (
                      <div
                        key={`diet-${name}`}
                        style={{
                          border: "1px solid rgba(148,163,184,0.28)",
                          borderRadius: 8,
                          padding: "10px 12px",
                          background: "rgba(15,23,42,0.45)",
                        }}
                      >
                        <div style={{ color: "#fff", fontWeight: 600 }}>{name}</div>
                        {contains.length ? (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ color: "#ef4444", fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase" }}>
                              Violation
                            </div>
                            <ul style={{ margin: "4px 0 0 18px", color: "#e2e8f0", fontSize: "0.84rem" }}>
                              {contains.map((item) => (
                                <li key={`${name}-contains-${item}`}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {cross.length ? (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ color: "#fbbf24", fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase" }}>
                              Cross-contamination
                            </div>
                            <ul style={{ margin: "4px 0 0 18px", color: "#e2e8f0", fontSize: "0.84rem" }}>
                              {cross.map((item) => (
                                <li key={`${name}-cross-${item}`}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          ) : null}

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              flexWrap: "nowrap",
              overflowX: "auto",
              gap: 10,
            }}
          >
            <button
              type="button"
              className="btn"
              style={{ background: "#ef4444" }}
              disabled={analysisBusy || analysisPending || applying}
              onClick={() => {
                const hasReviewState =
                  Boolean(analysisResult) ||
                  lines.length > 0 ||
                  analysisBusy ||
                  analysisPending ||
                  applying;
                if (backgroundMode && hasReviewState) {
                  onRequestHide?.();
                  return;
                }
                onCancel?.();
              }}
            >
              Cancel
            </button>
            {requiresFrontCaptureFirst ? (
              <>
                <button
                  type="button"
                  className="btn"
                  style={{ background: "#6b7280" }}
                  disabled={analysisBusy || analysisPending || applying}
                  onClick={() => setFrontModalOpen(true)}
                >
                  {hasFrontCapture ? "Retake item front image" : "Capture image of item front"}
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ background: "#17663a" }}
                  disabled={!hasFrontCapture || !allConfirmed || analysisPending || applying}
                  onClick={() => applyResults(frontCaptureResult)}
                >
                  {applying ? "Applying..." : "Save & Apply Results"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn"
                style={{ background: "#17663a" }}
                disabled={!allConfirmed || analysisPending || applying}
                onClick={() => setFrontModalOpen(true)}
              >
                Capture image of item front
              </button>
            )}
          </div>
        </div>
      </Modal>

      <FrontProductCaptureModal
        open={frontModalOpen}
        onCancel={() => {
          setFrontModalOpen(false);
          if (requiresFrontCaptureFirst && !hasFrontCapture) {
            onCancel?.();
          }
        }}
        applyButtonLabel={
          requiresFrontCaptureFirst
            ? "Capture ingredient label image"
            : "Save & Apply Results"
        }
        applyingButtonLabel={requiresFrontCaptureFirst ? "Continuing..." : "Applying..."}
        onApply={async (frontResult) => {
          setFrontCaptureResult(frontResult || null);
          setFrontModalOpen(false);
          setErrorText("");
          if (requiresFrontCaptureFirst) {
            setStatusText("Product front captured. Now capture the ingredient label.");
            return;
          }
          await applyResults(frontResult);
        }}
      />
    </>
  );
}
