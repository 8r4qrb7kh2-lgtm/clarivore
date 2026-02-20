"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../ui";
import { analyzeFrontProductName, prepareAnalysisImage } from "./analysisClient";

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

const FRONT_PRIMARY_MAX_EDGE = 840;
const FRONT_PRIMARY_QUALITY = 0.76;
const FRONT_RETRY_MAX_EDGE = 640;
const FRONT_RETRY_QUALITY = 0.62;

async function readFileAsDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

export default function FrontProductCaptureModal({
  open,
  onCancel,
  onApply,
}) {
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [hint, setHint] = useState("");
  const [hintTone, setHintTone] = useState("neutral");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);

  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  async function normalizeFrontPhoto(
    imageDataUrl,
    maxEdge = FRONT_PRIMARY_MAX_EDGE,
    quality = FRONT_PRIMARY_QUALITY,
  ) {
    const prepared = await prepareAnalysisImage(imageDataUrl, maxEdge, quality);
    return asText(prepared?.imageData) || asText(imageDataUrl);
  }

  useEffect(() => {
    if (!open) {
      setPhotoDataUrl("");
      setProductName("");
      setHint("");
      setHintTone("neutral");
      setAnalyzing(false);
      setSaving(false);
      setError("");
      setCameraActive(false);

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
    };
  }, []);

  const hintColor = useMemo(() => {
    if (hintTone === "success") return "#22c55e";
    if (hintTone === "warn") return "#f59e0b";
    if (hintTone === "error") return "#ef4444";
    return "#94a3b8";
  }, [hintTone]);

  const captureActionState = useMemo(() => {
    if (cameraActive) return "camera_live";
    if (photoDataUrl) return "photo_ready";
    return "initial";
  }, [cameraActive, photoDataUrl]);

  function stopActiveCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }

  function resetCaptureState() {
    setPhotoDataUrl("");
    setProductName("");
    setHint("");
    setHintTone("neutral");
    setError("");
    stopActiveCamera();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function runFrontAnalysis(imageDataUrl) {
    if (!imageDataUrl) return;

    setAnalyzing(true);
    setError("");
    let activeImage = imageDataUrl;

    const applyDetectedName = (result) => {
      const detected = asText(result?.productName);
      const confidence = asText(result?.confidence).toLowerCase() || "low";

      if (detected && confidence !== "low") {
        setProductName(detected);
        if (confidence === "high") {
          setHint("Product identified automatically");
          setHintTone("success");
        } else {
          setHint("Please verify the product name");
          setHintTone("warn");
        }
      } else {
        setProductName("");
        setHint("Could not identify product - please enter name manually");
        setHintTone("error");
      }
    };

    try {
      try {
        const result = await analyzeFrontProductName(activeImage);
        applyDetectedName(result);
      } catch (analysisError) {
        if (Number(analysisError?.status) === 413) {
          activeImage = await normalizeFrontPhoto(
            activeImage,
            FRONT_RETRY_MAX_EDGE,
            FRONT_RETRY_QUALITY,
          );
          setPhotoDataUrl(activeImage);
          const retryResult = await analyzeFrontProductName(activeImage);
          applyDetectedName(retryResult);
        } else {
          throw analysisError;
        }
      }
    } catch (analysisError) {
      setHint("Could not analyze front image - enter name manually");
      setHintTone("error");
      if (Number(analysisError?.status) === 413) {
        setError(
          "Image is too large for automatic name detection. Enter the product name manually.",
        );
      } else {
        setError(analysisError?.message || "Failed to analyze front image.");
      }
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleUploadChange(event) {
    const file = event.target.files?.[0] || null;
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      stopActiveCamera();
      const normalized = await normalizeFrontPhoto(dataUrl);
      setPhotoDataUrl(normalized);
      await runFrontAnalysis(normalized);
    } catch (uploadError) {
      setError(uploadError?.message || "Failed to load image.");
    } finally {
      if (event?.target) {
        event.target.value = "";
      }
    }
  }

  async function startCamera() {
    setError("");
    if (isNativeIosCapacitor()) {
      setHint("Opening iOS camera picker...");
      setHintTone("neutral");
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
    } catch (cameraError) {
      const errorName = asText(cameraError?.name).toLowerCase();
      const shouldFallbackToPicker =
        errorName === "notallowederror" ||
        errorName === "notreadableerror" ||
        errorName === "overconstrainederror" ||
        errorName === "notfounderror" ||
        errorName === "securityerror";
      if (shouldFallbackToPicker) {
        setHint("Live camera preview unavailable. Opening camera picker.");
        setHintTone("warn");
        fileInputRef.current?.click();
        return;
      }
      setError(cameraError?.message || "Camera access failed.");
    }
  }

  async function captureCameraFrame() {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 0;
    canvas.height = video.videoHeight || 0;
    if (!canvas.width || !canvas.height) {
      setError("Camera is not ready yet.");
      return;
    }

    canvas.getContext("2d").drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);

    stopActiveCamera();
    const normalized = await normalizeFrontPhoto(dataUrl);
    setPhotoDataUrl(normalized);
    await runFrontAnalysis(normalized);
  }

  async function applyAndClose() {
    if (!photoDataUrl || saving) return;
    setSaving(true);
    setError("");

    try {
      const compressed = await prepareAnalysisImage(
        photoDataUrl,
        FRONT_RETRY_MAX_EDGE,
        FRONT_RETRY_QUALITY,
      );
      await onApply?.({
        frontImageData: compressed.imageData,
        productName: asText(productName),
      });
    } catch (applyError) {
      setError(applyError?.message || "Failed to apply front image.");
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel?.();
      }}
      title="Capture Product Front"
      className="w-[calc(100vw-1.5rem)] max-w-[760px] max-h-[calc(100dvh-1.5rem)] overflow-y-auto"
      closeOnEsc={!saving && !analyzing}
      closeOnOverlay={!saving && !analyzing}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#a8b2d6", fontSize: "0.92rem" }}>
          Capture or upload the front of the product for thumbnail and product name detection.
        </div>

        <div
          style={{
            position: "relative",
            borderRadius: 10,
            border: "1px solid rgba(148,163,184,0.25)",
            background: "#000",
            overflow: "hidden",
            minHeight: 260,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {cameraActive ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ width: "100%", maxHeight: 360, objectFit: "contain" }}
            />
          ) : photoDataUrl ? (
            <img
              src={photoDataUrl}
              alt="Front product preview"
              style={{ width: "100%", maxHeight: 360, objectFit: "contain" }}
            />
          ) : (
            <div style={{ color: "#94a3b8", fontSize: "0.9rem" }}>No front image selected yet.</div>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {captureActionState === "initial" ? (
            <>
              <button
                type="button"
                className="btn"
                style={{ background: "#4c5ad4" }}
                disabled={analyzing || saving}
                onClick={startCamera}
              >
                Use Camera
              </button>
              <button
                type="button"
                className="btn"
                style={{ background: "#4c5ad4" }}
                disabled={analyzing || saving}
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
                disabled={analyzing || saving}
                onClick={captureCameraFrame}
              >
                Capture
              </button>
              <button
                type="button"
                className="btn"
                style={{ background: "#6b7280" }}
                disabled={analyzing || saving}
                onClick={stopActiveCamera}
              >
                Cancel Camera
              </button>
            </>
          ) : null}

          {captureActionState === "photo_ready" ? (
            <button
              type="button"
              className="btn"
              style={{ background: "#6b7280" }}
              disabled={analyzing || saving}
              onClick={resetCaptureState}
            >
              Retake
            </button>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={handleUploadChange}
          />
        </div>

        {analyzing ? (
          <div style={{ color: "#a8b2d6", fontSize: "0.9rem" }}>Identifying product...</div>
        ) : null}

        {photoDataUrl ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ color: "#a8b2d6", fontSize: "0.85rem" }} htmlFor="front-product-name-input">
              Product Name
            </label>
            <input
              id="front-product-name-input"
              value={productName}
              onChange={(event) => setProductName(event.target.value)}
              placeholder="Enter product name"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid rgba(148,163,184,0.3)",
                background: "rgba(0,0,0,0.24)",
                color: "#fff",
                fontSize: "0.95rem",
              }}
            />
            {hint ? (
              <div style={{ color: hintColor, fontSize: "0.82rem" }}>{hint}</div>
            ) : null}
          </div>
        ) : null}

        {error ? (
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
            {error}
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            type="button"
            className="btn"
            style={{ background: "#ef4444" }}
            disabled={saving}
            onClick={() => onCancel?.()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            style={{ background: "#17663a" }}
            disabled={!photoDataUrl || saving || analyzing}
            onClick={applyAndClose}
          >
            {saving ? "Applying..." : "Save & Apply Results"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
