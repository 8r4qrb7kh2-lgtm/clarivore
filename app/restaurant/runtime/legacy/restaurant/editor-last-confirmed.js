export function createEditorLastConfirmedUpdater(options = {}) {
  const { state, getWeeksAgoInfo, fmtDateTime } = options;

  return function updateLastConfirmedText() {
    const lastConfirmedText = document.getElementById("lastConfirmedText");
    if (!lastConfirmedText) return;

    const now = new Date();
    const isAdmin = state.user?.email === "matt.29.ds@gmail.com";
    const isManager = state.user?.role === "manager";
    const showAll = isAdmin || isManager;
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
