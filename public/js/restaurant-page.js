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
import {
  fetchChangeLogEntries,
  insertChangeLogEntry,
} from "./restaurant/change-log-service.js";
import { createStandaloneMessageDispatcher } from "./restaurant/standalone-message-dispatcher.js";
import { createTooltipBodyHTML } from "./restaurant/dish-compatibility-tooltip.js";
import { normalizeRestaurantRow } from "./restaurant/restaurant-normalization.js";
import {
  fmtDate,
  fmtDateTime,
  getWeeksAgoInfo,
} from "./restaurant/time-formatting.js";

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
const dispatchStandaloneMessage = createStandaloneMessageDispatcher({
  state,
  normalizeRestaurant,
  insertChangeLogEntry,
  fetchChangeLogEntries,
});
const send = (p) => {
  if (isStandalone) {
    const handled = dispatchStandaloneMessage(p);
    if (!handled) {
      console.log("Message sent:", p);
    }
  } else {
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
const tooltipBodyHTML = createTooltipBodyHTML({
  normalizeAllergen,
  normalizeDietLabel,
  getDietAllergenConflicts,
  ALLERGEN_EMOJI,
  DIET_EMOJI,
  formatAllergenLabel,
  esc,
  prefersMobileInfo: () => prefersMobileInfo(),
});

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
function div(html, cls) {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  d.innerHTML = html;
  return d;
}

function normalizeRestaurant(row) {
  return normalizeRestaurantRow(row, {
    normalizeAllergen,
    normalizeDietLabel,
  });
}

function configureModalClose({ visible = true, onClick = null } = {}) {
  const closeBtn = document.getElementById("modalCloseBtn");
  if (closeBtn) {
    closeBtn.style.display = visible ? "inline-flex" : "none";
    closeBtn.onclick = onClick || null;
  }
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

function applyRestaurantBootPayload(payload) {
  handleRestaurantMessage(payload || {});
}

window.addEventListener("message", (ev) => {
  applyRestaurantBootPayload(ev.data || {});
});

if (window.__restaurantBootPayload && !window.__restaurantBootPayloadConsumed) {
  window.__restaurantBootPayloadConsumed = true;
  applyRestaurantBootPayload(window.__restaurantBootPayload);
}

export function hydrateRestaurantBootPayload(payload) {
  applyRestaurantBootPayload(payload || {});
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
