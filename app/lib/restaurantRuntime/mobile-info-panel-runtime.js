export function createMobileInfoPanelRuntime(deps = {}) {
  const state = deps.state || {};
  const esc = typeof deps.esc === "function" ? deps.esc : (value) => String(value ?? "");
  const prefersMobileInfo =
    typeof deps.prefersMobileInfo === "function"
      ? deps.prefersMobileInfo
      : () => false;
  const mobileCompactBodyHTML =
    typeof deps.mobileCompactBodyHTML === "function"
      ? deps.mobileCompactBodyHTML
      : () => "";
  const toggleLoveDishInTooltip =
    typeof deps.toggleLoveDishInTooltip === "function"
      ? deps.toggleLoveDishInTooltip
      : async () => {};
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
    typeof deps.addDishToOrder === "function" ? deps.addDishToOrder : () => ({});
  const getDishCompatibilityDetails =
    typeof deps.getDishCompatibilityDetails === "function"
      ? deps.getDishCompatibilityDetails
      : () => ({ issues: {} });
  const ensureMobileInfoPanel =
    typeof deps.ensureMobileInfoPanel === "function"
      ? deps.ensureMobileInfoPanel
      : () => null;
  const getMobileInfoPanel =
    typeof deps.getMobileInfoPanel === "function"
      ? deps.getMobileInfoPanel
      : () => null;
  const getCurrentMobileInfoItem =
    typeof deps.getCurrentMobileInfoItem === "function"
      ? deps.getCurrentMobileInfoItem
      : () => null;
  const setCurrentMobileInfoItem =
    typeof deps.setCurrentMobileInfoItem === "function"
      ? deps.setCurrentMobileInfoItem
      : () => {};
  const getIsOverlayZoomed =
    typeof deps.getIsOverlayZoomed === "function"
      ? deps.getIsOverlayZoomed
      : () => false;
  const adjustMobileInfoPanelForZoom =
    typeof deps.adjustMobileInfoPanelForZoom === "function"
      ? deps.adjustMobileInfoPanelForZoom
      : () => {};
  const hideTip = typeof deps.hideTip === "function" ? deps.hideTip : () => {};

  function renderMobileInfo(item) {
    window.renderMobileInfo = renderMobileInfo;
    window.currentMobileInfoItem = item;
    setCurrentMobileInfoItem(item);

    ensureMobileInfoPanel();
    const mobileInfoPanel = getMobileInfoPanel();
    if (!mobileInfoPanel) return;

    mobileInfoPanel.style.position = "fixed";
    const isFullScreen = document.body.classList.contains("mobileViewerActive");
    if (isFullScreen) {
      mobileInfoPanel.style.setProperty("left", "0", "important");
      mobileInfoPanel.style.setProperty("right", "0", "important");
      mobileInfoPanel.style.setProperty("bottom", "0", "important");
    } else {
      mobileInfoPanel.style.left = "12px";
      mobileInfoPanel.style.right = "12px";
      mobileInfoPanel.style.bottom = "12px";
    }
    mobileInfoPanel.style.zIndex = "3500";

    if (!prefersMobileInfo()) {
      mobileInfoPanel.classList.remove("show");
      mobileInfoPanel.style.display = "none";
      mobileInfoPanel.innerHTML = "";
      setCurrentMobileInfoItem(null);
      return;
    }

    if (!item) {
      setCurrentMobileInfoItem(null);
      mobileInfoPanel.innerHTML = "";
      mobileInfoPanel.style.display = "none";
      mobileInfoPanel.classList.remove("show");
      if (!getIsOverlayZoomed()) {
        document
          .querySelectorAll(".overlay")
          .forEach((overlay) => overlay.classList.remove("selected"));
        window.__lastSelectedOverlay = null;
      }
      return;
    }

    setCurrentMobileInfoItem(item);
    const dishName = item.id || item.name || "Item";
    const bodyHTML = mobileCompactBodyHTML(
      item,
      state.allergies || [],
      state.diets || [],
    );
    const isInOrder =
      (window.orderItems && dishName && window.orderItems.includes(dishName)) ||
      false;
    const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
    const dishKey = restaurantId ? `${String(restaurantId)}:${dishName}` : null;
    const isLoved =
      dishKey && window.lovedDishesSet && window.lovedDishesSet.has(dishKey);
    const showFavorite = !!(state.user?.loggedIn && window.supabaseClient && restaurantId);

    mobileInfoPanel.innerHTML = `
<div class="mobileInfoHeaderRow">
  <div class="mobileInfoHeader">${esc(dishName || "Item")}</div>
  <div style="display:flex;align-items:center;gap:0;">
    <button type="button" class="mobileInfoClose" aria-label="Close dish details">×</button>
  </div>
</div>
<div class="mobileInfoContent">
  ${bodyHTML}
  <div class="mobileInfoActions">
    <div class="mobileInfoActionRow">
      ${showFavorite ? `<button type="button" class="mobileFavoriteBtn${isLoved ? " loved" : ""}" id="mobileFavoriteBtn" aria-pressed="${isLoved ? "true" : "false"}" title="${isLoved ? "Remove from favorite dishes" : "Add to favorite dishes"}" aria-label="${isLoved ? "Remove from favorites" : "Add to favorites"}"><img src="images/heart-icon.svg" alt=""><span data-role="label">${isLoved ? "Favorited" : "Favorite"}</span></button>` : ""}
      <button type="button" class="addToOrderBtn mobileAddToOrderBtn" data-dish-name="${esc(dishName)}" ${isInOrder ? "disabled" : ""}>${isInOrder ? "Added" : "Add to order"}</button>
    </div>
  </div>
</div>
  `;

    if (showFavorite && restaurantId && dishName) {
      const loveBtn = mobileInfoPanel.querySelector("#mobileFavoriteBtn");
      if (loveBtn) {
        const handleLoveClick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleLoveDishInTooltip(state.user, restaurantId, dishName, loveBtn);
        };
        loveBtn.addEventListener("click", handleLoveClick, true);
        loveBtn.addEventListener("touchend", handleLoveClick, true);
      }
    }

    const addToOrderBtn = mobileInfoPanel.querySelector(".mobileAddToOrderBtn");
    const actionsContainer = mobileInfoPanel.querySelector(".mobileInfoActions");
    const addToOrderConfirmEl = ensureAddToOrderConfirmContainer(
      actionsContainer || mobileInfoPanel,
    );
    hideAddToOrderConfirmation(addToOrderConfirmEl);
    if (addToOrderBtn) {
      const dishNameAttr = addToOrderBtn.getAttribute("data-dish-name");
      if (dishNameAttr) {
        addToOrderBtn.addEventListener("click", (event) => {
          if (event) {
            event.preventDefault();
            event.stopPropagation();
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

    mobileInfoPanel.style.background = "rgba(11,16,32,0.94)";
    mobileInfoPanel.style.backdropFilter = "blur(14px)";
    mobileInfoPanel.style.webkitBackdropFilter = "blur(14px)";
    const isFullScreenCheck =
      document.body.classList.contains("mobileViewerActive");
    if (isFullScreenCheck) {
      mobileInfoPanel.style.setProperty("left", "0", "important");
      mobileInfoPanel.style.setProperty("right", "0", "important");
      mobileInfoPanel.style.setProperty("bottom", "0", "important");
    }
    adjustMobileInfoPanelForZoom();
    mobileInfoPanel.style.display = "block";
    mobileInfoPanel.classList.add("show");
    const closeBtn = mobileInfoPanel.querySelector(".mobileInfoClose");
    if (closeBtn) {
      const closePanel = (event) => {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        renderMobileInfo(null);
      };
      closeBtn.addEventListener("click", closePanel);
      closeBtn.addEventListener("touchend", closePanel, { passive: false });
      closeBtn.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          closePanel(event);
        }
      });
    }
  }

  function syncMobileInfoPanel() {
    const mobileInfoPanel = getMobileInfoPanel();
    if (!mobileInfoPanel) return;
    if (getIsOverlayZoomed()) return;
    adjustMobileInfoPanelForZoom();

    if (prefersMobileInfo()) {
      const currentMobileInfoItem = getCurrentMobileInfoItem();
      if (currentMobileInfoItem) {
        renderMobileInfo(currentMobileInfoItem);
      } else {
        mobileInfoPanel.innerHTML = "";
        mobileInfoPanel.style.display = "none";
        mobileInfoPanel.classList.remove("show");
      }
      hideTip();
    } else {
      mobileInfoPanel.classList.remove("show");
      mobileInfoPanel.style.display = "none";
      mobileInfoPanel.innerHTML = "";
      setCurrentMobileInfoItem(null);
    }
  }

  function bindSyncListeners() {
    addEventListener("resize", () => syncMobileInfoPanel(), { passive: true });
    if (window.visualViewport) {
      visualViewport.addEventListener("resize", () => syncMobileInfoPanel(), {
        passive: true,
      });
      visualViewport.addEventListener("scroll", () => syncMobileInfoPanel(), {
        passive: true,
      });
    }
  }

  return {
    renderMobileInfo,
    syncMobileInfoPanel,
    bindSyncListeners,
  };
}
