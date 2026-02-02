export function initOrderConfirmRestore(deps = {}) {
  const initOrderSidebar =
    typeof deps.initOrderSidebar === "function" ? deps.initOrderSidebar : () => {};
  const getOrderFormStateStorageKey =
    typeof deps.getOrderFormStateStorageKey === "function"
      ? deps.getOrderFormStateStorageKey
      : () => "orderConfirmFormState";
  const checkUserAuth =
    typeof deps.checkUserAuth === "function" ? deps.checkUserAuth : async () => false;
  const restoreOrderFormState =
    typeof deps.restoreOrderFormState === "function"
      ? deps.restoreOrderFormState
      : () => {};
  const updateOrderConfirmAuthState =
    typeof deps.updateOrderConfirmAuthState === "function"
      ? deps.updateOrderConfirmAuthState
      : async () => {};
  const rerenderOrderConfirmDetails =
    typeof deps.rerenderOrderConfirmDetails === "function"
      ? deps.rerenderOrderConfirmDetails
      : () => {};

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOrderSidebar);
  } else {
    initOrderSidebar();
  }

  (async function () {
    const urlParams = new URLSearchParams(window.location.search);
    const formStateKey = getOrderFormStateStorageKey();
    let hasSavedState = localStorage.getItem(formStateKey);
    if (!hasSavedState && formStateKey !== "orderConfirmFormState") {
      hasSavedState = localStorage.getItem("orderConfirmFormState");
    }
    if (urlParams.has("redirect") || hasSavedState) {
      const isAuthenticated = await checkUserAuth();
      if (isAuthenticated && hasSavedState) {
        let hasRestored = false;
        const waitForMenu = () => {
          const menu = document.getElementById("menu");
          if (
            menu &&
            menu.querySelectorAll(".overlay").length > 0 &&
            !hasRestored
          ) {
            hasRestored = true;
            restoreOrderFormState();
            updateOrderConfirmAuthState();
            setTimeout(() => {
              rerenderOrderConfirmDetails();
            }, 500);
            setTimeout(() => {
              rerenderOrderConfirmDetails();
            }, 1500);
            setTimeout(() => {
              rerenderOrderConfirmDetails();
            }, 2500);
          } else if (!hasRestored) {
            setTimeout(waitForMenu, 100);
          }
        };
        setTimeout(waitForMenu, 500);
      } else {
        await updateOrderConfirmAuthState();
      }
    }
  })();
}
