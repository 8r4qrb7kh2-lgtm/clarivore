export function createOrderConfirmTabletRuntime(options = {}) {
  const orderConfirmServerPanel = options.orderConfirmServerPanel || null;
  const orderConfirmKitchenPanel = options.orderConfirmKitchenPanel || null;
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
  const serverPanelState =
    options.serverPanelState && typeof options.serverPanelState === "object"
      ? options.serverPanelState
      : { activeServerId: null };
  const getTabletSimState =
    typeof options.getTabletSimState === "function"
      ? options.getTabletSimState
      : () => ({ orders: [], chefs: [] });
  const ensureOrderServerMetadata =
    typeof options.ensureOrderServerMetadata === "function"
      ? options.ensureOrderServerMetadata
      : (order) => order;
  const getBadgeClassForTone =
    typeof options.getBadgeClassForTone === "function"
      ? options.getBadgeClassForTone
      : () => "orderConfirmDishBadge orderConfirmDishBadge--info";
  const formatOrderListLabel =
    typeof options.formatOrderListLabel === "function"
      ? options.formatOrderListLabel
      : (value) => String(value ?? "");
  const formatTabletTimestamp =
    typeof options.formatTabletTimestamp === "function"
      ? options.formatTabletTimestamp
      : () => "";
  const getTabletOrderById =
    typeof options.getTabletOrderById === "function"
      ? options.getTabletOrderById
      : () => null;
  const persistTabletStateAndRender =
    typeof options.persistTabletStateAndRender === "function"
      ? options.persistTabletStateAndRender
      : () => {};
  const tabletServerApprove =
    typeof options.tabletServerApprove === "function"
      ? options.tabletServerApprove
      : () => {};
  const tabletServerDispatchToKitchen =
    typeof options.tabletServerDispatchToKitchen === "function"
      ? options.tabletServerDispatchToKitchen
      : () => {};
  const tabletServerReject =
    typeof options.tabletServerReject === "function"
      ? options.tabletServerReject
      : () => {};
  const tabletKitchenAcknowledge =
    typeof options.tabletKitchenAcknowledge === "function"
      ? options.tabletKitchenAcknowledge
      : () => {};
  const esc =
    typeof options.esc === "function"
      ? options.esc
      : (value) => String(value ?? "");
  const escapeAttribute =
    typeof options.escapeAttribute === "function"
      ? options.escapeAttribute
      : (value) => String(value ?? "");
  const escapeConfirmationHtml =
    typeof options.escapeConfirmationHtml === "function"
      ? options.escapeConfirmationHtml
      : (value) => String(value ?? "");
  const showAlert =
    typeof options.showAlert === "function"
      ? options.showAlert
      : (message) => {
          if (typeof alert === "function") {
            alert(message);
          }
        };
  const showTextPrompt =
    typeof options.showTextPrompt === "function"
      ? options.showTextPrompt
      : defaultShowTextPrompt;

  function renderOrderConfirmServerPanel() {
    if (!orderConfirmServerPanel) return;
    const body = orderConfirmServerPanel.querySelector(".orderConfirmTabletBody");
    if (!body) return;
    const relevantStatuses = [
      TABLET_ORDER_STATUSES.SUBMITTED_TO_SERVER,
      TABLET_ORDER_STATUSES.QUEUED_FOR_KITCHEN,
      TABLET_ORDER_STATUSES.REJECTED_BY_SERVER,
    ];

    const serverGroups = new Map();
    const simState = getTabletSimState();
    simState.orders.forEach((order) => {
      if (!order?.serverCode) return;
      if (!relevantStatuses.includes(order.status)) return;
      ensureOrderServerMetadata(order);
      const serverId = order.serverId || "0000";
      if (!serverGroups.has(serverId)) {
        serverGroups.set(serverId, []);
      }
      serverGroups.get(serverId).push(order);
    });

    if (serverGroups.size === 0) {
      body.innerHTML =
        '<div class="orderConfirmStatusBadge" data-tone="idle">Waiting for diner</div><p class="orderConfirmEmpty">Share your server code plus their table number when you&rsquo;re ready.</p>';
      return;
    }

    if (
      !serverPanelState.activeServerId ||
      !serverGroups.has(serverPanelState.activeServerId)
    ) {
      serverPanelState.activeServerId = Array.from(serverGroups.keys())[0];
    }

    const tabsHtml = Array.from(serverGroups.entries())
      .map(([serverId, orders]) => {
        const name =
          ensureOrderServerMetadata(orders[0]).serverName || `Server ${serverId}`;
        const isActive = serverId === serverPanelState.activeServerId;
        return `<button type="button" class="orderConfirmServerTab${isActive ? " is-active" : ""}" data-server-tab="${escapeAttribute(serverId)}">${escapeConfirmationHtml(name)}</button>`;
      })
      .join("");

    const activeOrders = serverGroups.get(serverPanelState.activeServerId) || [];
    const orderCards = activeOrders.length
      ? activeOrders.map(renderServerOrderCard).join("")
      : '<p class="serverOrderEmpty">No active notices for this server.</p>';

    body.innerHTML = `
  <div class="orderConfirmServerTabs">${tabsHtml}</div>
  <div class="orderConfirmServerOrders">${orderCards}</div>
    `;
  }

  function renderServerOrderCard(order) {
    ensureOrderServerMetadata(order);
    const descriptor = ORDER_STATUS_DESCRIPTORS[order.status] || {
      label: "Updating status",
      tone: "info",
    };
    const badgeClass = getBadgeClassForTone(descriptor.tone);
    const dishes =
      Array.isArray(order.items) && order.items.length
        ? order.items.map((item) => esc(item)).join(", ")
        : "No dishes listed";
    const allergies =
      Array.isArray(order.allergies) && order.allergies.length
        ? order.allergies.map((a) => formatOrderListLabel(a)).join(", ")
        : "None saved";
    const diets =
      Array.isArray(order.diets) && order.diets.length
        ? order.diets.join(", ")
        : "None saved";
    const tableLabel = order.tableNumber
      ? `Table ${esc(order.tableNumber)}`
      : "Table not recorded";
    const codeLabel = order.serverCode
      ? `Code ${esc(order.serverCode)}`
      : "Code unavailable";
    const notes = order.customNotes
      ? `<div>Notes: ${esc(order.customNotes)}</div>`
      : "";
    let actionsHtml = "";
    if (order.status === TABLET_ORDER_STATUSES.SUBMITTED_TO_SERVER) {
      actionsHtml = `
    <div class="serverOrderActions">
      <button type="button" data-server-action="approve" data-order-id="${escapeAttribute(order.id)}">Approve &amp; send to kitchen</button>
      <button type="button" data-server-action="reject" data-order-id="${escapeAttribute(order.id)}">Reject notice</button>
  </div>`;
    } else if (order.status === TABLET_ORDER_STATUSES.QUEUED_FOR_KITCHEN) {
      actionsHtml = `
    <div class="serverOrderActions">
      <button type="button" data-server-action="dispatch" data-order-id="${escapeAttribute(order.id)}">Send to kitchen</button>
      <button type="button" data-server-action="reject" data-order-id="${escapeAttribute(order.id)}">Reject notice</button>
  </div>`;
    } else if (order.status === TABLET_ORDER_STATUSES.REJECTED_BY_SERVER) {
      actionsHtml =
        '<p class="serverOrderEmpty">Rejected. Waiting for diner updates.</p>';
    } else {
      actionsHtml =
        '<p class="serverOrderEmpty">This notice has moved to the kitchen tablet.</p>';
    }

    return `
  <article class="serverOrderCard" data-order-id="${escapeAttribute(order.id)}">
    <div class="serverOrderHeader">
      <div>
        <div class="serverOrderTitle">${esc(order.customerName || "Guest")}</div>
        <div class="serverOrderMeta">${tableLabel} • ${codeLabel}</div>
        <div class="serverOrderMeta">Dishes: ${dishes}</div>
      </div>
      <span class="${badgeClass}">${escapeConfirmationHtml(descriptor.label)}</span>
    </div>
    <div class="serverOrderDetails">
      <div>Allergies: ${esc(allergies)}</div>
      <div>Diets: ${esc(diets)}</div>
      ${notes}
    </div>
    ${actionsHtml}
  </article>
    `;
  }

  async function handleServerOrderAction(action, orderId) {
    const order = getTabletOrderById(orderId);
    if (!order) return;
    try {
      const simState = getTabletSimState();
      if (action === "approve") {
        tabletServerApprove(simState, orderId);
        tabletServerDispatchToKitchen(simState, orderId);
      } else if (action === "dispatch") {
        tabletServerDispatchToKitchen(simState, orderId);
      } else if (action === "reject") {
        const reason = await showTextPrompt({
          title: "Reject notice",
          message: "Let the diner know why this notice cannot be processed.",
          placeholder:
            "e.g. We need a manager to assist before sending this through.",
          confirmLabel: "Send rejection",
          cancelLabel: "Cancel",
        });
        if (reason === null) return;
        const rejectionReason = reason || "Rejected the notice.";
        tabletServerReject(simState, orderId, rejectionReason);
      } else {
        return;
      }
      persistTabletStateAndRender();
    } catch (error) {
      showAlert(error?.message || "Unable to update server tablet.");
    }
  }

  function renderKitchenOrderCard(order) {
    ensureOrderServerMetadata(order);
    const descriptor = ORDER_STATUS_DESCRIPTORS[order.status] || {
      label: "Updating status",
      tone: "info",
    };
    const badgeClass = getBadgeClassForTone(descriptor.tone);
    const dishes =
      Array.isArray(order.items) && order.items.length
        ? order.items.map((item) => esc(item)).join(", ")
        : "No dishes listed";
    const allergies =
      Array.isArray(order.allergies) && order.allergies.length
        ? order.allergies.map((a) => formatOrderListLabel(a)).join(", ")
        : "None saved";
    const diets =
      Array.isArray(order.diets) && order.diets.length
        ? order.diets.join(", ")
        : "None saved";
    const tableLabel = order.tableNumber
      ? `Table ${esc(order.tableNumber)}`
      : "Table not recorded";
    const messageLog =
      Array.isArray(order.kitchenMessages) && order.kitchenMessages.length
        ? `<div class="kitchenOrderNotes">Messages sent: ${order.kitchenMessages.map((msg) => `${esc(msg.text)} (${formatTabletTimestamp(msg.at)})`).join("; ")}</div>`
        : "";
    const questionLog = order.kitchenQuestion
      ? `<div class="kitchenOrderNotes">Follow-up: ${esc(order.kitchenQuestion.text)}${order.kitchenQuestion.response ? ` • Diner replied ${esc(order.kitchenQuestion.response.toUpperCase())}` : " • Awaiting diner response"}</div>`
      : "";

    const actions = [];
    if (order.status === TABLET_ORDER_STATUSES.WITH_KITCHEN) {
      actions.push(
        `<button type="button" data-kitchen-action="acknowledge" data-order-id="${escapeAttribute(order.id)}">Acknowledge notice</button>`,
      );
    }
    if (order.status !== TABLET_ORDER_STATUSES.ACKNOWLEDGED) {
      actions.push(
        `<button type="button" data-kitchen-action="message" data-order-id="${escapeAttribute(order.id)}">Send follow-up message</button>`,
      );
    }

    const actionsHtml = actions.length
      ? `<div class="kitchenOrderActions">${actions.join("")}</div>`
      : "";

    return `
  <article class="kitchenOrderCard" data-order-id="${escapeAttribute(order.id)}">
    <div class="kitchenOrderHeader">
      <div>
        <div class="kitchenOrderTitle">${esc(order.customerName || "Guest")}</div>
        <div class="kitchenOrderMeta">${tableLabel} • Dishes: ${dishes}</div>
      </div>
      <span class="${badgeClass}">${escapeConfirmationHtml(descriptor.label)}</span>
    </div>
    <div class="kitchenOrderMeta">Allergies: ${esc(allergies)}</div>
    <div class="kitchenOrderMeta">Diets: ${esc(diets)}</div>
    ${messageLog}
    ${questionLog}
    ${actionsHtml}
  </article>
    `;
  }

  function renderOrderConfirmKitchenPanel() {
    if (!orderConfirmKitchenPanel) return;
    const body = orderConfirmKitchenPanel.querySelector(
      ".orderConfirmTabletBody",
    );
    if (!body) return;
    const activeStatuses = [
      TABLET_ORDER_STATUSES.WITH_KITCHEN,
      TABLET_ORDER_STATUSES.ACKNOWLEDGED,
      TABLET_ORDER_STATUSES.AWAITING_USER_RESPONSE,
      TABLET_ORDER_STATUSES.QUESTION_ANSWERED,
    ];
    const simState = getTabletSimState();
    const orders = simState.orders.filter((order) =>
      activeStatuses.includes(order.status),
    );
    if (orders.length === 0) {
      body.innerHTML =
        '<div class="orderConfirmStatusBadge" data-tone="idle">Kitchen idle</div><p class="orderConfirmEmpty">The request will appear here after the server dispatches it.</p>';
      return;
    }
    const cards = orders.map(renderKitchenOrderCard).join("");
    body.innerHTML = `<div class="kitchenOrderList">${cards}</div>`;
  }

  function handleOrderConfirmServerPanel(evt) {
    const tabBtn = evt.target.closest?.("[data-server-tab]");
    if (tabBtn) {
      evt.preventDefault();
      const id = tabBtn.getAttribute("data-server-tab");
      if (id && id !== serverPanelState.activeServerId) {
        serverPanelState.activeServerId = id;
        renderOrderConfirmServerPanel();
      }
      return;
    }
    const actionBtn = evt.target.closest?.("[data-server-action]");
    if (actionBtn) {
      evt.preventDefault();
      const action = actionBtn.getAttribute("data-server-action");
      const orderId = actionBtn.getAttribute("data-order-id");
      if (!action || !orderId) return;
      handleServerOrderAction(action, orderId).catch((error) => {
        console.error("Server action failed", error);
        showAlert("Unable to update server tablet at this time.");
      });
    }
  }

  function handleOrderConfirmKitchenPanel(evt) {
    const actionBtn = evt.target.closest?.("[data-kitchen-action]");
    if (!actionBtn) return;
    evt.preventDefault();
    const action = actionBtn.getAttribute("data-kitchen-action");
    const orderId = actionBtn.getAttribute("data-order-id");
    if (!action || !orderId) return;
    handleKitchenOrderAction(action, orderId).catch((error) => {
      console.error("Kitchen action failed", error);
      showAlert("Unable to update the kitchen tablet right now.");
    });
  }

  async function handleKitchenOrderAction(action, orderId) {
    const order = getTabletOrderById(orderId);
    if (!order) return;
    try {
      const simState = getTabletSimState();
      if (action === "acknowledge") {
        const chefId = simState.chefs[0]?.id || null;
        if (!chefId) throw new Error("No chefs available.");
        tabletKitchenAcknowledge(simState, orderId, chefId);
      } else if (action === "message") {
        const text = await showTextPrompt({
          title: "Send follow-up message",
          message: "What would you like the diner to see on their side?",
          placeholder:
            "e.g. Please confirm if sesame oil is okay before we proceed.",
          confirmLabel: "Send message",
          cancelLabel: "Cancel",
        });
        if (!text) return;
        recordKitchenMessage(order, text);
      } else {
        return;
      }
      persistTabletStateAndRender();
    } catch (error) {
      throw error;
    }
  }

  function recordKitchenMessage(order, message) {
    if (!order || !message?.trim()) return;
    const text = message.trim();
    const entry = {
      text,
      at: new Date().toISOString(),
    };
    if (!Array.isArray(order.kitchenMessages)) {
      order.kitchenMessages = [];
    }
    order.kitchenMessages.push(entry);
    if (!Array.isArray(order.history)) {
      order.history = [];
    }
    order.history.push({
      actor: "Kitchen",
      message: `Sent message to diner: "${text}"`,
      at: entry.at,
    });
    order.status = TABLET_ORDER_STATUSES.AWAITING_USER_RESPONSE;
    order.updatedAt = entry.at;
  }

  function defaultShowTextPrompt({
    title = "Input",
    message = "",
    placeholder = "",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
  } = {}) {
    if (typeof document === "undefined") {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "appPromptBackdrop";
      const modal = document.createElement("div");
      modal.className = "appPromptModal";
      const heading = document.createElement("h3");
      heading.textContent = title;
      modal.appendChild(heading);
      if (message) {
        const desc = document.createElement("p");
        desc.textContent = message;
        modal.appendChild(desc);
      }
      const textarea = document.createElement("textarea");
      textarea.placeholder = placeholder;
      modal.appendChild(textarea);
      const actions = document.createElement("div");
      actions.className = "appPromptModalActions";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "appPromptCancel";
      cancelBtn.textContent = cancelLabel;
      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "appPromptConfirm";
      confirmBtn.textContent = confirmLabel;
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      modal.appendChild(actions);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      const cleanup = () => {
        backdrop.remove();
      };

      cancelBtn.addEventListener("click", () => {
        cleanup();
        resolve(null);
      });
      confirmBtn.addEventListener("click", () => {
        const value = textarea.value.trim();
        cleanup();
        resolve(value);
      });
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) {
          cleanup();
          resolve(null);
        }
      });
      textarea.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cleanup();
          resolve(null);
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          const value = textarea.value.trim();
          cleanup();
          resolve(value);
        }
      });
      setTimeout(() => textarea.focus(), 50);
    });
  }

  return {
    renderOrderConfirmServerPanel,
    renderOrderConfirmKitchenPanel,
    handleOrderConfirmServerPanel,
    handleOrderConfirmKitchenPanel,
  };
}
