export function applyConsoleReportingPreference() {
  const search = window.location.search || "";
  const enabled =
    search.includes("debug=1") ||
    localStorage.getItem("enableConsoleReporting") === "true" ||
    window.__enableConsoleReporting === true;

  window.__enableConsoleReporting = enabled;
  if (!enabled && typeof console !== "undefined") {
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
    console.debug = () => {};
  }
}

export function applyModeFlags({ editParam, isQrVisit, openLogParam, openConfirmParam }) {
  const hasExplicitModeParam = editParam !== null;
  let shouldStartInEditor =
    editParam === "true" || editParam === "editor" || editParam === "1";

  if (!hasExplicitModeParam && !isQrVisit) {
    try {
      const storedMode = localStorage.getItem("clarivoreManagerMode");
      if (storedMode === "editor") shouldStartInEditor = true;
    } catch (_) {}
  }

  window.__startInEditor = shouldStartInEditor;
  window.__openLogOnLoad = openLogParam === "true" || openLogParam === "1";
  window.__openConfirmOnLoad =
    openConfirmParam === "true" || openConfirmParam === "1";
}

export function attachInviteBanner(inviteToken) {
  if (!inviteToken) return;
  const managerInviteBanner = document.getElementById("managerInviteBanner");
  const managerInviteSignupBtn = document.getElementById("managerInviteSignupBtn");

  if (managerInviteBanner) {
    managerInviteBanner.style.display = "flex";
    document.body.classList.add("managerInviteBannerVisible");
  }

  if (managerInviteSignupBtn) {
    managerInviteSignupBtn.onclick = () => {
      window.location.href = `/account?invite=${encodeURIComponent(inviteToken)}`;
    };
  }
}

export function trackRecentlyViewed(slug) {
  if (!slug) return;
  try {
    const recentlyViewed = JSON.parse(
      localStorage.getItem("recentlyViewedRestaurants") || "[]",
    );
    const filtered = recentlyViewed.filter((value) => value !== slug);
    filtered.unshift(slug);
    localStorage.setItem(
      "recentlyViewedRestaurants",
      JSON.stringify(filtered.slice(0, 10)),
    );
  } catch (error) {
    console.warn("Could not track recently viewed restaurant", error);
  }
}
