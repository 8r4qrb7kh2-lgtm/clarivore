"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../ui";
import FrontProductCaptureModal from "./FrontProductCaptureModal";
import {
  analyzeIngredientLabelImage,
  analyzeTranscriptFlags,
  buildWordLayout,
  rebuildLineWordBoxes,
} from "./analysisClient";

function asText(value) {
  return String(value ?? "").trim();
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
  onUpdateText,
}) {
  const [cropImageData, setCropImageData] = useState("");

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

  return (
    <div
      style={{
        background: "#1a1f35",
        borderRadius: 8,
        padding: 12,
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
        <button
          type="button"
          className="btn"
          style={{
            background: line?.confirmed ? "#17663a" : "#f59e0b",
            border: line?.confirmed
              ? "2px solid #22c55e"
              : "2px solid #d97706",
            padding: "7px 14px",
            fontSize: "0.84rem",
            minWidth: 100,
          }}
          onClick={() => onToggleConfirm(lineIndex)}
        >
          {line?.confirmed ? "Confirmed" : "Confirm"}
        </button>
      </div>

      {cropImageData ? (
        <img
          src={cropImageData}
          alt={`Extracted line ${lineIndex + 1}`}
          style={{
            width: "100%",
            borderRadius: 4,
            marginTop: 8,
            display: "block",
            background: "#000",
          }}
        />
      ) : null}

      <div
        style={{
          marginTop: 8,
          position: "relative",
          width: "100%",
          minHeight: 24,
        }}
      >
        {tokenLayout.map((token, tokenIndex) => {
          const globalIndex = wordOffset + tokenIndex;
          const risk = wordRiskMap.get(globalIndex) || "";
          const underlineColor = risk === "contained" ? "#ef4444" : risk === "cross-contamination" ? "#fbbf24" : "transparent";

          return (
            <span
              key={`${globalIndex}-${token.text}`}
              style={{
                position: "absolute",
                left: `${token.centerPct}%`,
                transform: "translateX(-50%)",
                top: 0,
                color: "#e2e8f0",
                fontWeight: 600,
                fontSize: "0.8rem",
                whiteSpace: "nowrap",
                textDecoration: risk ? "underline" : "none",
                textDecorationColor: underlineColor,
                textDecorationThickness: "2px",
              }}
            >
              {token.text}
            </span>
          );
        })}
      </div>

      <textarea
        value={line?.text || ""}
        onChange={(event) => onUpdateText(lineIndex, event.target.value)}
        style={{
          marginTop: 10,
          width: "100%",
          minHeight: 54,
          resize: "vertical",
          borderRadius: 8,
          border: "1px solid rgba(148,163,184,0.28)",
          background: "rgba(10,14,34,0.58)",
          color: "#e8ecfa",
          fontSize: "0.84rem",
          padding: "8px 10px",
        }}
      />
    </div>
  );
}

function buildWordRiskMap(flags) {
  const map = new Map();
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
      const current = map.get(idx);
      if (current === "contained") return;
      if (risk === "contained") {
        map.set(idx, "contained");
      } else if (!current) {
        map.set(idx, "cross-contamination");
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
  onCancel,
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
  const [frontModalOpen, setFrontModalOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const reanalysisTimerRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setCapturedPhoto("");
      setCameraActive(false);
      setAnalysisBusy(false);
      setStatusText("");
      setErrorText("");
      setAnalysisResult(null);
      setLines([]);
      setAllergenFlags([]);
      setAnalysisPending(false);
      setAnnotatedImage("");
      setFrontModalOpen(false);
      setApplying(false);

      if (reanalysisTimerRef.current) {
        clearTimeout(reanalysisTimerRef.current);
        reanalysisTimerRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (reanalysisTimerRef.current) {
        clearTimeout(reanalysisTimerRef.current);
      }
    };
  }, []);

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

  const wordRiskMap = useMemo(() => buildWordRiskMap(allergenFlags), [allergenFlags]);

  const groupedResults = useMemo(
    () => buildGroupedResults(allergenFlags),
    [allergenFlags],
  );

  const totalLines = lines.length;
  const confirmedLines = lines.filter((line) => line?.confirmed).length;
  const allConfirmed = totalLines > 0 && confirmedLines === totalLines;

  async function startCamera() {
    setErrorText("");
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

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setCameraActive(false);
    setCapturedPhoto(dataUrl);
    setStatusText("Photo captured. Click Analyze.");
    setErrorText("");
  }

  async function handleUploadChange(event) {
    const file = event.target.files?.[0] || null;
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCapturedPhoto(dataUrl);
      setCameraActive(false);
      setStatusText("Photo loaded. Click Analyze.");
      setErrorText("");
    } catch (error) {
      setErrorText(error?.message || "Failed to load image.");
    }
  }

  async function runAllergenAnalysis(lineRows, statusMessage = "Analyzing ingredients...") {
    const transcript = (Array.isArray(lineRows) ? lineRows : [])
      .map((line) => asText(line?.text))
      .filter(Boolean);

    if (!transcript.length) {
      setAllergenFlags([]);
      setAnalysisPending(false);
      return;
    }

    setAnalysisPending(true);
    setStatusText(statusMessage);
    try {
      const flags = await analyzeTranscriptFlags(transcript);
      setAllergenFlags(Array.isArray(flags) ? flags : []);
      setStatusText("Allergen and diet analysis complete.");
    } catch {
      setStatusText("Allergen analysis failed. Using previous results.");
    } finally {
      setAnalysisPending(false);
    }
  }

  async function analyzePhoto() {
    if (!capturedPhoto || analysisBusy) return;
    setAnalysisBusy(true);
    setErrorText("");

    try {
      const result = await analyzeIngredientLabelImage(capturedPhoto, {
        onStatus: (message) => setStatusText(message),
        skipAllergenAnalysis: true,
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
    } catch (error) {
      setErrorText(error?.message || "Unable to analyze the photo.");
    } finally {
      setAnalysisBusy(false);
    }
  }

  function updateLineText(lineIndex, value) {
    setLines((current) => {
      const next = current.map((line, idx) => {
        if (idx !== lineIndex) return line;
        const nextText = asText(value);
        return {
          ...line,
          text: nextText,
          words: rebuildLineWordBoxes(line, nextText),
          confirmed: false,
        };
      });

      if (reanalysisTimerRef.current) {
        clearTimeout(reanalysisTimerRef.current);
      }
      reanalysisTimerRef.current = setTimeout(() => {
        runAllergenAnalysis(next, "Updating analysis...");
      }, 350);

      return next;
    });
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

      await onApply?.({
        ingredientName: asText(ingredientName),
        ingredientText,
        allergens: Array.from(containedAllergens),
        crossContaminationAllergens: Array.from(crossAllergens),
        diets,
        crossContaminationDiets: Array.from(crossDiets),
        brandImage: asText(front?.frontImageData),
        ingredientsImage: asText(analysisResult?.correctedImage),
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
          if (!nextOpen) onCancel?.();
        }}
        title="Capture Ingredient List"
        className="max-w-[860px]"
        closeOnEsc={!analysisBusy && !analysisPending && !applying}
        closeOnOverlay={!analysisBusy && !analysisPending && !applying}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
                Capture or upload an ingredient label photo.
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {!cameraActive ? (
              <>
                <button
                  type="button"
                  className="btn"
                  style={{ background: "#4c5ad4" }}
                  disabled={analysisBusy || applying}
                  onClick={startCamera}
                >
                  Use Camera
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ background: "#4c5ad4" }}
                  disabled={analysisBusy || applying}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload Photo
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn"
                style={{ background: "#17663a" }}
                disabled={analysisBusy || applying}
                onClick={captureFrame}
              >
                Capture
              </button>
            )}

            <button
              type="button"
              className="btn"
              style={{ background: "#17663a" }}
              disabled={!capturedPhoto || analysisBusy || applying}
              onClick={analyzePhoto}
            >
              {analysisBusy ? "Analyzing..." : "Analyze"}
            </button>

            <button
              type="button"
              className="btn"
              style={{ background: "#6b7280" }}
              disabled={analysisBusy || applying}
              onClick={() => {
                setCapturedPhoto("");
                setAnalysisResult(null);
                setLines([]);
                setAllergenFlags([]);
                setStatusText("");
                setErrorText("");
                if (streamRef.current) {
                  streamRef.current.getTracks().forEach((track) => track.stop());
                  streamRef.current = null;
                }
                setCameraActive(false);
              }}
            >
              Retake
            </button>

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
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 12,
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
                  onUpdateText={updateLineText}
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

              {!allergenFlags.length ? (
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

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              type="button"
              className="btn"
              style={{ background: "#ef4444" }}
              disabled={analysisBusy || analysisPending || applying}
              onClick={() => onCancel?.()}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              style={{ background: "#17663a" }}
              disabled={!allConfirmed || analysisPending || applying}
              onClick={() => setFrontModalOpen(true)}
            >
              Capture image of item front
            </button>
          </div>
        </div>
      </Modal>

      <FrontProductCaptureModal
        open={frontModalOpen}
        onCancel={() => setFrontModalOpen(false)}
        onApply={async (frontResult) => {
          setFrontModalOpen(false);
          await applyResults(frontResult);
        }}
      />
    </>
  );
}
