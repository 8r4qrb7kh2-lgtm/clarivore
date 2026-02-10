export function createMobileInfoPanelDom(deps = {}) {
  const getMobileInfoPanel =
    typeof deps.getMobileInfoPanel === "function"
      ? deps.getMobileInfoPanel
      : () => null;
  const setMobileInfoPanel =
    typeof deps.setMobileInfoPanel === "function"
      ? deps.setMobileInfoPanel
      : () => {};
  const adjustMobileInfoPanelForZoom =
    typeof deps.adjustMobileInfoPanelForZoom === "function"
      ? deps.adjustMobileInfoPanelForZoom
      : () => {};

  function ensureMobileInfoPanel() {
    let mobileInfoPanel = getMobileInfoPanel();
    if (mobileInfoPanel && mobileInfoPanel.isConnected) return mobileInfoPanel;

    if (!mobileInfoPanel) {
      mobileInfoPanel = document.createElement("div");
      mobileInfoPanel.id = "mobileInfoPanel";
      mobileInfoPanel.className = "mobileInfoPanel";
      mobileInfoPanel.setAttribute("aria-live", "polite");
      mobileInfoPanel.style.position = "fixed";
      mobileInfoPanel.style.width = "auto";
      mobileInfoPanel.style.zIndex = "3500";
      mobileInfoPanel.style.background = "rgba(11,16,32,0.94)";
      mobileInfoPanel.style.backdropFilter = "blur(14px)";
      mobileInfoPanel.style.webkitBackdropFilter = "blur(14px)";
      mobileInfoPanel.style.paddingBottom =
        "calc(24px + env(safe-area-inset-bottom,0))";
      mobileInfoPanel.style.borderRadius = "20px";
      mobileInfoPanel.style.display = "none";
      setMobileInfoPanel(mobileInfoPanel);
    }

    if (document.body.classList.contains("mobileViewerActive")) {
      mobileInfoPanel.style.setProperty("left", "0", "important");
      mobileInfoPanel.style.setProperty("right", "0", "important");
      mobileInfoPanel.style.setProperty("bottom", "0", "important");
    } else {
      mobileInfoPanel.style.left = "12px";
      mobileInfoPanel.style.right = "12px";
      mobileInfoPanel.style.bottom = "12px";
    }
    mobileInfoPanel.innerHTML = "";
    mobileInfoPanel.classList.remove("show");
    mobileInfoPanel.style.display = "none";
    document.body.appendChild(mobileInfoPanel);
    adjustMobileInfoPanelForZoom();
    return mobileInfoPanel;
  }

  return {
    ensureMobileInfoPanel,
  };
}
