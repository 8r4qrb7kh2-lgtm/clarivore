import { createStandaloneMessageDispatcher } from "./standalone-message-dispatcher.js";

export function createNavigationRuntime(deps = {}) {
  const state = deps.state || {};
  const slug = deps.slug || "";
  const normalizeRestaurant =
    typeof deps.normalizeRestaurant === "function"
      ? deps.normalizeRestaurant
      : (value) => value;
  const insertChangeLogEntry =
    typeof deps.insertChangeLogEntry === "function"
      ? deps.insertChangeLogEntry
      : () => {};
  const fetchChangeLogEntries =
    typeof deps.fetchChangeLogEntries === "function"
      ? deps.fetchChangeLogEntries
      : () => {};
  const closeQrPromo =
    typeof deps.closeQrPromo === "function" ? deps.closeQrPromo : () => {};

  const isStandalone = window === window.parent;
  const dispatchStandaloneMessage = createStandaloneMessageDispatcher({
    state,
    normalizeRestaurant,
    insertChangeLogEntry,
    fetchChangeLogEntries,
  });

  const send = (payload) => {
    if (isStandalone) {
      const handled = dispatchStandaloneMessage(payload);
      if (!handled) {
        console.log("Message sent:", payload);
      }
    } else {
      parent.postMessage(payload, "*");
    }
  };

  const requestSignIn = (origin) => {
    const slugParam = (state.restaurant && state.restaurant.slug) || slug || "";
    const payload = { type: "signIn" };
    if (slugParam) payload.slug = slugParam;
    if (origin === "restaurants") payload.redirect = "restaurants";
    if (origin === "qr") payload.from = "qr";
    send(payload);
  };

  function bindQrPromoControls() {
    const qrPromoBackdrop = document.getElementById("qrPromoBackdrop");
    const qrPromoCloseBtn = document.getElementById("qrPromoClose");
    const qrPromoSignupBtn = document.getElementById("qrPromoSignup");

    if (qrPromoBackdrop) {
      qrPromoBackdrop.addEventListener("click", (event) => {
        if (event.target === qrPromoBackdrop) closeQrPromo("dismiss");
      });
    }
    if (qrPromoCloseBtn) {
      qrPromoCloseBtn.onclick = () => closeQrPromo("dismiss");
    }
    if (qrPromoSignupBtn) {
      qrPromoSignupBtn.onclick = () => {
        closeQrPromo("signup");
        const inviteParam = new URLSearchParams(window.location.search).get(
          "invite",
        );
        if (inviteParam) {
          window.location.href = `/account?invite=${encodeURIComponent(inviteParam)}`;
        } else {
          requestSignIn("qr");
        }
      };
    }
  }

  return {
    send,
    requestSignIn,
    bindQrPromoControls,
  };
}
