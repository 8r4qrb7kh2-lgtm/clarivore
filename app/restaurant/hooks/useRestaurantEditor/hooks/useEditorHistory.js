import { useCallback, useEffect } from "react";

import { HISTORY_LIMIT } from "../constants";
import { buildOverlayNormalizationContext, ensureOverlayVisibility, normalizeOverlay } from "../utils/overlayGeometry";
import { serializeEditorState } from "../utils/menuImageWrite";
import { decodePendingChangeLine, encodePendingChangeLine } from "../utils/settingsAndChangelog";
import { asText, clamp } from "../utils/text";
import { cloneSnapshotList } from "../utils/imageProcessing";

// This hook owns history and snapshot state.
// Keeping this isolated makes undo/redo behavior easier to reason about and test.

export function useEditorHistory({
  draftOverlays,
  draftMenuImages,
  pendingChanges,
  aiAssistDraft,
  selectedOverlayKey,
  activePageIndex,
  historyIndex,

  overlaysRef,
  menuImagesRef,
  pendingChangesRef,
  aiAssistDraftRef,
  historyRef,
  saveStatusTimerRef,
  pendingSaveSyncTimerRef,

  setDraftOverlays,
  setDraftMenuImages,
  setPendingChanges,
  setSelectedOverlayKey,
  setActivePageIndex,
  setHistoryIndex,
  setPendingSaveBatchId,
  setPendingSaveRows,
  setPendingSaveStateHash,
  setPendingSaveError,
  setPendingSavePreparing,
  setAiAssistDraftState,
}) {
  // Keep refs synchronized with latest state so async callbacks always read current values.
  useEffect(() => {
    overlaysRef.current = draftOverlays;
  }, [draftOverlays, overlaysRef]);

  useEffect(() => {
    menuImagesRef.current = draftMenuImages;
  }, [draftMenuImages, menuImagesRef]);

  useEffect(() => {
    pendingChangesRef.current = pendingChanges;
  }, [pendingChanges, pendingChangesRef]);

  useEffect(() => {
    aiAssistDraftRef.current = aiAssistDraft;
  }, [aiAssistDraft, aiAssistDraftRef]);

  // Wrapper setter that updates both state and ref in one place.
  const setAiAssistDraft = useCallback((nextValue) => {
    const current = aiAssistDraftRef.current;
    const nextDraft =
      typeof nextValue === "function" ? nextValue(current) : nextValue;
    aiAssistDraftRef.current = nextDraft;
    setAiAssistDraftState(nextDraft);
  }, [aiAssistDraftRef, setAiAssistDraftState]);

  // Prevent overlapping save-status timers when save state changes quickly.
  const clearSaveStatusTimer = useCallback(() => {
    if (saveStatusTimerRef.current) {
      window.clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = 0;
    }
  }, [saveStatusTimerRef]);

  // Ensure timer cleanup on unmount.
  useEffect(() => {
    return () => clearSaveStatusTimer();
  }, [clearSaveStatusTimer]);

  // Ensure pending-save debounce timer cleanup on unmount.
  useEffect(() => {
    return () => {
      if (pendingSaveSyncTimerRef.current) {
        window.clearTimeout(pendingSaveSyncTimerRef.current);
        pendingSaveSyncTimerRef.current = 0;
      }
    };
  }, [pendingSaveSyncTimerRef]);

  // Append one pending-change line with optional key-based dedupe.
  const appendPendingChange = useCallback((line, options = {}) => {
    const text = asText(line);
    const key = asText(options?.key);
    if (!text) return;

    setPendingChanges((current) => {
      const encoded = encodePendingChangeLine(text, key);
      if (!key) {
        return [...current, encoded];
      }

      const filtered = current.filter((entry) => decodePendingChangeLine(entry).key !== key);
      return [...filtered, encoded];
    });
  }, [setPendingChanges]);

  // Reset staged pending-save metadata after save/discard/reinitialize flows.
  const clearPendingSaveBatch = useCallback(() => {
    setPendingSaveBatchId("");
    setPendingSaveRows([]);
    setPendingSaveStateHash("");
    setPendingSaveError("");
    setPendingSavePreparing(false);
  }, [
    setPendingSaveBatchId,
    setPendingSaveRows,
    setPendingSaveStateHash,
    setPendingSaveError,
    setPendingSavePreparing,
  ]);

  // Capture current editor state for history stack entries.
  const captureSnapshot = useCallback(() => {
    return {
      overlays: cloneSnapshotList(overlaysRef.current),
      menuImages: cloneSnapshotList(menuImagesRef.current),
      pendingChanges: [...(pendingChangesRef.current || [])],
    };
  }, [menuImagesRef, overlaysRef, pendingChangesRef]);

  // Capture full draft snapshot for temporary export/import flows.
  const createDraftSnapshot = useCallback(() => {
    return {
      overlays: cloneSnapshotList(overlaysRef.current),
      menuImages: cloneSnapshotList(menuImagesRef.current),
      pendingChanges: [...(pendingChangesRef.current || [])],
      selectedOverlayKey: asText(selectedOverlayKey),
      activePageIndex: Number(activePageIndex) || 0,
      history: cloneSnapshotList(historyRef.current),
      historyIndex: Number(historyIndex) || 0,
    };
  }, [
    activePageIndex,
    historyIndex,
    historyRef,
    menuImagesRef,
    overlaysRef,
    pendingChangesRef,
    selectedOverlayKey,
  ]);

  // Push a new undo snapshot only when serialized state actually changed.
  const pushHistory = useCallback(() => {
    const snapshot = captureSnapshot();
    const serialized = serializeEditorState(snapshot.overlays, snapshot.menuImages);

    const currentList = historyRef.current.slice(0, historyIndex + 1);
    const last = currentList[currentList.length - 1];
    if (last && serializeEditorState(last.overlays, last.menuImages) === serialized) {
      return;
    }

    currentList.push(snapshot);
    while (currentList.length > HISTORY_LIMIT) {
      currentList.shift();
    }

    historyRef.current = currentList;
    setHistoryIndex(currentList.length - 1);
  }, [captureSnapshot, historyIndex, historyRef, setHistoryIndex]);

  // Restore overlays/menu/pending changes from a history snapshot.
  const restoreHistorySnapshot = useCallback((snapshot) => {
    if (!snapshot) return;

    const images = Array.isArray(snapshot.menuImages) && snapshot.menuImages.length
      ? snapshot.menuImages
      : [""];

    const context = buildOverlayNormalizationContext(snapshot.overlays, images.length);
    const overlaysList = Array.isArray(snapshot.overlays)
      ? snapshot.overlays.map((overlay, index) =>
          ensureOverlayVisibility(
            normalizeOverlay(
              overlay,
              index,
              overlay?._editorKey || `ov-${Date.now()}-${index}`,
              context,
            ),
            images.length,
          ),
        )
      : [];

    overlaysRef.current = overlaysList;
    menuImagesRef.current = images;
    pendingChangesRef.current = Array.isArray(snapshot.pendingChanges)
      ? [...snapshot.pendingChanges]
      : [];

    setDraftOverlays(overlaysList);
    setDraftMenuImages(images);
    setPendingChanges(pendingChangesRef.current);
    setSelectedOverlayKey((current) => {
      if (current && overlaysList.some((overlay) => overlay._editorKey === current)) {
        return current;
      }
      return overlaysList[0]?._editorKey || "";
    });
    setActivePageIndex((current) =>
      clamp(current, 0, Math.max(images.length - 1, 0))
    );
  }, [
    menuImagesRef,
    overlaysRef,
    pendingChangesRef,
    setActivePageIndex,
    setDraftMenuImages,
    setDraftOverlays,
    setPendingChanges,
    setSelectedOverlayKey,
  ]);

  // Restore a full draft export, including selection and custom history list.
  const restoreDraftSnapshot = useCallback((snapshot) => {
    if (!snapshot || typeof snapshot !== "object") return { success: false };

    const nextSnapshot = {
      overlays: cloneSnapshotList(snapshot.overlays),
      menuImages: cloneSnapshotList(snapshot.menuImages),
      pendingChanges: Array.isArray(snapshot.pendingChanges)
        ? [...snapshot.pendingChanges]
        : [],
    };
    if (!nextSnapshot.menuImages.length) {
      nextSnapshot.menuImages = [""];
    }

    restoreHistorySnapshot(nextSnapshot);

    const restoredOverlays = Array.isArray(nextSnapshot.overlays)
      ? nextSnapshot.overlays
      : [];
    const selectedKey = asText(snapshot.selectedOverlayKey);
    const restoredSelectedKey =
      selectedKey &&
      restoredOverlays.some((overlay) => overlay?._editorKey === selectedKey)
        ? selectedKey
        : restoredOverlays[0]?._editorKey || "";
    setSelectedOverlayKey(restoredSelectedKey);

    const restoredPage = clamp(
      Number(snapshot.activePageIndex) || 0,
      0,
      Math.max(nextSnapshot.menuImages.length - 1, 0),
    );
    setActivePageIndex(restoredPage);

    const historyList = Array.isArray(snapshot.history) && snapshot.history.length
      ? cloneSnapshotList(snapshot.history).map((entry) => ({
          overlays: cloneSnapshotList(entry?.overlays),
          menuImages: cloneSnapshotList(entry?.menuImages),
          pendingChanges: Array.isArray(entry?.pendingChanges)
            ? [...entry.pendingChanges]
            : [],
        }))
      : [nextSnapshot];

    historyRef.current = historyList;
    setHistoryIndex(
      clamp(
        Number(snapshot.historyIndex) || 0,
        0,
        Math.max(historyList.length - 1, 0),
      ),
    );

    return { success: true };
  }, [
    historyRef,
    restoreHistorySnapshot,
    setActivePageIndex,
    setHistoryIndex,
    setSelectedOverlayKey,
  ]);

  // Undo moves to previous history entry.
  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    const snapshot = historyRef.current[nextIndex];
    if (!snapshot) return;
    restoreHistorySnapshot(snapshot);
    setHistoryIndex(nextIndex);
  }, [historyIndex, historyRef, restoreHistorySnapshot, setHistoryIndex]);

  // Undo to the state before a selected pending-change index.
  const undoPendingChange = useCallback((changeIndex) => {
    const safeIndex = Math.floor(Number(changeIndex));
    if (!Number.isFinite(safeIndex) || safeIndex < 0) {
      return { success: false };
    }

    const currentPending = Array.isArray(pendingChangesRef.current)
      ? pendingChangesRef.current
      : [];
    if (!currentPending.length || safeIndex >= currentPending.length) {
      return { success: false };
    }

    const targetPendingCount = safeIndex;
    let targetHistoryIndex = -1;

    for (let index = historyIndex; index >= 0; index -= 1) {
      const snapshot = historyRef.current[index];
      const snapshotPendingCount = Array.isArray(snapshot?.pendingChanges)
        ? snapshot.pendingChanges.length
        : 0;
      if (snapshotPendingCount <= targetPendingCount) {
        targetHistoryIndex = index;
        break;
      }
    }

    if (targetHistoryIndex < 0) {
      return { success: false };
    }

    const targetSnapshot = historyRef.current[targetHistoryIndex];
    if (!targetSnapshot) {
      return { success: false };
    }

    restoreHistorySnapshot(targetSnapshot);
    setHistoryIndex(targetHistoryIndex);
    return {
      success: true,
      undoneCount: Math.max(currentPending.length - targetPendingCount, 0),
    };
  }, [historyIndex, historyRef, pendingChangesRef, restoreHistorySnapshot, setHistoryIndex]);

  // Redo moves to next history entry.
  const redo = useCallback(() => {
    if (historyIndex >= historyRef.current.length - 1) return;
    const nextIndex = historyIndex + 1;
    const snapshot = historyRef.current[nextIndex];
    if (!snapshot) return;
    restoreHistorySnapshot(snapshot);
    setHistoryIndex(nextIndex);
  }, [historyIndex, historyRef, restoreHistorySnapshot, setHistoryIndex]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historyRef.current.length - 1;

  return {
    setAiAssistDraft,
    clearSaveStatusTimer,
    appendPendingChange,
    clearPendingSaveBatch,
    captureSnapshot,
    createDraftSnapshot,
    pushHistory,
    restoreHistorySnapshot,
    restoreDraftSnapshot,
    undo,
    undoPendingChange,
    redo,
    canUndo,
    canRedo,
  };
}
