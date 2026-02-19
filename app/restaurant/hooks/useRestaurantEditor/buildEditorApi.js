import { asText } from "./utils/text";

// Builds the public API object returned by `useRestaurantEditor`.
// Keeping this mapping separate keeps the main hook under the size cap and easier to scan.

export function buildEditorApi({
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

  routeParams,
  config,
  previewPreferences,
}) {
  // Keep return shape stable for existing UI consumers.
  // This builder is intentionally a plain mapping layer (no side effects).
  return {
    canEdit,
    overlays: draftOverlays,
    draftOverlays,
    draftMenuImages,
    overlaysByPage: derivedApi.overlaysByPage,
    selectedOverlay: derivedApi.selectedOverlay,
    selectedOverlayIndex: derivedApi.selectedOverlayIndex,
    selectedOverlayKey,
    selectedPageIndex: derivedApi.selectedPageIndex,
    activePageIndex,
    zoomScale,
    routeParams,

    pendingChanges,
    pendingSaveBatchId,
    pendingSaveRows,
    pendingSaveError,
    pendingSavePreparing,
    getBaselineSnapshot: derivedApi.getBaselineSnapshot,
    isDirty: derivedApi.isDirty,
    saveError,
    isSaving,
    saveStatus,

    canUndo: historyApi.canUndo,
    canRedo: historyApi.canRedo,
    undo: historyApi.undo,
    undoPendingChange: historyApi.undoPendingChange,
    redo: historyApi.redo,
    pushHistory: historyApi.pushHistory,

    selectOverlay: overlayActions.selectOverlay,
    updateOverlay: overlayActions.updateOverlay,
    applyOverlayList: derivedApi.applyOverlayList,
    updateSelectedOverlay: overlayActions.updateSelectedOverlay,
    addOverlay: overlayActions.addOverlay,
    removeOverlay: overlayActions.removeOverlay,

    openDishEditor: overlayActions.openDishEditor,
    closeDishEditor: overlayActions.closeDishEditor,
    dishEditorOpen,

    dishAiAssistOpen,
    setDishAiAssistOpen,
    aiAssistDraft,
    setAiAssistDraft: historyApi.setAiAssistDraft,
    runAiDishAnalysis: aiDishActions.runAiDishAnalysis,
    applyAiResultToSelectedOverlay: aiDishActions.applyAiResultToSelectedOverlay,
    analyzeIngredientName: ingredientServiceActions.analyzeIngredientName,
    analyzeIngredientScanRequirement: ingredientServiceActions.analyzeIngredientScanRequirement,
    submitIngredientAppeal: ingredientServiceActions.submitIngredientAppeal,
    openIngredientLabelScan: ingredientServiceActions.openIngredientLabelScan,
    resumeIngredientLabelScan: ingredientServiceActions.resumeIngredientLabelScan,
    detectMenuCorners: ingredientServiceActions.detectMenuCorners,

    toggleSelectedAllergen: overlayActions.toggleSelectedAllergen,
    setSelectedAllergenDetail: overlayActions.setSelectedAllergenDetail,
    setSelectedAllergenRemovable: overlayActions.setSelectedAllergenRemovable,
    setSelectedAllergenCrossContamination: overlayActions.setSelectedAllergenCrossContamination,
    toggleSelectedDiet: overlayActions.toggleSelectedDiet,

    jumpToPage: menuPageActions.jumpToPage,
    setActivePageIndex,
    zoomIn: menuPageActions.zoomIn,
    zoomOut: menuPageActions.zoomOut,
    zoomReset: menuPageActions.zoomReset,
    setZoomScale,

    save: persistenceActions.save,
    preparePendingSave: persistenceActions.preparePendingSave,
    clearPendingSaveBatch: historyApi.clearPendingSaveBatch,
    discardUnsavedChanges: persistenceActions.discardUnsavedChanges,
    confirmInfo: persistenceActions.confirmInfo,
    confirmBusy,
    confirmError,
    confirmInfoOpen,
    setConfirmInfoOpen,

    changeLogOpen,
    setChangeLogOpen,
    changeLogs,
    loadingChangeLogs,
    changeLogError,
    loadChangeLogs: changeLogAndPendingTableActions.loadChangeLogs,
    restoreFromChangeLog: changeLogAndPendingTableActions.restoreFromChangeLog,

    pendingTableOpen,
    setPendingTableOpen,
    pendingTableRows,
    pendingTableBatch,
    loadingPendingTable,
    pendingTableError,
    loadPendingTable: changeLogAndPendingTableActions.loadPendingTable,

    menuPagesOpen,
    setMenuPagesOpen,
    createDraftSnapshot: historyApi.createDraftSnapshot,
    restoreDraftSnapshot: historyApi.restoreDraftSnapshot,
    addMenuPages: menuPageActions.addMenuPages,
    addMenuPage: menuPageActions.addMenuPage,
    replaceMenuPage: menuPageActions.replaceMenuPage,
    replaceMenuPageWithSections: menuPageActions.replaceMenuPageWithSections,
    removeMenuPage: menuPageActions.removeMenuPage,
    moveMenuPage: menuPageActions.moveMenuPage,
    analyzeMenuPagesAndMergeOverlays,

    restaurantSettingsOpen,
    setRestaurantSettingsOpen,
    restaurantSettingsDraft,
    setRestaurantSettingsDraft,
    saveRestaurantSettings: persistenceActions.saveRestaurantSettings,
    settingsDirty: derivedApi.settingsDirty,
    settingsSaveBusy,
    settingsSaveError,

    detectWizardOpen,
    setDetectWizardOpen,
    detectWizardState,
    runDetectDishes: detectWizardActions.runDetectDishes,
    mapDetectedDish: detectWizardActions.mapDetectedDish,
    setDetectWizardIndex: detectWizardActions.setDetectWizardIndex,
    closeDetectWizard: detectWizardActions.closeDetectWizard,
    getBrandRequirementIssues,
    getIngredientConfirmationIssues,

    // Expose normalized config helpers and persisted preference labels for UI rendering.
    config: {
      allergens: Array.isArray(config?.ALLERGENS) ? config.ALLERGENS : [],
      diets: Array.isArray(config?.DIETS) ? config.DIETS : [],
      normalizeAllergen: derivedApi.normalizeAllergenValue,
      normalizeDietLabel: derivedApi.normalizeDietValue,
      normalizeAllergenList: derivedApi.normalizeAllergenList,
      normalizeDietList: derivedApi.normalizeDietList,
      formatAllergenLabel:
        typeof config?.formatAllergenLabel === "function"
          ? config.formatAllergenLabel
          : (value) => asText(value),
      formatDietLabel:
        typeof config?.formatDietLabel === "function"
          ? config.formatDietLabel
          : (value) => asText(value),
      getAllergenEmoji:
        typeof config?.getAllergenEmoji === "function"
          ? config.getAllergenEmoji
          : () => "",
      getDietEmoji:
        typeof config?.getDietEmoji === "function"
          ? config.getDietEmoji
          : () => "",
      getDietAllergenConflicts:
        typeof config?.getDietAllergenConflicts === "function"
          ? config.getDietAllergenConflicts
          : () => [],
      savedAllergens: (Array.isArray(previewPreferences?.allergies)
        ? previewPreferences.allergies
        : []
      ).map((value) => ({
        key: value,
        label:
          typeof config?.formatAllergenLabel === "function"
            ? config.formatAllergenLabel(value)
            : asText(value),
        emoji:
          typeof config?.getAllergenEmoji === "function"
            ? config.getAllergenEmoji(value)
            : "",
      })),
      savedDiets: (Array.isArray(previewPreferences?.diets) ? previewPreferences.diets : []).map(
        (value) => ({
          key: value,
          label:
            typeof config?.formatDietLabel === "function"
              ? config.formatDietLabel(value)
              : asText(value),
          emoji:
            typeof config?.getDietEmoji === "function" ? config.getDietEmoji(value) : "",
        }),
      ),
    },
  };
}
