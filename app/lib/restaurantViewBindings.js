function hideMobileNotice(notice) {
  if (!notice) return;
  notice.style.display = "none";
  notice.setAttribute("aria-hidden", "true");
  delete notice.dataset.enabled;
  const openBtn = notice.querySelector(".mobileMenuOpenBtn");
  if (openBtn && openBtn.__openHandler) {
    openBtn.removeEventListener("click", openBtn.__openHandler);
    delete openBtn.__openHandler;
  }
}

function showMobileNotice({
  notice,
  prefersMobileInfo,
  openMobileViewer,
  autoOpen,
}) {
  if (!notice) return;

  if (!prefersMobileInfo()) {
    hideMobileNotice(notice);
    return;
  }

  notice.style.display = "flex";
  notice.setAttribute("aria-hidden", "false");
  notice.dataset.enabled = "1";

  const openBtn = notice.querySelector(".mobileMenuOpenBtn");
  if (openBtn && !openBtn.__openHandler) {
    const handler = (e) => {
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      openMobileViewer();
    };
    openBtn.__openHandler = handler;
    openBtn.addEventListener("click", handler);
  }

  if (autoOpen) {
    setTimeout(() => {
      openMobileViewer();
    }, 700);
  }
}

function setupHeaderMiniMap({ restaurant, getMenuState }) {
  const headerMiniMapImg = document.getElementById("headerMiniMapImg");
  const headerMiniMapLabel = document.getElementById("headerMiniMapLabel");
  const menuImages =
    restaurant.menuImages || (restaurant.menuImage ? [restaurant.menuImage] : []);

  if (!headerMiniMapImg || !menuImages.length) return;

  headerMiniMapImg.src = menuImages[0];
  if (headerMiniMapLabel) {
    headerMiniMapLabel.textContent =
      menuImages.length > 1 ? `Page 1 of ${menuImages.length}` : "";
  }

  headerMiniMapImg.onclick = () => {
    const menuState = getMenuState();
    if (!menuState || !menuState.sections || menuState.sections.length <= 1) {
      return;
    }

    const nextPage =
      ((menuState.currentMiniMapPage || 0) + 1) % menuState.sections.length;
    menuState.sections[nextPage].section.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };
}

export function initGuestFilterControls(options = {}) {
  const {
    state,
    isGuest,
    renderSelector,
    renderSelectedChips,
    renderSavedChips,
    renderDietSelector,
    renderSelectedDiets,
    renderSavedDiets,
  } = options;

  const chipsHost = document.getElementById("savedChips");
  const dietChipsHost = document.getElementById("dietChips");

  const renderFilterChips = () => {
    if (!chipsHost || !dietChipsHost) return;

    const allowInteractiveFilters =
      state.isHowItWorks ||
      (!state.ack && isGuest) ||
      (isGuest && state.guestFilterEditing);

    if (allowInteractiveFilters) renderSelector(chipsHost);
    else if (isGuest) renderSelectedChips(chipsHost);
    else renderSavedChips(chipsHost);

    if (allowInteractiveFilters) renderDietSelector(dietChipsHost);
    else if (isGuest) renderSelectedDiets(dietChipsHost);
    else renderSavedDiets(dietChipsHost);
  };

  const syncGuestFilterToggleButtons = () => {
    const buttons = document.querySelectorAll("[data-guest-filter-toggle]");
    if (!buttons.length) return;
    buttons.forEach((btn) => {
      btn.textContent = state.guestFilterEditing ? "Save" : "Edit";
      btn.classList.toggle("save", state.guestFilterEditing);
      btn.style.display =
        isGuest && state.ack && !state.isHowItWorks ? "inline-flex" : "none";
    });
  };

  const buttons = document.querySelectorAll("[data-guest-filter-toggle]");
  buttons.forEach((btn) => {
    if (btn.__guestToggleBound) return;
    btn.__guestToggleBound = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.guestFilterEditing = !state.guestFilterEditing;
      renderFilterChips();
      syncGuestFilterToggleButtons();
    });
  });

  renderFilterChips();
  syncGuestFilterToggleButtons();

  return {
    renderFilterChips,
    syncGuestFilterToggleButtons,
  };
}

export function showRestaurantMenuSurface(options = {}) {
  const {
    menu,
    restaurant,
    drawMenu,
    resizeLegendToFit,
    getMenuState,
    ensureMobileViewerChrome,
    updateZoomIndicator,
    prefersMobileInfo,
    openMobileViewer,
    autoOpenMobileViewer = false,
  } = options;

  if (!menu) return;

  menu.classList.add("show");

  const actionButtonsRow = document.getElementById("actionButtonsRow");
  if (actionButtonsRow) actionButtonsRow.style.display = "flex";

  const legendRow = document.getElementById("legendRow");
  if (legendRow) legendRow.style.display = "flex";
  setTimeout(resizeLegendToFit, 0);

  const confirmedRow = document.getElementById("confirmedRow");
  if (confirmedRow) confirmedRow.style.display = "block";

  const headerMiniMap = document.getElementById("headerMiniMap");
  if (headerMiniMap) headerMiniMap.style.display = "flex";

  drawMenu(menu, restaurant.menuImage, restaurant.menuImages, 0);
  setupHeaderMiniMap({ restaurant, getMenuState });

  const notice = document.getElementById("mobileMenuNotice");
  const hasMenuImage = !!restaurant.menuImage;

  if (hasMenuImage) {
    ensureMobileViewerChrome();
    updateZoomIndicator();
    showMobileNotice({
      notice,
      prefersMobileInfo,
      openMobileViewer,
      autoOpen: autoOpenMobileViewer,
    });
    return;
  }

  hideMobileNotice(notice);
}

export function bindSavedPreferenceButtons(options = {}) {
  const { isQr = false, isLoggedIn = false, send, slug = "" } = options;
  if (isQr || !isLoggedIn || typeof send !== "function") return;

  const editBtn = document.getElementById("editSavedBtn");
  if (editBtn) {
    editBtn.onclick = () => send({ type: "navigate", to: "/accounts", slug });
  }

  const editDietsBtn = document.getElementById("editSavedDietsBtn");
  if (editDietsBtn) {
    editDietsBtn.onclick = () =>
      send({ type: "navigate", to: "/accounts", slug });
  }
}

export function bindRestaurantActionButtons(options = {}) {
  const {
    restaurant,
    openFeedbackModal,
    openReportIssueModal,
  } = options;

  const websiteBtn = document.getElementById("restaurantWebsiteBtn");
  if (websiteBtn) {
    websiteBtn.onclick = () => {
      if (restaurant.website) window.open(restaurant.website, "_blank");
    };
  }

  const callBtn = document.getElementById("restaurantCallBtn");
  if (callBtn) {
    callBtn.onclick = () => {
      if (restaurant.phone) window.location.href = `tel:${restaurant.phone}`;
    };
  }

  const feedbackBtn = document.getElementById("restaurantFeedbackBtn");
  if (feedbackBtn) feedbackBtn.onclick = () => openFeedbackModal();

  const reportIssueBtn = document.getElementById("reportIssueBtn");
  if (reportIssueBtn) reportIssueBtn.onclick = () => openReportIssueModal();
}
