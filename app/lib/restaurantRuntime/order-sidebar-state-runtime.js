export function createOrderSidebarStateRuntime(options = {}) {
  const TABLET_ORDER_STATUSES =
    options.TABLET_ORDER_STATUSES &&
    typeof options.TABLET_ORDER_STATUSES === "object"
      ? options.TABLET_ORDER_STATUSES
      : {};
  const dismissedStorageKey =
    typeof options.dismissedStorageKey === "string" && options.dismissedStorageKey
      ? options.dismissedStorageKey
      : "orderSidebarDismissedOrders";
  const openAfterSubmitStorageKey =
    typeof options.openAfterSubmitStorageKey === "string" &&
    options.openAfterSubmitStorageKey
      ? options.openAfterSubmitStorageKey
      : "orderSidebarOpenAfterSubmit";

  const getCurrentRestaurantId =
    typeof options.getCurrentRestaurantId === "function"
      ? options.getCurrentRestaurantId
      : () => null;
  const getOrders =
    typeof options.getOrders === "function" ? options.getOrders : () => [];
  const setOrders =
    typeof options.setOrders === "function" ? options.setOrders : () => {};
  const getCurrentOrderId =
    typeof options.getCurrentOrderId === "function"
      ? options.getCurrentOrderId
      : () => null;
  const setCurrentOrderId =
    typeof options.setCurrentOrderId === "function"
      ? options.setCurrentOrderId
      : () => {};
  const onStopOrderRefresh =
    typeof options.onStopOrderRefresh === "function"
      ? options.onStopOrderRefresh
      : () => {};
  const onPersistSnapshot =
    typeof options.onPersistSnapshot === "function"
      ? options.onPersistSnapshot
      : () => {};
  const onUpdateSidebarBadge =
    typeof options.onUpdateSidebarBadge === "function"
      ? options.onUpdateSidebarBadge
      : () => {};
  const onOpenSidebar =
    typeof options.onOpenSidebar === "function" ? options.onOpenSidebar : () => {};
  const onMinimizeSidebar =
    typeof options.onMinimizeSidebar === "function"
      ? options.onMinimizeSidebar
      : () => {};
  const getSidebarMode =
    typeof options.getSidebarMode === "function" ? options.getSidebarMode : () => "";
  const hasOrderItems =
    typeof options.hasOrderItems === "function" ? options.hasOrderItems : () => false;
  const getOrderItems =
    typeof options.getOrderItems === "function" ? options.getOrderItems : () => [];

  let orderSidebarUserToggled = false;
  let orderSidebarLastOrderId = null;
  let orderSidebarAutoMinimizedOrderId = null;
  let orderSidebarForceOpenOrderId = null;

  function getDismissedOrderIds() {
    try {
      const raw = localStorage.getItem(dismissedStorageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((id) => typeof id === "string" && id);
    } catch (error) {
      console.warn("Failed to read dismissed order ids", error);
      return [];
    }
  }

  function setDismissedOrderIds(ids) {
    try {
      const unique = Array.from(
        new Set(ids.filter((id) => typeof id === "string" && id)),
      );
      const trimmed = unique.slice(-25);
      localStorage.setItem(dismissedStorageKey, JSON.stringify(trimmed));
    } catch (error) {
      console.warn("Failed to store dismissed order ids", error);
    }
  }

  function dismissOrderId(orderId) {
    if (!orderId) return;
    const ids = getDismissedOrderIds();
    if (!ids.includes(orderId)) {
      ids.push(orderId);
      setDismissedOrderIds(ids);
    }
    onUpdateSidebarBadge();
  }

  function pruneDismissedOrders() {
    const dismissed = getDismissedOrderIds();
    if (!dismissed.length) return dismissed;
    const orders = getOrders();
    const filtered = orders.filter((order) => !dismissed.includes(order.id));
    if (filtered.length !== orders.length) {
      setOrders(filtered);
      if (getCurrentOrderId() && dismissed.includes(getCurrentOrderId())) {
        setCurrentOrderId(null);
        onStopOrderRefresh();
      }
      onPersistSnapshot();
    }
    return dismissed;
  }

  function getOrderSidebarOpenAfterSubmitId() {
    try {
      const raw = localStorage.getItem(openAfterSubmitStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.orderId !== "string") return null;
      return parsed.orderId;
    } catch (error) {
      console.warn("Failed to read sidebar open-after-submit state", error);
      return null;
    }
  }

  function setOrderSidebarOpenAfterSubmit(orderId) {
    if (!orderId) return;
    try {
      localStorage.setItem(
        openAfterSubmitStorageKey,
        JSON.stringify({
          orderId,
          at: Date.now(),
        }),
      );
    } catch (error) {
      console.warn("Failed to store sidebar open-after-submit state", error);
    }
  }

  function clearOrderSidebarOpenAfterSubmit() {
    try {
      localStorage.removeItem(openAfterSubmitStorageKey);
    } catch (error) {
      console.warn("Failed to clear sidebar open-after-submit state", error);
    }
  }

  function resetOrderSidebarAutoState() {
    orderSidebarUserToggled = false;
    orderSidebarLastOrderId = null;
    orderSidebarAutoMinimizedOrderId = null;
  }

  function markSidebarUserToggled() {
    orderSidebarUserToggled = true;
  }

  function forceOpenForOrder(orderId) {
    if (!orderId) return;
    setOrderSidebarOpenAfterSubmit(orderId);
    orderSidebarForceOpenOrderId = orderId;
    orderSidebarUserToggled = true;
  }

  function isOrderActiveForBadge(order) {
    if (!order || !order.id) return false;
    if (
      TABLET_ORDER_STATUSES.DRAFT &&
      order.status === TABLET_ORDER_STATUSES.DRAFT
    ) {
      return false;
    }
    if (order.status === TABLET_ORDER_STATUSES.CODE_ASSIGNED) return false;
    if (order.status === TABLET_ORDER_STATUSES.RESCINDED_BY_DINER) return false;
    if (order.status === TABLET_ORDER_STATUSES.REJECTED_BY_SERVER) return false;
    if (order.status === TABLET_ORDER_STATUSES.REJECTED_BY_KITCHEN) return false;
    return true;
  }

  function isActiveOrder(order) {
    return isOrderActiveForBadge(order);
  }

  function shouldShowClearOrderButton(order) {
    if (!order) return false;
    return (
      order.status === TABLET_ORDER_STATUSES.ACKNOWLEDGED ||
      order.status === TABLET_ORDER_STATUSES.QUESTION_ANSWERED ||
      order.status === TABLET_ORDER_STATUSES.REJECTED_BY_SERVER ||
      order.status === TABLET_ORDER_STATUSES.REJECTED_BY_KITCHEN ||
      order.status === TABLET_ORDER_STATUSES.RESCINDED_BY_DINER
    );
  }

  function maybeAutoMinimizeSidebar(order) {
    const orderId = order?.id || null;
    if (!orderSidebarForceOpenOrderId) {
      orderSidebarForceOpenOrderId = getOrderSidebarOpenAfterSubmitId();
    }
    if (orderId !== orderSidebarLastOrderId) {
      orderSidebarUserToggled = false;
      orderSidebarAutoMinimizedOrderId = null;
      orderSidebarLastOrderId = orderId;
    }
    if (orderId && orderSidebarForceOpenOrderId === orderId) {
      orderSidebarUserToggled = true;
      onOpenSidebar();
      orderSidebarForceOpenOrderId = null;
      clearOrderSidebarOpenAfterSubmit();
      return;
    }
    if (!isActiveOrder(order)) return;
    if (orderSidebarUserToggled) return;
    if (orderSidebarAutoMinimizedOrderId === orderId) return;
    onMinimizeSidebar();
    orderSidebarAutoMinimizedOrderId = orderId;
  }

  function isSidebarOrderVisible(order) {
    if (!order || !order.id) return false;
    if (order.status === TABLET_ORDER_STATUSES.CODE_ASSIGNED) return false;
    if (
      TABLET_ORDER_STATUSES.DRAFT &&
      order.status === TABLET_ORDER_STATUSES.DRAFT
    ) {
      return false;
    }
    return true;
  }

  function getOrderSortValue(order) {
    if (!order) return 0;
    const candidates = [order.updatedAt, order.submittedAt, order.createdAt];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate;
      }
      const parsed = Date.parse(candidate);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return 0;
  }

  function pickMostRecentOrder(orders) {
    if (!Array.isArray(orders) || orders.length === 0) return null;
    const sorted = orders
      .slice()
      .sort((a, b) => getOrderSortValue(b) - getOrderSortValue(a));
    return sorted[0] || null;
  }

  function getSidebarOrders() {
    const restaurantId = getCurrentRestaurantId();
    const dismissed = pruneDismissedOrders();
    const orders = getOrders();
    return orders
      .filter((order) => {
        if (!order || !order.id) return false;
        if (!isSidebarOrderVisible(order)) return false;
        if (
          restaurantId &&
          order.restaurantId &&
          order.restaurantId !== restaurantId
        ) {
          return false;
        }
        if (restaurantId && !order.restaurantId) return false;
        if (dismissed.includes(order.id)) return false;
        return true;
      })
      .sort((a, b) => getOrderSortValue(b) - getOrderSortValue(a));
  }

  function getActiveOrderCount() {
    const restaurantId = getCurrentRestaurantId();
    const dismissed = getDismissedOrderIds();
    const orders = getOrders();
    const activeOrders = orders.filter((order) => {
      if (!order || !order.id) return false;
      if (
        restaurantId &&
        order.restaurantId &&
        order.restaurantId !== restaurantId
      ) {
        return false;
      }
      if (dismissed.includes(order.id)) return false;
      return isOrderActiveForBadge(order);
    });

    const isCleared = getSidebarMode() === "cleared";
    const cartCount = hasOrderItems() && !isCleared ? getOrderItems().length : 0;

    if (activeOrders.length > 0) {
      const submittedCount = activeOrders.reduce((sum, order) => {
        const count =
          Array.isArray(order.items) && order.items.length
            ? order.items.length
            : 1;
        return sum + count;
      }, 0);
      return submittedCount + cartCount;
    }
    return cartCount;
  }

  return {
    getDismissedOrderIds,
    setDismissedOrderIds,
    dismissOrderId,
    pruneDismissedOrders,
    getOrderSidebarOpenAfterSubmitId,
    setOrderSidebarOpenAfterSubmit,
    clearOrderSidebarOpenAfterSubmit,
    resetOrderSidebarAutoState,
    markSidebarUserToggled,
    forceOpenForOrder,
    isActiveOrder,
    shouldShowClearOrderButton,
    maybeAutoMinimizeSidebar,
    isSidebarOrderVisible,
    getOrderSortValue,
    pickMostRecentOrder,
    isOrderActiveForBadge,
    getSidebarOrders,
    getActiveOrderCount,
  };
}
