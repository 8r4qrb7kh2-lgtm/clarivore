export function renderRestaurantScreen(options = {}) {
  const {
    state,
    orderFlow,
    TABLET_ORDER_STATUSES,
    renderTopbar,
    setRootOffsetPadding,
    mountRestaurantShell,
    applyRestaurantShellState,
    esc,
    fmtDate,
    initGuestFilterControls,
    renderSelector,
    renderSelectedChips,
    renderSavedChips,
    renderDietSelector,
    renderSelectedDiets,
    renderSavedDiets,
    showRestaurantMenuSurface,
    drawMenu,
    resizeLegendToFit,
    getMenuState,
    ensureMobileViewerChrome,
    updateZoomIndicator,
    prefersMobileInfo,
    openMobileViewer,
    send,
    urlQR,
    shouldShowQrPromo,
    queueQrPromoTimer,
    cancelQrPromoTimer,
    bindSavedPreferenceButtons,
    bindRestaurantActionButtons,
    openFeedbackModal,
    openReportIssueModal,
    ensureMobileInfoPanel,
    clearCurrentMobileInfoItem,
  } = options;

  renderTopbar();
  const root = document.getElementById("root");
  const restaurant = state.restaurant || {};

  const urlParams = new URLSearchParams(location.search);
  const dishName = urlParams.get("dishName");
  const ackParam = urlParams.get("ack");
  const hasSubmittedNotice =
    orderFlow.tabletSimOrderId &&
    orderFlow.tabletSimState.orders.some(
      (order) =>
        order.id === orderFlow.tabletSimOrderId &&
        order.status !== TABLET_ORDER_STATUSES.CODE_ASSIGNED &&
        order.status !== TABLET_ORDER_STATUSES.RESCINDED_BY_DINER &&
        order.status !== TABLET_ORDER_STATUSES.REJECTED_BY_SERVER &&
        order.status !== TABLET_ORDER_STATUSES.REJECTED_BY_KITCHEN,
    );

  state.ack = !!dishName || ackParam === "1" || hasSubmittedNotice;
  const isGuest = state.qr || !state.user?.loggedIn;

  if (!isGuest || !state.ack || state.isHowItWorks) {
    state.guestFilterEditing = false;
  }

  const showGuestFilterToggle = isGuest && !state.isHowItWorks;
  const guestFilterToggleHtml = showGuestFilterToggle
    ? `<button type="button" class="filterToggleBtn${state.guestFilterEditing ? " save" : ""}" data-guest-filter-toggle="1" style="${state.ack ? "" : "display:none;"}">${state.guestFilterEditing ? "Save" : "Edit"}</button>`
    : "";

  mountRestaurantShell(root, {
    restaurantName: esc(restaurant.name || "Restaurant"),
    isGuest,
    showSavedEditButtons: !state.qr && !!state.user?.loggedIn,
    guestFilterToggleHtml,
    lastConfirmedText: restaurant.lastConfirmed ? esc(fmtDate(restaurant.lastConfirmed)) : "—",
    ack: state.ack,
  });

  applyRestaurantShellState({
    restaurantName: restaurant.name || "Restaurant",
    lastConfirmedText: restaurant.lastConfirmed ? fmtDate(restaurant.lastConfirmed) : "—",
    isGuest,
    isHowItWorks: state.isHowItWorks,
    isQr: state.qr,
    isLoggedIn: !!state.user?.loggedIn,
    guestFilterEditing: state.guestFilterEditing,
    ack: state.ack,
  });

  setRootOffsetPadding("0");

  const { renderFilterChips, syncGuestFilterToggleButtons } =
    initGuestFilterControls({
      state,
      isGuest,
      renderSelector,
      renderSelectedChips,
      renderSavedChips,
      renderDietSelector,
      renderSelectedDiets,
      renderSavedDiets,
    });

  const menu = document.getElementById("menu");
  const mobileInfoPanel = ensureMobileInfoPanel();
  if (mobileInfoPanel) {
    mobileInfoPanel.classList.remove("show");
    mobileInfoPanel.style.display = "none";
    mobileInfoPanel.innerHTML = "";
  }

  const revealRestaurantSurface = ({ autoOpenMobileViewer = false } = {}) => {
    showRestaurantMenuSurface({
      menu,
      restaurant,
      drawMenu,
      resizeLegendToFit,
      getMenuState,
      ensureMobileViewerChrome,
      updateZoomIndicator,
      prefersMobileInfo,
      openMobileViewer,
      autoOpenMobileViewer,
    });
  };

  const menuShouldShow = state.ack || state.isHowItWorks;
  if (menuShouldShow) {
    if (state.ack) {
      send({ type: "ack" });
    }
    revealRestaurantSurface({ autoOpenMobileViewer: !!dishName });
  }

  const ackButton = document.getElementById("ackBtn");
  if (ackButton) {
    ackButton.onclick = () => {
      if (!state.ack) {
        send({ type: "ack" });
        state.ack = true;
      }
      if (isGuest) state.guestFilterEditing = false;

      applyRestaurantShellState({
        restaurantName: restaurant.name || "Restaurant",
        lastConfirmedText: restaurant.lastConfirmed
          ? fmtDate(restaurant.lastConfirmed)
          : "—",
        isGuest,
        isHowItWorks: state.isHowItWorks,
        isQr: state.qr,
        isLoggedIn: !!state.user?.loggedIn,
        guestFilterEditing: state.guestFilterEditing,
        ack: true,
      });

      renderFilterChips();
      syncGuestFilterToggleButtons();
      revealRestaurantSurface();

      if (mobileInfoPanel) {
        mobileInfoPanel.classList.remove("show");
        mobileInfoPanel.style.display = "none";
        mobileInfoPanel.innerHTML = "";
      }
      clearCurrentMobileInfoItem();

      if ((state.qr || urlQR) && !state.user?.loggedIn && shouldShowQrPromo()) {
        queueQrPromoTimer();
      } else {
        cancelQrPromoTimer();
      }
    };
  }

  bindSavedPreferenceButtons({
    isQr: state.qr,
    isLoggedIn: !!state.user?.loggedIn,
    send,
    slug: restaurant.slug || "",
  });

  bindRestaurantActionButtons({
    restaurant,
    openFeedbackModal,
    openReportIssueModal,
  });
}
