export function initMobileOverlayZoom(deps = {}) {
  const getMenuState =
    typeof deps.getMenuState === "function" ? deps.getMenuState : () => ({});
  const setOverlayPulseColor =
    typeof deps.setOverlayPulseColor === "function" ? deps.setOverlayPulseColor : null;
  const esc =
    typeof deps.esc === "function" ? deps.esc : (value) => String(value ?? "");
  const mobileCompactBodyHTML =
    typeof deps.mobileCompactBodyHTML === "function"
      ? deps.mobileCompactBodyHTML
      : () => "";
  const ensureAddToOrderConfirmContainer =
    typeof deps.ensureAddToOrderConfirmContainer === "function"
      ? deps.ensureAddToOrderConfirmContainer
      : () => null;
  const hideAddToOrderConfirmation =
    typeof deps.hideAddToOrderConfirmation === "function"
      ? deps.hideAddToOrderConfirmation
      : () => {};
  const showAddToOrderConfirmation =
    typeof deps.showAddToOrderConfirmation === "function"
      ? deps.showAddToOrderConfirmation
      : () => {};
  const addDishToOrder =
    typeof deps.addDishToOrder === "function" ? deps.addDishToOrder : () => null;
  const getDishCompatibilityDetails =
    typeof deps.getDishCompatibilityDetails === "function"
      ? deps.getDishCompatibilityDetails
      : () => ({});
  const toggleLoveDishInTooltip =
    typeof deps.toggleLoveDishInTooltip === "function"
      ? deps.toggleLoveDishInTooltip
      : () => {};
  const onZoomChange =
    typeof deps.onZoomChange === "function" ? deps.onZoomChange : () => {};
  const state = deps.state || {};

  let isOverlayZoomed = false;
  let zoomedOverlayItem = null;
  let preZoomScrollPos = { x: 0, y: 0 };
  let currentZoomScale = 1;
  let currentZoomTransform = {
    menuInner: null,
    translateX: 0,
    translateY: 0,
    scale: 1,
  };

  function updateZoomState(nextZoomed, item) {
    isOverlayZoomed = nextZoomed;
    zoomedOverlayItem = item || null;
    onZoomChange({ isZoomed: isOverlayZoomed, item: zoomedOverlayItem });
  }

  function showZoomedDishInfo(item) {
    const dishInfo = document.getElementById("zoomedDishInfo");
    const nameEl = document.getElementById("zoomedDishName");
    const chipsEl = document.getElementById("zoomedAllergenChips");
    const actionsEl = document.getElementById("zoomedDishActions");
    if (!dishInfo || !nameEl || !chipsEl) return;

    const dishName = item.name || item.id || "Dish";
    nameEl.textContent = dishName;

    const userAllergens = state.allergies || [];
    const userDiets = state.diets || [];
    chipsEl.innerHTML = mobileCompactBodyHTML(item, userAllergens, userDiets);
    if (actionsEl) {
      const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
      const dishKey = restaurantId ? `${String(restaurantId)}:${dishName}` : null;
      const isLoved =
        dishKey && window.lovedDishesSet && window.lovedDishesSet.has(dishKey);
      const showFavorite = !!(
        state.user?.loggedIn &&
        window.supabaseClient &&
        restaurantId
      );
      const isInOrder =
        (window.orderItems && dishName && window.orderItems.includes(dishName)) ||
        false;

      actionsEl.innerHTML = `
        <div class="zoomedDishActionRow">
          ${showFavorite ? `<button type="button" class="mobileFavoriteBtn${isLoved ? " loved" : ""}" id="zoomedFavoriteBtn" aria-pressed="${isLoved ? "true" : "false"}" title="${isLoved ? "Remove from favorite dishes" : "Add to favorite dishes"}" aria-label="${isLoved ? "Remove from favorites" : "Add to favorites"}"><img src="images/heart-icon.svg" alt=""><span data-role="label">${isLoved ? "Favorited" : "Favorite"}</span></button>` : ""}
          <button type="button" class="addToOrderBtn" id="zoomedAddToOrderBtn" data-dish-name="${esc(dishName)}" ${isInOrder ? "disabled" : ""}>${isInOrder ? "Added" : "Add to order"}</button>
        </div>
      `;

      const addToOrderBtn = actionsEl.querySelector("#zoomedAddToOrderBtn");
      const addToOrderConfirmEl = ensureAddToOrderConfirmContainer(actionsEl);
      hideAddToOrderConfirmation(addToOrderConfirmEl);
      if (addToOrderBtn) {
        const dishNameAttr = addToOrderBtn.getAttribute("data-dish-name");
        if (dishNameAttr) {
          addToOrderBtn.addEventListener("click", (e) => {
            if (e) {
              e.preventDefault();
              e.stopPropagation();
            }
            hideAddToOrderConfirmation(addToOrderConfirmEl);

            const details = getDishCompatibilityDetails(dishNameAttr);
            const hasIssues =
              details.issues?.allergens?.length > 0 ||
              details.issues?.diets?.length > 0;

            if (hasIssues) {
              const severity =
                details.issues?.allergens?.length > 0 ||
                details.issues?.diets?.length > 0
                  ? "danger"
                  : "warn";
              details.severity = severity;
              showAddToOrderConfirmation(
                addToOrderConfirmEl,
                dishNameAttr,
                details,
                addToOrderBtn,
              );
            } else {
              const result = addDishToOrder(dishNameAttr);
              if (result?.success) {
                addToOrderBtn.disabled = true;
                addToOrderBtn.textContent = "Added";
                hideAddToOrderConfirmation(addToOrderConfirmEl);
              } else if (result?.needsConfirmation) {
                const severity =
                  result.issues?.allergens?.length > 0 ||
                  result.issues?.diets?.length > 0
                    ? "danger"
                    : "warn";
                details.severity = severity;
                details.issues = result.issues || details.issues;
                showAddToOrderConfirmation(
                  addToOrderConfirmEl,
                  dishNameAttr,
                  details,
                  addToOrderBtn,
                );
              }
            }
          });
        }
      }

      if (showFavorite && restaurantId && dishName) {
        const loveBtn = actionsEl.querySelector("#zoomedFavoriteBtn");
        if (loveBtn) {
          const handleLoveClick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleLoveDishInTooltip(state.user, restaurantId, dishName, loveBtn);
          };
          loveBtn.addEventListener("click", handleLoveClick, true);
          loveBtn.addEventListener("touchend", handleLoveClick, true);
        }
      }
    }
    dishInfo.classList.add("show");
  }

  function zoomToOverlay(item, overlayEl, isTransition = false) {
    const menuWrap = document.querySelector(".menuWrap");
    if (!menuWrap || !overlayEl) return;

    const menuInner = overlayEl.closest(".menuInner");
    const menuImg = menuInner?.querySelector(".menuImg");
    if (!menuInner || !menuImg) return;
    const hasActiveTransform =
      isTransition &&
      currentZoomTransform.menuInner === menuInner &&
      Number.isFinite(currentZoomTransform.scale) &&
      currentZoomTransform.scale > 0;

    const pinchWrapper = menuWrap?.querySelector(".pinchZoomWrapper");

    const menuState = getMenuState();
    menuState.initialZoom = 1;
    menuState.pinchZoomState = { scale: 1, translateX: 0, translateY: 0 };
    if (menuState.resetPinchZoom) {
      menuState.resetPinchZoom();
    }
    if (pinchWrapper) {
      pinchWrapper.style.transform = "";
    }

    if (!isTransition) {
      preZoomScrollPos = { x: window.scrollX, y: window.scrollY };
    }

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    if (!hasActiveTransform) {
      menuInner.style.transition = "none";
      menuInner.style.transform = "";
    }
    menuWrap.classList.add("zoomed");

    document
      .querySelectorAll(".menuSection")
      .forEach((s) => s.classList.remove("zoomed-active"));
    const menuSection = menuInner.closest(".menuSection");
    if (menuSection) menuSection.classList.add("zoomed-active");

    updateZoomState(true, item);

    if (!hasActiveTransform) {
      void menuWrap.offsetWidth;
    }

    const overlayLayer = menuInner.querySelector(".overlayLayer");
    if (overlayLayer) {
      overlayLayer.style.width = menuImg.clientWidth + "px";
      overlayLayer.style.height = menuImg.clientHeight + "px";
      void overlayLayer.offsetWidth;
    }

    const liveImgRect = menuImg.getBoundingClientRect();
    const overlayRect = overlayEl.getBoundingClientRect();
    let imgRect = liveImgRect;
    let relX = 0;
    let relY = 0;
    let overlayWidthPx = 1;
    let overlayHeightPx = 1;

    if (hasActiveTransform) {
      const unscale = 1 / currentZoomTransform.scale;
      relX =
        (overlayRect.left - liveImgRect.left + overlayRect.width / 2) * unscale;
      relY =
        (overlayRect.top - liveImgRect.top + overlayRect.height / 2) * unscale;
      overlayWidthPx = Math.max(1, overlayRect.width * unscale);
      overlayHeightPx = Math.max(1, overlayRect.height * unscale);
      imgRect = {
        left: liveImgRect.left - currentZoomTransform.translateX,
        top: liveImgRect.top - currentZoomTransform.translateY,
      };
    } else {
      relX = overlayRect.left - liveImgRect.left + overlayRect.width / 2;
      relY = overlayRect.top - liveImgRect.top + overlayRect.height / 2;
      overlayWidthPx = Math.max(1, overlayRect.width);
      overlayHeightPx = Math.max(1, overlayRect.height);
    }

    const topPadding = 0;
    const bottomUIHeight = 280;
    const availableWidth = screenWidth * 0.92;
    const availableHeight = screenHeight - topPadding - bottomUIHeight;

    const scaleByWidth = availableWidth / overlayWidthPx;
    const scaleByHeight = availableHeight / overlayHeightPx;
    const rawScale = Math.min(scaleByWidth, scaleByHeight);
    const zoomScale = Math.min(Math.max(rawScale, 0.85), 3.5);

    currentZoomScale = zoomScale;

    document.documentElement.style.setProperty("--overlay-zoom-scale", zoomScale);

    const targetX = screenWidth / 2;
    const targetY = topPadding + availableHeight / 2;

    const translateX = targetX - imgRect.left - relX * zoomScale;
    const translateY = targetY - imgRect.top - relY * zoomScale;

    menuInner.style.transition = "";
    menuInner.style.transformOrigin = "0 0";

    currentZoomTransform = {
      menuInner,
      translateX,
      translateY,
      scale: zoomScale,
    };
    requestAnimationFrame(() => {
      menuInner.style.transform = `translate(${translateX}px, ${translateY}px) scale(${zoomScale})`;
    });

    const animationDelay = isTransition ? 50 : 150;
    setTimeout(() => {
      document.querySelectorAll(".overlay").forEach((ov) => {
        ov.classList.remove("selected");
        ov.style.animation = "none";
      });

      if (overlayEl) {
        if (typeof setOverlayPulseColor === "function") {
          setOverlayPulseColor(overlayEl);
        }

        void overlayEl.offsetWidth;

        overlayEl.style.animation = "";
        overlayEl.classList.add("selected");

        void overlayEl.offsetWidth;
      }
    }, animationDelay);

    const backBtn = document.getElementById("zoomBackButton");
    if (backBtn) backBtn.classList.add("show");
    const topOverlay = document.getElementById("zoomTopOverlay");
    if (topOverlay) topOverlay.classList.add("show");

    showZoomedDishInfo(item);

    document.body.style.overflow = "hidden";
    document.body.classList.add("menuZoomed");
  }

  function zoomOutOverlay() {
    const menuWrap = document.querySelector(".menuWrap");
    if (!menuWrap) return;

    currentZoomScale = 1;
    document.documentElement.style.setProperty("--overlay-zoom-scale", 1);
    currentZoomTransform = {
      menuInner: null,
      translateX: 0,
      translateY: 0,
      scale: 1,
    };

    const allMenuInners = menuWrap.querySelectorAll(".menuInner");
    allMenuInners.forEach((inner) => {
      inner.style.transition = "none";
      inner.style.transform = "";
    });

    menuWrap.classList.remove("zoomed");

    document
      .querySelectorAll(".menuSection.zoomed-active")
      .forEach((s) => s.classList.remove("zoomed-active"));

    allMenuInners.forEach((inner) => void inner.offsetWidth);

    allMenuInners.forEach((inner) => (inner.style.transition = ""));

    const backBtn = document.getElementById("zoomBackButton");
    if (backBtn) backBtn.classList.remove("show");
    const topOverlay = document.getElementById("zoomTopOverlay");
    if (topOverlay) topOverlay.classList.remove("show");

    const dishInfo = document.getElementById("zoomedDishInfo");
    if (dishInfo) dishInfo.classList.remove("show");

    document.body.style.overflow = "";
    document.body.classList.remove("menuZoomed");

    document
      .querySelectorAll(".overlay.selected")
      .forEach((ov) => ov.classList.remove("selected"));

    updateZoomState(false, null);

    requestAnimationFrame(() => {
      void document.body.offsetHeight;

      requestAnimationFrame(() => {
        if (typeof window.__rerenderLayer__ === "function") {
          window.__rerenderLayer__();
        }

        window.scrollTo(preZoomScrollPos.x, preZoomScrollPos.y);

        const menuState = getMenuState();
        if (menuState && typeof menuState.updateMiniMapViewport === "function") {
          menuState.updateMiniMapViewport();
        }
      });
    });
  }

  document.getElementById("zoomBackButton")?.addEventListener("click", () => {
    zoomOutOverlay();
  });

  document.addEventListener("click", (e) => {
    if (!isOverlayZoomed) return;
    const clickedOverlay = e.target.closest(".overlay");
    const clickedBackBtn = e.target.closest(".zoomBackButton");
    const clickedDishInfo = e.target.closest(".zoomedDishInfo");
    if (!clickedOverlay && !clickedBackBtn && !clickedDishInfo) {
      zoomOutOverlay();
    }
  });

  return {
    zoomToOverlay,
    zoomOutOverlay,
    isZoomed: () => isOverlayZoomed,
    getZoomedOverlayItem: () => zoomedOverlayItem,
  };
}
