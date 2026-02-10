const QR_PROMO_STORAGE_KEY = "qrPromoDismissed";

export function deriveQrVisitFlag() {
  if (typeof window.__qrVisit === "boolean") {
    return window.__qrVisit;
  }
  const value = new URLSearchParams(location.search).get("qr");
  return !!(value && /^(1|true|yes)$/i.test(value));
}

export function createQrPromoController(options = {}) {
  const { state, isDishInfoPopupOpen } = options;
  let qrPromoTimerId = null;

  function shouldShowQrPromo() {
    try {
      return !sessionStorage.getItem(QR_PROMO_STORAGE_KEY);
    } catch (_) {
      return true;
    }
  }

  function dismissQrPromo() {
    try {
      sessionStorage.setItem(QR_PROMO_STORAGE_KEY, "1");
    } catch (_) {
      // Ignore session storage failures
    }
  }

  function cancelQrPromoTimer() {
    if (qrPromoTimerId) {
      clearTimeout(qrPromoTimerId);
      qrPromoTimerId = null;
    }
  }

  function openQrPromo() {
    const backdrop = document.getElementById("qrPromoBackdrop");
    if (!backdrop || backdrop.classList.contains("show")) return;

    if (typeof isDishInfoPopupOpen === "function" && isDishInfoPopupOpen()) {
      setTimeout(() => {
        if (!state.user?.loggedIn && shouldShowQrPromo()) {
          openQrPromo();
        }
      }, 2000);
      return;
    }

    backdrop.classList.add("show");
    backdrop.setAttribute("aria-hidden", "false");
  }

  function queueQrPromoTimer() {
    cancelQrPromoTimer();
    qrPromoTimerId = setTimeout(() => {
      qrPromoTimerId = null;
      if (!state.user?.loggedIn && shouldShowQrPromo()) {
        openQrPromo();
      }
    }, 10000);
  }

  function closeQrPromo(reason = "dismiss") {
    const backdrop = document.getElementById("qrPromoBackdrop");
    if (backdrop && backdrop.classList.contains("show")) {
      backdrop.classList.remove("show");
      backdrop.setAttribute("aria-hidden", "true");
    }

    if (reason !== "login") dismissQrPromo();
    cancelQrPromoTimer();
  }

  return {
    shouldShowQrPromo,
    dismissQrPromo,
    cancelQrPromoTimer,
    queueQrPromoTimer,
    openQrPromo,
    closeQrPromo,
  };
}
