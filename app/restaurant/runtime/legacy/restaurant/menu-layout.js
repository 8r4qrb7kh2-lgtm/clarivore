function createMiniMapViewportUpdater(menuState) {
  return () => {
    const headerMiniMapImg = document.getElementById("headerMiniMapImg");
    const viewportBox = document.getElementById("headerMiniMapViewport");
    const menuContainer = document.getElementById("menu");
    const headerMiniMapLabel = document.getElementById("headerMiniMapLabel");
    if (!headerMiniMapImg || !viewportBox || !menuContainer) return;

    const sections = menuState.sections || [];
    if (!sections.length) return;

    const pageIndex = Math.min(menuState.currentMiniMapPage || 0, sections.length - 1);
    const currentSection = sections[pageIndex];
    if (!currentSection || !currentSection.img) return;

    const miniMapSrc = currentSection.img.currentSrc || currentSection.img.src || "";
    if (miniMapSrc && headerMiniMapImg.src !== miniMapSrc) {
      headerMiniMapImg.src = miniMapSrc;
    }
    if (sections.length <= 1 && headerMiniMapLabel) {
      headerMiniMapLabel.textContent = "Page 1";
    }

    const sectionImg = currentSection.img;
    const imgRect = sectionImg.getBoundingClientRect();
    const containerRect = menuContainer.getBoundingClientRect();

    const imgHeight = imgRect.height;
    const imgWidth = imgRect.width;

    if (imgHeight <= 0 || imgWidth <= 0) {
      viewportBox.style.display = "none";
      return;
    }

    const visibleTop = Math.max(0, containerRect.top - imgRect.top);
    const visibleBottom = Math.min(imgHeight, containerRect.bottom - imgRect.top);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);

    const visibleLeft = Math.max(0, containerRect.left - imgRect.left);
    const visibleRight = Math.min(imgWidth, containerRect.right - imgRect.left);
    const visibleWidth = Math.max(0, visibleRight - visibleLeft);
    const leftPercent = (visibleLeft / imgWidth) * 100;
    const widthPercent = (visibleWidth / imgWidth) * 100;

    const topPercent = (visibleTop / imgHeight) * 100;
    const heightPercent = (visibleHeight / imgHeight) * 100;

    if (heightPercent <= 0) {
      viewportBox.style.display = "none";
      return;
    }

    const miniMapRect = headerMiniMapImg.getBoundingClientRect();
    const miniMapNaturalWidth = headerMiniMapImg.naturalWidth || 1;
    const miniMapNaturalHeight = headerMiniMapImg.naturalHeight || 1;
    const miniMapAspect = miniMapNaturalWidth / miniMapNaturalHeight;
    const containerAspect = miniMapRect.width / miniMapRect.height;

    let thumbnailLeft = 0;
    let thumbnailWidth = miniMapRect.width;
    let thumbnailTop = 0;
    let thumbnailHeight = miniMapRect.height;

    if (miniMapAspect > containerAspect) {
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

    viewportBox.style.display = "block";
    viewportBox.style.top = `${vpTop}px`;
    viewportBox.style.height = `${vpHeight}px`;
    viewportBox.style.left = `${vpLeft}px`;
    viewportBox.style.width = `${vpWidth}px`;
  };
}

function initializeMultiPageLayout({ container, images, div, menuState }) {
  const scrollWrapper = div("", "menuScrollWrapper");
  scrollWrapper.style.cssText = "width:100%;";
  container.appendChild(scrollWrapper);

  const scroller = div("", "menuSectionsScroller");
  scroller.style.cssText = "display:block;";
  scrollWrapper.appendChild(scroller);

  menuState.sections = [];
  menuState.isScrollable = true;
  menuState.scroller = scroller;

  images.forEach((imgSrc, index) => {
    const section = div("", "menuSection");
    section.dataset.sectionIndex = index;
    section.style.cssText = "position:relative;width:100%;margin-bottom:8px;";

    const sectionInner = div("", "menuInner");
    sectionInner.style.cssText = "position:relative;width:100%;display:block;";

    const img = new Image();
    img.src = imgSrc;
    img.className = "menuImg";
    img.draggable = false;
    img.style.cssText = "width:100%;height:auto;display:block;";
    img.addEventListener("dragstart", (event) => event.preventDefault());

    const layer = div("", "overlayLayer");
    layer.dataset.sectionIndex = index;

    sectionInner.appendChild(img);
    sectionInner.appendChild(layer);
    section.appendChild(sectionInner);
    scroller.appendChild(section);

    menuState.sections.push({
      index,
      img,
      layer,
      inner: sectionInner,
      section,
    });
  });

  menuState.img = menuState.sections[0].img;
  menuState.layer = menuState.sections[0].layer;
  menuState.inner = menuState.sections[0].inner;
  menuState.currentPage = 0;

  menuState.currentMiniMapPage = 0;
  const updateMiniMapViewport = createMiniMapViewportUpdater(menuState);
  menuState.updateMiniMapViewport = updateMiniMapViewport;

  const updateHeaderMiniMap = (pageIndex) => {
    const sections = menuState.sections;
    if (!sections || pageIndex < 0 || pageIndex >= sections.length) return;

    menuState.currentMiniMapPage = pageIndex;
    const section = sections[pageIndex];

    const headerMiniMapImg = document.getElementById("headerMiniMapImg");
    if (headerMiniMapImg && section.img.src) {
      headerMiniMapImg.src = section.img.src;
    }

    const headerMiniMapLabel = document.getElementById("headerMiniMapLabel");
    if (headerMiniMapLabel && sections.length > 1) {
      headerMiniMapLabel.textContent = `Page ${pageIndex + 1} of ${sections.length}`;
    }

    updateMiniMapViewport();
  };

  const updateCurrentSection = () => {
    const sections = menuState.sections;
    if (!sections || sections.length === 0) return;

    const menuContainer = document.getElementById("menu");
    if (!menuContainer) return;

    const containerRect = menuContainer.getBoundingClientRect();
    const containerMidY = containerRect.top + containerRect.height / 3;

    for (let i = 0; i < sections.length; i++) {
      const sectionRect = sections[i].section.getBoundingClientRect();
      if (sectionRect.top <= containerMidY && sectionRect.bottom > containerMidY) {
        const activePage = menuState.currentMiniMapPage || 0;
        if (activePage !== i) {
          updateHeaderMiniMap(i);
        } else {
          updateMiniMapViewport();
        }
        break;
      }
    }
  };

  container.addEventListener("scroll", updateCurrentSection, { passive: true });
  menuState.updateHeaderMiniMap = updateHeaderMiniMap;

  const initHeaderMiniMap = () => {
    const sections = menuState.sections;
    if (sections && sections.length > 0 && sections[0].img.complete) {
      updateHeaderMiniMap(0);
    }
  };

  menuState.sections.forEach((section) => {
    if (section.img.complete) {
      initHeaderMiniMap();
    } else {
      section.img.addEventListener("load", initHeaderMiniMap, { once: true });
    }
  });
}

function initializeSinglePageLayout({
  container,
  images,
  imageURL,
  currentPage,
  div,
  menuState,
}) {
  const inner = div("", "menuInner");
  container.appendChild(inner);

  const displayImage = images[0] || imageURL || "";
  const img = new Image();
  img.src = displayImage;
  img.className = "menuImg";
  img.draggable = false;
  inner.appendChild(img);

  const layer = div("", "overlayLayer");
  inner.appendChild(layer);

  img.addEventListener("dragstart", (event) => event.preventDefault());

  menuState.img = img;
  menuState.layer = layer;
  menuState.inner = inner;
  menuState.currentPage = currentPage;
  menuState.isScrollable = false;
  menuState.sections = [{
    index: 0,
    img,
    layer,
    inner,
    section: inner,
  }];
  menuState.currentMiniMapPage = 0;

  const updateMiniMapViewport = createMiniMapViewportUpdater(menuState);
  menuState.updateMiniMapViewport = updateMiniMapViewport;
  container.addEventListener("scroll", updateMiniMapViewport, { passive: true });

  const updateHeaderMiniMapSingle = () => {
    const headerMiniMapImg = document.getElementById("headerMiniMapImg");
    const headerMiniMapLabel = document.getElementById("headerMiniMapLabel");
    if (headerMiniMapImg) headerMiniMapImg.src = img.src || displayImage;
    if (headerMiniMapLabel) headerMiniMapLabel.textContent = "Page 1";
    if (typeof menuState.updateMiniMapViewport === "function") {
      menuState.updateMiniMapViewport();
    }
  };

  if (img.complete) {
    updateHeaderMiniMapSingle();
  } else {
    img.addEventListener("load", updateHeaderMiniMapSingle, { once: true });
  }
}

export function initializeMenuLayout(options = {}) {
  const {
    container,
    images,
    imageURL,
    currentPage,
    div,
    menuState,
  } = options;

  if (images.length > 1) {
    initializeMultiPageLayout({ container, images, div, menuState });
  } else {
    initializeSinglePageLayout({
      container,
      images,
      imageURL,
      currentPage,
      div,
      menuState,
    });
  }

  const img = menuState.img;
  const layer = menuState.layer;
  const inner = menuState.inner;

  menuState.img = img;
  menuState.layer = layer;
  menuState.inner = inner;
  menuState.currentPage = currentPage;

  return { img, layer, inner };
}
