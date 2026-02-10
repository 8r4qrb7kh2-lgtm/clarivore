import {
  getCurrentMobileInfoItem,
  getRenderMobileInfo,
  getShowOverlayDetails,
  setPendingDishToOpen,
  setPendingIngredientToScroll,
  setStartInEditor,
} from "./restaurantRuntime/restaurantRuntimeBridge.js";

export function initAutoOpenDish(deps = {}) {
  const state = deps.state || {};

  const urlParams = new URLSearchParams(window.location.search);
  const openAI = urlParams.get("openAI");
  const dishId = urlParams.get("dishId");
  const dishName = urlParams.get("dishName");
  const ingredientName = urlParams.get("ingredientName");

  if (openAI === "true" && (dishId || dishName)) {
    console.log(
      "WordPress deep link detected, dishName:",
      dishName,
      "dishId:",
      dishId,
    );

    setStartInEditor(true);
    setPendingDishToOpen({
      dishId: dishId,
      dishName: dishName,
      openAI: openAI === "true",
      ingredientName: ingredientName,
    });
    if (ingredientName) {
      setPendingIngredientToScroll(ingredientName);
    }

    console.log("Set __startInEditor and __pendingDishToOpen flags");
  } else if (dishName && !openAI) {
    let retryCount = 0;
    const MAX_RETRIES = 50;

    const tryOpenOverlay = () => {
      retryCount++;
      if (retryCount > MAX_RETRIES) {
        console.error("Failed to open overlay after maximum retries");
        return;
      }

      if (
        !state ||
        !state.restaurant ||
        !Array.isArray(state.restaurant.overlays) ||
        state.restaurant.overlays.length === 0
      ) {
        setTimeout(tryOpenOverlay, 200);
        return;
      }

      const menu = document.getElementById("menu");
      if (!menu || !menu.classList.contains("show")) {
        setTimeout(tryOpenOverlay, 200);
        return;
      }

      const pageTip = document.getElementById("tip");
      if (!pageTip) {
        setTimeout(tryOpenOverlay, 200);
        return;
      }

      const menuInner = document.querySelector(".menuInner");
      const menuImg = menuInner ? menuInner.querySelector(".menuImg") : null;
      if (
        !menuImg ||
        !menuImg.complete ||
        !menuImg.naturalWidth ||
        menuImg.clientWidth === 0 ||
        menuImg.clientHeight === 0
      ) {
        setTimeout(tryOpenOverlay, 200);
        return;
      }

      const overlays = state.restaurant.overlays;
      const searchName = (dishName || "").toLowerCase().trim();

      const matchIndex = overlays.findIndex((item) => {
        const itemId = (item.id || item.name || "").toLowerCase().trim();

        if (searchName && itemId === searchName) {
          return true;
        }
        if (searchName && (itemId.includes(searchName) || searchName.includes(itemId))) {
          return true;
        }
        const normalizedItem = itemId.replace(/[^a-z0-9]/g, "");
        const normalizedSearch = searchName.replace(/[^a-z0-9]/g, "");
        if (
          normalizedItem &&
          normalizedSearch &&
          normalizedItem === normalizedSearch
        ) {
          return true;
        }
        return false;
      });

      if (matchIndex !== -1) {
        const item = overlays[matchIndex];
        const layer = document.querySelector(".overlayLayer");
        if (layer) {
          const boxes = layer.querySelectorAll(".overlay");
          const showOverlayFn = getShowOverlayDetails();
          if (
            boxes.length > 0 &&
            boxes[matchIndex] &&
            typeof showOverlayFn === "function"
          ) {
            const box = boxes[matchIndex];
            const fakeEvent = { type: "touchend", pointerType: "touch" };
            try {
              box.scrollIntoView({ behavior: "smooth", block: "center" });
              setTimeout(() => {
                showOverlayFn(fakeEvent, item, box);
              }, 500);
              const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                  if (
                    mutation.type === "attributes" &&
                    mutation.attributeName === "class"
                  ) {
                    if (document.body.classList.contains("mobileViewerActive")) {
                      const panel = document.getElementById("mobileInfoPanel");
                      if (panel) {
                        panel.style.setProperty("left", "0", "important");
                        panel.style.setProperty("right", "0", "important");
                        panel.style.setProperty("bottom", "0", "important");
                        const renderMobileInfo = getRenderMobileInfo();
                        const currentMobileInfoItem = getCurrentMobileInfoItem();
                        if (
                          typeof renderMobileInfo === "function" &&
                          currentMobileInfoItem
                        ) {
                          renderMobileInfo(currentMobileInfoItem);
                        }
                      }
                      observer.disconnect();
                    }
                  }
                });
              });
              observer.observe(document.body, {
                attributes: true,
                attributeFilter: ["class"],
              });
              return;
            } catch (error) {
              console.error("Error opening overlay:", error);
              setTimeout(tryOpenOverlay, 200);
            }
          } else {
            setTimeout(tryOpenOverlay, 200);
          }
        } else {
          setTimeout(tryOpenOverlay, 200);
        }
      } else {
        console.log("Could not find dish to auto-open:", dishName);
      }
    };

    if (document.readyState === "complete") {
      setTimeout(tryOpenOverlay, 500);
    } else {
      window.addEventListener("load", () => {
        setTimeout(tryOpenOverlay, 500);
      });
    }
  }
}
