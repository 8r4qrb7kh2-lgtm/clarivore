export function bindMenuOverlayListeners(options = {}) {
  const {
    isOverlayZoomed,
    renderLayer,
    pageTip,
  } = options;

  addEventListener(
    "resize",
    () => {
      if (isOverlayZoomed()) return;
      requestAnimationFrame(renderLayer);
    },
    { passive: true },
  );

  if (typeof visualViewport !== "undefined" && visualViewport) {
    visualViewport.addEventListener(
      "resize",
      () => {
        if (pageTip.style.display === "block") {
          const currentLeft = parseFloat(pageTip.style.left || 0);
          const currentTop = parseFloat(pageTip.style.top || 0);

          const zoom = visualViewport.scale || 1;
          const k = 1 / zoom;

          const isMobile =
            (typeof innerWidth === "number"
              ? innerWidth
              : document.documentElement?.clientWidth || 0) <= 640;
          const vw2 = visualViewport.width;
          const vh2 = visualViewport.height;

          pageTip.style.transform = `scale(${k})`;
          pageTip.style.transformOrigin = "top left";

          const baseMaxWidth = isMobile
            ? Math.min(220, vw2 - 30)
            : Math.min(280, vw2 - 40);
          pageTip.style.maxWidth = baseMaxWidth + "px";

          requestAnimationFrame(() => {
            const pad = isMobile ? 8 : 12;
            const rect = pageTip.getBoundingClientRect();

            let left = Math.min(currentLeft, vw2 - rect.width - pad);
            let top = Math.min(currentTop, vh2 - rect.height - pad);
            left = Math.max(pad, left);
            top = Math.max(pad, top);

            pageTip.style.left = left + "px";
            pageTip.style.top = top + "px";
          });
        }
      },
      { passive: true },
    );
  }
}
