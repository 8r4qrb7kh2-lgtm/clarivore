export function bindEditorToolbarScale(options = {}) {
  const {
    state,
    isEditorPage = () => false,
    onMiniMapResize = () => {},
  } = options;

  const syncToolbarScale = () => {
    const scaleWrap = document.getElementById("editorToolbarScale");
    const toolbar = document.getElementById("editorToolbar");
    if (!scaleWrap || !toolbar) return;

    toolbar.style.transform = "none";
    toolbar.style.width = "100%";
    scaleWrap.style.height = "";

    if (window.matchMedia("(max-width: 768px)").matches) {
      onMiniMapResize();
      return;
    }

    const availableWidth = scaleWrap.clientWidth;
    const naturalWidth = toolbar.scrollWidth;
    if (!availableWidth || !naturalWidth) return;

    const scale = Math.min(1, availableWidth / naturalWidth);
    if (scale < 1) {
      toolbar.style.width = `${naturalWidth}px`;
      toolbar.style.transform = `scale(${scale})`;
      scaleWrap.style.height = `${Math.ceil(toolbar.offsetHeight * scale)}px`;
    } else {
      toolbar.style.transform = "none";
      toolbar.style.width = "100%";
      scaleWrap.style.height = "";
    }

    onMiniMapResize();
  };

  if (!window.__editorToolbarScaleBound) {
    window.__editorToolbarScaleBound = true;
    window.__editorToolbarScaleHandler = () => {
      if (!isEditorPage()) return;
      syncToolbarScale();
    };
    window.addEventListener("resize", window.__editorToolbarScaleHandler);
    window.addEventListener(
      "orientationchange",
      window.__editorToolbarScaleHandler,
    );
  }

  syncToolbarScale();

  return { syncToolbarScale };
}
