export function createPageCoreRuntime(deps = {}) {
  const formatAllergenLabelConfig = deps.formatAllergenLabel;
  const getTipPinned =
    typeof deps.getTipPinned === "function" ? deps.getTipPinned : () => false;

  const esc = (value) =>
    (value ?? "").toString().replace(
      /[&<>"']/g,
      (match) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[match],
    );

  const norm = (value) => String(value ?? "").toLowerCase().trim();

  const cap = (value) =>
    (value || "")
      .split(" ")
      .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ""))
      .join(" ");

  const formatAllergenLabel =
    typeof formatAllergenLabelConfig === "function"
      ? formatAllergenLabelConfig
      : (value) => cap(value);

  const setOverlayPulseColor = (overlayElement) => {
    if (!overlayElement) return;

    const borderColor = getComputedStyle(overlayElement).borderColor || "";
    const match = borderColor.match(/rgba?\(([^)]+)\)/i);
    if (match) {
      const rgbParts = match[1]
        .split(",")
        .slice(0, 3)
        .map((item) => Math.round(parseFloat(item.trim())))
        .filter((item) => Number.isFinite(item));

      if (rgbParts.length === 3) {
        overlayElement.style.setProperty("--pulse-rgb", rgbParts.join(", "));
      }
    }

    overlayElement.style.zIndex = "1010";
  };

  function hidePageLoader() {
    const loader = document.getElementById("pageLoader");
    if (!loader) return;
    loader.classList.add("hidden");
    window.setTimeout(() => {
      loader.remove();
    }, 400);
  }

  function div(html, cls) {
    const element = document.createElement("div");
    if (cls) element.className = cls;
    element.innerHTML = html;
    return element;
  }

  function configureModalClose({ visible = true, onClick = null } = {}) {
    const closeBtn = document.getElementById("modalCloseBtn");
    if (closeBtn) {
      closeBtn.style.display = visible ? "inline-flex" : "none";
      closeBtn.onclick = onClick || null;
    }
  }

  function isDishInfoPopupOpen() {
    const mobilePanel = document.getElementById("mobileInfoPanel");
    if (mobilePanel && mobilePanel.classList.contains("show")) return true;
    if (getTipPinned()) return true;
    return false;
  }

  return {
    esc,
    norm,
    cap,
    formatAllergenLabel,
    setOverlayPulseColor,
    hidePageLoader,
    div,
    configureModalClose,
    isDishInfoPopupOpen,
  };
}
