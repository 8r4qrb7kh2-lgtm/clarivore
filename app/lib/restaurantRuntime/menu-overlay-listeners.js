import {
  bindViewportListeners,
  getRuntimeVisualViewport,
} from "./viewport-listeners.js";

export function bindMenuOverlayListeners(options = {}) {
  const {
    isOverlayZoomed,
    renderLayer,
    pageTip,
  } = options;
  const getIsOverlayZoomed =
    typeof isOverlayZoomed === "function" ? isOverlayZoomed : () => false;
  const renderOverlayLayer =
    typeof renderLayer === "function" ? renderLayer : () => {};

  return bindViewportListeners({
    onResize: () => {
      if (getIsOverlayZoomed()) return;
      requestAnimationFrame(renderOverlayLayer);
    },
    onVisualViewportResize: () => {
      if (!pageTip || pageTip.style.display !== "block") return;

      const runtimeVisualViewport = getRuntimeVisualViewport();
      if (!runtimeVisualViewport) return;

      const currentLeft = parseFloat(pageTip.style.left || 0);
      const currentTop = parseFloat(pageTip.style.top || 0);
      const zoom = runtimeVisualViewport.scale || 1;
      const k = 1 / zoom;

      const isMobile =
        (typeof innerWidth === "number"
          ? innerWidth
          : document.documentElement?.clientWidth || 0) <= 640;
      const viewportWidth = runtimeVisualViewport.width;
      const viewportHeight = runtimeVisualViewport.height;

      pageTip.style.transform = `scale(${k})`;
      pageTip.style.transformOrigin = "top left";

      const baseMaxWidth = isMobile
        ? Math.min(220, viewportWidth - 30)
        : Math.min(280, viewportWidth - 40);
      pageTip.style.maxWidth = baseMaxWidth + "px";

      requestAnimationFrame(() => {
        const pad = isMobile ? 8 : 12;
        const rect = pageTip.getBoundingClientRect();

        let left = Math.min(currentLeft, viewportWidth - rect.width - pad);
        let top = Math.min(currentTop, viewportHeight - rect.height - pad);
        left = Math.max(pad, left);
        top = Math.max(pad, top);

        pageTip.style.left = left + "px";
        pageTip.style.top = top + "px";
      });
    },
  });
}
