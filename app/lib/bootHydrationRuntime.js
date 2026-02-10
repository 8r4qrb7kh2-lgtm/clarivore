export function createBootHydrationRuntime(deps = {}) {
  const handleRestaurantMessage =
    typeof deps.handleRestaurantMessage === "function"
      ? deps.handleRestaurantMessage
      : () => {};

  function applyRestaurantBootPayload(payload) {
    handleRestaurantMessage(payload || {});
  }

  function bindWindowPayloadListener() {
    window.addEventListener("message", (event) => {
      applyRestaurantBootPayload(event.data || {});
    });

    if (window.__restaurantBootPayload && !window.__restaurantBootPayloadConsumed) {
      window.__restaurantBootPayloadConsumed = true;
      applyRestaurantBootPayload(window.__restaurantBootPayload);
    }
  }

  return {
    applyRestaurantBootPayload,
    bindWindowPayloadListener,
  };
}
