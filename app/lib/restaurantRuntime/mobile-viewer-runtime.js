import {
  callRerenderLayer,
  getLastSelectedOverlay as readLastSelectedOverlay,
} from "./restaurantRuntimeBridge.js";
import { clearSelectedOverlays, markOverlaySelected } from "./overlay-dom.js";

export function createMobileViewerRuntime(deps = {}) {
  const state = deps.state || {};
  const normalizeAllergen =
    typeof deps.normalizeAllergen === "function"
      ? deps.normalizeAllergen
      : (value) => String(value ?? "").trim();
  const ALLERGEN_EMOJI =
    deps.ALLERGEN_EMOJI && typeof deps.ALLERGEN_EMOJI === "object"
      ? deps.ALLERGEN_EMOJI
      : {};
  const DIET_EMOJI =
    deps.DIET_EMOJI && typeof deps.DIET_EMOJI === "object" ? deps.DIET_EMOJI : {};
  const esc =
    typeof deps.esc === "function"
      ? deps.esc
      : (value) => String(value ?? "");
  const formatAllergenLabel =
    typeof deps.formatAllergenLabel === "function"
      ? deps.formatAllergenLabel
      : (value) => String(value ?? "");
  const getMenuState =
    typeof deps.getMenuState === "function" ? deps.getMenuState : () => ({});
  const prefersMobileInfo =
    typeof deps.prefersMobileInfo === "function"
      ? deps.prefersMobileInfo
      : () => false;
  const getCurrentMobileInfoItem =
    typeof deps.getCurrentMobileInfoItem === "function"
      ? deps.getCurrentMobileInfoItem
      : () => null;
  const setCurrentMobileInfoItem =
    typeof deps.setCurrentMobileInfoItem === "function"
      ? deps.setCurrentMobileInfoItem
      : () => {};
  const getMobileInfoPanel =
    typeof deps.getMobileInfoPanel === "function"
      ? deps.getMobileInfoPanel
      : () => null;
  const getRenderMobileInfo =
    typeof deps.getRenderMobileInfo === "function"
      ? deps.getRenderMobileInfo
      : () => () => {};
  const setOverlayPulseColor =
    typeof deps.setOverlayPulseColor === "function"
      ? deps.setOverlayPulseColor
      : () => {};
  const rerenderLayer =
    typeof deps.rerenderLayer === "function" ? deps.rerenderLayer : () => callRerenderLayer();
  const getLastSelectedOverlay =
    typeof deps.getLastSelectedOverlay === "function"
      ? deps.getLastSelectedOverlay
      : () => readLastSelectedOverlay();

  let mobileViewerChrome = null;
  let mobileZoomLevel = 1;
  let mobileViewerKeyHandler = null;

  function captureMenuBaseDimensions(force = false) {
    const menuState = getMenuState();
    const img = menuState?.img;
    if (!img) return;
    if (force || !menuState.baseWidth) {
      menuState.baseWidth = img.clientWidth || img.naturalWidth || img.width || 0;
      menuState.baseHeight =
        img.clientHeight || img.naturalHeight || img.height || 0;
    }
  }

  function updateZoomIndicator() {
    const indicator = document.getElementById("mobileZoomValue");
    if (indicator) {
      indicator.textContent = `${Math.round(mobileZoomLevel * 100)}%`;
    }
  }

  function updateFullScreenAllergySummary() {
    const summary = document.getElementById("mobileViewerAllergySummary");
    if (!summary) return;
    const uniqueKeys = Array.from(
      new Set((state.allergies || []).map(normalizeAllergen).filter(Boolean)),
    ).filter(Boolean);
    const selectedDiets = state.diets || [];

    let html = "";
    if (uniqueKeys.length || selectedDiets.length) {
      html = '<div class="mobileViewerSummaryInner">';

      if (uniqueKeys.length) {
        const allergenBadges = uniqueKeys
          .map((allergen) => {
            const emoji = ALLERGEN_EMOJI[allergen] || "🔴";
            return `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(76,90,212,0.25);border:1px solid rgba(76,90,212,0.4);border-radius:999px;padding:3px 8px;font-size:0.8rem;white-space:nowrap;"><span>${emoji}</span><span>${esc(formatAllergenLabel(allergen))}</span></span>`;
          })
          .join("");
        html += `<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;"><span class="label">Allergens:</span>${allergenBadges}</div>`;
      }

      if (selectedDiets.length) {
        const dietBadges = selectedDiets
          .map((diet) => {
            const emoji = DIET_EMOJI[diet] || "🍽️";
            return `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.4);border-radius:999px;padding:3px 8px;font-size:0.8rem;white-space:nowrap;"><span>${emoji}</span><span>${esc(diet)}</span></span>`;
          })
          .join("");
        html += `<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:${uniqueKeys.length ? "5px" : "0"}"><span class="label">Diets:</span>${dietBadges}</div>`;
      }

      html += "</div>";
    } else {
      html =
        '<div class="mobileViewerSummaryInner"><span class="values">No allergens or diets selected</span></div>';
    }
    summary.innerHTML = html;
  }

  function setMobileZoom(level, resetBase = false) {
    const menuState = getMenuState();
    const img = menuState?.img;
    if (!img) return;
    if (resetBase) {
      menuState.baseWidth = null;
      menuState.baseHeight = null;
    }
    captureMenuBaseDimensions(resetBase);
    if (!menuState.baseWidth) {
      updateZoomIndicator();
      return;
    }
    mobileZoomLevel = Math.min(Math.max(level, 1), 4);
    const width = menuState.baseWidth * mobileZoomLevel;
    const inner = menuState.inner;
    const layer = menuState.layer;
    img.style.width = width + "px";
    if (inner) inner.style.width = width + "px";
    if (layer) layer.style.width = width + "px";
    requestAnimationFrame(() => {
      rerenderLayer();
      updateZoomIndicator();
    });
  }

  function resetMobileZoom() {
    const menuState = getMenuState();
    mobileZoomLevel = 1;
    const img = menuState?.img;
    if (img) {
      img.style.width = "";
      if (menuState.inner) menuState.inner.style.width = "";
      if (menuState.layer) menuState.layer.style.width = "";
    }
    requestAnimationFrame(() => {
      rerenderLayer();
      captureMenuBaseDimensions(true);
      updateZoomIndicator();
    });
  }

  function ensureMobileViewerChrome() {
    if (mobileViewerChrome && mobileViewerChrome.isConnected) {
      return mobileViewerChrome;
    }
    let chrome = document.getElementById("mobileViewerChrome");
    if (!chrome) {
      chrome = document.createElement("div");
      chrome.id = "mobileViewerChrome";
      chrome.innerHTML = `
  <div class="chromeTop">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;pointer-events:auto;">
      <button type="button" class="mobileViewerControlBtn" id="mobileViewerCloseBtn">Close</button>
      <div class="mobileZoomGroup">
        <button type="button" id="mobileZoomOutBtn" aria-label="Zoom out">-</button>
        <span id="mobileZoomValue">100%</span>
        <button type="button" id="mobileZoomInBtn" aria-label="Zoom in">+</button>
      </div>
    </div>
    <div class="mobileViewerSummary" id="mobileViewerAllergySummary" aria-live="polite"></div>
  </div>`;
      document.body.appendChild(chrome);
    }
    if (!chrome.style.display) chrome.style.display = "none";
    if (!chrome.hasAttribute("aria-hidden")) {
      chrome.setAttribute("aria-hidden", "true");
    }
    mobileViewerChrome = chrome;
    const closeBtn = chrome.querySelector("#mobileViewerCloseBtn");
    const zoomOutBtn = chrome.querySelector("#mobileZoomOutBtn");
    const zoomInBtn = chrome.querySelector("#mobileZoomInBtn");
    if (closeBtn) closeBtn.onclick = () => closeMobileViewer();
    if (zoomOutBtn) zoomOutBtn.onclick = () => setMobileZoom(mobileZoomLevel - 0.25);
    if (zoomInBtn) zoomInBtn.onclick = () => setMobileZoom(mobileZoomLevel + 0.25);
    updateFullScreenAllergySummary();
    return mobileViewerChrome;
  }

  function openMobileViewer() {
    const chrome = ensureMobileViewerChrome();
    if (chrome) {
      chrome.style.display = "block";
      chrome.setAttribute("aria-hidden", "false");
    }
    captureMenuBaseDimensions(true);
    document.body.classList.add("mobileViewerActive");
    updateFullScreenAllergySummary();
    setMobileZoom(1, true);
    if (prefersMobileInfo()) {
      const updatePanel = () => {
        const renderMobileInfo = getRenderMobileInfo();
        const currentMobileInfoItem = getCurrentMobileInfoItem();
        const mobileInfoPanel = getMobileInfoPanel();
        if (currentMobileInfoItem && mobileInfoPanel) {
          mobileInfoPanel.style.setProperty("left", "0", "important");
          mobileInfoPanel.style.setProperty("right", "0", "important");
          mobileInfoPanel.style.setProperty("bottom", "0", "important");
          renderMobileInfo(currentMobileInfoItem);
        } else {
          renderMobileInfo(null);
        }
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(updatePanel);
      });
      setTimeout(updatePanel, 50);
      setTimeout(updatePanel, 150);

      const lastSelectedOverlay = getLastSelectedOverlay();
      if (getCurrentMobileInfoItem() && lastSelectedOverlay) {
        const reapplySelection = () => {
          const layer = document.querySelector(".overlayLayer");
          if (!layer) return;
          const boxes = layer.querySelectorAll(".overlay");
          boxes.forEach((box, idx) => {
            if (idx === lastSelectedOverlay.index) {
              clearSelectedOverlays();
              markOverlaySelected(box, {
                setOverlayPulseColor,
              });
            }
          });
        };
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(reapplySelection);
          });
        });
      }
    }
    const wrap = document.getElementById("menu");
    if (wrap) {
      wrap.scrollTop = 0;
    }
    const closeBtn = document.getElementById("mobileViewerCloseBtn");
    if (closeBtn) {
      setTimeout(() => closeBtn.focus(), 150);
    }
    if (!mobileViewerKeyHandler) {
      mobileViewerKeyHandler = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeMobileViewer();
        }
      };
      document.addEventListener("keydown", mobileViewerKeyHandler);
    }
  }

  function closeMobileViewer() {
    document.body.classList.remove("mobileViewerActive");
    if (mobileViewerChrome) {
      mobileViewerChrome.style.display = "none";
      mobileViewerChrome.setAttribute("aria-hidden", "true");
    }
    resetMobileZoom();
    const mobileInfoPanel = getMobileInfoPanel();
    if (mobileInfoPanel) {
      mobileInfoPanel.classList.remove("show");
      mobileInfoPanel.style.display = "none";
      mobileInfoPanel.innerHTML = "";
      setCurrentMobileInfoItem(null);
    }
    if (prefersMobileInfo()) {
      const renderMobileInfo = getRenderMobileInfo();
      renderMobileInfo(null);
    }
    const openBtn = document.querySelector("#mobileMenuNotice .mobileMenuOpenBtn");
    if (openBtn) {
      setTimeout(() => openBtn.focus(), 150);
    }
    const notice = document.getElementById("mobileMenuNotice");
    if (notice && notice.dataset.enabled === "1") {
      notice.style.display = "flex";
      notice.setAttribute("aria-hidden", "false");
    }
    if (mobileViewerKeyHandler) {
      document.removeEventListener("keydown", mobileViewerKeyHandler);
      mobileViewerKeyHandler = null;
    }
  }

  return {
    captureMenuBaseDimensions,
    ensureMobileViewerChrome,
    updateZoomIndicator,
    updateFullScreenAllergySummary,
    setMobileZoom,
    resetMobileZoom,
    openMobileViewer,
    closeMobileViewer,
    getMobileZoomLevel: () => mobileZoomLevel,
  };
}
