"use client";

import { useCallback, useRef, useState } from "react";

import { useAiDishActions } from "./useRestaurantEditor/hooks/useAiDishActions";
import { useChangeLogAndPendingTable } from "./useRestaurantEditor/hooks/useChangeLogAndPendingTable";
import { useDetectWizardActions } from "./useRestaurantEditor/hooks/useDetectWizardActions";
import { useEditorDerivedState } from "./useRestaurantEditor/hooks/useEditorDerivedState";
import { useEditorGlobalEffects } from "./useRestaurantEditor/hooks/useEditorGlobalEffects";
import { useEditorHistory } from "./useRestaurantEditor/hooks/useEditorHistory";
import { useIngredientServiceActions } from "./useRestaurantEditor/hooks/useIngredientServiceActions";
import { useMenuPageActions } from "./useRestaurantEditor/hooks/useMenuPageActions";
import { useMenuPageAnalysis } from "./useRestaurantEditor/hooks/useMenuPageAnalysis";
import { useOverlayActions } from "./useRestaurantEditor/hooks/useOverlayActions";
import { usePersistenceActions } from "./useRestaurantEditor/hooks/usePersistenceActions";
import { buildEditorApi } from "./useRestaurantEditor/buildEditorApi";
import { createEmptySettingsDraft } from "./useRestaurantEditor/utils/settingsAndChangelog";
import {
  buildBrandRequirementIssues,
  buildIngredientConfirmationIssues,
  buildOverlayBrandRequirementIssues,
  buildOverlayIngredientConfirmationIssues,
} from "./useRestaurantEditor/utils/overlayIssues";

// Main restaurant editor orchestrator.
// This file now focuses on state wiring and public API shape, while feature logic lives in focused hooks.

export function useRestaurantEditor({
  restaurant,
  overlays,
  permissions,
  config,
  previewPreferences,
  params,
  callbacks,
}) {
  // Permission gate used by save/prepare/edit UI flows.
  const canEdit = Boolean(permissions?.canEdit);

  // Core editor state.
  const [draftOverlays, setDraftOverlays] = useState([]);
  const [draftMenuImages, setDraftMenuImages] = useState([""]);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [zoomScale, setZoomScale] = useState(1);
  const [selectedOverlayKey, setSelectedOverlayKey] = useState("");
  const [pendingChanges, setPendingChanges] = useState([]);
  const [pendingSaveBatchId, setPendingSaveBatchId] = useState("");
  const [pendingSaveRows, setPendingSaveRows] = useState([]);
  const [pendingSaveStateHash, setPendingSaveStateHash] = useState("");
  const [pendingSaveError, setPendingSaveError] = useState("");
  const [pendingSavePreparing, setPendingSavePreparing] = useState(false);

  // Save/status UI state.
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle");

  // Dialog/open state.
  const [dishEditorOpen, setDishEditorOpen] = useState(false);
  const [dishAiAssistOpen, setDishAiAssistOpen] = useState(false);
  const [changeLogOpen, setChangeLogOpen] = useState(false);
  const [pendingTableOpen, setPendingTableOpen] = useState(false);
  const [confirmInfoOpen, setConfirmInfoOpen] = useState(false);
  const [menuPagesOpen, setMenuPagesOpen] = useState(false);
  const [restaurantSettingsOpen, setRestaurantSettingsOpen] = useState(false);
  const [detectWizardOpen, setDetectWizardOpen] = useState(false);

  // Change-log/pending-table data state.
  const [changeLogs, setChangeLogs] = useState([]);
  const [loadingChangeLogs, setLoadingChangeLogs] = useState(false);
  const [changeLogError, setChangeLogError] = useState("");
  const changeLogLoadedForOpenRef = useRef(false);
  const [pendingTableRows, setPendingTableRows] = useState([]);
  const [pendingTableBatch, setPendingTableBatch] = useState(null);
  const [loadingPendingTable, setLoadingPendingTable] = useState(false);
  const [pendingTableError, setPendingTableError] = useState("");
  const pendingTableLoadedForOpenRef = useRef(false);
  const pendingTableLoadPromiseRef = useRef(null);

  // Confirm/settings state.
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [restaurantSettingsDraft, setRestaurantSettingsDraft] = useState(
    createEmptySettingsDraft(restaurant),
  );
  const [settingsSaveBusy, setSettingsSaveBusy] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState("");

  // Detect wizard and initial route-dish tracking state.
  const [detectWizardState, setDetectWizardState] = useState({
    loading: false,
    dishes: [],
    currentIndex: 0,
    error: "",
  });
  const [initialDishResolved, setInitialDishResolved] = useState(false);

  // AI assist draft state.
  const [aiAssistDraft, setAiAssistDraftState] = useState({
    text: "",
    imageData: "",
    loading: false,
    error: "",
    result: null,
  });

  // Refs mirror mutable values used across async callbacks and history snapshots.
  const baselineRef = useRef("");
  const settingsBaselineRef = useRef("");
  const hydratedRestaurantIdRef = useRef("");
  const historyRef = useRef([]);
  const saveStatusTimerRef = useRef(0);
  const pendingSaveSyncTimerRef = useRef(0);
  const [historyIndex, setHistoryIndex] = useState(0);

  const overlaysRef = useRef(draftOverlays);
  const menuImagesRef = useRef(draftMenuImages);
  const pendingChangesRef = useRef(pendingChanges);
  const aiAssistDraftRef = useRef(aiAssistDraft);

  // History module owns snapshot/undo/redo and mirrored refs for async safety.
  const historyApi = useEditorHistory({
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
  });

  // Derived-state module owns baseline hydration, dirty checks, and canonical normalizers.
  const derivedApi = useEditorDerivedState({
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

    clearPendingSaveBatch: historyApi.clearPendingSaveBatch,
    clearSaveStatusTimer: historyApi.clearSaveStatusTimer,
    setAiAssistDraft: historyApi.setAiAssistDraft,

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
  });

  // Overlay action handlers (add/remove/update/select/tags).
  const overlayActions = useOverlayActions({
    selectedOverlay: derivedApi.selectedOverlay,
    activePageIndex,
    draftOverlaysLength: draftOverlays.length,
    menuImagesRef,
    overlaysRef,

    setSelectedOverlayKey,
    setDishEditorOpen,
    setDishAiAssistOpen,
    setAiAssistDraft: historyApi.setAiAssistDraft,

    applyOverlayList: derivedApi.applyOverlayList,
    appendPendingChange: historyApi.appendPendingChange,
    pushHistory: historyApi.pushHistory,
  });

  // Menu page action handlers (add/replace/remove/reorder/zoom/page-nav).
  const menuPageActions = useMenuPageActions({
    activePageIndex,
    draftMenuImages,
    menuImagesRef,

    setDraftMenuImages,
    setActivePageIndex,
    setZoomScale,

    applyOverlayList: derivedApi.applyOverlayList,
    appendPendingChange: historyApi.appendPendingChange,
    pushHistory: historyApi.pushHistory,
  });

  // Bulk page analysis handler (detect/remap + merge).
  const analyzeMenuPagesAndMergeOverlays = useMenuPageAnalysis({
    callbacks,
    menuImagesRef,
    applyOverlayList: derivedApi.applyOverlayList,
    appendPendingChange: historyApi.appendPendingChange,
    pushHistory: historyApi.pushHistory,
  });

  // Lazy-load modal data for change logs and pending-save table previews.
  const changeLogAndPendingTableActions = useChangeLogAndPendingTable({
    callbacks,
    restaurant,
    changeLogOpen,
    pendingTableOpen,

    changeLogLoadedForOpenRef,
    pendingTableLoadedForOpenRef,
    pendingTableLoadPromiseRef,

    setLoadingChangeLogs,
    setChangeLogError,
    setChangeLogs,
    setLoadingPendingTable,
    setPendingTableError,
    setPendingTableBatch,
    setPendingTableRows,

    restoreHistorySnapshot: historyApi.restoreHistorySnapshot,
    appendPendingChange: historyApi.appendPendingChange,
    pushHistory: historyApi.pushHistory,
  });

  // Save/stage/confirm/settings write actions.
  const persistenceActions = usePersistenceActions({
    canEdit,
    restaurant,
    callbacks,

    isSaving,
    isDirty: derivedApi.isDirty,
    editorStateSerialized: derivedApi.editorStateSerialized,
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

    clearSaveStatusTimer: historyApi.clearSaveStatusTimer,
    clearPendingSaveBatch: historyApi.clearPendingSaveBatch,
    restoreHistorySnapshot: historyApi.restoreHistorySnapshot,

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
  });

  // AI dish analysis + apply-to-overlay actions.
  const aiDishActions = useAiDishActions({
    selectedOverlay: derivedApi.selectedOverlay,
    callbacks,
    config,
    aiAssistDraftRef,

    normalizeAllergenList: derivedApi.normalizeAllergenList,
    normalizeDietList: derivedApi.normalizeDietList,
    updateOverlay: overlayActions.updateOverlay,
    appendPendingChange: historyApi.appendPendingChange,
    pushHistory: historyApi.pushHistory,
    setAiAssistDraft: historyApi.setAiAssistDraft,
  });

  // Ingredient-level callback wrappers (analysis, scan flows, appeals).
  const ingredientServiceActions = useIngredientServiceActions({
    callbacks,
    restaurant,
    selectedOverlay: derivedApi.selectedOverlay,
    normalizeAllergenList: derivedApi.normalizeAllergenList,
    normalizeDietList: derivedApi.normalizeDietList,
  });

  // Manual detect wizard action handlers.
  const detectWizardActions = useDetectWizardActions({
    callbacks,
    draftMenuImages,
    activePageIndex,
    detectWizardState,
    draftOverlaysLength: draftOverlays.length,
    menuImagesRef,

    setDetectWizardState,
    setDetectWizardOpen,
    setSelectedOverlayKey,

    applyOverlayList: derivedApi.applyOverlayList,
    appendPendingChange: historyApi.appendPendingChange,
    pushHistory: historyApi.pushHistory,
  });

  // Global effects for route-driven selection, keyboard shortcuts, and unload guard.
  useEditorGlobalEffects({
    initialDishResolved,
    setInitialDishResolved,
    params,
    draftOverlays,
    setSelectedOverlayKey,
    setActivePageIndex,
    setDishEditorOpen,
    setDishAiAssistOpen,
    setAiAssistDraft: historyApi.setAiAssistDraft,
    canEdit,
    undo: historyApi.undo,
    redo: historyApi.redo,
    isDirty: derivedApi.isDirty,
  });

  // Expose brand requirement issues for one overlay or all overlays.
  const getBrandRequirementIssues = useCallback((overlay) => {
    if (overlay) {
      return buildOverlayBrandRequirementIssues(overlay);
    }
    return buildBrandRequirementIssues(overlaysRef.current);
  }, [overlaysRef]);

  // Expose ingredient confirmation issues for one overlay or all overlays.
  const getIngredientConfirmationIssues = useCallback((overlay) => {
    if (overlay) {
      return buildOverlayIngredientConfirmationIssues(overlay);
    }
    return buildIngredientConfirmationIssues(overlaysRef.current);
  }, [overlaysRef]);

  // Final stable API shape consumed by editor UI components.
  return buildEditorApi({
    canEdit,
    draftOverlays,
    draftMenuImages,
    selectedOverlayKey,
    activePageIndex,
    zoomScale,
    pendingChanges,
    pendingSaveBatchId,
    pendingSaveRows,
    pendingSaveError,
    pendingSavePreparing,
    saveError,
    isSaving,
    saveStatus,

    dishEditorOpen,
    dishAiAssistOpen,
    setDishAiAssistOpen,
    aiAssistDraft,

    confirmBusy,
    confirmError,
    confirmInfoOpen,
    setConfirmInfoOpen,

    changeLogOpen,
    setChangeLogOpen,
    changeLogs,
    loadingChangeLogs,
    changeLogError,

    pendingTableOpen,
    setPendingTableOpen,
    pendingTableRows,
    pendingTableBatch,
    loadingPendingTable,
    pendingTableError,

    menuPagesOpen,
    setMenuPagesOpen,

    restaurantSettingsOpen,
    setRestaurantSettingsOpen,
    restaurantSettingsDraft,
    setRestaurantSettingsDraft,
    settingsSaveBusy,
    settingsSaveError,

    detectWizardOpen,
    setDetectWizardOpen,
    detectWizardState,

    setActivePageIndex,
    setZoomScale,

    historyApi,
    derivedApi,
    overlayActions,
    menuPageActions,
    analyzeMenuPagesAndMergeOverlays,
    changeLogAndPendingTableActions,
    persistenceActions,
    aiDishActions,
    ingredientServiceActions,
    detectWizardActions,
    getBrandRequirementIssues,
    getIngredientConfirmationIssues,

    routeParams: params,
    config,
    previewPreferences,
  });
}

export default useRestaurantEditor;
