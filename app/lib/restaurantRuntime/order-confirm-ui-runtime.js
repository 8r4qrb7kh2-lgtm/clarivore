export function createOrderConfirmUiRuntime(options = {}) {
  const state = options.state || {};
  const orderConfirmDrawer = options.orderConfirmDrawer || null;
  const orderConfirmCloseBtn = options.orderConfirmCloseBtn || null;
  const orderConfirmSummaryList = options.orderConfirmSummaryList || null;
  const orderConfirmEmptySummary = options.orderConfirmEmptySummary || null;
  const orderConfirmStatusBadge = options.orderConfirmStatusBadge || null;
  const orderConfirmForm = options.orderConfirmForm || null;
  const orderConfirmNameInput = options.orderConfirmNameInput || null;
  const orderConfirmDeliveryInput = options.orderConfirmDeliveryInput || null;
  const orderConfirmAllergyChips = options.orderConfirmAllergyChips || null;
  const orderConfirmDietChips = options.orderConfirmDietChips || null;
  const orderConfirmNotesInput = options.orderConfirmNotesInput || null;
  const orderConfirmCodeInput = options.orderConfirmCodeInput || null;
  const orderConfirmSubmitBtn = options.orderConfirmSubmitBtn || null;
  const orderConfirmSubmitStatus = options.orderConfirmSubmitStatus || null;
  const orderConfirmResetBtn = options.orderConfirmResetBtn || null;
  const orderConfirmSignInBtn = options.orderConfirmSignInBtn || null;
  const orderConfirmSignUpBtn = options.orderConfirmSignUpBtn || null;
  const orderConfirmServerPanel = options.orderConfirmServerPanel || null;
  const orderConfirmKitchenPanel = options.orderConfirmKitchenPanel || null;

  const getSelectedOrderItems =
    typeof options.getSelectedOrderItems === "function"
      ? options.getSelectedOrderItems
      : () => [];
  const createDishSummaryCard =
    typeof options.createDishSummaryCard === "function"
      ? options.createDishSummaryCard
      : (value) => String(value ?? "");
  const formatOrderListLabel =
    typeof options.formatOrderListLabel === "function"
      ? options.formatOrderListLabel
      : (value) => String(value ?? "");
  const getAllergenEmoji =
    typeof options.getAllergenEmoji === "function"
      ? options.getAllergenEmoji
      : () => "";
  const getDietEmoji =
    typeof options.getDietEmoji === "function" ? options.getDietEmoji : () => "";

  const onBindOrderConfirmModeSwitcher =
    typeof options.onBindOrderConfirmModeSwitcher === "function"
      ? options.onBindOrderConfirmModeSwitcher
      : () => {};
  const onHandleOrderConfirmSubmit =
    typeof options.onHandleOrderConfirmSubmit === "function"
      ? options.onHandleOrderConfirmSubmit
      : () => {};
  const onHandleOrderConfirmReset =
    typeof options.onHandleOrderConfirmReset === "function"
      ? options.onHandleOrderConfirmReset
      : () => {};
  const onHandleSignInClick =
    typeof options.onHandleSignInClick === "function"
      ? options.onHandleSignInClick
      : () => {};
  const onHandleSignUpClick =
    typeof options.onHandleSignUpClick === "function"
      ? options.onHandleSignUpClick
      : () => {};
  const onHandleOrderConfirmServerPanel =
    typeof options.onHandleOrderConfirmServerPanel === "function"
      ? options.onHandleOrderConfirmServerPanel
      : () => {};
  const onHandleOrderConfirmKitchenPanel =
    typeof options.onHandleOrderConfirmKitchenPanel === "function"
      ? options.onHandleOrderConfirmKitchenPanel
      : () => {};
  const onUpdateOrderConfirmAuthState =
    typeof options.onUpdateOrderConfirmAuthState === "function"
      ? options.onUpdateOrderConfirmAuthState
      : () => {};
  const onUpdateOrderConfirmModeVisibility =
    typeof options.onUpdateOrderConfirmModeVisibility === "function"
      ? options.onUpdateOrderConfirmModeVisibility
      : () => {};
  const onRenderOrderConfirmServerPanel =
    typeof options.onRenderOrderConfirmServerPanel === "function"
      ? options.onRenderOrderConfirmServerPanel
      : () => {};
  const onRenderOrderConfirmKitchenPanel =
    typeof options.onRenderOrderConfirmKitchenPanel === "function"
      ? options.onRenderOrderConfirmKitchenPanel
      : () => {};
  const onRenderOrderSidebarStatus =
    typeof options.onRenderOrderSidebarStatus === "function"
      ? options.onRenderOrderSidebarStatus
      : () => {};
  const onPersistTabletStateSnapshot =
    typeof options.onPersistTabletStateSnapshot === "function"
      ? options.onPersistTabletStateSnapshot
      : () => {};
  const onGetTabletOrder =
    typeof options.onGetTabletOrder === "function"
      ? options.onGetTabletOrder
      : () => null;
  const onApplyDefaultUserName =
    typeof options.onApplyDefaultUserName === "function"
      ? options.onApplyDefaultUserName
      : () => {};
  const onResetOrders =
    typeof options.onResetOrders === "function"
      ? options.onResetOrders
      : () => {};
  const onResetServerPanelState =
    typeof options.onResetServerPanelState === "function"
      ? options.onResetServerPanelState
      : () => {};

  const focusDelayMs =
    Number.isFinite(options.focusDelayMs) && options.focusDelayMs > 0
      ? options.focusDelayMs
      : 60;
  const delayedRerenderMs =
    Number.isFinite(options.delayedRerenderMs) && options.delayedRerenderMs > 0
      ? options.delayedRerenderMs
      : 1000;

  function setOrderConfirmStatusBadge(label, tone = "idle") {
    if (!orderConfirmStatusBadge) return;
    orderConfirmStatusBadge.dataset.tone = tone || "idle";
    orderConfirmStatusBadge.textContent = label;
  }

  function setStatusMessage(target, message, variant) {
    if (!target) return;
    target.textContent = message || "";
    target.classList.remove("error", "success");
    if (!message) return;
    if (variant === "error") {
      target.classList.add("error");
    } else if (variant === "success") {
      target.classList.add("success");
    }
  }

  function renderOrderConfirmSummary() {
    if (!orderConfirmSummaryList || !orderConfirmEmptySummary) return;
    orderConfirmSummaryList.innerHTML = "";
    const items = getSelectedOrderItems();
    if (items.length === 0) {
      orderConfirmEmptySummary.hidden = false;
      return;
    }
    orderConfirmEmptySummary.hidden = true;
    items.forEach((item) => {
      const li = document.createElement("li");
      li.innerHTML = createDishSummaryCard(item);
      orderConfirmSummaryList.appendChild(li);
    });
  }

  function renderOrderConfirmAllergies() {
    if (!orderConfirmAllergyChips) return;
    orderConfirmAllergyChips.innerHTML = "";
    const allergies = Array.isArray(state.allergies) ? state.allergies : [];
    if (allergies.length === 0) {
      const chip = document.createElement("span");
      chip.className = "orderConfirmChip muted";
      chip.textContent = "No allergens saved";
      orderConfirmAllergyChips.appendChild(chip);
      return;
    }
    allergies.forEach((allergen) => {
      const chip = document.createElement("span");
      chip.className = "orderConfirmChip";
      const label = formatOrderListLabel(allergen);
      const emoji = getAllergenEmoji(allergen) || "🔴";
      chip.textContent = `${emoji} ${label}`;
      orderConfirmAllergyChips.appendChild(chip);
    });
  }

  function renderOrderConfirmDiets() {
    if (!orderConfirmDietChips) return;
    orderConfirmDietChips.innerHTML = "";
    const diets = Array.isArray(state.diets) ? state.diets : [];
    if (diets.length === 0) {
      const chip = document.createElement("span");
      chip.className = "orderConfirmChip muted";
      chip.textContent = "No diets saved";
      orderConfirmDietChips.appendChild(chip);
      return;
    }
    diets.forEach((diet) => {
      const chip = document.createElement("span");
      chip.className = "orderConfirmChip";
      const label = formatOrderListLabel(diet);
      const emoji = getDietEmoji(diet) || "🍽️";
      chip.textContent = `${emoji} ${label}`;
      orderConfirmDietChips.appendChild(chip);
    });
  }

  function rerenderOrderConfirmDetails() {
    if (!orderConfirmDrawer?.classList.contains("show")) return;
    renderOrderConfirmSummary();
    renderOrderConfirmAllergies();
    renderOrderConfirmDiets();
  }

  function initializeOrderConfirmDrawer() {
    if (!orderConfirmDrawer) return;
    onBindOrderConfirmModeSwitcher();
    orderConfirmCloseBtn?.addEventListener("click", closeOrderConfirmDrawer);
    orderConfirmDrawer.addEventListener("click", (event) => {
      if (event.target === orderConfirmDrawer) {
        closeOrderConfirmDrawer();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && orderConfirmDrawer.classList.contains("show")) {
        closeOrderConfirmDrawer();
      }
    });
    orderConfirmSubmitBtn?.addEventListener("click", onHandleOrderConfirmSubmit);
    orderConfirmResetBtn?.addEventListener("click", onHandleOrderConfirmReset);
    orderConfirmSignInBtn?.addEventListener("click", onHandleSignInClick);
    orderConfirmSignUpBtn?.addEventListener("click", onHandleSignUpClick);

    onUpdateOrderConfirmAuthState();
    orderConfirmServerPanel?.addEventListener("click", onHandleOrderConfirmServerPanel);
    orderConfirmKitchenPanel?.addEventListener("click", onHandleOrderConfirmKitchenPanel);
  }

  function openOrderConfirmDrawer() {
    if (!orderConfirmDrawer) return;
    console.log("[order-confirm] Opening confirmation drawer");
    renderOrderConfirmSummary();
    resetOrderConfirmFlow({ preserveOrders: true });
    onApplyDefaultUserName();
    renderOrderConfirmAllergies();
    renderOrderConfirmDiets();
    onUpdateOrderConfirmAuthState();
    orderConfirmDrawer.classList.add("show");
    orderConfirmDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("orderConfirmOpen");
    setTimeout(() => orderConfirmNameInput?.focus(), focusDelayMs);

    setTimeout(() => {
      if (orderConfirmDrawer?.classList.contains("show")) {
        rerenderOrderConfirmDetails();
        if (orderConfirmNameInput && !orderConfirmNameInput.value) {
          if (state.user?.name) {
            orderConfirmNameInput.value = state.user.name;
          } else if (state.user?.email) {
            orderConfirmNameInput.value = (state.user.email.split("@")[0] || "").trim();
          }
        }
      }
    }, delayedRerenderMs);
  }

  function closeOrderConfirmDrawer() {
    if (!orderConfirmDrawer) return;
    orderConfirmDrawer.classList.remove("show");
    orderConfirmDrawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("orderConfirmOpen");
  }

  function resetOrderConfirmFlow(options = {}) {
    if (!orderConfirmForm) return;
    const preserveOrders = options.preserveOrders !== false;
    if (!preserveOrders) {
      onResetOrders();
    }
    orderConfirmForm.reset();
    onUpdateOrderConfirmModeVisibility();
    if (orderConfirmCodeInput) {
      orderConfirmCodeInput.value = "";
      orderConfirmCodeInput.disabled = false;
    }
    if (orderConfirmSubmitBtn) {
      orderConfirmSubmitBtn.disabled = false;
    }
    setStatusMessage(orderConfirmSubmitStatus, "");
    setOrderConfirmStatusBadge("Waiting for server code", "idle");
    onRenderOrderConfirmServerPanel();
    onRenderOrderConfirmKitchenPanel();
    orderConfirmResetBtn?.setAttribute("hidden", "");
    if (state.user?.name) {
      orderConfirmNameInput.value = state.user.name;
    } else if (state.user?.email) {
      orderConfirmNameInput.value = (state.user.email.split("@")[0] || "").trim();
    } else if (orderConfirmNameInput) {
      orderConfirmNameInput.value = "";
    }
    if (orderConfirmDeliveryInput) orderConfirmDeliveryInput.value = "";
    if (orderConfirmNotesInput) orderConfirmNotesInput.value = "";
    onResetServerPanelState();
    if (!preserveOrders) {
      onRenderOrderSidebarStatus(null);
      onPersistTabletStateSnapshot();
    } else {
      onRenderOrderSidebarStatus(onGetTabletOrder());
    }
  }

  return {
    setOrderConfirmStatusBadge,
    setStatusMessage,
    renderOrderConfirmSummary,
    renderOrderConfirmAllergies,
    renderOrderConfirmDiets,
    rerenderOrderConfirmDetails,
    initializeOrderConfirmDrawer,
    openOrderConfirmDrawer,
    closeOrderConfirmDrawer,
    resetOrderConfirmFlow,
  };
}
