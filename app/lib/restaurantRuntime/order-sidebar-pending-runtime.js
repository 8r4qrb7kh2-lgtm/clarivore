export function createOrderSidebarPendingRuntime(options = {}) {
  const orderSidebarItems = options.orderSidebarItems || null;
  const ORDER_STATUS_DESCRIPTORS =
    options.ORDER_STATUS_DESCRIPTORS &&
    typeof options.ORDER_STATUS_DESCRIPTORS === "object"
      ? options.ORDER_STATUS_DESCRIPTORS
      : {};
  const TABLET_ORDER_STATUSES =
    options.TABLET_ORDER_STATUSES &&
    typeof options.TABLET_ORDER_STATUSES === "object"
      ? options.TABLET_ORDER_STATUSES
      : {};
  const esc = typeof options.esc === "function" ? options.esc : (value) => String(value ?? "");
  const escapeAttribute =
    typeof options.escapeAttribute === "function"
      ? options.escapeAttribute
      : (value) => String(value ?? "");
  const escapeConfirmationHtml =
    typeof options.escapeConfirmationHtml === "function"
      ? options.escapeConfirmationHtml
      : (value) => String(value ?? "");
  const formatOrderListLabel =
    typeof options.formatOrderListLabel === "function"
      ? options.formatOrderListLabel
      : (value) => String(value ?? "");
  const getBadgeClassForTone =
    typeof options.getBadgeClassForTone === "function"
      ? options.getBadgeClassForTone
      : () => "orderSidebarBadgeIdle";
  const formatTabletTimestamp =
    typeof options.formatTabletTimestamp === "function"
      ? options.formatTabletTimestamp
      : () => "";
  const getKitchenQuestion =
    typeof options.getKitchenQuestion === "function"
      ? options.getKitchenQuestion
      : () => null;
  const shouldShowClearOrderButton =
    typeof options.shouldShowClearOrderButton === "function"
      ? options.shouldShowClearOrderButton
      : () => false;
  const getRescindConfirmOrderId =
    typeof options.getRescindConfirmOrderId === "function"
      ? options.getRescindConfirmOrderId
      : () => null;
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
  const updateConfirmButtonVisibility =
    typeof options.updateConfirmButtonVisibility === "function"
      ? options.updateConfirmButtonVisibility
      : () => {};
  const removeDishFromOrder =
    typeof options.removeDishFromOrder === "function"
      ? options.removeDishFromOrder
      : () => {};
  const bindOrderItemSelectButtons =
    typeof options.bindOrderItemSelectButtons === "function"
      ? options.bindOrderItemSelectButtons
      : () => {};
  const handleRescindNotice =
    typeof options.handleRescindNotice === "function"
      ? options.handleRescindNotice
      : () => {};
  const handleRescindConfirm =
    typeof options.handleRescindConfirm === "function"
      ? options.handleRescindConfirm
      : () => {};
  const handleRescindCancel =
    typeof options.handleRescindCancel === "function"
      ? options.handleRescindCancel
      : () => {};
  const handleClearOrderFromSidebar =
    typeof options.handleClearOrderFromSidebar === "function"
      ? options.handleClearOrderFromSidebar
      : () => {};
  const handleKitchenQuestionResponse =
    typeof options.handleKitchenQuestionResponse === "function"
      ? options.handleKitchenQuestionResponse
      : () => {};

  function getOrderTimestamps(order) {
    const history = Array.isArray(order.history) ? order.history : [];
    const submittedEntry = history.find(
      (entry) =>
        entry.message &&
        (entry.message.includes("Submitted") || entry.message.includes("submitted")),
    );
    const submittedTime =
      submittedEntry?.at || order.updatedAt || order.createdAt;
    const updates = history
      .filter((entry) => entry.at && entry.at !== submittedTime)
      .map((entry) => ({
        actor: entry.actor || "System",
        message: entry.message || "Status update",
        at: entry.at,
      }));
    return { submittedTime, updates };
  }

  function buildOrderSidebarPendingOrderHtml(order) {
    const submittedItems =
      Array.isArray(order.items) && order.items.length ? order.items : [];
    const dishName = submittedItems.length
      ? submittedItems.join(", ")
      : "No dishes recorded";
    const allergens =
      Array.isArray(order.allergies) && order.allergies.length
        ? order.allergies.map((item) => formatOrderListLabel(item)).join(", ")
        : "None";
    const diets =
      Array.isArray(order.diets) && order.diets.length
        ? order.diets.map((item) => formatOrderListLabel(item)).join(", ")
        : "None";
    const metaParts = [];
    if (order.tableNumber) {
      metaParts.push(`Table ${esc(order.tableNumber)}`);
    }
    if (order.serverCode) {
      metaParts.push(`Code ${esc(order.serverCode)}`);
    }
    const metaLine = metaParts.length
      ? metaParts.join(" • ")
      : "Awaiting table assignment";
    const descriptor = ORDER_STATUS_DESCRIPTORS[order.status] || {
      label: order.status,
      tone: "idle",
    };
    const badgeClass = getBadgeClassForTone(descriptor?.tone || "idle");
    const { submittedTime, updates } = getOrderTimestamps(order);
    const submittedTimeStr = submittedTime
      ? formatTabletTimestamp(submittedTime)
      : "";
    const nonDinerUpdates = updates.filter((update) => update.actor !== "Diner");
    const updatesHtml =
      nonDinerUpdates.length > 0
        ? `
  <div class="orderSidebarTimestamps">
    ${nonDinerUpdates.map((update) => `<div class="orderSidebarTimestamp"><span class="orderSidebarTimestampActor">${esc(update.actor)}:</span> ${esc(update.message)} <span class="orderSidebarTimestampTime">${formatTabletTimestamp(update.at)}</span></div>`).join("")}
  </div>
    `
        : "";
    const kitchenQuestion = getKitchenQuestion(order);
    const hasKitchenQuestion =
      kitchenQuestion && !kitchenQuestion.response;
    const kitchenQuestionHtml = hasKitchenQuestion
      ? `
  <div class="orderSidebarKitchenQuestion">
    <div class="orderSidebarKitchenQuestionLabel">Kitchen Question</div>
    <div class="orderSidebarKitchenQuestionText">${esc(kitchenQuestion.text)}</div>
    <div class="orderSidebarKitchenQuestionActions">
      <button type="button" class="orderSidebarQuestionBtn orderSidebarQuestionYes" data-order-id="${escapeAttribute(order.id)}" data-response="yes">Yes</button>
      <button type="button" class="orderSidebarQuestionBtn orderSidebarQuestionNo" data-order-id="${escapeAttribute(order.id)}" data-response="no">No</button>
    </div>
  </div>
    `
      : "";
    const showClearBtn = shouldShowClearOrderButton(order);
    const showRescindConfirm =
      !showClearBtn && getRescindConfirmOrderId() === order.id;
    const actionBtnHtml = showClearBtn
      ? `<button type="button" class="orderSidebarClearBtn" data-order-id="${escapeAttribute(order.id)}">Clear from dashboard</button>`
      : showRescindConfirm
        ? `
    <div class="orderSidebarRescindConfirm">
      <div class="orderSidebarRescindPrompt">Rescind this notice? This will cancel the allergy notice submission.</div>
      <div class="orderSidebarRescindActions">
        <button type="button" class="orderSidebarRescindConfirmBtn" data-order-id="${escapeAttribute(order.id)}">Yes, rescind</button>
        <button type="button" class="orderSidebarRescindCancelBtn" data-order-id="${escapeAttribute(order.id)}">Keep notice</button>
      </div>
    </div>
  `
        : `<button type="button" class="orderSidebarRescindBtn" data-order-id="${escapeAttribute(order.id)}">Rescind notice</button>`;
    const isRescinded =
      order.status === TABLET_ORDER_STATUSES.RESCINDED_BY_DINER;
    const statusLabel = isRescinded ? "Notice rescinded" : "Submitted Notice";
    const statusMeta = isRescinded
      ? "Your allergy notice has been rescinded."
      : metaLine;

    return `
  <div class="orderSidebarCard orderSidebarPendingCard" data-order-id="${escapeAttribute(order.id)}">
    <div class="orderSidebarPendingLabel">${statusLabel}</div>
    <div class="orderSidebarPendingMeta">${statusMeta}</div>
    <div class="orderSidebarPendingBadge">
      <span class="${badgeClass}">${escapeConfirmationHtml(descriptor.label || "Updating status")}</span>
    </div>
    <div class="orderSidebarPendingMeta"><strong>Order:</strong> ${esc(dishName)}</div>
    <div class="orderSidebarPendingMeta"><strong>Allergens:</strong> ${esc(allergens)}</div>
    <div class="orderSidebarPendingMeta"><strong>Diets:</strong> ${esc(diets)}</div>
    ${submittedTimeStr ? `<div class="orderSidebarTimestamp"><span class="orderSidebarTimestampActor">Diner:</span> notice submitted <span class="orderSidebarTimestampTime">${submittedTimeStr}</span></div>` : ""}
    ${kitchenQuestionHtml}
    ${updatesHtml}
    ${actionBtnHtml}
  </div>
    `;
  }

  function renderOrderSidebarPendingOrders(orders) {
    if (!orderSidebarItems) return;
    syncOrderItemSelections();
    orderSidebarItems.dataset.mode = orders.length ? "pending" : "cart";
    const cartItems = getOrderItems();
    const cartItemsHtml = cartItems.length
      ? `
  <div class="orderSidebarCard">
    <div class="orderSidebarPendingLabel">New items</div>
    ${cartItems
      .map(
        (itemName) => `
      <div class="orderItem" data-dish-name="${escapeAttribute(itemName)}">
        <button type="button" class="orderItemSelect${isOrderItemSelected(itemName) ? " is-selected" : ""}" data-dish-name="${escapeAttribute(itemName)}" aria-pressed="${isOrderItemSelected(itemName) ? "true" : "false"}" aria-label="Select ${escapeAttribute(itemName)}"></button>
        <div style="flex:1">
          <div class="orderItemName">${esc(itemName)}</div>
        </div>
        <button type="button" class="orderItemRemove" data-dish-name="${esc(itemName)}">Remove</button>
      </div>
    `,
      )
      .join("")}
  </div>
    `
      : "";
    const ordersHtml = orders.map(buildOrderSidebarPendingOrderHtml).join("");
    orderSidebarItems.innerHTML = `${ordersHtml}${cartItemsHtml}`;
    updateConfirmButtonVisibility();
    if (cartItems.length > 0) {
      orderSidebarItems.querySelectorAll(".orderItemRemove").forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const dishName = btn.getAttribute("data-dish-name");
          if (dishName) removeDishFromOrder(dishName);
        });
      });
      bindOrderItemSelectButtons(orderSidebarItems);
    }
    orderSidebarItems
      .querySelectorAll(".orderSidebarRescindBtn")
      .forEach((btn) => {
        btn.addEventListener("click", handleRescindNotice);
      });
    orderSidebarItems
      .querySelectorAll(".orderSidebarRescindConfirmBtn")
      .forEach((btn) => {
        btn.addEventListener("click", handleRescindConfirm);
      });
    orderSidebarItems
      .querySelectorAll(".orderSidebarRescindCancelBtn")
      .forEach((btn) => {
        btn.addEventListener("click", handleRescindCancel);
      });
    orderSidebarItems.querySelectorAll(".orderSidebarClearBtn").forEach((btn) => {
      btn.addEventListener("click", handleClearOrderFromSidebar);
    });
    orderSidebarItems
      .querySelectorAll(".orderSidebarQuestionBtn")
      .forEach((btn) => {
        btn.addEventListener("click", handleKitchenQuestionResponse);
      });
  }

  return {
    renderOrderSidebarPendingOrders,
  };
}
