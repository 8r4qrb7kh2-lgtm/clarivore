function navigateWithUnsavedGuard({
  targetUrl,
  hasUnsavedChanges,
  showUnsavedChangesModal,
  clearEditorDirty,
}) {
  if (!targetUrl) return;
  if (hasUnsavedChanges()) {
    showUnsavedChangesModal(() => {
      clearEditorDirty();
      window.location.href = targetUrl;
    });
    return;
  }
  window.location.href = targetUrl;
}

function getNavUserPayload(state) {
  if (!state.user?.loggedIn) return null;
  const role = state.user?.role || state.user?.user_metadata?.role || null;
  const userMetadata = { ...(state.user?.user_metadata || {}) };
  if (role && !userMetadata.role) {
    userMetadata.role = role;
  }
  return { ...state.user, user_metadata: userMetadata };
}

function getNavCurrentPageId({ state, isEditorMode, slug, resolveRestaurantSlug }) {
  if (isEditorMode && state.page === "editor") {
    const resolvedSlug =
      state.restaurant?.slug ||
      (typeof resolveRestaurantSlug === "function" ? resolveRestaurantSlug() : "") ||
      slug ||
      "";
    return resolvedSlug ? `restaurant-${resolvedSlug}-editor` : "editor";
  }
  if (state.page === "favorites") return "favorites";
  if (state.page === "dish-search") return "dish-search";
  if (state.page === "account") return "account";
  if (state.page === "restaurants" || state.page === "restaurant") {
    return "restaurants";
  }
  return "home";
}

function attachNavButtonGuards({
  container,
  hasUnsavedChanges,
  showUnsavedChangesModal,
  clearEditorDirty,
}) {
  if (!container) return;
  container.querySelectorAll("button[data-href]").forEach((button) => {
    if (button.__navGuarded) return;
    button.__navGuarded = true;
    button.onclick = null;
    button.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        navigateWithUnsavedGuard({
          targetUrl: button.dataset.href,
          hasUnsavedChanges,
          showUnsavedChangesModal,
          clearEditorDirty,
        });
      },
      { capture: true },
    );
  });
}

function fitTopbarNav() {
  const nav = document.querySelector(".simple-nav");
  if (!nav) return;
  nav.classList.remove("nav-compact", "nav-ultra");
  const availableWidth = Math.floor(nav.clientWidth);
  if (!availableWidth) return;

  if (nav.scrollWidth > availableWidth + 1) {
    nav.classList.add("nav-compact");
    if (nav.scrollWidth > availableWidth + 1) {
      nav.classList.add("nav-ultra");
    }
  }

  const delta = nav.scrollWidth - nav.clientWidth;
  nav.classList.toggle("nav-centered", delta <= 1);
}

function scheduleTopbarFit() {
  window.requestAnimationFrame(fitTopbarNav);
}

export function initRestaurantTopbar(options = {}) {
  const {
    state,
    urlQR,
    slug,
    setupTopbar,
    hasUnsavedChanges,
    showUnsavedChangesModal,
    clearEditorDirty,
    updateRootOffset,
    resolveRestaurantSlug,
  } = options;

  function renderTopbar() {
    const container = document.getElementById("topbar");
    if (!container) return;

    const isQrExperience = !!(state.qr || urlQR);
    document.body.classList.toggle("qrMode", isQrExperience);

    const navUser = getNavUserPayload(state);
    const currentMode = localStorage.getItem("clarivoreManagerMode") || "editor";
    const isEditorMode = currentMode === "editor";
    const currentPageId = getNavCurrentPageId({
      state,
      isEditorMode,
      slug,
      resolveRestaurantSlug,
    });
    const managerRestaurants = Array.isArray(state.user?.managerRestaurants)
      ? state.user.managerRestaurants
      : [];

    const resolveModeTarget = (nextMode) => {
      const targetUrl = new URL(window.location.href);
      const slugValue =
        targetUrl.searchParams.get("slug") || state.restaurant?.slug || slug || "";
      if (slugValue) {
        targetUrl.searchParams.set("slug", slugValue);
      }

      if (nextMode === "editor") {
        targetUrl.searchParams.set("edit", "1");
        targetUrl.searchParams.delete("mode");
      } else {
        targetUrl.searchParams.delete("edit");
        targetUrl.searchParams.delete("mode");
      }
      return targetUrl.toString();
    };

    const navigateWithMode = (nextMode, nextHref) => {
      if (!nextHref) return;
      const navigateTo = (href) => {
        if (window.top && window.self !== window.top) {
          window.top.location.href = href;
        } else {
          window.location.href = href;
        }
      };

      if (hasUnsavedChanges()) {
        showUnsavedChangesModal(() => {
          clearEditorDirty();
          localStorage.setItem("clarivoreManagerMode", nextMode);
          navigateTo(nextHref);
        });
        return;
      }

      localStorage.setItem("clarivoreManagerMode", nextMode);
      navigateTo(nextHref);
    };

    setupTopbar(currentPageId, navUser, {
      managerRestaurants,
      container,
      onNavReady: (navContainer) => {
        attachNavButtonGuards({
          container: navContainer,
          hasUnsavedChanges,
          showUnsavedChangesModal,
          clearEditorDirty,
        });
      },
      modeToggle: {
        resolveTarget: resolveModeTarget,
        navigate: navigateWithMode,
      },
    });

    scheduleTopbarFit();
    if (!window.__topbarFitBound) {
      window.__topbarFitBound = true;
      window.addEventListener("resize", scheduleTopbarFit);
    }
    requestAnimationFrame(updateRootOffset);
  }

  return {
    renderTopbar,
    scheduleTopbarFit,
  };
}
