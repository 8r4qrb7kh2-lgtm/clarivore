import {
  getEditorMiniMapResizeHandler,
  setEditorDirty,
  setEditorForceDirty,
  setEditorOverrideCurrentPage,
  setEditorOverrideMenuImages,
  setEditorOverrideOverlays,
  setEditorOverridePendingChanges,
} from "./restaurantRuntimeBridge.js";

export function createEditorRenderer(options) {
  const {
    state,
    renderTopbar,
    mountEditorShell,
    setRootOffsetPadding,
    bindEditorToolbarScale,
    initializeEditorAssets,
    initEditorSections,
    div,
    createDirtyController,
    createEditorChangeState,
    initEditorHistory,
    initEditorOverlays,
    initEditorSaveFlow,
    send,
    esc,
    aiAssistSetStatus,
    cap,
    formatAllergenLabel,
    getDietAllergenConflicts,
    tooltipBodyHTML,
    createEditorLastConfirmedUpdater,
    getWeeksAgoInfo,
    fmtDateTime,
    initBrandVerification,
    getIssueReportMeta,
    openDishEditor,
    getAiAssistTableBody,
    showIngredientPhotoUploadModal,
    renderGroupedSourcesHtml,
    configureModalClose,
    normalizeDietLabel,
    normalizeAllergen,
    ALLERGENS,
    DIETS,
    norm,
    getSupabaseKey,
    getFetchProductByBarcode,
    getOpenImageModal,
    getShowReplacementPreview,
    initChangeLog,
    initEditorSettings,
    orderFlow,
    bindEditorRuntimeBindings,
    bindEditorHistoryControls,
    bindDetectDishesButton,
    detectDishesOnMenu,
    initEditorNavigation,
    initMenuImageEditor,
    analyzeBoxSizes,
    splitImageIntoSections,
    bindEditorBackButton,
    createEditorItemEditor,
    openPendingDishInEditor,
    applyPendingMenuIndexRemap,
    setEditorSaveApi,
    setCollectAllBrandItems,
    setOpenBrandVerification,
    setOpenChangeLog,
    setUpdateLastConfirmedText,
    renderApp,
  } = options;

  function renderEditor() {
    setEditorDirty(false);
    renderTopbar();
    const rs = state.restaurant || {};
    const root = document.getElementById("root");
    mountEditorShell(root);
    setRootOffsetPadding("0");
    const menu = document.getElementById("menu");
    const { syncToolbarScale } = bindEditorToolbarScale({
      state,
      isEditorPage: () => state.page === "editor",
      onMiniMapResize: () => {
        const miniMapResizeHandler = getEditorMiniMapResizeHandler();
        if (typeof miniMapResizeHandler === "function") {
          miniMapResizeHandler();
        }
      },
    });

    const editorAssets = initializeEditorAssets(rs);
    const { menuImages, originalMenuImages, overlays } = editorAssets;
    let currentPageIndex = editorAssets.currentPageIndex;
    const { applyCurrentPageOnLoad } = editorAssets;

    const editorSections = [];
    let updateEditorMiniMap = null;
    let inner;
    let img;

    const editorSectionsApi = initEditorSections({
      menu,
      menuImages,
      div,
      editorSections,
      getCurrentPageIndex: () => currentPageIndex,
      setCurrentPageIndex: (value) => {
        currentPageIndex = value;
      },
      getDrawAll: () => drawAll,
      setRefs: ({ inner: nextInner, img: nextImg }) => {
        inner = nextInner;
        img = nextImg;
      },
    });

    updateEditorMiniMap = editorSectionsApi.updateEditorMiniMap;
    const rebuildEditorSectionsFromMenuImages =
      editorSectionsApi.rebuildEditorSectionsFromMenuImages;
    requestAnimationFrame(syncToolbarScale);

    function syncEditorMenuImages() {
      const shouldBeMulti = menuImages.length > 1;
      const isMulti = editorSections.length > 0;
      if (shouldBeMulti !== isMulti) {
        const currentPendingChanges = getPendingChanges();
        setEditorOverrideOverlays(JSON.parse(JSON.stringify(overlays)));
        setEditorOverrideMenuImages(JSON.parse(JSON.stringify(menuImages)));
        setEditorOverridePendingChanges([...currentPendingChanges]);
        setEditorOverrideCurrentPage(currentPageIndex);
        setEditorForceDirty(isDirty() || currentPendingChanges.length > 0);
        renderEditor();
        return true;
      }
      if (editorSections.length > 0) {
        rebuildEditorSectionsFromMenuImages();
        return false;
      }
      if (img) {
        img.src = menuImages[0] || "";
        if (img.complete) {
          drawAll();
        } else {
          img.addEventListener("load", () => drawAll(), { once: true });
        }
      }
      return false;
    }

    const updateMenuNavigationUI = () => {
      const menuTopNav = document.getElementById("menuTopNav");
      const menuBottomNav = document.getElementById("menuBottomNav");
      if (menuTopNav) menuTopNav.style.display = "none";
      if (menuBottomNav) menuBottomNav.style.display = "none";
    };
    updateMenuNavigationUI();
    const applyPendingMenuIndexRemapToOverlays = (oldImages, indexMap) =>
      applyPendingMenuIndexRemap({ overlays, oldImages, indexMap });

    console.log(
      "renderEditor: Checking aiIngredients in loaded overlays:",
      overlays.map((o) => ({
        id: o.id,
        hasAiIngredients: !!o.aiIngredients,
        aiIngredientsType: typeof o.aiIngredients,
        aiIngredientsPreview: o.aiIngredients
          ? typeof o.aiIngredients === "string"
            ? `${o.aiIngredients.substring(0, 100)}...`
            : JSON.stringify(o.aiIngredients).substring(0, 100)
          : null,
      })),
    );

    const saveBtn = document.getElementById("saveBtn");
    const dirtyController = createDirtyController(saveBtn);
    const setDirty = dirtyController.setDirty;
    const isDirty = dirtyController.isDirty;

    const editorChangeState = createEditorChangeState(rs);
    const getPendingChanges = editorChangeState.getPendingChanges;
    const setPendingChanges = editorChangeState.setPendingChanges;
    const getOriginalOverlaysRef = editorChangeState.getOriginalOverlaysRef;
    const setOriginalOverlaysRef = editorChangeState.setOriginalOverlaysRef;
    const getOriginalRestaurantSettings =
      editorChangeState.getOriginalRestaurantSettings;
    const pendingChanges = getPendingChanges();

    const editorHistoryApi = initEditorHistory({
      overlays,
      pendingChanges,
      setDirty,
      getDrawAll: () => drawAll,
    });
    const { pushHistory, undo, redo } = editorHistoryApi;

    const saveReviewApi = initEditorSaveFlow({
      state,
      rs,
      overlays,
      menuImages,
      saveBtn,
      send,
      esc,
      setDirty,
      pushHistory,
      formatAllergenLabel,
      getDrawAll: () => drawAll,
      renderEditor,
      getPendingChanges,
      setPendingChanges,
      getOriginalOverlaysRef,
      setOriginalOverlaysRef,
      getOriginalRestaurantSettings,
      originalMenuImages,
    });
    setEditorSaveApi(saveReviewApi);
    const { setSaveState, formatChangesForLog, describeOverlayChanges } =
      saveReviewApi;

    const mb = document.getElementById("modalBack");
    let openItemEditor = () => {};

    const editorOverlayApi = initEditorOverlays({
      overlays,
      editorSections,
      getInner: () => inner,
      getImg: () => img,
      setDirty,
      pushHistory,
      openItemEditor: (...args) => openItemEditor(...args),
    });
    const drawAll = editorOverlayApi.drawAll;

    if (editorSections.length > 0) {
      let loadedCount = 0;
      editorSections.forEach((section) => {
        const onLoad = () => {
          loadedCount += 1;
          if (loadedCount === editorSections.length) {
            drawAll();
          }
        };
        if (section.img.complete) {
          onLoad();
        } else {
          section.img.addEventListener("load", onLoad, { once: true });
        }
      });
    } else {
      img.onload = drawAll;
      if (img.complete) drawAll();
    }

    const updateLastConfirmedText = createEditorLastConfirmedUpdater({
      state,
      getWeeksAgoInfo,
      fmtDateTime,
    });
    setUpdateLastConfirmedText(updateLastConfirmedText);

    const changeLogApi = initChangeLog({
      esc,
      fmtDateTime,
      configureModalClose,
      send,
      state,
      rs,
      overlays,
      pendingChanges,
      setDirty,
      drawAll,
      pushHistory,
    });
    setOpenChangeLog(changeLogApi.openChangeLog);

    const brandVerificationApi = initBrandVerification({
      overlays,
      rs,
      setDirty,
      drawAll,
      send,
      updateLastConfirmedText,
      getIssueReportMeta,
      openDishEditor,
      getAiAssistTableBody,
      showIngredientPhotoUploadModal,
      renderGroupedSourcesHtml,
      configureModalClose,
      normalizeDietLabel,
      normalizeAllergen,
      ALLERGENS,
      DIETS,
      esc,
      norm,
      SUPABASE_KEY: getSupabaseKey(),
      fetchProductByBarcode: getFetchProductByBarcode(),
      showReplacementPreview: getShowReplacementPreview(),
      openImageModal:
        typeof getOpenImageModal === "function" ? getOpenImageModal() : null,
      showPhotoPreview: changeLogApi.showPhotoPreview,
    });
    setCollectAllBrandItems(brandVerificationApi.collectAllBrandItems);
    setOpenBrandVerification(brandVerificationApi.openBrandVerification);

    const editorSettingsApi = initEditorSettings({
      state,
      esc,
      configureModalClose,
      updateOrderConfirmModeVisibility:
        typeof orderFlow?.updateOrderConfirmModeVisibility === "function"
          ? orderFlow.updateOrderConfirmModeVisibility
          : null,
    });
    const openRestaurantSettings = editorSettingsApi.openRestaurantSettings;

    const editorBindings = bindEditorRuntimeBindings({
      confirmBtn: document.getElementById("confirmBtn"),
      viewLogBtn: document.getElementById("viewLogBtn"),
      settingsBtn: document.getElementById("settingsBtn"),
      openBrandVerification: brandVerificationApi.openBrandVerification,
      openChangeLog: changeLogApi.openChangeLog,
      openRestaurantSettings,
      bindEditorHistoryControls,
      undo,
      redo,
      addBoxButton: document.getElementById("addBox"),
      overlays,
      pendingChanges,
      drawAll,
      setDirty,
      pushHistory,
      getCurrentPageIndex: () => currentPageIndex,
      bindDetectDishesButton,
      detectDishesOnMenu,
      menuImage: rs.menuImage,
      menu,
      img,
      inner,
      initEditorNavigation,
      menuImages,
      editorSections,
      updateEditorMiniMap,
      updateMenuNavigationUI,
      applyCurrentPageOnLoad,
      setCurrentPageIndex: (value) => {
        currentPageIndex = value;
      },
      initMenuImageEditor,
      state,
      rs,
      applyPendingMenuIndexRemap: applyPendingMenuIndexRemapToOverlays,
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
      exitToRestaurant: () => {
        state.page = "restaurant";
        renderApp();
      },
      createEditorItemEditor,
      editorItemEditorDeps: {
        configureModalClose,
        mb,
        esc,
        aiAssistSetStatus,
        cap,
        normalizeAllergen,
        normalizeDietLabel,
        formatAllergenLabel,
        getDietAllergenConflicts,
        tooltipBodyHTML,
        ALLERGENS,
        DIETS,
        pendingChanges,
        overlays,
        drawAll,
        setDirty,
        pushHistory,
        openDishEditor,
      },
      openPendingDishInEditor,
    });
    openItemEditor = editorBindings.openItemEditor;
  }

  return renderEditor;
}
