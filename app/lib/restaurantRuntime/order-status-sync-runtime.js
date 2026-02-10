export function createOrderStatusSyncRuntime(options = {}) {
  const getCurrentRestaurantId =
    typeof options.getCurrentRestaurantId === "function"
      ? options.getCurrentRestaurantId
      : () => null;
  const isEditorPage =
    typeof options.isEditorPage === "function" ? options.isEditorPage : () => false;
  const fetchOrdersForRestaurant =
    typeof options.fetchOrdersForRestaurant === "function"
      ? options.fetchOrdersForRestaurant
      : async () => [];
  const getDismissedOrderIds =
    typeof options.getDismissedOrderIds === "function"
      ? options.getDismissedOrderIds
      : () => [];
  const isOrderActiveForBadge =
    typeof options.isOrderActiveForBadge === "function"
      ? options.isOrderActiveForBadge
      : () => false;
  const pickMostRecentOrder =
    typeof options.pickMostRecentOrder === "function"
      ? options.pickMostRecentOrder
      : () => null;
  const handleNoticeUpdates =
    typeof options.handleNoticeUpdates === "function"
      ? options.handleNoticeUpdates
      : () => {};
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
  const persistTabletStateSnapshot =
    typeof options.persistTabletStateSnapshot === "function"
      ? options.persistTabletStateSnapshot
      : () => {};
  const renderOrderSidebarStatus =
    typeof options.renderOrderSidebarStatus === "function"
      ? options.renderOrderSidebarStatus
      : () => {};
  const updateOrderSidebarBadge =
    typeof options.updateOrderSidebarBadge === "function"
      ? options.updateOrderSidebarBadge
      : () => {};
  const minimizeOrderSidebar =
    typeof options.minimizeOrderSidebar === "function"
      ? options.minimizeOrderSidebar
      : () => {};
  const onActiveOrderDetected =
    typeof options.onActiveOrderDetected === "function"
      ? options.onActiveOrderDetected
      : () => {};
  const logError =
    typeof options.logError === "function"
      ? options.logError
      : (message, error) => {
          console.error(message, error);
        };
  const setIntervalFn =
    typeof options.setInterval === "function" ? options.setInterval : setInterval;
  const clearIntervalFn =
    typeof options.clearInterval === "function"
      ? options.clearInterval
      : clearInterval;
  const refreshIntervalMs =
    Number.isFinite(options.refreshIntervalMs) && options.refreshIntervalMs > 0
      ? options.refreshIntervalMs
      : 15000;

  let orderRefreshTimerId = null;

  function scopeOrdersToCurrentRestaurant(options = {}) {
    const shouldPersist = options.persist !== false;
    const restaurantId = getCurrentRestaurantId();
    if (!restaurantId) {
      return { restaurantId: null };
    }

    const scopedOrders = getOrders().filter((order) => {
      if (!order || !order.restaurantId) return false;
      return order.restaurantId === restaurantId;
    });
    setOrders(scopedOrders);

    const currentOrderId = getCurrentOrderId();
    if (currentOrderId) {
      const currentOrder = scopedOrders.find((order) => order.id === currentOrderId);
      if (
        !currentOrder ||
        (currentOrder.restaurantId && currentOrder.restaurantId !== restaurantId)
      ) {
        setCurrentOrderId(null);
        stopOrderRefresh();
      }
    }

    if (shouldPersist) {
      persistTabletStateSnapshot();
    }

    return { restaurantId };
  }

  async function checkForActiveOrders() {
    try {
      if (isEditorPage()) return;
      const { restaurantId } = scopeOrdersToCurrentRestaurant({ persist: false });
      if (!restaurantId) return;

      const orders = await fetchOrdersForRestaurant(restaurantId);
      const dismissed = getDismissedOrderIds();
      const filteredOrders = orders.filter((order) => !dismissed.includes(order.id));
      setOrders(filteredOrders);
      handleNoticeUpdates(filteredOrders);

      const activeOrders = filteredOrders.filter((order) =>
        isOrderActiveForBadge(order),
      );
      const activeOrder = pickMostRecentOrder(activeOrders);

      if (activeOrder) {
        setCurrentOrderId(activeOrder.id);
        persistTabletStateSnapshot();
        onActiveOrderDetected(activeOrder);
        renderOrderSidebarStatus(activeOrder);
        minimizeOrderSidebar();
        startOrderRefresh();
      } else {
        setCurrentOrderId(null);
        stopOrderRefresh();
        renderOrderSidebarStatus(null);
      }

      updateOrderSidebarBadge();
    } catch (error) {
      logError("Failed to check for active orders", error);
    }
  }

  async function refreshOrderStatus() {
    try {
      const restaurantId = getCurrentRestaurantId();
      if (!restaurantId) return;

      const orders = await fetchOrdersForRestaurant(restaurantId);
      const dismissed = getDismissedOrderIds();
      const filteredOrders = orders.filter((order) => !dismissed.includes(order.id));
      setOrders(filteredOrders);
      handleNoticeUpdates(filteredOrders);

      const activeOrders = filteredOrders.filter((order) =>
        isOrderActiveForBadge(order),
      );

      const currentOrderId = getCurrentOrderId();
      let targetOrder = currentOrderId
        ? filteredOrders.find((order) => order.id === currentOrderId)
        : null;

      if (!targetOrder || !isOrderActiveForBadge(targetOrder)) {
        targetOrder = pickMostRecentOrder(activeOrders);
        if (targetOrder) {
          setCurrentOrderId(targetOrder.id);
          if (!orderRefreshTimerId) {
            startOrderRefresh();
          }
        } else if (currentOrderId) {
          setCurrentOrderId(null);
          stopOrderRefresh();
        }
      }

      persistTabletStateSnapshot();
      if (targetOrder) {
        renderOrderSidebarStatus(targetOrder);
      } else {
        renderOrderSidebarStatus(null);
      }
      updateOrderSidebarBadge();
    } catch (error) {
      logError("Failed to refresh order status", error);
    }
  }

  function startOrderRefresh() {
    stopOrderRefresh();
    if (!getCurrentOrderId()) return;
    orderRefreshTimerId = setIntervalFn(() => {
      refreshOrderStatus().catch((error) => {
        logError("[order-refresh] periodic refresh failed", error);
      });
    }, refreshIntervalMs);
  }

  function stopOrderRefresh() {
    if (orderRefreshTimerId) {
      clearIntervalFn(orderRefreshTimerId);
      orderRefreshTimerId = null;
    }
  }

  return {
    scopeOrdersToCurrentRestaurant,
    checkForActiveOrders,
    refreshOrderStatus,
    startOrderRefresh,
    stopOrderRefresh,
  };
}
