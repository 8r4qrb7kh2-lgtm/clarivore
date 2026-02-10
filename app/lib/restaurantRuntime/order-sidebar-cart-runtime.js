export function createOrderSidebarCartRuntime(options = {}) {
  const orderSidebarItems = options.orderSidebarItems || null;
  const esc = typeof options.esc === "function" ? options.esc : (value) => String(value ?? "");
  const escapeAttribute =
    typeof options.escapeAttribute === "function"
      ? options.escapeAttribute
      : (value) => String(value ?? "");
  const hasOrderItems =
    typeof options.hasOrderItems === "function" ? options.hasOrderItems : () => false;
  const getOrderItems =
    typeof options.getOrderItems === "function" ? options.getOrderItems : () => [];
  const isOrderItemSelected =
    typeof options.isOrderItemSelected === "function"
      ? options.isOrderItemSelected
      : () => false;
  const syncOrderItemSelections =
    typeof options.syncOrderItemSelections === "function"
      ? options.syncOrderItemSelections
      : () => {};
  const toggleOrderItemSelection =
    typeof options.toggleOrderItemSelection === "function"
      ? options.toggleOrderItemSelection
      : () => {};
  const removeDishFromOrder =
    typeof options.removeDishFromOrder === "function"
      ? options.removeDishFromOrder
      : () => {};
  const setConfirmButtonVisibility =
    typeof options.setConfirmButtonVisibility === "function"
      ? options.setConfirmButtonVisibility
      : () => {};
  const setConfirmButtonDisabled =
    typeof options.setConfirmButtonDisabled === "function"
      ? options.setConfirmButtonDisabled
      : () => {};
  const updateConfirmButtonVisibility =
    typeof options.updateConfirmButtonVisibility === "function"
      ? options.updateConfirmButtonVisibility
      : () => {};
  const minimizeOrderSidebar =
    typeof options.minimizeOrderSidebar === "function"
      ? options.minimizeOrderSidebar
      : () => {};

  function bindOrderItemSelectButtons(container) {
    if (!container) return;
    container.querySelectorAll(".orderItemSelect").forEach((btn) => {
      if (btn.__selectionBound) return;
      btn.__selectionBound = true;
      const applySelectionState = (dishName) => {
        toggleOrderItemSelection(dishName);
        const isSelected = isOrderItemSelected(dishName);
        btn.classList.toggle("is-selected", isSelected);
        btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
        btn.setAttribute(
          "aria-label",
          `${isSelected ? "Deselect" : "Select"} ${dishName}`,
        );
      };
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const dishName = btn.getAttribute("data-dish-name");
        if (!dishName) return;
        applySelectionState(dishName);
      });
      const row = btn.closest(".orderItem");
      if (row && !row.__rowSelectionBound) {
        row.__rowSelectionBound = true;
        row.addEventListener("click", (event) => {
          if (event.target.closest(".orderItemRemove")) return;
          if (event.target.closest(".orderItemSelect")) return;
          const dishName =
            row.getAttribute("data-dish-name") ||
            btn.getAttribute("data-dish-name");
          if (!dishName) return;
          applySelectionState(dishName);
        });
      }
    });
  }

  function renderOrderSidebarCart() {
    if (!orderSidebarItems) return false;
    const hasItems = hasOrderItems();
    syncOrderItemSelections();
    if (orderSidebarItems.dataset.mode === "cleared" && !hasItems) {
      return true;
    }
    if (orderSidebarItems.dataset.mode === "cleared" && hasItems) {
      orderSidebarItems.dataset.mode = "cart";
    }
    if (!orderSidebarItems.dataset.mode) {
      orderSidebarItems.dataset.mode = "cart";
    }

    const orderItems = getOrderItems();
    if (!orderItems.length) {
      orderSidebarItems.innerHTML =
        '<div class="orderSidebarEmpty">No items added yet</div>';
      setConfirmButtonVisibility(false);
      setConfirmButtonDisabled(true);
      minimizeOrderSidebar();
      return true;
    }

    const itemsHTML = orderItems
      .map(
        (dishName) => `
    <div class="orderSidebarCard">
      <div class="orderItem" data-dish-name="${escapeAttribute(dishName)}">
        <button type="button" class="orderItemSelect${isOrderItemSelected(dishName) ? " is-selected" : ""}" data-dish-name="${escapeAttribute(dishName)}" aria-pressed="${isOrderItemSelected(dishName) ? "true" : "false"}" aria-label="Select ${escapeAttribute(dishName)}"></button>
        <div style="flex:1">
          <div class="orderItemName">${esc(dishName)}</div>
        </div>
        <button type="button" class="orderItemRemove" data-dish-name="${esc(dishName)}">Remove</button>
      </div>
    </div>
  `,
      )
      .join("");
    orderSidebarItems.innerHTML = itemsHTML;

    orderSidebarItems.querySelectorAll(".orderItemRemove").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const dishName = btn.getAttribute("data-dish-name");
        if (dishName) removeDishFromOrder(dishName);
      });
    });
    bindOrderItemSelectButtons(orderSidebarItems);

    updateConfirmButtonVisibility();
    return true;
  }

  return {
    bindOrderItemSelectButtons,
    renderOrderSidebarCart,
  };
}
