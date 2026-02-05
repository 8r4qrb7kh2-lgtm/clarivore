// --- DEBUG STUBS (Global) ---
const ENABLE_CONSOLE_REPORTING =
  typeof window !== "undefined" && window.__enableConsoleReporting === true;
const noop = () => {};
if (!ENABLE_CONSOLE_REPORTING && typeof console !== "undefined") {
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  window.logDebug = noop;
  window.setDebugJson = noop;
} else {
  // Provide stub implementations for debug functions that may be called elsewhere
  window.logDebug = window.logDebug || ((msg) => console.log("[DEBUG]", msg));
  window.setDebugJson =
    window.setDebugJson ||
    ((data, title) => console.log("[DEBUG-JSON]", title, data));
}

import { ORDER_STATUSES as TabletOrderStatusesConst } from "./tablet-simulation-logic.mjs";
import { setupTopbar } from "./shared-nav.js";
import { createHowItWorksTour } from "./restaurant/how-it-works-tour.js";
import { initOrderFlow } from "./restaurant/order-flow.js";
import { initUnsavedChangesGuard } from "./restaurant/unsaved-changes.js";
import { initDishEditor } from "./restaurant/dish-editor.js";
import { initAutoOpenDish } from "./restaurant/auto-open-dish.js";
import { initIngredientSources } from "./restaurant/ingredient-sources.js";
import { initFeedbackModals } from "./restaurant/feedback-modals.js";
import { initDinerNotifications } from "./diner-notifications.js";
import {
  analyzeBoxSizes,
  splitImageIntoSections,
} from "./restaurant/menu-image-utils.js";
import { detectDishesOnMenu } from "./restaurant/menu-dish-detection.js";
import { initBrandVerification } from "./restaurant/brand-verification.js";
import { initChangeLog } from "./restaurant/change-log.js";
import { initEditorOverlays } from "./restaurant/editor-overlays.js";
import { initMenuImageEditor } from "./restaurant/menu-images.js";
import { initEditorNavigation } from "./restaurant/editor-navigation.js";
import { initEditorSections } from "./restaurant/editor-sections.js";
import { initEditorHistory } from "./restaurant/editor-history.js";
import { initEditorSettings } from "./restaurant/editor-settings.js";
import { initEditorSaveFlow } from "./restaurant/editor-save.js";
import { initOrderConfirmRestore } from "./restaurant/order-confirm-restore.js";
import { initMobileOverlayZoom } from "./restaurant/mobile-overlay-zoom.js";

// Shim globals for module scope
const logDebug = window.logDebug || noop;
const setDebugJson = window.setDebugJson || noop;

const TABLET_ORDER_STATUSES = TabletOrderStatusesConst ?? {
  DRAFT: "draft",
  CODE_ASSIGNED: "awaiting_user_submission",
  SUBMITTED_TO_SERVER: "awaiting_server_approval",
  QUEUED_FOR_KITCHEN: "queued_for_kitchen",
  WITH_KITCHEN: "with_kitchen",
  ACKNOWLEDGED: "acknowledged",
  AWAITING_USER_RESPONSE: "awaiting_user_response",
  QUESTION_ANSWERED: "question_answered",
  REJECTED_BY_SERVER: "rejected_by_server",
  RESCINDED_BY_DINER: "rescinded_by_diner",
  REJECTED_BY_KITCHEN: "rejected_by_kitchen",
};

// Ensure zoom is always allowed on mobile Safari
(function () {
  var m = document.querySelector('meta[name="viewport"]');
  if (m && !/maximum-scale/i.test(m.content)) {
    m.content += ", user-scalable=yes, maximum-scale=10";
  }
  ["touchstart", "touchmove"].forEach(function (t) {
    document.addEventListener(t, function () {}, { passive: true });
  });
})();

const allergenConfig = window.loadAllergenDietConfig
  ? await window.loadAllergenDietConfig()
  : (window.ALLERGEN_DIET_CONFIG || {});
const ALLERGENS = Array.isArray(allergenConfig.ALLERGENS)
  ? allergenConfig.ALLERGENS
  : [];
const DIETS = Array.isArray(allergenConfig.DIETS) ? allergenConfig.DIETS : [];

let openBrandIdentificationChoice = () => {};
let showIngredientPhotoUploadModal = () => {};
let showPhotoAnalysisLoadingInRow = () => {};
let hidePhotoAnalysisLoadingInRow = () => {};
let updatePhotoAnalysisLoadingStatus = () => {};
let showPhotoAnalysisResultButton = () => {};
let collectAllBrandItems = null;
let openBrandVerification = () => {};
let openChangeLog = () => {};
let openFeedbackModal = () => {};
let openReportIssueModal = () => {};
let rebuildBrandMemoryFromRestaurant = () => {};
let aiAssistState = null;
let aiAssistSetStatus = () => {};
let ensureAiAssistElements = () => {};
let collectAiTableData = () => [];
let renderAiTable = () => {};
let openDishEditor = () => {};
let handleDishEditorResult = () => {};
let handleDishEditorError = () => {};
let getAiAssistBackdrop = () => null;
let getAiAssistTableBody = () => null;
const ALLERGEN_EMOJI =
  allergenConfig.ALLERGEN_EMOJI &&
  typeof allergenConfig.ALLERGEN_EMOJI === "object"
    ? allergenConfig.ALLERGEN_EMOJI
    : {};
const DIET_EMOJI =
  allergenConfig.DIET_EMOJI && typeof allergenConfig.DIET_EMOJI === "object"
    ? allergenConfig.DIET_EMOJI
    : {};
const normalizeAllergen =
  typeof allergenConfig.normalizeAllergen === "function"
    ? allergenConfig.normalizeAllergen
    : (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) return "";
        if (!ALLERGENS.length) return raw;
        return ALLERGENS.includes(raw) ? raw : "";
      };
const getDietAllergenConflicts =
  typeof allergenConfig.getDietAllergenConflicts === "function"
    ? allergenConfig.getDietAllergenConflicts
    : () => [];
const state = {
  page: null,
  restaurants: [],
  restaurant: null,
  allergies: [],
  diets: [],
  ack: false,
  user: { loggedIn: false },
  canEdit: false,
  qr: false,
  _hydrated: false,
  aiAssistEndpoint: null,
  isHowItWorks: false,
  guestFilterEditing: false,
};
let maybeInitHowItWorksTour = () => {};
let hasUnsavedChanges = () => false;
let showUnsavedChangesModal = () => {};
let editorSaveApi = null;
let navigateWithCheck = (url) => {
  window.location.href = url;
};
window.lovedDishesSet = window.lovedDishesSet || new Set();
window.orderItems = window.orderItems || [];
window.orderItemSelections = window.orderItemSelections || new Set();
let rootOffsetPadding = "0";

let mobileInfoPanel = null;
let currentMobileInfoItem = null;
let mobileViewerChrome = null;
let mobileZoomLevel = 1;
let mobileViewerKeyHandler = null;

let zoomToOverlay = () => {};
let zoomOutOverlay = () => {};
let isOverlayZoomed = false;
let zoomedOverlayItem = null;

function ensureMobileInfoPanel() {
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
  }
  // Set positioning based on full-screen mode
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

function adjustMobileInfoPanelForZoom() {
  // No longer needed since pinch-to-zoom is disabled
  // Keeping function for compatibility
}

function getMenuState() {
  if (!window.__menuState) window.__menuState = {};
  return window.__menuState;
}

function getIssueReportMeta() {
  const user = state?.user || null;
  const pageUrl = window.location.href;
  let accountName = "";
  if (user) {
    const firstName = user.user_metadata?.first_name || "";
    const lastName = user.user_metadata?.last_name || "";
    accountName = `${firstName} ${lastName}`.trim();
    if (!accountName)
      accountName = (user.user_metadata?.full_name || "").trim();
    if (!accountName)
      accountName = (user.raw_user_meta_data?.full_name || "").trim();
    if (!accountName) accountName = (user.name || "").trim();
    if (!accountName) accountName = (user.email || "").trim();
  }

  return {
    pageUrl,
    userEmail: user?.email || null,
    reporterName: accountName || null,
    accountName: accountName || null,
    accountId: user?.id || null,
  };
}

// Resize legend text to fit container width using CSS transform scale
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

// Resize legend on window resize
window.addEventListener("resize", () => {
  if (document.getElementById("legendRow")?.style.display !== "none") {
    resizeLegendToFit();
  }
});

function captureMenuBaseDimensions(force = false) {
  const state = getMenuState();
  const img = state?.img;
  if (!img) return;
  if (force || !state.baseWidth) {
    state.baseWidth = img.clientWidth || img.naturalWidth || img.width || 0;
    state.baseHeight = img.clientHeight || img.naturalHeight || img.height || 0;
  }
}

function ensureMobileViewerChrome() {
  if (mobileViewerChrome && mobileViewerChrome.isConnected)
    return mobileViewerChrome;
  let chrome = document.getElementById("mobileViewerChrome");
  if (!chrome) {
    chrome = document.createElement("div");
    chrome.id = "mobileViewerChrome";
    chrome.innerHTML = `
  <div class="chromeTop">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;pointer-events:auto;">
      <button type="button" class="mobileViewerControlBtn" id="mobileViewerCloseBtn">Close</button>
      <div class="mobileZoomGroup">
        <button type="button" id="mobileZoomOutBtn" aria-label="Zoom out">−</button>
        <span id="mobileZoomValue">100%</span>
        <button type="button" id="mobileZoomInBtn" aria-label="Zoom in">+</button>
      </div>
    </div>
    <div class="mobileViewerSummary" id="mobileViewerAllergySummary" aria-live="polite"></div>
  </div>`;
    document.body.appendChild(chrome);
  }
  if (!chrome.style.display) chrome.style.display = "none";
  if (!chrome.hasAttribute("aria-hidden"))
    chrome.setAttribute("aria-hidden", "true");
  mobileViewerChrome = chrome;
  const closeBtn = chrome.querySelector("#mobileViewerCloseBtn");
  const zoomOutBtn = chrome.querySelector("#mobileZoomOutBtn");
  const zoomInBtn = chrome.querySelector("#mobileZoomInBtn");
  if (closeBtn) closeBtn.onclick = () => closeMobileViewer();
  if (zoomOutBtn)
    zoomOutBtn.onclick = () => setMobileZoom(mobileZoomLevel - 0.25);
  if (zoomInBtn)
    zoomInBtn.onclick = () => setMobileZoom(mobileZoomLevel + 0.25);
  updateFullScreenAllergySummary();
  return mobileViewerChrome;
}

function updateZoomIndicator() {
  const indicator = document.getElementById("mobileZoomValue");
  if (indicator)
    indicator.textContent = `${Math.round(mobileZoomLevel * 100)}%`;
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

    // Allergens with emoji badges
    if (uniqueKeys.length) {
      const allergenBadges = uniqueKeys
        .map((a) => {
          const emoji = ALLERGEN_EMOJI[a] || "🔴";
          return `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(76,90,212,0.25);border:1px solid rgba(76,90,212,0.4);border-radius:999px;padding:3px 8px;font-size:0.8rem;white-space:nowrap;"><span>${emoji}</span><span>${esc(formatAllergenLabel(a))}</span></span>`;
        })
        .join("");
      html += `<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;"><span class="label">Allergens:</span>${allergenBadges}</div>`;
    }

    // Dietary preferences with emoji
    if (selectedDiets.length) {
      const dietBadges = selectedDiets
        .map((d) => {
          const emoji = DIET_EMOJI[d] || "🍽️";
          return `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.4);border-radius:999px;padding:3px 8px;font-size:0.8rem;white-space:nowrap;"><span>${emoji}</span><span>${esc(d)}</span></span>`;
        })
        .join("");
      html += `<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:${uniqueKeys.length ? "5px" : "0"}"><span class="label">Diets:</span>${dietBadges}</div>`;
    }

    html += "</div>";
  } else {
    html = `<div class="mobileViewerSummaryInner"><span class="values">No allergens or diets selected</span></div>`;
  }
  summary.innerHTML = html;
}

function setMobileZoom(level, resetBase = false) {
  const state = getMenuState();
  const img = state?.img;
  if (!img) return;
  if (resetBase) {
    state.baseWidth = null;
    state.baseHeight = null;
  }
  captureMenuBaseDimensions(resetBase);
  if (!state.baseWidth) {
    updateZoomIndicator();
    return;
  }
  mobileZoomLevel = Math.min(Math.max(level, 1), 4);
  const width = state.baseWidth * mobileZoomLevel;
  const inner = state.inner;
  const layer = state.layer;
  img.style.width = width + "px";
  if (inner) inner.style.width = width + "px";
  if (layer) layer.style.width = width + "px";
  requestAnimationFrame(() => {
    if (window.__rerenderLayer__) window.__rerenderLayer__();
    updateZoomIndicator();
  });
}

function resetMobileZoom() {
  const state = getMenuState();
  mobileZoomLevel = 1;
  const img = state?.img;
  if (img) {
    img.style.width = "";
    if (state.inner) state.inner.style.width = "";
    if (state.layer) state.layer.style.width = "";
  }
  requestAnimationFrame(() => {
    if (window.__rerenderLayer__) window.__rerenderLayer__();
    captureMenuBaseDimensions(true);
    updateZoomIndicator();
  });
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
    // Force re-render to update panel size for full-screen mode
    // Use multiple timing approaches to ensure it updates
    const updatePanel = () => {
      if (currentMobileInfoItem && mobileInfoPanel) {
        // Update positioning to full width for full-screen mode - use setProperty with important
        mobileInfoPanel.style.setProperty("left", "0", "important");
        mobileInfoPanel.style.setProperty("right", "0", "important");
        mobileInfoPanel.style.setProperty("bottom", "0", "important");
        // Force re-render to apply full width
        renderMobileInfo(currentMobileInfoItem);
      } else {
        renderMobileInfo(null);
      }
    };
    // Try immediately
    requestAnimationFrame(() => {
      requestAnimationFrame(updatePanel);
    });
    // Also try after a short delay as backup
    setTimeout(updatePanel, 50);
    setTimeout(updatePanel, 150);
    // Re-apply selected class to overlay if one was selected before (for dish search navigation)
    // This is needed because setMobileZoom calls renderLayer which removes all selected classes
    if (currentMobileInfoItem && window.__lastSelectedOverlay) {
      const reapplySelection = () => {
        const layer = document.querySelector(".overlayLayer");
        if (layer) {
          const boxes = layer.querySelectorAll(".overlay");
          boxes.forEach((box, idx) => {
            if (idx === window.__lastSelectedOverlay.index) {
              document
                .querySelectorAll(".overlay")
                .forEach((ov) => ov.classList.remove("selected"));
              box.classList.add("selected");
              setOverlayPulseColor(box);
            }
          });
        }
      };
      // Reapply after renderLayer has finished (which runs in requestAnimationFrame after setMobileZoom)
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
    mobileViewerKeyHandler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
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
  // Close the mobile info panel if it's open
  if (mobileInfoPanel) {
    mobileInfoPanel.classList.remove("show");
    mobileInfoPanel.style.display = "none";
    mobileInfoPanel.innerHTML = "";
    currentMobileInfoItem = null;
  }
  if (prefersMobileInfo()) {
    if (currentMobileInfoItem) {
      renderMobileInfo(currentMobileInfoItem);
    } else {
      renderMobileInfo(null);
    }
  }
  const openBtn = document.querySelector(
    "#mobileMenuNotice .mobileMenuOpenBtn",
  );
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

const urlQR =
  typeof window.__qrVisit === "boolean"
    ? window.__qrVisit
    : (() => {
        const v = new URLSearchParams(location.search).get("qr");
        return v && /^(1|true|yes)$/i.test(v);
      })();

const QR_PROMO_STORAGE_KEY = "qrPromoDismissed";
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
  } catch (_) {}
}
let qrPromoTimerId = null;
function cancelQrPromoTimer() {
  if (qrPromoTimerId) {
    clearTimeout(qrPromoTimerId);
    qrPromoTimerId = null;
  }
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
function isDishInfoPopupOpen() {
  // Check if mobile info panel is showing
  const mobilePanel = document.getElementById("mobileInfoPanel");
  if (mobilePanel && mobilePanel.classList.contains("show")) return true;
  // Check if desktop tooltip is pinned open (tipPinned is declared later, check via window or direct)
  if (typeof tipPinned !== "undefined" && tipPinned) return true;
  return false;
}
function openQrPromo() {
  const backdrop = document.getElementById("qrPromoBackdrop");
  if (!backdrop || backdrop.classList.contains("show")) return;
  // If a dish info popup is open, wait for it to close before showing promo
  if (isDishInfoPopupOpen()) {
    // Re-check in 2 seconds
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
function closeQrPromo(reason = "dismiss") {
  const backdrop = document.getElementById("qrPromoBackdrop");
  if (backdrop && backdrop.classList.contains("show")) {
    backdrop.classList.remove("show");
    backdrop.setAttribute("aria-hidden", "true");
  }
  if (reason !== "login") dismissQrPromo();
  cancelQrPromoTimer();
}

// Handle navigation in standalone mode
const isStandalone = window === window.parent;
const send = (p) => {
  if (isStandalone) {
    // Handle navigation directly in standalone mode
    if (p.type === "navigate") {
      if (p.to === "/restaurants") window.location.href = "restaurants.html";
      else if (p.to === "/favorites") window.location.href = "favorites.html";
      else if (p.to === "/dish-search")
        window.location.href = "dish-search.html";
      else if (p.to === "/my-dishes") window.location.href = "my-dishes.html";
      else if (p.to === "/report-issue")
        window.location.href = "report-issue.html";
      else if (p.to === "/accounts") {
        const params = new URLSearchParams();
        if (p.slug) params.set("returnSlug", p.slug);
        if (p.redirect) params.set("redirect", p.redirect);
        const url =
          "account.html" + (params.toString() ? `?${params.toString()}` : "");
        window.location.href = url;
      } else window.location.href = p.to;
    } else if (p.type === "signIn") {
      const params = new URLSearchParams();
      if (p.slug) params.set("returnSlug", p.slug);
      if (p.redirect) params.set("redirect", p.redirect);
      const url =
        "account.html" + (params.toString() ? `?${params.toString()}` : "");
      window.location.href = url;
    } else if (p.type === "openRestaurant") {
      window.location.href = `restaurant.html?slug=${p.slug}`;
    } else if (p.type === "saveOverlays") {
      (async () => {
        // Declare variables outside try block so they're accessible in catch
        let payload = {};
        let overlaysToSave = [];

        try {
          const client = window.supabaseClient;
          if (!client) throw new Error("Supabase client not ready.");
          const restaurantId =
            state.restaurant?._id || state.restaurant?.id || null;
          if (!restaurantId) throw new Error("Restaurant not loaded yet.");

          const INLINE_IMAGE_PREFIX = "data:image";
          const MAX_INLINE_IMAGE_LENGTH = 200000;
          const IMAGE_BUCKET = "ingredient-appeals";
          const uploadedImageCache = new Map();

          const uploadInlineImage = async (dataUrl, label) => {
            if (
              !dataUrl ||
              typeof dataUrl !== "string" ||
              !dataUrl.startsWith(INLINE_IMAGE_PREFIX)
            ) {
              return dataUrl;
            }
            if (uploadedImageCache.has(dataUrl)) {
              return uploadedImageCache.get(dataUrl);
            }

            let publicUrl = null;
            try {
              if (client?.storage) {
                const blob = await (await fetch(dataUrl)).blob();
                const ext =
                  blob.type && blob.type.includes("png") ? "png" : "jpg";
                const filePath = `ingredient-images/${label}-${Date.now()}-${Math.random()
                  .toString(36)
                  .slice(2)}.${ext}`;
                const { error: uploadError } = await client.storage
                  .from(IMAGE_BUCKET)
                  .upload(filePath, blob, {
                    contentType: blob.type || "image/jpeg",
                    upsert: false,
                  });
                if (uploadError) {
                  console.warn(
                    "Inline image upload failed - keeping fallback data URL:",
                    uploadError,
                  );
                } else {
                  const { data: urlData } = client.storage
                    .from(IMAGE_BUCKET)
                    .getPublicUrl(filePath);
                  if (urlData?.publicUrl) {
                    publicUrl = urlData.publicUrl;
                  }
                }
              }
            } catch (uploadErr) {
              console.warn(
                "Inline image upload exception - keeping fallback data URL:",
                uploadErr,
              );
            }

            let finalValue = publicUrl || dataUrl;
            if (!publicUrl && dataUrl.length > MAX_INLINE_IMAGE_LENGTH) {
              console.warn(
                "Dropping large inline image to avoid save failure.",
              );
              finalValue = "";
            }
            uploadedImageCache.set(dataUrl, finalValue);
            return finalValue;
          };

          const sanitizeAiIngredientsImages = async (aiIngredients) => {
            if (!aiIngredients) return aiIngredients;
            const raw =
              typeof aiIngredients === "string"
                ? aiIngredients
                : JSON.stringify(aiIngredients);
            if (!raw || !raw.includes(INLINE_IMAGE_PREFIX)) {
              return aiIngredients;
            }
            let rows = null;
            try {
              rows = JSON.parse(raw);
            } catch (parseErr) {
              console.warn("Failed to parse aiIngredients for sanitizing.");
              return aiIngredients;
            }
            if (!Array.isArray(rows)) return aiIngredients;
            for (const row of rows) {
              if (!row || typeof row !== "object") continue;
              row.ingredientsImage = await uploadInlineImage(
                row.ingredientsImage,
                "label",
              );
              row.brandImage = await uploadInlineImage(
                row.brandImage,
                "brand",
              );
              if (Array.isArray(row.brands)) {
                for (const brand of row.brands) {
                  if (!brand || typeof brand !== "object") continue;
                  brand.ingredientsImage = await uploadInlineImage(
                    brand.ingredientsImage,
                    "label",
                  );
                  brand.brandImage = await uploadInlineImage(
                    brand.brandImage,
                    "brand",
                  );
                }
              }
            }
            return JSON.stringify(rows);
          };

          const parseAiIngredients = (value) => {
            if (!value) return [];
            if (Array.isArray(value)) return value;
            if (typeof value === "string") {
              try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed : [];
              } catch (_) {
                return [];
              }
            }
            return [];
          };

          const normalizeRowText = (row) => {
            const name = String(row?.name || row?.ingredient || "").trim();
            if (name) return name;
            const list = Array.isArray(row?.ingredientsList)
              ? row.ingredientsList.filter(Boolean)
              : [];
            if (list.length) return list.join(", ");
            return "";
          };

          let ingredientLookupCache = null;
          const loadIngredientLookup = async () => {
            if (ingredientLookupCache) return ingredientLookupCache;
            const [allergensRes, dietsRes] = await Promise.all([
              client
                .from("allergens")
                .select("id, key, is_active")
                .eq("is_active", true),
              client
                .from("diets")
                .select("id, label, is_active, is_supported")
                .eq("is_active", true),
            ]);
            if (allergensRes.error) throw allergensRes.error;
            if (dietsRes.error) throw dietsRes.error;

            const allergenIdByKey = new Map();
            (allergensRes.data || []).forEach((row) => {
              if (row?.key && row?.id) {
                allergenIdByKey.set(row.key, row.id);
              }
            });

            const dietIdByLabel = new Map();
            const supportedDietLabels = [];
            (dietsRes.data || []).forEach((row) => {
              const label = String(row?.label || "").trim();
              if (!label || !row?.id) return;
              dietIdByLabel.set(label, row.id);
              if (row?.is_supported !== false) {
                supportedDietLabels.push(label);
              }
            });

            ingredientLookupCache = {
              allergenIdByKey,
              dietIdByLabel,
              supportedDietLabels,
            };
            return ingredientLookupCache;
          };

          const coerceRowIndex = (value, fallback) => {
            const parsed = Number.parseInt(value, 10);
            return Number.isFinite(parsed) ? parsed : fallback;
          };

          const syncIngredientStatusTablesDirect = async (overlaysList) => {
            const lookup = await loadIngredientLookup();
            const overlaysArray = Array.isArray(overlaysList) ? overlaysList : [];
            for (const overlay of overlaysArray) {
              const dishName = overlay?.id || overlay?.name;
              if (!dishName) continue;

              const rawRows = parseAiIngredients(overlay?.aiIngredients);
              const rows = Array.isArray(rawRows) ? rawRows : [];

              const { error: deleteError } = await client
                .from("dish_ingredient_rows")
                .delete()
                .eq("restaurant_id", restaurantId)
                .eq("dish_name", dishName);
              if (deleteError) throw deleteError;

              if (!rows.length) continue;

              const rowPayload = rows.map((row, idx) => ({
                restaurant_id: restaurantId,
                dish_name: dishName,
                row_index: coerceRowIndex(row?.index, idx),
                row_text: normalizeRowText(row) || null,
              }));

              const { data: insertedRows, error: insertError } = await client
                .from("dish_ingredient_rows")
                .insert(rowPayload)
                .select("id, row_index");
              if (insertError) throw insertError;

              const rowIdByIndex = new Map(
                (insertedRows || []).map((row) => [row.row_index, row.id]),
              );

              const allergenEntries = [];
              const dietEntries = [];
              const supportedDietLabels = lookup.supportedDietLabels || [];

              rows.forEach((row, idx) => {
                const rowIndex = coerceRowIndex(row?.index, idx);
                const rowId = rowIdByIndex.get(rowIndex);
                if (!rowId) return;

                const isRemovable = row?.removable === true;
                const allergens = Array.isArray(row?.allergens)
                  ? row.allergens
                  : [];
                const crossContamination = Array.isArray(row?.crossContamination)
                  ? row.crossContamination
                  : [];
                const allergenStatus = new Map();

                allergens.forEach((key) => {
                  if (!key) return;
                  allergenStatus.set(key, {
                    is_violation: true,
                    is_cross_contamination: false,
                  });
                });
                crossContamination.forEach((key) => {
                  if (!key) return;
                  const existing =
                    allergenStatus.get(key) || {
                      is_violation: false,
                      is_cross_contamination: false,
                    };
                  existing.is_cross_contamination = true;
                  allergenStatus.set(key, existing);
                });

                allergenStatus.forEach((status, key) => {
                  const allergenId = lookup.allergenIdByKey.get(key);
                  if (!allergenId) return;
                  allergenEntries.push({
                    ingredient_row_id: rowId,
                    allergen_id: allergenId,
                    is_violation: status.is_violation,
                    is_cross_contamination: status.is_cross_contamination,
                    is_removable: isRemovable,
                  });
                });

                const diets = Array.isArray(row?.diets) ? row.diets : [];
                const crossContaminationDiets = Array.isArray(row?.crossContaminationDiets)
                  ? row.crossContaminationDiets
                  : [];
                const dietSet = new Set(diets);
                const crossContaminationSet = new Set(crossContaminationDiets);
                const compatible = new Set([
                  ...dietSet,
                  ...crossContaminationSet,
                ]);

                supportedDietLabels.forEach((label) => {
                  const dietId = lookup.dietIdByLabel.get(label);
                  if (!dietId) return;
                  if (crossContaminationSet.has(label)) {
                    dietEntries.push({
                      ingredient_row_id: rowId,
                      diet_id: dietId,
                      is_violation: false,
                      is_cross_contamination: true,
                      is_removable: isRemovable,
                    });
                    return;
                  }
                  if (!compatible.has(label)) {
                    dietEntries.push({
                      ingredient_row_id: rowId,
                      diet_id: dietId,
                      is_violation: true,
                      is_cross_contamination: false,
                      is_removable: isRemovable,
                    });
                  }
                });
              });

              if (allergenEntries.length) {
                const { error: allergenError } = await client
                  .from("dish_ingredient_allergens")
                  .insert(allergenEntries);
                if (allergenError) throw allergenError;
              }
              if (dietEntries.length) {
                const { error: dietError } = await client
                  .from("dish_ingredient_diets")
                  .insert(dietEntries);
                if (dietError) throw dietError;
              }
            }
          };

          const syncIngredientStatusTables = async (overlaysList) => {
            const overlaysArray = Array.isArray(overlaysList) ? overlaysList : [];
            const sessionResult = await client.auth.getSession();
            const accessToken =
              sessionResult?.data?.session?.access_token || null;
            if (!accessToken) {
              throw new Error("Missing auth session for ingredient sync.");
            }

            const minimalOverlays = overlaysArray.map((overlay) => ({
              id: overlay?.id,
              name: overlay?.name,
              dishName: overlay?.id || overlay?.name,
              aiIngredients: overlay?.aiIngredients,
            }));

            try {
              const response = await fetch("/api/ingredient-status-sync", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                  restaurantId,
                  overlays: minimalOverlays,
                }),
              });
              if (!response.ok) {
                const message = await response.text();
                throw new Error(
                  `Ingredient sync failed (${response.status}): ${message}`,
                );
              }
            } catch (error) {
              console.warn(
                "Prisma ingredient sync failed, falling back to direct sync.",
                error,
              );
              await syncIngredientStatusTablesDirect(overlaysList);
            }
          };

          // Ensure aiIngredients and aiIngredientSummary are preserved on all overlays
          overlaysToSave = [];
          for (const overlay of p.overlays || []) {
            // Create a new object to ensure all fields are preserved
            const savedOverlay = { ...overlay };
            // Explicitly preserve aiIngredients if it exists
            if (overlay.aiIngredients !== undefined) {
              savedOverlay.aiIngredients = await sanitizeAiIngredientsImages(
                overlay.aiIngredients,
              );
            }
            // Explicitly preserve aiIngredientSummary if it exists
            if (overlay.aiIngredientSummary !== undefined) {
              savedOverlay.aiIngredientSummary = overlay.aiIngredientSummary;
            }
            // Explicitly preserve recipeDescription if it exists
            if (overlay.recipeDescription !== undefined) {
              savedOverlay.recipeDescription = overlay.recipeDescription;
            }
            overlaysToSave.push(savedOverlay);
          }

          payload = { overlays: overlaysToSave };
          // Support both single image (backward compatible) and multiple images
          if (
            p.menuImages &&
            Array.isArray(p.menuImages) &&
            p.menuImages.length > 0
          ) {
            // Save array to menu_images column (JSONB)
            payload.menu_images = p.menuImages;
            // Also save first image to menu_image for backward compatibility
            payload.menu_image = p.menuImages[0] || "";
          } else if (p.menuImage) {
            payload.menu_image = p.menuImage;
            // If menu_image is set but menu_images isn't, ensure menu_images is also set
            if (!p.menuImages) {
              payload.menu_images = [p.menuImage];
            }
          }
          // Include restaurant settings if they were changed
          if (p.restaurantSettings) {
            payload.website = p.restaurantSettings.website;
            payload.phone = p.restaurantSettings.phone;
            payload.delivery_url = p.restaurantSettings.delivery_url;
            console.log("Saving restaurant settings:", p.restaurantSettings);
          }

          console.log(
            "Saving overlays with aiIngredients preservation:",
            overlaysToSave.map((o) => ({
              id: o.id,
              hasAiIngredients: !!o.aiIngredients,
              aiIngredientsLength: o.aiIngredients
                ? typeof o.aiIngredients === "string"
                  ? o.aiIngredients.length
                  : JSON.stringify(o.aiIngredients).length
                : 0,
            })),
          );

          const { error } = await client
            .from("restaurants")
            .update(payload)
            .eq("id", restaurantId);

          if (error) {
            console.error("Supabase update error:", error);
            console.error("Error details:", {
              message: error.message,
              code: error.code,
              details: error.details,
              hint: error.hint,
              payloadSize: JSON.stringify(payload).length,
              overlaysCount: overlaysToSave.length,
              payloadKeys: Object.keys(payload),
              restaurantId: restaurantId,
              sampleOverlay: overlaysToSave[0]
                ? {
                    id: overlaysToSave[0].id,
                    hasAiIngredients: !!overlaysToSave[0].aiIngredients,
                    aiIngredientsLength: overlaysToSave[0].aiIngredients
                      ? typeof overlaysToSave[0].aiIngredients === "string"
                        ? overlaysToSave[0].aiIngredients.length
                        : JSON.stringify(overlaysToSave[0].aiIngredients).length
                      : 0,
                    keys: Object.keys(overlaysToSave[0]),
                  }
                : null,
              fullPayload: JSON.stringify(payload, null, 2),
            });
            throw error;
          }

          await syncIngredientStatusTables(overlaysToSave);

          console.log(
            "Saved overlays response:",
            overlaysToSave.map((o) => ({
              id: o.id,
              hasAiIngredients: !!o.aiIngredients,
              aiIngredientsLength: o.aiIngredients
                ? typeof o.aiIngredients === "string"
                  ? o.aiIngredients.length
                  : JSON.stringify(o.aiIngredients).length
                : 0,
            })),
          );

          const nextRestaurant = {
            ...(state.restaurant || {}),
            overlays: overlaysToSave,
          };
          if (Object.prototype.hasOwnProperty.call(payload, "menu_images")) {
            nextRestaurant.menu_images = payload.menu_images;
            nextRestaurant.menu_image = payload.menu_image;
            nextRestaurant.menuImages = payload.menu_images;
            nextRestaurant.menuImage = payload.menu_image;
          }
          if (Object.prototype.hasOwnProperty.call(payload, "menu_image")) {
            nextRestaurant.menu_image = payload.menu_image;
            nextRestaurant.menuImage = payload.menu_image;
          }
          if (Object.prototype.hasOwnProperty.call(payload, "website")) {
            nextRestaurant.website = payload.website;
          }
          if (Object.prototype.hasOwnProperty.call(payload, "phone")) {
            nextRestaurant.phone = payload.phone;
          }
          if (Object.prototype.hasOwnProperty.call(payload, "delivery_url")) {
            nextRestaurant.delivery_url = payload.delivery_url;
          }

          const updatedRestaurant = normalizeRestaurant(nextRestaurant);
          // Update state.restaurant with the saved data
          if (state.restaurant) {
            state.restaurant = updatedRestaurant;
          }
          // Update originalRestaurantSettings after successful save if settings were included
          // Access it through the message handler's closure
          if (
            p.restaurantSettings &&
            typeof window.updateOriginalRestaurantSettings === "function"
          ) {
            window.updateOriginalRestaurantSettings({
              website: p.restaurantSettings.website,
              phone: p.restaurantSettings.phone,
              delivery_url: p.restaurantSettings.delivery_url,
            });
          }
          window.postMessage(
            { type: "overlaysSaved", restaurant: updatedRestaurant },
            "*",
          );

          const rawChangePayload = p.changes;
          let changePayload = null;
          if (
            rawChangePayload &&
            typeof rawChangePayload === "object" &&
            !Array.isArray(rawChangePayload)
          ) {
            changePayload = rawChangePayload;
          } else if (typeof rawChangePayload === "string") {
            try {
              changePayload = JSON.parse(rawChangePayload);
            } catch (_) {
              changePayload = null;
            }
          }

          let authorName = "Manager";
          if (state.user?.name) {
            authorName = state.user.name;
          } else if (
            state.user?.user_metadata?.first_name ||
            state.user?.user_metadata?.last_name
          ) {
            const first = state.user.user_metadata.first_name || "";
            const last = state.user.user_metadata.last_name || "";
            authorName = `${first} ${last}`.trim();
          } else if (state.user?.email) {
            authorName = state.user.email.split("@")[0];
          }

          if (changePayload && changePayload.author) {
            authorName = changePayload.author;
          }

          const storedChanges = changePayload
            ? JSON.stringify(changePayload)
            : typeof rawChangePayload === "string"
              ? rawChangePayload
              : "Menu overlays updated.";

          try {
            await insertChangeLogEntry({
              restaurantId,
              timestamp: new Date().toISOString(),
              type: "update",
              description: authorName,
              changes: storedChanges,
              userEmail: state.user?.email || null,
            });
            console.log("Change log entry saved successfully:", {
              restaurantId,
              authorName,
              changesLength: storedChanges.length,
            });
          } catch (logError) {
            console.error("Change log insert failed:", logError);
            console.error("Change log insert context:", {
              restaurantId,
              authorName,
              userEmail: state.user?.email,
              isAuthenticated: !!state.user,
              changesLength: storedChanges?.length || 0,
            });
          }
        } catch (err) {
          console.error("Saving overlays failed", err);
          const errorPayload = payload || {};
          console.error("Error details:", {
            message: err.message,
            code: err.code,
            details: err.details,
            hint: err.hint,
            stack: err.stack,
            payloadSize: JSON.stringify(errorPayload).length,
            overlaysCount: overlaysToSave.length,
            payloadKeys: Object.keys(payload),
            samplePayload: payload.overlays ? payload.overlays[0] : null,
          });
          window.postMessage(
            {
              type: "saveFailed",
              message: err.message || "Unknown error occurred",
              error: err,
            },
            "*",
          );
        }
      })();
      return;
    } else if (p.type === "confirmAllergens") {
      (async () => {
        try {
          const client = window.supabaseClient;
          if (!client) throw new Error("Supabase client not ready.");
          const restaurantId =
            state.restaurant?._id || state.restaurant?.id || null;
          if (!restaurantId) throw new Error("Restaurant not loaded yet.");
          const timestamp = p.timestamp || new Date().toISOString();

          const { data: updated, error } = await client
            .from("restaurants")
            .update({ last_confirmed: timestamp })
            .eq("id", restaurantId)
            .select()
            .single();
          if (error) throw error;

          try {
            let userName = "Manager";
            if (state.user?.name) {
              userName = state.user.name;
            } else if (
              state.user?.user_metadata?.first_name ||
              state.user?.user_metadata?.last_name
            ) {
              const first = state.user.user_metadata.first_name || "";
              const last = state.user.user_metadata.last_name || "";
              userName = `${first} ${last}`.trim();
            } else if (state.user?.email) {
              userName = state.user.email.split("@")[0];
            }
            const confirmPayload = {
              author: userName,
              general: ["Information confirmed to be up-to-date"],
              items: {},
            };
            await insertChangeLogEntry({
              restaurantId,
              timestamp,
              type: "confirm",
              description: userName,
              changes: JSON.stringify(confirmPayload),
              userEmail: state.user?.email || null,
              photos: p.photos || (p.photo ? [p.photo] : []),
            });
          } catch (logError) {
            console.error("Change log insert failed", logError);
          }

          window.postMessage(
            {
              type: "confirmationSaved",
              restaurant: normalizeRestaurant(updated),
              timestamp,
            },
            "*",
          );
        } catch (err) {
          console.error("Confirmation failed", err);
          window.postMessage(
            { type: "confirmationFailed", message: err.message },
            "*",
          );
        }
      })();
      return;
    } else if (p.type === "getChangeLog") {
      (async () => {
        try {
          const logs = await fetchChangeLogEntries(
            p.restaurantId ||
              state.restaurant?._id ||
              state.restaurant?.id ||
              null,
          );
          window.postMessage({ type: "changeLog", logs: logs || [] }, "*");
        } catch (err) {
          console.error("Loading change log failed", err);
          window.postMessage(
            { type: "changeLog", logs: [], error: err.message },
            "*",
          );
        }
      })();
      return;
    }
    // For other message types, just log them in standalone mode
    console.log("Message sent:", p);
  } else {
    // In iframe mode, use postMessage
    parent.postMessage(p, "*");
  }
};
const orderFlow = initOrderFlow({
  state,
  send,
  resizeLegendToFit,
  supabaseClient: window.supabaseClient,
});
const {
  applyDefaultUserName,
  rerenderOrderConfirmDetails,
  renderOrderSidebarStatus,
  persistTabletStateSnapshot,
  ensureAddToOrderConfirmContainer,
  showAddToOrderConfirmation,
  hideAddToOrderConfirmation,
  addDishToOrder,
  getDishCompatibilityDetails,
  restoreOrderFormState,
  updateOrderSidebar,
  updateOrderSidebarBadge,
  getOrderFormStateStorageKey,
  openOrderSidebar,
  setOrderSidebarVisibility,
  restoreOrderItems,
  clearOrderItemSelections,
  persistOrderItems,
  stopOrderRefresh,
  checkForActiveOrders,
  openOrderConfirmDrawer,
  renderOrderConfirm,
  getTabletOrderById,
  getTabletOrder,
  confirmOrder,
  checkUserAuth,
  updateOrderConfirmAuthState,
  initOrderSidebar,
} = orderFlow;
function requestSignIn(origin) {
  const slugParam = (state.restaurant && state.restaurant.slug) || slug || "";
  const payload = { type: "signIn" };
  if (slugParam) payload.slug = slugParam;
  if (origin === "restaurants") payload.redirect = "restaurants";
  if (origin === "qr") payload.from = "qr";
  send(payload);
}
const qrPromoBackdrop = document.getElementById("qrPromoBackdrop");
const qrPromoCloseBtn = document.getElementById("qrPromoClose");
const qrPromoSignupBtn = document.getElementById("qrPromoSignup");
if (qrPromoBackdrop) {
  qrPromoBackdrop.addEventListener("click", (e) => {
    if (e.target === qrPromoBackdrop) closeQrPromo("dismiss");
  });
}
if (qrPromoCloseBtn) {
  qrPromoCloseBtn.onclick = () => closeQrPromo("dismiss");
}
if (qrPromoSignupBtn) {
  qrPromoSignupBtn.onclick = () => {
    closeQrPromo("signup");
    // Check for invite token and redirect directly to preserve it
    const inviteParam = new URLSearchParams(window.location.search).get(
      "invite",
    );
    if (inviteParam) {
      window.location.href = `account.html?invite=${encodeURIComponent(inviteParam)}`;
    } else {
      requestSignIn("qr");
    }
  };
}
const esc = (s) =>
  (s ?? "").toString().replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[m],
  );
const norm = (value) => String(value ?? "").toLowerCase().trim();
const cap = (s) =>
  (s || "")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
const formatAllergenLabel =
  typeof allergenConfig.formatAllergenLabel === "function"
    ? allergenConfig.formatAllergenLabel
    : (value) => cap(value);

const setOverlayPulseColor = (overlayElement) => {
  if (!overlayElement) return;

  const borderColor = getComputedStyle(overlayElement).borderColor || "";
  const match = borderColor.match(/rgba?\(([^)]+)\)/i);
  if (match) {
    const rgbParts = match[1]
      .split(",")
      .slice(0, 3)
      .map((value) => Math.round(parseFloat(value.trim())))
      .filter((value) => Number.isFinite(value));

    if (rgbParts.length === 3) {
      overlayElement.style.setProperty("--pulse-rgb", rgbParts.join(", "));
    }
  }

  overlayElement.style.zIndex = "1010";
};
window.setOverlayPulseColor = setOverlayPulseColor;

function hidePageLoader() {
  const loader = document.getElementById("pageLoader");
  if (!loader) return;
  loader.classList.add("hidden");
  window.setTimeout(() => {
    loader.remove();
  }, 400);
}

const { renderGroupedSourcesHtml } = initIngredientSources({ esc });
const mobileZoomApi = initMobileOverlayZoom({
  state,
  esc,
  getMenuState,
  setOverlayPulseColor,
  mobileCompactBodyHTML,
  ensureAddToOrderConfirmContainer,
  hideAddToOrderConfirmation,
  showAddToOrderConfirmation,
  addDishToOrder,
  getDishCompatibilityDetails,
  toggleLoveDishInTooltip,
  onZoomChange: ({ isZoomed, item }) => {
    isOverlayZoomed = isZoomed;
    zoomedOverlayItem = item || null;
  },
});
zoomToOverlay = mobileZoomApi.zoomToOverlay;
zoomOutOverlay = mobileZoomApi.zoomOutOverlay;
const normalizeDietLabel =
  typeof allergenConfig.normalizeDietLabel === "function"
    ? allergenConfig.normalizeDietLabel
    : (diet) => {
      if (!diet) return "";
      const raw = diet.toString().trim();
      if (!DIETS.length) return raw;
      return DIETS.includes(raw) ? raw : "";
    };
const fmtDate = (d) => {
  try {
    const x = new Date(d);
    return isNaN(x) ? "" : x.toLocaleDateString();
  } catch (_) {
    return "";
  }
};
const fmtDateTime = (d) => {
  try {
    const x = new Date(d);
    return isNaN(x)
      ? ""
      : x.toLocaleDateString() + " at " + x.toLocaleTimeString();
  } catch (_) {
    return "";
  }
};

const dishEditorApi = initDishEditor({
  esc,
  state,
  normalizeDietLabel,
  normalizeAllergen,
  formatAllergenLabel,
  getDietAllergenConflicts,
  getIssueReportMeta,
  ALLERGENS,
  ALLERGEN_EMOJI,
  DIETS,
  DIET_EMOJI,
  cap,
  norm,
  tooltipBodyHTML,
  send,
});
openBrandIdentificationChoice =
  dishEditorApi.openBrandIdentificationChoice || openBrandIdentificationChoice;
showIngredientPhotoUploadModal =
  dishEditorApi.showIngredientPhotoUploadModal || showIngredientPhotoUploadModal;
showPhotoAnalysisLoadingInRow =
  dishEditorApi.showPhotoAnalysisLoadingInRow || showPhotoAnalysisLoadingInRow;
hidePhotoAnalysisLoadingInRow =
  dishEditorApi.hidePhotoAnalysisLoadingInRow || hidePhotoAnalysisLoadingInRow;
updatePhotoAnalysisLoadingStatus =
  dishEditorApi.updatePhotoAnalysisLoadingStatus ||
  updatePhotoAnalysisLoadingStatus;
showPhotoAnalysisResultButton =
  dishEditorApi.showPhotoAnalysisResultButton || showPhotoAnalysisResultButton;
aiAssistState = dishEditorApi.aiAssistState;
aiAssistSetStatus = dishEditorApi.aiAssistSetStatus || aiAssistSetStatus;
ensureAiAssistElements =
  dishEditorApi.ensureAiAssistElements || ensureAiAssistElements;
collectAiTableData = dishEditorApi.collectAiTableData || collectAiTableData;
renderAiTable = dishEditorApi.renderAiTable || renderAiTable;
openDishEditor = dishEditorApi.openDishEditor || openDishEditor;
handleDishEditorResult =
  dishEditorApi.handleDishEditorResult || handleDishEditorResult;
handleDishEditorError =
  dishEditorApi.handleDishEditorError || handleDishEditorError;
rebuildBrandMemoryFromRestaurant =
  dishEditorApi.rebuildBrandMemoryFromRestaurant ||
  rebuildBrandMemoryFromRestaurant;
getAiAssistBackdrop =
  dishEditorApi.getAiAssistBackdrop || getAiAssistBackdrop;
getAiAssistTableBody =
  dishEditorApi.getAiAssistTableBody || getAiAssistTableBody;

const feedbackModalsApi = initFeedbackModals({
  configureModalClose,
  state,
  getIssueReportMeta,
  SUPABASE_KEY: typeof window !== "undefined" ? window.SUPABASE_KEY : "",
});
openFeedbackModal = feedbackModalsApi.openFeedbackModal || openFeedbackModal;
openReportIssueModal =
  feedbackModalsApi.openReportIssueModal || openReportIssueModal;

// Helper function to get weeks ago text and color
// showAll: if true, show text even for dates beyond 30 days (for admin/manager)
const getWeeksAgoInfo = (date, showAll = false) => {
  try {
    const x = new Date(date);
    if (isNaN(x)) return { text: "—", color: "#888" };
    const now = new Date();

    // Reset both dates to midnight for accurate comparison
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const compareDate = new Date(x.getFullYear(), x.getMonth(), x.getDate());

    const diffDays = Math.floor((today - compareDate) / (1000 * 60 * 60 * 24));
    const diffWeeks = Math.floor(diffDays / 7);

    // If more than 30 days and not showing all, return null to indicate suspension
    if (diffDays > 30 && !showAll) {
      return null; // Signal to suspend restaurant
    }

    // Determine weeks ago and color
    let text, color;
    if (diffDays < 7) {
      text = "this week";
      color = "#4caf50"; // Green
    } else if (diffWeeks === 1) {
      text = "last week";
      color = "#8bc34a"; // Yellow-green
    } else if (diffWeeks === 2) {
      text = "two weeks ago";
      color = "#ff9800"; // Orange
    } else if (diffWeeks === 3) {
      text = "three weeks ago";
      color = "#f44336"; // Red
    } else {
      // 4+ weeks - show number of weeks for admin/manager, otherwise "one month ago"
      if (showAll) {
        text = `${diffWeeks} weeks ago`;
        color = "#f44336"; // Red for all dates beyond 3 weeks
      } else {
        // 4 weeks but still within 30 days
        text = "one month ago";
        color = "#f44336"; // Red
      }
    }

    return { text, color };
  } catch (_) {
    return { text: "—", color: "#888" };
  }
};

const daysAgo = (d) => {
  const info = getWeeksAgoInfo(d);
  if (!info) return "—";
  return info.text;
};
function div(html, cls) {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  d.innerHTML = html;
  return d;
}

// Normalize overlay coordinates to 0-100% with basic heuristics against 0-1000 legacy data
function normalizeOverlayCoords(overlays) {
  return (overlays || []).map((o) => {
    const it = { ...o };

    const num = (v) => {
      const n = typeof v === "string" ? parseFloat(v) : v;
      return Number.isFinite(n) ? n : 0;
    };

    const coords = ["x", "y", "w", "h"].map((k) => num(it[k]));
    const maxCoord = Math.max(...coords, 0);
    const looksLikeThousandScale = maxCoord > 150 && maxCoord <= 1200;

    // If values look like 0-1000 grid, scale down to 0-100 once
    if (looksLikeThousandScale) {
      ["x", "y", "w", "h"].forEach((k) => {
        const n = num(it[k]);
        it[k] = n / 10;
      });
    }

    // Clamp to sane bounds in percentage space
    const x = Math.max(0, Math.min(100, num(it.x)));
    const y = Math.max(0, Math.min(100, num(it.y)));
    const w = Math.max(0.5, Math.min(100 - x, num(it.w)));
    const h = Math.max(0.5, Math.min(100 - y, num(it.h)));

    it.x = x;
    it.y = y;
    it.w = w;
    it.h = h;

    // Preserve pageIndex (avoid clamping to prevent pulling other pages onto page 0)
    const pIdx = Number.isFinite(num(it.pageIndex)) ? num(it.pageIndex) : 0;
    it.pageIndex = Math.floor(pIdx);

    return it;
  });
}


function normalizeRestaurant(row) {
  if (!row) return null;
  const id = row._id ?? row.id;
  const menuImage = row.menuImage ?? row.menu_image;
  const menuImages = row.menuImages ?? row.menu_images;
  // Support both single image (backward compatible) and multiple images
  const menuImagesArray = menuImages
    ? Array.isArray(menuImages)
      ? menuImages
      : [menuImages]
    : menuImage
      ? [menuImage]
      : [];
  const lastConfirmed = row.lastConfirmed ?? row.last_confirmed;
  const overlays = normalizeOverlayCoords(
    Array.isArray(row.overlays) ? row.overlays : [],
  ).map((overlay) => {
    const normalizeAllergenList = (list) =>
      Array.isArray(list) ? list.map(normalizeAllergen).filter(Boolean) : [];
    const normalizeDietList = (list) =>
      Array.isArray(list) ? list.map(normalizeDietLabel).filter(Boolean) : [];
    const normalized = { ...overlay };

    normalized.allergens = normalizeAllergenList(overlay.allergens);
    normalized.diets = normalizeDietList(overlay.diets);
    normalized.crossContamination = normalizeAllergenList(
      overlay.crossContamination,
    );
    normalized.crossContaminationDiets = normalizeDietList(
      overlay.crossContaminationDiets,
    );
    normalized.removable = Array.isArray(overlay.removable)
      ? overlay.removable
          .map((r) => ({
            ...r,
            allergen: normalizeAllergen(r.allergen),
          }))
          .filter((r) => r.allergen)
      : [];
    if (Array.isArray(overlay.ingredients)) {
      normalized.ingredients = overlay.ingredients.map((ingredient) => ({
        ...ingredient,
        allergens: normalizeAllergenList(ingredient.allergens),
        diets: normalizeDietList(ingredient.diets),
        crossContamination: normalizeAllergenList(ingredient.crossContamination),
        crossContaminationDiets: normalizeDietList(ingredient.crossContaminationDiets),
      }));
    }
    return normalized;
  });
  return {
    _id: id,
    name: row.name,
    slug: row.slug,
    menuImage: menuImagesArray[0] || menuImage || "", // Keep for backward compatibility
    menuImages: menuImagesArray, // New array format
    lastConfirmed,
    overlays,
    website: row.website || null,
    phone: row.phone || null,
    delivery_url: row.delivery_url || null,
  };
}

function configureModalClose({ visible = true, onClick = null } = {}) {
  const closeBtn = document.getElementById("modalCloseBtn");
  if (closeBtn) {
    closeBtn.style.display = visible ? "inline-flex" : "none";
    closeBtn.onclick = onClick || null;
  }
}

async function insertChangeLogEntry(base) {
  const client = window.supabaseClient;
  if (!client) throw new Error("Supabase client not ready.");
  const payload = {
    restaurant_id: base.restaurantId,
    type: base.type,
    description: base.description,
    changes: base.changes,
    user_email: base.userEmail || null,
    photos: Array.isArray(base.photos)
      ? base.photos
      : base.photos
        ? [base.photos]
        : [],
    // Note: overlays field removed - overlays are saved separately in restaurants table
    // and the changes are tracked in the 'changes' JSON field above
    timestamp: base.timestamp || new Date().toISOString(),
  };
  Object.keys(payload).forEach((k) => payload[k] == null && delete payload[k]);
  const { error } = await client.from("change_logs").insert([payload]);
  if (error) throw error;
  return true;
}

async function fetchChangeLogEntries(restaurantId) {
  const client = window.supabaseClient;
  if (!client) throw new Error("Supabase client not ready.");
  let query = client
    .from("change_logs")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(50);
  if (restaurantId) {
    query = query.eq("restaurant_id", restaurantId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
/* risk + tooltip */
function computeStatus(item, sel, userDiets) {
  const userAllergens = (sel || []).map(normalizeAllergen).filter(Boolean);
  const normalizedDiets = (userDiets || [])
    .map(normalizeDietLabel)
    .filter(Boolean);
  const hasAllergenReqs = userAllergens.length > 0;
  const hasDietReqs = normalizedDiets.length > 0;

  if (!hasAllergenReqs && !hasDietReqs) return "neutral";

  // Check allergen requirements - use normalized comparison
  const itemAllergens = (item.allergens || [])
    .map(normalizeAllergen)
    .filter(Boolean);
  const allergenHits = itemAllergens.filter((a) => userAllergens.includes(a));
  const hasAllergenIssues = allergenHits.length > 0;
  const removableAllergenSet = new Set(
    (item.removable || [])
      .map((r) => normalizeAllergen(r.allergen || ""))
      .filter(Boolean),
  );
  const allergenRemovableAll = hasAllergenIssues
    ? allergenHits.every((a) => removableAllergenSet.has(a))
    : true;

  // Check dietary requirements
  const itemDiets = new Set(
    (item.diets || []).map(normalizeDietLabel).filter(Boolean),
  );
  const meetsDietReqs =
    !hasDietReqs || normalizedDiets.every((diet) => itemDiets.has(diet));

  // Check if diet can be made (blocking allergens/ingredients are removable)
  let canBeMadeForDiets = false;
  if (hasDietReqs && !meetsDietReqs) {
    const unmetDiets = normalizedDiets.filter((diet) => !itemDiets.has(diet));
    if (unmetDiets.length) {
      canBeMadeForDiets = unmetDiets.every((userDiet) => {
        const conflicts = getDietAllergenConflicts(userDiet);
        const conflictingAllergens = conflicts.filter((allergen) => {
          return itemAllergens.includes(allergen);
        });
        const allConflictingAllergensRemovable =
          conflictingAllergens.length > 0 &&
          conflictingAllergens.every((allergen) =>
            removableAllergenSet.has(allergen),
          );

        const blockingIngredients =
          item.ingredientsBlockingDiets?.[userDiet] || [];
        const allBlockingIngredientsRemovable =
          blockingIngredients.length > 0 &&
          blockingIngredients.every((ing) => ing.removable);

        const hasBlocks =
          conflictingAllergens.length > 0 || blockingIngredients.length > 0;
        if (!hasBlocks) return false;
        if (
          conflictingAllergens.length > 0 &&
          !allConflictingAllergensRemovable
        )
          return false;
        if (blockingIngredients.length > 0 && !allBlockingIngredientsRemovable)
          return false;
        return true;
      });
    }
  }

  // If doesn't meet dietary requirements and can't be made, it's unsafe
  if (!meetsDietReqs && !canBeMadeForDiets) return "unsafe";

  // If has allergen issues that can't be removed, it's unsafe
  if (hasAllergenIssues && !allergenRemovableAll) return "unsafe";

  // If has removable allergen issues OR can be made to meet diets, it's removable
  if (hasAllergenIssues && allergenRemovableAll) return "removable";
  if (!meetsDietReqs && canBeMadeForDiets) return "removable";

  // Otherwise it's safe
  return "safe";
}

function hasCrossContamination(item, sel, userDiets) {
  const userAllergens = (sel || []).map(normalizeAllergen).filter(Boolean);
  // Check allergen cross-contamination
  const hasAllergenCross =
    userAllergens.length > 0 &&
    (item.crossContamination || [])
      .map(normalizeAllergen)
      .filter(Boolean)
      .some((a) => userAllergens.includes(a));

  // Check diet cross-contamination
  const normalizedDiets = (userDiets || [])
    .map(normalizeDietLabel)
    .filter(Boolean);
  const hasDietCross =
    normalizedDiets.length > 0 &&
    (item.crossContaminationDiets || []).some((d) => {
      const normalized = normalizeDietLabel(d);
      return normalized ? normalizedDiets.includes(normalized) : false;
    });

  return hasAllergenCross || hasDietCross;
}

/* scale-aware tooltip */
function currentScale() {
  try {
    return window.visualViewport && window.visualViewport.scale
      ? window.visualViewport.scale
      : 1;
  } catch (_) {
    return 1;
  }
}
function tooltipBodyHTML(item, sel, userDiets, isClick = false) {
  const status = computeStatus(item, sel, userDiets);
  const details = item.details || {};
  const hasCross = hasCrossContamination(item, sel, userDiets);
  const normalizedAllergens = (sel || [])
    .map(normalizeAllergen)
    .filter(Boolean);
  const normalizedDiets = (userDiets || [])
    .map(normalizeDietLabel)
    .filter(Boolean);

  // Detect if mobile - on mobile always show details, on desktop only when clicked
  const isMobile = prefersMobileInfo();
  const showDetails = isMobile || isClick;

  if (!normalizedAllergens.length && !normalizedDiets.length)
    return `<div class="note">No diets saved. Sign in to save them.</div>`;

  let html = "";

  // Build allergen section first
  if (normalizedAllergens.length) {
    html += `<div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(76,90,212,0.2)"><strong style="display:block;margin-bottom:8px;color:var(--ink)">Allergens:</strong>`;
    const itemAllergensRaw = Array.isArray(item.allergens) ? item.allergens : [];
    const itemAllergens = itemAllergensRaw
      .map(normalizeAllergen)
      .filter(Boolean);
    const allergenKeyMap = new Map();
    itemAllergensRaw.forEach((raw) => {
      const normalized = normalizeAllergen(raw);
      if (normalized && !allergenKeyMap.has(normalized)) {
        allergenKeyMap.set(normalized, raw);
      }
    });
    const hits = itemAllergens.filter((a) => normalizedAllergens.includes(a));
    const removableSet = new Set(
      (item.removable || [])
        .map((r) => normalizeAllergen(r.allergen || ""))
        .filter(Boolean),
    );

    const unsafeHits = hits.filter((a) => !removableSet.has(a));
    const removableHits = hits.filter((a) => removableSet.has(a));

    if (unsafeHits.length) {
      const list = unsafeHits
        .map((a) => {
          const emoji = ALLERGEN_EMOJI[normalizeAllergen(a)] || "⚠️";
          const label = formatAllergenLabel(a);
          const detailKey = allergenKeyMap.get(a) || a;
          let text = `${emoji} Contains <strong>${esc(label)}</strong>`;

          // Only show ingredient details when clicked (desktop) or always on mobile
          if (showDetails) {
            const ingredientInfo = details[detailKey] || details[a];
            if (ingredientInfo) {
              // Extract just the ingredients part (remove "Contains " prefix if present)
              const ingredients = ingredientInfo.replace(/^Contains\s+/i, "");
              // More compact styling for mobile
              const detailStyle = isMobile
                ? "font-size:0.8em;opacity:0.8;margin-top:1px;margin-left:18px;line-height:1.2"
                : "font-size:0.85em;opacity:0.85;margin-top:2px;margin-left:20px";
              text += `<div style="${detailStyle}">${esc(ingredients)}</div>`;
            }
          }
          return `<div style="margin-bottom:4px">${text}</div>`;
        })
        .join("");
      html += `<div class="note tooltipDangerText">${list}</div>`;
    }
    if (removableHits.length) {
      const list = removableHits
        .map((a) => {
          const emoji = ALLERGEN_EMOJI[normalizeAllergen(a)] || "⚠️";
          const label = formatAllergenLabel(a);
          const detailKey = allergenKeyMap.get(a) || a;
          let text = `${emoji} Can be made <strong>${esc(
            label,
          )}</strong>-free`;

          // Only show ingredient details when clicked (desktop) or always on mobile
          if (showDetails) {
            const ingredientInfo = details[detailKey] || details[a];
            if (ingredientInfo) {
              // Extract just the ingredients part (remove "Contains " prefix if present)
              const ingredients = ingredientInfo.replace(/^Contains\s+/i, "");
              // More compact styling for mobile
              const detailStyle = isMobile
                ? "font-size:0.8em;opacity:0.8;margin-top:1px;margin-left:18px;line-height:1.2"
                : "font-size:0.85em;opacity:0.85;margin-top:2px;margin-left:20px";
              text += `<div style="${detailStyle}">${esc(ingredients)}</div>`;
            }
          }
          return `<div style="margin-bottom:4px">${text}</div>`;
        })
        .join("");
      html += `<div class="note tooltipWarnText">${list}</div>`;
    }
    // Show allergens that the dish is free from (even if it contains others)
    const freeFromAllergens = normalizedAllergens.filter(
      (a) => !hits.includes(a),
    );
    if (freeFromAllergens.length > 0) {
      const successLines = freeFromAllergens
        .map((a) => {
          const emoji = ALLERGEN_EMOJI[normalizeAllergen(a)] || "✅";
          const label = formatAllergenLabel(a);
          return `<div style="margin-bottom:4px;color:#4cc85a;font-size:0.9rem">${emoji} This dish is free of <strong>${esc(
            label,
          )}</strong></div>`;
        })
        .join("");
      html += `<div>${successLines}</div>`;
    }

    // Ingredients list removed per user request - not needed in tooltip
    html += `</div>`;
  }

  // Display dietary preferences section - show status for each user preference
  const hasUserDiets = normalizedDiets.length > 0;

  if (hasUserDiets) {
    html += `<div class="note" style="margin-top:12px"><strong style="display:block;margin-bottom:8px;color:var(--ink)">Diets:</strong>`;

    const itemDietSet = new Set(
      (item.diets || []).map(normalizeDietLabel).filter(Boolean),
    );
    const removableAllergens = new Set(
      (item.removable || [])
        .map((r) => normalizeAllergen(r.allergen))
        .filter(Boolean),
    );

    normalizedDiets.forEach((userDiet) => {
      const isDietMet = itemDietSet.has(userDiet);
      const emoji = DIET_EMOJI[userDiet] || "✓";

      // Check if there are removable allergens or blocking ingredients that would affect this diet
      const conflicts = getDietAllergenConflicts(userDiet);
      const itemAllergens = (item.allergens || [])
        .map(normalizeAllergen)
        .filter(Boolean);
      const conflictingAllergens = conflicts.filter((allergen) =>
        itemAllergens.includes(allergen),
      );

      // Check if ALL conflicting allergens are removable
      const allConflictingAllergensRemovable =
        conflictingAllergens.length > 0 &&
        conflictingAllergens.every((allergen) =>
          removableAllergens.has(allergen),
        );

      // Check if ALL blocking ingredients are removable (if we have this info from AI assistant)
      const blockingIngredients =
        item.ingredientsBlockingDiets?.[userDiet] || [];
      const allBlockingIngredientsRemovable =
        blockingIngredients.length > 0 &&
        blockingIngredients.every((ing) => ing.removable);

      // If diet is met BUT there are removable blockers for this specific diet, show "can be made" instead
      // Only show "can be made" if there are actual blockers that can be removed, not just any removable ingredient
      const hasRemovableBlockers =
        (conflictingAllergens.length > 0 && allConflictingAllergensRemovable) ||
        (blockingIngredients.length > 0 && allBlockingIngredientsRemovable);

      if (isDietMet && !hasRemovableBlockers) {
        // Diet is met and no removable blockers - show green "is"
        html += `<div style="margin-bottom:6px;color:#4cc85a;font-size:0.9rem">${emoji} This dish is <strong>${esc(userDiet)}</strong></div>`;
      } else if (isDietMet && hasRemovableBlockers) {
        // Diet is met but has removable blockers for this diet - show yellow "can be made"
        html += `<div style="margin-bottom:6px;color:#facc15;font-size:0.9rem">${emoji} Can be made <strong>${esc(userDiet)}</strong></div>`;
      } else {
        // Diet is not met - check if it can be made to meet the diet
        // (conflicts, conflictingAllergens, allConflictingAllergensRemovable, blockingIngredients, and allBlockingIngredientsRemovable already defined above)

        // The dish can be made to meet the diet ONLY if:
        // 1. ALL conflicting allergens (if any) are removable, AND
        // 2. ALL blocking ingredients (if any) are removable
        // If we have blocking ingredients info from AI assistant, use it strictly
        // Otherwise, we can only check allergens - if no conflicting allergens but diet still not met,
        // we can't determine if blocking ingredients are removable, so show "is not"
        let canBeMade = false;

        // Check if we have detailed ingredient blocking info (from AI assistant)
        const hasBlockingIngredientsInfo =
          item.ingredientsBlockingDiets !== undefined;

        if (hasBlockingIngredientsInfo) {
          // We have detailed info - use it strictly
          // Can be made only if:
          // 1. ALL blocking ingredients (if any) are removable, AND
          // 2. ALL conflicting allergens (if any) are removable
          const noBlockingIngredients = blockingIngredients.length === 0;
          const noConflictingAllergens = conflictingAllergens.length === 0;

          canBeMade =
            (noBlockingIngredients || allBlockingIngredientsRemovable) &&
            (noConflictingAllergens || allConflictingAllergensRemovable);
        } else {
          // No blocking ingredients info - can only check allergens
          // If there are conflicting allergens, check if they're all removable
          // If no conflicting allergens but diet still not met, we can't determine if blocking ingredients are removable
          // So only show "can be made" if conflicting allergens exist AND are all removable
          canBeMade =
            conflictingAllergens.length > 0 && allConflictingAllergensRemovable;
        }

        if (canBeMade) {
          // All blocking ingredients/allergens can be substituted out - show yellow (same as allergen warning color)
          html += `<div style="margin-bottom:6px;color:#facc15;font-size:0.9rem">${emoji} Can be made <strong>${esc(userDiet)}</strong></div>`;
        } else {
          // Cannot be made to meet the diet - show red
          let dietText = `${emoji} This dish is not <strong>${esc(userDiet)}</strong>`;

          // Only show ingredient details when clicked (desktop) or always on mobile
          if (showDetails && blockingIngredients.length > 0) {
            const ingredientNames = blockingIngredients
              .map((ing) => ing.name || ing)
              .filter((name) => name)
              .join(", ");
            if (ingredientNames) {
              // More compact styling for mobile
              const detailStyle = isMobile
                ? "font-size:0.8em;opacity:0.8;margin-top:1px;margin-left:18px;line-height:1.2"
                : "font-size:0.85em;opacity:0.85;margin-top:2px;margin-left:20px";
              dietText += `<div style="${detailStyle}">${esc(ingredientNames)}</div>`;
            }
          }
          html += `<div style="margin-bottom:6px;color:#e85d5d;font-size:0.9rem">${dietText}</div>`;
        }
      }
    });

    html += `</div>`;
  }

  // Add cross-contamination risk at the bottom with yellow warning icon
  // Combine allergen and diet cross-contamination into a single line
  const allergenCrossHits =
    hasCross && normalizedAllergens.length
      ? (item.crossContamination || [])
          .map(normalizeAllergen)
          .filter((a) => normalizedAllergens.includes(a))
      : [];
  const dietCrossHits = (item.crossContaminationDiets || [])
    .map(normalizeDietLabel)
    .filter((d) => d && normalizedDiets.includes(d));

  if (allergenCrossHits.length > 0 || dietCrossHits.length > 0) {
    const allCrossItems = [];

    // Add allergen cross-contamination items
    allergenCrossHits.forEach((a) => {
      const emoji = ALLERGEN_EMOJI[normalizeAllergen(a)] || "";
      allCrossItems.push(
        `${emoji} <strong>${esc(formatAllergenLabel(a))}</strong>`,
      );
    });

    // Add diet cross-contamination items
    dietCrossHits.forEach((d) => {
      const emoji = DIET_EMOJI[d] || "🍽️";
      allCrossItems.push(`${emoji} <strong>${esc(d)}</strong>`);
    });

    const crossList = allCrossItems.join(", ");
    html += `<div class="note" style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(76,90,212,0.2)">`;
    html += `<div style="display:flex;align-items:flex-start;gap:8px;color:#facc15;font-size:0.9rem">`;
    html += `<span style="font-size:1.2rem;flex-shrink:0;">⚠️</span>`;
    html += `<div>Cross-contamination risk: ${crossList}</div>`;
    html += `</div></div>`;
  }

  return html;
}

async function toggleLoveDishInTooltip(user, restaurantId, dishName, button) {
  if (!window.lovedDishesSet) window.lovedDishesSet = new Set();
  const dishKey = `${String(restaurantId)}:${dishName}`;
  const isLoved = window.lovedDishesSet.has(dishKey);

  button.disabled = true;
  const labelEl = button.querySelector('[data-role="label"]');

  try {
    if (isLoved) {
      const { error } = await window.supabaseClient
        .from("user_loved_dishes")
        .delete()
        .eq("user_id", user.id)
        .eq("restaurant_id", restaurantId)
        .eq("dish_name", dishName);

      if (error) throw error;
      window.lovedDishesSet.delete(dishKey);
      button.classList.remove("loved");
      button.setAttribute("title", "Add to favorite dishes");
      button.setAttribute("aria-label", "Add to favorites");
      button.setAttribute("aria-pressed", "false");
      const img = button.querySelector("img");
      if (img) img.src = "images/heart-icon.svg";
      if (labelEl) labelEl.textContent = "Favorite";
    } else {
      const { error } = await window.supabaseClient
        .from("user_loved_dishes")
        .upsert(
          {
            user_id: user.id,
            restaurant_id: restaurantId,
            dish_name: dishName,
          },
          { onConflict: "user_id,restaurant_id,dish_name" },
        );

      if (error) throw error;
      window.lovedDishesSet.add(dishKey);
      button.classList.add("loved");
      button.setAttribute("title", "Remove from favorite dishes");
      button.setAttribute("aria-label", "Remove from favorites");
      button.setAttribute("aria-pressed", "true");
      const img = button.querySelector("img");
      if (img) img.src = "images/heart-icon.svg";
      if (labelEl) labelEl.textContent = "Favorited";
    }
  } catch (err) {
    console.error("Failed to update loved dish", err);
  } finally {
    button.disabled = false;
  }
}

function navigateWithUnsavedGuard(targetUrl) {
  if (!targetUrl) return;
  if (hasUnsavedChanges()) {
    showUnsavedChangesModal(() => {
      window.editorDirty = false;
      if (aiAssistState) aiAssistState.savedToDish = true;
      window.location.href = targetUrl;
    });
  } else {
    window.location.href = targetUrl;
  }
}

function getNavUserPayload() {
  if (!state.user?.loggedIn) return null;
  const role = state.user?.role || state.user?.user_metadata?.role || null;
  const userMetadata = { ...(state.user?.user_metadata || {}) };
  if (role && !userMetadata.role) {
    userMetadata.role = role;
  }
  return { ...state.user, user_metadata: userMetadata };
}

function getNavCurrentPageId(isEditorMode) {
  if (isEditorMode && state.page === "editor") {
    const restaurantSlug = state.restaurant?.slug || getRestaurantSlug();
    return restaurantSlug ? `restaurant-${restaurantSlug}-editor` : "editor";
  }
  if (state.page === "favorites") return "favorites";
  if (state.page === "dish-search") return "dish-search";
  if (state.page === "account") return "account";
  if (state.page === "restaurants" || state.page === "restaurant")
    return "restaurants";
  return "home";
}

function attachNavButtonGuards(container) {
  if (!container) return;
  container.querySelectorAll("button[data-href]").forEach((btn) => {
    if (btn.__navGuarded) return;
    btn.__navGuarded = true;
    btn.onclick = null;
    btn.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigateWithUnsavedGuard(btn.dataset.href);
      },
      { capture: true },
    );
  });
}

function fitTopbarNav() {
  const nav = document.querySelector(".simple-nav");
  if (!nav) return;
  nav.classList.remove("nav-compact", "nav-ultra");
  const available = Math.floor(nav.clientWidth);
  if (!available) return;
  if (nav.scrollWidth > available + 1) {
    nav.classList.add("nav-compact");
    if (nav.scrollWidth > available + 1) {
      nav.classList.add("nav-ultra");
    }
  }
  const delta = nav.scrollWidth - nav.clientWidth;
  nav.classList.toggle("nav-centered", delta <= 1);
}

function scheduleTopbarFit() {
  window.requestAnimationFrame(fitTopbarNav);
}

function renderTopbar() {
  const el = document.getElementById("topbar");
  if (!el) return;
  const isQrExperience = !!(state.qr || urlQR);
  document.body.classList.toggle("qrMode", isQrExperience);

  const navUser = getNavUserPayload();
  const currentMode = localStorage.getItem("clarivoreManagerMode") || "editor";
  const isEditorMode = currentMode === "editor";

  const currentPageId = getNavCurrentPageId(isEditorMode);
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
    if (hasUnsavedChanges()) {
      showUnsavedChangesModal(() => {
        window.editorDirty = false;
        if (aiAssistState) aiAssistState.savedToDish = true;
        localStorage.setItem("clarivoreManagerMode", nextMode);
        window.location.href = nextHref;
      });
    } else {
      localStorage.setItem("clarivoreManagerMode", nextMode);
      window.location.href = nextHref;
    }
  };

  setupTopbar(currentPageId, navUser, {
    managerRestaurants,
    container: el,
    onNavReady: attachNavButtonGuards,
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

/* tooltips */
const pageTip = document.getElementById("tip");
// Track if tip has been clicked/selected to stop pulsing
let tipInteracted = false;
// Track if tip is pinned open (clicked, should stay visible when mouse leaves)
let tipPinned = false;
// Track which overlay item is currently pinned (by comparing item data)
let pinnedOverlayItem = null;

// Set up click handlers for tip pinning
if (pageTip) {
  // Removed hover pulsing animation handlers

  // Pin tip open when user clicks anywhere in the tip
  pageTip.addEventListener("click", (e) => {
    // Don't pin if clicking the close button (let close handler handle it)
    if (e.target && e.target.classList.contains("tClose")) {
      hideTip(true);
      return;
    }
    tipInteracted = true;
    tipPinned = true;
    // pinnedOverlayItem is already set when showTipIn is called with isClick=true
  });

  // Also handle touch interactions
  pageTip.addEventListener("touchstart", (e) => {
    if (e.target && e.target.classList.contains("tClose")) {
      hideTip(true);
      return;
    }
    tipInteracted = true;
    tipPinned = true;
    // pinnedOverlayItem is already set when showTipIn is called with isClick=true
  });
}

function prefersMobileInfo() {
  try {
    const hasCoarse =
      window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const hasFine =
      window.matchMedia && window.matchMedia("(pointer: fine)").matches;
    if (hasCoarse) return true;
    if (hasFine) return false;
    return window.innerWidth <= 640;
  } catch (_) {
    return window.innerWidth <= 640;
  }
}

// Compact mobile-specific display for allergen/diet information
// Organized by severity: RED (danger) → YELLOW (caution) → GREEN (safe)
function mobileCompactBodyHTML(item, sel, userDiets) {
  const details = item.details || {};
  const normalizedAllergens = (sel || [])
    .map(normalizeAllergen)
    .filter(Boolean);
  const normalizedDiets = (userDiets || [])
    .map(normalizeDietLabel)
    .filter(Boolean);

  if (!normalizedAllergens.length && !normalizedDiets.length) {
    return `<div style="padding:8px;text-align:center;color:rgba(255,255,255,0.6);font-size:0.8rem">No diets saved</div>`;
  }

  // Separate allergen and diet items
  const allergenRed = [];
  const allergenGreen = [];
  const allergenYellow = [];
  const dietRed = [];
  const dietGreen = [];
  const dietYellow = [];

  // Process allergens
  if (normalizedAllergens.length) {
    const dishAllergensRaw = Array.isArray(item.allergens) ? item.allergens : [];
    const dishAllergens = dishAllergensRaw
      .map(normalizeAllergen)
      .filter(Boolean);
    const dishCrossContamination = (item.crossContamination || [])
      .map(normalizeAllergen)
      .filter(Boolean);
    const allergenKeyMap = new Map();
    dishAllergensRaw.forEach((raw) => {
      const normalized = normalizeAllergen(raw);
      if (normalized && !allergenKeyMap.has(normalized)) {
        allergenKeyMap.set(normalized, raw);
      }
    });
    normalizedAllergens.forEach((allergen) => {
      const label = formatAllergenLabel(allergen);
      const isDanger = dishAllergens.includes(allergen);
      const isCrossContamination = dishCrossContamination.includes(allergen);
      const emoji = ALLERGEN_EMOJI[allergen] || "⚠️";

      if (isDanger) {
        const detailKey = allergenKeyMap.get(allergen) || allergen;
        const ingredientInfo = details[detailKey] || details[allergen];
        const ingredients = ingredientInfo
          ? ingredientInfo.replace(/^Contains\s+/i, "")
          : "";
        allergenRed.push({ emoji, text: label, subtext: ingredients });
      } else if (isCrossContamination) {
        allergenYellow.push({ emoji, text: label });
      } else {
        allergenGreen.push({ emoji, text: `${label}-free` });
      }
    });
  }

  // Process diets
  if (normalizedDiets.length > 0) {
    const itemDietSet = new Set(
      (item.diets || []).map(normalizeDietLabel).filter(Boolean),
    );
    const crossContaminationDietSet = new Set(
      (item.crossContaminationDiets || [])
        .map(normalizeDietLabel)
        .filter(Boolean),
    );
    normalizedDiets.forEach((userDiet) => {
      const isDietMet = itemDietSet.has(userDiet);
      const emoji = DIET_EMOJI[userDiet] || "🍽️";
      const hasCrossContamination = crossContaminationDietSet.has(userDiet);
      const blockingIngredients =
        item.ingredientsBlockingDiets?.[userDiet] || [];

      if (isDietMet) {
        if (hasCrossContamination) {
          dietYellow.push({ emoji, text: userDiet });
        } else {
          dietGreen.push({ emoji, text: userDiet });
        }
      } else {
        const ingredientNames =
          blockingIngredients.length > 0
            ? blockingIngredients
                .map((ing) => ing.name || ing)
                .filter((name) => name)
                .join(", ")
            : "";
        dietRed.push({
          emoji,
          text: `Not ${userDiet}`,
          subtext: ingredientNames,
        });
      }
    });
  }

  // Helper to render a column's items
  const renderColumn = (redItems, yellowItems, greenItems, title) => {
    let col = `<div class="mobileInfoColumn">`;
    col += `<div style="font-size:0.65rem;color:#9ca3af;margin-bottom:4px;font-weight:600">${title}</div>`;

    // Red items
    redItems.forEach((i) => {
      col += `<div style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:4px 6px;margin-bottom:3px">`;
      col += `<div style="color:#fca5a5;font-size:0.75rem;font-weight:500">${i.emoji} ${esc(i.text)}</div>`;
      if (i.subtext) {
        col += `<div style="color:rgba(252,165,165,0.6);font-size:0.65rem;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.subtext)}</div>`;
      }
      col += `</div>`;
    });

    // Yellow items (cross-contamination)
    yellowItems.forEach((i) => {
      col += `<div style="background:rgba(250,204,21,0.12);border:1px solid rgba(250,204,21,0.25);border-radius:6px;padding:3px 6px;margin-bottom:3px">`;
      col += `<div style="color:#fde047;font-size:0.7rem">⚠️ ${i.emoji} ${esc(i.text)}</div>`;
      col += `</div>`;
    });

    // Green items as compact chips
    if (greenItems.length > 0) {
      col += `<div style="display:flex;flex-wrap:wrap;gap:3px">`;
      greenItems.forEach((i) => {
        col += `<div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);border-radius:4px;padding:2px 5px;font-size:0.65rem;color:#86efac">${i.emoji} ${esc(i.text)}</div>`;
      });
      col += `</div>`;
    }

    if (
      redItems.length === 0 &&
      yellowItems.length === 0 &&
      greenItems.length === 0
    ) {
      col += `<div style="color:rgba(255,255,255,0.4);font-size:0.7rem;font-style:italic">None selected</div>`;
    }

    col += `</div>`;
    return col;
  };

  // Build two-column layout
  let html = `<div class="mobileInfoColumns" style="padding:6px 0">`;
  html += renderColumn(allergenRed, allergenYellow, allergenGreen, "ALLERGENS");
  html += renderColumn(dietRed, dietYellow, dietGreen, "DIETS");
  html += `</div>`;

  return html;
}
function renderMobileInfo(item) {
  // Make function available globally for MutationObserver
  window.renderMobileInfo = renderMobileInfo;
  window.currentMobileInfoItem = item;
  ensureMobileInfoPanel();
  if (!mobileInfoPanel) return;
  mobileInfoPanel.style.position = "fixed";
  /* Use full width in full-screen mode, otherwise use margins */
  const isFullScreen = document.body.classList.contains("mobileViewerActive");
  if (isFullScreen) {
    // Force full width in full-screen mode - use !important via setProperty
    mobileInfoPanel.style.setProperty("left", "0", "important");
    mobileInfoPanel.style.setProperty("right", "0", "important");
    mobileInfoPanel.style.setProperty("bottom", "0", "important");
  } else {
    mobileInfoPanel.style.left = "12px";
    mobileInfoPanel.style.right = "12px";
    mobileInfoPanel.style.bottom = "12px";
  }
  mobileInfoPanel.style.zIndex = "3500";
  if (!prefersMobileInfo()) {
    mobileInfoPanel.classList.remove("show");
    mobileInfoPanel.style.display = "none";
    mobileInfoPanel.innerHTML = "";
    currentMobileInfoItem = null;
    return;
  }
  if (!item) {
    currentMobileInfoItem = null;
    mobileInfoPanel.innerHTML = "";
    mobileInfoPanel.style.display = "none";
    mobileInfoPanel.classList.remove("show");
    if (!isOverlayZoomed) {
      // Remove selected class from all overlays when mobile panel is closed
      document
        .querySelectorAll(".overlay")
        .forEach((ov) => ov.classList.remove("selected"));
      // Clear tracked overlay selection
      window.__lastSelectedOverlay = null;
    }
    return;
  }
  currentMobileInfoItem = item;
  const dishName = item.id || item.name || "Item";
  const bodyHTML = mobileCompactBodyHTML(
    item,
    state.allergies || [],
    state.diets || [],
  );
  const isInOrder =
    (window.orderItems && dishName && window.orderItems.includes(dishName)) ||
    false;
  const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
  const dishKey = restaurantId ? `${String(restaurantId)}:${dishName}` : null;
  const isLoved =
    dishKey && window.lovedDishesSet && window.lovedDishesSet.has(dishKey);
  const showFavorite = !!(
    state.user?.loggedIn &&
    window.supabaseClient &&
    restaurantId
  );

  mobileInfoPanel.innerHTML = `
<div class="mobileInfoHeaderRow">
  <div class="mobileInfoHeader">${esc(dishName || "Item")}</div>
  <div style="display:flex;align-items:center;gap:0;">
    <button type="button" class="mobileInfoClose" aria-label="Close dish details">×</button>
  </div>
</div>
<div class="mobileInfoContent">
  ${bodyHTML}
  <div class="mobileInfoActions">
    <div class="mobileInfoActionRow">
      ${showFavorite ? `<button type="button" class="mobileFavoriteBtn${isLoved ? " loved" : ""}" id="mobileFavoriteBtn" aria-pressed="${isLoved ? "true" : "false"}" title="${isLoved ? "Remove from favorite dishes" : "Add to favorite dishes"}" aria-label="${isLoved ? "Remove from favorites" : "Add to favorites"}"><img src="images/heart-icon.svg" alt=""><span data-role="label">${isLoved ? "Favorited" : "Favorite"}</span></button>` : ""}
      <button type="button" class="addToOrderBtn mobileAddToOrderBtn" data-dish-name="${esc(dishName)}" ${isInOrder ? "disabled" : ""}>${isInOrder ? "Added" : "Add to order"}</button>
    </div>
  </div>
</div>
  `;

  if (showFavorite && restaurantId && dishName) {
    const loveBtn = mobileInfoPanel.querySelector("#mobileFavoriteBtn");
    if (loveBtn) {
      const handleLoveClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleLoveDishInTooltip(state.user, restaurantId, dishName, loveBtn);
      };
      loveBtn.addEventListener("click", handleLoveClick, true);
      loveBtn.addEventListener("touchend", handleLoveClick, true);
    }
  }
  const addToOrderBtn = mobileInfoPanel.querySelector(".mobileAddToOrderBtn");
  const actionsContainer = mobileInfoPanel.querySelector(".mobileInfoActions");
  const addToOrderConfirmEl = ensureAddToOrderConfirmContainer(
    actionsContainer || mobileInfoPanel,
  );
  hideAddToOrderConfirmation(addToOrderConfirmEl);
  if (addToOrderBtn) {
    const dishNameAttr = addToOrderBtn.getAttribute("data-dish-name");
    if (dishNameAttr) {
      addToOrderBtn.addEventListener("click", (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        hideAddToOrderConfirmation(addToOrderConfirmEl);

        const details = getDishCompatibilityDetails(dishNameAttr);
        const hasIssues =
          details.issues?.allergens?.length > 0 ||
          details.issues?.diets?.length > 0;

        if (hasIssues) {
          const severity =
            details.issues?.allergens?.length > 0 ||
            details.issues?.diets?.length > 0
              ? "danger"
              : "warn";
          details.severity = severity;
          showAddToOrderConfirmation(
            addToOrderConfirmEl,
            dishNameAttr,
            details,
            addToOrderBtn,
          );
        } else {
          const result = addDishToOrder(dishNameAttr);
          if (result?.success) {
            addToOrderBtn.disabled = true;
            addToOrderBtn.textContent = "Added";
            hideAddToOrderConfirmation(addToOrderConfirmEl);
          } else if (result?.needsConfirmation) {
            const severity =
              result.issues?.allergens?.length > 0 ||
              result.issues?.diets?.length > 0
                ? "danger"
                : "warn";
            details.severity = severity;
            details.issues = result.issues || details.issues;
            showAddToOrderConfirmation(
              addToOrderConfirmEl,
              dishNameAttr,
              details,
              addToOrderBtn,
            );
          }
        }
      });
    }
  }
  mobileInfoPanel.style.background = "rgba(11,16,32,0.94)";
  mobileInfoPanel.style.backdropFilter = "blur(14px)";
  mobileInfoPanel.style.webkitBackdropFilter = "blur(14px)";
  // Ensure positioning is correct, especially after full-screen mode activates
  const isFullScreenCheck =
    document.body.classList.contains("mobileViewerActive");
  if (isFullScreenCheck) {
    // Force full width in full-screen mode - use setProperty with important
    mobileInfoPanel.style.setProperty("left", "0", "important");
    mobileInfoPanel.style.setProperty("right", "0", "important");
    mobileInfoPanel.style.setProperty("bottom", "0", "important");
  }
  adjustMobileInfoPanelForZoom();
  mobileInfoPanel.style.display = "block";
  mobileInfoPanel.classList.add("show");
  const closeBtn = mobileInfoPanel.querySelector(".mobileInfoClose");
  if (closeBtn) {
    const closePanel = (ev) => {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      renderMobileInfo(null);
    };
    closeBtn.addEventListener("click", closePanel);
    closeBtn.addEventListener("touchend", closePanel, { passive: false });
    closeBtn.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        closePanel(ev);
      }
    });
  }
}
function syncMobileInfoPanel() {
  if (!mobileInfoPanel) return;
  if (isOverlayZoomed) return;
  adjustMobileInfoPanelForZoom();
  if (prefersMobileInfo()) {
    if (currentMobileInfoItem) {
      renderMobileInfo(currentMobileInfoItem);
    } else {
      mobileInfoPanel.innerHTML = "";
      mobileInfoPanel.style.display = "none";
      mobileInfoPanel.classList.remove("show");
    }
    hideTip();
  } else {
    mobileInfoPanel.classList.remove("show");
    mobileInfoPanel.style.display = "none";
    mobileInfoPanel.innerHTML = "";
    currentMobileInfoItem = null;
  }
}
addEventListener("resize", () => syncMobileInfoPanel(), { passive: true });
if (window.visualViewport) {
  visualViewport.addEventListener("resize", () => syncMobileInfoPanel(), {
    passive: true,
  });
  visualViewport.addEventListener("scroll", () => syncMobileInfoPanel(), {
    passive: true,
  });
}
ensureMobileInfoPanel();
function showTipIn(
  el,
  x,
  y,
  title,
  bodyHTML,
  anchorRect = null,
  isClick = false,
  item = null,
) {
  const vv = window.visualViewport;
  const zoom = vv && vv.scale ? vv.scale : 1;
  const offsetLeft =
    vv && typeof vv.offsetLeft === "number" ? vv.offsetLeft : 0;
  const offsetTop = vv && typeof vv.offsetTop === "number" ? vv.offsetTop : 0;
  const viewportWidth = vv && vv.width ? vv.width : window.innerWidth;
  const viewportHeight = vv && vv.height ? vv.height : window.innerHeight;
  const scrollX =
    window.scrollX ||
    window.pageXOffset ||
    document.documentElement.scrollLeft ||
    0;
  const scrollY =
    window.scrollY ||
    window.pageYOffset ||
    document.documentElement.scrollTop ||
    0;
  // Only show love button and close button when item is selected (pinned or clicked)
  const showButtons = tipPinned || isClick;

  // Generate love button HTML if user is logged in and item is selected
  const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
  const dishName = title || "Unnamed dish";
  const dishKey = restaurantId ? `${String(restaurantId)}:${dishName}` : null;
  const isLoved =
    dishKey && window.lovedDishesSet && window.lovedDishesSet.has(dishKey);
  const loveButtonId = dishKey
    ? `love-btn-tooltip-${dishKey.replace(/[^a-zA-Z0-9]/g, "-")}`
    : null;
  const loveButtonHTML =
    showButtons && loveButtonId && state.user?.loggedIn && restaurantId
      ? `<button type="button" class="love-button-tooltip ${isLoved ? "loved" : ""}" id="${loveButtonId}" data-restaurant-id="${restaurantId}" data-dish-name="${esc(dishName)}" title="${isLoved ? "Remove from favorite dishes" : "Add to favorite dishes"}" aria-label="${isLoved ? "Remove from favorites" : "Add to favorites"}"><img src="images/heart-icon.svg" alt="${isLoved ? "Loved" : "Not loved"}" style="width:14px;height:14px;display:block;" /></button>`
      : "";

  const closeButtonHTML = showButtons
    ? '<button class="tClose" type="button">✕</button>'
    : "";

  // Add pulsing hover message when it's a hover (not a click) and not already pinned
  const hoverMessage =
    !isClick && !tipPinned
      ? '<div class="tipHoverMessage">Select item for more options</div>'
      : "";

  // Add "Add to order" button when item is selected (pinned or clicked)
  const isInOrder =
    (window.orderItems && title && window.orderItems.includes(title)) || false;
  const addToOrderButton =
    showButtons && title
      ? `<button type="button" class="addToOrderBtn" data-dish-name="${esc(title)}" id="addToOrderBtn_${esc(title).replace(/[^a-zA-Z0-9]/g, "_")}" ${isInOrder ? "disabled" : ""}>${isInOrder ? "Added" : "Add to order"}</button>`
      : "";

  el.innerHTML = `
<div class="tipHead">
  <div class="tTitle">${esc(title || "Item")}</div>
  <div style="display:flex;align-items:center;gap:0;">
    ${loveButtonHTML}
    ${closeButtonHTML}
  </div>
</div>
${bodyHTML}
${hoverMessage}
${addToOrderButton}
  `;
  el.style.display = "block";

  // Reduce bottom padding when hover message is present to eliminate extra space
  if (hoverMessage) {
    el.style.paddingBottom = "4px";
  } else {
    el.style.paddingBottom = "";
  }

  // If this is a click, pin the tip
  if (isClick && item) {
    tipPinned = true;
    tipInteracted = true;
    pinnedOverlayItem = item; // Track which item is pinned
  }

  // Only reset interaction state if not already pinned (preserve pinned state)
  // This allows the tip to stay open when clicked
  if (!tipPinned) {
    tipInteracted = false;
    pinnedOverlayItem = null;
  }

  // Removed pulsing animation from tip pop-up

  // Attach love button handler if present
  const loveBtn = el.querySelector(".love-button-tooltip");
  if (loveBtn && window.supabaseClient && state.user?.loggedIn) {
    const restaurantIdAttr = loveBtn.getAttribute("data-restaurant-id");
    const dishNameAttr = loveBtn.getAttribute("data-dish-name");
    if (restaurantIdAttr && dishNameAttr) {
      const handleLoveClick = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        toggleLoveDishInTooltip(
          state.user,
          restaurantIdAttr,
          dishNameAttr,
          loveBtn,
        );
      };
      loveBtn.addEventListener("click", handleLoveClick);
      loveBtn.addEventListener("touchend", handleLoveClick, { passive: false });
    }
  }

  // Attach "Add to order" button handler if present
  const addToOrderBtn = el.querySelector(".addToOrderBtn");
  const addToOrderConfirmEl = ensureAddToOrderConfirmContainer(el);
  hideAddToOrderConfirmation(addToOrderConfirmEl);
  if (addToOrderBtn) {
    const dishNameAttr = addToOrderBtn.getAttribute("data-dish-name");
    if (dishNameAttr) {
      addToOrderBtn.addEventListener("click", (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        hideAddToOrderConfirmation(addToOrderConfirmEl);

        // Always check getDishCompatibilityDetails first to match what UI displays
        const details = getDishCompatibilityDetails(dishNameAttr);
        const hasIssues =
          details.issues?.allergens?.length > 0 ||
          details.issues?.diets?.length > 0;

        if (hasIssues) {
          // There are issues according to getDishCompatibilityDetails (what UI shows)
          // Show confirmation dialog
          const severity =
            details.issues?.allergens?.length > 0 ||
            details.issues?.diets?.length > 0
              ? "danger"
              : "warn";
          details.severity = severity;
          showAddToOrderConfirmation(
            addToOrderConfirmEl,
            dishNameAttr,
            details,
            addToOrderBtn,
          );
        } else {
          // No issues according to getDishCompatibilityDetails, add directly
          const result = addDishToOrder(dishNameAttr);
          if (result?.success) {
            addToOrderBtn.disabled = true;
            addToOrderBtn.textContent = "Added";
            hideAddToOrderConfirmation(addToOrderConfirmEl);
          } else if (result?.needsConfirmation) {
            // Fallback: if addDishToOrder says needs confirmation but getDishCompatibilityDetails doesn't,
            // still show confirmation (shouldn't happen if logic is consistent, but safety check)
            const severity =
              result.issues?.allergens?.length > 0 ||
              result.issues?.diets?.length > 0
                ? "danger"
                : "warn";
            details.severity = severity;
            details.issues = result.issues || details.issues;
            showAddToOrderConfirmation(
              addToOrderConfirmEl,
              dishNameAttr,
              details,
              addToOrderBtn,
            );
          }
        }
      });
    }
  }

  const isMobile = window.innerWidth <= 640;
  el.style.transform = "";
  el.style.transformOrigin = "";

  const layoutWidth =
    document.documentElement?.clientWidth || window.innerWidth;
  const baseMaxWidth = isMobile
    ? Math.min(280, Math.max(220, layoutWidth - 40))
    : Math.min(320, Math.max(240, layoutWidth - 80));
  el.style.maxWidth = baseMaxWidth + "px";
  el.style.padding = isMobile ? "8px" : "10px";
  el.style.borderRadius = isMobile ? "8px" : "10px";
  el.style.fontSize = isMobile ? "12px" : "14px";

  const titleEl = el.querySelector(".tTitle");
  if (titleEl) titleEl.style.fontSize = isMobile ? "14px" : "16px";

  const closeEl = el.querySelector(".tClose");
  if (closeEl) {
    closeEl.style.padding = isMobile ? "3px 6px" : "4px 8px";
    closeEl.style.fontSize = isMobile ? "12px" : "14px";
    closeEl.style.borderRadius = isMobile ? "5px" : "6px";
  }

  const loveBtnEl = el.querySelector(".love-button-tooltip");
  if (loveBtnEl) {
    loveBtnEl.style.padding = isMobile ? "3px 6px" : "4px 8px";
    loveBtnEl.style.fontSize = isMobile ? "12px" : "14px";
    loveBtnEl.style.borderRadius = isMobile ? "5px" : "6px";
  }

  const noteEls = el.querySelectorAll(".note");
  noteEls.forEach((n) => (n.style.fontSize = isMobile ? "11px" : "13px"));

  requestAnimationFrame(() => {
    const r = el.getBoundingClientRect();
    const pad = isMobile ? 8 : 12;
    const visibleLeft = scrollX + offsetLeft;
    const visibleTop = scrollY + offsetTop;
    const visibleRight = visibleLeft + viewportWidth;
    const visibleBottom = visibleTop + viewportHeight;

    const useAnchor = !!anchorRect;

    const anchorLeft = anchorRect
      ? anchorRect.left + scrollX + offsetLeft
      : null;
    const anchorRight = anchorRect
      ? anchorRect.right + scrollX + offsetLeft
      : null;
    const anchorTop = anchorRect ? anchorRect.top + scrollY + offsetTop : null;
    const anchorBottom = anchorRect
      ? anchorRect.bottom + scrollY + offsetTop
      : null;
    const anchorCenterX = anchorRect ? (anchorLeft + anchorRight) / 2 : null;

    let left;
    let top;

    if (useAnchor) {
      const offset = isMobile ? 12 : 16;
      left = (anchorCenterX || visibleLeft + pad) - r.width / 2;
      top =
        (anchorTop !== null ? anchorTop : visibleTop + pad) - r.height - offset;

      if (top < visibleTop + pad) {
        top =
          (anchorBottom !== null ? anchorBottom : visibleTop + pad) + offset;
      }
      if (top + r.height + pad > visibleBottom) {
        const anchorMiddle = anchorRect
          ? anchorTop + anchorRect.height / 2
          : visibleTop + viewportHeight / 2;
        top = anchorMiddle - r.height / 2;
        if (top + r.height + pad > visibleBottom) {
          top = visibleBottom - r.height - pad;
        }
      }
    } else {
      const pointerX =
        typeof x === "number"
          ? x + scrollX + offsetLeft
          : visibleLeft + viewportWidth / 2;
      const pointerY =
        typeof y === "number"
          ? y + scrollY + offsetTop
          : visibleTop + viewportHeight / 2;
      left = pointerX + (isMobile ? 8 : 12);
      top = pointerY + (isMobile ? 8 : 12);
    }

    if (left + r.width + pad > visibleRight) {
      left = Math.max(visibleLeft + pad, visibleRight - r.width - pad);
    }
    if (top + r.height + pad > visibleBottom) {
      top = Math.max(visibleTop + pad, visibleBottom - r.height - pad);
    }

    left = Math.max(visibleLeft + pad, left);
    top = Math.max(visibleTop + pad, top);

    el.style.left = left + "px";
    el.style.top = top + "px";
  });

  if (el.querySelector(".tClose")) {
    el.querySelector(".tClose").onclick = () => {
      // Use hideTip with force=true to properly clean up all state including selected class
      hideTip(true);
    };
  }
}

function hideTip(force = false) {
  // Don't hide if tip is pinned open (user clicked on it), unless forced
  if (tipPinned && !force) {
    return;
  }
  // Don't hide if mouse is currently over the tip itself, unless forced
  if (pageTip && pageTip.matches(":hover") && !force) {
    return;
  }
  pageTip.style.display = "none";
  // Reset interaction state when tip is hidden
  tipInteracted = false;
  tipPinned = false;
  pinnedOverlayItem = null;
  // Removed pulse class removal
  // Remove selected from all overlays when tip is hidden
  document
    .querySelectorAll(".overlay")
    .forEach((ov) => ov.classList.remove("selected"));
}

/* list */
function renderCardsPage() {
  renderTopbar();
  const r = document.getElementById("root");
  r.innerHTML = `<h1 style="text-align:center">Restaurants</h1><div class="cards" id="grid"></div>`;
  const grid = document.getElementById("grid");

  // Check if user is admin or manager
  const isAdmin = state.user?.email === "matt.29.ds@gmail.com";
  const isManager = state.user?.role === "manager";

  // Filter out restaurants that haven't confirmed in 30+ days (unless admin or manager)
  let filteredRestaurants = state.restaurants || [];

  if (!isAdmin && !isManager) {
    // Only filter for regular customers
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    filteredRestaurants = filteredRestaurants.filter((rs) => {
      if (!rs.lastConfirmed) return false; // Hide restaurants that have never confirmed
      const lastConfirmed = new Date(rs.lastConfirmed);
      return lastConfirmed >= thirtyDaysAgo;
    });
  }

  filteredRestaurants.forEach((rs) => {
    const c = div(`<div class="card">
    <img src="${esc(rs.menuImage || "")}" alt="">
    <div class="pad">
      <div style="font-weight:800;margin-bottom:6px">${esc(rs.name || "Restaurant")}</div>
      ${(() => {
        if (!rs.lastConfirmed)
          return '<div class="note">Last confirmed by staff: —</div>';
        const isAdmin = state.user?.email === "matt.29.ds@gmail.com";
        const isManager = state.user?.role === "manager";
        const showAll = isAdmin || isManager;
        const info = getWeeksAgoInfo(rs.lastConfirmed, showAll);
        if (!info) return ""; // Don't show if suspended (30+ days) and not admin/manager
        return `<div class="note" style="color: ${info.color}">Last confirmed by staff: ${esc(info.text)}</div>`;
      })()}
      <div style="margin-top:10px"><button class="btn btnPrimary">View menu & allergens</button></div>
    </div></div>`);
    c.querySelector(".btn").onclick = () =>
      send({ type: "openRestaurant", slug: rs.slug });
    grid.appendChild(c);
  });
}

/* chips */
function renderSavedChips(el) {
  el.innerHTML = "";
  const saved = (state.allergies || []).map(normalizeAllergen).filter(Boolean);
  if (!saved.length) {
    el.appendChild(
      div(
        '<div class="note">No saved allergens. Use "Edit saved allergens".</div>',
      ),
    );
    updateFullScreenAllergySummary();
    return;
  }
  const row = div("", "chips");
  row.style.cssText = "flex-wrap:nowrap;overflow-x:auto;gap:3px;";
  saved.forEach((a) => {
    const emoji = ALLERGEN_EMOJI[a] || "🔴";
    const chip = div(`${emoji} ${esc(formatAllergenLabel(a))}`, "chip active");
    chip.style.cssText =
      "flex-shrink:0;padding:4px 8px;font-size:0.75rem;white-space:nowrap;";
    row.appendChild(chip);
  });
  el.appendChild(row);
  updateFullScreenAllergySummary();
}

function renderSavedDiets(el) {
  el.innerHTML = "";
  const saved = state.diets || [];
  if (!saved.length) {
    el.appendChild(
      div(
        '<div class="note">No saved diets. Use "Edit saved diets".</div>',
      ),
    );
    return;
  }
  const row = div("", "chips");
  row.style.cssText = "flex-wrap:nowrap;overflow-x:auto;gap:3px;";
  saved.forEach((d) => {
    const emoji = DIET_EMOJI[d] || "🍽️";
    const chip = div(`${emoji} ${esc(d)}`, "chip active");
    chip.style.cssText =
      "flex-shrink:0;padding:4px 8px;font-size:0.75rem;white-space:nowrap;";
    row.appendChild(chip);
  });
  el.appendChild(row);
}

function renderSelectedChips(el) {
  el.innerHTML = "";
  const selected = (state.allergies || []).map(normalizeAllergen).filter(Boolean);
  if (!selected.length) {
    el.appendChild(div('<div class="note">No allergens selected.</div>'));
    updateFullScreenAllergySummary();
    return;
  }
  const row = div("", "chips");
  row.style.cssText = "flex-wrap:nowrap;overflow-x:auto;gap:3px;";
  selected.forEach((a) => {
    const emoji = ALLERGEN_EMOJI[a] || "🔴";
    const chip = div(`${emoji} ${esc(formatAllergenLabel(a))}`, "chip active");
    chip.style.cssText =
      "flex-shrink:0;padding:4px 8px;font-size:0.75rem;white-space:nowrap;";
    row.appendChild(chip);
  });
  el.appendChild(row);
  updateFullScreenAllergySummary();
}

function renderSelectedDiets(el) {
  el.innerHTML = "";
  const selected = state.diets || [];
  if (!selected.length) {
    el.appendChild(
      div('<div class="note">No diets selected.</div>'),
    );
    return;
  }
  const row = div("", "chips");
  row.style.cssText = "flex-wrap:nowrap;overflow-x:auto;gap:3px;";
  selected.forEach((d) => {
    const emoji = DIET_EMOJI[d] || "🍽️";
    const chip = div(`${emoji} ${esc(d)}`, "chip active");
    chip.style.cssText =
      "flex-shrink:0;padding:4px 8px;font-size:0.75rem;white-space:nowrap;";
    row.appendChild(chip);
  });
  el.appendChild(row);
}

/* selector for QR guests */
function renderSelector(el) {
  el.innerHTML = "";
  const row = div("", "chips");
  row.setAttribute("role", "list");
  const sel = new Set((state.allergies || []).map(normalizeAllergen).filter(Boolean));
  ALLERGENS.forEach((a) => {
    const isActive = sel.has(a);
    const emoji = ALLERGEN_EMOJI[a] || "🔴";
    const c = div(
      `${emoji} ${esc(formatAllergenLabel(a))}`,
      "chip clickable" + (isActive ? " active" : ""),
    );
    c.setAttribute("role", "button");
    c.setAttribute("tabindex", "0");
    c.setAttribute("aria-pressed", isActive ? "true" : "false");
    c.dataset.value = a;
    const toggle = () => {
      if (sel.has(a)) {
        sel.delete(a);
      } else {
        sel.add(a);
      }
      state.allergies = [...sel];
      updateFullScreenAllergySummary();
      try {
        sessionStorage.setItem("qrAllergies", JSON.stringify(state.allergies));
      } catch (_) {}
      renderSelector(el);
      if (window.__rerenderLayer__) window.__rerenderLayer__();
      send({ type: "qrAllergies", allergies: state.allergies });
      if (prefersMobileInfo()) renderMobileInfo(currentMobileInfoItem);
    };
    c.addEventListener(
      "click",
      (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        toggle();
      },
      { passive: false },
    );
    c.addEventListener(
      "touchend",
      (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        toggle();
      },
      { passive: false },
    );
    c.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        toggle();
      }
    });
    row.appendChild(c);
  });
  el.appendChild(row);
  updateFullScreenAllergySummary();
}

function renderDietSelector(el) {
  el.innerHTML = "";
  const row = div("", "chips");
  row.setAttribute("role", "list");
  const sel = new Set((state.diets || []).map(normalizeDietLabel).filter(Boolean));
  DIETS.forEach((diet) => {
    const isActive = sel.has(diet);
    const emoji = DIET_EMOJI[diet] || "🍽️";
    const c = div(
      `${emoji} ${esc(diet)}`,
      "chip clickable" + (isActive ? " active" : ""),
    );
    c.setAttribute("role", "button");
    c.setAttribute("tabindex", "0");
    c.setAttribute("aria-pressed", isActive ? "true" : "false");
    c.dataset.value = diet;
    const toggle = () => {
      if (sel.has(diet)) {
        sel.delete(diet);
      } else {
        sel.add(diet);
      }
      state.diets = [...sel];
      try {
        sessionStorage.setItem("qrDiets", JSON.stringify(state.diets));
      } catch (_) {}
      renderDietSelector(el);
      if (window.__rerenderLayer__) window.__rerenderLayer__();
      if (prefersMobileInfo()) renderMobileInfo(currentMobileInfoItem);
    };
    c.addEventListener(
      "click",
      (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        toggle();
      },
      { passive: false },
    );
    c.addEventListener(
      "touchend",
      (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        toggle();
      },
      { passive: false },
    );
    c.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        toggle();
      }
    });
    row.appendChild(c);
  });
  el.appendChild(row);
}

const howItWorksTour = createHowItWorksTour({
  state,
  renderSelector,
  renderDietSelector,
  updateOrderSidebar,
  openOrderSidebar,
  rerenderLayer: () => {
    if (window.__rerenderLayer__) window.__rerenderLayer__();
  },
});
maybeInitHowItWorksTour = howItWorksTour.maybeInitHowItWorksTour;

/* draw (simple image that follows page zoom) */
function drawMenu(
  container,
  imageURL,
  menuImagesArray = null,
  currentPage = 0,
) {
  container.innerHTML = "";

  // Support multiple menu images
  const images = menuImagesArray || (imageURL ? [imageURL] : []);

  if (!images.length || !images[0]) {
    const inner = div("", "menuInner");
    inner.innerHTML = `<div class="note" style="padding:16px">No menu image configured for this restaurant.</div>`;
    container.appendChild(inner);
    return;
  }

  const menuState = getMenuState();

  const createMiniMapViewportUpdater = () => {
    return () => {
      const headerMiniMapImg = document.getElementById("headerMiniMapImg");
      const viewportBox = document.getElementById("headerMiniMapViewport");
      const menuContainer = document.getElementById("menu");
      const headerMiniMapLabel = document.getElementById("headerMiniMapLabel");
      if (!headerMiniMapImg || !viewportBox || !menuContainer) return;

      const sections = menuState.sections || [];
      if (!sections.length) return;

      const pageIndex = Math.min(
        menuState.currentMiniMapPage || 0,
        sections.length - 1,
      );
      const currentSection = sections[pageIndex];
      if (!currentSection || !currentSection.img) return;

      const miniMapSrc =
        currentSection.img.currentSrc || currentSection.img.src || "";
      if (miniMapSrc && headerMiniMapImg.src !== miniMapSrc) {
        headerMiniMapImg.src = miniMapSrc;
      }
      if (sections.length <= 1 && headerMiniMapLabel) {
        headerMiniMapLabel.textContent = "Page 1";
      }

      const sectionImg = currentSection.img;
      const imgRect = sectionImg.getBoundingClientRect();
      const containerRect = menuContainer.getBoundingClientRect();

      // Get pinch zoom state if available
      const zoomState = menuState.pinchZoomState || {
        scale: 1,
        translateX: 0,
        translateY: 0,
      };
      const scale = zoomState.scale || 1;

      const imgHeight = imgRect.height;
      const imgWidth = imgRect.width;

      if (imgHeight <= 0 || imgWidth <= 0) {
        viewportBox.style.display = "none";
        return;
      }

      // Vertical visibility - what portion of the image height is visible
      const visibleTop = Math.max(0, containerRect.top - imgRect.top);
      const visibleBottom = Math.min(
        imgHeight,
        containerRect.bottom - imgRect.top,
      );
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);

      // Horizontal: always calculate actual visible portion
      // (image may be wider than container even without zoom)
      const visibleLeft = Math.max(0, containerRect.left - imgRect.left);
      const visibleRight = Math.min(
        imgWidth,
        containerRect.right - imgRect.left,
      );
      const visibleWidth = Math.max(0, visibleRight - visibleLeft);
      const leftPercent = (visibleLeft / imgWidth) * 100;
      const widthPercent = (visibleWidth / imgWidth) * 100;

      // Vertical percentages
      const topPercent = (visibleTop / imgHeight) * 100;
      const heightPercent = (visibleHeight / imgHeight) * 100;

      if (heightPercent <= 0) {
        viewportBox.style.display = "none";
        return;
      }

      // Account for object-fit:contain on the minimap thumbnail
      // The thumbnail may not fill its container, so we need to find where it actually renders
      const miniMapRect = headerMiniMapImg.getBoundingClientRect();
      const miniMapNaturalWidth = headerMiniMapImg.naturalWidth || 1;
      const miniMapNaturalHeight = headerMiniMapImg.naturalHeight || 1;
      const miniMapAspect = miniMapNaturalWidth / miniMapNaturalHeight;
      const containerAspect = miniMapRect.width / miniMapRect.height;

      let thumbnailLeft = 0,
        thumbnailWidth = miniMapRect.width;
      let thumbnailTop = 0,
        thumbnailHeight = miniMapRect.height;

      if (miniMapAspect > containerAspect) {
        // Image is wider than container - letterboxed top/bottom
        thumbnailHeight = miniMapRect.width / miniMapAspect;
        thumbnailTop = (miniMapRect.height - thumbnailHeight) / 2;
      } else {
        // Image is taller than container - letterboxed left/right
        thumbnailWidth = miniMapRect.height * miniMapAspect;
        thumbnailLeft = (miniMapRect.width - thumbnailWidth) / 2;
      }

      // Position viewport relative to actual thumbnail bounds (in pixels, then convert to %)
      const vpLeft = thumbnailLeft + (leftPercent / 100) * thumbnailWidth;
      const vpTop = thumbnailTop + (topPercent / 100) * thumbnailHeight;
      const vpWidth = (widthPercent / 100) * thumbnailWidth;
      const vpHeight = (heightPercent / 100) * thumbnailHeight;

      viewportBox.style.display = "block";
      viewportBox.style.top = `${vpTop}px`;
      viewportBox.style.height = `${vpHeight}px`;
      viewportBox.style.left = `${vpLeft}px`;
      viewportBox.style.width = `${vpWidth}px`;
    };
  };

  // For multiple images (sections), use scrollable layout with mini-map navigator
  if (images.length > 1) {
    // Create wrapper for scrollable content
    const scrollWrapper = div("", "menuScrollWrapper");
    scrollWrapper.style.cssText = "width:100%;";
    container.appendChild(scrollWrapper);

    // Create scrollable container for all sections
    const scroller = div("", "menuSectionsScroller");
    scroller.style.cssText = "display:block;";
    scrollWrapper.appendChild(scroller);

    // Store references for renderLayer
    menuState.sections = [];
    menuState.isScrollable = true;
    menuState.scroller = scroller;

    // Create a section for each image
    images.forEach((imgSrc, idx) => {
      const section = div("", "menuSection");
      section.dataset.sectionIndex = idx;
      section.style.cssText = "position:relative;width:100%;margin-bottom:8px;";

      const sectionInner = div("", "menuInner");
      sectionInner.style.cssText =
        "position:relative;width:100%;display:block;";

      const img = new Image();
      img.src = imgSrc;
      img.className = "menuImg";
      img.draggable = false;
      img.style.cssText = "width:100%;height:auto;display:block;";
      img.addEventListener("dragstart", (e) => e.preventDefault());

      const layer = div("", "overlayLayer");
      layer.dataset.sectionIndex = idx;

      sectionInner.appendChild(img);
      sectionInner.appendChild(layer);
      section.appendChild(sectionInner);
      scroller.appendChild(section);

      // Store reference for this section
      menuState.sections.push({
        index: idx,
        img: img,
        layer: layer,
        inner: sectionInner,
        section: section,
      });
    });

    // For compatibility, also set primary references to first section
    menuState.img = menuState.sections[0].img;
    menuState.layer = menuState.sections[0].layer;
    menuState.inner = menuState.sections[0].inner;
    menuState.currentPage = 0; // Not really used in scrollable mode

    menuState.currentMiniMapPage = 0;
    const updateMiniMapViewport = createMiniMapViewportUpdater();
    menuState.updateMiniMapViewport = updateMiniMapViewport;

    // Function to update header mini-map to show current section
    const updateHeaderMiniMap = (pageIndex) => {
      const sections = menuState.sections;
      if (!sections || pageIndex < 0 || pageIndex >= sections.length) return;

      menuState.currentMiniMapPage = pageIndex;
      const section = sections[pageIndex];

      // Update header mini-map image
      const headerMiniMapImg = document.getElementById("headerMiniMapImg");
      if (headerMiniMapImg && section.img.src) {
        headerMiniMapImg.src = section.img.src;
      }

      // Update header mini-map label
      const headerMiniMapLabel = document.getElementById("headerMiniMapLabel");
      if (headerMiniMapLabel && sections.length > 1) {
        headerMiniMapLabel.textContent = `Page ${pageIndex + 1} of ${sections.length}`;
      }

      // Update viewport indicator on header mini-map
      updateMiniMapViewport();
    };

    // Detect which section is currently visible on scroll
    const updateCurrentSection = () => {
      const sections = menuState.sections;
      if (!sections || sections.length === 0) return;

      const menuContainer = document.getElementById("menu");
      if (!menuContainer) return;

      const containerRect = menuContainer.getBoundingClientRect();
      const containerMidY = containerRect.top + containerRect.height / 3;

      for (let i = 0; i < sections.length; i++) {
        const sectionRect = sections[i].section.getBoundingClientRect();
        if (
          sectionRect.top <= containerMidY &&
          sectionRect.bottom > containerMidY
        ) {
          const activePage = menuState.currentMiniMapPage || 0;
          if (activePage !== i) {
            updateHeaderMiniMap(i);
          } else {
            // Same page, just update viewport position
            updateMiniMapViewport();
          }
          break;
        }
      }
    };

    // Add scroll listener to menu container (not scroller) to update current section and viewport
    container.addEventListener("scroll", updateCurrentSection, {
      passive: true,
    });

    // Store mini-map update function
    menuState.updateHeaderMiniMap = updateHeaderMiniMap;

    // Initialize header mini-map when first image loads
    const initHeaderMiniMap = () => {
      const sections = menuState.sections;
      if (sections && sections.length > 0 && sections[0].img.complete) {
        updateHeaderMiniMap(0);
      }
    };

    menuState.sections.forEach((s) => {
      if (s.img.complete) {
        initHeaderMiniMap();
      } else {
        s.img.addEventListener("load", initHeaderMiniMap, { once: true });
      }
    });
  } else {
    // Single image - use original simple layout
    const inner = div("", "menuInner");
    container.appendChild(inner);

    const displayImage = images[0] || imageURL || "";
    const img = new Image();
    img.src = displayImage;
    img.className = "menuImg";
    img.draggable = false;
    inner.appendChild(img);

    const layer = div("", "overlayLayer");
    inner.appendChild(layer);

    img.addEventListener("dragstart", (e) => e.preventDefault());

    menuState.img = img;
    menuState.layer = layer;
    menuState.inner = inner;
    menuState.currentPage = currentPage;
    menuState.isScrollable = false;
    menuState.sections = [
      {
        index: 0,
        img,
        layer,
        inner,
        section: inner,
      },
    ];
    menuState.currentMiniMapPage = 0;

    const updateMiniMapViewport = createMiniMapViewportUpdater();
    menuState.updateMiniMapViewport = updateMiniMapViewport;
    container.addEventListener("scroll", updateMiniMapViewport, {
      passive: true,
    });
    const updateHeaderMiniMapSingle = () => {
      const headerMiniMapImg = document.getElementById("headerMiniMapImg");
      const headerMiniMapLabel = document.getElementById("headerMiniMapLabel");
      if (headerMiniMapImg) headerMiniMapImg.src = img.src || displayImage;
      if (headerMiniMapLabel) headerMiniMapLabel.textContent = "Page 1";
      if (typeof menuState.updateMiniMapViewport === "function") {
        menuState.updateMiniMapViewport();
      }
    };
    if (img.complete) {
      updateHeaderMiniMapSingle();
    } else {
      img.addEventListener("load", updateHeaderMiniMapSingle, { once: true });
    }
  }

  // Keep backward compatible reference
  const img = menuState.img;
  const layer = menuState.layer;
  const inner = menuState.inner;
  menuState.img = img;
  menuState.layer = layer;
  menuState.inner = inner;
  menuState.currentPage = currentPage; // Track current page for overlay filtering

  ensureMobileViewerChrome();
  updateZoomIndicator();

  // ========== Pinch-to-Zoom for Menu ==========
  (function setupPinchZoom() {
    let pinchScale = 1;
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let isPinching = false;
    let panStartX = 0,
      panStartY = 0;
    let translateX = 0,
      translateY = 0;
    let startTranslateX = 0,
      startTranslateY = 0;

    // Create or get a single zoom wrapper for all content
    let zoomWrapper = container.querySelector(".pinchZoomWrapper");
    if (!zoomWrapper) {
      zoomWrapper = document.createElement("div");
      zoomWrapper.className = "pinchZoomWrapper";
      zoomWrapper.style.cssText = "transform-origin:0 0;width:100%;";
      // Move all children into the wrapper
      while (container.firstChild) {
        zoomWrapper.appendChild(container.firstChild);
      }
      container.appendChild(zoomWrapper);
    }

    const getDistance = (t1, t2) => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const applyTransform = () => {
      zoomWrapper.style.transform = `translate(${translateX}px, ${translateY}px) scale(${pinchScale})`;
      // Update state for minimap
      menuState.pinchZoomState = { scale: pinchScale, translateX, translateY };
      // Trigger minimap update
      if (typeof menuState.updateMiniMapViewport === "function") {
        menuState.updateMiniMapViewport();
      }
    };

    const resetZoom = () => {
      pinchScale = 1;
      translateX = 0;
      translateY = 0;
      zoomWrapper.style.transform = "";
      menuState.pinchZoomState = { scale: 1, translateX: 0, translateY: 0 };
      if (typeof menuState.updateMiniMapViewport === "function") {
        menuState.updateMiniMapViewport();
      }
    };

    container.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2) {
          e.preventDefault(); // Prevent browser zoom
          isPinching = true;
          pinchStartDist = getDistance(e.touches[0], e.touches[1]);
          pinchStartScale = pinchScale;
          // Calculate pinch center for transform origin
          const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          panStartX = cx;
          panStartY = cy;
          startTranslateX = translateX;
          startTranslateY = translateY;
        } else if (e.touches.length === 1 && pinchScale > 1) {
          // Single finger pan when zoomed
          panStartX = e.touches[0].clientX;
          panStartY = e.touches[0].clientY;
          startTranslateX = translateX;
          startTranslateY = translateY;
        }
      },
      { passive: false },
    );

    container.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length === 2 && isPinching) {
          e.preventDefault(); // Prevent browser zoom
          const dist = getDistance(e.touches[0], e.touches[1]);
          const newScale = Math.min(
            Math.max(pinchStartScale * (dist / pinchStartDist), 1),
            4,
          );

          // Calculate pinch center
          const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;

          // Adjust translation to keep pinch center stable
          if (newScale !== pinchScale) {
            const containerRect = container.getBoundingClientRect();
            const localCx = cx - containerRect.left;
            const localCy = cy - containerRect.top;

            // Translate to keep the pinch point stationary
            const scaleChange = newScale / pinchScale;
            translateX = localCx - (localCx - translateX) * scaleChange;
            translateY = localCy - (localCy - translateY) * scaleChange;
          }

          pinchScale = newScale;
          applyTransform();
        } else if (e.touches.length === 1 && pinchScale > 1) {
          e.preventDefault(); // Prevent scroll when panning zoomed content
          const dx = e.touches[0].clientX - panStartX;
          const dy = e.touches[0].clientY - panStartY;
          translateX = startTranslateX + dx;
          translateY = startTranslateY + dy;
          applyTransform();
        }
      },
      { passive: false },
    );

    container.addEventListener(
      "touchend",
      (e) => {
        if (e.touches.length < 2) {
          isPinching = false;
        }
        // Reset if zoomed out to 1x
        if (pinchScale <= 1.05) {
          resetZoom();
        }
        // Update pan start for remaining finger
        if (e.touches.length === 1 && pinchScale > 1) {
          panStartX = e.touches[0].clientX;
          panStartY = e.touches[0].clientY;
          startTranslateX = translateX;
          startTranslateY = translateY;
        }
      },
      { passive: true },
    );

    // Double-tap to reset zoom
    let lastTap = 0;
    container.addEventListener(
      "touchend",
      (e) => {
        if (e.touches.length === 0) {
          const now = Date.now();
          if (now - lastTap < 300 && pinchScale > 1) {
            resetZoom();
          }
          lastTap = now;
        }
      },
      { passive: true },
    );

    // Store reset function for external use
    menuState.resetPinchZoom = resetZoom;
    menuState.pinchZoomState = { scale: 1, translateX: 0, translateY: 0 };
  })();

  // Track dish interaction for analytics
  const trackedDishes = new Set(); // Prevent duplicate tracking in same session
  const OWNER_EMAIL = "matt.29.ds@gmail.com";
  async function trackDishInteraction(item) {
    if (!item || !state.user?.loggedIn) return;

    // Don't track interactions from managers or owner - they're editing, not browsing
    const isOwner = state.user?.email === OWNER_EMAIL;
    const isManager = state.user?.role === "manager";
    if (isOwner || isManager) return;

    const dishName = item.id || item.name || item.label;
    if (!dishName) return;

    // Only track once per dish per session
    const trackKey = `${state.restaurant?.id}-${dishName}`;
    if (trackedDishes.has(trackKey)) return;
    trackedDishes.add(trackKey);

    try {
      const restaurantId = state.restaurant?.id || state.restaurant?._id;
      if (!restaurantId) return;

      // Get user's allergens and diets
      const userAllergens = (state.allergies || [])
        .map(normalizeAllergen)
        .filter(Boolean);
      const userDiets = (state.diets || [])
        .map(normalizeDietLabel)
        .filter(Boolean);

      // Calculate dish status based on user's restrictions
      let dishStatus = "neutral";
      const dishAllergens = (item.allergens || [])
        .map(normalizeAllergen)
        .filter(Boolean);
      const dishDiets = (item.diets || [])
        .map(normalizeDietLabel)
        .filter(Boolean); // Diets the dish IS compatible with
      const removable = (item.removable || [])
        .map((r) => normalizeAllergen(r.allergen))
        .filter(Boolean);

      const hasAllergenConflict = userAllergens.some((a) =>
        dishAllergens.includes(a),
      );
      const hasDietConflict = userDiets.some((d) => !dishDiets.includes(d));

      if (hasAllergenConflict || hasDietConflict) {
        // Check if all conflicts are removable
        const nonRemovableAllergens = userAllergens.filter(
          (a) => dishAllergens.includes(a) && !removable.includes(a),
        );
        if (nonRemovableAllergens.length > 0 || hasDietConflict) {
          dishStatus = "unsafe";
        } else {
          dishStatus = "removable";
        }
      } else if (userAllergens.length > 0 || userDiets.length > 0) {
        dishStatus = "safe";
      }

      const { error } = await window.supabaseClient
        .from("dish_interactions")
        .insert([
          {
            restaurant_id: restaurantId,
            dish_name: dishName,
            user_id: state.user.id,
            user_allergens: userAllergens,
            user_diets: userDiets,
            dish_status: dishStatus,
          },
        ]);

      if (error) {
        console.warn("Failed to track dish interaction:", error);
      }
    } catch (err) {
      console.warn("Error tracking dish interaction:", err);
    }
  }

  const showOverlayDetails = (evt, item, target) => {
    ensureMobileInfoPanel();
    let pointerType = "mouse";
    if (evt) {
      if (typeof evt.pointerType === "string") {
        pointerType = evt.pointerType;
      } else if (evt.type && evt.type.toLowerCase().includes("touch")) {
        pointerType = "touch";
      } else if (evt.type && evt.type.toLowerCase().includes("pointer")) {
        pointerType = "pen";
      }
    }

    // RELAXED CHECK: If we are on mobile (prefersMobileInfo), ALWAYS use mobile panel/zoom
    // This fixes issues where some mobile browsers report 'mouse' for tap events
    const useMobilePanel = prefersMobileInfo() || pointerType !== "mouse";
    if (useMobilePanel) {
      if (evt) {
        if (typeof evt.preventDefault === "function") evt.preventDefault();
        if (typeof evt.stopPropagation === "function") evt.stopPropagation();
      }

      // If already zoomed to this item, zoom out
      if (isOverlayZoomed && zoomedOverlayItem === item) {
        zoomOutOverlay();
        return;
      }

      hideTip();

      // Get the overlay box element
      const overlayBox = target?.classList?.contains("overlay")
        ? target
        : target?.closest
          ? target.closest(".overlay")
          : null;

      // Check if already zoomed (transitioning between dishes)
      const isTransition = isOverlayZoomed;

      // Use zoom instead of mobile panel - pass isTransition for smooth animation
      // Note: Don't add selected class here - let zoomToOverlay handle it AFTER
      // the zoomed class is added, so the correct CSS animation rule applies
      if (overlayBox) {
        zoomToOverlay(item, overlayBox, isTransition);
      }

      // Track dish interaction for analytics (mobile)
      trackDishInteraction(item);
      return;
    }
    if (mobileInfoPanel && mobileInfoPanel.classList.contains("show")) {
      mobileInfoPanel.classList.remove("show");
      mobileInfoPanel.style.display = "none";
      mobileInfoPanel.innerHTML = "";
      currentMobileInfoItem = null;
    }
    const client = evt?.changedTouches ? evt.changedTouches[0] : evt;
    const rect = target?.getBoundingClientRect
      ? target.getBoundingClientRect()
      : evt?.currentTarget?.getBoundingClientRect
        ? evt.currentTarget.getBoundingClientRect()
        : null;
    const clientX = client?.clientX ?? 0;
    const clientY = client?.clientY ?? 0;

    // Pass whether this is a click to showTipIn
    const isClick = evt && (evt.type === "click" || evt.type === "touchend");

    // If tip is pinned to a different overlay, don't show new tip unless clicking
    if (tipPinned && pinnedOverlayItem && !isClick) {
      const currentItemId = item.id || item.name || "";
      const pinnedItemId = pinnedOverlayItem.id || pinnedOverlayItem.name || "";
      if (currentItemId !== pinnedItemId) {
        // Different overlay, but not clicking - ignore hover completely
        return;
      }
    }

    showTipIn(
      pageTip,
      clientX,
      clientY,
      item.id || "Item",
      tooltipBodyHTML(item, state.allergies || [], state.diets || [], isClick),
      rect,
      isClick,
      item,
    );

    // Track dish interaction for analytics (only on click, not hover)
    if (isClick) {
      trackDishInteraction(item);
    }

    // Find the overlay box element (target might be badge or warning)
    const overlayBox = target?.classList?.contains("overlay")
      ? target
      : target?.closest
        ? target.closest(".overlay")
        : null;
    if (overlayBox) {
      // Remove selected from all overlays only if this is a click (not just hover)
      if (isClick) {
        document
          .querySelectorAll(".overlay")
          .forEach((ov) => ov.classList.remove("selected"));
        // Add selected to clicked overlay
        overlayBox.classList.add("selected");
        setOverlayPulseColor(overlayBox);
        // Force reflow to ensure animation starts
        void overlayBox.offsetWidth;
      } else {
        // On hover, only add selected if not pinned to any overlay
        // When pinned, don't change selection at all - keep the pinned overlay selected
        if (!tipPinned) {
          document
            .querySelectorAll(".overlay")
            .forEach((ov) => ov.classList.remove("selected"));
          overlayBox.classList.add("selected");
          setOverlayPulseColor(overlayBox);
        }
      }
    }
  };

  // Make showOverlayDetails globally accessible for auto-opening overlays from dish search
  window.showOverlayDetails = showOverlayDetails;

  function renderLayer() {
    const colors = {
      safe: "var(--ok)",
      removable: "var(--warn)",
      unsafe: "var(--bad)",
      neutral: "#ffffff1a",
    };
    const allOverlays = Array.isArray(state.restaurant?.overlays)
      ? state.restaurant.overlays
      : [];

    // Handle scrollable multi-section mode
    if (
      menuState.isScrollable &&
      menuState.sections &&
      menuState.sections.length > 0
    ) {
      menuState.sections.forEach((section, sectionIdx) => {
        // Clear existing overlays for this section
        [...section.layer.querySelectorAll(".overlay")].forEach((n) =>
          n.remove(),
        );

        // Check if section image is ready
        if (
          !section.img.complete ||
          !section.img.naturalWidth ||
          !section.img.clientWidth ||
          !section.img.clientHeight
        ) {
          return; // Skip this section for now
        }

        section.layer.style.width = section.img.clientWidth + "px";
        section.layer.style.height = section.img.clientHeight + "px";

        // Filter overlays for this section (by pageIndex matching section index)
        const sectionOverlays = allOverlays.filter(
          (o) => (o.pageIndex || 0) === sectionIdx,
        );

        sectionOverlays.forEach((it) => {
          renderOverlayBox(it, section.layer, colors);
        });
      });
      return;
    }

    // Original single-image mode
    [...layer.querySelectorAll(".overlay")].forEach((n) => n.remove());

    if (
      !img.complete ||
      !img.naturalWidth ||
      !img.clientWidth ||
      !img.clientHeight
    ) {
      console.log("Image not ready yet");
      return;
    }

    layer.style.width = img.clientWidth + "px";
    layer.style.height = img.clientHeight + "px";

    // Filter overlays by current pageIndex
    const pageForFilter =
      menuState.currentPage !== undefined ? menuState.currentPage : 0;
    const pageOverlays = allOverlays.filter(
      (o) => (o.pageIndex || 0) === pageForFilter,
    );

    pageOverlays.forEach((it) => {
      renderOverlayBox(it, layer, colors);
    });
  }

  // Helper function to render a single overlay box
  function renderOverlayBox(it, targetLayer, colors) {
    const box = document.createElement("div");
    const st = computeStatus(it, state.allergies || [], state.diets || []);
    // Add status as class for easier styling and selection
    box.className = `overlay ${st}`;
    box.style.borderColor = colors[st] || colors.neutral;
    box.style.left = (+it.x || 0) + "%";
    box.style.top = (+it.y || 0) + "%";
    box.style.width = (+it.w || 0) + "%";
    box.style.height = (+it.h || 0) + "%";

    // Determine status icons
    const isDanger = st === "unsafe";
    const isCaution = st === "removable";
    const hasCross = hasCrossContamination(
      it,
      state.allergies || [],
      state.diets || [],
    );

    // Add warning icon for cross-contamination risk (any status with cross-contamination, or removable status)
    if (isCaution || hasCross) {
      const warning = document.createElement("div");
      warning.className = "ovWarning";
      warning.title = "Cross-contamination risk";
      warning.textContent = "⚠";
      box.appendChild(warning);
    }

    const badge = document.createElement("div");
    badge.className = "ovBadge";
    badge.title = "Details";
    badge.textContent = "i";
    // Click handler bubbles to box
    box.appendChild(badge);

    box.addEventListener("mousemove", (e) => {
      if (prefersMobileInfo()) return;
      // If any overlay is pinned (including this one), don't reposition/re-render the tooltip
      // The pinned tooltip should stay in place until explicitly closed or another overlay is clicked
      if (tipPinned) {
        return;
      }
      const rect =
        e.currentTarget && e.currentTarget.getBoundingClientRect
          ? e.currentTarget.getBoundingClientRect()
          : box.getBoundingClientRect();
      // mousemove is hover, not click
      showTipIn(
        pageTip,
        e.clientX,
        e.clientY,
        it.id || "Item",
        tooltipBodyHTML(it, state.allergies || [], state.diets || [], false),
        rect,
        false,
        it,
      );
    });
    box.addEventListener("mouseleave", () => {
      // hideTip already checks if tipPinned is true before hiding
      hideTip();
    });

    // Consolidated Click/Touch Handler
    box.addEventListener("click", (e) => {
      showOverlayDetails(e, it, box);
    });

    targetLayer.appendChild(box);
  }

  window.__rerenderLayer__ = renderLayer;
  captureMenuBaseDimensions(true);

  // Calculate and apply initial zoom based on smallest box size
  function applyInitialZoom() {
    // Disable auto-zoom so menus load at a consistent scale
    inner.style.transform = "";
    inner.style.transformOrigin = "0 0";
    container.style.overflow = "auto";
    container.style.maxHeight = "";
    menuState.initialZoom = 1;
  }

  // Handle image load for scrollable sections
  if (menuState.isScrollable && menuState.sections) {
    let loadedCount = 0;
    const totalSections = menuState.sections.length;

    menuState.sections.forEach((section) => {
      const onSectionLoad = () => {
        loadedCount++;
        // Re-render this section's overlays
        setTimeout(renderLayer, 50);
        if (loadedCount === totalSections) {
          captureMenuBaseDimensions(true);
        }
      };

      if (section.img.complete && section.img.naturalWidth) {
        onSectionLoad();
      } else {
        section.img.onload = onSectionLoad;
      }
    });
  } else if (img.complete && img.naturalWidth) {
    renderLayer();
    captureMenuBaseDimensions(true);
    setTimeout(applyInitialZoom, 100); // Apply zoom after layout settles
  } else {
    img.onload = () => {
      setTimeout(() => {
        renderLayer();
        applyInitialZoom();
      }, 50);
      captureMenuBaseDimensions(true);
      if (document.body.classList.contains("mobileViewerActive")) {
        setMobileZoom(mobileZoomLevel, true);
      }
    };
  }

  addEventListener(
    "resize",
    () => {
      // Skip re-render when zoomed - the transform handles positioning
      // and re-rendering would remove the selected class
      if (isOverlayZoomed) return;
      requestAnimationFrame(renderLayer);
    },
    { passive: true },
  );

  if (window.visualViewport) {
    visualViewport.addEventListener(
      "resize",
      () => {
        if (pageTip.style.display === "block") {
          const currentLeft = parseFloat(pageTip.style.left || 0);
          const currentTop = parseFloat(pageTip.style.top || 0);

          const zoom = visualViewport.scale || 1;
          const k = 1 / zoom;

          const isMobile = window.innerWidth <= 640;
          const vw = visualViewport.width;
          const vh = visualViewport.height;

          pageTip.style.transform = `scale(${k})`;
          pageTip.style.transformOrigin = "top left";

          const vw2 = visualViewport.width;
          const vh2 = visualViewport.height;
          const baseMaxWidth = isMobile
            ? Math.min(220, vw2 - 30)
            : Math.min(280, vw2 - 40);
          pageTip.style.maxWidth = baseMaxWidth + "px";

          requestAnimationFrame(() => {
            const pad = isMobile ? 8 : 12;
            const r = pageTip.getBoundingClientRect();

            let left = Math.min(currentLeft, vw2 - r.width - pad);
            let top = Math.min(currentTop, vh2 - r.height - pad);
            left = Math.max(pad, left);
            top = Math.max(pad, top);

            pageTip.style.left = left + "px";
            pageTip.style.top = top + "px";
          });
        }
      },
      { passive: true },
    );
  }
}

/* restaurant page */
function renderRestaurant() {
  renderTopbar();
  const root = document.getElementById("root");
  const rs = state.restaurant || {};
  // Auto-acknowledge if coming from dish search (has dishName parameter) or if ack parameter is set
  const urlParams = new URLSearchParams(window.location.search);
  const dishName = urlParams.get("dishName");
  const ackParam = urlParams.get("ack");
  const hasSubmittedNotice =
    orderFlow.tabletSimOrderId &&
    orderFlow.tabletSimState.orders.some(
      (o) =>
        o.id === orderFlow.tabletSimOrderId &&
        o.status !== TABLET_ORDER_STATUSES.CODE_ASSIGNED &&
        o.status !== TABLET_ORDER_STATUSES.RESCINDED_BY_DINER &&
        o.status !== TABLET_ORDER_STATUSES.REJECTED_BY_SERVER &&
        o.status !== TABLET_ORDER_STATUSES.REJECTED_BY_KITCHEN,
    );
  state.ack = !!dishName || ackParam === "1" || hasSubmittedNotice; // Auto-acknowledge if coming from dish search, if ack parameter is set, or if user has submitted a notice
  const isGuest = state.qr || !state.user?.loggedIn;
  if (!isGuest || !state.ack || state.isHowItWorks) {
    state.guestFilterEditing = false;
  }
  const showGuestFilterToggle = isGuest && !state.isHowItWorks;
  const guestFilterToggleHtml = showGuestFilterToggle
    ? `<button type="button" class="filterToggleBtn${state.guestFilterEditing ? " save" : ""}" data-guest-filter-toggle="1" style="${state.ack ? "" : "display:none;"}">${state.guestFilterEditing ? "Save" : "Edit"}</button>`
    : "";

  root.innerHTML = `
<!-- Fixed header section (page doesn't scroll, only menu does) -->
<div id="stickyHeader" style="background:var(--bg);padding:8px 16px 8px 16px;flex-shrink:0;">
  <h1 style="margin:0 0 8px 0;font-size:1.3rem">${esc(rs.name || "Restaurant")}</h1>

  <!-- Allergens/Diets/Buttons section with mini-map on left -->
  <div id="allergenDietRow" style="display:flex;gap:8px;margin-bottom:8px;align-items:stretch;">
    <!-- Mini-map thumbnail - hidden until I understand -->
    <div id="headerMiniMap" style="display:none;width:80px;flex-shrink:0;background:rgba(30,30,40,0.95);border-radius:8px;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:2px;">
      <div style="position:relative;width:100%;border-radius:8px;overflow:hidden;">
        <img id="headerMiniMapImg" style="width:100%;height:auto;cursor:pointer;object-fit:contain;display:block;" draggable="false">
        <div id="headerMiniMapViewport" style="position:absolute;box-sizing:border-box;border:2px solid #dc2626;background:rgba(220,38,38,0.15);pointer-events:none;border-radius:2px;"></div>
      </div>
      <div id="headerMiniMapLabel" style="font-size:9px;color:#9ca3af;margin-top:0;text-align:center;">Page 1</div>
    </div>

    <!-- Right side: allergens/diets on top, buttons below -->
    <div id="rightContentArea" style="flex:1;display:flex;flex-direction:column;gap:4px;min-width:0;">
      <!-- Top row: Allergens and Diets -->
      <div style="display:flex;gap:6px;">
        <!-- Allergens -->
        <div class="pill" style="flex:1;margin:0;padding:5px;min-width:0;overflow:hidden;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;gap:4px">
            <div style="font-weight:600;font-size:0.65rem;white-space:nowrap;">${isGuest ? "Allergens" : "Saved allergens"}</div>
            ${!state.qr && state.user?.loggedIn ? `<button class="btnLink clickable" id="editSavedBtn" style="font-size:0.6rem;flex-shrink:0;">Edit</button>` : guestFilterToggleHtml}
          </div>
          <div id="savedChips" class="saved-chip-row" style="font-size:0.65rem;display:flex;flex-wrap:nowrap;overflow-x:auto;gap:3px;-webkit-overflow-scrolling:touch;scrollbar-width:none;align-items:center;"></div>
        </div>

        <!-- Diets -->
        <div class="pill" style="flex:1;margin:0;padding:5px;min-width:0;overflow:hidden;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;gap:4px">
            <div style="font-weight:600;font-size:0.65rem;white-space:nowrap;">${isGuest ? "Diets" : "Saved diets"}</div>
            ${!state.qr && state.user?.loggedIn ? `<button class="btnLink clickable" id="editSavedDietsBtn" style="font-size:0.6rem;flex-shrink:0;">Edit</button>` : guestFilterToggleHtml}
          </div>
          <div id="dietChips" class="saved-chip-row" style="font-size:0.65rem;display:flex;flex-wrap:nowrap;overflow-x:auto;gap:3px;-webkit-overflow-scrolling:touch;scrollbar-width:none;align-items:center;"></div>
        </div>
      </div>

      <!-- Bottom row: Action buttons (hidden until acknowledge) -->
      <div id="actionButtonsRow" style="display:none;gap:3px;">
        <button class="btn btnPrimary" id="restaurantWebsiteBtn" style="flex:1;padding:4px 1px;font-size:8px;white-space:nowrap;">Restaurant website</button>
        <button class="btn btnPrimary" id="restaurantCallBtn" style="flex:1;padding:4px 1px;font-size:8px;white-space:nowrap;">Call restaurant</button>
        <button class="btn btnPrimary" id="restaurantFeedbackBtn" style="flex:1;padding:4px 1px;font-size:8px;white-space:nowrap;">Send feedback</button>
        <button class="btn" id="reportIssueBtn" style="flex:1;padding:4px 1px;font-size:8px;white-space:nowrap;background:#dc2626;border-color:#dc2626;color:#fff;">Report issue</button>
      </div>

      <!-- Last confirmed row (hidden until acknowledge) -->
      <div id="confirmedRow" style="display:none;font-size:0.6rem;color:#9ca3af;text-align:left;">
        Last confirmed by restaurant staff: ${rs.lastConfirmed ? esc(fmtDate(rs.lastConfirmed)) : "—"}
      </div>
    </div>
  </div>

  <!-- Disclaimer banner (hidden after acknowledge) -->
  <div class="banner" id="disclaimerBanner" style="${state.ack ? "display:none;" : ""}margin-bottom:8px;">
    <span style="font-size:0.85rem">Reference only. Always inform staff about your allergens.</span>
    <button class="ackBtn ${state.ack ? "on" : "off"}" id="ackBtn" style="font-size:0.8rem;padding:4px 10px">${state.ack ? "Acknowledged" : "I understand"}</button>
  </div>

  <!-- Legend row - icon key -->
  <div id="legendRow" style="display:none;flex-direction:column;color:#a8b2d6;padding:4px 0;text-align:center;line-height:1.6;overflow:hidden;width:100%;">
    <div id="legendLine1" style="display:flex;justify-content:center;align-items:center;width:100%;overflow:hidden;">
      <span class="legendText" style="white-space:nowrap;font-size:12px;display:inline-flex;align-items:center;">
        <span class="legendSwatch legendSwatchGreen"></span>Complies ·
        <span class="legendSwatch legendSwatchYellow" style="margin-left:8px;"></span>Can be modified to comply ·
        <span class="legendSwatch legendSwatchRed" style="margin-left:8px;"></span>Cannot be modified to comply
      </span>
    </div>
    <div id="legendLine2" style="display:flex;justify-content:center;align-items:center;width:100%;overflow:hidden;">
      <span class="legendText" style="white-space:nowrap;font-size:12px;display:inline-flex;align-items:center;">⚠️ Cross-contamination risk · 👆 Tap dishes for details · 🤏 Pinch menu to zoom in/out</span>
    </div>
  </div>
</div>

<!-- Menu container - the ONLY scrollable element -->
<div class="menuWrap" id="menu"></div>

  `;

  // Make root a flex column so menu takes remaining space
  // Position below the topbar, fill remaining viewport
  setRootOffsetPadding("0");

  const chipsHost = document.getElementById("savedChips");
  const dietChipsHost = document.getElementById("dietChips");
  const renderFilterChips = () => {
    const allowInteractiveFilters =
      state.isHowItWorks ||
      (!state.ack && isGuest) ||
      (isGuest && state.guestFilterEditing);
    if (allowInteractiveFilters) renderSelector(chipsHost);
    else if (isGuest) renderSelectedChips(chipsHost);
    else renderSavedChips(chipsHost);

    if (allowInteractiveFilters) renderDietSelector(dietChipsHost);
    else if (isGuest) renderSelectedDiets(dietChipsHost);
    else renderSavedDiets(dietChipsHost);
  };
  renderFilterChips();

  const syncGuestFilterToggleButtons = () => {
    const buttons = document.querySelectorAll("[data-guest-filter-toggle]");
    if (!buttons.length) return;
    buttons.forEach((btn) => {
      btn.textContent = state.guestFilterEditing ? "Save" : "Edit";
      btn.classList.toggle("save", state.guestFilterEditing);
      btn.style.display =
        isGuest && state.ack && !state.isHowItWorks ? "inline-flex" : "none";
    });
  };

  const bindGuestFilterToggleButtons = () => {
    const buttons = document.querySelectorAll("[data-guest-filter-toggle]");
    buttons.forEach((btn) => {
      if (btn.__guestToggleBound) return;
      btn.__guestToggleBound = true;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.guestFilterEditing = !state.guestFilterEditing;
        renderFilterChips();
        syncGuestFilterToggleButtons();
      });
    });
  };

  bindGuestFilterToggleButtons();
  syncGuestFilterToggleButtons();

  const menu = document.getElementById("menu");
  ensureMobileInfoPanel();
  mobileInfoPanel.classList.remove("show");
  mobileInfoPanel.style.display = "none";
  mobileInfoPanel.innerHTML = "";

  // If already acknowledged (from dish search), show menu immediately
  const menuShouldShow = state.ack || state.isHowItWorks;
  if (menuShouldShow) {
    if (state.ack) {
      send({ type: "ack" });
    }
    menu.classList.add("show");
    document.getElementById("actionButtonsRow").style.display = "flex";
    document.getElementById("legendRow").style.display = "flex";
    setTimeout(resizeLegendToFit, 0);
    document.getElementById("confirmedRow").style.display = "block";
    // Show the header mini-map
    const headerMiniMap = document.getElementById("headerMiniMap");
    if (headerMiniMap) headerMiniMap.style.display = "flex";
    drawMenu(menu, rs.menuImage, rs.menuImages, 0);

    // Update header mini-map with menu image
    const headerMiniMapImg = document.getElementById("headerMiniMapImg");
    const headerMiniMapLabel = document.getElementById("headerMiniMapLabel");
    const menuImages = rs.menuImages || (rs.menuImage ? [rs.menuImage] : []);
    if (headerMiniMapImg && menuImages.length > 0) {
      headerMiniMapImg.src = menuImages[0];
      if (headerMiniMapLabel) {
        headerMiniMapLabel.textContent =
          menuImages.length > 1 ? `Page 1 of ${menuImages.length}` : "";
      }
      // Click to cycle through pages
      headerMiniMapImg.onclick = () => {
        const menuState = getMenuState();
        if (menuState && menuState.sections && menuState.sections.length > 1) {
          const nextPage =
            ((menuState.currentMiniMapPage || 0) + 1) %
            menuState.sections.length;
          menuState.sections[nextPage].section.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      };
    }

    const hasMenuImage = !!rs.menuImage;
    if (hasMenuImage) {
      ensureMobileViewerChrome();
      updateZoomIndicator();
      const notice = document.getElementById("mobileMenuNotice");
      if (notice) {
        if (prefersMobileInfo()) {
          notice.style.display = "flex";
          notice.setAttribute("aria-hidden", "false");
          notice.dataset.enabled = "1";
          const openBtn = notice.querySelector(".mobileMenuOpenBtn");
          if (openBtn) {
            if (!openBtn.__openHandler) {
              const handler = (e) => {
                if (e && typeof e.preventDefault === "function")
                  e.preventDefault();
                if (e && typeof e.stopPropagation === "function")
                  e.stopPropagation();
                openMobileViewer();
              };
              openBtn.__openHandler = handler;
              openBtn.addEventListener("click", handler);
            }
          }
          // Auto-open mobile viewer if coming from dish search with dishName
          // Delay to allow overlay selection to complete first
          if (dishName) {
            setTimeout(() => {
              openMobileViewer();
            }, 700);
          }
        } else {
          notice.style.display = "none";
          notice.setAttribute("aria-hidden", "true");
          delete notice.dataset.enabled;
        }
      }
    }
  }

  document.getElementById("ackBtn").onclick = () => {
    if (!state.ack) {
      send({ type: "ack" });
      state.ack = true;
    }
    const b = document.getElementById("ackBtn");
    b.textContent = "Acknowledged";
    b.classList.remove("off");
    b.classList.add("on");
    if (isGuest) state.guestFilterEditing = false;
    renderFilterChips();
    syncGuestFilterToggleButtons();
    // Hide the disclaimer banner after acknowledge
    const disclaimerBanner = document.getElementById("disclaimerBanner");
    if (disclaimerBanner) disclaimerBanner.style.display = "none";
    // Show the header mini-map now
    const headerMiniMap = document.getElementById("headerMiniMap");
    if (headerMiniMap) headerMiniMap.style.display = "flex";
    menu.classList.add("show");
    document.getElementById("actionButtonsRow").style.display = "flex";
    document.getElementById("legendRow").style.display = "flex";
    setTimeout(resizeLegendToFit, 0);
    document.getElementById("confirmedRow").style.display = "block";
    drawMenu(menu, rs.menuImage, rs.menuImages, 0);
    const hasMenuImage = !!rs.menuImage;
    if (hasMenuImage) {
      ensureMobileViewerChrome();
      updateZoomIndicator();
      const notice = document.getElementById("mobileMenuNotice");
      if (notice) {
        if (prefersMobileInfo()) {
          notice.style.display = "flex";
          notice.setAttribute("aria-hidden", "false");
          notice.dataset.enabled = "1";
          const openBtn = notice.querySelector(".mobileMenuOpenBtn");
          if (openBtn) {
            if (!openBtn.__openHandler) {
              const handler = (e) => {
                if (e && typeof e.preventDefault === "function")
                  e.preventDefault();
                if (e && typeof e.stopPropagation === "function")
                  e.stopPropagation();
                openMobileViewer();
              };
              openBtn.__openHandler = handler;
              openBtn.addEventListener("click", handler);
            }
          }
        } else {
          notice.style.display = "none";
          notice.setAttribute("aria-hidden", "true");
          delete notice.dataset.enabled;
        }
      }
    } else {
      const notice = document.getElementById("mobileMenuNotice");
      if (notice) {
        notice.style.display = "none";
        notice.setAttribute("aria-hidden", "true");
        delete notice.dataset.enabled;
        const openBtn = notice.querySelector(".mobileMenuOpenBtn");
        if (openBtn && openBtn.__openHandler) {
          openBtn.removeEventListener("click", openBtn.__openHandler);
          delete openBtn.__openHandler;
        }
      }
    }
    if (mobileInfoPanel) {
      mobileInfoPanel.classList.remove("show");
      mobileInfoPanel.style.display = "none";
      mobileInfoPanel.innerHTML = "";
      currentMobileInfoItem = null;
    }
    if ((state.qr || urlQR) && !state.user?.loggedIn && shouldShowQrPromo()) {
      queueQrPromoTimer();
    } else {
      cancelQrPromoTimer();
    }
  };

  if (!state.qr && state.user?.loggedIn) {
    const editBtn = document.getElementById("editSavedBtn");
    if (editBtn)
      editBtn.onclick = () =>
        send({ type: "navigate", to: "/accounts", slug: rs.slug });

    const editDietsBtn = document.getElementById("editSavedDietsBtn");
    if (editDietsBtn)
      editDietsBtn.onclick = () =>
        send({ type: "navigate", to: "/accounts", slug: rs.slug });
  }

  // Wire up restaurant action buttons
  const websiteBtn = document.getElementById("restaurantWebsiteBtn");
  if (websiteBtn)
    websiteBtn.onclick = () => {
      if (rs.website) window.open(rs.website, "_blank");
    };

  const callBtn = document.getElementById("restaurantCallBtn");
  if (callBtn)
    callBtn.onclick = () => {
      if (rs.phone) window.location.href = `tel:${rs.phone}`;
    };

  const feedbackBtn = document.getElementById("restaurantFeedbackBtn");
  if (feedbackBtn) feedbackBtn.onclick = () => openFeedbackModal();

  // Report issue button
  const reportIssueBtn = document.getElementById("reportIssueBtn");
  if (reportIssueBtn) reportIssueBtn.onclick = () => openReportIssueModal();

}



function renderEditor() {
  window.editorDirty = false; // Reset on editor entry
  renderTopbar();
  const rs = state.restaurant || {};
  const root = document.getElementById("root");
  root.innerHTML = `
<div class="editorLayout">
<div class="editorHeaderStack">
  <h1>Webpage editor</h1>
  <div class="editorHeaderRow">
    <div id="editorMiniMapSlot" class="editorMiniMapSlot"></div>
    <div class="editorControlColumn">
      <div class="editorToolbarScale" id="editorToolbarScale">
      <div class="editorToolbar" id="editorToolbar">
        <div class="editorGroup">
          <div class="editorGroupLabel">Editing</div>
          <div class="editorGroupButtons">
            <button class="btn btnPrimary" id="addBox">+ Add overlay</button>
            <button class="btn" id="undoBtn" title="Undo (Ctrl+Z)" style="opacity:0.5">↶ Undo</button>
            <button class="btn" id="redoBtn" title="Redo (Ctrl+Y)" style="opacity:0.5">↷ Redo</button>
            <button class="btn btnPrimary editorSaveBtn" id="saveBtn" style="display:none">Save to site</button>
          </div>
        </div>
        <div class="editorGroup">
          <div class="editorGroupLabel">Menu pages</div>
          <div class="editorGroupButtons">
            <button class="btn" id="uploadMenuBtn">🗂️ Edit menu images</button>
            <button class="btn" id="viewLogBtn">📋 View log of changes</button>
          </div>
        </div>
        <div class="editorGroup">
          <div class="editorGroupLabel">Restaurant</div>
          <div class="editorGroupButtons">
            <button class="btn" id="settingsBtn">⚙️ Restaurant settings</button>
            <button class="btn btnDanger" id="confirmBtn">Confirm information is up-to-date</button>
          </div>
        </div>
      </div>
      </div>
      <div class="editorNoteRow">
        <div class="note" id="editorNote" style="margin:0;flex:1;min-width:220px;">Drag to move. Drag any corner to resize. Click ✏️ to edit details.</div>
      </div>
    </div>
  </div>

  <!-- Unsaved Changes Warning -->
  <div id="editorUnsavedWarning" style="display:none;background:#2a1a0a;border:2px solid #f59e0b;border-radius:8px;padding:20px;margin:16px 0">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
    <span style="font-size:2rem">⚠️</span>
    <div>
      <div style="font-size:1.1rem;font-weight:600;color:#f59e0b;margin-bottom:4px">You have unsaved changes</div>
      <div style="font-size:0.95rem;color:#d1d5db">Would you like to save before exiting?</div>
    </div>
  </div>
  <div style="display:flex;gap:12px">
    <button type="button" class="btn btnPrimary" id="editorSaveAndExitBtn" style="flex:1;padding:12px;font-size:1rem">💾 Save Changes</button>
    <button type="button" class="btn" id="editorExitWithoutSavingBtn" style="flex:1;padding:12px;font-size:1rem;background:#4a1a1a;border-color:#721c24">Exit Without Saving</button>
  </div>
  <button type="button" class="btn" id="editorCancelExitBtn" style="width:100%;margin-top:12px;padding:8px;font-size:0.9rem;background:rgba(76,90,212,0.2);border-color:rgba(76,90,212,0.4)">Cancel</button>
</div>

  <div id="detectedDishesPanel" style="display:none;background:#1a2351;border:1px solid #2a3261;border-radius:12px;padding:20px;margin-bottom:16px;text-align:center">
  <div style="font-size:1.3rem;font-weight:600;margin-bottom:8px" id="currentDishName"></div>
  <div class="note" style="margin-bottom:12px">Press and drag on the menu to create an overlay for this item</div>
  <div style="display:flex;gap:12px;justify-content:center;align-items:center;font-size:14px;flex-wrap:wrap">
    <button class="btn" id="prevDishBtn" style="padding:6px 12px;font-size:13px">← Previous</button>
    <span id="dishProgress" style="color:#a8b2d6"></span>
    <button class="btn" id="nextDishBtn" style="padding:6px 12px;font-size:13px">Next →</button>
    <button class="btn btnSuccess" id="finishMappingBtn" style="padding:6px 12px;font-size:13px;display:none">✓ Finish Mapping</button>
  </div>
</div>
</div>

<div class="menuWrap show" id="menu"></div>
<!-- Navigation arrows above menu (always created, shown/hidden dynamically) -->
<div id="menuTopNav" style="display:none;justify-content:center;align-items:center;gap:12px;margin:16px 0;padding:12px;background:rgba(76,90,212,0.1);border-radius:8px">
  <button class="btn" id="prevPageBtn" style="padding:8px 16px">← Previous</button>
  <span id="pageIndicator" style="color:#e9ecff;font-weight:600">Page <span id="currentPageNum">1</span> of 1</span>
  <button class="btn" id="nextPageBtn" style="padding:8px 16px">Next →</button>
</div>
<!-- Navigation arrows below menu (always created, shown/hidden dynamically) -->
<!-- Navigation arrows below menu removed to prevent duplication -->
</div>
  `;
  setRootOffsetPadding("0");
  const menu = document.getElementById("menu");
  const syncToolbarScale = () => {
    const scaleWrap = document.getElementById("editorToolbarScale");
    const toolbar = document.getElementById("editorToolbar");
    if (!scaleWrap || !toolbar) return;
    toolbar.style.transform = "none";
    toolbar.style.width = "100%";
    scaleWrap.style.height = "";
    if (window.matchMedia("(max-width: 768px)").matches) {
      if (typeof window.__editorMiniMapResizeHandler === "function") {
        window.__editorMiniMapResizeHandler();
      }
      return;
    }

    const availableWidth = scaleWrap.clientWidth;
    const naturalWidth = toolbar.scrollWidth;
    if (!availableWidth || !naturalWidth) return;

    const scale = Math.min(1, availableWidth / naturalWidth);
    if (scale < 1) {
      toolbar.style.width = `${naturalWidth}px`;
      toolbar.style.transform = `scale(${scale})`;
      scaleWrap.style.height = `${Math.ceil(toolbar.offsetHeight * scale)}px`;
    } else {
      toolbar.style.transform = "none";
      toolbar.style.width = "100%";
      scaleWrap.style.height = "";
    }
    if (typeof window.__editorMiniMapResizeHandler === "function") {
      window.__editorMiniMapResizeHandler();
    }
  };
  if (!window.__editorToolbarScaleBound) {
    window.__editorToolbarScaleBound = true;
    window.__editorToolbarScaleHandler = () => {
      if (state.page !== "editor") return;
      syncToolbarScale();
    };
    window.addEventListener("resize", window.__editorToolbarScaleHandler);
    window.addEventListener("orientationchange", window.__editorToolbarScaleHandler);
  }

  // Support multiple menu images
  let menuImages = rs.menuImages || (rs.menuImage ? [rs.menuImage] : []);
  if (window.__editorOverrideMenuImages) {
    menuImages = window.__editorOverrideMenuImages;
    window.__editorOverrideMenuImages = null;
  }
  const hasOriginalMenuImages = Array.isArray(
    window.__editorOriginalMenuImages,
  );
  if (!hasOriginalMenuImages) {
    window.__editorOriginalMenuImages = JSON.parse(JSON.stringify(menuImages));
  }
  const originalMenuImages = JSON.parse(
    JSON.stringify(window.__editorOriginalMenuImages || menuImages),
  );
  let currentPageIndex = 0;
  let applyCurrentPageOnLoad = false;
  if (Number.isInteger(window.__editorOverrideCurrentPage)) {
    currentPageIndex = Math.min(
      Math.max(window.__editorOverrideCurrentPage, 0),
      Math.max(0, menuImages.length - 1),
    );
    applyCurrentPageOnLoad = true;
    window.__editorOverrideCurrentPage = null;
  }

  // Editor sections storage for multi-image support
  const editorSections = [];
  let updateEditorMiniMap = null;
  let inner;
  let img;
  let overlayLayer;

  const editorSectionsApi = initEditorSections({
    menu,
    menuImages,
    div,
    editorSections,
    getCurrentPageIndex: () => currentPageIndex,
    setCurrentPageIndex: (value) => {
      currentPageIndex = value;
    },
    getDrawAll: () => drawAll,
    setRefs: ({ inner: nextInner, img: nextImg, overlayLayer: nextOverlay }) => {
      inner = nextInner;
      img = nextImg;
      overlayLayer = nextOverlay;
    },
  });

  updateEditorMiniMap = editorSectionsApi.updateEditorMiniMap;
  const rebuildEditorSectionsFromMenuImages =
    editorSectionsApi.rebuildEditorSectionsFromMenuImages;
  requestAnimationFrame(syncToolbarScale);

  function syncEditorMenuImages() {
    const shouldBeMulti = menuImages.length > 1;
    const isMulti = editorSections.length > 0;
    if (shouldBeMulti !== isMulti) {
      window.__editorOverrideOverlays = JSON.parse(JSON.stringify(overlays));
      window.__editorOverrideMenuImages = JSON.parse(
        JSON.stringify(menuImages),
      );
      window.__editorOverridePendingChanges = [...pendingChanges];
      window.__editorOverrideCurrentPage = currentPageIndex;
      window.__editorForceDirty = dirty || pendingChanges.length > 0;
      renderEditor();
      return true;
    }
    if (editorSections.length > 0) {
      rebuildEditorSectionsFromMenuImages();
      return false;
    }
    if (img) {
      img.src = menuImages[0] || "";
      if (img.complete) {
        drawAll();
      } else {
        img.addEventListener("load", () => drawAll(), { once: true });
      }
    }
    return false;
  }

  // Hide old pagination UI
  const updateMenuNavigationUI = () => {
    const menuTopNav = document.getElementById("menuTopNav");
    const menuBottomNav = document.getElementById("menuBottomNav");
    if (menuTopNav) menuTopNav.style.display = "none";
    if (menuBottomNav) menuBottomNav.style.display = "none";
  };
  updateMenuNavigationUI();

  function applyPendingMenuIndexRemap(oldImages, indexMap) {
    if (!Array.isArray(oldImages) || !Array.isArray(indexMap)) return;
    const oldToNewIndex = new Map();
    indexMap.forEach((oldIndex, newIndex) => {
      if (Number.isInteger(oldIndex)) {
        oldToNewIndex.set(oldIndex, newIndex);
      }
    });
    if (!oldToNewIndex.size) return;

    const removedIndices = [];
    for (let i = 0; i < oldImages.length; i++) {
      if (!oldToNewIndex.has(i)) {
        removedIndices.push(i);
      }
    }

    if (removedIndices.length) {
      for (let i = overlays.length - 1; i >= 0; i--) {
        const overlayPageIndex = overlays[i].pageIndex ?? 0;
        if (removedIndices.includes(overlayPageIndex)) {
          overlays.splice(i, 1);
        }
      }
    }

    overlays.forEach((overlay) => {
      const overlayPageIndex = overlay.pageIndex ?? 0;
      if (oldToNewIndex.has(overlayPageIndex)) {
        overlay.pageIndex = oldToNewIndex.get(overlayPageIndex);
      }
    });
  }

  let overlays = JSON.parse(JSON.stringify(rs.overlays || []));
  if (window.__editorOverrideOverlays) {
    overlays = window.__editorOverrideOverlays;
    window.__editorOverrideOverlays = null;
  }

  // Add pageIndex to overlays that don't have it (default to 0 for backward compatibility)
  overlays.forEach((o) => {
    if (o.pageIndex === undefined) {
      o.pageIndex = 0;
    }
  });

  // Log aiIngredients preservation when entering editor mode
  console.log(
    "renderEditor: Checking aiIngredients in loaded overlays:",
    overlays.map((o) => ({
      id: o.id,
      hasAiIngredients: !!o.aiIngredients,
      aiIngredientsType: typeof o.aiIngredients,
      aiIngredientsPreview: o.aiIngredients
        ? typeof o.aiIngredients === "string"
          ? o.aiIngredients.substring(0, 100) + "..."
          : JSON.stringify(o.aiIngredients).substring(0, 100)
        : null,
    })),
  );

  let dirty = false;
  const saveBtn = document.getElementById("saveBtn");
  function setDirty(v = true) {
    dirty = v;
    window.editorDirty = v;
    if (!saveBtn) return;
    saveBtn.style.display = dirty ? "inline-flex" : "none";
    saveBtn.classList.toggle("savePulse", dirty);
    if (dirty) {
      saveBtn.classList.remove("btnPrimary", "btnDanger");
      saveBtn.classList.add("btnSuccess");
    } else {
      saveBtn.classList.remove("btnSuccess", "btnDanger", "savePulse");
      saveBtn.classList.add("btnPrimary");
    }
  }
  if (window.__editorForceDirty) {
    setDirty(true);
    window.__editorForceDirty = false;
  }

  // Track all changes as they happen
  let pendingChanges = [];
  if (Array.isArray(window.__editorOverridePendingChanges)) {
    pendingChanges = [...window.__editorOverridePendingChanges];
    window.__editorOverridePendingChanges = null;
  }
  let originalOverlaysRef = JSON.stringify(rs.overlays || []);
  // Store original restaurant settings to detect changes
  let originalRestaurantSettings = {
    website: rs.website || null,
    phone: rs.phone || null,
    delivery_url: rs.delivery_url || null,
  };
  // Make update function accessible globally for the save handler
  window.updateOriginalRestaurantSettings = function (newSettings) {
    originalRestaurantSettings = newSettings;
  };
  const getPendingChanges = () => pendingChanges;
  const setPendingChanges = (next) => {
    pendingChanges = Array.isArray(next) ? next : [];
  };
  const getOriginalOverlaysRef = () => originalOverlaysRef;
  const setOriginalOverlaysRef = (next) => {
    originalOverlaysRef = next;
  };
  const getOriginalRestaurantSettings = () => originalRestaurantSettings;

  const editorHistoryApi = initEditorHistory({
    overlays,
    pendingChanges,
    setDirty,
    getDrawAll: () => drawAll,
  });
  const { pushHistory, undo, redo } = editorHistoryApi;

  const saveReviewApi = initEditorSaveFlow({
    state,
    rs,
    overlays,
    menuImages,
    saveBtn,
    send,
    esc,
    setDirty,
    pushHistory,
    formatAllergenLabel,
    getDrawAll: () => drawAll,
    renderEditor,
    getPendingChanges,
    setPendingChanges,
    getOriginalOverlaysRef,
    setOriginalOverlaysRef,
    getOriginalRestaurantSettings,
    originalMenuImages,
  });
  editorSaveApi = saveReviewApi;
  const { setSaveState, formatChangesForLog, describeOverlayChanges } =
    saveReviewApi;

  const mb = document.getElementById("modalBack");

  const editorOverlayApi = initEditorOverlays({
    overlays,
    editorSections,
    getInner: () => inner,
    getImg: () => img,
    setDirty,
    pushHistory,
    openItemEditor,
  });
  const drawAll = editorOverlayApi.drawAll;

  
  // Initialize drawAll when images load
  if (editorSections.length > 0) {
    // Multi-section: wait for all images to load
    let loadedCount = 0;
    editorSections.forEach((section) => {
      const onLoad = () => {
        loadedCount++;
        if (loadedCount === editorSections.length) {
          drawAll();
        }
      };
      if (section.img.complete) {
        onLoad();
      } else {
        section.img.addEventListener("load", onLoad, { once: true });
      }
    });
  } else {
    // Single image mode
    img.onload = drawAll;
    if (img.complete) drawAll();
  }

  const brandVerificationApi = initBrandVerification({
    overlays,
    rs,
    setDirty,
    drawAll,
    send,
    updateLastConfirmedText,
    getIssueReportMeta,
    openDishEditor,
    getAiAssistTableBody,
    showIngredientPhotoUploadModal,
    renderGroupedSourcesHtml,
    configureModalClose,
    openImageModal:
      typeof window !== "undefined" ? window.openImageModal : null,
    normalizeDietLabel,
    normalizeAllergen,
    ALLERGENS,
    DIETS,
    esc,
    norm,
    SUPABASE_KEY:
      typeof window !== "undefined" ? window.SUPABASE_KEY : "",
    fetchProductByBarcode:
      typeof window !== "undefined" ? window.fetchProductByBarcode : null,
    showReplacementPreview:
      typeof window !== "undefined" ? window.showReplacementPreview : null,
  });
  collectAllBrandItems = brandVerificationApi.collectAllBrandItems;
  openBrandVerification = brandVerificationApi.openBrandVerification;
  window.collectAllBrandItems = collectAllBrandItems;
  window.collectAiBrandItems = collectAllBrandItems;

  const changeLogApi = initChangeLog({
    esc,
    fmtDateTime,
    configureModalClose,
    send,
    state,
    rs,
    overlays,
    pendingChanges,
    setDirty,
    drawAll,
    pushHistory,
  });
  openChangeLog = changeLogApi.openChangeLog;

  const editorSettingsApi = initEditorSettings({
    state,
    esc,
    configureModalClose,
    updateOrderConfirmModeVisibility:
      typeof orderFlow?.updateOrderConfirmModeVisibility === "function"
        ? orderFlow.updateOrderConfirmModeVisibility
        : null,
  });
  const openRestaurantSettings = editorSettingsApi.openRestaurantSettings;

  const confirmBtn = document.getElementById("confirmBtn");
  if (confirmBtn) {
    confirmBtn.onclick = () => {
      openBrandVerification();
    };
  }
  window.openBrandVerification = openBrandVerification;
  if (window.__openConfirmOnLoad) {
    setTimeout(() => {
      openBrandVerification();
      window.__openConfirmOnLoad = false;
    }, 120);
  }

  const viewLogBtn = document.getElementById("viewLogBtn");
  if (viewLogBtn) {
    viewLogBtn.onclick = () => {
      openChangeLog();
    };
  }

  const settingsBtn = document.getElementById("settingsBtn");
  if (settingsBtn) {
    settingsBtn.onclick = () => {
      openRestaurantSettings();
    };
  }

  const undoBtn = document.getElementById("undoBtn");
  if (undoBtn) {
    undoBtn.onclick = () => {
      undo();
    };
  }

  const redoBtn = document.getElementById("redoBtn");
  if (redoBtn) {
    redoBtn.onclick = () => {
      redo();
    };
  }

  // Keyboard shortcuts for undo/redo
  document.addEventListener("keydown", function handleEditorKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === "y" || (e.key === "z" && e.shiftKey))
    ) {
      e.preventDefault();
      redo();
    }
  });

  function updateLastConfirmedText() {
    const lastConfirmedText = document.getElementById("lastConfirmedText");
    if (lastConfirmedText) {
      const now = new Date();
      const isAdmin = state.user?.email === "matt.29.ds@gmail.com";
      const isManager = state.user?.role === "manager";
      const showAll = isAdmin || isManager;
      const info = getWeeksAgoInfo(now, showAll);
      if (info && info.text) {
        lastConfirmedText.textContent = "Last confirmed by staff: " + info.text;
        lastConfirmedText.style.color = info.color;
      } else {
        lastConfirmedText.textContent = "Last confirmed: " + fmtDateTime(now);
        lastConfirmedText.style.color = "";
      }
    }
  }

  
  document.getElementById("addBox").onclick = () => {
    const newOverlay = {
      id: "",
      x: 10,
      y: 10,
      w: 20,
      h: 8,
      allergens: [],
      removable: [],
      crossContamination: [],
      diets: [],
      details: {},
      pageIndex: currentPageIndex,
    };
    overlays.push(newOverlay);
    pendingChanges.push(`${newOverlay.id}: Added overlay`);
    drawAll();
    setDirty(true);
    pushHistory();
  };

  // Detect & Map Dishes - AI-assisted overlay creation
  const detectDishesBtn = document.getElementById("detectDishesBtn");
  if (detectDishesBtn) {
    detectDishesBtn.onclick = async () => {
      const btn = document.getElementById("detectDishesBtn");
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "🔍 Detecting dishes...";

      try {
        // Detect all dishes on the menu
        const result = await detectDishesOnMenu(rs.menuImage);

        if (!result.success || !result.dishes || result.dishes.length === 0) {
          alert(
            "Could not detect any dishes on the menu. Please try adding overlays manually.",
          );
          btn.disabled = false;
          btn.textContent = originalText;
          return;
        }

        // Show the detected dishes panel
        const panel = document.getElementById("detectedDishesPanel");
        const currentDishNameEl = document.getElementById("currentDishName");
        const dishProgressEl = document.getElementById("dishProgress");
        const prevBtn = document.getElementById("prevDishBtn");
        const nextBtn = document.getElementById("nextDishBtn");
        const finishBtn = document.getElementById("finishMappingBtn");

        let detectedDishes = result.dishes;
        let currentDishIndex = 0;
        let dragMode = true;
        let dragStart = null;
        let dragPreview = null;

        // Show current dish and update UI
        function showCurrentDish() {
          const mapped = detectedDishes.filter((d) => d.mapped).length;
          const total = detectedDishes.length;

          // Check if all done
          if (mapped >= total) {
            currentDishNameEl.textContent = "All items mapped!";
            dishProgressEl.textContent = `${mapped} of ${total} items mapped`;
            prevBtn.style.display = "none";
            nextBtn.style.display = "none";
            finishBtn.style.display = "inline-flex";
            menu.style.cursor = "";
            dragMode = false;
            return;
          }

          const dish = detectedDishes[currentDishIndex];
          currentDishNameEl.textContent = dish.name;
          dishProgressEl.textContent = `Item ${currentDishIndex + 1} of ${total} (${mapped} mapped)`;

          // Update button states
          prevBtn.disabled = currentDishIndex <= 0;
          nextBtn.disabled = currentDishIndex >= total - 1;
          finishBtn.style.display = mapped > 0 ? "inline-flex" : "none";

          menu.style.cursor = "crosshair";
          panel.style.display = "block";
          dragMode = true;
        }

        // Previous dish
        prevBtn.onclick = () => {
          if (currentDishIndex > 0) {
            currentDishIndex--;
            showCurrentDish();
          }
        };

        // Next dish
        nextBtn.onclick = () => {
          if (currentDishIndex < detectedDishes.length - 1) {
            currentDishIndex++;
            showCurrentDish();
          }
        };

        // Finish mapping
        finishBtn.onclick = () => {
          panel.style.display = "none";
          menu.style.cursor = "";
          dragMode = false;
          drawAll();
        };

        showCurrentDish();

        // Handle drag-to-create overlay
        function handleDragStart(e) {
          if (!dragMode) return;

          const rect = img.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;

          dragStart = { x, y };

          // Create preview element
          dragPreview = document.createElement("div");
          dragPreview.style.cssText =
            "position:absolute;border:2px dashed #4CAF50;background:rgba(76,175,80,0.2);pointer-events:none;z-index:1000";
          inner.appendChild(dragPreview);

          e.preventDefault();
        }

        function handleDragMove(e) {
          if (!dragStart || !dragPreview) return;

          const rect = img.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;

          const minX = Math.min(dragStart.x, x);
          const minY = Math.min(dragStart.y, y);
          const maxX = Math.max(dragStart.x, x);
          const maxY = Math.max(dragStart.y, y);

          dragPreview.style.left = minX + "%";
          dragPreview.style.top = minY + "%";
          dragPreview.style.width = maxX - minX + "%";
          dragPreview.style.height = maxY - minY + "%";

          e.preventDefault();
        }

        function handleDragEnd(e) {
          if (!dragStart || !dragPreview) return;

          const rect = img.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;

          const minX = Math.min(dragStart.x, x);
          const minY = Math.min(dragStart.y, y);
          const maxX = Math.max(dragStart.x, x);
          const maxY = Math.max(dragStart.y, y);

          const w = maxX - minX;
          const h = maxY - minY;

          // Only create overlay if drag was meaningful (at least 1% width/height)
          if (w > 1 && h > 1) {
            const dish = detectedDishes[currentDishIndex];

            // Create new overlay
            const newOverlay = {
              id: dish.name,
              x: minX,
              y: minY,
              w: w,
              h: h,
              allergens: [],
              removable: [],
              crossContamination: [],
              diets: [],
              details: {},
              pageIndex: currentPageIndex,
            };

            overlays.push(newOverlay);
            pendingChanges.push(`${newOverlay.id}: Added overlay manually`);

            // Mark dish as mapped
            dish.mapped = true;

            drawAll();
            setDirty(true);
            pushHistory();
            showCurrentDish();
          }

          // Clean up
          if (dragPreview && dragPreview.parentNode) {
            dragPreview.parentNode.removeChild(dragPreview);
          }
          dragPreview = null;
          dragStart = null;

          e.preventDefault();
        }

        // Add drag handlers to menu image
        img.addEventListener("mousedown", handleDragStart);
        img.addEventListener("mousemove", handleDragMove);
        img.addEventListener("mouseup", handleDragEnd);
        img.addEventListener("mouseleave", handleDragEnd);

        btn.textContent = "✓ Dishes Detected";
      } catch (err) {
        console.error("Detect dishes error:", err);
        alert("Failed to detect dishes: " + err.message);
        btn.disabled = false;
        btn.textContent = originalText;
      }
    };
  }

  const editorNavigationApi = initEditorNavigation({
    menu,
    menuImages,
    editorSections,
    updateEditorMiniMap,
    updateMenuNavigationUI,
    drawAll,
    getImg: () => img,
    getCurrentPageIndex: () => currentPageIndex,
    setCurrentPageIndex: (value) => {
      currentPageIndex = value;
    },
    applyCurrentPageOnLoad,
  });

  const switchMenuPage = editorNavigationApi.switchMenuPage;

  initMenuImageEditor({
    state,
    rs,
    overlays,
    menuImages,
    pendingChanges,
    setDirty,
    updateMenuNavigationUI,
    applyPendingMenuIndexRemap,
    syncEditorMenuImages,
    switchMenuPage,
    analyzeBoxSizes,
    splitImageIntoSections,
    getCurrentPageIndex: () => currentPageIndex,
    setCurrentPageIndex: (value) => {
      currentPageIndex = value;
    },
  });

  const backBtn = document.getElementById("backBtn");
  if (backBtn)
    backBtn.onclick = () => {
      if (dirty) {
        // Show inline warning instead of confirm dialog
        const warningEl = document.getElementById("editorUnsavedWarning");
        if (warningEl) {
          warningEl.style.display = "block";

          // Scroll warning into view
          warningEl.scrollIntoView({ behavior: "smooth", block: "start" });

          // Set up button handlers
          const saveAndExitBtn = document.getElementById(
            "editorSaveAndExitBtn",
          );
          const exitWithoutSavingBtn = document.getElementById(
            "editorExitWithoutSavingBtn",
          );
          const cancelExitBtn = document.getElementById("editorCancelExitBtn");

          const handleSaveAndExit = () => {
            warningEl.style.display = "none";
            setSaveState("saving");
            // Combine pendingChanges (UI-tracked) with describeOverlayChanges (comparison-based)
            const uiChanges = [...pendingChanges];
            const comparisonChanges = describeOverlayChanges(
              JSON.parse(originalOverlaysRef),
              overlays,
            );

            // Merge and deduplicate changes
            const allChanges = [...uiChanges];
            comparisonChanges.forEach((change) => {
              // Extract text for comparison (handle both string and object entries)
              const changeText =
                typeof change === "object" && change.text
                  ? change.text
                  : String(change);
              if (!uiChanges.includes(changeText)) {
                allChanges.push(change);
              }
            });

            let changesList = allChanges;
            if (changesList.length) {
              const formattedChanges = formatChangesForLog(changesList);
              send({
                type: "saveOverlays",
                overlays,
                menuImages: menuImages,
                menuImage: menuImages[0] || rs.menuImage || "",
                changes: formattedChanges,
              });
              // Stay in editor after saving - dirty flag will be reset by setSaveState('saved')
            } else {
              // No changes to save, just hide the warning
              setSaveState("saved");
            }
          };

          const handleExitWithoutSaving = () => {
            warningEl.style.display = "none";
            window.__editorOriginalMenuImages = null;
            window.__editorOverridePendingChanges = null;
            window.__editorOverrideCurrentPage = null;
            window.__editorAutoOpenMenuUpload = false;
            state.page = "restaurant";
            render();
          };

          const handleCancelExit = () => {
            warningEl.style.display = "none";
          };

          // Remove old listeners and add new ones
          if (saveAndExitBtn) {
            const newBtn = saveAndExitBtn.cloneNode(true);
            saveAndExitBtn.parentNode.replaceChild(newBtn, saveAndExitBtn);
            newBtn.onclick = handleSaveAndExit;
          }
          if (exitWithoutSavingBtn) {
            const newBtn = exitWithoutSavingBtn.cloneNode(true);
            exitWithoutSavingBtn.parentNode.replaceChild(
              newBtn,
              exitWithoutSavingBtn,
            );
            newBtn.onclick = handleExitWithoutSaving;
          }
          if (cancelExitBtn) {
            const newBtn = cancelExitBtn.cloneNode(true);
            cancelExitBtn.parentNode.replaceChild(newBtn, cancelExitBtn);
            newBtn.onclick = handleCancelExit;
          }
        }
      } else {
        window.__editorOriginalMenuImages = null;
        window.__editorOverridePendingChanges = null;
        window.__editorOverrideCurrentPage = null;
        window.__editorAutoOpenMenuUpload = false;
        state.page = "restaurant";
        render();
      }
    };

  // Check if there's a pending dish to auto-open (from WordPress deep link)
  if (window.__pendingDishToOpen) {
    const pendingDish = window.__pendingDishToOpen;
    window.__pendingDishToOpen = null; // Clear it

    setTimeout(function () {
      console.log("Looking for dish:", pendingDish.dishName);
      console.log(
        "Available dishes:",
        overlays.map((o) => o.id),
      );

      const matchIndex = overlays.findIndex((item) => {
        const itemId = (item.id || "").toLowerCase().trim();
        const searchName = (pendingDish.dishName || "").toLowerCase().trim();

        // Exact match
        if (searchName && itemId === searchName) {
          return true;
        }
        // WordPress ID match
        if (
          pendingDish.dishId &&
          item.wpPostId &&
          item.wpPostId.toString() === pendingDish.dishId.toString()
        ) {
          return true;
        }
        // Contains match (either direction)
        if (
          searchName &&
          (itemId.includes(searchName) || searchName.includes(itemId))
        ) {
          return true;
        }
        // Fuzzy match - remove spaces and special chars
        const normalizedItem = itemId.replace(/[^a-z0-9]/g, "");
        const normalizedSearch = searchName.replace(/[^a-z0-9]/g, "");
        if (
          normalizedItem &&
          normalizedSearch &&
          normalizedItem === normalizedSearch
        ) {
          return true;
        }
        return false;
      });

      if (matchIndex !== -1) {
        console.log("Auto-opening dish editor for:", overlays[matchIndex].id);
        openItemEditor(overlays[matchIndex], matchIndex);

        // After opening, click AI button if requested
        if (pendingDish.openAI) {
          setTimeout(function () {
            const aiBtn = document.getElementById("aiAssistBtn");
            if (aiBtn) {
              console.log("Auto-clicking AI Ingredient Helper button");
              if (pendingDish.ingredientName) {
                window.__pendingIngredientToScroll = pendingDish.ingredientName;
              }
              aiBtn.click();
            }
          }, 500);
        }
      } else {
        console.log("Could not find dish to auto-open:", pendingDish);
        console.log("Tried to match:", pendingDish.dishName);
      }
    }, 500);
  }

  function openItemEditor(it, idx) {
    configureModalClose({ visible: false });
    if (mb) mb.onclick = null;
    const body = document.getElementById("modalBody");
    document.getElementById("modalTitle").textContent = "Edit item";

    // Check if this is a new item or has existing data
    const hasExistingData =
      (it.allergens && it.allergens.length > 0) ||
      (it.details && Object.keys(it.details).length > 0);

    // Hide the modal initially - AI assistant will open on top
    if (mb) mb.style.display = "none";

    body.innerHTML = `<div class="algRow" style="grid-template-columns:1fr">
    <input id="itemName" class="algInput" style="font-weight:700" placeholder="Item name" value="${esc(it.id || "")}">
  </div>

  <!--Delete Overlay Warning-->
  <div id="editorDeleteWarning" style="display:none;background:#1a0a0a;border:2px solid #dc2626;border-radius:8px;padding:20px;margin:16px 0">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <span style="font-size:2rem">🗑️</span>
      <div>
        <div style="font-size:1.1rem;font-weight:600;color:#dc2626;margin-bottom:4px">Delete this dish?</div>
        <div style="font-size:0.95rem;color:#d1d5db">This action cannot be undone.</div>
      </div>
    </div>
    <div style="display:flex;gap:12px">
      <button type="button" class="btn btnDanger" id="editorConfirmDeleteBtn" style="flex:1;padding:12px;font-size:1rem;background:#dc2626;border-color:#b91c1c">🗑 Delete</button>
      <button type="button" class="btn" id="editorCancelDeleteBtn" style="flex:1;padding:12px;font-size:1rem;background:rgba(76,90,212,0.2);border-color:rgba(76,90,212,0.4)">Cancel</button>
    </div>
  </div>

  <div id="manualEntrySection" style="display:none;">
    <div id="algList"></div>
    <div class="note" style="margin:8px 0 4px">Live preview</div>
    <div id="previewBox" style="border:1px solid #2a3466;border-radius:10px;padding:10px"></div>
  </div>
  <div class="editorActionRow" style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
    <button class="btn btnPrimary" id="doneBtn">Done</button>
    <button class="btn btnDanger" id="delBtn">Delete overlay</button>
  </div>`;
    const list = document.getElementById("algList");
    if (!list) {
      console.error("algList element not found in DOM");
      return;
    }
    // Preserve existing AI ingredients data if available
    const existingIngredients = it.aiIngredients || "";
    const existingSummary = it.aiIngredientSummary || "";
    list.dataset.aiIngredients = existingIngredients;
    list.dataset.aiIngredientSummary = existingSummary;

    const sel = new Set(it.allergens || []);
    const details = it.details || {};
    const rem = new Map(
      (it.removable || []).map((r) => [r.allergen, r.component]),
    );
    const cross = new Set(it.crossContamination || []);

    // Add allergen section heading
    const allergenTitle = document.createElement("h3");
    allergenTitle.textContent = "Allergen Information";
    allergenTitle.style.cssText = "margin: 0 0 12px 0; color: var(--ink);";
    list.appendChild(allergenTitle);

    ALLERGENS.forEach((a) => {
      const row = document.createElement("div");
      row.className = "algRow";
      const b = document.createElement("div");
      b.className = "algBtn";
      b.textContent = formatAllergenLabel(a);
      b.dataset.a = a;
      if (sel.has(a)) b.classList.add("active");
      const inp = document.createElement("input");
      inp.className = "algInput";
      inp.placeholder = "Which part of the dish contains the allergen?";
      inp.value = details[a] || "";
      const lab = document.createElement("label");
      lab.className = "algChk";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = rem.has(a);
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode("can be accommodated"));
      const labCross = document.createElement("label");
      labCross.className = "algChk";
      const cbCross = document.createElement("input");
      cbCross.type = "checkbox";
      cbCross.checked = cross.has(a);
      labCross.appendChild(cbCross);
      labCross.appendChild(document.createTextNode("cross-contamination risk"));

      function reflect() {
        const on = b.classList.contains("active");
        inp.style.display = on ? "block" : "none";
        lab.style.display = on ? "flex" : "none";
        labCross.style.display = "flex";
        updatePreview();
      }
      b.onclick = () => {
        b.classList.toggle("active");
        reflect();
      };
      cb.onchange = updatePreview;
      cbCross.onchange = updatePreview;
      inp.oninput = updatePreview;
      row.appendChild(b);
      row.appendChild(inp);
      row.appendChild(lab);
      row.appendChild(labCross);
      list.appendChild(row);
      reflect();
    });

    // Add dietary preference section
    const dietTitle = document.createElement("h3");
    dietTitle.textContent = "Diets";
    dietTitle.style.cssText =
      "margin: 24px 0 12px 0; padding-top: 16px; border-top: 1px solid rgba(76,90,212,0.3); color: var(--ink);";
    list.appendChild(dietTitle);

    const dietSel = new Set(it.diets || []);
    DIETS.forEach((diet) => {
      const row = document.createElement("div");
      row.className = "algRow";
      const b = document.createElement("div");
      b.className = "algBtn dietBtn";
      b.textContent = diet;
      b.dataset.diet = diet;
      if (dietSel.has(diet)) b.classList.add("active");

      b.onclick = () => {
        b.classList.toggle("active");
        updatePreview();
      };
      row.appendChild(b);
      list.appendChild(row);
    });

    function updatePreview() {
      const tmp = {
        id: document.getElementById("itemName").value || it.id || "Item",
        allergens: [],
        removable: [],
        crossContamination: [],
        diets: [],
        details: {},
      };
      list.querySelectorAll(".algRow").forEach((row) => {
        const btn = row.querySelector(".algBtn");
        const a = btn.dataset.a;
        const diet = btn.dataset.diet;
        const on = btn.classList.contains("active");

        if (diet) {
          // This is a diet button
          if (on) tmp.diets.push(diet);
        } else if (a) {
          // This is an allergen button
          const txt = row.querySelector(".algInput")?.value.trim() || "";
          const checkboxes = row.querySelectorAll('input[type="checkbox"]');
          const isRem = checkboxes[0]?.checked;
          const isCross = checkboxes[1]?.checked;
          if (on) {
            tmp.allergens.push(a);
            if (txt) tmp.details[a] = txt;
            if (isRem) tmp.removable.push({ allergen: a, component: txt || a });
          }
          if (isCross) {
            tmp.crossContamination.push(a);
          }
        }
      });

      const conflicts = [];
      tmp.diets.forEach((diet) => {
        const restricted = getDietAllergenConflicts(diet);
        const hits = restricted.filter((allergen) =>
          tmp.allergens.includes(allergen),
        );
        if (hits.length) conflicts.push({ diet, allergens: hits });
      });

      const conflictHtml = conflicts.length
        ? `<div class="aiDietConflictMessage">${conflicts
            .map((conflict) => {
              const dietLabel = esc(conflict.diet);
              const allergenList = conflict.allergens
                .map((allergen) => esc(formatAllergenLabel(allergen)))
                .join(", ");
              return `<div><strong>${dietLabel}</strong> conflicts with ${allergenList}</div>`;
            })
            .join("")}</div>`
        : "";

      document.getElementById("previewBox").innerHTML =
        conflictHtml +
        tooltipBodyHTML(tmp, ALLERGENS.slice(), DIETS.slice(), true);
    }
    updatePreview();

    function applyIngredientsFromAi(rows, extraData) {
      if (!Array.isArray(rows) || !rows.length) {
        aiAssistSetStatus("No ingredients to apply.", "warn");
        return;
      }
      // Save AI ingredients data to the overlay object immediately
      console.log(
        "applyIngredientsFromAi saving rows:",
        rows.map((r) => ({
          name: r.name,
          needsScan: r.needsScan,
          userOverriddenScan: r.userOverriddenScan,
          confirmed: r.confirmed,
        })),
      );
      // Verify appeal state is included
      const appealRows = rows.filter((r) => r.userOverriddenScan === true);
      if (appealRows.length > 0) {
        console.log(
          "APPLY: Found appeal rows being saved:",
          appealRows.map((r) => ({
            name: r.name,
            needsScan: r.needsScan,
            userOverriddenScan: r.userOverriddenScan,
          })),
        );
      }
      if (list) {
        list.dataset.aiIngredients = JSON.stringify(rows);
      }
      it.aiIngredients = JSON.stringify(rows);
      console.log("Saved it.aiIngredients (full):", it.aiIngredients);

      // Save the recipe description text from the textarea
      const recipeTextArea = document.getElementById("aiAssistInput");
      if (recipeTextArea && recipeTextArea.value.trim()) {
        it.recipeDescription = recipeTextArea.value.trim();
        console.log(
          "Saved recipe description:",
          it.recipeDescription.substring(0, 100) + "...",
        );
      }
      // Also verify the parsed data includes appeal state
      try {
        const parsed = JSON.parse(it.aiIngredients);
        const appealInSaved = parsed.filter(
          (r) => r.userOverriddenScan === true,
        );
        console.log(
          "APPLY: Verified appeal state in saved data:",
          appealInSaved.length,
          "rows with userOverriddenScan=true",
        );
      } catch (e) {
        console.error("APPLY: Failed to parse saved aiIngredients:", e);
      }
      const allergenDetailsMap = {};
      const activeAllergens = new Set();
      const activeCrossContamination = new Set(); // Track cross-contamination allergens
      const activeCrossContaminationDiets = new Set(); // Track cross-contamination diets
      const aggregatedIngredientNames = [];

      // Track which ingredients contain each allergen, and whether each is removable
      // An allergen is only "removable" if ALL ingredients containing it are removable
      const allergenIngredientInfo = {}; // { allergen: { ingredients: [...], allRemovable: true/false } }

      // For dietary preferences, start with all possible diets, then remove any that aren't supported by ALL ingredients
      // A dish is only vegan if ALL ingredients are vegan, etc.
      const allDietOptions = Array.isArray(DIETS) ? DIETS.slice() : [];
      let activeDiets = new Set(allDietOptions);

      const dietBlockingInfo = {};
      allDietOptions.forEach((diet) => {
        dietBlockingInfo[diet] = [];
      });

      rows.forEach((row) => {
        const allergens = Array.isArray(row.allergens) ? row.allergens : [];
        const crossContamination = Array.isArray(row.crossContamination)
          ? row.crossContamination
          : [];
        const diets = Array.isArray(row.diets) ? row.diets : [];
        const crossContaminationDiets = Array.isArray(row.crossContaminationDiets)
          ? row.crossContaminationDiets
          : [];
        const name = (row.name || "").trim();
        const brand = (row.brand || "").trim();
        const isRemovable = row.removable === true;
        console.log(
          `Processing row: name = "${name}", allergens = `,
          allergens,
          `crossContamination = `,
          crossContamination,
          `diets = `,
          diets,
          `crossContaminationDiets = `,
          crossContaminationDiets,
          `removable = ${row.removable}, isRemovable = ${isRemovable} `,
        );
        // Collect cross-contamination allergens
        crossContamination.forEach((al) => {
          if (al !== undefined && al !== null && al !== "") {
            activeCrossContamination.add(al);
          }
        });
        // Collect cross-contamination diets
        crossContaminationDiets.forEach((d) => {
          if (d) activeCrossContaminationDiets.add(d);
        });
        if (Array.isArray(row.ingredientsList) && row.ingredientsList.length) {
          aggregatedIngredientNames.push(...row.ingredientsList);
        } else if (name) {
          aggregatedIngredientNames.push(
            brand ? `${cap(name)} (${brand})` : cap(name),
          );
        }
        const label = name ? cap(name) : "";
        const labelWithBrand = brand
          ? label
            ? `${label} (${brand})`
            : brand
          : label;
        allergens.forEach((al) => {
          const key = al;
          if (key === undefined || key === null || key === "") return;
          activeAllergens.add(key);
          if (labelWithBrand) {
            if (!allergenDetailsMap[key]) allergenDetailsMap[key] = [];
            if (!allergenDetailsMap[key].includes(labelWithBrand)) {
              allergenDetailsMap[key].push(labelWithBrand);
            }
          }
          // Track ingredient info for this allergen to determine if ALL are removable
          if (!allergenIngredientInfo[key]) {
            allergenIngredientInfo[key] = {
              ingredients: [],
              allRemovable: true,
            };
          }
          allergenIngredientInfo[key].ingredients.push(
            labelWithBrand || name || "Ingredient",
          );
          // If ANY ingredient with this allergen is NOT removable, the allergen is not removable
          if (!isRemovable) {
            allergenIngredientInfo[key].allRemovable = false;
          }
        });

        // Remove any diets that this ingredient doesn't support
        // This way, only diets supported by ALL ingredients remain
        // Include crossContaminationDiets since those are still supported, just with cross-contamination risk
        const ingredientDietSet = new Set([
          ...diets,
          ...crossContaminationDiets,
        ]);
        allDietOptions.forEach((diet) => {
          if (!ingredientDietSet.has(diet)) {
            dietBlockingInfo[diet].push({
              name: labelWithBrand || label || brand || name || "Ingredient",
              removable: isRemovable === true,
            });
          }
        });
        activeDiets.forEach((diet) => {
          if (!ingredientDietSet.has(diet)) {
            activeDiets.delete(diet);
          }
        });
      });

      // Ignore the AI's overall dish analysis dietary options - we only trust per-ingredient analysis
      // If the AI said "this dish is vegan" but an ingredient isn't marked vegan, the dish isn't vegan

      if (list) {
        const uniqueAggregated = [
          ...new Set(
            aggregatedIngredientNames
              .map((item) => (item || "").trim())
              .filter(Boolean),
          ),
        ];
        list.dataset.aiIngredientSummary = JSON.stringify(uniqueAggregated);
      }
      // Also save ingredient summary to overlay object
      const uniqueAggregated = [
        ...new Set(
          aggregatedIngredientNames
            .map((item) => (item || "").trim())
            .filter(Boolean),
        ),
      ];
      it.aiIngredientSummary = JSON.stringify(uniqueAggregated);

      list.querySelectorAll(".algRow").forEach((row) => {
        const btn = row.querySelector(".algBtn");
        const allergen = btn.dataset.a;
        const key = normalizeAllergen(allergen);
        const input = row.querySelector(".algInput");
        const labels = row.querySelectorAll(".algChk");
        const remLabel = labels[0];
        const crossLabel = labels[1];
        const remChk = remLabel ? remLabel.querySelector("input") : null;
        const crossChk = crossLabel ? crossLabel.querySelector("input") : null;
        const isActive = activeAllergens.has(key);
        btn.classList.toggle("active", isActive);
        if (input) {
          if (isActive) {
            const explanations = allergenDetailsMap[key] || [];
            input.value = explanations.length
              ? `Contains ${explanations.join(", ")} `
              : "";
          } else {
            input.value = "";
          }
          input.style.display = isActive ? "block" : "none";
        }
        if (remLabel) {
          remLabel.style.display = isActive ? "flex" : "none";
          if (isActive && remChk) {
            // Check the removable checkbox if this allergen is marked as removable (ALL ingredients with it are removable)
            const allergenInfo = allergenIngredientInfo[key];
            remChk.checked = allergenInfo && allergenInfo.allRemovable;
          } else if (!isActive && remChk) {
            remChk.checked = false;
          }
        }
        if (crossLabel) {
          crossLabel.style.display = "flex";
        }
      });
      // Apply dietary preferences
      list.querySelectorAll(".algRow").forEach((row) => {
        const btn = row.querySelector(".algBtn.dietBtn");
        if (btn) {
          const diet = btn.dataset.diet;
          const isActive = activeDiets.has(diet);
          btn.classList.toggle("active", isActive);
        }
      });

      // Note: Dish-level allergen/diet/cross-contamination changes are tracked at the ingredient level
      // in describeOverlayChanges, not here, to avoid duplicate logging.

      // Update the overlay object with the new allergen data
      it.allergens = Array.from(activeAllergens);
      it.diets = Array.from(activeDiets);
      it.details = {};
      Object.keys(allergenDetailsMap).forEach((key) => {
        const explanations = allergenDetailsMap[key] || [];
        if (explanations.length) {
          it.details[key] = `Contains ${explanations.join(", ")} `;
        }
      });
      // Add ingredient summary to details
      if (uniqueAggregated && uniqueAggregated.length) {
        it.details.__ingredientsSummary = uniqueAggregated.join(", ");
      }

      // Store cross-contamination data from AI Assistant
      console.log(
        `=== applyIngredientsFromAi: Processing crossContamination for "${it.id}" === `,
      );
      console.log("  Current it.crossContamination:", it.crossContamination);
      console.log(
        "  extraData.crossContamination:",
        extraData?.crossContamination,
      );
      console.log(
        "  activeCrossContamination from rows:",
        Array.from(activeCrossContamination),
      );

      // Collect cross-contamination from extraData OR from rows directly
      if (
        extraData &&
        extraData.crossContamination &&
        extraData.crossContamination.allergens &&
        extraData.crossContamination.allergens.length > 0
      ) {
        it.crossContamination = extraData.crossContamination.allergens;
        it.noCrossContamination = false;
        console.log(
          "  -> Set crossContamination from extraData:",
          it.crossContamination,
        );
      } else if (activeCrossContamination.size > 0) {
        // Use cross-contamination collected directly from rows
        it.crossContamination = Array.from(activeCrossContamination);
        it.noCrossContamination = false;
        console.log(
          "  -> Set crossContamination from rows:",
          it.crossContamination,
        );
      } else {
        it.crossContamination = [];
        it.noCrossContamination = true;
        console.log(
          "  -> No cross-contamination, set noCrossContamination=true",
        );
      }
      console.log("  Final it.crossContamination:", it.crossContamination);

      // Store diet cross-contamination (diets with cross-contamination risk)
      if (activeCrossContaminationDiets.size > 0) {
        it.crossContaminationDiets = Array.from(activeCrossContaminationDiets);
        console.log(
          "  -> Set crossContaminationDiets:",
          it.crossContaminationDiets,
        );
      } else {
        it.crossContaminationDiets = [];
      }

      // Note: Dish-level cross-contamination and allergen/diet changes are NOT logged here.
      // All allergen/diet changes are tracked at the ingredient level in aiIngredients.

      // Update the overlay name from the AI Assistant name input only if user explicitly changed it
      const aiNameInput = document.getElementById("aiAssistNameInput");
      const manualNameInput = document.getElementById("itemName");
      const currentName = it.id || "Item";
      const inputValue = aiNameInput?.value?.trim() || "";

      // Only treat the input as a rename if it differs from the current dish name
      // This prevents stale input values from accidentally renaming dishes
      const newName =
        inputValue && inputValue !== currentName ? inputValue : currentName;

      if (newName !== it.id) {
        const oldName = it.id;
        it.id = newName;
        pendingChanges.push(`Renamed "${oldName}" to "${newName}"`);
        // Also update the manual editor input if it exists
        if (manualNameInput) {
          manualNameInput.value = newName;
        }
      }

      // Update removable ingredients - only if ALL ingredients with that allergen are removable
      console.log("allergenIngredientInfo:", allergenIngredientInfo);
      it.removable = [];
      Object.entries(allergenIngredientInfo).forEach(([allergen, info]) => {
        if (info.allRemovable && info.ingredients.length > 0) {
          const detail = it.details[allergen] || allergen;
          it.removable.push({ allergen, component: detail });
          console.log(
            `  -> Allergen "${allergen}" is removable (all ${info.ingredients.length} ingredients are removable)`,
          );
        } else {
          console.log(
            `  -> Allergen "${allergen}" is NOT removable (${info.ingredients.length} ingredients, allRemovable=${info.allRemovable})`,
          );
        }
      });
      console.log("Set removable for", it.id, ":", it.removable);
      const cleanedBlockingInfo = {};
      Object.keys(dietBlockingInfo).forEach((diet) => {
        if (dietBlockingInfo[diet].length) {
          cleanedBlockingInfo[diet] = dietBlockingInfo[diet];
        }
      });
      if (Object.keys(cleanedBlockingInfo).length) {
        it.ingredientsBlockingDiets = cleanedBlockingInfo;
      } else {
        delete it.ingredientsBlockingDiets;
      }

      updatePreview();
      setDirty(true);
      pushHistory();
      aiAssistSetStatus(
        "Ingredient details applied and saved to dish!",
        "success",
      );
    }

    // Auto-open AI assistant immediately
    // For new items (no allergens): show input screen (photo/upload/describe)
    // For existing items with data: show ingredient editing table

    // Use saved recipe description if available, otherwise fall back to allergen details
    const seedText =
      it.recipeDescription || Object.values(it.details || {}).join("\n");
    const isNewItem = !it.allergens || it.allergens.length === 0;

    // If there's existing AI ingredients data, parse and pass it to the assistant
    let existingIngredientRows = null;
    console.log(
      "Opening editor for:",
      it.id,
      "isNewItem:",
      isNewItem,
      "allergens:",
      it.allergens,
      "details:",
      it.details,
    );

    if (it.aiIngredients && typeof it.aiIngredients === "string") {
      try {
        existingIngredientRows = JSON.parse(it.aiIngredients);
        console.log("Found saved AI ingredients:", existingIngredientRows);
        existingIngredientRows.forEach((row, idx) => {
          const hasAppeal =
            row.userOverriddenScan === true || row.needsScan === false;
          console.log(
            `  Row ${idx}: name = "${row.name}", removable = ${row.removable}, needsScan = ${row.needsScan}, userOverriddenScan = ${row.userOverriddenScan}, allergens = `,
            row.allergens,
          );
          if (hasAppeal) {
            console.log(`  ✅ Row ${idx} ("${row.name}") has APPEAL STATE: `, {
              needsScan: row.needsScan,
              userOverriddenScan: row.userOverriddenScan,
              confirmed: row.confirmed,
            });
          }
        });
      } catch (e) {
        console.warn("Failed to parse existing AI ingredients:", e);
      }
    } else if (!isNewItem) {
      // Convert existing allergen data into ingredient rows for editing
      // This handles dishes created before the AI ingredient system
      existingIngredientRows = [];
      console.log(
        "Converting legacy allergen data to ingredients, allergens:",
        it.allergens,
        "details:",
        it.details,
      );

      // If we have details with allergen descriptions, use those
      if (it.details && Object.keys(it.details).length > 0) {
        Object.keys(it.details).forEach((allergen) => {
          if (allergen.startsWith("__")) return; // Skip special fields like __ingredientsSummary
          const detail = it.details[allergen];
          if (detail) {
            // Create an ingredient row from the allergen detail
            existingIngredientRows.push({
              name: detail,
              brand: "",
              allergens: [allergen],
              diets: it.diets || [],
              removable: (it.removable || []).some(
                (r) => r.allergen === allergen,
              ),
              confirmed: false,
            });
          }
        });
      } else if (it.allergens && it.allergens.length > 0) {
        // No details, but we have allergens - create generic ingredient rows
        it.allergens.forEach((allergen) => {
          existingIngredientRows.push({
            name: `Ingredient with ${allergen} `,
            brand: "",
            allergens: [allergen],
            diets: it.diets || [],
            removable: (it.removable || []).some(
              (r) => r.allergen === allergen,
            ),
            confirmed: false,
          });
        });
      }

      console.log("Converted to ingredient rows:", existingIngredientRows);
    }

    console.log("Final existingIngredientRows:", existingIngredientRows);

    // Open AI assistant immediately - store dish name in closure to avoid stale references
    const currentDishId = it.id || "";
    console.log(
      "openItemEditor: About to open AI Assistant for dish:",
      currentDishId,
    );

    openDishEditor({
      seedText,
      getCurrentName: () => {
        // IMPORTANT: Return the dish ID that was captured in the closure when this editor was opened
        // This prevents stale data from other dishes
        console.log("getCurrentName called, returning:", currentDishId);
        return currentDishId;
      },
      onApply: (rows, extraData) => applyIngredientsFromAi(rows, extraData),
      existingIngredients: existingIngredientRows,
      crossContamination: it.crossContamination || [],
      noCrossContamination: it.noCrossContamination || false,
      onDelete: () => {
        // Delete the overlay
        pendingChanges.push(`${it.id || "Item"}: Removed overlay`);
        overlays.splice(idx, 1);
        if (mb) mb.style.display = "none";
        drawAll();
        setDirty(true);
        pushHistory();
      },
    });

    document.getElementById("doneBtn").onclick = () => {
      const oldName = it.id;
      const oldAllergens = new Set(it.allergens || []);

      const final = {
        allergens: [],
        removable: [],
        crossContamination: [],
        diets: [],
        details: {},
      };
      console.log("=== DONE BUTTON: Starting to collect dish data ===");
      list.querySelectorAll(".algRow").forEach((row) => {
        const btn = row.querySelector(".algBtn");
        const a = btn.dataset.a;
        const diet = btn.dataset.diet;
        const on = btn.classList.contains("active");

        if (diet) {
          // This is a diet button
          if (on) final.diets.push(diet);
        } else if (a) {
          // This is an allergen button
          const txt = row.querySelector(".algInput")?.value.trim() || "";
          const checkboxes = row.querySelectorAll('input[type="checkbox"]');
          console.log(`  Allergen ${a}: found ${checkboxes.length} checkboxes`);
          const isRem = checkboxes[0]?.checked;
          const isCross = checkboxes[1]?.checked;
          console.log(`    - isRem(checkbox[0]): ${isRem} `);
          console.log(`    - isCross(checkbox[1]): ${isCross} `);
          if (on) {
            final.allergens.push(a);
            if (txt) final.details[a] = txt;
            if (isRem)
              final.removable.push({ allergen: a, component: txt || a });
          }
          if (isCross) {
            console.log(`    -> Adding ${a} to crossContamination array`);
            final.crossContamination.push(a);
          }
        }
      });
      console.log(
        "=== DONE BUTTON: Final crossContamination array ===",
        final.crossContamination,
      );
      if (list && list.dataset.aiIngredientSummary) {
        try {
          const rawSummary = JSON.parse(list.dataset.aiIngredientSummary) || [];
          const summary = [
            ...new Set(
              rawSummary.map((item) => (item || "").trim()).filter(Boolean),
            ),
          ];
          if (summary.length) {
            final.details.__ingredientsSummary = summary.join(", ");
          } else {
            delete final.details.__ingredientsSummary;
          }
        } catch (_) {
          delete final.details.__ingredientsSummary;
        }
      }
      const newName =
        document.getElementById("itemName").value || it.id || "Item";

      // Track rename
      if (oldName !== newName) {
        pendingChanges.push(`Renamed "${oldName}" to "${newName}"`);
      }

      // Track allergen changes
      const newAllergens = new Set(final.allergens);
      const added = [...newAllergens].filter((a) => !oldAllergens.has(a));
      const removed = [...oldAllergens].filter((a) => !newAllergens.has(a));
      if (added.length) {
        const allergenWord = added.length === 1 ? "allergen" : "allergens";
        pendingChanges.push(
          `${newName}: Added ${allergenWord} ${added.join(", ")} `,
        );
      }
      if (removed.length) {
        const allergenWord = removed.length === 1 ? "allergen" : "allergens";
        pendingChanges.push(
          `${newName}: Removed ${allergenWord} ${removed.join(", ")} `,
        );
      }

      final.allergens = Array.isArray(final.allergens) ? final.allergens : [];
      final.diets = Array.isArray(final.diets) ? final.diets : [];

      it.id = newName;
      it.allergens = final.allergens;
      it.details = final.details;
      it.removable = final.removable;
      it.crossContamination = final.crossContamination;
      it.diets = final.diets;
      console.log(
        `=== DONE BUTTON: Set it.crossContamination for "${newName}" === `,
        it.crossContamination,
      );
      // Save AI ingredients data for future editing
      if (list) {
        it.aiIngredients = list.dataset.aiIngredients || "";
        it.aiIngredientSummary = list.dataset.aiIngredientSummary || "";
      }
      mb.style.display = "none";
      drawAll();
      setDirty(true);
      pushHistory();
    };
    const deleteWarning = document.getElementById("editorDeleteWarning");
    const confirmDeleteBtn = document.getElementById("editorConfirmDeleteBtn");
    const cancelDeleteBtn = document.getElementById("editorCancelDeleteBtn");

    document.getElementById("delBtn").onclick = () => {
      // Show inline delete warning instead of browser confirm
      if (deleteWarning) {
        deleteWarning.style.display = "block";
        deleteWarning.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };

    // Set up confirm delete handler
    if (confirmDeleteBtn) {
      confirmDeleteBtn.onclick = () => {
        if (deleteWarning) deleteWarning.style.display = "none";
        pendingChanges.push(`${it.id || "Item"}: Removed overlay`);
        overlays.splice(idx, 1);
        mb.style.display = "none";
        drawAll();
        setDirty(true);
        pushHistory();
      };
    }

    // Set up cancel delete handler
    if (cancelDeleteBtn) {
      cancelDeleteBtn.onclick = () => {
        if (deleteWarning) deleteWarning.style.display = "none";
      };
    }
    // Don't show the modal - AI assistant opens instead
    // mb.style.display='flex';
  }

  // Make openItemEditor globally accessible for auto-fill
  window.openItemEditor = openItemEditor;
}

/* report */
function renderReport() {
  renderTopbar();
  const root = document.getElementById("root");
  root.innerHTML = `< h1 > Report an issue</h1 >
<div style="max-width:640px">
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0">
    <input id="rName" type="text" placeholder="Your name" style="flex:1">
    <input id="rEmail" type="email" placeholder="Email (required)" style="flex:1">
  </div>
  <textarea id="rMsg" rows="6" style="width:100%;border-radius:16px" placeholder="Describe the issue"></textarea>
  <div class="mgrRow" style="justify-content:flex-start"><button class="btn btnPrimary" id="rSend">Send</button></div>
  <div class="note">We require an email so we can follow up if needed.</div>
</div>`;
  document.getElementById("rSend").onclick = () => {
    const name = (document.getElementById("rName").value || "").trim();
    const email = (document.getElementById("rEmail").value || "").trim();
    const message = (document.getElementById("rMsg").value || "").trim();
    if (!email) {
      alert("Please enter your email.");
      return;
    }
    send({ type: "sendReport", name, email, message });
  };
}

function updateRootOffset() {
  const root = document.getElementById("root");
  const topbar = document.getElementById("topbarOuter");
  if (!root || !topbar) return;
  if (!document.body.classList.contains("menuScrollLocked")) return;
  const topbarBottom = Math.round(topbar.getBoundingClientRect().bottom);
  root.style.cssText = `position:fixed;top:${topbarBottom}px;left:0;right:0;bottom:0;display:flex;flex-direction:column;overflow:hidden;padding:${rootOffsetPadding};box-sizing:border-box;`;
}

function setRootOffsetPadding(padding) {
  rootOffsetPadding = padding;
  updateRootOffset();
}

/* router */
function setMenuScrollLock(locked) {
  const htmlEl = document.documentElement;
  if (locked) {
    document.body.classList.add("menuScrollLocked");
    htmlEl.classList.add("menuScrollLocked");
    return;
  }
  document.body.classList.remove("menuScrollLocked");
  htmlEl.classList.remove("menuScrollLocked");
  const root = document.getElementById("root");
  if (root) {
    root.style.cssText = "";
  }
}

function render() {
  setMenuScrollLock(state.page === "restaurant" || state.page === "editor");
  document.body.classList.toggle("editorView", state.page === "editor");
  setOrderSidebarVisibility();
  let result;
  switch (state.page) {
    case "restaurants":
      result = renderCardsPage();
      break;
    case "editor":
      result = renderEditor();
      break;
    case "report":
      result = renderReport();
      break;
    case "restaurant":
      result = renderRestaurant();
      break;
    default:
      result = undefined;
      break;
  }
  hidePageLoader();
  return result;
}

const unsavedChangesGuard = initUnsavedChangesGuard({
  collectAiTableData,
  getAiAssistBackdrop,
  getAiAssistState: () => aiAssistState,
  getNameInput: () => document.getElementById("aiAssistNameInput"),
  getEditorDirty: () => window.editorDirty,
  onClearDirty: () => {
    window.editorDirty = false;
    if (aiAssistState) aiAssistState.savedToDish = true;
  },
});
hasUnsavedChanges = unsavedChangesGuard.hasUnsavedChanges;
showUnsavedChangesModal = unsavedChangesGuard.showUnsavedChangesModal;
navigateWithCheck = unsavedChangesGuard.navigateWithCheck;

/* hydrate */
function handleRestaurantMessage(message) {
  const m = message || {};
  if (!state._hydrated) {
    state._hydrated = true;
    document.body.style.display = "";
  }

  if (m.user) {
    state.user = m.user;
    applyDefaultUserName();
    if (state.user?.loggedIn) {
      initDinerNotifications({ user: state.user, client: window.supabaseClient });
    }
  }
  if (Object.prototype.hasOwnProperty.call(m, "isHowItWorks")) {
    state.isHowItWorks = !!m.isHowItWorks;
  }
  if (state.user?.loggedIn) {
    closeQrPromo("login");
    if (typeof hideQrBanner === "function") {
      hideQrBanner();
    }
  }
  if (m.allergies) {
    state.allergies = (m.allergies || [])
      .map(normalizeAllergen)
      .filter(Boolean);
    rerenderOrderConfirmDetails();
  }
  if (m.diets) {
    state.diets = (m.diets || []).map(normalizeDietLabel).filter(Boolean);
    rerenderOrderConfirmDetails();
  }
  if (m.restaurant) {
    const newRestaurant = normalizeRestaurant(m.restaurant);
    const newRestaurantId = newRestaurant?._id || newRestaurant?.id || null;
    const oldRestaurantId =
      state.restaurant?._id || state.restaurant?.id || null;

    // If restaurant changed, filter out orders from the old restaurant
    if (
      newRestaurantId &&
      oldRestaurantId &&
      newRestaurantId !== oldRestaurantId
    ) {
      orderFlow.tabletSimState.orders = orderFlow.tabletSimState.orders.filter((o) => {
        if (!o.restaurantId) return false;
        return o.restaurantId === newRestaurantId;
      });
      // Clear current order if it's from a different restaurant
      if (orderFlow.tabletSimOrderId) {
        const currentOrder = orderFlow.tabletSimState.orders.find(
          (o) => o.id === orderFlow.tabletSimOrderId,
        );
        if (
          !currentOrder ||
          (currentOrder.restaurantId &&
            currentOrder.restaurantId !== newRestaurantId)
        ) {
          orderFlow.tabletSimOrderId = null;
          stopOrderRefresh();
        }
      }
      persistTabletStateSnapshot();
      // Clear sidebar
      renderOrderSidebarStatus(null);
    }

    state.restaurant = newRestaurant;
    if (newRestaurantId) {
      // If restaurant changed, clear old items and restore new ones
      if (oldRestaurantId && newRestaurantId !== oldRestaurantId) {
        window.orderItems = [];
        clearOrderItemSelections();
      }
      // Restore order items for this restaurant
      const restored = restoreOrderItems();
      if (!restored) {
        window.orderItems = [];
        clearOrderItemSelections();
      }
      persistOrderItems();
      updateOrderSidebar();
      // Open sidebar if there are items
      if (window.orderItems && window.orderItems.length > 0) {
        // Visually restore selected dishes in the menu
        const waitForMenu = () => {
          const menu = document.getElementById("menu");
          if (menu && menu.querySelectorAll(".overlay").length > 0) {
            window.orderItems.forEach((dishName) => {
              const overlays = document.querySelectorAll(".overlay");
              overlays.forEach((overlay) => {
                const titleEl = overlay.querySelector(".tTitle");
                if (titleEl) {
                  const title = titleEl.textContent.trim();
                  if (
                    title.toLowerCase() === dishName.toLowerCase() ||
                    title === dishName
                  ) {
                    overlay.classList.add("selected");
                    if (typeof window.setOverlayPulseColor === "function") {
                      window.setOverlayPulseColor(overlay);
                    }
                    const addBtn = overlay.querySelector(
                      `.addToOrderBtn[data-dish-name]`,
                    );
                    if (addBtn) {
                      addBtn.disabled = true;
                      addBtn.textContent = "Added";
                    }
                  }
                }
              });
            });
            updateOrderSidebar();
            openOrderSidebar();
          } else {
            setTimeout(waitForMenu, 100);
          }
        };
        setTimeout(waitForMenu, 500);
      }
    }
    rebuildBrandMemoryFromRestaurant();
  }
  if (m.restaurants) {
    // Check if user is admin or manager
    const isAdmin = state.user?.email === "matt.29.ds@gmail.com";
    const isManager = state.user?.role === "manager";

    // Filter out restaurants that haven't confirmed in 30+ days (unless admin or manager)
    if (!isAdmin && !isManager) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      state.restaurants = (m.restaurants || []).filter((rs) => {
        if (!rs.lastConfirmed) return false; // Hide restaurants that have never confirmed
        const lastConfirmed = new Date(rs.lastConfirmed);
        return lastConfirmed >= thirtyDaysAgo;
      });
    } else {
      state.restaurants = m.restaurants || [];
    }
  }
  if (typeof m.canEdit === "boolean") {
    state.canEdit = m.canEdit;
  }
  if (typeof m.qr === "boolean") {
    state.qr = m.qr;
  } else if (urlQR) {
    state.qr = true;
  }

  // Set page - URL parameter for editor mode takes precedence
  if (m.page) {
    state.page = m.page;
  }
  // Auto-activate editor mode if URL parameter is present and user has edit permission
  // This overrides any incoming page message
  if (window.__startInEditor && state.canEdit) {
    console.log(
      "Activating editor mode from URL parameter, canEdit:",
      state.canEdit,
    );
    state.page = "editor";
  } else if (window.__startInEditor) {
    console.log("Editor mode requested but canEdit is:", state.canEdit);
  }
  if (m.aiAssistEndpoint) {
    state.aiAssistEndpoint = m.aiAssistEndpoint;
  }
  if ((state.qr || urlQR) && (!state.allergies || !state.allergies.length)) {
    try {
      const s = sessionStorage.getItem("qrAllergies");
      if (s)
        state.allergies = (JSON.parse(s) || [])
          .map(normalizeAllergen)
          .filter(Boolean);
    } catch (_) {}
  }
  if ((state.qr || urlQR) && (!state.diets || !state.diets.length)) {
    try {
      const s = sessionStorage.getItem("qrDiets");
      if (s)
        state.diets = (JSON.parse(s) || [])
          .map(normalizeDietLabel)
          .filter(Boolean);
    } catch (_) {}
  }
  // Only reset ack if not coming from dish search (which has dishName parameter) or if ack parameter is set
  const urlParamsForAck = new URLSearchParams(window.location.search);
  const dishNameFromUrl = urlParamsForAck.get("dishName");
  const ackParamFromUrl = urlParamsForAck.get("ack");
  if (
    (m.page === "restaurant" || m.restaurant) &&
    !dishNameFromUrl &&
    ackParamFromUrl !== "1"
  ) {
    state.ack = false;
  }
  if (m.type === "allergiesSaved") {
    state.allergies = (m.allergies || [])
      .map(normalizeAllergen)
      .filter(Boolean);
    rerenderOrderConfirmDetails();
  }
  if (m.type === "aiAssistResult") {
    handleDishEditorResult(m);
    return;
  }
  if (m.type === "aiAssistError") {
    handleDishEditorError(m);
    return;
  }

  if (m.type === "overlaysSaved") {
    window.__editorOriginalMenuImages = null;
    window.__editorOverridePendingChanges = null;
    window.__editorOverrideCurrentPage = null;
    window.__editorAutoOpenMenuUpload = false;
    try {
      if (editorSaveApi && typeof editorSaveApi.setSaveState === "function") {
        editorSaveApi.setSaveState("saved");
      }
    } catch (_) {}
    if (
      window.__saveReviewControl &&
      typeof window.__saveReviewControl.isOpen === "function" &&
      window.__saveReviewControl.isOpen()
    ) {
      window.__saveReviewControl.close();
    }
    if (m.restaurant) {
      const normalized = normalizeRestaurant(m.restaurant);
      if (normalized) {
        // Log aiIngredients preservation status
        console.log(
          "overlaysSaved: Checking aiIngredients preservation:",
          normalized.overlays?.map((o) => ({
            id: o.id,
            hasAiIngredients: !!o.aiIngredients,
            aiIngredientsType: typeof o.aiIngredients,
          })),
        );
        state.restaurant = normalized;
      } else {
        state.restaurant = state.restaurant;
      }
      rebuildBrandMemoryFromRestaurant();
      if (state.restaurant && state.page !== "editor") {
        setTimeout(() => checkForActiveOrders(), 500);
      }
    }
    // Re-render overlays to update colors based on new data
    if (window.__rerenderLayer__) window.__rerenderLayer__();
  }
  if (m.type === "saveFailed") {
    try {
      if (editorSaveApi && typeof editorSaveApi.setSaveState === "function") {
        editorSaveApi.setSaveState("error");
      }
      const hasSaveReview =
        window.__saveReviewControl &&
        typeof window.__saveReviewControl.isOpen === "function" &&
        window.__saveReviewControl.isOpen();
      if (
        window.__saveReviewControl &&
        typeof window.__saveReviewControl.setError === "function"
      ) {
        window.__saveReviewControl.setError(
          "Save failed. Please review and try again.",
        );
      }
      // Log the error details
      console.error("Save failed message received:", m.message, m.error);
      console.error("Full error object:", JSON.stringify(m.error, null, 2));

      // Show user-friendly error with more details
      let errorMsg = m.message || "Unknown error occurred";
      if (m.error) {
        if (m.error.code) errorMsg += `\nError code: ${m.error.code}`;
        if (m.error.hint) errorMsg += `\nHint: ${m.error.hint}`;
        if (m.error.details)
          errorMsg += `\nDetails: ${JSON.stringify(m.error.details)}`;
      }
      if (!hasSaveReview) {
        alert(
          `❌ Failed to save changes!\n\n${errorMsg}\n\nPlease check the browser console (F12) for full error details.`,
        );
      }
    } catch (_) {}
  }
  if (m.type === "confirmationSaved") {
    if (m.timestamp && state.restaurant)
      state.restaurant.lastConfirmed = m.timestamp;
    if (m.restaurant) {
      state.restaurant = normalizeRestaurant(m.restaurant) || state.restaurant;
      rebuildBrandMemoryFromRestaurant();
    }
    try {
      updateLastConfirmedText();
    } catch (_) {}
  }
  if (m.type === "confirmationFailed") {
    alert("Could not confirm allergen information. " + (m.message || ""));
  }
  if (m.type === "changeLog") {
    try {
      if (window.displayChangeLog)
        window.displayChangeLog(m.logs || [], m.error);
    } catch (_) {}
    return;
  }

  renderTopbar();
  render();
  maybeInitHowItWorksTour();
  updateFullScreenAllergySummary();

  // Auto-open change log modal if requested via URL parameter
  if (window.__openLogOnLoad && state.page === "editor") {
    setTimeout(() => {
      if (typeof openChangeLog === "function") {
        openChangeLog();
        window.__openLogOnLoad = false; // Reset to avoid re-opening
      }
    }, 100);
  }

  if (window.__openConfirmOnLoad && state.page === "editor") {
    setTimeout(() => {
      if (typeof window.openBrandVerification === "function") {
        window.openBrandVerification();
        window.__openConfirmOnLoad = false;
      }
    }, 120);
  }
}

window.addEventListener("message", (ev) => {
  handleRestaurantMessage(ev.data || {});
});

if (window.__restaurantBootPayload && !window.__restaurantBootPayloadConsumed) {
  window.__restaurantBootPayloadConsumed = true;
  handleRestaurantMessage(window.__restaurantBootPayload);
}

initAutoOpenDish({ state });
initOrderConfirmRestore({
  initOrderSidebar,
  getOrderFormStateStorageKey,
  checkUserAuth,
  restoreOrderFormState,
  updateOrderConfirmAuthState,
  rerenderOrderConfirmDetails,
});
