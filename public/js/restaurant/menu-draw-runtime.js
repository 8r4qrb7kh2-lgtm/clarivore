export function createMenuDrawRuntime(deps = {}) {
  const state = deps.state || {};
  const div = typeof deps.div === "function" ? deps.div : () => document.createElement("div");
  const getMenuState =
    typeof deps.getMenuState === "function" ? deps.getMenuState : () => ({});
  const initializeMenuLayout =
    typeof deps.initializeMenuLayout === "function"
      ? deps.initializeMenuLayout
      : () => ({ img: null, layer: null, inner: null });
  const ensureMobileViewerChrome =
    typeof deps.ensureMobileViewerChrome === "function"
      ? deps.ensureMobileViewerChrome
      : () => null;
  const updateZoomIndicator =
    typeof deps.updateZoomIndicator === "function"
      ? deps.updateZoomIndicator
      : () => {};
  const setupMenuPinchZoom =
    typeof deps.setupMenuPinchZoom === "function"
      ? deps.setupMenuPinchZoom
      : () => {};
  const createDishInteractionTracker =
    typeof deps.createDishInteractionTracker === "function"
      ? deps.createDishInteractionTracker
      : () => () => {};
  const normalizeAllergen =
    typeof deps.normalizeAllergen === "function"
      ? deps.normalizeAllergen
      : (value) => String(value ?? "").trim();
  const normalizeDietLabel =
    typeof deps.normalizeDietLabel === "function"
      ? deps.normalizeDietLabel
      : (value) => String(value ?? "").trim();
  const supabaseClient = deps.supabaseClient || null;
  const createMenuOverlayRuntime =
    typeof deps.createMenuOverlayRuntime === "function"
      ? deps.createMenuOverlayRuntime
      : () => ({ showOverlayDetails: () => {}, renderLayer: () => {} });
  const ensureMobileInfoPanel =
    typeof deps.ensureMobileInfoPanel === "function"
      ? deps.ensureMobileInfoPanel
      : () => null;
  const prefersMobileInfo =
    typeof deps.prefersMobileInfo === "function"
      ? deps.prefersMobileInfo
      : () => false;
  const getIsOverlayZoomed =
    typeof deps.getIsOverlayZoomed === "function"
      ? deps.getIsOverlayZoomed
      : () => false;
  const getZoomedOverlayItem =
    typeof deps.getZoomedOverlayItem === "function"
      ? deps.getZoomedOverlayItem
      : () => null;
  const zoomOutOverlay =
    typeof deps.zoomOutOverlay === "function" ? deps.zoomOutOverlay : () => {};
  const hideTip = typeof deps.hideTip === "function" ? deps.hideTip : () => {};
  const zoomToOverlay =
    typeof deps.zoomToOverlay === "function" ? deps.zoomToOverlay : () => {};
  const getMobileInfoPanel =
    typeof deps.getMobileInfoPanel === "function"
      ? deps.getMobileInfoPanel
      : () => null;
  const clearCurrentMobileInfoItem =
    typeof deps.clearCurrentMobileInfoItem === "function"
      ? deps.clearCurrentMobileInfoItem
      : () => {};
  const showTipIn =
    typeof deps.showTipIn === "function" ? deps.showTipIn : () => {};
  const pageTip = deps.pageTip || null;
  const tooltipBodyHTML =
    typeof deps.tooltipBodyHTML === "function" ? deps.tooltipBodyHTML : () => "";
  const getTipPinned =
    typeof deps.getTipPinned === "function" ? deps.getTipPinned : () => false;
  const getPinnedOverlayItem =
    typeof deps.getPinnedOverlayItem === "function"
      ? deps.getPinnedOverlayItem
      : () => null;
  const setOverlayPulseColor =
    typeof deps.setOverlayPulseColor === "function"
      ? deps.setOverlayPulseColor
      : () => {};
  const hasCrossContamination =
    typeof deps.hasCrossContamination === "function"
      ? deps.hasCrossContamination
      : () => false;
  const computeStatus =
    typeof deps.computeStatus === "function" ? deps.computeStatus : () => "neutral";
  const captureMenuBaseDimensions =
    typeof deps.captureMenuBaseDimensions === "function"
      ? deps.captureMenuBaseDimensions
      : () => {};
  const setMobileZoom =
    typeof deps.setMobileZoom === "function" ? deps.setMobileZoom : () => {};
  const getMobileZoomLevel =
    typeof deps.getMobileZoomLevel === "function"
      ? deps.getMobileZoomLevel
      : () => 1;
  const bindMenuOverlayListeners =
    typeof deps.bindMenuOverlayListeners === "function"
      ? deps.bindMenuOverlayListeners
      : () => {};

  function drawMenu(
    container,
    imageURL,
    menuImagesArray = null,
    currentPage = 0,
  ) {
    container.innerHTML = "";

    const images = menuImagesArray || (imageURL ? [imageURL] : []);

    if (!images.length || !images[0]) {
      const inner = div("", "menuInner");
      inner.innerHTML =
        '<div class="note" style="padding:16px">No menu image configured for this restaurant.</div>';
      container.appendChild(inner);
      return;
    }

    const menuState = getMenuState();
    const { img, layer, inner } = initializeMenuLayout({
      container,
      images,
      imageURL,
      currentPage,
      div,
      menuState,
    });

    ensureMobileViewerChrome();
    updateZoomIndicator();

    setupMenuPinchZoom({ container, menuState });

    const trackDishInteraction = createDishInteractionTracker({
      state,
      normalizeAllergen,
      normalizeDietLabel,
      supabaseClient,
    });

    const { showOverlayDetails, renderLayer } = createMenuOverlayRuntime({
      state,
      menuState,
      layer,
      img,
      ensureMobileInfoPanel,
      prefersMobileInfo,
      getIsOverlayZoomed,
      getZoomedOverlayItem,
      zoomOutOverlay,
      hideTip,
      zoomToOverlay,
      hideMobileInfoPanel: () => {
        const mobileInfoPanel = getMobileInfoPanel();
        if (mobileInfoPanel && mobileInfoPanel.classList.contains("show")) {
          mobileInfoPanel.classList.remove("show");
          mobileInfoPanel.style.display = "none";
          mobileInfoPanel.innerHTML = "";
          clearCurrentMobileInfoItem();
        }
      },
      showTipIn,
      pageTip,
      tooltipBodyHTML,
      getTipPinned,
      getPinnedOverlayItem,
      setOverlayPulseColor,
      hasCrossContamination,
      computeStatus,
      trackDishInteraction,
    });

    window.showOverlayDetails = showOverlayDetails;

    window.__rerenderLayer__ = renderLayer;
    captureMenuBaseDimensions(true);

    function applyInitialZoom() {
      inner.style.transform = "";
      inner.style.transformOrigin = "0 0";
      container.style.overflow = "auto";
      container.style.maxHeight = "";
      menuState.initialZoom = 1;
    }

    if (menuState.isScrollable && menuState.sections) {
      let loadedCount = 0;
      const totalSections = menuState.sections.length;

      menuState.sections.forEach((section) => {
        const onSectionLoad = () => {
          loadedCount++;
          setTimeout(renderLayer, 50);
          if (loadedCount === totalSections) {
            captureMenuBaseDimensions(true);
          }
        };

        if (section.img.complete && section.img.naturalWidth) {
          onSectionLoad();
        } else {
          section.img.onload = onSectionLoad;
        }
      });
    } else if (img.complete && img.naturalWidth) {
      renderLayer();
      captureMenuBaseDimensions(true);
      setTimeout(applyInitialZoom, 100);
    } else {
      img.onload = () => {
        setTimeout(() => {
          renderLayer();
          applyInitialZoom();
        }, 50);
        captureMenuBaseDimensions(true);
        if (document.body.classList.contains("mobileViewerActive")) {
          setMobileZoom(getMobileZoomLevel(), true);
        }
      };
    }

    bindMenuOverlayListeners({
      isOverlayZoomed: getIsOverlayZoomed,
      renderLayer,
      pageTip,
    });
  }

  return { drawMenu };
}
