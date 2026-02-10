export function initEditorNavigation(deps = {}) {
  const menu = deps.menu || null;
  const menuImages = Array.isArray(deps.menuImages) ? deps.menuImages : [];
  const editorSections = Array.isArray(deps.editorSections)
    ? deps.editorSections
    : [];
  const updateEditorMiniMap =
    typeof deps.updateEditorMiniMap === "function"
      ? deps.updateEditorMiniMap
      : null;
  const updateMenuNavigationUI =
    typeof deps.updateMenuNavigationUI === "function"
      ? deps.updateMenuNavigationUI
      : () => {};
  const drawAll = typeof deps.drawAll === "function" ? deps.drawAll : () => {};
  const getImg = typeof deps.getImg === "function" ? deps.getImg : () => null;
  const getCurrentPageIndex =
    typeof deps.getCurrentPageIndex === "function"
      ? deps.getCurrentPageIndex
      : () => 0;
  const setCurrentPageIndex =
    typeof deps.setCurrentPageIndex === "function"
      ? deps.setCurrentPageIndex
      : () => {};
  const applyCurrentPageOnLoad = deps.applyCurrentPageOnLoad === true;

  // Zoom controls
  let zoomScale = 1.0;
  const zoomStep = 0.25;
  const minZoom = 0.5;
  const maxZoom = 3.0;

  function updateZoom() {
    if (!menu) return;
    const inner = menu.querySelector(".menuInner");
    const img = getImg();
    if (!inner || !img) return;
    const zoomLevelEl = document.getElementById("zoomLevel");

    inner.style.transform = `scale(${zoomScale})`;
    inner.style.transformOrigin = "top left";

    // Don't set explicit width/height on menu container
    // Let it size naturally based on image and transform
    if (zoomScale !== 1.0) {
      const displayWidth = img.clientWidth;
      const displayHeight = img.clientHeight;
      menu.style.width = `${displayWidth * zoomScale}px`;
      menu.style.height = `${displayHeight * zoomScale}px`;
    } else {
      menu.style.width = "";
      menu.style.height = "";
    }
    menu.style.overflow = "auto";

    if (zoomLevelEl) {
      zoomLevelEl.textContent = `${Math.round(zoomScale * 100)}%`;
    }

    // Update button states
    const zoomOutBtn = document.getElementById("zoomOutBtn");
    const zoomInBtn = document.getElementById("zoomInBtn");
    if (zoomOutBtn) zoomOutBtn.disabled = zoomScale <= minZoom;
    if (zoomInBtn) zoomInBtn.disabled = zoomScale >= maxZoom;
  }

  function initializeZoom() {
    // Just set zoom to 1.0 and update
    zoomScale = 1.0;
    updateZoom();
  }

  const zoomInBtn = document.getElementById("zoomInBtn");
  if (zoomInBtn) {
    zoomInBtn.onclick = () => {
      if (zoomScale < maxZoom) {
        zoomScale = Math.min(maxZoom, zoomScale + zoomStep);
        updateZoom();
      }
    };
  }

  const zoomOutBtn = document.getElementById("zoomOutBtn");
  if (zoomOutBtn) {
    zoomOutBtn.onclick = () => {
      if (zoomScale > minZoom) {
        zoomScale = Math.max(minZoom, zoomScale - zoomStep);
        updateZoom();
      }
    };
  }

  const zoomResetBtn = document.getElementById("zoomResetBtn");
  if (zoomResetBtn) {
    zoomResetBtn.onclick = () => {
      zoomScale = 1.0;
      updateZoom();
    };
  }

  // Initialize zoom on image load
  const img = getImg();
  if (img) {
    img.onload = () => {
      initializeZoom();
      drawAll();
    };

    // If image already loaded, initialize now
    if (img.complete) {
      initializeZoom();
    }
  }

  // Function to switch to a different menu page
  function switchMenuPage(pageIndex) {
    if (pageIndex < 0 || pageIndex >= menuImages.length) return;

    setCurrentPageIndex(pageIndex);
    if (editorSections.length > 0) {
      if (typeof updateEditorMiniMap === "function") {
        updateEditorMiniMap(pageIndex);
      }
      const targetSection = editorSections[pageIndex]?.section;
      if (targetSection) {
        targetSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else {
      const menuImg = document.querySelector(".menuImg");
      if (menuImg) {
        menuImg.src = menuImages[pageIndex] || "";
      }
    }

    // Update navigation UI
    updateMenuNavigationUI();

    // Update top navigation buttons
    const prevBtn = document.getElementById("prevPageBtn");
    const nextBtn = document.getElementById("nextPageBtn");
    if (prevBtn) {
      prevBtn.disabled = pageIndex === 0;
      if (pageIndex === 0) {
        prevBtn.style.opacity = "0.5";
        prevBtn.style.cursor = "not-allowed";
      } else {
        prevBtn.style.opacity = "1";
        prevBtn.style.cursor = "pointer";
      }
    }
    if (nextBtn) {
      nextBtn.disabled = pageIndex >= menuImages.length - 1;
      if (pageIndex >= menuImages.length - 1) {
        nextBtn.style.opacity = "0.5";
        nextBtn.style.cursor = "not-allowed";
      } else {
        nextBtn.style.opacity = "1";
        nextBtn.style.cursor = "pointer";
      }
    }

    // Update bottom navigation buttons - REMOVED

    // Re-render overlays for current page (only overlays with matching pageIndex)
    drawAll();
  }

  // Page navigation handlers (top buttons)
  const prevPageBtn = document.getElementById("prevPageBtn");
  const nextPageBtn = document.getElementById("nextPageBtn");
  if (prevPageBtn) {
    prevPageBtn.onclick = () => {
      if (getCurrentPageIndex() > 0) {
        switchMenuPage(getCurrentPageIndex() - 1);
      }
    };
  }
  if (nextPageBtn) {
    nextPageBtn.onclick = () => {
      if (getCurrentPageIndex() < menuImages.length - 1) {
        switchMenuPage(getCurrentPageIndex() + 1);
      }
    };
  }

  // Bottom listeners removed
  if (applyCurrentPageOnLoad && getCurrentPageIndex() > 0) {
    setTimeout(() => switchMenuPage(getCurrentPageIndex()), 50);
  }

  // Keyboard navigation support (arrow keys)
  const handleEditorKeyDown = (e) => {
    // Only handle if not typing in an input/textarea
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
      return;
    }

    if (e.key === "ArrowLeft" && getCurrentPageIndex() > 0) {
      e.preventDefault();
      switchMenuPage(getCurrentPageIndex() - 1);
    } else if (
      e.key === "ArrowRight" &&
      getCurrentPageIndex() < menuImages.length - 1
    ) {
      e.preventDefault();
      switchMenuPage(getCurrentPageIndex() + 1);
    }
  };

  document.addEventListener("keydown", handleEditorKeyDown);

  return { switchMenuPage, updateZoom, initializeZoom };
}
