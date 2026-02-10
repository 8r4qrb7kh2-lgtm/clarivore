import {
  markOverlaySelected,
  setOverlayDishName,
} from "./overlay-dom.js";

export function createMenuOverlayRuntime(options = {}) {
  const {
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
    hideMobileInfoPanel,
    showTipIn,
    pageTip,
    tooltipBodyHTML,
    getTipPinned,
    getPinnedOverlayItem,
    setOverlayPulseColor,
    hasCrossContamination,
    computeStatus,
    trackDishInteraction,
  } = options;

  const showOverlayDetails = (event, item, target) => {
    ensureMobileInfoPanel();
    let pointerType = "mouse";
    if (event) {
      if (typeof event.pointerType === "string") {
        pointerType = event.pointerType;
      } else if (event.type && event.type.toLowerCase().includes("touch")) {
        pointerType = "touch";
      } else if (event.type && event.type.toLowerCase().includes("pointer")) {
        pointerType = "pen";
      }
    }

    const useMobilePanel = prefersMobileInfo() || pointerType !== "mouse";
    if (useMobilePanel) {
      if (event) {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
      }

      if (getIsOverlayZoomed() && getZoomedOverlayItem() === item) {
        zoomOutOverlay();
        return;
      }

      hideTip();

      const overlayBox = target?.classList?.contains("overlay")
        ? target
        : target?.closest
          ? target.closest(".overlay")
          : null;

      const isTransition = getIsOverlayZoomed();
      if (overlayBox) {
        zoomToOverlay(item, overlayBox, isTransition);
      }

      trackDishInteraction(item);
      return;
    }

    hideMobileInfoPanel();

    const client = event?.changedTouches ? event.changedTouches[0] : event;
    const rect = target?.getBoundingClientRect
      ? target.getBoundingClientRect()
      : event?.currentTarget?.getBoundingClientRect
        ? event.currentTarget.getBoundingClientRect()
        : null;
    const clientX = client?.clientX ?? 0;
    const clientY = client?.clientY ?? 0;
    const isClick = !!(event && (event.type === "click" || event.type === "touchend"));

    if (getTipPinned() && getPinnedOverlayItem() && !isClick) {
      const currentItemId = item.id || item.name || "";
      const pinnedItemId = getPinnedOverlayItem().id || getPinnedOverlayItem().name || "";
      if (currentItemId !== pinnedItemId) {
        return;
      }
    }

    showTipIn(
      pageTip,
      clientX,
      clientY,
      item.id || "Item",
      tooltipBodyHTML(item, state.allergies || [], state.diets || [], isClick),
      rect,
      isClick,
      item,
    );

    if (isClick) {
      trackDishInteraction(item);
    }

    const overlayBox = target?.classList?.contains("overlay")
      ? target
      : target?.closest
        ? target.closest(".overlay")
        : null;

    if (!overlayBox) return;

    if (isClick) {
      markOverlaySelected(overlayBox, {
        clearExisting: true,
        setOverlayPulseColor,
        restartAnimation: true,
      });
      return;
    }

    if (!getTipPinned()) {
      markOverlaySelected(overlayBox, {
        clearExisting: true,
        setOverlayPulseColor,
      });
    }
  };

  function renderOverlayBox(item, targetLayer, colors) {
    const box = document.createElement("div");
    const status = computeStatus(item, state.allergies || [], state.diets || []);
    box.className = `overlay ${status}`;
    box.style.borderColor = colors[status] || colors.neutral;
    box.style.left = (+item.x || 0) + "%";
    box.style.top = (+item.y || 0) + "%";
    box.style.width = (+item.w || 0) + "%";
    box.style.height = (+item.h || 0) + "%";
    setOverlayDishName(box, item.id || item.name || item.label || "");

    const isCaution = status === "removable";
    const hasCross = hasCrossContamination(item, state.allergies || [], state.diets || []);

    if (isCaution || hasCross) {
      const warning = document.createElement("div");
      warning.className = "ovWarning";
      warning.title = "Cross-contamination risk";
      warning.textContent = "⚠";
      box.appendChild(warning);
    }

    const badge = document.createElement("div");
    badge.className = "ovBadge";
    badge.title = "Details";
    badge.textContent = "i";
    box.appendChild(badge);

    box.addEventListener("mousemove", (event) => {
      if (prefersMobileInfo()) return;
      if (getTipPinned()) return;
      const rect =
        event.currentTarget && event.currentTarget.getBoundingClientRect
          ? event.currentTarget.getBoundingClientRect()
          : box.getBoundingClientRect();
      showTipIn(
        pageTip,
        event.clientX,
        event.clientY,
        item.id || "Item",
        tooltipBodyHTML(item, state.allergies || [], state.diets || [], false),
        rect,
        false,
        item,
      );
    });

    box.addEventListener("mouseleave", () => {
      hideTip();
    });

    box.addEventListener("click", (event) => {
      showOverlayDetails(event, item, box);
    });

    targetLayer.appendChild(box);
  }

  function renderLayer() {
    const colors = {
      safe: "var(--ok)",
      removable: "var(--warn)",
      unsafe: "var(--bad)",
      neutral: "#ffffff1a",
    };

    const allOverlays = Array.isArray(state.restaurant?.overlays)
      ? state.restaurant.overlays
      : [];

    if (menuState.isScrollable && menuState.sections && menuState.sections.length > 0) {
      menuState.sections.forEach((section, sectionIndex) => {
        [...section.layer.querySelectorAll(".overlay")].forEach((node) => node.remove());

        if (
          !section.img.complete ||
          !section.img.naturalWidth ||
          !section.img.clientWidth ||
          !section.img.clientHeight
        ) {
          return;
        }

        section.layer.style.width = section.img.clientWidth + "px";
        section.layer.style.height = section.img.clientHeight + "px";

        const sectionOverlays = allOverlays.filter(
          (overlay) => (overlay.pageIndex || 0) === sectionIndex,
        );

        sectionOverlays.forEach((overlay) => {
          renderOverlayBox(overlay, section.layer, colors);
        });
      });
      return;
    }

    if (!layer || !img) return;

    [...layer.querySelectorAll(".overlay")].forEach((node) => node.remove());

    if (!img.complete || !img.naturalWidth || !img.clientWidth || !img.clientHeight) {
      console.log("Image not ready yet");
      return;
    }

    layer.style.width = img.clientWidth + "px";
    layer.style.height = img.clientHeight + "px";

    const pageForFilter = menuState.currentPage !== undefined ? menuState.currentPage : 0;
    const pageOverlays = allOverlays.filter(
      (overlay) => (overlay.pageIndex || 0) === pageForFilter,
    );

    pageOverlays.forEach((overlay) => {
      renderOverlayBox(overlay, layer, colors);
    });
  }

  return {
    showOverlayDetails,
    renderLayer,
  };
}
