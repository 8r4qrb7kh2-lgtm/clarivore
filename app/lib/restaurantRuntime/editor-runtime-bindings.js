import {
  getOpenConfirmOnLoad,
  setOpenBrandVerification,
  setOpenConfirmOnLoad,
} from "./restaurantRuntimeBridge.js";

export function bindEditorRuntimeBindings(options = {}) {
  const {
    confirmBtn,
    viewLogBtn,
    settingsBtn,
    openBrandVerification,
    openChangeLog,
    openRestaurantSettings,
    bindEditorHistoryControls,
    undo,
    redo,
    addBoxButton,
    overlays,
    pendingChanges,
    drawAll,
    setDirty,
    pushHistory,
    getCurrentPageIndex,
    bindDetectDishesButton,
    detectDishesOnMenu,
    menuImage,
    menu,
    img,
    inner,
    initEditorNavigation,
    menuImages,
    editorSections,
    updateEditorMiniMap,
    updateMenuNavigationUI,
    applyCurrentPageOnLoad,
    setCurrentPageIndex,
    initMenuImageEditor,
    state,
    rs,
    applyPendingMenuIndexRemap,
    syncEditorMenuImages,
    analyzeBoxSizes,
    splitImageIntoSections,
    bindEditorBackButton,
    isDirty,
    setSaveState,
    describeOverlayChanges,
    formatChangesForLog,
    getOriginalOverlaysRef,
    send,
    exitToRestaurant,
    createEditorItemEditor,
    editorItemEditorDeps,
    openPendingDishInEditor,
  } = options;

  if (confirmBtn) {
    confirmBtn.onclick = () => {
      openBrandVerification();
    };
  }
  setOpenBrandVerification(openBrandVerification);
  if (getOpenConfirmOnLoad()) {
    setTimeout(() => {
      openBrandVerification();
      setOpenConfirmOnLoad(false);
    }, 120);
  }

  if (viewLogBtn) {
    viewLogBtn.onclick = () => {
      openChangeLog();
    };
  }

  if (settingsBtn) {
    settingsBtn.onclick = () => {
      openRestaurantSettings();
    };
  }

  bindEditorHistoryControls({ undo, redo });

  if (addBoxButton) {
    addBoxButton.onclick = () => {
      const newOverlay = {
        id: "",
        x: 10,
        y: 10,
        w: 20,
        h: 8,
        allergens: [],
        removable: [],
        crossContamination: [],
        diets: [],
        details: {},
        pageIndex: getCurrentPageIndex(),
      };
      overlays.push(newOverlay);
      pendingChanges.push(`${newOverlay.id}: Added overlay`);
      drawAll();
      setDirty(true);
      pushHistory();
    };
  }

  bindDetectDishesButton({
    detectDishesOnMenu,
    menuImage,
    menu,
    img,
    inner,
    overlays,
    addPendingChange: (change) => pendingChanges.push(change),
    drawAll,
    setDirty,
    pushHistory,
    getCurrentPageIndex,
  });

  const editorNavigationApi = initEditorNavigation({
    menu,
    menuImages,
    editorSections,
    updateEditorMiniMap,
    updateMenuNavigationUI,
    drawAll,
    getImg: () => img,
    getCurrentPageIndex,
    setCurrentPageIndex,
    applyCurrentPageOnLoad,
  });

  const switchMenuPage = editorNavigationApi.switchMenuPage;

  initMenuImageEditor({
    state,
    rs,
    overlays,
    menuImages,
    pendingChanges,
    setDirty,
    updateMenuNavigationUI,
    applyPendingMenuIndexRemap,
    syncEditorMenuImages,
    switchMenuPage,
    analyzeBoxSizes,
    splitImageIntoSections,
    getCurrentPageIndex,
    setCurrentPageIndex,
  });

  bindEditorBackButton({
    getDirty: () => isDirty(),
    setSaveState,
    getPendingChanges: () => pendingChanges,
    getOverlays: () => overlays,
    getMenuImages: () => menuImages,
    menuImage: rs.menuImage || "",
    describeOverlayChanges,
    formatChangesForLog,
    getOriginalOverlaysRef,
    send,
    exitToRestaurant,
  });

  const openItemEditor = createEditorItemEditor(editorItemEditorDeps);
  window.openItemEditor = openItemEditor;
  openPendingDishInEditor({ overlays, openItemEditor });

  return {
    openItemEditor,
  };
}
