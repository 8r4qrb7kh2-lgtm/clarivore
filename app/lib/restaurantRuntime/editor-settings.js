import { getSupabaseClient } from "./runtimeSessionState.js";

export function initEditorSettings(deps = {}) {
  const state = deps.state || {};
  const esc =
    typeof deps.esc === "function"
      ? deps.esc
      : (value) => String(value ?? "");
  const configureModalClose =
    typeof deps.configureModalClose === "function"
      ? deps.configureModalClose
      : () => {};
  const updateOrderConfirmModeVisibility =
    typeof deps.updateOrderConfirmModeVisibility === "function"
      ? deps.updateOrderConfirmModeVisibility
      : null;

  function openRestaurantSettings() {
    const mb = document.getElementById("modalBack");
    if (!mb) return;
    const body = document.getElementById("modalBody");
    document.getElementById("modalTitle").textContent = "Restaurant Settings";

    const rs = state.restaurant || {};
    const currentWebsite = rs.website || "";
    const currentPhone = rs.phone || "";
    const currentDeliveryUrl = rs.delivery_url || "";

    body.innerHTML = `
  <div style="max-width:600px;margin:0 auto">
    <p style="color:#a8b2d6;margin:0 0 24px;line-height:1.6">
      Update the links shown on your restaurant page. These links will appear on buttons at the bottom of the page, and the delivery link will also appear when customers select "Delivery / pickup" when confirming their notice.
    </p>
    <form id="settingsForm" style="display:flex;flex-direction:column;gap:20px">
      <label style="display:flex;flex-direction:column;gap:8px">
        <span style="font-weight:600;color:#e9ecff">🌐 Website URL</span>
        <input 
          type="url"
          id="settingsWebsite" 
          placeholder="https://www.example.com"
          value="${esc(currentWebsite)}"
          style="width:100%;padding:12px;border-radius:10px;border:1px solid #2a3261;background:#0f163a;color:#e9ecff;font-family:inherit;font-size:15px"
        />
        <span style="font-size:13px;color:#a8b2d6">Used for the "Visit Website" button</span>
      </label>
      <label style="display:flex;flex-direction:column;gap:8px">
        <span style="font-weight:600;color:#e9ecff">📞 Phone Number</span>
        <input 
          type="tel"
          id="settingsPhone" 
          placeholder="+1 (555) 123-4567"
          value="${esc(currentPhone)}"
          style="width:100%;padding:12px;border-radius:10px;border:1px solid #2a3261;background:#0f163a;color:#e9ecff;font-family:inherit;font-size:15px"
        />
        <span style="font-size:13px;color:#a8b2d6">Used for the "Call Restaurant" button</span>
      </label>
      <label style="display:flex;flex-direction:column;gap:8px">
        <span style="font-weight:600;color:#e9ecff">🚗 Delivery / Pickup URL</span>
        <input 
          type="url"
          id="settingsDeliveryUrl" 
          placeholder="https://www.delivery-service.com/your-restaurant"
          value="${esc(currentDeliveryUrl)}"
          style="width:100%;padding:12px;border-radius:10px;border:1px solid #2a3261;background:#0f163a;color:#e9ecff;font-family:inherit;font-size:15px"
        />
        <span style="font-size:13px;color:#a8b2d6">Used for the "Order Delivery / Pickup" button and appears when customers select delivery/pickup mode</span>
      </label>
      <div id="settingsStatus" style="font-size:14px;min-height:20px;text-align:center"></div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <button type="button" class="btn" onclick="document.getElementById('modalBack').style.display='none'" style="padding:10px 20px;cursor:pointer">
          Cancel
        </button>
        <button type="submit" class="btn btnPrimary" style="padding:10px 20px;cursor:pointer">
          Save Changes
        </button>
      </div>
    </form>
  </div>
    `;

    configureModalClose({
      visible: true,
      onClick: () => {
        mb.style.display = "none";
        mb.onclick = null;
        const form = document.getElementById("settingsForm");
        if (form) form.innerHTML = "";
      },
    });

    mb.style.display = "flex";

    // Handle form submission
    const form = document.getElementById("settingsForm");
    const statusDiv = document.getElementById("settingsStatus");
    const websiteInput = document.getElementById("settingsWebsite");
    const phoneInput = document.getElementById("settingsPhone");
    const deliveryUrlInput = document.getElementById("settingsDeliveryUrl");

    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();

        const website = (websiteInput?.value || "").trim();
        const phone = (phoneInput?.value || "").trim();
        const deliveryUrl = (deliveryUrlInput?.value || "").trim();

        // Validate URLs if provided
        if (website && !website.match(/^https?:\/\/.+/)) {
          if (statusDiv)
            statusDiv.textContent =
              "Please enter a valid website URL (starting with http:// or https://)";
          if (statusDiv) statusDiv.style.color = "#ef4444";
          if (websiteInput) websiteInput.focus();
          return;
        }

        if (deliveryUrl && !deliveryUrl.match(/^https?:\/\/.+/)) {
          if (statusDiv)
            statusDiv.textContent =
              "Please enter a valid delivery URL (starting with http:// or https://)";
          if (statusDiv) statusDiv.style.color = "#ef4444";
          if (deliveryUrlInput) deliveryUrlInput.focus();
          return;
        }

        if (statusDiv) statusDiv.textContent = "Saving...";
        if (statusDiv) statusDiv.style.color = "#a8b2d6";
        if (form.querySelector('button[type="submit"]')) {
          form.querySelector('button[type="submit"]').disabled = true;
        }

        try {
          const client = getSupabaseClient();
          if (!client) throw new Error("Database connection not ready");

          const restaurantId =
            state.restaurant?._id || state.restaurant?.id || null;
          if (!restaurantId)
            throw new Error("Restaurant information not available");

          const { data, error } = await client
            .from("restaurants")
            .update({
              website: website || null,
              phone: phone || null,
              delivery_url: deliveryUrl || null,
            })
            .eq("id", restaurantId)
            .select()
            .single();

          if (error) {
            console.error("Supabase error details:", error);
            throw error;
          }

          // Update local state
          if (state.restaurant) {
            state.restaurant.website = website || null;
            state.restaurant.phone = phone || null;
            state.restaurant.delivery_url = deliveryUrl || null;
          }

          // Update delivery button link if visible
          if (updateOrderConfirmModeVisibility) {
            updateOrderConfirmModeVisibility();
          }

          // Mark editor as dirty so "Save to site" button appears
          // Show the save button if we're in editor mode
          const saveBtn = document.getElementById("saveBtn");
          if (saveBtn && state.page === "editor") {
            saveBtn.style.display = "inline-flex";
          }

          if (statusDiv) {
            statusDiv.textContent = "✓ Settings saved successfully!";
            statusDiv.style.color = "#22c55e";
          }

          setTimeout(() => {
            mb.style.display = "none";
            mb.onclick = null;
            // Just close the modal - don't reload to preserve editor mode
            // The updated values are already in state.restaurant, so buttons will work
          }, 1500);
        } catch (err) {
          console.error("Settings save error:", err);
          if (statusDiv) {
            let errorMsg = "Sorry, something went wrong. Please try again.";
            if (err.message) {
              errorMsg = `Error: ${err.message}`;
            }
            statusDiv.textContent = errorMsg;
            statusDiv.style.color = "#ef4444";
          }
          if (form.querySelector('button[type="submit"]')) {
            form.querySelector('button[type="submit"]').disabled = false;
          }
        }
      };
    }

    mb.onclick = (e) => {
      if (e.target === mb) {
        mb.style.display = "none";
        mb.onclick = null;
      }
    };

    // Auto-focus first input
    if (websiteInput) {
      setTimeout(() => websiteInput.focus(), 100);
    }
  }

  return { openRestaurantSettings };
}
