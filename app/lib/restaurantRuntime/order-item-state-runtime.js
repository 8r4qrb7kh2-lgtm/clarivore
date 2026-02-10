export function createOrderItemStateRuntime(options = {}) {
  const state = options.state || {};
  const getGlobalSlug =
    typeof options.getGlobalSlug === "function" ? options.getGlobalSlug : () => "";
  const readOrderItems =
    typeof options.readOrderItems === "function" ? options.readOrderItems : () => [];
  const writeOrderItems =
    typeof options.writeOrderItems === "function" ? options.writeOrderItems : () => [];
  const readOrderItemSelections =
    typeof options.readOrderItemSelections === "function"
      ? options.readOrderItemSelections
      : () => new Set();

  function getOrderItems() {
    const items = readOrderItems();
    if (Array.isArray(items)) return items;
    const fallback = [];
    writeOrderItems(fallback);
    return fallback;
  }

  function hasOrderItems() {
    return getOrderItems().length > 0;
  }

  function getOrderItemSelections() {
    return readOrderItemSelections();
  }

  function clearOrderItemSelections() {
    getOrderItemSelections().clear();
  }

  function syncOrderItemSelections() {
    const selections = getOrderItemSelections();
    const items = getOrderItems();
    const itemSet = new Set(items);
    Array.from(selections).forEach((item) => {
      if (!itemSet.has(item)) {
        selections.delete(item);
      }
    });
  }

  function isOrderItemSelected(dishName) {
    return getOrderItemSelections().has(dishName);
  }

  function toggleOrderItemSelection(dishName) {
    const selections = getOrderItemSelections();
    if (selections.has(dishName)) {
      selections.delete(dishName);
    } else {
      selections.add(dishName);
    }
  }

  function getSelectedOrderItems() {
    syncOrderItemSelections();
    const selections = getOrderItemSelections();
    const items = getOrderItems();
    return items.filter((item) => selections.has(item));
  }

  function getRestaurantSlug() {
    if (state.restaurant?.slug) return state.restaurant.slug;
    const runtimeSlug = getGlobalSlug();
    if (typeof runtimeSlug === "string" && runtimeSlug) return runtimeSlug;
    return "";
  }

  function getOrderItemsStorageKey() {
    const restaurantSlug = getRestaurantSlug();
    return restaurantSlug ? `orderItems:${restaurantSlug}` : "orderItems";
  }

  function getOrderFormStateStorageKey() {
    const restaurantSlug = getRestaurantSlug();
    return restaurantSlug
      ? `orderConfirmFormState:${restaurantSlug}`
      : "orderConfirmFormState";
  }

  function persistOrderItems() {
    const storageKey = getOrderItemsStorageKey();
    try {
      const orderItems = getOrderItems();
      if (orderItems.length > 0) {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            items: orderItems,
            timestamp: Date.now(),
          }),
        );
      } else {
        localStorage.removeItem(storageKey);
      }
      if (storageKey !== "orderItems") {
        localStorage.removeItem("orderItems");
      }
    } catch (error) {
      console.error("Failed to persist order items", error);
    }
  }

  function restoreOrderItems() {
    const storageKey = getOrderItemsStorageKey();
    try {
      let saved = localStorage.getItem(storageKey);
      let usedLegacyKey = false;
      if (!saved && storageKey !== "orderItems") {
        saved = localStorage.getItem("orderItems");
        if (saved) usedLegacyKey = true;
      }
      if (saved) {
        const data = JSON.parse(saved);
        const isValidArray = data && Array.isArray(data.items);
        const isFresh =
          data && data.timestamp && Date.now() - data.timestamp < 86400000;
        if (isValidArray && isFresh && data.items.length) {
          writeOrderItems([...data.items]);
          syncOrderItemSelections();
          if (usedLegacyKey) {
            localStorage.removeItem("orderItems");
            localStorage.setItem(storageKey, saved);
          }
          return true;
        }
        localStorage.removeItem(storageKey);
        if (usedLegacyKey) localStorage.removeItem("orderItems");
      }
    } catch (error) {
      console.error("Failed to restore order items", error);
      localStorage.removeItem(storageKey);
      if (storageKey !== "orderItems") localStorage.removeItem("orderItems");
    }
    writeOrderItems([]);
    clearOrderItemSelections();
    return false;
  }

  return {
    getOrderItems,
    hasOrderItems,
    getOrderItemSelections,
    clearOrderItemSelections,
    syncOrderItemSelections,
    isOrderItemSelected,
    toggleOrderItemSelection,
    getSelectedOrderItems,
    getRestaurantSlug,
    getOrderItemsStorageKey,
    getOrderFormStateStorageKey,
    persistOrderItems,
    restoreOrderItems,
  };
}
