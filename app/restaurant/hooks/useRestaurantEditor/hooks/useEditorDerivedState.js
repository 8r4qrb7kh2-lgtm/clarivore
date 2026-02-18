import { useCallback, useEffect, useMemo } from "react";

import {
  buildCanonicalTokenLookup,
  findDietAlias,
  normalizeCanonicalList,
  resolveCanonicalValue,
} from "../utils/canonical";
import {
  ensureOverlayVisibility,
  buildOverlayNormalizationContext,
  normalizeOverlay,
} from "../utils/overlayGeometry";
import {
  buildMenuImages,
  parseSerializedEditorState,
  serializeEditorState,
} from "../utils/menuImageWrite";
import {
  createEmptySettingsDraft,
  serializeSettingsDraft,
} from "../utils/settingsAndChangelog";
import { asText, clamp } from "../utils/text";

// This hook owns initialization and derived values that are recomputed from current state.
// It keeps the main hook thin while preserving the original behavior.

export function useEditorDerivedState({
  overlays,
  restaurant,
  params,
  config,

  draftOverlays,
  draftMenuImages,
  selectedOverlayKey,
  activePageIndex,
  pendingSaveBatchId,
  pendingSaveStateHash,
  saveStatus,
  restaurantSettingsDraft,

  baselineRef,
  settingsBaselineRef,
  hydratedRestaurantIdRef,
  historyRef,
  overlaysRef,

  clearPendingSaveBatch,
  clearSaveStatusTimer,
  setAiAssistDraft,

  setDraftOverlays,
  setDraftMenuImages,
  setActivePageIndex,
  setZoomScale,
  setSelectedOverlayKey,
  setPendingChanges,
  setSaveError,
  setIsSaving,
  setSaveStatus,
  setRestaurantSettingsDraft,
  setSettingsSaveError,
  setDishEditorOpen,
  setDishAiAssistOpen,
  setChangeLogOpen,
  setConfirmInfoOpen,
  setMenuPagesOpen,
  setRestaurantSettingsOpen,
  setDetectWizardOpen,
  setDetectWizardState,
  setInitialDishResolved,
  setHistoryIndex,
}) {
  // Central overlay list setter that keeps `overlaysRef` synchronized.
  const applyOverlayList = useCallback((updater) => {
    setDraftOverlays((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      overlaysRef.current = next;
      return next;
    });
  }, [overlaysRef, setDraftOverlays]);

  // Reinitialize editor state when upstream restaurant payload identity changes.
  useEffect(() => {
    const nextOverlaysRaw = Array.isArray(overlays)
      ? overlays
      : Array.isArray(restaurant?.overlays)
        ? restaurant.overlays
        : [];

    const nextMenuImages = buildMenuImages(restaurant);
    const context = buildOverlayNormalizationContext(nextOverlaysRaw, nextMenuImages.length);
    const nextOverlays = nextOverlaysRaw.map((overlay, index) =>
      ensureOverlayVisibility(
        normalizeOverlay(
          overlay,
          index,
          overlay?._editorKey || `ov-${Date.now()}-${index}`,
          context,
        ),
        nextMenuImages.length,
      ),
    );

    const nextBaseline = serializeEditorState(nextOverlays, nextMenuImages);
    const settingsDraft = createEmptySettingsDraft(restaurant);
    const nextSettingsBaseline = serializeSettingsDraft(settingsDraft);
    const nextRestaurantId = asText(restaurant?.id);

    const shouldReinitialize =
      nextBaseline !== baselineRef.current ||
      nextSettingsBaseline !== settingsBaselineRef.current ||
      nextRestaurantId !== hydratedRestaurantIdRef.current;

    // Skip full reinit when baseline/settings identity did not change.
    if (!shouldReinitialize) {
      setChangeLogOpen(Boolean(params?.openLog));
      setConfirmInfoOpen(Boolean(params?.openConfirm));
      return;
    }

    // Fresh baseline means this is the new source-of-truth snapshot.
    baselineRef.current = nextBaseline;
    settingsBaselineRef.current = nextSettingsBaseline;
    hydratedRestaurantIdRef.current = nextRestaurantId;

    setDraftOverlays(nextOverlays);
    setDraftMenuImages(nextMenuImages);
    setActivePageIndex(0);
    setZoomScale(1);
    setSelectedOverlayKey(nextOverlays[0]?._editorKey || "");
    setPendingChanges([]);
    clearPendingSaveBatch();
    setSaveError("");
    setIsSaving(false);
    clearSaveStatusTimer();
    setSaveStatus("idle");

    setRestaurantSettingsDraft(settingsDraft);
    setSettingsSaveError("");

    const firstSnapshot = {
      overlays: JSON.parse(JSON.stringify(nextOverlays)),
      menuImages: [...nextMenuImages],
      pendingChanges: [],
    };
    historyRef.current = [firstSnapshot];
    setHistoryIndex(0);

    setDishEditorOpen(false);
    setDishAiAssistOpen(false);
    setChangeLogOpen(Boolean(params?.openLog));
    setConfirmInfoOpen(Boolean(params?.openConfirm));
    setMenuPagesOpen(false);
    setRestaurantSettingsOpen(false);
    setDetectWizardOpen(false);
    setDetectWizardState({
      loading: false,
      dishes: [],
      currentIndex: 0,
      error: "",
    });
    setInitialDishResolved(false);

    setAiAssistDraft({
      text: "",
      imageData: "",
      loading: false,
      error: "",
      result: null,
    });
  }, [
    baselineRef,
    clearPendingSaveBatch,
    clearSaveStatusTimer,
    hydratedRestaurantIdRef,
    overlays,
    params?.openConfirm,
    params?.openLog,
    restaurant?.delivery_url,
    restaurant?.id,
    restaurant?.menuImage,
    restaurant?.menuImages,
    restaurant?.menu_url,
    restaurant?.overlays,
    restaurant?.phone,
    restaurant?.website,
    settingsBaselineRef,
    setActivePageIndex,
    setAiAssistDraft,
    setChangeLogOpen,
    setConfirmInfoOpen,
    setDetectWizardOpen,
    setDetectWizardState,
    setDishAiAssistOpen,
    setDishEditorOpen,
    setDraftMenuImages,
    setDraftOverlays,
    setHistoryIndex,
    setInitialDishResolved,
    setIsSaving,
    setMenuPagesOpen,
    setPendingChanges,
    setRestaurantSettingsDraft,
    setRestaurantSettingsOpen,
    setSaveError,
    setSaveStatus,
    setSelectedOverlayKey,
    setSettingsSaveError,
    setZoomScale,
    historyRef,
  ]);

  // Canonical serialized state is used for dirty checks and pending-save hash checks.
  const editorStateSerialized = useMemo(
    () => serializeEditorState(draftOverlays, draftMenuImages),
    [draftMenuImages, draftOverlays],
  );

  // If user edited after staging pending save, drop stale staged payload.
  useEffect(() => {
    if (!pendingSaveBatchId || !pendingSaveStateHash) return;
    if (editorStateSerialized === pendingSaveStateHash) return;
    clearPendingSaveBatch();
  }, [
    clearPendingSaveBatch,
    editorStateSerialized,
    pendingSaveBatchId,
    pendingSaveStateHash,
  ]);

  const isDirty = editorStateSerialized !== baselineRef.current;
  const settingsDirty =
    serializeSettingsDraft(restaurantSettingsDraft) !== settingsBaselineRef.current;

  // Baseline snapshot parser exposed to callers that need "last saved" state.
  const getBaselineSnapshot = useCallback(() => {
    return parseSerializedEditorState(baselineRef.current);
  }, [baselineRef]);

  // Any edit while status is "saved"/"error" resets badge back to idle.
  useEffect(() => {
    if (!isDirty) return;
    if (saveStatus === "saving") return;
    if (saveStatus !== "idle") {
      clearSaveStatusTimer();
      setSaveStatus("idle");
    }
  }, [clearSaveStatusTimer, isDirty, saveStatus, setSaveStatus]);

  // Selected overlay follows selected key with safe fallback to first overlay.
  const selectedOverlay = useMemo(() => {
    if (!selectedOverlayKey) return draftOverlays[0] || null;
    return (
      draftOverlays.find((overlay) => overlay._editorKey === selectedOverlayKey) ||
      draftOverlays[0] ||
      null
    );
  }, [draftOverlays, selectedOverlayKey]);

  // Token lookups make canonicalization O(1) and deterministic.
  const allergenTokenLookup = useMemo(
    () => buildCanonicalTokenLookup(config?.ALLERGENS),
    [config?.ALLERGENS],
  );
  const dietTokenLookup = useMemo(
    () => buildCanonicalTokenLookup(config?.DIETS),
    [config?.DIETS],
  );

  // Normalize one allergen value into configured canonical label.
  const normalizeAllergenValue = useCallback(
    (value) =>
      resolveCanonicalValue(value, {
        strictNormalizer: config?.normalizeAllergen,
        tokenLookup: allergenTokenLookup,
      }),
    [allergenTokenLookup, config?.normalizeAllergen],
  );

  // Normalize one diet value into configured canonical label with alias fallback.
  const normalizeDietValue = useCallback(
    (value) =>
      resolveCanonicalValue(value, {
        strictNormalizer: config?.normalizeDietLabel,
        tokenLookup: dietTokenLookup,
        aliasResolver: (token) => findDietAlias(token, dietTokenLookup),
      }),
    [config?.normalizeDietLabel, dietTokenLookup],
  );

  // Normalize entire allergen list and dedupe.
  const normalizeAllergenList = useCallback(
    (values) => normalizeCanonicalList(values, normalizeAllergenValue),
    [normalizeAllergenValue],
  );

  // Normalize entire diet list and dedupe.
  const normalizeDietList = useCallback(
    (values) => normalizeCanonicalList(values, normalizeDietValue),
    [normalizeDietValue],
  );

  const selectedOverlayIndex = useMemo(() => {
    if (!selectedOverlay?._editorKey) return -1;
    return draftOverlays.findIndex(
      (overlay) => overlay._editorKey === selectedOverlay._editorKey,
    );
  }, [draftOverlays, selectedOverlay?._editorKey]);

  const selectedPageIndex = selectedOverlay
    ? clamp(
        Number.isFinite(Number(selectedOverlay.pageIndex))
          ? Number(selectedOverlay.pageIndex)
          : 0,
        0,
        Math.max(draftMenuImages.length - 1, 0),
      )
    : activePageIndex;

  // Pre-group overlays by page to avoid repeated filtering during render.
  const overlaysByPage = useMemo(() => {
    const pages = Array.from({ length: Math.max(draftMenuImages.length, 1) }, (_, index) => ({
      pageIndex: index,
      image: draftMenuImages[index] || "",
      overlays: [],
    }));

    draftOverlays.forEach((overlay) => {
      const page = clamp(
        Number.isFinite(Number(overlay.pageIndex)) ? Number(overlay.pageIndex) : 0,
        0,
        Math.max(pages.length - 1, 0),
      );
      pages[page].overlays.push(overlay);
    });

    return pages;
  }, [draftMenuImages, draftOverlays]);

  return {
    applyOverlayList,
    editorStateSerialized,
    isDirty,
    settingsDirty,
    getBaselineSnapshot,
    selectedOverlay,
    selectedOverlayIndex,
    selectedPageIndex,
    overlaysByPage,
    normalizeAllergenValue,
    normalizeDietValue,
    normalizeAllergenList,
    normalizeDietList,
  };
}
