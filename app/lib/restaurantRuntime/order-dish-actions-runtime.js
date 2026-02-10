export function createOrderDishActionsRuntime(options = {}) {
  const getOrderItems =
    typeof options.getOrderItems === "function" ? options.getOrderItems : () => [];
  const writeOrderItems =
    typeof options.writeOrderItems === "function" ? options.writeOrderItems : () => {};
  const getOrderItemSelections =
    typeof options.getOrderItemSelections === "function"
      ? options.getOrderItemSelections
      : () => new Set();
  const getDishCompatibilityDetails =
    typeof options.getDishCompatibilityDetails === "function"
      ? options.getDishCompatibilityDetails
      : () => ({ issues: {} });
  const hasBlockingCompatibilityIssues =
    typeof options.hasBlockingCompatibilityIssues === "function"
      ? options.hasBlockingCompatibilityIssues
      : () => false;
  const persistOrderItems =
    typeof options.persistOrderItems === "function"
      ? options.persistOrderItems
      : () => {};
  const syncOrderItemSelections =
    typeof options.syncOrderItemSelections === "function"
      ? options.syncOrderItemSelections
      : () => {};
  const updateOrderSidebar =
    typeof options.updateOrderSidebar === "function"
      ? options.updateOrderSidebar
      : () => {};
  const openOrderSidebar =
    typeof options.openOrderSidebar === "function"
      ? options.openOrderSidebar
      : () => {};
  const closeDishDetailsAfterAdd =
    typeof options.closeDishDetailsAfterAdd === "function"
      ? options.closeDishDetailsAfterAdd
      : () => {};
  const onAfterRemoveDish =
    typeof options.onAfterRemoveDish === "function"
      ? options.onAfterRemoveDish
      : () => {};

  function addDishToOrder(dishName, options = {}) {
    const orderItems = getOrderItems();
    if (orderItems.includes(dishName)) {
      return { success: false, message: "already-added" };
    }

    const force = !!options.force;
    const details = getDishCompatibilityDetails(dishName);
    const hasBlockingIssues = hasBlockingCompatibilityIssues(details);
    if (hasBlockingIssues && !force) {
      return {
        success: false,
        needsConfirmation: true,
        issues: details.issues,
      };
    }

    orderItems.push(dishName);
    writeOrderItems(orderItems);
    persistOrderItems();
    updateOrderSidebar();
    openOrderSidebar();
    closeDishDetailsAfterAdd();
    return { success: true };
  }

  function removeDishFromOrder(dishName) {
    const orderItems = getOrderItems();
    const index = orderItems.indexOf(dishName);
    if (index > -1) {
      orderItems.splice(index, 1);
      writeOrderItems(orderItems);
      getOrderItemSelections().delete(dishName);
      persistOrderItems();
      syncOrderItemSelections();
      updateOrderSidebar();
      onAfterRemoveDish(dishName);
    }
  }

  return {
    addDishToOrder,
    removeDishFromOrder,
  };
}
