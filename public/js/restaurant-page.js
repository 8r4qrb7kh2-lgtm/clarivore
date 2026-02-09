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
import { mountEditorShell } from "./restaurant/editor-shell-markup.js";
import { initOrderConfirmRestore } from "./restaurant/order-confirm-restore.js";
import { initMobileOverlayZoom } from "./restaurant/mobile-overlay-zoom.js";
import {
  applyRestaurantShellState,
  mountRestaurantShell,
} from "./restaurant/restaurant-shell-markup.js";
import { mountReportShell } from "./restaurant/report-shell-markup.js";
import {
  bindRestaurantActionButtons,
  bindSavedPreferenceButtons,
  initGuestFilterControls,
  showRestaurantMenuSurface,
} from "./restaurant/restaurant-view.js";
import { bindEditorBackButton } from "./restaurant/editor-exit.js";
import { bindDetectDishesButton } from "./restaurant/editor-dish-detection.js";
import { bindEditorToolbarScale } from "./restaurant/editor-toolbar.js";
import { bindEditorHistoryControls } from "./restaurant/editor-history-controls.js";
import { openPendingDishInEditor } from "./restaurant/editor-pending-dish.js";
import { createEditorItemEditor } from "./restaurant/editor-item-editor.js";
import { createEditorLastConfirmedUpdater } from "./restaurant/editor-last-confirmed.js";
import { bindEditorRuntimeBindings } from "./restaurant/editor-runtime-bindings.js";
import { createEditorRenderer } from "./restaurant/editor-screen.js";
import {
  initializeEditorAssets,
  createDirtyController,
  createEditorChangeState,
  applyPendingMenuIndexRemap,
} from "./restaurant/editor-session.js";
import { createRestaurantMessageHandler } from "./restaurant/restaurant-message.js";
import { initRestaurantFilters } from "./restaurant/restaurant-filters.js";
import { initRestaurantTopbar } from "./restaurant/restaurant-topbar.js";
import { renderRestaurantCardsPage } from "./restaurant/restaurant-cards-page.js";
import { renderRestaurantScreen } from "./restaurant/restaurant-screen.js";
import {
  createQrPromoController,
  deriveQrVisitFlag,
} from "./restaurant/qr-promo.js";
import { renderRestaurantReportPage } from "./restaurant/restaurant-report-page.js";
import { setupMenuPinchZoom } from "./restaurant/menu-pinch-zoom.js";
import { createDishInteractionTracker } from "./restaurant/menu-dish-tracking.js";
import { createMenuOverlayRuntime } from "./restaurant/menu-overlays.js";
import { bindMenuOverlayListeners } from "./restaurant/menu-overlay-listeners.js";
import { initializeMenuLayout } from "./restaurant/menu-layout.js";

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
let updateLastConfirmedText = () => {};
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

const urlQR = deriveQrVisitFlag();

function isDishInfoPopupOpen() {
  // Check if mobile info panel is showing
  const mobilePanel = document.getElementById("mobileInfoPanel");
  if (mobilePanel && mobilePanel.classList.contains("show")) return true;
  // Check if desktop tooltip is pinned open (tipPinned is declared later, check via window or direct)
  if (typeof tipPinned !== "undefined" && tipPinned) return true;
  return false;
}
const {
  shouldShowQrPromo,
  cancelQrPromoTimer,
  queueQrPromoTimer,
  closeQrPromo,
} = createQrPromoController({
  state,
  isDishInfoPopupOpen,
});

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

const { renderTopbar } = initRestaurantTopbar({
  state,
  urlQR,
  slug,
  setupTopbar,
  hasUnsavedChanges: () => hasUnsavedChanges(),
  showUnsavedChangesModal: (onProceed) => showUnsavedChangesModal(onProceed),
  clearEditorDirty: () => {
    window.editorDirty = false;
    if (aiAssistState) aiAssistState.savedToDish = true;
  },
  updateRootOffset,
});

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
const renderCardsPage = () =>
  renderRestaurantCardsPage({
    state,
    renderTopbar,
    root: document.getElementById("root"),
    div,
    esc,
    send,
    getWeeksAgoInfo,
  });

/* chips */
const {
  renderSavedChips,
  renderSavedDiets,
  renderSelectedChips,
  renderSelectedDiets,
  renderSelector,
  renderDietSelector,
} = initRestaurantFilters({
  state,
  normalizeAllergen,
  normalizeDietLabel,
  formatAllergenLabel,
  ALLERGENS,
  DIETS,
  ALLERGEN_EMOJI,
  DIET_EMOJI,
  div,
  esc,
  send,
  prefersMobileInfo,
  renderMobileInfo,
  getCurrentMobileInfoItem: () => currentMobileInfoItem,
  updateFullScreenAllergySummary,
  rerenderLayer: () => {
    if (window.__rerenderLayer__) window.__rerenderLayer__();
  },
});

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
  const { img, layer, inner } = initializeMenuLayout({
    container,
    images,
    imageURL,
    currentPage,
    div,
    menuState,
  });

  ensureMobileViewerChrome();
  updateZoomIndicator();

  // ========== Pinch-to-Zoom for Menu ==========
  setupMenuPinchZoom({ container, menuState });

  // Track dish interaction for analytics
  const trackDishInteraction = createDishInteractionTracker({
    state,
    normalizeAllergen,
    normalizeDietLabel,
    supabaseClient: window.supabaseClient,
  });

  const { showOverlayDetails, renderLayer } = createMenuOverlayRuntime({
    state,
    menuState,
    layer,
    img,
    ensureMobileInfoPanel,
    prefersMobileInfo,
    getIsOverlayZoomed: () => isOverlayZoomed,
    getZoomedOverlayItem: () => zoomedOverlayItem,
    zoomOutOverlay,
    hideTip,
    zoomToOverlay,
    hideMobileInfoPanel: () => {
      if (mobileInfoPanel && mobileInfoPanel.classList.contains("show")) {
        mobileInfoPanel.classList.remove("show");
        mobileInfoPanel.style.display = "none";
        mobileInfoPanel.innerHTML = "";
        currentMobileInfoItem = null;
      }
    },
    showTipIn,
    pageTip,
    tooltipBodyHTML,
    getTipPinned: () => tipPinned,
    getPinnedOverlayItem: () => pinnedOverlayItem,
    setOverlayPulseColor,
    hasCrossContamination,
    computeStatus,
    trackDishInteraction,
  });

  // Make showOverlayDetails globally accessible for auto-opening overlays from dish search
  window.showOverlayDetails = showOverlayDetails;

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

  bindMenuOverlayListeners({
    isOverlayZoomed: () => isOverlayZoomed,
    renderLayer,
    pageTip,
  });
}

/* restaurant page */
const renderRestaurant = () =>
  renderRestaurantScreen({
    state,
    orderFlow,
    TABLET_ORDER_STATUSES,
    renderTopbar,
    setRootOffsetPadding,
    mountRestaurantShell,
    applyRestaurantShellState,
    esc,
    fmtDate,
    initGuestFilterControls,
    renderSelector,
    renderSelectedChips,
    renderSavedChips,
    renderDietSelector,
    renderSelectedDiets,
    renderSavedDiets,
    showRestaurantMenuSurface,
    drawMenu,
    resizeLegendToFit,
    getMenuState,
    ensureMobileViewerChrome,
    updateZoomIndicator,
    prefersMobileInfo,
    openMobileViewer,
    send,
    urlQR,
    shouldShowQrPromo,
    queueQrPromoTimer,
    cancelQrPromoTimer,
    bindSavedPreferenceButtons,
    bindRestaurantActionButtons,
    openFeedbackModal,
    openReportIssueModal,
    ensureMobileInfoPanel,
    clearCurrentMobileInfoItem: () => {
      currentMobileInfoItem = null;
    },
  });


const renderEditor = createEditorRenderer({
  state,
  renderTopbar,
  mountEditorShell,
  setRootOffsetPadding,
  bindEditorToolbarScale,
  initializeEditorAssets,
  initEditorSections,
  div,
  createDirtyController,
  createEditorChangeState,
  initEditorHistory,
  initEditorOverlays,
  initEditorSaveFlow,
  send,
  esc,
  aiAssistSetStatus,
  cap,
  formatAllergenLabel,
  getDietAllergenConflicts,
  tooltipBodyHTML,
  createEditorLastConfirmedUpdater,
  getWeeksAgoInfo,
  fmtDateTime,
  initBrandVerification,
  getIssueReportMeta,
  openDishEditor,
  getAiAssistTableBody,
  showIngredientPhotoUploadModal,
  renderGroupedSourcesHtml,
  configureModalClose,
  normalizeDietLabel,
  normalizeAllergen,
  ALLERGENS,
  DIETS,
  norm,
  getSupabaseKey: () =>
    typeof window !== "undefined" ? window.SUPABASE_KEY || "" : "",
  getFetchProductByBarcode: () =>
    typeof window !== "undefined" ? window.fetchProductByBarcode || null : null,
  getShowReplacementPreview: () =>
    typeof window !== "undefined" ? window.showReplacementPreview || null : null,
  initChangeLog,
  initEditorSettings,
  orderFlow,
  bindEditorRuntimeBindings,
  bindEditorHistoryControls,
  bindDetectDishesButton,
  detectDishesOnMenu,
  initEditorNavigation,
  initMenuImageEditor,
  analyzeBoxSizes,
  splitImageIntoSections,
  bindEditorBackButton,
  createEditorItemEditor,
  openPendingDishInEditor,
  applyPendingMenuIndexRemap,
  setEditorSaveApi: (api) => {
    editorSaveApi = api;
  },
  setCollectAllBrandItems: (collector) => {
    collectAllBrandItems = collector;
    window.collectAllBrandItems = collectAllBrandItems;
    window.collectAiBrandItems = collectAllBrandItems;
  },
  setOpenBrandVerification: (openFn) => {
    openBrandVerification = openFn;
  },
  setOpenChangeLog: (openFn) => {
    openChangeLog = openFn;
  },
  setUpdateLastConfirmedText: (updater) => {
    updateLastConfirmedText = updater;
  },
  renderApp: () => {
    render();
  },
});

/* report */
function renderReport() {
  return renderRestaurantReportPage({
    renderTopbar,
    mountReportShell,
    send,
  });
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
const handleRestaurantMessage = createRestaurantMessageHandler({
  state,
  urlQR,
  applyDefaultUserName,
  initDinerNotifications,
  closeQrPromo,
  hideQrBanner,
  normalizeAllergen,
  normalizeDietLabel,
  rerenderOrderConfirmDetails,
  normalizeRestaurant,
  orderFlow,
  stopOrderRefresh,
  persistTabletStateSnapshot,
  renderOrderSidebarStatus,
  clearOrderItemSelections,
  restoreOrderItems,
  persistOrderItems,
  updateOrderSidebar,
  openOrderSidebar,
  rebuildBrandMemoryFromRestaurant,
  handleDishEditorResult,
  handleDishEditorError,
  getEditorSaveApi: () => editorSaveApi,
  checkForActiveOrders,
  updateLastConfirmedText,
  renderTopbar,
  render,
  maybeInitHowItWorksTour,
  updateFullScreenAllergySummary,
  openChangeLog: () => openChangeLog(),
});

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
