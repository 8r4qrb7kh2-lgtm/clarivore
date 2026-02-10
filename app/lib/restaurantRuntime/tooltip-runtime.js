import {
  getLovedDishesSet as getSessionLovedDishesSet,
  getOrderItems as getSessionOrderItems,
  getSupabaseClient as getSessionSupabaseClient,
} from "./runtimeSessionState.js";

export function createTooltipRuntime(deps = {}) {
  const pageTip = deps.pageTip || null;
  const state = deps.state || {};
  const esc =
    typeof deps.esc === "function"
      ? deps.esc
      : (value) => String(value ?? "");
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
  const setOverlayPulseColor =
    typeof deps.setOverlayPulseColor === "function"
      ? deps.setOverlayPulseColor
      : () => {};
  const getOrderItems =
    typeof deps.getOrderItems === "function"
      ? deps.getOrderItems
      : () => getSessionOrderItems();
  const getLovedDishesSet =
    typeof deps.getLovedDishesSet === "function"
      ? deps.getLovedDishesSet
      : () => getSessionLovedDishesSet();
  const getSupabaseClient =
    typeof deps.getSupabaseClient === "function"
      ? deps.getSupabaseClient
      : () => getSessionSupabaseClient();

  let tipInteracted = false;
  let tipPinned = false;
  let pinnedOverlayItem = null;

  function hideTip(force = false) {
    if (tipPinned && !force) {
      return;
    }
    if (pageTip && pageTip.matches(":hover") && !force) {
      return;
    }
    if (!pageTip) return;

    pageTip.style.display = "none";
    tipInteracted = false;
    tipPinned = false;
    pinnedOverlayItem = null;
    document
      .querySelectorAll(".overlay")
      .forEach((overlay) => overlay.classList.remove("selected"));
  }

  function bindTipInteraction() {
    if (!pageTip) return;

    pageTip.addEventListener("click", (event) => {
      if (event.target && event.target.classList.contains("tClose")) {
        hideTip(true);
        return;
      }
      tipInteracted = true;
      tipPinned = true;
    });

    pageTip.addEventListener("touchstart", (event) => {
      if (event.target && event.target.classList.contains("tClose")) {
        hideTip(true);
        return;
      }
      tipInteracted = true;
      tipPinned = true;
    });
  }

  function showTipIn(
    el,
    x,
    y,
    title,
    bodyHTML,
    anchorRect = null,
    isClick = false,
    item = null,
  ) {
    if (!el) return;

    const viewport =
      typeof visualViewport !== "undefined" ? visualViewport : null;
    const offsetLeft =
      viewport && typeof viewport.offsetLeft === "number"
        ? viewport.offsetLeft
        : 0;
    const offsetTop =
      viewport && typeof viewport.offsetTop === "number" ? viewport.offsetTop : 0;
    const viewportWidth =
      viewport && viewport.width
        ? viewport.width
        : typeof innerWidth === "number"
          ? innerWidth
          : document.documentElement?.clientWidth || 0;
    const viewportHeight =
      viewport && viewport.height
        ? viewport.height
        : typeof innerHeight === "number"
          ? innerHeight
          : document.documentElement?.clientHeight || 0;
    const scrollLeftPx =
      (typeof scrollX === "number" ? scrollX : null) ||
      (typeof pageXOffset === "number" ? pageXOffset : null) ||
      document.documentElement.scrollLeft ||
      0;
    const scrollTopPx =
      (typeof scrollY === "number" ? scrollY : null) ||
      (typeof pageYOffset === "number" ? pageYOffset : null) ||
      document.documentElement.scrollTop ||
      0;

    const showButtons = tipPinned || isClick;

    const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
    const dishName = title || "Unnamed dish";
    const dishKey = restaurantId ? `${String(restaurantId)}:${dishName}` : null;
    const lovedDishesSet = getLovedDishesSet();
    const isLoved =
      dishKey && lovedDishesSet && lovedDishesSet.has(dishKey);
    const loveButtonId = dishKey
      ? `love-btn-tooltip-${dishKey.replace(/[^a-zA-Z0-9]/g, "-")}`
      : null;
    const loveButtonHTML =
      showButtons && loveButtonId && state.user?.loggedIn && restaurantId
        ? `<button type="button" class="love-button-tooltip ${isLoved ? "loved" : ""}" id="${loveButtonId}" data-restaurant-id="${restaurantId}" data-dish-name="${esc(dishName)}" title="${isLoved ? "Remove from favorite dishes" : "Add to favorite dishes"}" aria-label="${isLoved ? "Remove from favorites" : "Add to favorites"}"><img src="images/heart-icon.svg" alt="${isLoved ? "Loved" : "Not loved"}" style="width:14px;height:14px;display:block;" /></button>`
        : "";

    const closeButtonHTML = showButtons
      ? '<button class="tClose" type="button">✕</button>'
      : "";
    const hoverMessage =
      !isClick && !tipPinned
        ? '<div class="tipHoverMessage">Select item for more options</div>'
        : "";

    const orderItems = getOrderItems();
    const isInOrder =
      (orderItems && title && orderItems.includes(title)) || false;
    const addToOrderButton =
      showButtons && title
        ? `<button type="button" class="addToOrderBtn" data-dish-name="${esc(title)}" id="addToOrderBtn_${esc(title).replace(/[^a-zA-Z0-9]/g, "_")}" ${isInOrder ? "disabled" : ""}>${isInOrder ? "Added" : "Add to order"}</button>`
        : "";

    el.innerHTML = `
<div class="tipHead">
  <div class="tTitle">${esc(title || "Item")}</div>
  <div style="display:flex;align-items:center;gap:0;">
    ${loveButtonHTML}
    ${closeButtonHTML}
  </div>
</div>
${bodyHTML}
${hoverMessage}
${addToOrderButton}
  `;
    el.style.display = "block";

    if (hoverMessage) {
      el.style.paddingBottom = "4px";
    } else {
      el.style.paddingBottom = "";
    }

    if (isClick && item) {
      tipPinned = true;
      tipInteracted = true;
      pinnedOverlayItem = item;
    }

    if (!tipPinned) {
      tipInteracted = false;
      pinnedOverlayItem = null;
    }

    const loveBtn = el.querySelector(".love-button-tooltip");
    if (loveBtn && getSupabaseClient() && state.user?.loggedIn) {
      const restaurantIdAttr = loveBtn.getAttribute("data-restaurant-id");
      const dishNameAttr = loveBtn.getAttribute("data-dish-name");
      if (restaurantIdAttr && dishNameAttr) {
        const handleLoveClick = (event) => {
          if (event) {
            event.preventDefault();
            event.stopPropagation();
          }
          toggleLoveDishInTooltip(
            state.user,
            restaurantIdAttr,
            dishNameAttr,
            loveBtn,
          );
        };
        loveBtn.addEventListener("click", handleLoveClick);
        loveBtn.addEventListener("touchend", handleLoveClick, { passive: false });
      }
    }

    const addToOrderBtn = el.querySelector(".addToOrderBtn");
    const addToOrderConfirmEl = ensureAddToOrderConfirmContainer(el);
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

    const isMobile =
      (typeof innerWidth === "number"
        ? innerWidth
        : document.documentElement?.clientWidth || 0) <= 640;
    el.style.transform = "";
    el.style.transformOrigin = "";

    const layoutWidth =
      document.documentElement?.clientWidth ||
      (typeof innerWidth === "number" ? innerWidth : 0);
    const baseMaxWidth = isMobile
      ? Math.min(280, Math.max(220, layoutWidth - 40))
      : Math.min(320, Math.max(240, layoutWidth - 80));
    el.style.maxWidth = baseMaxWidth + "px";
    el.style.padding = isMobile ? "8px" : "10px";
    el.style.borderRadius = isMobile ? "8px" : "10px";
    el.style.fontSize = isMobile ? "12px" : "14px";

    const titleEl = el.querySelector(".tTitle");
    if (titleEl) titleEl.style.fontSize = isMobile ? "14px" : "16px";

    const closeEl = el.querySelector(".tClose");
    if (closeEl) {
      closeEl.style.padding = isMobile ? "3px 6px" : "4px 8px";
      closeEl.style.fontSize = isMobile ? "12px" : "14px";
      closeEl.style.borderRadius = isMobile ? "5px" : "6px";
    }

    const loveBtnEl = el.querySelector(".love-button-tooltip");
    if (loveBtnEl) {
      loveBtnEl.style.padding = isMobile ? "3px 6px" : "4px 8px";
      loveBtnEl.style.fontSize = isMobile ? "12px" : "14px";
      loveBtnEl.style.borderRadius = isMobile ? "5px" : "6px";
    }

    const noteEls = el.querySelectorAll(".note");
    noteEls.forEach((note) => (note.style.fontSize = isMobile ? "11px" : "13px"));

    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const pad = isMobile ? 8 : 12;
      const visibleLeft = scrollLeftPx + offsetLeft;
      const visibleTop = scrollTopPx + offsetTop;
      const visibleRight = visibleLeft + viewportWidth;
      const visibleBottom = visibleTop + viewportHeight;

      const useAnchor = !!anchorRect;

      const anchorLeft = anchorRect
        ? anchorRect.left + scrollLeftPx + offsetLeft
        : null;
      const anchorRight = anchorRect
        ? anchorRect.right + scrollLeftPx + offsetLeft
        : null;
      const anchorTop = anchorRect
        ? anchorRect.top + scrollTopPx + offsetTop
        : null;
      const anchorBottom = anchorRect
        ? anchorRect.bottom + scrollTopPx + offsetTop
        : null;
      const anchorCenterX = anchorRect ? (anchorLeft + anchorRight) / 2 : null;

      let left;
      let top;

      if (useAnchor) {
        const offset = isMobile ? 12 : 16;
        left = (anchorCenterX || visibleLeft + pad) - rect.width / 2;
        top =
          (anchorTop !== null ? anchorTop : visibleTop + pad) -
          rect.height -
          offset;

        if (top < visibleTop + pad) {
          top =
            (anchorBottom !== null ? anchorBottom : visibleTop + pad) + offset;
        }
        if (top + rect.height + pad > visibleBottom) {
          const anchorMiddle = anchorRect
            ? anchorTop + anchorRect.height / 2
            : visibleTop + viewportHeight / 2;
          top = anchorMiddle - rect.height / 2;
          if (top + rect.height + pad > visibleBottom) {
            top = visibleBottom - rect.height - pad;
          }
        }
      } else {
        const pointerX =
          typeof x === "number"
            ? x + scrollLeftPx + offsetLeft
            : visibleLeft + viewportWidth / 2;
        const pointerY =
          typeof y === "number"
            ? y + scrollTopPx + offsetTop
            : visibleTop + viewportHeight / 2;
        left = pointerX + (isMobile ? 8 : 12);
        top = pointerY + (isMobile ? 8 : 12);
      }

      if (left + rect.width + pad > visibleRight) {
        left = Math.max(visibleLeft + pad, visibleRight - rect.width - pad);
      }
      if (top + rect.height + pad > visibleBottom) {
        top = Math.max(visibleTop + pad, visibleBottom - rect.height - pad);
      }

      left = Math.max(visibleLeft + pad, left);
      top = Math.max(visibleTop + pad, top);

      el.style.left = left + "px";
      el.style.top = top + "px";
    });

    const closeButton = el.querySelector(".tClose");
    if (closeButton) {
      closeButton.onclick = () => {
        hideTip(true);
      };
    }
  }

  bindTipInteraction();

  return {
    showTipIn,
    hideTip,
    getTipPinned: () => tipPinned,
    getPinnedOverlayItem: () => pinnedOverlayItem,
  };
}
