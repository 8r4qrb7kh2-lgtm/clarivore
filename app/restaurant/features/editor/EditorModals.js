"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppLoadingScreen from "../../../components/AppLoadingScreen";
import { Button, Input, Modal } from "../../../components/ui";
import {
  asText,
  normalizeToken,
  fileToDataUrl,
  normalizePageIndexList,
  remapPageIndexListForMove,
  remapPageIndexListForRemove,
  parseChangePayload,
  collectRenderedChangeSummaryTokens,
  formatChangeText,
  renderChangeLine,
  formatLogTimestamp,
  ReviewRowGroupedList,
} from "./editorUtils";

// Change log modal focuses on human-readable change history + review row drill-down.
function ChangeLogModal({ editor }) {
  const [expandedRowsByLog, setExpandedRowsByLog] = useState({});

  useEffect(() => {
    if (editor.changeLogOpen) return;
    setExpandedRowsByLog({});
  }, [editor.changeLogOpen]);

  return (
    <Modal
      open={editor.changeLogOpen}
      onOpenChange={(open) => editor.setChangeLogOpen(open)}
      title="Change Log"
      className="max-w-[860px]"
    >
      {editor.loadingChangeLogs ? (
        <p className="note">Loading change log...</p>
      ) : editor.changeLogError ? (
        <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
          {editor.changeLogError}
        </p>
      ) : !editor.changeLogs.length ? (
        <p className="note">No changes recorded yet.</p>
      ) : (
        <div className="space-y-3 max-h-[65vh] overflow-auto pr-1">
          {editor.changeLogs.map((log) => {
            // Parse both legacy and structured payloads so old entries still render correctly.
            const parsed = parseChangePayload(log);
            const items = parsed?.items && typeof parsed.items === "object" ? parsed.items : {};
            const general = Array.isArray(parsed?.general)
              ? parsed.general
              : parsed?.general != null
                ? [parsed.general]
                : [];
            const renderedSummaryTokens = collectRenderedChangeSummaryTokens(general, items);
            const seenReviewTokens = new Set();
            const reviewRows = (Array.isArray(parsed?.reviewRows) ? parsed.reviewRows : [])
              .filter((row) => row && typeof row === "object")
              .filter((row) => {
                const summary = asText(row?.summary);
                if (!summary) return false;
                const token = normalizeToken(summary);
                if (!token) return true;
                if (renderedSummaryTokens.has(token) || seenReviewTokens.has(token)) {
                  return false;
                }
                seenReviewTokens.add(token);
                return true;
              });
            const author = formatChangeText(parsed?.author || log.description || "Manager");
            const photos = Array.isArray(log?.photos)
              ? log.photos
                  .map((photo) => (typeof photo === "string" ? photo.trim() : ""))
                  .filter(Boolean)
              : [];

            return (
              <div key={log.id || `${log.timestamp}-${log.type}`} className="rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.75)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#e9eefc]">
                    {author || "Manager"}
                  </span>
                  <span className="text-xs text-[#a7b2d1]">{formatLogTimestamp(log.timestamp)}</span>
                </div>

                {general.length ? (
                  <ul className="mt-2 mb-0 list-disc pl-5 text-sm text-[#cfd8f7]">
                    {general.map((line, index) => renderChangeLine(line, `${log.id}-general-${index}`))}
                  </ul>
                ) : null}

                {Object.entries(items).map(([dishName, changes]) => (
                  <div key={`${log.id}-${dishName}`} className="mt-2">
                    <div className="text-sm font-medium text-[#dbe3ff]">{dishName}</div>
                    <ul className="mb-0 mt-1 list-disc pl-5 text-sm text-[#c7d2f4]">
                      {(Array.isArray(changes) ? changes : [changes])
                        .filter((line) => line != null)
                        .map((line, idx) => renderChangeLine(line, `${log.id}-${dishName}-${idx}`))}
                    </ul>
                  </div>
                ))}

                {reviewRows.length ? (
                  <div className="mt-2">
                    <div className="text-sm font-medium text-[#dbe3ff]">Review rows</div>
                    <div className="mt-1">
                      <ReviewRowGroupedList
                        rows={reviewRows}
                        expandedRows={expandedRowsByLog}
                        rowKeyPrefix={`log-${asText(log.id || log.timestamp || "entry")}-`}
                        onToggleRow={(rowKey) =>
                          setExpandedRowsByLog((current) => ({
                            ...current,
                            [rowKey]: !current[rowKey],
                          }))
                        }
                      />
                    </div>
                  </div>
                ) : null}

                {photos.length ? (
                  // Evidence photos are kept as raw links, then rendered as compact thumbnails.
                  <div className="mt-2 flex flex-wrap gap-2">
                    {photos.map((photo, index) => (
                      <a
                        key={`${log.id}-photo-${index}`}
                        href={photo}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={photo}
                          alt={`Change log photo ${index + 1}`}
                          className="h-[64px] w-[96px] rounded border border-[#2a3261] object-cover"
                        />
                      </a>
                    ))}
                  </div>
                ) : null}

              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button
          size="compact"
          tone="neutral"
          onClick={() => editor.setChangeLogOpen(false)}
        >
          Close
        </Button>
      </div>
    </Modal>
  );
}

// Save review modal is the final checkpoint before committing write operations.
function SaveReviewModal({ editor, open, onOpenChange, onConfirmSave }) {
  const [expandedRows, setExpandedRows] = useState({});
  const changes = useMemo(
    () => (Array.isArray(editor.pendingSaveRows) ? editor.pendingSaveRows : []),
    [editor.pendingSaveRows],
  );

  useEffect(() => {
    if (open) return;
    setExpandedRows({});
  }, [open]);

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          editor.clearPendingSaveBatch();
        }
      }}
      title="Review your changes"
      className="max-w-[760px]"
    >
      <div className="space-y-3">
        <p className="note m-0 text-sm">Confirm everything looks right before saving to the website.</p>

        {!changes.length ? (
          <p className="note m-0">No changes detected for this save.</p>
        ) : (
          <div className="max-h-[52vh] space-y-2 overflow-auto pr-1">
            <ReviewRowGroupedList
              rows={changes}
              expandedRows={expandedRows}
              rowKeyPrefix="pending-change-"
              onToggleRow={(rowKey) =>
                setExpandedRows((current) => ({
                  ...current,
                  [rowKey]: !current[rowKey],
                }))
              }
            />
          </div>
        )}

        {editor.pendingSaveError ? (
          <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
            {editor.pendingSaveError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            size="compact"
            variant="outline"
            onClick={() => {
              editor.clearPendingSaveBatch();
              onOpenChange(false);
            }}
          >
            Cancel save
          </Button>
          <Button
            size="compact"
            tone="primary"
            loading={editor.isSaving || editor.pendingSavePreparing}
            disabled={editor.isSaving || editor.pendingSavePreparing || !editor.pendingSaveBatchId}
            onClick={onConfirmSave}
          >
            Confirm &amp; Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Confirmation flow collects proof photos before manager attestation is submitted.
const CONFIRM_INFO_MAX_PHOTOS = 6;
const CONFIRM_INFO_TARGET_PHOTO_BYTES = 320 * 1024;
const CONFIRM_INFO_MAX_PHOTO_EDGE = 1600;
const CONFIRM_INFO_COMPRESSION_QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58];

function estimateDataUrlBytes(dataUrl) {
  const safe = asText(dataUrl);
  if (!safe.startsWith("data:")) return safe.length;
  const commaIndex = safe.indexOf(",");
  if (commaIndex < 0) return safe.length;
  const base64 = safe.slice(commaIndex + 1);
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function loadDataUrlImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image for compression."));
    image.src = dataUrl;
  });
}

async function compressConfirmPhotoDataUrl(dataUrl) {
  const safe = asText(dataUrl);
  if (!safe) return "";
  if (!safe.startsWith("data:image/")) return safe;
  if (estimateDataUrlBytes(safe) <= CONFIRM_INFO_TARGET_PHOTO_BYTES) {
    return safe;
  }

  try {
    const image = await loadDataUrlImage(safe);
    const naturalWidth = Number(image?.naturalWidth || image?.width) || 0;
    const naturalHeight = Number(image?.naturalHeight || image?.height) || 0;
    if (!naturalWidth || !naturalHeight) return safe;

    const largestEdge = Math.max(naturalWidth, naturalHeight);
    const scale = Math.min(1, CONFIRM_INFO_MAX_PHOTO_EDGE / largestEdge);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return safe;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    let bestCandidate = "";
    let bestSize = Number.POSITIVE_INFINITY;

    for (const quality of CONFIRM_INFO_COMPRESSION_QUALITIES) {
      const candidate = canvas.toDataURL("image/jpeg", quality);
      const candidateSize = estimateDataUrlBytes(candidate);
      if (candidateSize < bestSize) {
        bestCandidate = candidate;
        bestSize = candidateSize;
      }
      if (candidateSize <= CONFIRM_INFO_TARGET_PHOTO_BYTES) {
        return candidate;
      }
    }

    return bestCandidate || safe;
  } catch {
    return safe;
  }
}

function ConfirmInfoModal({ editor }) {
  const [photos, setPhotos] = useState([]);
  const [step, setStep] = useState("capture");
  const [uploadError, setUploadError] = useState("");
  const hasPhotos = photos.length > 0;

  useEffect(() => {
    if (!editor.confirmInfoOpen) {
      setPhotos([]);
      setStep("capture");
      setUploadError("");
    }
  }, [editor.confirmInfoOpen]);

  useEffect(() => {
    if (hasPhotos) return;
    setStep("capture");
  }, [hasPhotos]);

  const addFiles = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setUploadError("");
    const remainingSlots = Math.max(CONFIRM_INFO_MAX_PHOTOS - photos.length, 0);
    if (!remainingSlots) {
      setUploadError(`You can upload up to ${CONFIRM_INFO_MAX_PHOTOS} photos.`);
      return;
    }

    const acceptedFiles = list.slice(0, remainingSlots);
    const values = [];
    let failedCount = 0;
    for (const file of acceptedFiles) {
      // eslint-disable-next-line no-await-in-loop
      const url = await fileToDataUrl(file).catch(() => "");
      if (!url) {
        failedCount += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const compressed = await compressConfirmPhotoDataUrl(url);
      if (!compressed) {
        failedCount += 1;
        continue;
      }
      values.push(compressed);
    }
    if (values.length) {
      setPhotos((current) => [...current, ...values]);
    }

    const issues = [];
    if (list.length > acceptedFiles.length) {
      issues.push(`Only ${CONFIRM_INFO_MAX_PHOTOS} photos can be attached.`);
    }
    if (failedCount > 0) {
      issues.push(`Could not process ${failedCount} photo(s).`);
    }
    setUploadError(issues.join(" "));
  };

  return (
    <Modal
      open={editor.confirmInfoOpen}
      onOpenChange={(open) => editor.setConfirmInfoOpen(open)}
      title="Confirm Allergen Information"
      className="max-w-[820px]"
    >
      <div className="space-y-3">
        <p className="note m-0 text-sm">
          Take photos of your current menu to confirm that it aligns with the menu on Clarivore.
        </p>

        <div className="flex items-center gap-2">
          <label className="btn" htmlFor="confirm-photos-input">
            Upload photos
          </label>
          <input
            id="confirm-photos-input"
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            className="hidden"
            onChange={async (event) => {
              await addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <span className="text-xs text-[#a7b2d1]">{photos.length} photo(s)</span>
        </div>

        {!hasPhotos ? (
          <div className="rounded-lg border border-[#2a3261] bg-[rgba(6,10,28,0.55)] p-3 text-sm text-[#ced8f8]">
            Upload at least one menu photo to continue.
          </div>
        ) : null}

        {photos.length ? (
          <div className="flex flex-wrap gap-2">
            {photos.map((photo, index) => (
              <div key={`confirm-photo-${index}`} className="relative">
                <img
                  src={photo}
                  alt={`Menu confirmation ${index + 1}`}
                  className="h-[72px] w-[110px] rounded border border-[#2a3261] object-cover"
                />
                <button
                  type="button"
                  className="btn btnDanger"
                  style={{
                    position: "absolute",
                    top: -8,
                    right: -8,
                    width: 22,
                    height: 22,
                    minWidth: 22,
                    padding: 0,
                    borderRadius: "50%",
                  }}
                  onClick={() =>
                    setPhotos((current) => current.filter((_, i) => i !== index))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {hasPhotos && step === "capture" ? (
          <div className="rounded-lg border border-[#2a3261] bg-[rgba(6,10,28,0.55)] p-3 text-sm text-[#ced8f8]">
            Are all dishes clearly visible in these photos?
            <div className="mt-2 flex gap-2">
              <Button size="compact" tone="success" onClick={() => setStep("current")}>✓ Yes</Button>
              <Button
                size="compact"
                tone="danger"
                onClick={() => {
                  setPhotos([]);
                  setStep("capture");
                }}
              >
                ✗ No
              </Button>
            </div>
          </div>
        ) : null}

        {hasPhotos && step === "current" ? (
          <div className="rounded-lg border border-[#2a3261] bg-[rgba(6,10,28,0.55)] p-3 text-sm text-[#ced8f8]">
            Are these photos of your most current menu?
            <div className="mt-2 flex gap-2">
              <Button
                size="compact"
                tone="success"
                loading={editor.confirmBusy}
                disabled={!hasPhotos || editor.confirmBusy}
                onClick={async () => {
                  if (!hasPhotos) {
                    setStep("capture");
                    setUploadError("Upload at least one menu photo before confirming.");
                    return;
                  }
                  const result = await editor.confirmInfo(photos);
                  if (result?.success) {
                    editor.setConfirmInfoOpen(false);
                  }
                }}
              >
                ✓ Yes, confirm
              </Button>
              <Button
                size="compact"
                tone="danger"
                onClick={() => editor.setConfirmInfoOpen(false)}
              >
                ✗ Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {uploadError ? (
          <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
            {uploadError}
          </p>
        ) : null}

        {editor.confirmError ? (
          <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
            {editor.confirmError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

// Menu page management tracks page reordering/replacement and maps changes back to analysis inputs.
function MenuPagesModal({ editor }) {
  const replaceInputsRef = useRef({});
  const addInputRef = useRef(null);
  const [sessionSnapshot, setSessionSnapshot] = useState(null);
  const [pageSourceIndexMap, setPageSourceIndexMap] = useState([]);
  const [imageChangedPageIndices, setImageChangedPageIndices] = useState([]);
  const [removeUnmatchedPageIndices, setRemoveUnmatchedPageIndices] = useState([]);
  const [sessionDirty, setSessionDirty] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const wasOpenRef = useRef(false);

  const markSessionDirty = useCallback(() => {
    setSessionDirty(true);
  }, []);

  const markImagePageChanged = useCallback((pageIndex) => {
    const safePage = Math.max(0, Math.floor(Number(pageIndex) || 0));
    setSessionDirty(true);
    setImageChangedPageIndices((current) =>
      current.includes(safePage) ? current : [...current, safePage],
    );
    setRemoveUnmatchedPageIndices((current) =>
      current.includes(safePage) ? current : [...current, safePage],
    );
  }, []);

  useEffect(() => {
    if (editor.menuPagesOpen && !wasOpenRef.current) {
      const snapshot =
        typeof editor.createDraftSnapshot === "function"
          ? editor.createDraftSnapshot()
          : null;
      setSessionSnapshot(snapshot);
      const snapshotImages = Array.isArray(snapshot?.menuImages)
        ? snapshot.menuImages
        : [];
      const sourceMap = snapshotImages.map((_, index) => index);
      setPageSourceIndexMap(sourceMap);
      setImageChangedPageIndices([]);
      setRemoveUnmatchedPageIndices([]);
      setSessionDirty(false);
      setSaveBusy(false);
      setUploadBusy(false);
      setSaveError("");
      setSaveNotice("");
    } else if (!editor.menuPagesOpen && wasOpenRef.current) {
      setSessionSnapshot(null);
      setPageSourceIndexMap([]);
      setImageChangedPageIndices([]);
      setRemoveUnmatchedPageIndices([]);
      setSessionDirty(false);
      setSaveBusy(false);
      setUploadBusy(false);
      setSaveError("");
      setSaveNotice("");
    }

    wasOpenRef.current = editor.menuPagesOpen;
  }, [editor.createDraftSnapshot, editor.menuPagesOpen]);

  const closeMenuModal = useCallback(() => {
    editor.setMenuPagesOpen(false);
  }, [editor]);

  const handleCancel = useCallback(() => {
    if (saveBusy || uploadBusy) return;
    if (sessionSnapshot && typeof editor.restoreDraftSnapshot === "function") {
      editor.restoreDraftSnapshot(sessionSnapshot);
    }
    closeMenuModal();
  }, [closeMenuModal, editor.restoreDraftSnapshot, saveBusy, sessionSnapshot, uploadBusy]);

  const handleSave = useCallback(async () => {
    if (saveBusy || uploadBusy) return;
    setSaveError("");
    setSaveNotice("");

    if (!sessionDirty) {
      closeMenuModal();
      return;
    }

    const pageCount = Math.max(editor.draftMenuImages.length, 1);
    // Only changed pages are re-analyzed to keep save latency predictable.
    const pagesToAnalyze = normalizePageIndexList(imageChangedPageIndices, pageCount);
    const pagesToRemoveUnmatched = normalizePageIndexList(
      removeUnmatchedPageIndices,
      pageCount,
    );
    const sourceMap =
      Array.isArray(pageSourceIndexMap) && pageSourceIndexMap.length
        ? pageSourceIndexMap
        : Array.from({ length: pageCount }, (_, index) => index);
    const baselineMenuImages = Array.isArray(sessionSnapshot?.menuImages)
      ? sessionSnapshot.menuImages
      : [];
    const baselineOverlays = Array.isArray(sessionSnapshot?.overlays)
      ? sessionSnapshot.overlays
      : [];

    if (!pagesToAnalyze.length) {
      closeMenuModal();
      return;
    }

    setSaveBusy(true);
    try {
      const result = await editor.analyzeMenuPagesAndMergeOverlays({
        pageIndices: pagesToAnalyze,
        removeUnmatchedPageIndices: pagesToRemoveUnmatched,
        requireDetectionsForPageIndices: pagesToAnalyze,
        pageSourceIndexMap: sourceMap,
        baselineMenuImages,
        baselineOverlays,
      });

      if (!result?.success) {
        const errorLines = Array.isArray(result?.errors) ? result.errors : [];
        const firstError = errorLines[0] || "Failed to run menu analysis.";
        const suffix =
          errorLines.length > 1 ? ` (${errorLines.length} pages failed)` : "";
        setSaveError(`${firstError}${suffix}`);
        return;
      }

      setSaveNotice(
        `Analysis complete: ${result.updatedCount || 0} updated, ${result.addedCount || 0} added, ${result.removedCount || 0} removed.`,
      );
      closeMenuModal();
    } catch (error) {
      setSaveError(error?.message || "Failed to run menu analysis.");
    } finally {
      setSaveBusy(false);
    }
  }, [
    closeMenuModal,
    editor.analyzeMenuPagesAndMergeOverlays,
    editor.draftMenuImages.length,
    imageChangedPageIndices,
    pageSourceIndexMap,
    removeUnmatchedPageIndices,
    saveBusy,
    uploadBusy,
    sessionSnapshot?.menuImages,
    sessionSnapshot?.overlays,
    sessionDirty,
  ]);

  return (
    <Modal
      open={editor.menuPagesOpen}
      onOpenChange={(open) => {
        if (open) {
          editor.setMenuPagesOpen(true);
          return;
        }
        handleCancel();
      }}
      title="Edit menu images"
      className="max-w-[980px]"
      closeOnOverlay={false}
      closeOnEsc={false}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="compact"
            variant="outline"
            disabled={saveBusy || uploadBusy}
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button
            size="compact"
            tone="primary"
            loading={saveBusy || uploadBusy}
            disabled={uploadBusy}
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            size="compact"
            tone="primary"
            disabled={saveBusy || uploadBusy}
            onClick={() => addInputRef.current?.click()}
          >
            Add Page
          </Button>
          <input
            ref={addInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setUploadBusy(true);
              try {
                const image = await fileToDataUrl(file);
                editor.addMenuPage(image);
                setPageSourceIndexMap((current) => [...current, null]);
                markImagePageChanged(editor.draftMenuImages.length);
              } finally {
                event.target.value = "";
                setUploadBusy(false);
              }
            }}
          />
        </div>

        {saveNotice ? (
          <p className="m-0 rounded-lg border border-[#2a3261] bg-[rgba(12,18,44,0.62)] px-3 py-2 text-sm text-[#ced8f8]">
            {saveNotice}
          </p>
        ) : null}

        {saveError ? (
          <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
            {saveError}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {editor.draftMenuImages.map((image, index) => (
            <div
              key={`menu-page-${index}`}
              className="rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.8)] p-2"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-[#c4cfec]">Page {index + 1}</span>
                <div className="flex gap-1">
                  <Button
                    size="compact"
                    variant="outline"
                    disabled={saveBusy || uploadBusy || index <= 0}
                    className="min-w-[30px] px-2"
                    onClick={() => {
                      const pageCount = Math.max(editor.draftMenuImages.length, 1);
                      editor.moveMenuPage(index, index - 1);
                      setPageSourceIndexMap((current) => {
                        const next = [...current];
                        if (index <= 0 || index >= next.length) return current;
                        const [moved] = next.splice(index, 1);
                        next.splice(index - 1, 0, moved);
                        return next;
                      });
                      setImageChangedPageIndices((current) =>
                        remapPageIndexListForMove(current, index, index - 1, pageCount),
                      );
                      setRemoveUnmatchedPageIndices((current) =>
                        remapPageIndexListForMove(current, index, index - 1, pageCount),
                      );
                      markSessionDirty();
                    }}
                    title="Move page up"
                    aria-label={`Move page ${index + 1} up`}
                  >
                    ↑
                  </Button>
                  <Button
                    size="compact"
                    variant="outline"
                    disabled={saveBusy || uploadBusy || index >= editor.draftMenuImages.length - 1}
                    className="min-w-[30px] px-2"
                    onClick={() => {
                      const pageCount = Math.max(editor.draftMenuImages.length, 1);
                      editor.moveMenuPage(index, index + 1);
                      setPageSourceIndexMap((current) => {
                        const next = [...current];
                        if (index < 0 || index >= next.length - 1) return current;
                        const [moved] = next.splice(index, 1);
                        next.splice(index + 1, 0, moved);
                        return next;
                      });
                      setImageChangedPageIndices((current) =>
                        remapPageIndexListForMove(current, index, index + 1, pageCount),
                      );
                      setRemoveUnmatchedPageIndices((current) =>
                        remapPageIndexListForMove(current, index, index + 1, pageCount),
                      );
                      markSessionDirty();
                    }}
                    title="Move page down"
                    aria-label={`Move page ${index + 1} down`}
                  >
                    ↓
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-[#2a3261] bg-[#070b16] p-1">
                {image ? (
                  <img
                    src={image}
                    alt={`Menu page ${index + 1}`}
                    className="h-[180px] w-full rounded object-contain"
                  />
                ) : (
                  <div className="flex h-[180px] items-center justify-center text-xs text-[#9ea9c8]">
                    No image
                  </div>
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="compact"
                  variant="outline"
                  disabled={saveBusy || uploadBusy}
                  onClick={() => replaceInputsRef.current[index]?.click()}
                >
                  Replace
                </Button>
                {editor.draftMenuImages.length > 1 ? (
                  <Button
                    size="compact"
                    tone="danger"
                    variant="outline"
                    disabled={saveBusy || uploadBusy}
                    onClick={() => {
                      const pageCount = Math.max(editor.draftMenuImages.length, 1);
                      editor.removeMenuPage(index);
                      setPageSourceIndexMap((current) =>
                        current.filter((_, sourceIndex) => sourceIndex !== index),
                      );
                      setImageChangedPageIndices((current) =>
                        remapPageIndexListForRemove(current, index, pageCount),
                      );
                      setRemoveUnmatchedPageIndices((current) =>
                        remapPageIndexListForRemove(current, index, pageCount),
                      );
                      markSessionDirty();
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>

              <input
                ref={(node) => {
                  replaceInputsRef.current[index] = node;
                }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setUploadBusy(true);
                  try {
                    const imageData = await fileToDataUrl(file);
                    editor.replaceMenuPage(index, imageData);
                    markImagePageChanged(index);
                  } finally {
                    event.target.value = "";
                    setUploadBusy(false);
                  }
                }}
              />
            </div>
          ))}
        </div>
      </div>
      {uploadBusy ? <AppLoadingScreen label="menu image upload" /> : null}
    </Modal>
  );
}

// Restaurant settings modal is intentionally narrow: draft fields + save/cancel.
function RestaurantSettingsModal({ editor }) {
  return (
    <Modal
      open={editor.restaurantSettingsOpen}
      onOpenChange={(open) => editor.setRestaurantSettingsOpen(open)}
      title="Restaurant settings"
      className="max-w-[720px]"
    >
      <div className="space-y-3">
        <label className="space-y-1 text-sm text-[#bdd0ff] block">
          Website
          <Input
            value={editor.restaurantSettingsDraft.website || ""}
            onChange={(event) =>
              editor.setRestaurantSettingsDraft((current) => ({
                ...current,
                website: event.target.value,
              }))
            }
          />
        </label>

        <label className="space-y-1 text-sm text-[#bdd0ff] block">
          Phone
          <Input
            value={editor.restaurantSettingsDraft.phone || ""}
            onChange={(event) =>
              editor.setRestaurantSettingsDraft((current) => ({
                ...current,
                phone: event.target.value,
              }))
            }
          />
        </label>

        <label className="space-y-1 text-sm text-[#bdd0ff] block">
          Delivery URL
          <Input
            value={editor.restaurantSettingsDraft.delivery_url || ""}
            onChange={(event) =>
              editor.setRestaurantSettingsDraft((current) => ({
                ...current,
                delivery_url: event.target.value,
              }))
            }
          />
        </label>

        <label className="space-y-1 text-sm text-[#bdd0ff] block">
          Menu URL
          <Input
            value={editor.restaurantSettingsDraft.menu_url || ""}
            onChange={(event) =>
              editor.setRestaurantSettingsDraft((current) => ({
                ...current,
                menu_url: event.target.value,
              }))
            }
          />
        </label>

        {editor.settingsSaveError ? (
          <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
            {editor.settingsSaveError}
          </p>
        ) : null}

        <div className="flex gap-2 justify-end">
          <Button
            size="compact"
            variant="outline"
            onClick={() => editor.setRestaurantSettingsOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="compact"
            tone="primary"
            loading={editor.settingsSaveBusy}
            onClick={async () => {
              const result = await editor.saveRestaurantSettings();
              if (result?.success) {
                editor.setRestaurantSettingsOpen(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}


export {
  ChangeLogModal,
  SaveReviewModal,
  ConfirmInfoModal,
  MenuPagesModal,
  RestaurantSettingsModal,
};
