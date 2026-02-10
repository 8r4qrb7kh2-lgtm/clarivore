import {
  getEditorMiniMapResizeHandler,
  setEditorMiniMapResizeHandler,
} from "./restaurantRuntimeBridge.js";

export function initEditorSections(deps = {}) {
  const menu = deps.menu || null;
  const menuImages = Array.isArray(deps.menuImages) ? deps.menuImages : [];
  const editorSections = Array.isArray(deps.editorSections)
    ? deps.editorSections
    : [];
  const div =
    typeof deps.div === "function"
      ? deps.div
      : (html, cls) => {
          const el = document.createElement("div");
          if (cls) el.className = cls;
          if (html !== undefined && html !== null) {
            el.innerHTML = html;
          }
          return el;
        };
  const getCurrentPageIndex =
    typeof deps.getCurrentPageIndex === "function"
      ? deps.getCurrentPageIndex
      : () => 0;
  const setCurrentPageIndex =
    typeof deps.setCurrentPageIndex === "function"
      ? deps.setCurrentPageIndex
      : () => {};
  const getDrawAll =
    typeof deps.getDrawAll === "function" ? deps.getDrawAll : () => null;
  const setRefs =
    typeof deps.setRefs === "function" ? deps.setRefs : () => {};

  let editorScroller = null;
  let currentMiniMapPage = 0;
  let updateEditorMiniMap = null;
  let inner = null;
  let img = null;
  let overlayLayer = null;

  if (!menu) {
    return {
      editorSections,
      editorScroller,
      updateEditorMiniMap,
      rebuildEditorSectionsFromMenuImages: () => {},
    };
  }

  editorSections.length = 0;
  const headerRow = document.querySelector(".editorHeaderRow");
  if (headerRow) headerRow.classList.remove("hasMiniMap");

  if (menuImages.length > 1) {
    // Multi-image: Create scrollable sections with mini-map
    const scrollWrapper = div("", "editorScrollWrapper");
    scrollWrapper.style.cssText =
      "position:relative;width:100%;display:flex;flex-direction:column;gap:12px;";
    menu.appendChild(scrollWrapper);

    // Create mini-map navigator
    const miniMap = div("", "editorMiniMap");
    miniMap.style.cssText = `
      position:relative;width:80px;
      background:rgba(30,30,40,0.95);border-radius:8px;
      pointer-events:auto;
      display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:2px;
    `;

    const miniMapFrame = div("", "editorMiniMapFrame");
    miniMapFrame.style.cssText =
      "position:relative;width:100%;border-radius:8px;overflow:hidden;line-height:0;";

    const miniMapThumb = document.createElement("img");
    miniMapThumb.style.cssText =
      "width:100%;height:auto;display:block;cursor:pointer;";
    miniMapThumb.draggable = false;

    const miniMapViewport = div("", "editorMiniMapViewport");
    miniMapViewport.style.cssText =
      "position:absolute;border:2px solid rgba(239,68,68,0.9);background:rgba(239,68,68,0.15);border-radius:2px;display:none;pointer-events:none;";

    const miniMapLabel = div("", "miniMapLabel");
    miniMapLabel.style.cssText =
      "font-size:9px;color:#9ca3af;text-align:center;margin-top:0;";
    miniMapLabel.textContent = `Page 1 of ${menuImages.length}`;

    miniMapFrame.appendChild(miniMapThumb);
    miniMapFrame.appendChild(miniMapViewport);
    miniMap.appendChild(miniMapFrame);
    miniMap.appendChild(miniMapLabel);
    let miniMapSlot = document.getElementById("editorMiniMapSlot");
    if (!miniMapSlot && headerRow) {
      miniMapSlot = document.createElement("div");
      miniMapSlot.id = "editorMiniMapSlot";
      miniMapSlot.className = "editorMiniMapSlot";
      headerRow.prepend(miniMapSlot);
    }
    if (miniMapSlot) {
      if (headerRow) headerRow.classList.add("hasMiniMap");
      miniMapSlot.style.display = "flex";
      miniMapSlot.appendChild(miniMap);
    } else {
      scrollWrapper.appendChild(miniMap);
    }
    const previousMiniMapResizeHandler = getEditorMiniMapResizeHandler();
    if (previousMiniMapResizeHandler && typeof removeEventListener === "function") {
      removeEventListener("resize", previousMiniMapResizeHandler);
    }
    const updateEditorMiniMapViewport = () => {
      const section = editorSections[currentMiniMapPage];
      if (!section || !section.img) return;
      const imgRect = section.img.getBoundingClientRect();
      const containerRect = menu.getBoundingClientRect();

      if (imgRect.height <= 0 || imgRect.width <= 0) {
        miniMapViewport.style.display = "none";
        return;
      }

      const visibleTop = Math.max(0, containerRect.top - imgRect.top);
      const visibleBottom = Math.min(
        imgRect.height,
        containerRect.bottom - imgRect.top,
      );
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);

      const visibleLeft = Math.max(0, containerRect.left - imgRect.left);
      const visibleRight = Math.min(
        imgRect.width,
        containerRect.right - imgRect.left,
      );
      const visibleWidth = Math.max(0, visibleRight - visibleLeft);

      if (visibleHeight <= 0 || visibleWidth <= 0) {
        miniMapViewport.style.display = "none";
        return;
      }

      const leftPercent = (visibleLeft / imgRect.width) * 100;
      const widthPercent = (visibleWidth / imgRect.width) * 100;
      const topPercent = (visibleTop / imgRect.height) * 100;
      const heightPercent = (visibleHeight / imgRect.height) * 100;

      const miniMapRect = miniMapFrame.getBoundingClientRect();
      if (miniMapRect.width <= 0 || miniMapRect.height <= 0) {
        miniMapViewport.style.display = "none";
        return;
      }
      const miniMapNaturalWidth = miniMapThumb.naturalWidth || 1;
      const miniMapNaturalHeight = miniMapThumb.naturalHeight || 1;
      const miniMapAspect = miniMapNaturalWidth / miniMapNaturalHeight;
      const frameAspect = miniMapRect.width / miniMapRect.height;

      let thumbnailLeft = 0;
      let thumbnailWidth = miniMapRect.width;
      let thumbnailTop = 0;
      let thumbnailHeight = miniMapRect.height;

      if (miniMapAspect > frameAspect) {
        thumbnailHeight = miniMapRect.width / miniMapAspect;
        thumbnailTop = (miniMapRect.height - thumbnailHeight) / 2;
      } else {
        thumbnailWidth = miniMapRect.height * miniMapAspect;
        thumbnailLeft = (miniMapRect.width - thumbnailWidth) / 2;
      }

      const vpLeft = thumbnailLeft + (leftPercent / 100) * thumbnailWidth;
      const vpTop = thumbnailTop + (topPercent / 100) * thumbnailHeight;
      const vpWidth = (widthPercent / 100) * thumbnailWidth;
      const vpHeight = (heightPercent / 100) * thumbnailHeight;

      miniMapViewport.style.display = "block";
      miniMapViewport.style.left = `${vpLeft}px`;
      miniMapViewport.style.top = `${vpTop}px`;
      miniMapViewport.style.width = `${vpWidth}px`;
      miniMapViewport.style.height = `${vpHeight}px`;
    };
    const syncMiniMapHeight = () => {
      const frameWidth =
        miniMapFrame.getBoundingClientRect().width ||
        miniMap.getBoundingClientRect().width;
      if (!frameWidth) return;
      const naturalWidth = miniMapThumb.naturalWidth || 1;
      const naturalHeight = miniMapThumb.naturalHeight || 1;
      const aspect = naturalHeight / naturalWidth || 1.4;
      const desiredHeight = Math.round(frameWidth * aspect);
      miniMap.style.maxHeight = "none";
      miniMapFrame.style.height = `${Math.max(60, desiredHeight)}px`;
      updateEditorMiniMapViewport();
    };
    setEditorMiniMapResizeHandler(syncMiniMapHeight);
    if (typeof addEventListener === "function") {
      addEventListener("resize", syncMiniMapHeight);
    }
    requestAnimationFrame(syncMiniMapHeight);

    // Create scrollable container
    editorScroller = div("", "editorSectionsScroller");
    editorScroller.style.cssText =
      "display:flex;flex-direction:column;gap:8px;width:100%;";
    scrollWrapper.appendChild(editorScroller);

    // Create a section for each image
    menuImages.forEach((imgSrc, idx) => {
      const section = div("", "editorSection");
      section.dataset.sectionIndex = idx;
      section.style.cssText = "position:relative;width:100%;flex-shrink:0;";

      const sectionInner = div("", "menuInner");
      sectionInner.style.cssText = "position:relative;width:100%;";
      sectionInner.dataset.sectionIndex = idx;

      const sectionImg = new Image();
      sectionImg.src = imgSrc;
      sectionImg.className = "menuImg";
      sectionImg.draggable = false;
      sectionImg.style.cssText = "width:100%;height:auto;display:block;";
      sectionImg.addEventListener("dragstart", (e) => e.preventDefault());

      const sectionOverlayLayer = div("", "overlayLayer");
      sectionOverlayLayer.dataset.sectionIndex = idx;

      sectionInner.appendChild(sectionImg);
      sectionInner.appendChild(sectionOverlayLayer);
      section.appendChild(sectionInner);
      editorScroller.appendChild(section);

      editorSections.push({
        index: idx,
        section: section,
        inner: sectionInner,
        img: sectionImg,
        overlayLayer: sectionOverlayLayer,
      });
    });

    // Use first section as default references
    inner = editorSections[0].inner;
    img = editorSections[0].img;
    overlayLayer = editorSections[0].overlayLayer;
    setRefs({ inner, img, overlayLayer });

    // Mini-map update function
    updateEditorMiniMap = (pageIndex) => {
      if (pageIndex < 0 || pageIndex >= editorSections.length) return;
      currentMiniMapPage = pageIndex;
      const section = editorSections[pageIndex];
      if (section.img.src) {
        miniMapThumb.src = section.img.src;
      }
      miniMapLabel.textContent = `Page ${pageIndex + 1} of ${editorSections.length}`;
      requestAnimationFrame(syncMiniMapHeight);
    };

    // Click thumbnail to cycle to next section
    miniMapThumb.addEventListener("click", () => {
      const nextPage = (currentMiniMapPage + 1) % editorSections.length;
      editorSections[nextPage].section.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });

    // Update mini-map on scroll
    const scrollContainer = menu;
    scrollContainer.addEventListener(
      "scroll",
      () => {
        const scrollerRect = scrollContainer.getBoundingClientRect();
        const scrollerMidY = scrollerRect.top + scrollerRect.height / 3;

        for (let i = 0; i < editorSections.length; i++) {
          const sectionRect = editorSections[i].section.getBoundingClientRect();
          if (sectionRect.top <= scrollerMidY && sectionRect.bottom > scrollerMidY) {
            if (currentMiniMapPage !== i) {
              updateEditorMiniMap(i);
              setCurrentPageIndex(i); // Keep currentPageIndex in sync
            }
            break;
          }
        }
        updateEditorMiniMapViewport();
      },
      { passive: true },
    );

    // Initialize mini-map when first image loads
    if (editorSections[0].img.complete) {
      updateEditorMiniMap(0);
    } else {
      editorSections[0].img.addEventListener(
        "load",
        () => updateEditorMiniMap(0),
        { once: true },
      );
    }
    miniMapThumb.addEventListener("load", () => {
      requestAnimationFrame(syncMiniMapHeight);
    });
  } else {
    // Single image: Simple layout
    inner = div("", "menuInner");
    menu.appendChild(inner);

    img = new Image();
    img.src = menuImages[0] || "";
    img.className = "menuImg";
    img.draggable = false;
    inner.appendChild(img);

    overlayLayer = div("", "overlayLayer");
    inner.appendChild(overlayLayer);

    img.addEventListener("dragstart", (e) => e.preventDefault());
    setRefs({ inner, img, overlayLayer });
  }

  function rebuildEditorSectionsFromMenuImages() {
    if (!editorScroller) return;
    editorScroller.innerHTML = "";
    editorSections.length = 0;

    menuImages.forEach((imgSrc, idx) => {
      const section = div("", "editorSection");
      section.dataset.sectionIndex = idx;
      section.style.cssText = "position:relative;width:100%;flex-shrink:0;";

      const sectionInner = div("", "menuInner");
      sectionInner.style.cssText = "position:relative;width:100%;";
      sectionInner.dataset.sectionIndex = idx;

      const sectionImg = new Image();
      sectionImg.src = imgSrc;
      sectionImg.className = "menuImg";
      sectionImg.draggable = false;
      sectionImg.style.cssText = "width:100%;height:auto;display:block;";
      sectionImg.addEventListener("dragstart", (e) => e.preventDefault());

      const sectionOverlayLayer = div("", "overlayLayer");
      sectionOverlayLayer.dataset.sectionIndex = idx;

      sectionInner.appendChild(sectionImg);
      sectionInner.appendChild(sectionOverlayLayer);
      section.appendChild(sectionInner);
      editorScroller.appendChild(section);

      editorSections.push({
        index: idx,
        section: section,
        inner: sectionInner,
        img: sectionImg,
        overlayLayer: sectionOverlayLayer,
      });
    });

    if (editorSections.length > 0) {
      inner = editorSections[0].inner;
      img = editorSections[0].img;
      overlayLayer = editorSections[0].overlayLayer;
      setRefs({ inner, img, overlayLayer });
    }

    const maxIndex = Math.max(0, menuImages.length - 1);
    setCurrentPageIndex(Math.min(getCurrentPageIndex(), maxIndex));
    currentMiniMapPage = Math.min(currentMiniMapPage, maxIndex);

    if (typeof updateEditorMiniMap === "function" && editorSections.length > 0) {
      updateEditorMiniMap(currentMiniMapPage);
    }

    if (!editorSections.length) return;
    let loadedCount = 0;
    const drawAll = getDrawAll();
    editorSections.forEach((section) => {
      const onLoad = () => {
        loadedCount++;
        if (loadedCount === editorSections.length && typeof drawAll === "function") {
          drawAll();
        }
      };
      if (section.img.complete) {
        onLoad();
      } else {
        section.img.addEventListener("load", onLoad, { once: true });
      }
    });
  }

  return {
    editorSections,
    editorScroller,
    updateEditorMiniMap,
    rebuildEditorSectionsFromMenuImages,
  };
}
