export function createPageRouterRuntime(deps = {}) {
  const state = deps.state || {};
  const setOrderSidebarVisibility =
    typeof deps.setOrderSidebarVisibility === "function"
      ? deps.setOrderSidebarVisibility
      : () => {};
  const renderEditor =
    typeof deps.renderEditor === "function" ? deps.renderEditor : () => {};
  const renderRestaurant =
    typeof deps.renderRestaurant === "function" ? deps.renderRestaurant : () => {};
  const renderRestaurantReportPage =
    typeof deps.renderRestaurantReportPage === "function"
      ? deps.renderRestaurantReportPage
      : () => {};
  const renderTopbar =
    typeof deps.renderTopbar === "function" ? deps.renderTopbar : () => {};
  const mountReportShell =
    typeof deps.mountReportShell === "function" ? deps.mountReportShell : () => {};
  const send = typeof deps.send === "function" ? deps.send : () => {};
  const hidePageLoader =
    typeof deps.hidePageLoader === "function" ? deps.hidePageLoader : () => {};
  const routeRestaurantsPath =
    typeof deps.routeRestaurantsPath === "string" && deps.routeRestaurantsPath.trim()
      ? deps.routeRestaurantsPath.trim()
      : "/restaurants";

  function renderReport() {
    return renderRestaurantReportPage({
      renderTopbar,
      mountReportShell,
      send,
    });
  }

  function setMenuScrollLock(locked) {
    const htmlEl = document.documentElement;
    if (locked) {
      document.body.classList.add("menuScrollLocked");
      htmlEl.classList.add("menuScrollLocked");
      return;
    }
    document.body.classList.remove("menuScrollLocked");
    htmlEl.classList.remove("menuScrollLocked");
    const root = document.getElementById("root");
    if (root) {
      root.style.cssText = "";
    }
  }

  function navigateToRestaurantsRoute() {
    if (typeof window === "undefined") return;

    const target = new URL(routeRestaurantsPath, window.location.origin);
    const current = new URL(window.location.href);
    const currentPath = current.pathname.replace(/\/+$/, "") || "/";
    const targetPath = target.pathname.replace(/\/+$/, "") || "/";

    // Preserve QR/invite context when a legacy payload asks for restaurant list view.
    ["qr", "invite"].forEach((key) => {
      const value = current.searchParams.get(key);
      if (value) target.searchParams.set(key, value);
    });

    if (currentPath === targetPath && current.search === target.search) {
      return;
    }

    window.location.replace(target.toString());
  }

  function render() {
    setMenuScrollLock(state.page === "restaurant" || state.page === "editor");
    document.body.classList.toggle("editorView", state.page === "editor");
    setOrderSidebarVisibility();
    let result;
    switch (state.page) {
      case "restaurants":
        result = navigateToRestaurantsRoute();
        break;
      case "editor":
        result = renderEditor();
        break;
      case "report":
        result = renderReport();
        break;
      case "restaurant":
        result = renderRestaurant();
        break;
      default:
        result = undefined;
        break;
    }
    hidePageLoader();
    return result;
  }

  return {
    render,
    renderReport,
    setMenuScrollLock,
  };
}
