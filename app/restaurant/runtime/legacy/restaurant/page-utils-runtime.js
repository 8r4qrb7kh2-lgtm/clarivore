import { resolveAccountName } from "../../../../lib/userIdentity.js";

export function createPageUtilsRuntime(deps = {}) {
  const state = deps.state || {};

  function getMenuState() {
    if (!window.__menuState) window.__menuState = {};
    return window.__menuState;
  }

  function getIssueReportMeta() {
    const user = state?.user || null;
    const pageUrl = window.location.href;
    const accountName = resolveAccountName(user, user?.email || "");

    return {
      pageUrl,
      userEmail: user?.email || null,
      reporterName: accountName || null,
      accountName: accountName || null,
      accountId: user?.id || null,
    };
  }

  function resizeLegendToFit() {
    const legendRow = document.getElementById("legendRow");
    const line1 = document.getElementById("legendLine1");
    const line2 = document.getElementById("legendLine2");
    if (!legendRow || !line1 || !line2) return;

    const line1Text = line1.querySelector(".legendText");
    const line2Text = line2.querySelector(".legendText");
    if (!line1Text || !line2Text) return;

    [line1Text, line2Text].forEach((text) => {
      text.style.transform = "none";
      text.style.transformOrigin = "center";
      text.style.display = "inline-block";
    });

    void line1Text.offsetWidth;
    void line2Text.offsetWidth;

    const width1 = line1Text.scrollWidth;
    const width2 = line2Text.scrollWidth;
    const availableWidth = line1.clientWidth || legendRow.clientWidth;

    if (width1 > 0 && width2 > 0 && availableWidth > 0) {
      const scale = Math.min(1, availableWidth / Math.max(width1, width2));
      line1Text.style.transform = `scale(${scale})`;
      line2Text.style.transform = `scale(${scale})`;
    }
  }

  function bindLegendResizeListener() {
    window.addEventListener("resize", () => {
      if (document.getElementById("legendRow")?.style.display !== "none") {
        resizeLegendToFit();
      }
    });
  }

  return {
    getMenuState,
    getIssueReportMeta,
    resizeLegendToFit,
    bindLegendResizeListener,
  };
}
