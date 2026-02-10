export function buildRestaurantShellMarkup(options = {}) {
  const {
    restaurantName = "Restaurant",
    isGuest = false,
    showSavedEditButtons = false,
    guestFilterToggleHtml = "",
    lastConfirmedText = "—",
    ack = false,
  } = options;

  return `
<!-- Fixed header section (page doesn't scroll, only menu does) -->
<div id="stickyHeader" style="background:var(--bg);padding:8px 16px 8px 16px;flex-shrink:0;">
  <h1 style="margin:0 0 8px 0;font-size:1.3rem">${restaurantName}</h1>

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
            ${showSavedEditButtons ? '<button class="btnLink clickable" id="editSavedBtn" style="font-size:0.6rem;flex-shrink:0;">Edit</button>' : guestFilterToggleHtml}
          </div>
          <div id="savedChips" class="saved-chip-row" style="font-size:0.65rem;display:flex;flex-wrap:nowrap;overflow-x:auto;gap:3px;-webkit-overflow-scrolling:touch;scrollbar-width:none;align-items:center;"></div>
        </div>

        <!-- Diets -->
        <div class="pill" style="flex:1;margin:0;padding:5px;min-width:0;overflow:hidden;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;gap:4px">
            <div style="font-weight:600;font-size:0.65rem;white-space:nowrap;">${isGuest ? "Diets" : "Saved diets"}</div>
            ${showSavedEditButtons ? '<button class="btnLink clickable" id="editSavedDietsBtn" style="font-size:0.6rem;flex-shrink:0;">Edit</button>' : guestFilterToggleHtml}
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
        Last confirmed by restaurant staff: ${lastConfirmedText}
      </div>
    </div>
  </div>

  <!-- Disclaimer banner (hidden after acknowledge) -->
  <div class="banner" id="disclaimerBanner" style="${ack ? "display:none;" : ""}margin-bottom:8px;">
    <span style="font-size:0.85rem">Reference only. Always inform staff about your allergens.</span>
    <button class="ackBtn ${ack ? "on" : "off"}" id="ackBtn" style="font-size:0.8rem;padding:4px 10px">${ack ? "Acknowledged" : "I understand"}</button>
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
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
}

function setDisplay(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = value;
}

export function mountRestaurantShell(root, fallbackOptions = {}) {
  if (!root) return;

  const template = document.getElementById("restaurantWorkspaceTemplate");
  if (
    typeof HTMLTemplateElement !== "undefined" &&
    template instanceof HTMLTemplateElement
  ) {
    root.replaceChildren(template.content.cloneNode(true));
    return;
  }

  root.innerHTML = buildRestaurantShellMarkup(fallbackOptions);
}

export function applyRestaurantShellState(options = {}) {
  const {
    restaurantName = "Restaurant",
    lastConfirmedText = "-",
    isGuest = false,
    isHowItWorks = false,
    isQr = false,
    isLoggedIn = false,
    guestFilterEditing = false,
    ack = false,
  } = options;

  setText("restaurantTitle", restaurantName);
  setText("savedAllergensLabel", isGuest ? "Allergens" : "Saved allergens");
  setText("savedDietsLabel", isGuest ? "Diets" : "Saved diets");
  setText("restaurantLastConfirmedText", lastConfirmedText);

  const ackBtn = document.getElementById("ackBtn");
  if (ackBtn) {
    ackBtn.textContent = ack ? "Acknowledged" : "I understand";
    ackBtn.classList.toggle("on", ack);
    ackBtn.classList.toggle("off", !ack);
  }
  setDisplay("disclaimerBanner", ack ? "none" : "");

  const showSavedEditButtons = !isQr && isLoggedIn;
  setDisplay("editSavedBtn", showSavedEditButtons ? "inline-flex" : "none");
  setDisplay(
    "editSavedDietsBtn",
    showSavedEditButtons ? "inline-flex" : "none",
  );

  const showGuestToggle = isGuest && ack && !isHowItWorks;
  const toggleButtons = document.querySelectorAll("[data-guest-filter-toggle]");
  toggleButtons.forEach((btn) => {
    btn.textContent = guestFilterEditing ? "Save" : "Edit";
    btn.classList.toggle("save", guestFilterEditing);
    btn.style.display = showGuestToggle ? "inline-flex" : "none";
  });
}
