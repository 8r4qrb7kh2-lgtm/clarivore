import { useCallback, useEffect, useRef } from "react";

import {
  buildOverlayDeltaPayload,
  normalizeMenuImageList,
  optimizeMenuImagesForWrite,
  parseSerializedEditorState,
  serializeEditorState,
  serializeMenuImageList,
  stripEditorOverlay,
} from "../utils/menuImageWrite";
import { buildIngredientConfirmationIssues } from "../utils/overlayIssues";
import {
  buildDefaultChangeLogPayload,
  serializeSettingsDraft,
} from "../utils/settingsAndChangelog";
import { asText } from "../utils/text";

// Save, staging, and settings actions.
// This module keeps all write-heavy workflows in one place.

export function usePersistenceActions({
  canEdit,
  restaurant,
  callbacks,

  isSaving,
  isDirty,
  editorStateSerialized,
  pendingSaveBatchId,
  pendingSaveRows,
  pendingSaveStateHash,
  pendingSavePreparing,
  restaurantSettingsDraft,

  overlaysRef,
  menuImagesRef,
  pendingChangesRef,
  baselineRef,
  settingsBaselineRef,
  historyRef,
  saveStatusTimerRef,
  pendingSaveSyncTimerRef,

  clearSaveStatusTimer,
  clearPendingSaveBatch,
  restoreHistorySnapshot,

  setDraftMenuImages,
  setPendingChanges,
  setSaveError,
  setIsSaving,
  setSaveStatus,
  setPendingSavePreparing,
  setPendingSaveError,
  setPendingSaveBatchId,
  setPendingSaveRows,
  setPendingSaveStateHash,
  setConfirmBusy,
  setConfirmError,
  setSettingsSaveBusy,
  setSettingsSaveError,
  setHistoryIndex,
}) {
  const pendingSaveRequestRef = useRef(null);

  // Commit a previously staged pending-save batch to the write gateway.
  // This flow validates ingredient confirmation and synchronizes local baselines on success.
  const save = useCallback(async () => {
    if (!canEdit || !restaurant?.id) {
      setSaveError("You do not have permission to edit this restaurant.");
      setSaveStatus("error");
      return { success: false };
    }

    if (!callbacks?.onApplyPendingSave) {
      setSaveError("Write gateway save callback is not configured.");
      setSaveStatus("error");
      return { success: false };
    }

    clearSaveStatusTimer();
    setSaveError("");
    setSaveStatus("saving");
    setIsSaving(true);

    try {
      // The editor enforces explicit confirmation on each ingredient row.
      const ingredientConfirmationIssues = buildIngredientConfirmationIssues(
        overlaysRef.current,
      );
      if (ingredientConfirmationIssues.length) {
        const firstIssue = ingredientConfirmationIssues[0];
        setSaveError(
          firstIssue?.message ||
            "Every ingredient row must be confirmed before saving.",
        );
        setSaveStatus("error");
        return { success: false };
      }

      // Normalize current and baseline images to decide whether image payload must be sent.
      const cleanedOverlays = (overlaysRef.current || []).map(stripEditorOverlay);
      const cleanedMenuImages = normalizeMenuImageList(menuImagesRef.current);
      const baselineSnapshot = parseSerializedEditorState(baselineRef.current);
      const baselineMenuImages = normalizeMenuImageList(baselineSnapshot?.menuImages);
      const menuImagesChanged =
        serializeMenuImageList(cleanedMenuImages) !==
        serializeMenuImageList(baselineMenuImages);
      const optimizedMenuImages = menuImagesChanged
        ? await optimizeMenuImagesForWrite(cleanedMenuImages)
        : cleanedMenuImages;
      const optimizedChanged =
        serializeMenuImageList(optimizedMenuImages) !==
        serializeMenuImageList(cleanedMenuImages);
      if (optimizedChanged) {
        menuImagesRef.current = optimizedMenuImages;
        setDraftMenuImages(optimizedMenuImages);
      }
      const menuImage = optimizedMenuImages[0] || "";

      // Build human-readable grouped change payload for audit/change-log records.
      const author =
        asText(callbacks?.getAuthorName?.()) || asText(callbacks?.authorName) || "Manager";

      const stateHash = serializeEditorState(cleanedOverlays, optimizedMenuImages);
      const changePayload = buildDefaultChangeLogPayload({
        author,
        pendingChanges: pendingChangesRef.current,
        snapshot: {
          mode: "server_generated",
          stateHash,
        },
      });

      // Save requires a staged batch id to avoid accidental direct writes.
      if (!pendingSaveBatchId) {
        setSaveError("No pending save batch found. Review changes before confirming save.");
        setSaveStatus("error");
        return { success: false };
      }

      // State-hash mismatch means user edited after opening save review.
      if (pendingSaveStateHash && pendingSaveStateHash !== stateHash) {
        setSaveError("Changes were edited after review. Please re-open save review.");
        setSaveStatus("error");
        return { success: false };
      }

      await callbacks.onApplyPendingSave({
        batchId: pendingSaveBatchId,
        overlays: cleanedOverlays,
        menuImages: menuImagesChanged ? optimizedMenuImages : [],
        menuImage: menuImagesChanged ? menuImage : "",
        menuImagesProvided: menuImagesChanged,
        changePayload,
        stateHash,
      });

      // On success, promote current state to new baseline and reset history to one snapshot.
      baselineRef.current = serializeEditorState(cleanedOverlays, optimizedMenuImages);
      setPendingChanges([]);
      clearPendingSaveBatch();

      const snapshotAfterSave = {
        overlays: JSON.parse(JSON.stringify(overlaysRef.current || [])),
        menuImages: JSON.parse(JSON.stringify(optimizedMenuImages || [])),
        pendingChanges: [],
      };

      historyRef.current = [snapshotAfterSave];
      setHistoryIndex(0);

      setSaveStatus("saved");
      saveStatusTimerRef.current = window.setTimeout(() => {
        saveStatusTimerRef.current = 0;
        setSaveStatus("idle");
      }, 900);

      return { success: true };
    } catch (error) {
      const message = error?.message || "Failed to save editor changes.";
      setSaveError(message);
      setSaveStatus("error");
      return { success: false, error };
    } finally {
      setIsSaving(false);
    }
  }, [
    callbacks,
    canEdit,
    clearPendingSaveBatch,
    clearSaveStatusTimer,
    pendingSaveBatchId,
    pendingSaveStateHash,
    restaurant?.id,
    setDraftMenuImages,
    setHistoryIndex,
    setIsSaving,
    setPendingChanges,
    setSaveError,
    setSaveStatus,
    baselineRef,
    historyRef,
    menuImagesRef,
    overlaysRef,
    pendingChangesRef,
    saveStatusTimerRef,
  ]);

  // Stage current edits into a pending-save batch for review/approval.
  const preparePendingSave = useCallback(async () => {
    if (pendingSaveRequestRef.current) {
      return await pendingSaveRequestRef.current;
    }

    const runPrepare = async () => {
      if (!canEdit || !restaurant?.id) {
        setPendingSaveError("You do not have permission to edit this restaurant.");
        return { success: false };
      }

      if (!callbacks?.onPreparePendingSave) {
        setPendingSaveError("Pending-save preparation callback is not configured.");
        return { success: false };
      }

      try {
        // Delta payload avoids sending unchanged overlays when only specific rows changed.
        const cleanedOverlays = (overlaysRef.current || []).map(stripEditorOverlay);
        const cleanedMenuImages = normalizeMenuImageList(menuImagesRef.current);
        const baselineSnapshot = parseSerializedEditorState(baselineRef.current);
        const baselineOverlays = Array.isArray(baselineSnapshot?.overlays)
          ? baselineSnapshot.overlays
          : [];
        const overlayDelta = buildOverlayDeltaPayload({
          baselineOverlays,
          overlays: cleanedOverlays,
        });
        const baselineMenuImages = normalizeMenuImageList(baselineSnapshot?.menuImages);
        const menuImagesChanged =
          serializeMenuImageList(cleanedMenuImages) !==
          serializeMenuImageList(baselineMenuImages);
        const optimizedMenuImages = menuImagesChanged
          ? await optimizeMenuImagesForWrite(cleanedMenuImages)
          : cleanedMenuImages;
        const optimizedChanged =
          serializeMenuImageList(optimizedMenuImages) !==
          serializeMenuImageList(cleanedMenuImages);
        if (optimizedChanged) {
          menuImagesRef.current = optimizedMenuImages;
          setDraftMenuImages(optimizedMenuImages);
        }

        const author =
          asText(callbacks?.getAuthorName?.()) || asText(callbacks?.authorName) || "Manager";

        const changePayload = buildDefaultChangeLogPayload({
          author,
          pendingChanges: pendingChangesRef.current,
          snapshot: {
            mode: "server_generated",
          },
        });

        const stateHash = serializeEditorState(cleanedOverlays, optimizedMenuImages);
        const changedFields = [];
        if (overlayDelta.hasOverlayChanges) {
          changedFields.push("overlays");
        }
        if (menuImagesChanged) {
          changedFields.push("menuImages");
        }

        // If an identical state is already staged, reuse the existing staged batch.
        if (pendingSaveBatchId && pendingSaveStateHash === stateHash) {
          return {
            success: true,
            batchId: pendingSaveBatchId,
            rows: Array.isArray(pendingSaveRows) ? pendingSaveRows : [],
          };
        }

        setPendingSavePreparing(true);
        setPendingSaveError("");
        setSaveError("");

        // Ask write gateway to stage the change set and return preview rows.
        const result = await callbacks.onPreparePendingSave({
          overlays: cleanedOverlays,
          baselineOverlays,
          overlayUpserts: overlayDelta.overlayUpserts,
          overlayDeletes: overlayDelta.overlayDeletes,
          overlayBaselines: overlayDelta.overlayBaselines,
          overlayOrder: overlayDelta.overlayOrder,
          overlayOrderProvided: overlayDelta.overlayOrderProvided,
          hasOverlayChanges: overlayDelta.hasOverlayChanges,
          changedFields,
          menuImage: menuImagesChanged ? optimizedMenuImages[0] || "" : "",
          menuImages: menuImagesChanged ? optimizedMenuImages : [],
          menuImagesProvided: menuImagesChanged,
          changePayload,
          stateHash,
        });

        const nextBatchId = asText(result?.batchId);
        if (!nextBatchId) {
          throw new Error("Failed to stage pending save batch.");
        }

        setPendingSaveBatchId(nextBatchId);
        setPendingSaveRows(Array.isArray(result?.rows) ? result.rows : []);
        setPendingSaveStateHash(asText(result?.stateHash) || stateHash);
        setPendingSaveError("");

        return {
          success: true,
          batchId: nextBatchId,
          rows: Array.isArray(result?.rows) ? result.rows : [],
        };
      } catch (error) {
        const message = error?.message || "Failed to prepare pending save.";
        setPendingSaveError(message);
        setSaveError(message);
        setSaveStatus("error");
        return { success: false, error };
      } finally {
        setPendingSavePreparing(false);
      }
    };

    const request = runPrepare();
    pendingSaveRequestRef.current = request;
    try {
      return await request;
    } finally {
      if (pendingSaveRequestRef.current === request) {
        pendingSaveRequestRef.current = null;
      }
    }
  }, [
    callbacks,
    canEdit,
    pendingSaveBatchId,
    pendingSaveRows,
    pendingSaveStateHash,
    restaurant?.id,
    setDraftMenuImages,
    setPendingSaveBatchId,
    setPendingSaveError,
    setPendingSavePreparing,
    setPendingSaveRows,
    setPendingSaveStateHash,
    setSaveError,
    setSaveStatus,
    baselineRef,
    menuImagesRef,
    overlaysRef,
    pendingChangesRef,
  ]);

  // Keep staged payload in sync while user continues editing, using a short debounce.
  useEffect(() => {
    if (!canEdit) return;
    if (!callbacks?.onPreparePendingSave) return;
    if (isSaving || pendingSavePreparing) return;

    const shouldSync = isDirty || Boolean(pendingSaveBatchId);
    if (!shouldSync) return;

    if (pendingSaveSyncTimerRef.current) {
      window.clearTimeout(pendingSaveSyncTimerRef.current);
      pendingSaveSyncTimerRef.current = 0;
    }

    pendingSaveSyncTimerRef.current = window.setTimeout(() => {
      pendingSaveSyncTimerRef.current = 0;
      preparePendingSave();
    }, 700);

    return () => {
      if (pendingSaveSyncTimerRef.current) {
        window.clearTimeout(pendingSaveSyncTimerRef.current);
        pendingSaveSyncTimerRef.current = 0;
      }
    };
  }, [
    callbacks?.onPreparePendingSave,
    canEdit,
    editorStateSerialized,
    isDirty,
    isSaving,
    pendingSaveBatchId,
    pendingSavePreparing,
    pendingSaveSyncTimerRef,
    preparePendingSave,
  ]);

  // Revert to baseline snapshot and clear all staged metadata.
  const discardUnsavedChanges = useCallback(() => {
    clearSaveStatusTimer();

    const baselineSnapshot = historyRef.current[0];
    if (baselineSnapshot) {
      restoreHistorySnapshot({
        overlays: JSON.parse(JSON.stringify(baselineSnapshot.overlays || [])),
        menuImages: JSON.parse(JSON.stringify(baselineSnapshot.menuImages || [])),
        pendingChanges: [],
      });
    }

    setPendingChanges([]);
    clearPendingSaveBatch();
    setSaveError("");
    setIsSaving(false);
    setSaveStatus("idle");

    return { success: true };
  }, [
    clearPendingSaveBatch,
    clearSaveStatusTimer,
    historyRef,
    restoreHistorySnapshot,
    setIsSaving,
    setPendingChanges,
    setSaveError,
    setSaveStatus,
  ]);

  // Confirm-info flow sends manager confirmation payload + uploaded photos.
  const confirmInfo = useCallback(async (photos) => {
    if (!callbacks?.onConfirmInfo || !restaurant?.id) {
      setConfirmError("Confirm callback is not configured.");
      return { success: false };
    }

    const safePhotos = (Array.isArray(photos) ? photos : [])
      .map((value) => asText(value))
      .filter(Boolean);
    if (!safePhotos.length) {
      setConfirmError("Upload at least one menu photo before confirming.");
      return { success: false };
    }

    setConfirmBusy(true);
    setConfirmError("");

    try {
      const payload = {
        restaurantId: restaurant.id,
        timestamp: new Date().toISOString(),
        photos: safePhotos,
      };
      const result = await callbacks.onConfirmInfo(payload);
      return { success: true, result };
    } catch (error) {
      setConfirmError(error?.message || "Failed to confirm information.");
      return { success: false, error };
    } finally {
      setConfirmBusy(false);
    }
  }, [callbacks, restaurant?.id, setConfirmBusy, setConfirmError]);

  // Persist restaurant settings (website, phone, delivery/menu URLs).
  const saveRestaurantSettings = useCallback(async () => {
    if (!callbacks?.onSaveRestaurantSettings || !restaurant?.id) {
      setSettingsSaveError("Restaurant settings callback is not configured.");
      return { success: false };
    }

    setSettingsSaveBusy(true);
    setSettingsSaveError("");

    try {
      const payload = {
        website: asText(restaurantSettingsDraft.website),
        phone: asText(restaurantSettingsDraft.phone),
        delivery_url: asText(restaurantSettingsDraft.delivery_url),
        menu_url: asText(restaurantSettingsDraft.menu_url),
      };

      await callbacks.onSaveRestaurantSettings({
        restaurantId: restaurant.id,
        ...payload,
      });

      settingsBaselineRef.current = serializeSettingsDraft(payload);
      return { success: true };
    } catch (error) {
      setSettingsSaveError(error?.message || "Failed to save restaurant settings.");
      return { success: false, error };
    } finally {
      setSettingsSaveBusy(false);
    }
  }, [callbacks, restaurant?.id, restaurantSettingsDraft, settingsBaselineRef, setSettingsSaveBusy, setSettingsSaveError]);

  return {
    save,
    preparePendingSave,
    discardUnsavedChanges,
    confirmInfo,
    saveRestaurantSettings,
  };
}
