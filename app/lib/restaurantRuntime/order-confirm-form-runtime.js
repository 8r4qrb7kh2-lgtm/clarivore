export function createOrderConfirmFormRuntime(options = {}) {
  const state = options.state || {};
  const send = typeof options.send === "function" ? options.send : null;
  const resizeLegendToFit =
    typeof options.resizeLegendToFit === "function"
      ? options.resizeLegendToFit
      : () => {};

  const orderConfirmForm = options.orderConfirmForm || null;
  const orderConfirmNameInput = options.orderConfirmNameInput || null;
  const orderConfirmAllergyChips = options.orderConfirmAllergyChips || null;
  const orderConfirmDietChips = options.orderConfirmDietChips || null;
  const orderConfirmNotesInput = options.orderConfirmNotesInput || null;
  const orderConfirmCodeInput = options.orderConfirmCodeInput || null;
  const orderConfirmAuthPrompt = options.orderConfirmAuthPrompt || null;
  const orderConfirmSubmitBtn = options.orderConfirmSubmitBtn || null;

  const getSupabaseClient =
    typeof options.getSupabaseClient === "function"
      ? options.getSupabaseClient
      : () => null;
  const getOrderItems =
    typeof options.getOrderItems === "function" ? options.getOrderItems : () => [];
  const writeOrderItems =
    typeof options.writeOrderItems === "function"
      ? options.writeOrderItems
      : () => {};
  const hasOrderItems =
    typeof options.hasOrderItems === "function" ? options.hasOrderItems : () => false;
  const getOrderFormStateStorageKey =
    typeof options.getOrderFormStateStorageKey === "function"
      ? options.getOrderFormStateStorageKey
      : () => "orderConfirmFormState";
  const getRestaurantSlug =
    typeof options.getRestaurantSlug === "function"
      ? options.getRestaurantSlug
      : () => "";
  const getLocationHref =
    typeof options.getLocationHref === "function"
      ? options.getLocationHref
      : () => (typeof location !== "undefined" ? location.href : "");
  const navigateToUrl =
    typeof options.navigateToUrl === "function"
      ? options.navigateToUrl
      : (url) => {
          if (typeof location !== "undefined") {
            location.href = url;
          }
        };

  const waitForMenuOverlays =
    typeof options.waitForMenuOverlays === "function"
      ? options.waitForMenuOverlays
      : ({ onReady } = {}) => {
          if (typeof onReady === "function") onReady();
        };
  const markOverlayDishesSelected =
    typeof options.markOverlayDishesSelected === "function"
      ? options.markOverlayDishesSelected
      : () => {};
  const applyOverlayPulseColor =
    typeof options.applyOverlayPulseColor === "function"
      ? options.applyOverlayPulseColor
      : () => {};

  const onUpdateOrderSidebar =
    typeof options.onUpdateOrderSidebar === "function"
      ? options.onUpdateOrderSidebar
      : () => {};
  const onOpenOrderSidebar =
    typeof options.onOpenOrderSidebar === "function"
      ? options.onOpenOrderSidebar
      : () => {};
  const onConfirmOrder =
    typeof options.onConfirmOrder === "function" ? options.onConfirmOrder : () => {};
  const onRerenderOrderConfirmDetails =
    typeof options.onRerenderOrderConfirmDetails === "function"
      ? options.onRerenderOrderConfirmDetails
      : () => {};
  const showAlert =
    typeof options.showAlert === "function"
      ? options.showAlert
      : (message) => {
          if (typeof alert === "function") {
            alert(message);
          }
        };

  let orderConfirmModeBound = false;
  let deliveryButtonClickHandler = null;

  function getSuggestedUserName() {
    if (!state.user) return "";
    const rawName =
      typeof state.user.name === "string" ? state.user.name.trim() : "";
    if (rawName) return rawName;
    const first = state.user.user_metadata?.first_name
      ? String(state.user.user_metadata.first_name).trim()
      : "";
    const last = state.user.user_metadata?.last_name
      ? String(state.user.user_metadata.last_name).trim()
      : "";
    const combined = `${first} ${last}`.trim();
    if (combined) return combined;
    const email = typeof state.user.email === "string" ? state.user.email : "";
    if (email) {
      const emailName = (email.split("@")[0] || "")
        .replace(/[_\.]+/g, " ")
        .trim();
      if (emailName) return emailName;
    }
    return "";
  }

  function applyDefaultUserName(force = false) {
    if (!orderConfirmNameInput) return;
    const current = (orderConfirmNameInput.value || "").trim();
    if (current && !force) return;
    const suggested = getSuggestedUserName();
    if (suggested) {
      orderConfirmNameInput.value = suggested;
    }
  }

  async function checkUserAuth() {
    try {
      const supabaseClient = getSupabaseClient();
      if (!supabaseClient) return false;
      const {
        data: { user },
      } = await supabaseClient.auth.getUser();
      return !!user;
    } catch (_error) {
      return false;
    }
  }

  function saveOrderFormState() {
    if (!orderConfirmForm) return;
    const storageKey = getOrderFormStateStorageKey();
    const formData = {
      name: orderConfirmNameInput?.value || "",
      mode:
        orderConfirmForm.querySelector('input[name="orderConfirmMode"]:checked')
          ?.value || "dine-in",
      allergies: Array.from(
        orderConfirmAllergyChips?.querySelectorAll(".chip.selected") || [],
      ).map((chip) => chip.textContent.trim()),
      diets: Array.from(
        orderConfirmDietChips?.querySelectorAll(".chip.selected") || [],
      ).map((chip) => chip.textContent.trim()),
      notes: orderConfirmNotesInput?.value || "",
      code: orderConfirmCodeInput?.value || "",
      dishes: [...getOrderItems()],
      timestamp: Date.now(),
      restaurantSlug: getRestaurantSlug(),
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(formData));
      if (storageKey !== "orderConfirmFormState") {
        localStorage.removeItem("orderConfirmFormState");
      }
    } catch (error) {
      console.error("Failed to save order form state", error);
    }
  }

  function applyAckUiState() {
    const wasAcknowledged = state.ack;
    state.ack = true;
    const ackBtn = document.getElementById("ackBtn");
    if (ackBtn) {
      if (!wasAcknowledged && send) {
        send({ type: "ack" });
      }
      ackBtn.textContent = "Acknowledged";
      ackBtn.classList.remove("off");
      ackBtn.classList.add("on");

      const menu = document.getElementById("menu");
      if (menu) menu.classList.add("show");
      const actionButtonsRow = document.getElementById("actionButtonsRow");
      if (actionButtonsRow) actionButtonsRow.style.display = "flex";
      const legendRow = document.getElementById("legendRow");
      if (legendRow) {
        legendRow.style.display = "flex";
        setTimeout(resizeLegendToFit, 0);
      }
      const confirmedRow = document.getElementById("confirmedRow");
      if (confirmedRow) confirmedRow.style.display = "block";
    }
  }

  function restoreOrderFormState() {
    try {
      const storageKey = getOrderFormStateStorageKey();
      let saved = localStorage.getItem(storageKey);
      let usedLegacyKey = false;
      if (!saved && storageKey !== "orderConfirmFormState") {
        saved = localStorage.getItem("orderConfirmFormState");
        if (saved) usedLegacyKey = true;
      }
      if (!saved) return false;

      const formData = JSON.parse(saved);
      const restaurantMatches =
        !formData?.restaurantSlug || formData.restaurantSlug === getRestaurantSlug();
      if (
        !formData ||
        Date.now() - formData.timestamp > 3600000 ||
        !restaurantMatches
      ) {
        localStorage.removeItem(storageKey);
        if (usedLegacyKey) localStorage.removeItem("orderConfirmFormState");
        return false;
      }

      if (
        formData.dishes &&
        Array.isArray(formData.dishes) &&
        formData.dishes.length > 0
      ) {
        writeOrderItems([...formData.dishes]);
        waitForMenuOverlays({
          onReady: () => {
            markOverlayDishesSelected(formData.dishes, {
              setOverlayPulseColor: applyOverlayPulseColor,
            });
            onUpdateOrderSidebar();
          },
        });
        onUpdateOrderSidebar();
      }

      if (orderConfirmNameInput) {
        if (formData.name) {
          orderConfirmNameInput.value = formData.name;
        } else if (state.user?.name) {
          orderConfirmNameInput.value = state.user.name;
        } else if (state.user?.email) {
          orderConfirmNameInput.value = (state.user.email.split("@")[0] || "").trim();
        }
      }

      if (formData.mode) {
        const modeRadio = orderConfirmForm?.querySelector(
          `input[name="orderConfirmMode"][value="${formData.mode}"]`,
        );
        if (modeRadio) modeRadio.checked = true;
      }

      if (orderConfirmNameInput && !orderConfirmNameInput.value.trim()) {
        applyDefaultUserName();
      }
      if (orderConfirmNotesInput && formData.notes) {
        orderConfirmNotesInput.value = formData.notes;
      }
      if (orderConfirmCodeInput && formData.code) {
        orderConfirmCodeInput.value = formData.code;
      }

      applyAckUiState();
      onOpenOrderSidebar();

      if (hasOrderItems()) {
        setTimeout(() => {
          onConfirmOrder();
          setTimeout(() => {
            onRerenderOrderConfirmDetails();
          }, 120);
        }, 100);
      }

      localStorage.removeItem(storageKey);
      if (storageKey !== "orderConfirmFormState") {
        localStorage.removeItem("orderConfirmFormState");
      }
      return true;
    } catch (error) {
      console.error("Failed to restore form state", error);
      return false;
    }
  }

  function handleSignInClick() {
    saveOrderFormState();
    const currentUrl = getLocationHref();
    navigateToUrl(
      `/account?redirect=${encodeURIComponent(currentUrl)}&mode=signin`,
    );
  }

  function handleSignUpClick() {
    saveOrderFormState();
    const currentUrl = getLocationHref();
    navigateToUrl(
      `/account?redirect=${encodeURIComponent(currentUrl)}&mode=signup`,
    );
  }

  async function updateOrderConfirmAuthState() {
    const isAuthenticated = await checkUserAuth();
    if (orderConfirmAuthPrompt) {
      orderConfirmAuthPrompt.style.display = isAuthenticated ? "none" : "block";
    }
    if (orderConfirmSubmitBtn) {
      orderConfirmSubmitBtn.disabled = !isAuthenticated;
    }
    if (isAuthenticated) {
      restoreOrderFormState();
      applyDefaultUserName();
    }
  }

  function bindOrderConfirmModeSwitcher() {
    if (orderConfirmModeBound || !orderConfirmForm) return;
    const radios = orderConfirmForm.querySelectorAll(
      'input[name="orderConfirmMode"]',
    );
    radios.forEach((radio) => {
      radio.addEventListener("change", () => {
        updateOrderConfirmModeVisibility();
      });
    });
    orderConfirmModeBound = true;
    updateOrderConfirmModeVisibility();
  }

  function updateOrderConfirmModeVisibility() {
    if (!orderConfirmForm) return;
    const conditionalLabels = orderConfirmForm.querySelectorAll(
      ".orderConfirmConditional [data-mode]",
    );
    const active = orderConfirmForm.querySelector(
      'input[name="orderConfirmMode"]:checked',
    );
    const isDelivery = active && active.value === "delivery";

    conditionalLabels.forEach((label) => {
      const mode = label.getAttribute("data-mode");
      label.hidden = !active || active.value !== mode;
    });

    const deliveryButtonContainer = document.getElementById(
      "deliveryButtonContainer",
    );
    if (deliveryButtonContainer) {
      deliveryButtonContainer.hidden = !isDelivery;
      const deliveryLinkButton = document.getElementById("deliveryLinkButton");
      if (deliveryLinkButton) {
        if (deliveryButtonClickHandler) {
          deliveryLinkButton.removeEventListener("click", deliveryButtonClickHandler);
          deliveryButtonClickHandler = null;
        }

        if (isDelivery && state.restaurant?.delivery_url) {
          deliveryLinkButton.href = state.restaurant.delivery_url;
          deliveryLinkButton.style.display = "inline-flex";
          deliveryLinkButton.style.opacity = "1";
          deliveryLinkButton.style.cursor = "pointer";
        } else if (isDelivery && !state.restaurant?.delivery_url) {
          deliveryLinkButton.href = "#";
          deliveryLinkButton.style.display = "inline-flex";
          deliveryLinkButton.style.opacity = "0.5";
          deliveryLinkButton.style.cursor = "not-allowed";
          deliveryButtonClickHandler = (event) => {
            event.preventDefault();
            showAlert("Delivery URL not configured. Please contact the restaurant.");
          };
          deliveryLinkButton.addEventListener("click", deliveryButtonClickHandler);
        } else {
          deliveryLinkButton.style.display = "none";
        }
      }
    }

    const dineInCodeSection = document.getElementById("dineInCodeSection");
    const deliveryMessageSection = document.getElementById(
      "deliveryMessageSection",
    );
    if (dineInCodeSection) {
      dineInCodeSection.style.display = isDelivery ? "none" : "block";
    }
    if (deliveryMessageSection) {
      deliveryMessageSection.style.display = isDelivery ? "block" : "none";
    }
  }

  return {
    getSuggestedUserName,
    applyDefaultUserName,
    checkUserAuth,
    saveOrderFormState,
    restoreOrderFormState,
    handleSignInClick,
    handleSignUpClick,
    updateOrderConfirmAuthState,
    bindOrderConfirmModeSwitcher,
    updateOrderConfirmModeVisibility,
  };
}
