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
  normalizeBrandEntry,
  normalizeIngredientEntry,
  deriveDishStateFromIngredients,
} from "./editorUtils";
import { compareConfirmInfoImages } from "./editorServices";

function getReviewModalMenuImages(editor) {
  return Array.isArray(editor?.draftMenuImages) ? editor.draftMenuImages : [];
}

function hasReviewRowMenuImageRefs(row) {
  const pageList = Array.isArray(row?.menuImagePages)
    ? row.menuImagePages
    : row?.menuImagePage != null
      ? [row.menuImagePage]
      : [];
  return pageList.some((value) => Number.isFinite(Number(value)) && Number(value) >= 0);
}

// Change log modal focuses on human-readable change history + review row drill-down.
function ChangeLogModal({ editor }) {
  const [expandedRowsByLog, setExpandedRowsByLog] = useState({});
  const menuImages = useMemo(() => getReviewModalMenuImages(editor), [editor]);

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
                if (hasReviewRowMenuImageRefs(row)) {
                  return true;
                }
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
                        menuImages={menuImages}
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
  const menuImages = useMemo(() => getReviewModalMenuImages(editor), [editor]);
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
              menuImages={menuImages}
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

function normalizeBrandKey(value) {
  return asText(value).toLowerCase();
}

function resolveBrandVerificationKey(brand) {
  const brandName = asText(brand?.name || brand?.productName);
  const barcodeKey = normalizeBrandKey(brand?.barcode);
  const nameKey = normalizeBrandKey(brandName);
  if (barcodeKey) return `barcode:${barcodeKey}`;
  if (nameKey) return `name:${nameKey}`;
  return "";
}

function resolveOverlayDishName(overlay, fallbackIndex = 0) {
  return (
    asText(overlay?.id) ||
    asText(overlay?.dish_name) ||
    asText(overlay?.label) ||
    asText(overlay?.name) ||
    `Dish ${fallbackIndex + 1}`
  );
}

function readOverlayIngredients(overlay) {
  if (overlay?.aiIngredients) {
    try {
      const parsed = JSON.parse(overlay.aiIngredients);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      // Fall back to direct ingredient array.
    }
  }
  return Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];
}

function collectBrandVerificationItems(overlays) {
  const items = new Map();

  (Array.isArray(overlays) ? overlays : []).forEach((overlay, overlayIndex) => {
    const dishName = resolveOverlayDishName(overlay, overlayIndex);
    const ingredients = readOverlayIngredients(overlay);

    ingredients.forEach((ingredient) => {
      const ingredientName = asText(ingredient?.name);
      const brands = Array.isArray(ingredient?.brands) ? ingredient.brands : [];
      brands.forEach((brand) => {
        const brandName = asText(brand?.name);
        if (!brandName) return;

        const itemKey = resolveBrandVerificationKey(brand);
        if (!itemKey) return;

        if (!items.has(itemKey)) {
          items.set(itemKey, {
            key: itemKey,
            brandName,
            baselineImage: asText(brand?.brandImage || brand?.image || brand?.ingredientsImage),
            dishes: new Set(),
            ingredientNames: new Set(),
          });
        }

        const item = items.get(itemKey);
        if (!item.baselineImage) {
          item.baselineImage = asText(brand?.brandImage || brand?.image || brand?.ingredientsImage);
        }
        if (dishName) item.dishes.add(dishName);
        if (ingredientName) item.ingredientNames.add(ingredientName);
      });
    });
  });

  return Array.from(items.values())
    .map((item, index) => ({
      id: `brand-${index}-${item.key}`,
      key: item.key,
      label: item.brandName || "Brand item",
      baselineImage: item.baselineImage,
      dishes: Array.from(item.dishes),
      ingredientNames: Array.from(item.ingredientNames),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function resolveConfirmStatusColor(status) {
  if (status === "matched") return "#22c55e";
  if (status === "mismatched") return "#f87171";
  if (status === "replaced") return "#60a5fa";
  if (status === "removed") return "#fbbf24";
  if (status === "error" || status === "blocked") return "#fca5a5";
  if (status === "matching") return "#93c5fd";
  return "#a7b2d1";
}

function createMenuCard(image, index) {
  return {
    id: `menu-page-${index}`,
    label: `Menu page ${index + 1}`,
    baselineImage: asText(image),
    candidateImage: "",
    status: asText(image) ? "idle" : "blocked",
    message: asText(image)
      ? "Capture or replace with a current photo to run comparison."
      : "No baseline menu image was found for this page.",
    differences: [],
    confidence: "low",
    selectedAction: "",
    removed: false,
  };
}

function createBrandCard(item) {
  const baselineImage = asText(item?.baselineImage);
  return {
    id: asText(item?.id),
    brandKey: asText(item?.key),
    label: asText(item?.label) || "Brand item",
    baselineImage,
    candidateImage: "",
    status: baselineImage ? "idle" : "blocked",
    message: baselineImage
      ? "Capture or replace with a current photo to run comparison."
      : "No baseline brand image was found for this item.",
    differences: [],
    confidence: "low",
    selectedAction: "",
    dishes: Array.isArray(item?.dishes) ? item.dishes : [],
    ingredientNames: Array.isArray(item?.ingredientNames) ? item.ingredientNames : [],
  };
}

function ConfirmInfoCard({
  card,
  replaceInputRef,
  captureInputRef,
  busy,
  onRemove,
  onReplace,
  onPickReplace,
  onPickCapture,
  showRemove = true,
  replaceWithFile = true,
}) {
  const statusColor = resolveConfirmStatusColor(card.status);
  const selectedAction = asText(card?.selectedAction).toLowerCase();
  const removeSelected = selectedAction === "remove";
  const replaceSelected = selectedAction === "replace";
  const captureSelected = selectedAction === "capture";
  return (
    <div className="min-w-[300px] max-w-[300px] rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.82)] p-3">
      <div className="text-xs font-semibold text-[#e6ecff]">{card.label}</div>
      {card.dishes?.length ? (
        <div className="mt-1 text-[11px] text-[#9fb0df]">
          Used in: {card.dishes.slice(0, 2).join(", ")}
          {card.dishes.length > 2 ? ` +${card.dishes.length - 2} more` : ""}
        </div>
      ) : null}
      {card.ingredientNames?.length ? (
        <div className="mt-1 text-[11px] text-[#9fb0df]">
          Ingredients: {card.ingredientNames.slice(0, 2).join(", ")}
          {card.ingredientNames.length > 2 ? ` +${card.ingredientNames.length - 2} more` : ""}
        </div>
      ) : null}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1 text-[11px] text-[#a7b2d1]">Saved</div>
          <div className="h-[110px] rounded border border-[#2a3261] bg-[#070b16] p-1">
            {card.baselineImage ? (
              <img
                src={card.baselineImage}
                alt={`${card.label} baseline`}
                className="h-full w-full rounded object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[11px] text-[#9ea9c8]">
                Missing baseline
              </div>
            )}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-[#a7b2d1]">Current</div>
          <div className="h-[110px] rounded border border-[#2a3261] bg-[#070b16] p-1">
            {card.candidateImage ? (
              <img
                src={card.candidateImage}
                alt={`${card.label} current`}
                className="h-full w-full rounded object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[11px] text-[#9ea9c8]">
                No current photo
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2">
        {showRemove ? (
          <Button
            size="compact"
            variant={removeSelected ? "solid" : "outline"}
            tone={removeSelected ? "danger" : "neutral"}
            disabled={busy || card.status === "matching"}
            onClick={onRemove}
          >
            {card.removed ? "Undo remove" : "Remove"}
          </Button>
        ) : null}
        <Button
          size="compact"
          variant={replaceSelected ? "solid" : "outline"}
          tone={replaceSelected ? "primary" : "neutral"}
          disabled={busy || card.status === "matching"}
          onClick={() => {
            if (replaceWithFile) {
              replaceInputRef.current?.click();
              return;
            }
            onReplace?.();
          }}
        >
          Replace
        </Button>
        <Button
          size="compact"
          variant={captureSelected ? "solid" : "outline"}
          tone={captureSelected ? "success" : "neutral"}
          disabled={busy || card.status === "matching"}
          onClick={() => captureInputRef.current?.click()}
        >
          Capture photo of current version
        </Button>
      </div>

      {replaceWithFile ? (
        <input
          ref={replaceInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPickReplace}
        />
      ) : null}
      <input
        ref={captureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPickCapture}
      />

      <div className="mt-2 text-xs" style={{ color: statusColor }}>
        {card.status === "matching" ? "Comparing images..." : card.message}
      </div>
      {Array.isArray(card.differences) && card.differences.length ? (
        <ul className="mb-0 mt-2 list-disc pl-4 text-[11px] text-[#ffb9b9]">
          {card.differences.slice(0, 3).map((line, index) => (
            <li key={`${card.id}-difference-${index}`}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ConfirmInfoModal({ editor }) {
  const [step, setStep] = useState("menu");
  const [menuCards, setMenuCards] = useState([]);
  const [brandCards, setBrandCards] = useState([]);
  const [allDishesVisible, setAllDishesVisible] = useState(null);
  const [mostCurrent, setMostCurrent] = useState(null);
  const [flowError, setFlowError] = useState("");
  const [menuComparisonBusy, setMenuComparisonBusy] = useState(false);
  const [brandReplacementBusyCardId, setBrandReplacementBusyCardId] = useState("");

  const menuReplaceInputRefs = useRef({});
  const menuCaptureInputRefs = useRef({});
  const brandReplaceInputRefs = useRef({});
  const brandCaptureInputRefs = useRef({});
  const getCardInputRef = useCallback((store, cardId) => {
    if (!store.current[cardId]) {
      store.current[cardId] = { current: null };
    }
    return store.current[cardId];
  }, []);

  const updateMenuCard = useCallback((cardId, updater) => {
    setMenuCards((current) =>
      current.map((card) => {
        if (card.id !== cardId) return card;
        if (typeof updater === "function") return updater(card);
        return { ...card, ...updater };
      }),
    );
  }, []);

  const updateBrandCard = useCallback((cardId, updater) => {
    setBrandCards((current) =>
      current.map((card) => {
        if (card.id !== cardId) return card;
        if (typeof updater === "function") return updater(card);
        return { ...card, ...updater };
      }),
    );
  }, []);

  useEffect(() => {
    if (!editor.confirmInfoOpen) {
      setStep("menu");
      setMenuCards([]);
      setBrandCards([]);
      setAllDishesVisible(null);
      setMostCurrent(null);
      setFlowError("");
      setMenuComparisonBusy(false);
      setBrandReplacementBusyCardId("");
      menuReplaceInputRefs.current = {};
      menuCaptureInputRefs.current = {};
      brandReplaceInputRefs.current = {};
      brandCaptureInputRefs.current = {};
      return;
    }

    const snapshot =
      typeof editor.getBaselineSnapshot === "function" ? editor.getBaselineSnapshot() : null;
    const baselineMenuImagesRaw = Array.isArray(snapshot?.menuImages) ? snapshot.menuImages : [];
    const draftMenuImagesRaw = Array.isArray(editor.draftMenuImages) ? editor.draftMenuImages : [];
    const baselineMenuImages = (baselineMenuImagesRaw.length
      ? baselineMenuImagesRaw
      : draftMenuImagesRaw
    )
      .map((value) => asText(value))
      .filter(Boolean);
    const baselineOverlays = Array.isArray(snapshot?.overlays) ? snapshot.overlays : [];
    const menuPageCards = baselineMenuImages.map((image, index) => createMenuCard(image, index));
    const brandItems = collectBrandVerificationItems(baselineOverlays);
    const brandItemCards = brandItems.map((item) => createBrandCard(item));

    setStep("menu");
    setMenuCards(menuPageCards);
    setBrandCards(brandItemCards);
    setAllDishesVisible(null);
    setMostCurrent(null);
    setMenuComparisonBusy(false);
    setBrandReplacementBusyCardId("");
    setFlowError(
      menuPageCards.length
        ? ""
        : "No saved menu pages were found. Update menu images before confirming.",
    );
  }, [
    editor.confirmInfoOpen,
    editor.draftMenuImages,
    editor.getBaselineSnapshot,
  ]);

  const compareCard = useCallback(async ({
    kind,
    card,
    candidateImage,
    updateCard,
    selectedAction = "",
  }) => {
    const baselineImage = asText(card?.baselineImage);
    const nextSelectedAction = asText(selectedAction) || asText(card?.selectedAction);
    if (!baselineImage) {
      updateCard(card.id, {
        candidateImage: "",
        status: "blocked",
        confidence: "low",
        message: "No baseline image was found for this item.",
        differences: [],
        selectedAction: nextSelectedAction,
      });
      return;
    }

    updateCard(card.id, {
      candidateImage,
      status: "matching",
      confidence: "low",
      message: "Comparing images...",
      differences: [],
      selectedAction: nextSelectedAction,
    });

    try {
      const result = await compareConfirmInfoImages({
        kind,
        baselineImage,
        candidateImage,
        label: card.label,
      });
      const summary = asText(result?.summary);
      const differences = Array.isArray(result?.differences) ? result.differences : [];
      if (result?.match) {
        updateCard(card.id, {
          candidateImage,
          status: "matched",
          confidence: result.confidence || "medium",
          message: summary || "Images were determined to match.",
          differences: [],
          selectedAction: nextSelectedAction,
        });
        return;
      }

      const mismatchSummary = summary
        ? `These images were determined to not match. ${summary}`
        : "These images were determined to not match.";
      updateCard(card.id, {
        candidateImage,
        status: "mismatched",
        confidence: result.confidence || "low",
        message: mismatchSummary,
        differences,
        selectedAction: nextSelectedAction,
      });
    } catch (error) {
      updateCard(card.id, {
        candidateImage,
        status: "error",
        confidence: "low",
        message: asText(error?.message) || "Failed to compare images. Please retry.",
        differences: [],
        selectedAction: nextSelectedAction,
      });
    }
  }, []);

  const processCardFile = useCallback(async ({
    file,
    kind,
    card,
    updateCard,
    autoCompare = true,
    selectedAction = "",
    pendingStatus = "pending",
    pendingMessage = "Photo captured. Answer both questions to run comparison.",
  }) => {
    if (!file || !card) return;
    setFlowError("");
    try {
      const dataUrl = await fileToDataUrl(file);
      const compressed = await compressConfirmPhotoDataUrl(dataUrl);
      if (!compressed) {
        throw new Error("Failed to process the selected photo.");
      }
      if (!autoCompare) {
        updateCard(card.id, {
          candidateImage: compressed,
          status: pendingStatus,
          confidence: "low",
          removed: false,
          message: pendingMessage,
          differences: [],
          selectedAction: asText(selectedAction) || asText(card?.selectedAction),
        });
        return;
      }
      await compareCard({
        kind,
        card,
        candidateImage: compressed,
        updateCard,
        selectedAction: asText(selectedAction) || asText(card?.selectedAction),
      });
    } catch (error) {
      setFlowError(asText(error?.message) || "Failed to process selected photo.");
    }
  }, [compareCard]);

  const applyBrandReplacementToOverlays = useCallback(
    ({ previousBrandKey, replacementBrand }) => {
      const targetKey = asText(previousBrandKey);
      if (!targetKey || !replacementBrand) {
        return {
          replacedRows: 0,
          dishes: [],
          ingredientNames: [],
        };
      }

      const overlays = Array.isArray(editor.draftOverlays) ? editor.draftOverlays : [];
      const matchedDishes = new Set();
      const matchedIngredients = new Set();
      let replacedRows = 0;

      overlays.forEach((overlay, overlayIndex) => {
        const overlayKey = asText(overlay?._editorKey);
        if (!overlayKey) return;

        const dishName = resolveOverlayDishName(overlay, overlayIndex);
        const ingredientRows = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];
        let changed = false;
        const nextIngredients = ingredientRows.map((ingredient) => {
          const brands = Array.isArray(ingredient?.brands) ? ingredient.brands : [];
          const matchesPreviousBrand = brands.some(
            (brand) => resolveBrandVerificationKey(brand) === targetKey,
          );
          if (!matchesPreviousBrand) return ingredient;

          changed = true;
          replacedRows += 1;
          if (dishName) matchedDishes.add(dishName);
          const ingredientName = asText(ingredient?.name);
          if (ingredientName) matchedIngredients.add(ingredientName);

          return {
            ...ingredient,
            allergens: replacementBrand.allergens,
            diets: replacementBrand.diets,
            crossContaminationAllergens: replacementBrand.crossContaminationAllergens,
            crossContaminationDiets: replacementBrand.crossContaminationDiets,
            aiDetectedAllergens: replacementBrand.allergens,
            aiDetectedDiets: replacementBrand.diets,
            aiDetectedCrossContaminationAllergens:
              replacementBrand.crossContaminationAllergens,
            aiDetectedCrossContaminationDiets: replacementBrand.crossContaminationDiets,
            brands: [replacementBrand],
            confirmed: true,
          };
        });

        if (!changed) return;

        const normalizedIngredients = nextIngredients.map((row, rowIndex) =>
          normalizeIngredientEntry(row, rowIndex),
        );
        const derived = deriveDishStateFromIngredients({
          ingredients: normalizedIngredients,
          existingDetails: overlay?.details,
          configuredDiets: editor.config?.diets,
        });

        editor.updateOverlay(overlayKey, {
          ingredients: derived.ingredients,
          allergens: derived.allergens,
          diets: derived.diets,
          details: derived.details,
          removable: derived.removable,
          crossContaminationAllergens: derived.crossContaminationAllergens,
          crossContaminationDiets: derived.crossContaminationDiets,
          ingredientsBlockingDiets: derived.ingredientsBlockingDiets,
        });
      });

      if (replacedRows > 0 && typeof editor.pushHistory === "function") {
        queueMicrotask(() => editor.pushHistory());
      }

      return {
        replacedRows,
        dishes: Array.from(matchedDishes),
        ingredientNames: Array.from(matchedIngredients),
      };
    },
    [editor],
  );

  const handleReplaceBrandCard = useCallback(
    async (card) => {
      const previousBrandKey = asText(card?.brandKey);
      if (!previousBrandKey) {
        setFlowError("Unable to replace this brand item because no brand key was found.");
        return;
      }

      const seedIngredientName = asText(card?.ingredientNames?.[0]) || asText(card?.label);
      if (!seedIngredientName) {
        setFlowError("Ingredient name is required before replacing this brand item.");
        return;
      }

      setFlowError("");
      updateBrandCard(card.id, {
        selectedAction: "replace",
      });
      setBrandReplacementBusyCardId(card.id);
      try {
        const result = await editor.openIngredientLabelScan({
          ingredientName: seedIngredientName,
          scanProfile: "dish_editor_brand",
        });
        if (!result?.success) {
          setFlowError(asText(result?.error?.message) || "Failed to replace brand item.");
          return;
        }

        const payload = result?.result;
        if (!payload) return;

        const replacementBrand = normalizeBrandEntry({
          name: asText(payload.productName) || seedIngredientName,
          allergens: payload.allergens,
          diets: payload.diets,
          crossContaminationAllergens: payload.crossContaminationAllergens,
          crossContaminationDiets: payload.crossContaminationDiets,
          ingredientsList: Array.isArray(payload.ingredientsList)
            ? payload.ingredientsList
            : [],
          brandImage: asText(payload.brandImage),
          ingredientsImage: asText(payload.ingredientsImage),
        });
        if (!replacementBrand) {
          setFlowError("Failed to build replacement brand item.");
          return;
        }

        const applied = applyBrandReplacementToOverlays({
          previousBrandKey,
          replacementBrand,
        });
        if (!applied.replacedRows) {
          setFlowError(
            "No ingredient rows matched that brand item, so no replacements were applied.",
          );
          return;
        }

        const replacementImage = asText(
          replacementBrand.brandImage ||
            replacementBrand.image ||
            replacementBrand.ingredientsImage,
        );
        const replacementBrandKey =
          resolveBrandVerificationKey(replacementBrand) || previousBrandKey;
        updateBrandCard(card.id, {
          brandKey: replacementBrandKey,
          label: replacementBrand.name,
          baselineImage: replacementImage,
          candidateImage: asText(replacementBrand.ingredientsImage || replacementImage),
          status: "matched",
          confidence: "high",
          message: `Replaced and applied to ${applied.replacedRows} ingredient row${applied.replacedRows === 1 ? "" : "s"}.`,
          differences: [],
          selectedAction: "replace",
          dishes: applied.dishes.length ? applied.dishes : card.dishes,
          ingredientNames: applied.ingredientNames.length
            ? applied.ingredientNames
            : card.ingredientNames,
        });
      } catch (error) {
        setFlowError(asText(error?.message) || "Failed to replace brand item.");
      } finally {
        setBrandReplacementBusyCardId("");
      }
    },
    [applyBrandReplacementToOverlays, editor, updateBrandCard],
  );

  const clearCard = useCallback((card, updateCard) => {
    const baselineExists = Boolean(asText(card?.baselineImage));
    updateCard(card.id, {
      candidateImage: "",
      status: baselineExists ? "idle" : "blocked",
      confidence: "low",
      removed: false,
      selectedAction: "",
      message: baselineExists
        ? "Capture or replace with a current photo to run comparison."
        : "No baseline image was found for this item.",
      differences: [],
    });
  }, []);

  const menuSavedCards = menuCards.filter((card) => Boolean(asText(card?.baselineImage)));
  const menuCardsReadyForAttestation =
    menuSavedCards.length > 0 &&
    menuSavedCards.every(
      (card) => card.removed === true || Boolean(asText(card?.candidateImage)),
    );
  const menuComparableCards = menuSavedCards.filter((card) => card.removed !== true);
  const menuCardsAllMatched =
    menuComparableCards.length > 0 &&
    menuComparableCards.every(
      (card) => card.status === "matched" || card.status === "replaced",
    );
  const menuAttestationsPassed = allDishesVisible === true && mostCurrent === true;
  const menuHasPendingComparison = menuComparableCards.some(
    (card) => Boolean(asText(card?.candidateImage)) && card.status === "pending",
  );
  const menuStepReady =
    menuCardsReadyForAttestation &&
    menuCardsAllMatched &&
    menuAttestationsPassed &&
    !menuHasPendingComparison &&
    !menuComparisonBusy;
  const menuHasMismatch = menuComparableCards.some((card) => card.status === "mismatched");
  const menuHasCompareError = menuComparableCards.some((card) => card.status === "error");
  const menuHasProcessing =
    menuComparisonBusy || menuComparableCards.some((card) => card.status === "matching");
  const brandHasProcessing =
    Boolean(asText(brandReplacementBusyCardId)) ||
    brandCards.some((card) => card.status === "matching");
  const brandCardsAllMatched =
    brandCards.length === 0 || brandCards.every((card) => card.status === "matched");
  const brandHasMismatch = brandCards.some((card) => card.status === "mismatched");
  const brandHasBlocked = brandCards.some((card) => card.status === "blocked");
  const canSubmitConfirmation =
    menuStepReady && brandCardsAllMatched && !menuHasProcessing && !brandHasProcessing;
  const verifiedMenuPhotos = menuComparableCards
    .map((card) => asText(card.candidateImage))
    .filter(Boolean);

  useEffect(() => {
    if (!editor.confirmInfoOpen || step !== "menu") return;
    if (!menuCardsReadyForAttestation) return;
    if (!menuAttestationsPassed) return;
    if (menuComparisonBusy) return;

    const cardsToCompare = menuCards.filter((card) => {
      if (!asText(card?.baselineImage)) return false;
      if (card.removed === true) return false;
      if (!asText(card?.candidateImage)) return false;
      return card.status === "pending";
    });
    if (!cardsToCompare.length) return;

    setFlowError("");
    setMenuComparisonBusy(true);
    (async () => {
      try {
        for (const card of cardsToCompare) {
          await compareCard({
            kind: "menu_page",
            card,
            candidateImage: asText(card?.candidateImage),
            updateCard: updateMenuCard,
          });
        }
      } catch (error) {
        setFlowError(asText(error?.message) || "Failed to compare menu photos.");
      } finally {
        setMenuComparisonBusy(false);
      }
    })();
  }, [
    compareCard,
    editor.confirmInfoOpen,
    menuAttestationsPassed,
    menuCards,
    menuCardsReadyForAttestation,
    menuComparisonBusy,
    step,
    updateMenuCard,
  ]);

  return (
    <Modal
      open={editor.confirmInfoOpen}
      onOpenChange={(open) => editor.setConfirmInfoOpen(open)}
      title="Confirm Allergen Information"
      className="max-w-[1120px]"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="note m-0 text-sm">
            {step === "menu"
              ? "Take a current photo for each menu page and compare it against the saved page."
              : "Now verify each brand item currently used by your dishes."}
          </p>
          <div className="text-xs text-[#a7b2d1]">
            Step {step === "menu" ? "1 of 2" : "2 of 2"}
          </div>
        </div>

        {step === "menu" ? (
          <div className="space-y-3">
            <div className="flex gap-3 overflow-x-auto pb-1">
              {menuCards.map((card) => (
                <ConfirmInfoCard
                  key={card.id}
                  card={card}
                  busy={editor.confirmBusy}
                  replaceInputRef={getCardInputRef(menuReplaceInputRefs, card.id)}
                  captureInputRef={getCardInputRef(menuCaptureInputRefs, card.id)}
                  onRemove={() => {
                    setFlowError("");
                    setAllDishesVisible(null);
                    setMostCurrent(null);
                    if (card.removed === true) {
                      clearCard(card, updateMenuCard);
                      return;
                    }
                    updateMenuCard(card.id, {
                      candidateImage: "",
                      status: "removed",
                      confidence: "low",
                      removed: true,
                      selectedAction: "remove",
                      message: "Marked as removed from your current menu.",
                      differences: [],
                    });
                  }}
                  onPickReplace={async (event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      setAllDishesVisible(null);
                      setMostCurrent(null);
                      await processCardFile({
                        file,
                        kind: "menu_page",
                        card,
                        updateCard: updateMenuCard,
                        autoCompare: false,
                        selectedAction: "replace",
                        pendingStatus: "replaced",
                        pendingMessage:
                          "Replacement selected. Comparison skipped for this page.",
                      });
                    }
                    event.target.value = "";
                  }}
                  onPickCapture={async (event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      setAllDishesVisible(null);
                      setMostCurrent(null);
                      await processCardFile({
                        file,
                        kind: "menu_page",
                        card,
                        updateCard: updateMenuCard,
                        autoCompare: false,
                        selectedAction: "capture",
                      });
                    }
                    event.target.value = "";
                  }}
                />
              ))}
            </div>

            {!menuCardsReadyForAttestation ? (
              <div className="rounded-lg border border-[#2a3261] bg-[rgba(6,10,28,0.55)] p-3 text-sm text-[#ced8f8]">
                Capture or replace a current photo for each saved menu page, or remove pages no
                longer on your current menu.
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-[#2a3261] bg-[rgba(6,10,28,0.55)] p-3 text-sm text-[#ced8f8]">
                  <div>Are all dishes clearly visible in these photos?</div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="compact"
                      tone={allDishesVisible === true ? "success" : "neutral"}
                      onClick={() => setAllDishesVisible(true)}
                    >
                      Yes
                    </Button>
                    <Button
                      size="compact"
                      tone={allDishesVisible === false ? "danger" : "neutral"}
                      onClick={() => setAllDishesVisible(false)}
                    >
                      No
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border border-[#2a3261] bg-[rgba(6,10,28,0.55)] p-3 text-sm text-[#ced8f8]">
                  <div>Are these photos of your most current menu?</div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="compact"
                      tone={mostCurrent === true ? "success" : "neutral"}
                      onClick={() => setMostCurrent(true)}
                    >
                      Yes
                    </Button>
                    <Button
                      size="compact"
                      tone={mostCurrent === false ? "danger" : "neutral"}
                      onClick={() => setMostCurrent(false)}
                    >
                      No
                    </Button>
                  </div>
                </div>

                {allDishesVisible === false || mostCurrent === false ? (
                  <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
                    Confirmation is blocked until both menu attestation questions are answered Yes.
                  </p>
                ) : null}
                {menuAttestationsPassed && menuHasProcessing ? (
                  <p className="m-0 rounded-lg border border-[#2a3261] bg-[rgba(6,10,28,0.55)] px-3 py-2 text-sm text-[#ced8f8]">
                    Comparing current photos to saved menu pages...
                  </p>
                ) : null}
                {menuHasCompareError ? (
                  <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
                    One or more menu page comparisons failed. Retake those photos and answer both
                    questions Yes again.
                  </p>
                ) : null}
              </>
            )}

            <div className="flex flex-wrap gap-2 justify-end">
              {menuHasMismatch ? (
                <Button
                  size="compact"
                  tone="danger"
                  variant="outline"
                  onClick={() => {
                    editor.setConfirmInfoOpen(false);
                    editor.setMenuPagesOpen(true);
                  }}
                >
                  Update menu images
                </Button>
              ) : null}
              <Button
                size="compact"
                variant="outline"
                onClick={() => editor.setConfirmInfoOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="compact"
                tone="primary"
                disabled={!menuStepReady}
                onClick={() => setStep("brand")}
              >
                Continue to brand items
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-3 overflow-x-auto pb-1">
              {brandCards.map((card) => (
                <ConfirmInfoCard
                  key={card.id}
                  card={card}
                  busy={editor.confirmBusy || Boolean(asText(brandReplacementBusyCardId))}
                  replaceInputRef={getCardInputRef(brandReplaceInputRefs, card.id)}
                  captureInputRef={getCardInputRef(brandCaptureInputRefs, card.id)}
                  showRemove={false}
                  replaceWithFile={false}
                  onReplace={() => handleReplaceBrandCard(card)}
                  onPickCapture={async (event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      await processCardFile({
                        file,
                        kind: "brand_item",
                        card,
                        updateCard: updateBrandCard,
                        selectedAction: "capture",
                      });
                    }
                    event.target.value = "";
                  }}
                />
              ))}
            </div>

            {!brandCards.length ? (
              <div className="rounded-lg border border-[#2a3261] bg-[rgba(6,10,28,0.55)] p-3 text-sm text-[#ced8f8]">
                No brand items are currently linked to this menu.
              </div>
            ) : null}

            {brandHasMismatch ? (
              <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
                At least one brand item was determined to not match. Replace or capture a new photo
                for each mismatched item before final confirmation.
              </p>
            ) : null}

            {brandHasBlocked ? (
              <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
                One or more brand items are missing baseline images and cannot be verified.
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2 justify-end">
              <Button size="compact" variant="outline" onClick={() => setStep("menu")}>
                Back to menu verification
              </Button>
              <Button
                size="compact"
                tone="success"
                loading={editor.confirmBusy}
                disabled={!canSubmitConfirmation || editor.confirmBusy}
                onClick={async () => {
                  const result = await editor.confirmInfo(verifiedMenuPhotos);
                  if (result?.success) {
                    editor.setConfirmInfoOpen(false);
                  }
                }}
              >
                Confirm information is up-to-date
              </Button>
            </div>
          </div>
        )}

        {flowError ? (
          <div className="rounded-lg border border-[#2a3261] bg-[rgba(6,10,28,0.55)] p-3 text-sm text-[#ced8f8]">
            {flowError}
          </div>
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
