import { isManagerOrOwnerUser } from "./managerRestaurants.js";

export function createEditorLastConfirmedUpdater(options = {}) {
  const { state, getWeeksAgoInfo, fmtDateTime } = options;

  return function updateLastConfirmedText() {
    const lastConfirmedText = document.getElementById("lastConfirmedText");
    if (!lastConfirmedText) return;

    const now = new Date();
    const showAll = isManagerOrOwnerUser(state.user);
    const info = getWeeksAgoInfo(now, showAll);

    if (info && info.text) {
      lastConfirmedText.textContent = `Last confirmed by staff: ${info.text}`;
      lastConfirmedText.style.color = info.color;
      return;
    }

    lastConfirmedText.textContent = `Last confirmed: ${fmtDateTime(now)}`;
    lastConfirmedText.style.color = "";
  };
}
