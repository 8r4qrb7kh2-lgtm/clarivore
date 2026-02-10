export function createOrderSidebarUiRuntime(options = {}) {
  const state = options.state || {};
  const orderSidebarItems = options.orderSidebarItems || null;
  const orderSidebarActions = options.orderSidebarActions || null;
  const confirmOrderBtn = options.confirmOrderBtn || null;
  const confirmOrderHint = options.confirmOrderHint || null;
  const orderConfirmDrawer = options.orderConfirmDrawer || null;
  const hasOrderItems =
    typeof options.hasOrderItems === "function" ? options.hasOrderItems : () => false;
  const getSelectedOrderItems =
    typeof options.getSelectedOrderItems === "function"
      ? options.getSelectedOrderItems
      : () => [];
  const getSidebarOrders =
    typeof options.getSidebarOrders === "function" ? options.getSidebarOrders : () => [];
  const getActiveOrderCount =
    typeof options.getActiveOrderCount === "function"
      ? options.getActiveOrderCount
      : () => 0;
  const getViewportHeight =
    typeof options.getViewportHeight === "function"
      ? options.getViewportHeight
      : () => (typeof innerHeight === "number" ? innerHeight : 0);
  const onRenderOrderConfirmSummary =
    typeof options.onRenderOrderConfirmSummary === "function"
      ? options.onRenderOrderConfirmSummary
      : () => {};
  const onSidebarUserToggle =
    typeof options.onSidebarUserToggle === "function"
      ? options.onSidebarUserToggle
      : () => {};

  let orderSidebarCustomHeight = null;
  let orderSidebarLastExpandedHeight = null;
  let orderSidebarDragState = null;

  function isOrderSidebarDisabled() {
    return state.page === "editor";
  }

  function hasOrderSidebarContent() {
    const hasItems = hasOrderItems();
    const sidebarOrders = getSidebarOrders();
    return hasItems || (Array.isArray(sidebarOrders) && sidebarOrders.length > 0);
  }

  function setOrderSidebarVisibility() {
    const sidebar = document.getElementById("orderSidebar");
    if (!sidebar) return;
    if (isOrderSidebarDisabled()) {
      sidebar.style.display = "none";
      sidebar.classList.remove("open");
      sidebar.classList.add("minimized");
      document.body.classList.remove("orderSidebarOpen");
      return;
    }
    const hasContent = hasOrderSidebarContent();
    sidebar.style.display = hasContent ? "" : "none";
    if (!hasContent) {
      sidebar.classList.remove("open");
      sidebar.classList.add("minimized");
      document.body.classList.remove("orderSidebarOpen");
    }
  }

  function setOrderSidebarToggleLabel(text) {
    const label = document.getElementById("orderSidebarToggleLabel");
    const toggleBtn = document.getElementById("orderSidebarToggle");
    if (label) {
      label.textContent = text;
      return;
    }
    if (toggleBtn) {
      toggleBtn.textContent = text;
    }
  }

  function updateOrderSidebarBadge() {
    const badge = document.getElementById("orderSidebarBadge");
    if (!badge) return;
    const count = getActiveOrderCount();
    if (count > 0) {
      badge.textContent = String(count);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function setConfirmButtonVisibility(visible) {
    if (confirmOrderBtn) {
      confirmOrderBtn.hidden = !visible;
    }
    if (orderSidebarActions) {
      orderSidebarActions.style.display = visible ? "" : "none";
    }
    if (!visible && confirmOrderHint) {
      confirmOrderHint.hidden = true;
    }
  }

  function setConfirmButtonDisabled(disabled) {
    if (confirmOrderBtn) {
      confirmOrderBtn.disabled = disabled;
    }
    if (confirmOrderHint) {
      const isVisible = !!confirmOrderBtn && !confirmOrderBtn.hidden;
      confirmOrderHint.hidden = !disabled || !isVisible;
    }
  }

  function clampValue(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getOrderSidebarCollapsedHeight() {
    const sidebar = document.getElementById("orderSidebar");
    if (!sidebar) return 72;
    const raw = getComputedStyle(sidebar).getPropertyValue(
      "--order-sidebar-collapsed-height",
    );
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 72;
  }

  function getOrderSidebarHeightBounds(options = {}) {
    const { allowCollapsed = false } = options;
    const viewportHeight = getViewportHeight();
    const collapsedHeight = getOrderSidebarCollapsedHeight();
    const minHeight = allowCollapsed
      ? collapsedHeight
      : Math.max(collapsedHeight + 80, Math.round(viewportHeight * 0.35));
    const maxHeight = Math.max(
      minHeight + 140,
      Math.round(viewportHeight * 0.92),
    );
    return { minHeight, maxHeight };
  }

  function setOrderSidebarHeight(height, persist = true) {
    const sidebar = document.getElementById("orderSidebar");
    if (!sidebar) return;
    if (persist) {
      orderSidebarCustomHeight = height;
    }
    sidebar.style.setProperty("--order-sidebar-height", `${height}px`);
  }

  function updateOrderSidebarHeight() {
    const sidebar = document.getElementById("orderSidebar");
    if (!sidebar) return;
    if (sidebar.classList.contains("minimized")) {
      return;
    }
    const { minHeight, maxHeight } = getOrderSidebarHeightBounds();
    const menuWrap = document.querySelector(".menuWrap");
    let baseHeight = menuWrap ? menuWrap.getBoundingClientRect().height : 0;
    if (!baseHeight || baseHeight < 200) baseHeight = getViewportHeight();
    let targetHeight = orderSidebarCustomHeight;
    if (!targetHeight || Number.isNaN(targetHeight)) {
      targetHeight = Math.round(baseHeight * 0.75);
    }
    targetHeight = clampValue(targetHeight, minHeight, maxHeight);
    setOrderSidebarHeight(targetHeight);
  }

  function minimizeOrderSidebar() {
    const sidebar = document.getElementById("orderSidebar");
    if (!sidebar) return;
    if (isOrderSidebarDisabled()) {
      sidebar.classList.remove("open");
      sidebar.classList.add("minimized");
      document.body.classList.remove("orderSidebarOpen");
      return;
    }
    sidebar.classList.add("minimized");
    sidebar.classList.remove("open");
    setOrderSidebarToggleLabel("+ View order dashboard");
    document.body.classList.remove("orderSidebarOpen");
    updateOrderSidebarHeight();
    updateOrderSidebarBadge();
  }

  function openOrderSidebar() {
    const sidebar = document.getElementById("orderSidebar");
    if (!sidebar) return;
    if (isOrderSidebarDisabled()) {
      setOrderSidebarVisibility();
      return;
    }
    if (!hasOrderSidebarContent()) {
      setOrderSidebarVisibility();
      return;
    }
    sidebar.classList.add("open");
    sidebar.classList.remove("minimized");
    setOrderSidebarToggleLabel("-");
    document.body.classList.add("orderSidebarOpen");
    updateOrderSidebarHeight();
    updateOrderSidebarBadge();
  }

  function initOrderSidebarDrag() {
    const header = document.querySelector(".orderSidebarHeader");
    const sidebar = document.getElementById("orderSidebar");
    if (!header || !sidebar) return;

    const onPointerDown = (event) => {
      if (event.target.closest("button")) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      orderSidebarDragState = {
        startY: event.clientY,
        startHeight: sidebar.getBoundingClientRect().height,
        lastHeight: null,
      };
      orderSidebarLastExpandedHeight =
        orderSidebarCustomHeight || orderSidebarDragState.startHeight;
      sidebar.classList.add("dragging");
      if (header.setPointerCapture) {
        header.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
    };

    const onPointerMove = (event) => {
      if (!orderSidebarDragState) return;
      const delta = orderSidebarDragState.startY - event.clientY;
      const { minHeight, maxHeight } = getOrderSidebarHeightBounds({
        allowCollapsed: true,
      });
      const collapseThreshold = getOrderSidebarCollapsedHeight() + 24;
      let nextHeight = orderSidebarDragState.startHeight + delta;
      nextHeight = clampValue(nextHeight, minHeight, maxHeight);
      orderSidebarDragState.lastHeight = nextHeight;
      sidebar.classList.remove("minimized");
      sidebar.classList.add("open");
      document.body.classList.add("orderSidebarOpen");
      const shouldPersist = nextHeight > collapseThreshold;
      if (shouldPersist) {
        orderSidebarLastExpandedHeight = nextHeight;
      }
      setOrderSidebarHeight(nextHeight, shouldPersist);
      event.preventDefault();
    };

    const onPointerUp = () => {
      if (!orderSidebarDragState) return;
      const finalHeight =
        orderSidebarDragState.lastHeight || orderSidebarDragState.startHeight;
      const collapseThreshold = getOrderSidebarCollapsedHeight() + 24;
      onSidebarUserToggle();
      sidebar.classList.remove("dragging");
      orderSidebarDragState = null;
      if (finalHeight <= collapseThreshold) {
        if (orderSidebarLastExpandedHeight) {
          orderSidebarCustomHeight = orderSidebarLastExpandedHeight;
        }
        minimizeOrderSidebar();
        return;
      }
      setOrderSidebarHeight(finalHeight);
      openOrderSidebar();
    };

    header.addEventListener("pointerdown", onPointerDown);
    header.addEventListener("pointermove", onPointerMove);
    header.addEventListener("pointerup", onPointerUp);
    header.addEventListener("pointercancel", onPointerUp);
  }

  function updateConfirmButtonVisibility() {
    const hasItems = hasOrderItems();
    const clearedMode = orderSidebarItems?.dataset.mode === "cleared";
    if (!hasItems || clearedMode) {
      setConfirmButtonVisibility(false);
      setConfirmButtonDisabled(true);
      return;
    }
    const selectedItems = getSelectedOrderItems();
    setConfirmButtonVisibility(true);
    setConfirmButtonDisabled(selectedItems.length === 0);
  }

  function toggleOrderSidebar() {
    const sidebar = document.getElementById("orderSidebar");
    if (!sidebar || isOrderSidebarDisabled()) return;
    if (!hasOrderSidebarContent()) {
      setOrderSidebarVisibility();
      return;
    }
    onSidebarUserToggle();
    if (sidebar.classList.contains("minimized")) {
      openOrderSidebar();
    } else {
      minimizeOrderSidebar();
    }
  }

  function syncConfirmDrawerSummary() {
    if (orderConfirmDrawer?.classList.contains("show")) {
      onRenderOrderConfirmSummary();
    }
  }

  return {
    isOrderSidebarDisabled,
    hasOrderSidebarContent,
    setOrderSidebarVisibility,
    updateOrderSidebarBadge,
    setConfirmButtonVisibility,
    setConfirmButtonDisabled,
    updateOrderSidebarHeight,
    initOrderSidebarDrag,
    updateConfirmButtonVisibility,
    minimizeOrderSidebar,
    openOrderSidebar,
    toggleOrderSidebar,
    syncConfirmDrawerSummary,
  };
}
