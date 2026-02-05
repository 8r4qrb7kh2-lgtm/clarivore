import { createIngredientNormalizer } from "./ingredient-row-utils.js";

export function initBrandVerification(deps = {}) {
  const overlays = Array.isArray(deps.overlays) ? deps.overlays : [];
  const rs = deps.rs || {};
  const setDirty = typeof deps.setDirty === "function" ? deps.setDirty : () => {};
  const drawAll = typeof deps.drawAll === "function" ? deps.drawAll : () => {};
  const send = typeof deps.send === "function" ? deps.send : () => {};
  const updateLastConfirmedText =
    typeof deps.updateLastConfirmedText === "function"
      ? deps.updateLastConfirmedText
      : () => {};
  const getIssueReportMeta =
    typeof deps.getIssueReportMeta === "function" ? deps.getIssueReportMeta : () => ({});
  const openAiAssistant =
    typeof deps.openAiAssistant === "function" ? deps.openAiAssistant : () => {};
  const getAiAssistTableBody =
    typeof deps.getAiAssistTableBody === "function"
      ? deps.getAiAssistTableBody
      : () =>
          typeof deps.aiAssistTableBody === "function"
            ? deps.aiAssistTableBody()
            : deps.aiAssistTableBody || null;
  const showIngredientPhotoUploadModal =
    typeof deps.showIngredientPhotoUploadModal === "function"
      ? deps.showIngredientPhotoUploadModal
      : () => {};
  const renderGroupedSourcesHtml =
    typeof deps.renderGroupedSourcesHtml === "function"
      ? deps.renderGroupedSourcesHtml
      : () => "";
  const normalizeDietLabel =
    typeof deps.normalizeDietLabel === "function"
      ? deps.normalizeDietLabel
      : (value) => {
          const raw = String(value ?? "").trim();
          if (!raw) return "";
          if (!DIETS.length) return raw;
          return DIETS.includes(raw) ? raw : "";
        };
  const esc =
    typeof deps.esc === "function"
      ? deps.esc
      : (value) => String(value ?? "");
  const ALLERGENS = Array.isArray(deps.ALLERGENS) ? deps.ALLERGENS : [];
  const DIETS = Array.isArray(deps.DIETS) ? deps.DIETS : [];
  const normalizeAllergen =
    typeof deps.normalizeAllergen === "function"
      ? deps.normalizeAllergen
      : (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) return "";
        if (!ALLERGENS.length) return raw;
        return ALLERGENS.includes(raw) ? raw : "";
      };
  const ingredientNormalizer = createIngredientNormalizer({
    normalizeAllergen,
    normalizeDietLabel,
    ALLERGENS,
    DIETS,
  });
  const normalizeAllergenKey = ingredientNormalizer.normalizeAllergenKey;
  const normalizeDietKey = ingredientNormalizer.normalizeDietKey;
  const normalizeStringArray = ingredientNormalizer.normalizeStringArray;
  const configureModalClose =
    typeof deps.configureModalClose === "function" ? deps.configureModalClose : () => {};
  const openImageModal =
    typeof deps.openImageModal === "function"
      ? deps.openImageModal
      : () => {};
  const fetchProductByBarcode =
    typeof deps.fetchProductByBarcode === "function"
      ? deps.fetchProductByBarcode
      : typeof window !== "undefined" && typeof window.fetchProductByBarcode === "function"
        ? window.fetchProductByBarcode
        : async () => {
            throw new Error("fetchProductByBarcode is not available");
          };
  const showReplacementPreview =
    typeof deps.showReplacementPreview === "function"
      ? deps.showReplacementPreview
      : typeof window !== "undefined" && typeof window.showReplacementPreview === "function"
        ? window.showReplacementPreview
        : async () => {
            throw new Error("showReplacementPreview is not available");
          };
  const SUPABASE_KEY =
    deps.SUPABASE_KEY ||
    (typeof window !== "undefined" ? window.SUPABASE_KEY : "") ||
    "";
  const parseJsonArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  };
  const getOverlayIngredients = (overlay) => {
    const fromAi = parseJsonArray(overlay?.aiIngredients);
    const fallback = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];
    const base = fromAi.length ? fromAi : fallback;
    return ingredientNormalizer.sanitizeIngredientRows(base);
  };
  const setOverlayIngredients = (overlay, ingredients) => {
    const sanitized = ingredientNormalizer.sanitizeIngredientRows(ingredients);
    overlay.aiIngredients = JSON.stringify(sanitized);
    return sanitized;
  };
  // Collect all brand items from all dishes
    function collectAllBrandItems() {
      const brandItems = new Map(); // key: `${ingredientName}|${brandName}|${barcode}`
      const currentOverlays = JSON.parse(JSON.stringify(overlays || []));
      const mergeNormalized = (target, items, normalizeFn) => {
        if (!Array.isArray(items)) return;
        const normalized = normalizeStringArray(items, normalizeFn);
        normalized.forEach((item) => {
          if (!target.includes(item)) target.push(item);
        });
      };

      currentOverlays.forEach((overlay, overlayIdx) => {
        const dishName = overlay.id || overlay.name || "unnamed";
        const ingredients = getOverlayIngredients(overlay);

        // Process each ingredient
        ingredients.forEach((ingredient, ingIdx) => {
          if (
            !ingredient.name ||
            !Array.isArray(ingredient.brands) ||
            ingredient.brands.length === 0
          ) {
            return;
          }

          ingredient.brands.forEach((brand) => {
            const sanitizedBrand = ingredientNormalizer.sanitizeBrandEntry(brand);
            if (!sanitizedBrand.name) return;

            // Create unique key for this brand item - use barcode as primary identifier
            // If barcode exists, use it alone (barcode should be unique per product)
            // If no barcode, fall back to brand name only (to handle items without barcodes)
            const barcode = sanitizedBrand.barcode || "";
            const key = barcode ? barcode : `${sanitizedBrand.name}`;

            if (!brandItems.has(key)) {
              brandItems.set(key, {
                ingredientName: ingredient.name, // Keep first ingredient name for display
                brandName: sanitizedBrand.name,
                barcode: barcode,
                brandImage: sanitizedBrand.brandImage || "",
                ingredientsImage: sanitizedBrand.ingredientsImage || "",
                ingredientsList: sanitizedBrand.ingredientsList || [],
                allergens: [],
                diets: [],
                crossContamination: [],
                crossContaminationDiets: [],
                dishes: [],
              });
            }

            // Add dish info to the brand item
            const brandItem = brandItems.get(key);
            if (!brandItem.brandImage && sanitizedBrand.brandImage) {
              brandItem.brandImage = sanitizedBrand.brandImage;
            }
            if (!brandItem.ingredientsImage && sanitizedBrand.ingredientsImage) {
              brandItem.ingredientsImage = sanitizedBrand.ingredientsImage;
            }
            if (
              (!brandItem.ingredientsList ||
                brandItem.ingredientsList.length === 0) &&
              sanitizedBrand.ingredientsList.length
            ) {
              brandItem.ingredientsList = sanitizedBrand.ingredientsList;
            }
            mergeNormalized(
              brandItem.allergens,
              sanitizedBrand.allergens,
              normalizeAllergenKey,
            );
            mergeNormalized(
              brandItem.allergens,
              ingredient.allergens,
              normalizeAllergenKey,
            );
            mergeNormalized(brandItem.diets, sanitizedBrand.diets, normalizeDietKey);
            mergeNormalized(
              brandItem.diets,
              ingredient.diets,
              normalizeDietKey,
            );
            mergeNormalized(
              brandItem.crossContamination,
              sanitizedBrand.crossContamination,
              normalizeAllergenKey,
            );
            mergeNormalized(
              brandItem.crossContamination,
              ingredient.crossContamination,
              normalizeAllergenKey,
            );
            mergeNormalized(
              brandItem.crossContaminationDiets,
              sanitizedBrand.crossContaminationDiets,
              normalizeDietKey,
            );
            mergeNormalized(
              brandItem.crossContaminationDiets,
              ingredient.crossContaminationDiets,
              normalizeDietKey,
            );
            brandItem.dishes.push({
              overlayIdx: overlayIdx,
              dishName: dishName,
              ingredientIdx: ingIdx,
              brandIdx: ingredient.brands.indexOf(brand),
            });

            // If this brand item has multiple ingredient names, update to show all ingredients
            if (brandItem.ingredientName !== ingredient.name) {
              // Check if we already have a list of ingredients
              if (!brandItem.ingredientNames) {
                brandItem.ingredientNames = [brandItem.ingredientName];
              }
              if (!brandItem.ingredientNames.includes(ingredient.name)) {
                brandItem.ingredientNames.push(ingredient.name);
              }
            }
          });
        });
      });

      return Array.from(brandItems.values());
    }


    function openBrandVerification() {
      const mb = document.getElementById("modalBack");
      const body = document.getElementById("modalBody");
      document.getElementById("modalTitle").textContent = "Verify Brand Items";

      const brandItems = collectAllBrandItems();

      if (brandItems.length === 0) {
        body.innerHTML = `
      <div class="note" style="text-align:center;margin:20px 0">
        <p>No brand items found in your dishes.</p>
        <p style="margin-top:12px">Add brand items to your dishes to verify them here.</p>
      </div>
      <div style="text-align:center;margin-top:20px">
        <button class="btn" onclick="document.getElementById('modalBack').style.display='none'">Close</button>
      </div>
    `;
        mb.style.display = "flex";
        configureModalClose({
          visible: true,
          onClick: () => {
            mb.style.display = "none";
          },
        });
        return;
      }

      // Track verification status for each brand item
      const verificationStatus = new Map();
      brandItems.forEach((item, idx) => {
        verificationStatus.set(idx, {
          verified: false,
          scannedBarcode: null,
          verifying: false,
          verificationError: null,
        });
      });

      let currentScanningIdx = null;
      let showingRemoveOptions = null; // Track which card is showing remove options
      let showingDishSelection = null; // Track which card is showing dish selection

      function renderBrandItems() {
        let html = `
      <div style="margin-bottom:16px">
        <p class="note" style="text-align:center">
          Take a photo of each brand item to confirm you're still using it.
        </p>
      </div>
      <div style="max-height:60vh;overflow-y:auto;border:1px solid rgba(76,90,212,0.3);border-radius:8px;padding:12px">
    `;

        brandItems.forEach((item, idx) => {
          const status = verificationStatus.get(idx);
          const verified = status.verified;
          const verifying = status.verifying;
          const verificationError = status.verificationError;
          const isScanning = currentScanningIdx === idx;
          const showingOptions =
            showingRemoveOptions === idx && showingDishSelection !== idx;
          const showingDishSel = showingDishSelection === idx;

          // Check if brand has an original image
          const hasOriginalImage =
            item.brandImage && item.brandImage.trim() !== "";

          html += `
        <div class="brandItemCard" data-idx="${idx}" style="
          background:${verified ? "rgba(34,197,94,0.1)" : "rgba(76,90,212,0.1)"};
          border:1px solid ${verified ? "rgba(34,197,94,0.4)" : "rgba(76,90,212,0.4)"};
          border-radius:8px;
          padding:16px;
          margin-bottom:12px;
          position:relative
        ">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
            ${
              hasOriginalImage
                ? `
              <div style="flex-shrink:0">
                <div style="font-size:0.75rem;color:#8891b0;margin-bottom:4px;text-align:center">Original Photo</div>
                <img src="${esc(item.brandImage)}" alt="${esc(item.brandName)}" style="
                  width:80px;
                  height:80px;
                  object-fit:contain;
                  border-radius:6px;
                  background:rgba(255,255,255,0.1);
                  border:1px solid rgba(255,255,255,0.2);
                  cursor:pointer;
                " onclick="openImageModal('${esc(item.brandImage)}')" title="Click to enlarge">
              </div>
            `
                : ""
            }
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:1.1rem;margin-bottom:4px">
                ${esc(item.brandName)}
              </div>
              <div style="color:#a8b2d6;font-size:0.9rem;margin-bottom:8px">
                ${
                  item.ingredientNames && item.ingredientNames.length > 1
                    ? `Ingredients: ${esc(item.ingredientNames.join(", "))}`
                    : `Ingredient: ${esc(item.ingredientName)}`
                }
              </div>
              ${item.barcode ? `<div style="color:#8891b0;font-size:0.85rem;margin-bottom:8px">Barcode: ${esc(item.barcode)}</div>` : ""}
              <div style="color:#8891b0;font-size:0.85rem;margin-bottom:8px">
                Used in ${item.dishes.length} dish${item.dishes.length !== 1 ? "es" : ""}: ${esc(item.dishes.map((d) => d.dishName).join(", "))}
              </div>
              ${verified ? `<div style="color:#22c55e;font-size:0.9rem;margin-top:8px">✓ Verified</div>` : ""}
              ${!hasOriginalImage && !verified ? `<div style="color:#f59e0b;font-size:0.85rem;margin-top:8px">⚠ No original photo - please scan barcode instead</div>` : ""}
            </div>
            <div style="display:flex;gap:8px;flex-direction:column;align-items:flex-end">
              ${
                !verified &&
                !showingOptions &&
                hasOriginalImage &&
                !verifying &&
                !verificationError
                  ? `
                <button class="btn btnPrimary scanBrandBtn" data-idx="${idx}" style="white-space:nowrap;padding:8px 12px;font-size:0.9rem" ${isScanning ? "disabled" : ""}>
                  ${isScanning ? "Verifying..." : "📷 Verify Product"}
                </button>
              `
                  : ""
              }
              ${
                !verified &&
                !showingOptions &&
                !hasOriginalImage &&
                !verifying &&
                !verificationError
                  ? `
                <button class="btn btnPrimary scanBrandBtn" data-idx="${idx}" style="white-space:nowrap;padding:8px 12px;font-size:0.9rem" ${isScanning ? "disabled" : ""}>
                  ${isScanning ? "Scanning..." : "📷 Scan Barcode"}
                </button>
              `
                  : ""
              }
              ${
                !showingOptions && !verifying && !verificationError
                  ? `
                <div style="display:flex;gap:8px;flex-direction:row;align-items:center;flex-wrap:wrap;justify-content:flex-end">
                  <button class="btn btnDanger replaceBrandBtn" data-idx="${idx}" style="white-space:nowrap;padding:8px 12px;font-size:0.9rem">
                    Replace item
                  </button>
                </div>
              `
                  : ""
              }
            </div>
          </div>
          ${
            showingDishSel
              ? `
            <div class="dishSelectionDiv" style="margin-top:12px;padding:12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:6px">
              <div style="color:#fff;font-size:0.95rem;margin-bottom:12px;font-weight:500">
                Select which dishes to remove this item from:
              </div>
              <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px" id="dishSelectionList_${idx}">
                <!-- Dish checkboxes will be inserted here -->
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn btnDanger confirmRemoveBtn" data-idx="${idx}" style="flex:1;min-width:120px;padding:8px 12px;font-size:0.9rem">
                  Remove Selected
                </button>
                <button class="btn cancelDishSelectionBtn" data-idx="${idx}" style="padding:8px 12px;font-size:0.9rem">
                  Cancel
                </button>
              </div>
            </div>
          `
              : ""
          }
          ${
            isScanning
              ? `
            <div id="scanStatus_${idx}" style="margin-top:12px;padding:12px;background:rgba(76,90,212,0.2);border-radius:6px;text-align:center">
              <div style="color:#a8b2d6">Scanning barcode...</div>
            </div>
          `
              : ""
          }
          ${
            verifying
              ? `
            <div id="verifyingStatus_${idx}" style="margin-top:12px;padding:12px;background:rgba(76,90,212,0.2);border-radius:6px">
              <div style="color:#a8b2d6;margin-bottom:8px;font-size:0.9rem">Verifying item...</div>
              <style>
                @keyframes brandVerifySlide {
                  0% { transform: translateX(-100%); }
                  100% { transform: translateX(400%); }
                }
              </style>
              <div style="width:100%;background:rgba(0,0,0,0.2);border-radius:4px;height:8px;overflow:hidden;position:relative">
                <div style="background:linear-gradient(90deg, transparent, #4c5ad4, transparent);height:100%;width:25%;position:absolute;animation:brandVerifySlide 1.2s ease-in-out infinite"></div>
              </div>
              <div style="color:#8891b0;font-size:0.85rem;margin-top:8px;text-align:center">
                You can continue verifying other items while this completes
              </div>
              <button class="btn cancelVerifyBtn" data-idx="${idx}" style="margin-top:8px;padding:6px 12px;font-size:0.85rem;width:100%">Cancel</button>
            </div>
          `
              : ""
          }
          ${
            verificationError
              ? `
            <div id="verificationError_${idx}" style="margin-top:12px;padding:12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:6px">
              <div style="color:#ef4444;font-size:0.9rem;margin-bottom:12px">${esc(verificationError)}</div>
              <div style="display:flex;flex-direction:column;gap:8px">
                <button class="btn btnPrimary clearVerificationErrorBtn" data-idx="${idx}" style="padding:8px 12px;font-size:0.9rem">📷 Retake photo</button>
                <button class="btn btnDanger reportBrandIssueBtn" data-idx="${idx}" style="padding:8px 12px;font-size:0.9rem">⚠️ Something's not right</button>
              </div>
            </div>
          `
              : ""
          }
        </div>
      `;
        });

        html += `</div>`;

        const allVerified = Array.from(verificationStatus.values()).every(
          (s) => s.verified,
        );
        html += `
      <div style="margin-top:20px;text-align:center">
        <button class="btn btnSuccess" id="confirmAllBtn" ${!allVerified ? 'disabled style="opacity:0.5"' : ""}>
          ${allVerified ? "✓ Confirm All Verified" : `Verify ${brandItems.length - Array.from(verificationStatus.values()).filter((s) => s.verified).length} remaining items`}
        </button>
        <button class="btn" id="cancelBrandVerificationBtn" style="margin-left:8px">Cancel</button>
      </div>
    `;

        body.innerHTML = html;

        // Attach event handlers
        brandItems.forEach((item, idx) => {
          const scanBtn = body.querySelector(`.scanBrandBtn[data-idx="${idx}"]`);
          if (scanBtn) {
            scanBtn.addEventListener("click", () => scanBrandItem(idx));
          }

          const removeBtn = body.querySelector(
            `.removeBrandBtn[data-idx="${idx}"]`,
          );
          if (removeBtn) {
            removeBtn.addEventListener("click", () => {
              // Close brand verification modal and route to AI assistant for each dish
              const mb = document.getElementById("modalBack");
              if (mb) mb.style.display = "none";

              // Route to AI assistant for each dish
              routeToAiAssistantForDishes(idx, item);
            });
          }

          const replaceBtn = body.querySelector(
            `.replaceBrandBtn[data-idx="${idx}"]`,
          );
          if (replaceBtn) {
            replaceBtn.addEventListener("click", () => {
              replaceBrandItem(
                idx,
                item.dishes.map((d) => d.overlayIdx),
              );
            });
          }

          // Setup dish selection if needed
          if (showingDishSelection === idx) {
            setupDishSelectionForCard(idx, item);
          }

          // Setup verification error handler - retake photo
          const clearErrorBtn = body.querySelector(
            `.clearVerificationErrorBtn[data-idx="${idx}"]`,
          );
          if (clearErrorBtn) {
            clearErrorBtn.addEventListener("click", () => {
              const status = verificationStatus.get(idx);
              status.verificationError = null;
              renderBrandItems();
              // Re-open the verification modal
              scanBrandItem(idx);
            });
          }

          // Setup report issue handler
          const reportBrandIssueBtn = body.querySelector(
            `.reportBrandIssueBtn[data-idx="${idx}"]`,
          );
          if (reportBrandIssueBtn) {
            reportBrandIssueBtn.addEventListener("click", () => {
              // Show report issue modal
              const reportModal = document.createElement("div");
              reportModal.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.8); z-index: 10002;
                display: flex; align-items: center; justify-content: center;
              `;

              reportModal.innerHTML = `
                <div style="background: #1e293b; padding: 24px; border-radius: 12px; width: 90%; max-width: 500px; border: 1px solid rgba(148, 163, 184, 0.2);">
                  <h3 style="color: #fff; margin: 0 0 16px 0;">Report Issue</h3>
                  <p style="color: #94a3b8; margin-bottom: 16px; font-size: 0.9rem;">Please describe what's wrong with the product verification for <strong>${esc(item.brandName)}</strong>.</p>
                  <textarea style="width: 100%; height: 100px; background: rgba(0,0,0,0.2); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 8px; color: #fff; padding: 12px; margin-bottom: 16px; resize: vertical;" placeholder="e.g. This is the correct product but packaging looks different, the analysis is wrong, etc."></textarea>
                  <div style="display: flex; justify-content: flex-end; gap: 12px;">
                    <button class="cancelReportBtn" style="padding: 8px 16px; background: transparent; border: 1px solid rgba(255,255,255,0.2); color: #fff; border-radius: 6px; cursor: pointer;">Cancel</button>
                    <button class="sendReportBtn" style="padding: 8px 16px; background: #dc2626; border: none; color: #fff; border-radius: 6px; cursor: pointer; font-weight: 600;">Send Report</button>
                  </div>
                </div>
              `;

              document.body.appendChild(reportModal);

              reportModal.querySelector(".cancelReportBtn").onclick = () =>
                document.body.removeChild(reportModal);

              reportModal.querySelector(".sendReportBtn").onclick =
                async function () {
                  const msg = reportModal.querySelector("textarea").value;
                  if (!msg) return;

                  this.textContent = "Sending...";
                  this.disabled = true;

                  try {
                    const reportMeta = getIssueReportMeta();
                    await fetch(
                      "https://fgoiyycctnwnghrvsilt.supabase.co/functions/v1/report-issue",
                      {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${SUPABASE_KEY}`,
                          apikey: SUPABASE_KEY,
                        },
                        body: JSON.stringify({
                          message: msg,
                          productName: item.brandName,
                          context: "brand_verification",
                          userEmail: reportMeta.userEmail,
                          reporterName: reportMeta.reporterName,
                          accountName: reportMeta.accountName,
                          accountId: reportMeta.accountId,
                          pageUrl: reportMeta.pageUrl,
                          restaurantName: state.restaurant?.name || null,
                        }),
                      },
                    );

                    document.body.removeChild(reportModal);
                    alert(
                      "Thank you for reporting this issue. Our team will review it.",
                    );
                  } catch (e) {
                    console.error("Failed to report issue:", e);
                    this.textContent = "Send Report";
                    this.disabled = false;
                    alert("Failed to send report. Please try again.");
                  }
                };
            });
          }

          // Setup cancel verification handler
          const cancelVerifyBtn = body.querySelector(
            `.cancelVerifyBtn[data-idx="${idx}"]`,
          );
          if (cancelVerifyBtn) {
            cancelVerifyBtn.addEventListener("click", () => {
              const status = verificationStatus.get(idx);
              status.verifying = false;
              status.verificationAborted = true; // Mark as aborted so API response is ignored
              status.verificationError = null;
              renderBrandItems();
            });
          }
        });

        const confirmBtn = body.querySelector("#confirmAllBtn");
        if (confirmBtn) {
          confirmBtn.addEventListener("click", () => {
            if (allVerified) {
              finalizeBrandVerification();
            }
          });
        }

        const cancelBtn = body.querySelector("#cancelBrandVerificationBtn");
        if (cancelBtn) {
          cancelBtn.addEventListener("click", () => {
            mb.style.display = "none";
          });
        }
      }

      async function scanBrandItem(idx) {
        const item = brandItems[idx];
        const hasOriginalImage = item.brandImage && item.brandImage.trim() !== "";

        // If item has an original image, use photo verification
        // Otherwise, use barcode scanning
        if (hasOriginalImage) {
          await verifyBrandWithPhoto(idx, item);
        } else {
          await scanBrandBarcode(idx, item);
        }
      }

      // Photo verification flow - compare new photo with original
      async function verifyBrandWithPhoto(idx, item) {
        currentScanningIdx = idx;
        renderBrandItems();

        // Create photo capture modal
        const photoModal = document.createElement("div");
        photoModal.id = "brandVerificationPhotoModal";
        photoModal.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.95);
          z-index: 10001;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          padding: 20px;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-y;
          overscroll-behavior: contain;
        `;

        photoModal.innerHTML = `
          <div style="width:100%;max-width:700px;display:flex;flex-direction:column;gap:16px">
            <div style="text-align:center">
              <h3 style="margin:0 0 8px 0;font-size:1.4rem;color:#fff">Verify Product</h3>
              <div style="margin:0;color:#a8b2d6;font-size:0.95rem">
                Take a photo of the front of <strong style="color:#fff">${esc(item.brandName)}</strong>
              </div>
            </div>

            <div style="display:flex;gap:20px;justify-content:center;align-items:flex-start;flex-wrap:wrap">
              <!-- Original image reference -->
              <div style="text-align:center">
                <div style="font-size:0.85rem;color:#8891b0;margin-bottom:8px">Original Photo (Reference)</div>
                <img src="${esc(item.brandImage)}" alt="Original ${esc(item.brandName)}" style="
                  width:150px;
                  height:150px;
                  object-fit:contain;
                  border-radius:8px;
                  background:rgba(255,255,255,0.1);
                  border:2px solid rgba(76,90,212,0.5);
                ">
                <div style="font-size:0.8rem;color:#a8b2d6;margin-top:4px">Match this product</div>
              </div>

              <!-- Camera preview -->
              <div style="text-align:center">
                <div style="font-size:0.85rem;color:#8891b0;margin-bottom:8px">Your Photo</div>
                <div style="position:relative;width:150px;height:150px;background:#000;border-radius:8px;overflow:hidden;border:2px solid rgba(76,90,212,0.5)">
                  <video id="brandVerifyVideo" style="width:100%;height:100%;object-fit:cover" autoplay playsinline></video>
                  <canvas id="brandVerifyCanvas" style="display:none"></canvas>
                  <img id="brandVerifyPreview" style="display:none;width:100%;height:100%;object-fit:cover">
                </div>
                <div style="font-size:0.8rem;color:#a8b2d6;margin-top:4px">Point camera at product</div>
              </div>
            </div>

            <div id="brandVerifyStatus" style="text-align:center;color:#a8b2d6;padding:12px;background:rgba(76,90,212,0.2);border-radius:6px">
              Position the product front in view, then tap "Take Photo"
            </div>

            <input type="file" id="brandVerifyUploadInput" accept="image/*" style="display:none">

            <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
              <button class="btn btnPrimary" id="brandVerifyTakePhotoBtn" style="padding:12px 24px;font-size:1rem">
                📷 Take Photo
              </button>
              <button class="btn" id="brandVerifyUploadBtn" style="padding:12px 24px;font-size:1rem">
                📁 Upload Image
              </button>
              <button class="btn" id="brandVerifyRetakeBtn" style="display:none;padding:12px 24px;font-size:1rem">
                🔄 Retake
              </button>
              <button class="btn btnSuccess" id="brandVerifyConfirmBtn" style="display:none;padding:12px 24px;font-size:1rem">
                ✓ Verify This Photo
              </button>
              <button class="btn" id="brandVerifyCancelBtn" style="padding:12px 24px;font-size:1rem">
                Cancel
              </button>
            </div>
          </div>
        `;

        document.body.appendChild(photoModal);

        const video = photoModal.querySelector("#brandVerifyVideo");
        const canvas = photoModal.querySelector("#brandVerifyCanvas");
        const preview = photoModal.querySelector("#brandVerifyPreview");
        const statusDiv = photoModal.querySelector("#brandVerifyStatus");
        const takePhotoBtn = photoModal.querySelector("#brandVerifyTakePhotoBtn");
        const uploadBtn = photoModal.querySelector("#brandVerifyUploadBtn");
        const uploadInput = photoModal.querySelector("#brandVerifyUploadInput");
        const retakeBtn = photoModal.querySelector("#brandVerifyRetakeBtn");
        const confirmBtn = photoModal.querySelector("#brandVerifyConfirmBtn");
        const cancelBtn = photoModal.querySelector("#brandVerifyCancelBtn");

        let stream = null;
        let capturedImage = null;

        const stopCamera = () => {
          if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            stream = null;
          }
        };

        const closeModal = () => {
          stopCamera();
          if (photoModal.parentNode) {
            photoModal.parentNode.removeChild(photoModal);
          }
          currentScanningIdx = null;
          renderBrandItems();
        };

        // Start camera
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          });
          video.srcObject = stream;
        } catch (err) {
          console.error("Camera access error:", err);
          statusDiv.innerHTML =
            '<div style="color:#ef4444">Camera access denied. Please allow camera access.</div>';
        }

        // Take photo
        takePhotoBtn.addEventListener("click", () => {
          if (!video.srcObject) return;

          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0);

          capturedImage = canvas.toDataURL("image/jpeg", 0.8);
          preview.src = capturedImage;

          // Show preview, hide video
          video.style.display = "none";
          preview.style.display = "block";

          // Update buttons
          takePhotoBtn.style.display = "none";
          uploadBtn.style.display = "none";
          retakeBtn.style.display = "inline-block";
          confirmBtn.style.display = "inline-block";

          statusDiv.innerHTML =
            '<div style="color:#a8b2d6">Photo captured! Click "Verify This Photo" to confirm, or "Retake" for a new photo.</div>';
        });

        // Upload image (for testing)
        uploadBtn.addEventListener("click", () => {
          uploadInput.click();
        });

        uploadInput.addEventListener("change", (e) => {
          const file = e.target.files[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = (event) => {
            capturedImage = event.target.result;
            preview.src = capturedImage;

            // Show preview, hide video
            video.style.display = "none";
            preview.style.display = "block";

            // Update buttons
            takePhotoBtn.style.display = "none";
            uploadBtn.style.display = "none";
            retakeBtn.style.display = "inline-block";
            confirmBtn.style.display = "inline-block";

            statusDiv.innerHTML =
              '<div style="color:#a8b2d6">Image uploaded! Click "Verify This Photo" to confirm, or "Retake" to choose another.</div>';
          };
          reader.readAsDataURL(file);
        });

        // Retake photo
        retakeBtn.addEventListener("click", () => {
          capturedImage = null;
          preview.src = "";

          // Show video, hide preview
          video.style.display = "block";
          preview.style.display = "none";

          // Update buttons
          takePhotoBtn.style.display = "inline-block";
          uploadBtn.style.display = "inline-block";
          retakeBtn.style.display = "none";
          confirmBtn.style.display = "none";

          // Reset file input
          uploadInput.value = "";

          statusDiv.innerHTML =
            '<div style="color:#a8b2d6">Position the product front in view, then tap "Take Photo"</div>';
        });

        // Confirm and verify
        confirmBtn.addEventListener("click", async () => {
          if (!capturedImage) return;

          // Close modal and show verifying state
          closeModal();

          const status = verificationStatus.get(idx);
          status.verifying = true;
          status.verificationAborted = false;
          // Track this verification request with a unique ID
          const verificationId = Date.now();
          status.currentVerificationId = verificationId;
          renderBrandItems();

          try {
            // Call the verify-brand-image edge function
            const response = await fetch(
              `${window.SUPABASE_URL || "https://fgoiyycctnwnghrvsilt.supabase.co"}/functions/v1/verify-brand-image`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${window.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnb2l5eWNjdG53bmdocnZzaWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzAzMTkzNzAsImV4cCI6MjA0NTg5NTM3MH0.2cONT_HUQzaVWLeXG_Y0s9Qrl6HHTGY9brfJyBvbwzw"}`,
                },
                body: JSON.stringify({
                  originalImage: item.brandImage,
                  newImage: capturedImage,
                  brandName: item.brandName,
                }),
              },
            );

            const result = await response.json();

            // Check if this verification was cancelled or superseded by a new one
            const currentStatus = verificationStatus.get(idx);
            if (
              currentStatus.verificationAborted ||
              currentStatus.currentVerificationId !== verificationId
            ) {
              console.log(
                "Verification cancelled or superseded, ignoring result",
              );
              return;
            }

            if (result.isMatch) {
              currentStatus.verified = true;
              currentStatus.verifying = false;
              currentStatus.verificationError = null;
              currentStatus.verificationPhoto = capturedImage; // Store the photo used for verification
              if (result.confidence === "low") {
                // Verified but with low confidence - add a note
                currentStatus.verificationNote =
                  result.reason || "Verified with low confidence";
              }
            } else {
              currentStatus.verifying = false;
              currentStatus.verificationError =
                result.reason ||
                "Product does not match the original photo. Please ensure you are verifying the correct item.";
            }
          } catch (err) {
            console.error("Verification error:", err);
            // Check if cancelled before showing error
            const currentStatus = verificationStatus.get(idx);
            if (
              currentStatus.verificationAborted ||
              currentStatus.currentVerificationId !== verificationId
            ) {
              return;
            }
            currentStatus.verifying = false;
            currentStatus.verificationError =
              "Failed to verify product. Please try again.";
          }

          renderBrandItems();
        });

        cancelBtn.addEventListener("click", closeModal);
      }

      // Barcode scanning flow - for items without original images
      async function scanBrandBarcode(idx, item) {
        currentScanningIdx = idx;
        renderBrandItems();

        const statusDiv = document.getElementById(`scanStatus_${idx}`);
        if (statusDiv) {
          statusDiv.innerHTML =
            '<div style="color:#a8b2d6">Opening barcode scanner...</div>';
        }

        // Open barcode scanner
        const scannerModal = document.createElement("div");
        scannerModal.id = "brandVerificationScannerModal";
        scannerModal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.95);
      z-index: 10001;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 20px;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
      overscroll-behavior: contain;
    `;

        scannerModal.innerHTML = `
      <div style="width:100%;max-width:600px;display:flex;flex-direction:column;gap:16px">
        <div style="text-align:center">
          <h3 style="margin:0 0 8px 0;font-size:1.4rem;color:#fff">Scan Barcode</h3>
          <div style="margin:0;color:#a8b2d6;font-size:0.95rem">
            Brand: <strong style="color:#fff">${esc(item.brandName)}</strong><br>
            Ingredient: <strong style="color:#fff">${esc(item.ingredientName)}</strong>
          </div>
        </div>
        <video id="brandScannerVideo" style="width:100%;max-width:500px;border-radius:8px;background:#000" autoplay playsinline></video>
        <div id="brandScannerStatus" style="text-align:center;color:#a8b2d6;padding:12px;background:rgba(76,90,212,0.2);border-radius:6px">
          Point your camera at the barcode...
        </div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button class="btn" id="brandScannerCancelBtn">Cancel</button>
        </div>
      </div>
    `;

        document.body.appendChild(scannerModal);
        const video = scannerModal.querySelector("#brandScannerVideo");
        const statusDiv2 = scannerModal.querySelector("#brandScannerStatus");
        let codeReader = null;
        let scanning = false;

        const stopScanning = () => {
          if (codeReader) {
            codeReader.reset();
            codeReader = null;
          }
          scanning = false;
          if (video.srcObject) {
            video.srcObject.getTracks().forEach((track) => track.stop());
            video.srcObject = null;
          }
        };

        const closeScanner = () => {
          stopScanning();
          if (scannerModal.parentNode) {
            scannerModal.parentNode.removeChild(scannerModal);
          }
          currentScanningIdx = null;
          renderBrandItems();
        };

        const handleBarcodeScanned = async (scannedBarcode) => {
          // Close camera immediately
          closeScanner();

          // Show loading state in the brand card
          const status = verificationStatus.get(idx);
          status.verifying = true;
          renderBrandItems();

          // Just verify the barcode number matches - no API call needed
          // This should be instant (just string comparison)
          const scannedBarcodeClean = scannedBarcode.trim().replace(/\s+/g, "");
          const storedBarcodeClean = (item.barcode || "")
            .trim()
            .replace(/\s+/g, "");

          // Small delay just for visual feedback (verification is instant)
          await new Promise((resolve) => setTimeout(resolve, 100));

          if (!storedBarcodeClean) {
            // No stored barcode to compare - can't verify
            status.verifying = false;
            status.verificationError = `No barcode stored for this item. Please add a barcode to this brand item first before verifying.`;
            renderBrandItems();
          } else if (scannedBarcodeClean === storedBarcodeClean) {
            // Barcode matches - verify instantly
            status.verified = true;
            status.scannedBarcode = scannedBarcode;
            status.verifying = false;
            status.verificationError = null;
            renderBrandItems();
          } else {
            // Barcode doesn't match
            status.verifying = false;
            status.verificationError = "Incorrect barcode";
            renderBrandItems();
          }
        };

        // Initialize barcode scanner
        if (typeof ZXing !== "undefined") {
          codeReader = new ZXing.BrowserMultiFormatReader();
          scanning = true;

          navigator.mediaDevices
            .getUserMedia({ video: { facingMode: "environment" } })
            .then((stream) => {
              video.srcObject = stream;
              codeReader.decodeFromVideoDevice(null, video.id, (result, err) => {
                if (result) {
                  handleBarcodeScanned(result.text);
                } else if (err && !(err instanceof ZXing.NotFoundException)) {
                  console.error("Barcode scan error:", err);
                }
              });
            })
            .catch((err) => {
              console.error("Camera access error:", err);
              if (statusDiv2) {
                statusDiv2.innerHTML =
                  '<div style="color:#ef4444">Camera access denied. Please allow camera access to scan barcodes.</div>';
              }
            });
        } else {
          if (statusDiv2) {
            statusDiv2.innerHTML =
              '<div style="color:#ef4444">Barcode scanner library not loaded. Please refresh the page.</div>';
          }
        }

        scannerModal
          .querySelector("#brandScannerCancelBtn")
          .addEventListener("click", closeScanner);
      }

      async function handleReplaceBrand(idx) {
        const item = brandItems[idx];
        // Replace for all dishes using this item
        await replaceBrandItem(
          idx,
          item.dishes.map((d) => d.overlayIdx),
        );
      }

      // Route to AI assistant for each dish that uses this brand item
      async function routeToAiAssistantForDishes(idx, item) {
        const dishes = item.dishes;
        if (dishes.length === 0) return;

        // Close brand verification modal
        const mb = document.getElementById("modalBack");
        if (mb) mb.style.display = "none";

        // Process dishes one by one
        for (let i = 0; i < dishes.length; i++) {
          const dish = dishes[i];

          // Open AI assistant for this dish with the ingredient pre-filled
          await openAiAssistantForDishReplacement(
            dish,
            item,
            i + 1,
            dishes.length,
          );
        }
      }

      // Open AI assistant for a specific dish to replace a brand item
      async function openAiAssistantForDishReplacement(
        dish,
        brandItem,
        dishNumber,
        totalDishes,
      ) {
        return new Promise((resolve) => {
          // Get the overlay for this dish
          const overlay = overlays[dish.overlayIdx];
          if (!overlay) {
            resolve();
            return;
          }

          // Extract ingredient name from the brand item
          const ingredientName = brandItem.ingredientName;

          // Get dish name from overlay (overlay.id or overlay.name)
          const actualDishName =
            overlay.id || overlay.name || dish.dishName || "Unnamed Dish";

          // Get existing ingredients from the overlay to populate the assistant
          let existingIngredients = getOverlayIngredients(overlay);

          // Remove the brand item from the ingredient before opening AI assistant
          existingIngredients.forEach((ing) => {
            if (ing.name === ingredientName && Array.isArray(ing.brands)) {
              // Find and remove the brand that matches
              const brandIdx = ing.brands.findIndex(
                (b) =>
                  b.name === brandItem.brandName &&
                  (b.barcode || "") === (brandItem.barcode || ""),
              );
              if (brandIdx !== -1) {
                ing.brands.splice(brandIdx, 1);
                console.log(
                  `Removed brand "${brandItem.brandName}" from ingredient "${ingredientName}"`,
                );
              }
            }
          });

          // Update the overlay with the modified ingredients
          existingIngredients = setOverlayIngredients(
            overlay,
            existingIngredients,
          );
          rs.overlays = overlays;
          setDirty(true);
          drawAll();

          console.log("Opening AI assistant for replacement:", {
            dishName: actualDishName,
            ingredientName: ingredientName,
            brandToReplace: brandItem.brandName,
            existingIngredientsCount: existingIngredients.length,
          });

          // Open AI assistant with context pointing to this dish and ingredient
          const context = {
            type: "dish",
            overlayIdx: dish.overlayIdx,
            dishName: actualDishName,
            ingredientName: ingredientName,
            brandToReplace: brandItem.brandName,
            replacementFlow: true,
            dishNumber: dishNumber,
            totalDishes: totalDishes,
            existingIngredients: existingIngredients,
            getCurrentName: () => actualDishName,
          };

          // Open the AI assistant
          openAiAssistant(context);

          // After the table renders, scroll to the ingredient row
          // Wait a bit longer to ensure table is fully rendered
          const scrollToIngredient = () => {
            const aiAssistTableBody = getAiAssistTableBody();
            if (
              aiAssistTableBody &&
              aiAssistTableBody.querySelectorAll("tr[data-index]").length > 0
            ) {
              scrollToIngredientRow(ingredientName);
            } else {
              // Table not rendered yet, try again
              setTimeout(scrollToIngredient, 200);
            }
          };
          setTimeout(scrollToIngredient, 500);

          // Wait for user to complete the replacement or close the assistant
          // We'll resolve when the assistant is closed or when a replacement is confirmed
          const checkComplete = () => {
            const aiBackdrop = document.getElementById("aiAssistBackdrop");
            if (!aiBackdrop || !aiBackdrop.classList.contains("show")) {
              // Assistant closed
              resolve();
            } else {
              // Check again in a bit
              setTimeout(checkComplete, 500);
            }
          };

          // Start checking for completion
          setTimeout(checkComplete, 1000);
        });
      }

      // Scroll to the ingredient row in the AI assistant table
      function scrollToIngredientRow(ingredientName) {
        const aiAssistTableBody = getAiAssistTableBody();
        if (!aiAssistTableBody) return;

        // Find the row with matching ingredient name
        const rows = aiAssistTableBody.querySelectorAll("tr[data-index]");
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const nameInput = row.querySelector(".aiIngredientName");
          if (
            nameInput &&
            nameInput.value.toLowerCase().trim() ===
              ingredientName.toLowerCase().trim()
          ) {
            // Found the row - scroll to it
            row.scrollIntoView({ behavior: "smooth", block: "center" });

            // Highlight the row briefly
            row.style.transition = "background-color 0.3s";
            row.style.backgroundColor = "rgba(76,90,212,0.2)";
            setTimeout(() => {
              row.style.backgroundColor = "";
              setTimeout(() => {
                row.style.transition = "";
              }, 300);
            }, 2000);

            console.log(`Scrolled to ingredient row: ${ingredientName}`);
            break;
          }
        }
      }

      // Show replacement modal for a single dish
      async function showReplacementModalForDish(
        brandIdx,
        brandItem,
        dish,
        dishNumber,
        totalDishes,
      ) {
        return new Promise((resolve) => {
          const modal = document.createElement("div");
          modal.id = `dishReplacementModal_${dish.overlayIdx}`;
          modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.95);
        z-index: 10001;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        padding: 20px;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-y;
        overscroll-behavior: contain;
      `;

          modal.innerHTML = `
        <div style="width:100%;max-width:600px;display:flex;flex-direction:column;gap:16px">
          <div style="text-align:center">
            <h3 style="margin:0 0 8px 0;font-size:1.4rem;color:#fff">Replace Brand Item</h3>
            <div style="margin:0;color:#a8b2d6;font-size:0.95rem">
              Dish: <strong style="color:#fff">${esc(dish.dishName)}</strong><br>
              Ingredient: <strong style="color:#fff">${esc(brandItem.ingredientName)}</strong><br>
              Removing: <strong style="color:#fff">${esc(brandItem.brandName)}</strong><br>
              <span style="color:#6b7ce6;font-size:0.9rem">(${dishNumber} of ${totalDishes})</span>
            </div>
          </div>
          <div style="position:relative;background:#000;border-radius:12px;overflow:hidden;margin:16px 0">
            <video id="dishReplacementVideo_${dish.overlayIdx}" style="width:100%;max-width:500px;border-radius:8px;background:#000;display:none" autoplay playsinline></video>
            <img id="dishReplacementPreview_${dish.overlayIdx}" style="width:100%;max-width:500px;border-radius:8px;display:none;object-fit:contain" alt="Preview">
            <div id="dishReplacementPlaceholder_${dish.overlayIdx}" style="width:100%;min-height:300px;display:flex;align-items:center;justify-content:center;background:#1a1a1a;color:#a8b2d6;font-size:1.1rem;border-radius:8px">
              Scan barcode of replacement item
            </div>
          </div>
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
            <button class="btn btnPrimary" id="dishReplacementCameraBtn_${dish.overlayIdx}" style="padding:12px 24px;font-size:0.95rem">📷 Scan Barcode</button>
            <button class="btn btnPrimary" id="dishReplacementUploadBtn_${dish.overlayIdx}" style="padding:12px 24px;font-size:0.95rem">📁 Upload Image</button>
            ${
              totalDishes > 1 && dishNumber < totalDishes
                ? `
              <button class="btn" id="dishReplacementSkipBtn_${dish.overlayIdx}" style="padding:12px 24px;font-size:0.95rem">Skip this dish</button>
            `
                : ""
            }
            <button class="btn" id="dishReplacementCancelBtn_${dish.overlayIdx}" style="padding:12px 24px;font-size:0.95rem">Cancel</button>
          </div>
          <input type="file" id="dishReplacementFileInput_${dish.overlayIdx}" accept="image/*" style="display:none">
        </div>
      `;

          document.body.appendChild(modal);

          const video = modal.querySelector(
            `#dishReplacementVideo_${dish.overlayIdx}`,
          );
          const preview = modal.querySelector(
            `#dishReplacementPreview_${dish.overlayIdx}`,
          );
          const placeholder = modal.querySelector(
            `#dishReplacementPlaceholder_${dish.overlayIdx}`,
          );
          const cameraBtn = modal.querySelector(
            `#dishReplacementCameraBtn_${dish.overlayIdx}`,
          );
          const uploadBtn = modal.querySelector(
            `#dishReplacementUploadBtn_${dish.overlayIdx}`,
          );
          const skipBtn = modal.querySelector(
            `#dishReplacementSkipBtn_${dish.overlayIdx}`,
          );
          const cancelBtn = modal.querySelector(
            `#dishReplacementCancelBtn_${dish.overlayIdx}`,
          );
          const fileInput = modal.querySelector(
            `#dishReplacementFileInput_${dish.overlayIdx}`,
          );

          let codeReader = null;
          let scanning = false;

          const stopScanning = () => {
            if (codeReader) {
              codeReader.reset();
              codeReader = null;
            }
            scanning = false;
            if (video.srcObject) {
              video.srcObject.getTracks().forEach((track) => track.stop());
              video.srcObject = null;
            }
          };

          const closeModal = () => {
            stopScanning();
            if (modal.parentNode) {
              modal.parentNode.removeChild(modal);
            }
          };

          // Handle barcode scan result
          const handleBarcodeScanned = async (scannedBarcode) => {
            stopScanning();
            closeModal();

            try {
              const result = await fetchProductByBarcode(scannedBarcode);

              if (result && result.success && result.ingredientList) {
                // Use brand from API response (extracted from barcode database, not product name)
                const brand = result.brand || "";
                const productName =
                  result.productName ||
                  result.product?.name ||
                  result.product?.product_name ||
                  "Unknown Product";

                const productImage =
                  result.productImage ||
                  result.product?.image_url ||
                  result.product?.image ||
                  (result.sources &&
                    result.sources.length > 0 &&
                    result.sources[0].productImage) ||
                  "";

                const suggestion = {
                  name: productName,
                  brand: brand,
                  barcode: scannedBarcode,
                  brandImage: productImage,
                  ingredientsImage: "",
                  ingredientsList: [result.ingredientList],
                };

                // Show sources modal, then apply replacement
                await showReplacementSourcesForDish(
                  brandIdx,
                  brandItem,
                  dish,
                  suggestion,
                  result,
                );

                resolve(true);
              } else if (result && result.needsPhoto) {
                alert(`Barcode not found. Please scan again or use a photo.`);
                resolve(false); // Let user retry
              } else {
                alert(
                  `Product not found for barcode: ${scannedBarcode}. Please try again.`,
                );
                resolve(false); // Let user retry
              }
            } catch (error) {
              console.error("Replacement scan error:", error);
              alert(
                `Error scanning barcode: ${error.message || "Unknown error"}. Please try again.`,
              );
              resolve(false); // Let user retry
            }
          };

          // Camera button - start barcode scanner
          cameraBtn.addEventListener("click", async () => {
            if (scanning) return;

            try {
              const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" },
              });

              video.srcObject = stream;
              video.style.display = "block";
              placeholder.style.display = "none";

              if (!window.ZXing) {
                alert(
                  "Barcode scanner library not loaded. Please refresh the page.",
                );
                return;
              }

              codeReader = new window.ZXing.BrowserMultiFormatReader();
              scanning = true;

              codeReader.decodeFromVideoDevice(null, video, (result, err) => {
                if (result) {
                  handleBarcodeScanned(result.getText());
                } else if (
                  err &&
                  !(err instanceof window.ZXing.NotFoundException)
                ) {
                  console.error("Scan error:", err);
                }
              });
            } catch (error) {
              console.error("Camera error:", error);
              alert("Could not access camera. Please check permissions.");
            }
          });

          // Upload button triggers file input
          if (uploadBtn) {
            uploadBtn.addEventListener("click", () => {
              fileInput.click();
            });
          }

          // File upload
          fileInput.addEventListener("change", async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
              const imageData = event.target.result;

              try {
                if (!window.ZXing) {
                  alert("Barcode scanner library not loaded.");
                  return;
                }

                const codeReader = new window.ZXing.BrowserMultiFormatReader();
                const result = await codeReader.decodeFromImageDataUrl(imageData);

                if (result) {
                  await handleBarcodeScanned(result.getText());
                } else {
                  alert("Could not read barcode from image. Please try again.");
                }
              } catch (err) {
                console.error("Barcode decode error:", err);
                alert(`Barcode decode error: ${err.message}. Please try again.`);
              }
            };
            reader.readAsDataURL(file);
          });

          // Skip button
          if (skipBtn) {
            skipBtn.addEventListener("click", () => {
              closeModal();
              resolve(true); // Skip this dish, continue to next
            });
          }

          // Cancel button
          cancelBtn.addEventListener("click", () => {
            closeModal();
            resolve(false); // Cancel entire flow
          });
        });
      }

      // Show sources modal for dish replacement, then apply
      async function showReplacementSourcesForDish(
        brandIdx,
        oldItem,
        dish,
        suggestion,
        barcodeResult,
      ) {
        return new Promise((resolve) => {
          // Use the existing showReplacementBarcodeSourcesModal but with a custom handler
          const sources = barcodeResult.sources || [];
          const productName = barcodeResult.productName || suggestion.name;
          let ingredientList = barcodeResult.ingredientList || "";
          const consistencyInfo = barcodeResult.consistencyInfo || {};

          if (
            consistencyInfo.differentSources &&
            consistencyInfo.differentSources > 1 &&
            consistencyInfo.matchingSources >= 1 &&
            consistencyInfo.matchingSources < consistencyInfo.totalSources
          ) {
            const consensusDiff = consistencyInfo.differences?.find(
              (d) => d.groupSize === consistencyInfo.matchingSources,
            );
            if (consensusDiff) {
              ingredientList = consensusDiff.ingredientsText;
            }
          }

          const modal = document.createElement("div");
          modal.id = `dishReplacementSourcesModal_${dish.overlayIdx}`;
          modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10010;
        padding: 20px;
      `;

          const modalContent = document.createElement("div");
          modalContent.style.cssText = `
        background: #0c102a;
        border: 2px solid #4c5ad4;
        border-radius: 16px;
        max-width: 900px;
        max-height: 85vh;
        overflow-y: auto;
        padding: 24px;
        color: #fff;
        width: 100%;
      `;

          // Build sources HTML using grouped display
          const sourcesHtml = renderGroupedSourcesHtml(sources, {
            ingredientNames: barcodeResult.ingredientNames || null,
          });

          modalContent.innerHTML = `
        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 8px 0; color: #4c5ad4; font-size: 1.4rem;">✓ Product Found!</h3>
          <p style="margin: 0; font-size: 1.1rem; color: #fff; font-weight: 600;">${esc(productName)}</p>
          ${suggestion.brand ? `<p style="margin: 4px 0 0 0; color: #a0a0a0; font-size: 0.9rem;">Brand: ${esc(suggestion.brand)}</p>` : ""}
          <p style="margin: 4px 0 0 0; color: #a0a0a0; font-size: 0.9rem;">Dish: ${esc(dish.dishName)}</p>
          <p style="margin: 4px 0 0 0; color: #a0a0a0; font-size: 0.9rem;">Replacing: ${esc(oldItem.brandName)} → ${esc(suggestion.brand || "New Brand")}</p>
        </div>
        ${
          consistencyInfo.totalSources
            ? `
          <div style="background: rgba(76,212,90,0.15); border: 1px solid rgba(76,212,90,0.4); border-radius: 8px; padding: 12px; margin-bottom: 20px;">
            <div style="font-weight: 600; color: #4caf50; margin-bottom: 4px;">
              Verification: ${consistencyInfo.matchingSources || 0} out of ${consistencyInfo.totalSources || 0} sources agree
            </div>
          </div>
        `
            : ""
        }
        <div style="margin-bottom: 20px;">
          <div style="font-weight: 600; color: #4c5ad4; font-size: 1.05rem; margin-bottom: 12px;">Consolidated Ingredient List:</div>
          <div style="background: rgba(76,90,212,0.1); border: 1px solid rgba(76,90,212,0.3); border-radius: 8px; padding: 16px; font-size: 0.95rem; line-height: 1.6; color: #e0e0e0; white-space: pre-wrap; word-wrap: break-word;">
            ${esc(ingredientList)}
            <button type="button" class="confirmDishReplacementBtn" style="padding: 8px 16px; margin-top: 12px; background: #4c5ad4; border: none; border-radius: 6px; color: #fff; font-weight: 600; cursor: pointer; font-size: 0.85rem;">
              Confirm and apply this ingredient list
            </button>
          </div>
        </div>
        <div style="margin-bottom: 24px;">
          <div style="font-weight: 600; color: #4c5ad4; font-size: 1.05rem; margin-bottom: 12px;">Sources Verified (${sources.length} total):</div>
          <p style="font-size: 0.85rem; color: #999; margin-bottom: 12px; font-style: italic;">
            ⚠️ Note: URLs are provided for reference. Some links may be outdated or inaccessible due to website changes.
          </p>
          ${sourcesHtml}
        </div>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button type="button" class="cancelDishReplacementBtn" style="padding: 14px 24px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #fff; font-weight: 600; cursor: pointer;">
            Cancel
          </button>
        </div>
      `;

          modal.appendChild(modalContent);
          document.body.appendChild(modal);

          const confirmBtn = modalContent.querySelector(
            ".confirmDishReplacementBtn",
          );
          const cancelBtn = modalContent.querySelector(
            ".cancelDishReplacementBtn",
          );

          confirmBtn.addEventListener("click", async () => {
            document.body.removeChild(modal);

            // Analyze allergens/diets
            try {
              const analysisResult = await window.supabaseClient.functions.invoke(
                "analyze-brand-allergens",
                {
                  body: {
                    ingredientText: ingredientList,
                    productName: productName,
                    labels: [],
                    categories: [],
                    analysisMode: "list",
                  },
                },
              );

              const allergens = analysisResult.data?.allergens || [];
              const diets = analysisResult.data?.diets || [];

              // Apply replacement to this dish
              applyReplacementToDish(
                brandIdx,
                oldItem,
                dish,
                suggestion,
                ingredientList,
                allergens,
                diets,
              );

              resolve(true);
            } catch (error) {
              console.error("Error analyzing allergens:", error);
              // Still apply replacement even if analysis fails
              applyReplacementToDish(
                brandIdx,
                oldItem,
                dish,
                suggestion,
                ingredientList,
                [],
                [],
              );
              resolve(true);
            }
          });

          cancelBtn.addEventListener("click", () => {
            document.body.removeChild(modal);
            resolve(false);
          });
        });
      }

      // Apply replacement to a specific dish
      function applyReplacementToDish(
        brandIdx,
        oldItem,
        dish,
        suggestion,
        ingredientList,
        allergens,
        diets,
      ) {
        const overlay = overlays[dish.overlayIdx];
        if (!overlay) return;

        let ingredients = getOverlayIngredients(overlay);

        // Find the ingredient and replace the brand
        ingredients.forEach((ing) => {
          if (ing.name === oldItem.ingredientName && Array.isArray(ing.brands)) {
            // Remove old brand
            const brandIdx = ing.brands.findIndex(
              (b) =>
                b.name === oldItem.brandName &&
                (b.barcode || "") === (oldItem.barcode || ""),
            );
            if (brandIdx !== -1) {
              ing.brands.splice(brandIdx, 1);
            }

            // Add new brand
            const ingredientsList = Array.isArray(ingredientList)
              ? ingredientList
              : ingredientList
                ? [ingredientList]
                : [];
            const newBrand = ingredientNormalizer.sanitizeBrandEntry({
              name: suggestion.brand || suggestion.name,
              barcode: suggestion.barcode || "",
              brandImage: suggestion.brandImage || "",
              ingredientsImage: suggestion.ingredientsImage || "",
              ingredientsList,
              allergens,
              diets,
              crossContamination: [],
              crossContaminationDiets: [],
            });

            if (!ing.brands) {
              ing.brands = [];
            }
            ing.brands.push(newBrand);
          }
        });

        setOverlayIngredients(overlay, ingredients);
        rs.overlays = overlays;
        setDirty(true);
        drawAll();
      }

      function showDishSelectionForRemoval(idx, item) {
        // Update states to show dish selection
        showingRemoveOptions = null;
        showingDishSelection = idx;
        renderBrandItems();
      }

      function setupDishSelectionForCard(idx, item) {
        // Track which dishes are selected for removal
        const selectedDishes = new Set(item.dishes.map((d, i) => i)); // Start with all selected

        const card = body.querySelector(`.brandItemCard[data-idx="${idx}"]`);
        if (!card) return;

        const selectionList = card.querySelector(`#dishSelectionList_${idx}`);
        if (!selectionList) return;

        // Populate dish checkboxes
        selectionList.innerHTML = item.dishes
          .map(
            (dish, dishIdx) => `
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px;background:rgba(0,0,0,0.2);border-radius:4px">
        <input type="checkbox" class="dishSelectCheckbox" data-dish-idx="${dishIdx}" data-brand-idx="${idx}" ${selectedDishes.has(dishIdx) ? "checked" : ""} style="cursor:pointer">
        <span style="color:#a8b2d6;font-size:0.9rem">${esc(dish.dishName)}</span>
      </label>
    `,
          )
          .join("");

        // Attach checkbox handlers
        card.querySelectorAll(".dishSelectCheckbox").forEach((checkbox) => {
          checkbox.addEventListener("change", (e) => {
            const dishIdx = parseInt(e.target.dataset.dishIdx);
            if (e.target.checked) {
              selectedDishes.add(dishIdx);
            } else {
              selectedDishes.delete(dishIdx);
            }
          });
        });

        // Attach confirm button
        const confirmBtn = card.querySelector(".confirmRemoveBtn");
        if (confirmBtn) {
          confirmBtn.addEventListener("click", () => {
            if (selectedDishes.size === 0) {
              alert("Please select at least one dish to remove the item from.");
              return;
            }
            const dishesToUpdate = Array.from(selectedDishes).map(
              (i) => item.dishes[i].overlayIdx,
            );
            showingRemoveOptions = null;
            showingDishSelection = null;
            removeBrandItemFromDishes(idx, dishesToUpdate);
          });
        }

        // Attach cancel button
        const cancelBtn = card.querySelector(".cancelDishSelectionBtn");
        if (cancelBtn) {
          cancelBtn.addEventListener("click", () => {
            showingRemoveOptions = null;
            showingDishSelection = null;
            renderBrandItems();
          });
        }
      }

      async function replaceBrandItem(idx, overlayIndices) {
        const item = brandItems[idx];
        if (!item) return;

        const applyReplacement = async (
          oldItem,
          newBrandName,
          newBarcode,
          newIngredientList,
          newBrandImage,
          newIngredientsImage,
          overlayIndices,
          allergens = [],
          diets = [],
          crossContamination = [],
          crossContaminationDiets = [],
        ) => {
          const sanitizedBrand = ingredientNormalizer.sanitizeBrandEntry({
            name: newBrandName,
            barcode: newBarcode,
            brandImage: newBrandImage,
            ingredientsImage: newIngredientsImage,
            ingredientsList: newIngredientList ? [newIngredientList] : [],
            allergens,
            crossContamination,
            diets,
            crossContaminationDiets,
          });
          const normalizedAllergens = sanitizedBrand.allergens;
          const normalizedCrossContamination = sanitizedBrand.crossContamination;
          const normalizedDiets = sanitizedBrand.diets;
          const normalizedCrossContaminationDiets = sanitizedBrand.crossContaminationDiets;
          const newBrand = sanitizedBrand;

          const indicesToUpdate =
            overlayIndices || oldItem.dishes.map((d) => d.overlayIdx);
          indicesToUpdate.forEach((overlayIdx) => {
            const overlay = overlays[overlayIdx];
            if (!overlay) return;

            const ingredients = getOverlayIngredients(overlay);

            ingredients.forEach((ing) => {
              if (
                ing.name === oldItem.ingredientName &&
                Array.isArray(ing.brands)
              ) {
                const brandIdx = ing.brands.findIndex(
                  (b) => b.name === oldItem.brandName,
                );
                if (brandIdx !== -1) {
                  ing.brands[brandIdx] = newBrand;
                }
                ing.allergens = normalizedAllergens;
                ing.crossContamination = normalizedCrossContamination;
                ing.diets = normalizedDiets;
                ing.crossContaminationDiets = normalizedCrossContaminationDiets;
                ing.aiDetectedAllergens = normalizedAllergens;
                ing.aiDetectedCrossContamination = normalizedCrossContamination;
                ing.aiDetectedDiets = normalizedDiets;
                ing.aiDetectedCrossContaminationDiets = normalizedCrossContaminationDiets;
              }
            });

            setOverlayIngredients(overlay, ingredients);
          });

          rs.overlays = overlays;
          setDirty(true);
          drawAll();

          brandItems.splice(idx, 1);
          verificationStatus.delete(idx);
          const newStatus = new Map();
          brandItems.forEach((item, newIdx) => {
            const oldIdx = newIdx < idx ? newIdx : newIdx + 1;
            newStatus.set(
              newIdx,
              verificationStatus.get(oldIdx) || { verified: false },
            );
          });
          verificationStatus.clear();
          newStatus.forEach((v, k) => verificationStatus.set(k, v));

          currentScanningIdx = null;
          renderBrandItems();
        };

        const ingredientLabel = item.ingredientName || item.brandName;
        showIngredientPhotoUploadModal(-1, ingredientLabel, null, null, {
          inlineResults: true,
          skipRowUpdates: true,
          onApplyResults: async (payload) => {
            const newBrandName = payload.productName?.trim() || item.brandName;
            const ingredientList = payload.ingredientText || "";
            const brandImage = payload.brandImage || "";
            const ingredientsImage = payload.ingredientsImage || "";
            showReplacementLoadingInCard(idx);
            try {
              await applyReplacement(
                item,
                newBrandName,
                "",
                ingredientList,
                brandImage,
                ingredientsImage,
                overlayIndices,
                payload.allergens || [],
                payload.diets || [],
                payload.crossContamination || [],
                payload.crossContaminationDiets || [],
              );
            } catch (err) {
              console.error("Replacement error:", err);
              alert("Failed to replace the item. Please try again.");
            } finally {
              hideReplacementLoadingInCard(idx);
            }
          },
        });
      }

      function removeBrandItemFromDishes(idx, overlayIndices) {
        const item = brandItems[idx];

        // Remove the brand from specified dishes
        overlayIndices.forEach((overlayIdx) => {
          const overlay = overlays[overlayIdx];
          if (!overlay) return;

          const ingredients = getOverlayIngredients(overlay);

          // Find and remove the brand
          ingredients.forEach((ing) => {
            if (ing.name === item.ingredientName && Array.isArray(ing.brands)) {
              const brandIdx = ing.brands.findIndex(
                (b) =>
                  b.name === item.brandName &&
                  (b.barcode || "") === (item.barcode || ""),
              );
              if (brandIdx !== -1) {
                ing.brands.splice(brandIdx, 1);
              }
            }
          });

          setOverlayIngredients(overlay, ingredients);
        });

        // Update the restaurant overlays
        rs.overlays = overlays;
        setDirty(true);
        drawAll();

        // Remove from brand items list
        brandItems.splice(idx, 1);
        verificationStatus.delete(idx);
        // Re-index remaining items (all items after idx shift down by 1)
        const newStatus = new Map();
        brandItems.forEach((item, newIdx) => {
          const oldIdx = newIdx < idx ? newIdx : newIdx + 1;
          newStatus.set(
            newIdx,
            verificationStatus.get(oldIdx) || { verified: false },
          );
        });
        verificationStatus.clear();
        newStatus.forEach((v, k) => verificationStatus.set(k, v));

        renderBrandItems();
      }

      function finalizeBrandVerification() {
        // Collect all brand verification photos
        const brandVerificationPhotos = [];
        verificationStatus.forEach((status, idx) => {
          if (status.verified && status.verificationPhoto) {
            brandVerificationPhotos.push(status.verificationPhoto);
          }
        });
        // Final confirmation - show photo capture with brand photos
        mb.style.display = "none";
        openPhotoCapture(brandVerificationPhotos);
      }

      renderBrandItems();
      mb.style.display = "flex";
      configureModalClose({
        visible: true,
        onClick: () => {
          mb.style.display = "none";
        },
      });
    }

    // Show loading state in brand item card during replacement lookup
    function showReplacementLoadingInCard(idx) {
      const card = document.querySelector(`.brandItemCard[data-idx="${idx}"]`);
      if (!card) return;

      // Remove any existing loading area
      const existingLoading = card.querySelector(".replacementLoadingArea");
      if (existingLoading) existingLoading.remove();

      const loadingArea = document.createElement("div");
      loadingArea.className = "replacementLoadingArea";
      loadingArea.style.cssText = `
    margin-top: 12px;
    margin-bottom: 50px;
    padding: 12px 16px;
    background: rgba(76,90,212,0.1);
    border-radius: 8px;
    border: 1px solid rgba(76,90,212,0.3);
  `;

      loadingArea.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="flex:1;background:rgba(76,90,212,0.2);border-radius:4px;height:6px;overflow:hidden">
          <div class="replacementLoadingBarFill" data-idx="${idx}" style="background:#4c5ad4;height:100%;width:0%;transition:width 0.5s ease-out"></div>
        </div>
        <span style="font-size:0.9rem;color:#6b7ce6;white-space:nowrap">Looking up replacement...</span>
      </div>
    </div>
  `;

      card.appendChild(loadingArea);

      // Animate loading bar
      const fillBar = loadingArea.querySelector(".replacementLoadingBarFill");
      if (fillBar) {
        const startTime = Date.now();
        const estimatedDuration = 45000;

        const updateProgress = () => {
          const elapsed = Date.now() - startTime;
          let progress = Math.min(95, (elapsed / estimatedDuration) * 95);

          if (elapsed < 2000) {
            progress = Math.min(progress, 10);
          } else if (elapsed < 10000) {
            progress = Math.min(progress, 10 + ((elapsed - 2000) / 8000) * 30);
          } else if (elapsed < 25000) {
            progress = Math.min(progress, 40 + ((elapsed - 10000) / 15000) * 30);
          } else if (elapsed < 40000) {
            progress = Math.min(progress, 70 + ((elapsed - 25000) / 15000) * 20);
          } else {
            progress = Math.min(progress, 90 + ((elapsed - 40000) / 5000) * 5);
          }

          fillBar.style.width = `${progress}%`;

          if (progress < 95 && fillBar.parentElement) {
            setTimeout(updateProgress, 500);
          } else {
            fillBar.style.width = "95%";
          }
        };

        setTimeout(updateProgress, 100);
      }
    }

    // Hide loading state in brand item card
    function hideReplacementLoadingInCard(idx) {
      const card = document.querySelector(`.brandItemCard[data-idx="${idx}"]`);
      if (!card) return;

      const loadingArea = card.querySelector(".replacementLoadingArea");
      if (loadingArea) {
        const fillBar = loadingArea.querySelector(".replacementLoadingBarFill");
        if (fillBar) fillBar.style.width = "100%";
        setTimeout(() => {
          if (loadingArea.parentNode) {
            loadingArea.remove();
          }
        }, 300);
      }
    }

    // Show barcode sources modal for replacement (based on showBarcodeSourcesModal)
    function showReplacementBarcodeSourcesModal(
      idx,
      oldItem,
      suggestion,
      barcodeResult,
    ) {
      const sources = barcodeResult.sources || [];
      const productName = barcodeResult.productName || suggestion.name;
      let ingredientList = barcodeResult.ingredientList || "";
      const consistencyInfo = barcodeResult.consistencyInfo || {};

      // If there's a conflict where all are different except one, use the consensus list
      const hasConflict =
        consistencyInfo.differentSources &&
        consistencyInfo.differentSources > 1 &&
        consistencyInfo.matchingSources >= 1 &&
        consistencyInfo.matchingSources < consistencyInfo.totalSources;

      if (hasConflict && consistencyInfo.differences) {
        const consensusDiff = consistencyInfo.differences.find(
          (d) => d.groupSize === consistencyInfo.matchingSources,
        );
        if (consensusDiff) {
          ingredientList = consensusDiff.ingredientsText;
          suggestion.ingredientsList = [consensusDiff.ingredientsText];
        }
      }

      const modal = document.createElement("div");
      modal.id = "replacementBarcodeSourcesModal";
      modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10010;
    padding: 20px;
  `;

      const modalContent = document.createElement("div");
      modalContent.style.cssText = `
    background: #0c102a;
    border: 2px solid #4c5ad4;
    border-radius: 16px;
    max-width: 900px;
    max-height: 85vh;
    overflow-y: auto;
    padding: 24px;
    color: #fff;
    width: 100%;
  `;

      // Build sources HTML using grouped display
      const sourcesHtml = renderGroupedSourcesHtml(sources, {
        ingredientNames: barcodeResult.ingredientNames || null,
      });

      modalContent.innerHTML = `
    <div style="margin-bottom: 20px;">
      <h3 style="margin: 0 0 8px 0; color: #4c5ad4; font-size: 1.4rem;">✓ Product Found!</h3>
      <p style="margin: 0; font-size: 1.1rem; color: #fff; font-weight: 600;">${esc(productName)}</p>
      ${suggestion.brand ? `<p style="margin: 4px 0 0 0; color: #a0a0a0; font-size: 0.9rem;">Brand: ${esc(suggestion.brand)}</p>` : ""}
      <p style="margin: 4px 0 0 0; color: #a0a0a0; font-size: 0.9rem;">Replacing: ${esc(oldItem.brandName)} → ${esc(suggestion.brand || "New Brand")}</p>
    </div>

    <div style="margin-bottom: 24px;">
      <p style="font-size: 0.85rem; color: #999; margin-bottom: 12px; font-style: italic;">
        ⚠️ Note: URLs are provided for reference. Some links may be outdated or inaccessible due to website changes.
      </p>
      ${sourcesHtml}
    </div>

    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button type="button" class="cancelReplacementSourcesBtn" style="
        padding: 14px 24px;
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 8px;
        color: #fff;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      ">Cancel</button>
    </div>
  `;

      modal.appendChild(modalContent);
      document.body.appendChild(modal);

      const cancelBtn = modalContent.querySelector(
        ".cancelReplacementSourcesBtn",
      );
      const confirmBtn = modalContent.querySelector(
        ".confirmReplacementIngredientListBtn",
      );
      const confirmConsensusBtn = modalContent.querySelector(
        ".confirmReplacementConsensusBtn",
      );
      const confirmVariationBtns = modalContent.querySelectorAll(
        ".confirmReplacementVariationBtn",
      );
      const confirmGroupBtns = modalContent.querySelectorAll(
        ".confirmGroupIngredientListBtn",
      );

      cancelBtn.addEventListener("click", () => {
        if (modal.parentNode) {
          document.body.removeChild(modal);
        }
        renderBrandItems();
      });

      const handleConfirm = async (finalIngredientList) => {
        if (modal.parentNode) {
          document.body.removeChild(modal);
        }

        // Proceed with allergen/diet preview for replacement
        await showReplacementPreview(
          oldItem,
          suggestion.brand || "",
          suggestion.barcode || "",
          finalIngredientList,
          suggestion.brandImage || "",
          productName,
        );
      };

      // Handle grouped ingredient list confirmation buttons
      confirmGroupBtns.forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.style.background = "#4caf50";
          btn.innerHTML = "✓ Confirmed";
          btn.style.cursor = "default";

          const groupDiv = btn.closest("[data-ingredients-text]");
          const groupIngredientList = groupDiv
            ? groupDiv.dataset.ingredientsText
            : ingredientList || "";
          await handleConfirm(groupIngredientList);
        });
      });

      // Handle consensus confirmation
      if (confirmConsensusBtn) {
        confirmConsensusBtn.addEventListener("click", async () => {
          const consensusDiff = consistencyInfo.differences?.find(
            (d) => d.groupSize === consistencyInfo.matchingSources,
          );
          if (consensusDiff) {
            await handleConfirm(consensusDiff.ingredientsText);
          }
        });
      }

      // Handle variation confirmation buttons
      confirmVariationBtns.forEach((btn) => {
        btn.addEventListener("click", async () => {
          const variationIngredientList = btn.dataset.ingredients || "";
          await handleConfirm(variationIngredientList);
        });
      });

      // Handle consolidated list confirmation (if it exists - removed the section but keeping handler for safety)
      if (confirmBtn) {
        confirmBtn.addEventListener("click", async () => {
          await handleConfirm(ingredientList);
        });
      }
    }

    // Show sources modal for replacement (exact copy of showBarcodeSourcesModal but for replacement) - DEPRECATED, use showReplacementBarcodeSourcesModal
    function showReplacementSourcesModal(idx, oldItem, replacementData) {
      const { brandName, barcode, brandImage, result } = replacementData;
      const sources = result.sources || [];
      const productName =
        result.productName ||
        result.product?.name ||
        result.product?.product_name ||
        "Unknown Product";
      let ingredientList = result.ingredientList || "";
      const consistencyInfo = result.consistencyInfo || {};

      console.log("showReplacementSourcesModal called with:", {
        idx,
        oldItem,
        replacementData,
        sourcesCount: sources.length,
        productName,
        ingredientList: ingredientList.substring(0, 50) + "...",
        consistencyInfo,
      });

      // If there's a conflict where all are different except one, use the consensus list
      const hasConflict =
        consistencyInfo.differentSources &&
        consistencyInfo.differentSources > 1 &&
        consistencyInfo.matchingSources >= 1 &&
        consistencyInfo.matchingSources < consistencyInfo.totalSources;

      if (hasConflict && consistencyInfo.differences) {
        const consensusDiff = consistencyInfo.differences.find(
          (d) => d.groupSize === consistencyInfo.matchingSources,
        );
        if (consensusDiff) {
          ingredientList = consensusDiff.ingredientsText;
        }
      }

      const modal = document.createElement("div");
      modal.id = "replacementSourcesModal";
      modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10010;
    padding: 20px;
  `;

      const modalContent = document.createElement("div");
      modalContent.style.cssText = `
    background: #0c102a;
    border: 2px solid #4c5ad4;
    border-radius: 16px;
    max-width: 900px;
    max-height: 85vh;
    overflow-y: auto;
    padding: 24px;
    color: #fff;
    width: 100%;
  `;

      // Build sources HTML using grouped display
      const sourcesHtml = renderGroupedSourcesHtml(sources, {
        ingredientNames: result.ingredientNames || null,
      });

      modalContent.innerHTML = `
    <div style="margin-bottom: 20px;">
      <h3 style="margin: 0 0 8px 0; color: #4c5ad4; font-size: 1.4rem;">✓ Product Found!</h3>
      <p style="margin: 0; font-size: 1.1rem; color: #fff; font-weight: 600;">${esc(productName)}</p>
      ${brandName ? `<p style="margin: 4px 0 0 0; color: #a0a0a0; font-size: 0.9rem;">Brand: ${esc(brandName)}</p>` : ""}
      <p style="margin: 4px 0 0 0; color: #a0a0a0; font-size: 0.9rem;">Replacing: ${esc(oldItem.brandName)} → ${esc(brandName || "New Brand")}</p>
    </div>

    <div style="margin-bottom: 24px;">
      <p style="font-size: 0.85rem; color: #999; margin-bottom: 12px; font-style: italic;">
        ⚠️ Note: URLs are provided for reference. Some links may be outdated or inaccessible due to website changes.
      </p>
      ${sourcesHtml}
    </div>

    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button type="button" class="cancelReplacementSourcesBtn" style="
        padding: 14px 24px;
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 8px;
        color: #fff;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      ">Cancel</button>
    </div>
  `;

      modal.appendChild(modalContent);
      document.body.appendChild(modal);

      console.log(
        "Replacement sources modal appended to DOM. Sources count:",
        sources.length,
      );
      console.log("Modal element:", modal);
      console.log(
        "Modal visible:",
        window.getComputedStyle(modal).display !== "none",
      );

      const cancelBtn = modalContent.querySelector(
        ".cancelReplacementSourcesBtn",
      );
      const confirmBtn = modalContent.querySelector(
        ".confirmReplacementIngredientListBtn",
      );
      const confirmConsensusBtn = modalContent.querySelector(
        ".confirmReplacementConsensusBtn",
      );
      const confirmGroupBtns = modalContent.querySelectorAll(
        ".confirmGroupIngredientListBtn",
      );

      if (!cancelBtn) {
        console.error("Cancel button not found in replacement sources modal!");
      }

      cancelBtn.addEventListener("click", () => {
        if (modal.parentNode) {
          document.body.removeChild(modal);
        }
        renderBrandItems();
      });

      const handleConfirm = async (finalIngredientList) => {
        document.body.removeChild(modal);

        // Proceed with allergen/diet preview
        await showReplacementPreview(
          oldItem,
          brandName,
          barcode,
          finalIngredientList,
          brandImage,
          productName,
        );
      };

      // Handle grouped ingredient list confirmation buttons
      confirmGroupBtns.forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.style.background = "#4caf50";
          btn.innerHTML = "✓ Confirmed";
          btn.style.cursor = "default";

          const groupDiv = btn.closest("[data-ingredients-text]");
          const groupIngredientList = groupDiv
            ? groupDiv.dataset.ingredientsText
            : ingredientList || "";
          await handleConfirm(groupIngredientList);
        });
      });

      // Handle consensus confirmation
      if (confirmConsensusBtn) {
        confirmConsensusBtn.addEventListener("click", async () => {
          const consensusDiff = consistencyInfo.differences?.find(
            (d) => d.groupSize === consistencyInfo.matchingSources,
          );
          if (consensusDiff) {
            await handleConfirm(consensusDiff.ingredientsText);
          }
        });
      }

      // Handle consolidated list confirmation
      if (confirmBtn) {
        confirmBtn.addEventListener("click", async () => {
          await handleConfirm(ingredientList);
        });
      }
    }

    function openPhotoCapture(brandVerificationPhotos = []) {
      const mb = document.getElementById("modalBack");
      const body = document.getElementById("modalBody");
      document.getElementById("modalTitle").textContent =
        "Confirm Allergen Information";

      body.innerHTML = `
    <div class="photoCapture">
      <div class="note" style="text-align:center;margin-bottom:8px">Take photos of your current menu to confirm that it aligns with the menu on Clarivore</div>
      <video id="videoStream" class="videoPreview" autoplay playsinline style="display:none"></video>
      <canvas id="photoCanvas" style="display:none"></canvas>
      <div id="photosContainer" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:12px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
        <button class="btn btnPrimary" id="startCameraBtn">📷 Take Photo</button>
        <button class="btn btnPrimary" id="takePictureBtn" style="display:none">📸 Capture</button>
        <input type="file" id="fileInput" accept="image/*" capture="environment" style="display:none" multiple>
        <button class="btn" id="uploadBtn">📁 Upload Photos</button>
        <button class="btn btnSuccess" id="doneAddingBtn" style="display:none">Done adding photos</button>
      </div>
      <div id="confirmSection" style="display:none;width:100%;text-align:center">
        <div class="note" style="margin:12px 0 8px">Are all dishes clearly visible in these photos?</div>
        <div style="display:flex;gap:8px;justify-content:center;margin-bottom:12px">
          <button class="btn btnSuccess" id="yesVisibleBtn">✓ Yes</button>
          <button class="btn btnDanger" id="noVisibleBtn">✗ No</button>
        </div>
      </div>
      <div id="menuConfirmSection" style="display:none;width:100%;text-align:center">
        <div class="note" style="margin:12px 0 8px">Are these photos of your most current menu?</div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button class="btn btnSuccess" id="verifyMenuBtn">✓ Yes, verify menu</button>
          <button class="btn btnDanger" id="cancelPhotoBtn">✗ Cancel</button>
        </div>
      </div>
      <div id="menuVerificationSection" style="display:none;width:100%">
        <div id="menuVerificationStatus" style="text-align:center;padding:12px">
          <style>
            @keyframes menuVerifySlide {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(400%); }
            }
          </style>
          <div style="width:100%;max-width:300px;margin:0 auto;background:rgba(76,90,212,0.2);border-radius:4px;height:8px;overflow:hidden;position:relative">
            <div style="background:linear-gradient(90deg, transparent, #4c5ad4, transparent);height:100%;width:25%;position:absolute;animation:menuVerifySlide 1.2s ease-in-out infinite"></div>
          </div>
          <div id="menuVerificationStatusText" style="color:#a8b2d6;margin-top:8px;font-size:0.9rem">Comparing your photos with the stored menu...</div>
          <button class="btn" id="cancelMenuVerificationBtn" style="margin-top:12px">Cancel</button>
        </div>
        <div id="menuVerificationResult" style="display:none"></div>
        <div id="menuVerificationActionsMatch" style="display:none;flex-direction:column;gap:8px;margin-top:12px">
          <button class="btn btnSuccess" id="confirmPhotoBtn">✓ Confirm - menu is accurate</button>
          <button class="btn" id="retakePhotosBtn">📷 Retake photos</button>
        </div>
        <div id="menuVerificationActionsMismatch" style="display:none;flex-direction:column;gap:8px;margin-top:12px">
          <button class="btn btnPrimary" id="updateMenuBtn">📸 Update menu photos in Clarivore</button>
          <button class="btn" id="retakePhotosBtnMismatch">📷 Retake photos</button>
          <button class="btn btnDanger" id="reportMenuIssueBtn">⚠️ Something's not right</button>
        </div>
      </div>
    </div>
  `;

      mb.style.display = "flex";
      configureModalClose({
        visible: true,
        onClick: () => {
          mb.style.display = "none";
          if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            stream = null;
          }
        },
      });

      let stream = null;
      let photoDataArray = [];

      function renderPhotos() {
        const container = document.getElementById("photosContainer");
        container.innerHTML = "";
        photoDataArray.forEach((photoData, idx) => {
          const wrapper = document.createElement("div");
          wrapper.style.cssText = "position:relative;display:inline-block";
          const img = document.createElement("img");
          img.src = photoData;
          img.style.cssText =
            "max-width:120px;max-height:80px;object-fit:cover;border-radius:6px;border:1px solid #2a3466;cursor:pointer";
          img.onclick = () => window.showPhotoPreview(photoData);
          const removeBtn = document.createElement("button");
          removeBtn.textContent = "×";
          removeBtn.className = "btn btnDanger";
          removeBtn.style.cssText =
            "position:absolute;top:-8px;right:-8px;width:24px;height:24px;padding:0;min-width:24px;border-radius:50%;font-size:16px;line-height:1";
          removeBtn.onclick = (e) => {
            e.stopPropagation();
            photoDataArray.splice(idx, 1);
            renderPhotos();
            updateButtonStates();
          };
          wrapper.appendChild(img);
          wrapper.appendChild(removeBtn);
          container.appendChild(wrapper);
        });
      }

      function updateButtonStates() {
        const doneBtn = document.getElementById("doneAddingBtn");
        const confirmSection = document.getElementById("confirmSection");
        if (photoDataArray.length > 0) {
          doneBtn.style.display = "inline-flex";
        } else {
          doneBtn.style.display = "none";
          confirmSection.style.display = "none";
          document.getElementById("menuConfirmSection").style.display = "none";
        }
      }

      document.getElementById("startCameraBtn").onclick = async () => {
        try {
          if (!stream) {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: "environment" },
              audio: false,
            });
            const video = document.getElementById("videoStream");
            video.srcObject = stream;
          }
          document.getElementById("videoStream").style.display = "block";
          document.getElementById("startCameraBtn").textContent =
            "📷 Take another";
          document.getElementById("takePictureBtn").style.display = "inline-flex";
        } catch (err) {
          alert(
            "Camera access denied or not available. Please use the upload option.",
          );
        }
      };

      document.getElementById("takePictureBtn").onclick = () => {
        const video = document.getElementById("videoStream");
        const canvas = document.getElementById("photoCanvas");
        const ctx = canvas.getContext("2d");

        const maxWidth = 600;
        const scale = Math.min(1, maxWidth / video.videoWidth);
        canvas.width = video.videoWidth * scale;
        canvas.height = video.videoHeight * scale;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const photoData = canvas.toDataURL("image/jpeg", 0.6);

        console.log("Photo captured, size:", photoData.length, "bytes");

        photoDataArray.push(photoData);
        renderPhotos();
        updateButtonStates();

        video.style.display = "none";
        document.getElementById("takePictureBtn").style.display = "none";
        document.getElementById("startCameraBtn").style.display = "inline-flex";
      };

      document.getElementById("doneAddingBtn").onclick = () => {
        if (photoDataArray.length === 0) {
          alert("Please add at least one photo.");
          return;
        }
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
        }
        document.getElementById("videoStream").style.display = "none";
        document.getElementById("startCameraBtn").style.display = "inline-flex";
        document.getElementById("takePictureBtn").style.display = "none";
        document.getElementById("confirmSection").style.display = "block";
      };

      document.getElementById("uploadBtn").onclick = () => {
        document.getElementById("fileInput").click();
      };

      document.getElementById("fileInput").onchange = (e) => {
        const files = Array.from(e.target.files);
        let processed = 0;

        files.forEach((file) => {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.getElementById("photoCanvas");
              const ctx = canvas.getContext("2d");

              const maxWidth = 600;
              const scale = Math.min(1, maxWidth / img.width);
              canvas.width = img.width * scale;
              canvas.height = img.height * scale;

              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              const photoData = canvas.toDataURL("image/jpeg", 0.6);

              console.log("Photo uploaded, size:", photoData.length, "bytes");

              photoDataArray.push(photoData);
              processed++;

              if (processed === files.length) {
                renderPhotos();
                updateButtonStates();
              }
            };
            img.src = ev.target.result;
          };
          reader.readAsDataURL(file);
        });

        e.target.value = "";
      };

      document.getElementById("yesVisibleBtn").onclick = () => {
        document.getElementById("confirmSection").style.display = "none";
        document.getElementById("menuConfirmSection").style.display = "block";
      };

      document.getElementById("noVisibleBtn").onclick = () => {
        photoDataArray = [];
        renderPhotos();
        updateButtonStates();
        document.getElementById("confirmSection").style.display = "none";
        document.getElementById("menuConfirmSection").style.display = "none";
        document.getElementById("menuVerificationSection").style.display = "none";
        document.getElementById("menuVerificationStatus").style.display = "block";
        document.getElementById("menuVerificationResult").style.display = "none";
        document.getElementById("menuVerificationActionsMatch").style.display =
          "none";
        document.getElementById("menuVerificationActionsMismatch").style.display =
          "none";
        document.getElementById("startCameraBtn").textContent = "📷 Take Photo";
      };

      // Verify menu button - calls the verification API
      let menuVerificationAborted = false;
      document.getElementById("verifyMenuBtn").onclick = async () => {
        menuVerificationAborted = false;
        document.getElementById("menuConfirmSection").style.display = "none";
        document.getElementById("menuVerificationSection").style.display =
          "block";
        document.getElementById("menuVerificationStatus").style.display = "block";
        document.getElementById("menuVerificationResult").style.display = "none";
        document.getElementById("menuVerificationActionsMatch").style.display =
          "none";
        document.getElementById("menuVerificationActionsMismatch").style.display =
          "none";
        // Hide photo buttons while processing
        document.getElementById("startCameraBtn").style.display = "none";
        document.getElementById("uploadBtn").style.display = "none";
        document.getElementById("doneAddingBtn").style.display = "none";
        document.getElementById("takePictureBtn").style.display = "none";

        // Get the stored menu images
        const originalMenuImages =
          rs.menuImages || (rs.menuImage ? [rs.menuImage] : []);

        if (originalMenuImages.length === 0) {
          // No stored menu to compare against - just confirm
          document.getElementById("menuVerificationStatus").style.display =
            "none";
          document.getElementById("menuVerificationResult").style.display =
            "block";
          document.getElementById("menuVerificationResult").innerHTML = `
            <div style="background:rgba(76,175,80,0.15);border:1px solid rgba(76,175,80,0.4);border-radius:8px;padding:16px;margin-bottom:12px">
              <div style="color:#4ade80;font-size:1rem;font-weight:600;margin-bottom:4px">✓ No stored menu to compare</div>
              <div style="color:#a8b2d6;font-size:0.9rem">Your photos will be used as the reference menu for future verifications.</div>
            </div>
          `;
          document.getElementById("menuVerificationActionsMatch").style.display =
            "flex";
          return;
        }

        try {
          const response = await fetch(
            `${window.SUPABASE_URL || "https://fgoiyycctnwnghrvsilt.supabase.co"}/functions/v1/verify-menu-image`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                originalMenuImages: originalMenuImages,
                newMenuPhotos: photoDataArray,
                restaurantName: rs.name || "",
              }),
            },
          );

          const result = await response.json();
          console.log("Menu verification result:", result);

          // Check if verification was cancelled
          if (menuVerificationAborted) return;

          document.getElementById("menuVerificationStatus").style.display =
            "none";
          document.getElementById("menuVerificationResult").style.display =
            "block";

          if (result.isMatch) {
            document.getElementById(
              "menuVerificationActionsMatch",
            ).style.display = "flex";
            document.getElementById(
              "menuVerificationActionsMismatch",
            ).style.display = "none";
            document.getElementById("menuVerificationResult").innerHTML = `
              <div style="background:rgba(76,175,80,0.15);border:1px solid rgba(76,175,80,0.4);border-radius:8px;padding:16px;margin-bottom:12px">
                <div style="color:#4ade80;font-size:1rem;font-weight:600">✓ Menu verified</div>
              </div>
            `;
          } else {
            document.getElementById(
              "menuVerificationActionsMatch",
            ).style.display = "none";
            document.getElementById(
              "menuVerificationActionsMismatch",
            ).style.display = "flex";
            document.getElementById("menuVerificationResult").innerHTML = `
              <div style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);border-radius:8px;padding:16px;margin-bottom:12px">
                <div style="color:#ef4444;font-size:1rem;font-weight:600;margin-bottom:8px">⚠️ Menu differences detected</div>
                <div style="color:#fca5a5;font-size:0.9rem;white-space:pre-wrap">${esc(result.reason || "Could not verify menus match.")}</div>
                <div style="color:#a8b2d6;font-size:0.85rem;margin-top:12px;padding-top:12px;border-top:1px solid rgba(239,68,68,0.3)">
                  The menu in Clarivore needs to be updated to match your current menu, or retake the photo if it was unclear.
                </div>
              </div>
            `;
          }
        } catch (error) {
          console.error("Menu verification error:", error);
          document.getElementById("menuVerificationStatus").style.display =
            "none";
          document.getElementById("menuVerificationResult").style.display =
            "block";
          document.getElementById("menuVerificationActionsMatch").style.display =
            "flex";
          document.getElementById(
            "menuVerificationActionsMismatch",
          ).style.display = "none";
          document.getElementById("menuVerificationResult").innerHTML = `
            <div style="background:rgba(251,191,36,0.15);border:1px solid rgba(251,191,36,0.4);border-radius:8px;padding:16px;margin-bottom:12px">
              <div style="color:#fbbf24;font-size:1rem;font-weight:600;margin-bottom:4px">⚠️ Verification unavailable</div>
              <div style="color:#a8b2d6;font-size:0.9rem">Could not compare menus automatically. You can still confirm if you believe the information is accurate.</div>
            </div>
          `;
        }
      };

      document.getElementById("confirmPhotoBtn").onclick = () => {
        if (photoDataArray.length > 0) {
          // Combine brand verification photos with menu photos
          const allPhotos = [...brandVerificationPhotos, ...photoDataArray];
          send({
            type: "confirmAllergens",
            photos: allPhotos,
            timestamp: new Date().toISOString(),
          });
          const confirmBtn = document.querySelectorAll(".btn.btnDanger")[0];
          if (confirmBtn) {
            confirmBtn.textContent = "Information confirmed";
            confirmBtn.classList.remove("btnDanger");
            confirmBtn.classList.add("btnSuccess");
          }
          updateLastConfirmedText();
          mb.style.display = "none";
          if (stream) {
            stream.getTracks().forEach((track) => track.stop());
          }
        }
      };

      const resetPhotoCapture = () => {
        photoDataArray = [];
        renderPhotos();
        updateButtonStates();
        document.getElementById("confirmSection").style.display = "none";
        document.getElementById("menuConfirmSection").style.display = "none";
        document.getElementById("menuVerificationSection").style.display = "none";
        document.getElementById("menuVerificationStatus").style.display = "block";
        document.getElementById("menuVerificationResult").style.display = "none";
        document.getElementById("menuVerificationActionsMatch").style.display =
          "none";
        document.getElementById("menuVerificationActionsMismatch").style.display =
          "none";
        document.getElementById("startCameraBtn").textContent = "📷 Take Photo";
        // Show photo buttons again
        document.getElementById("startCameraBtn").style.display = "inline-flex";
        document.getElementById("uploadBtn").style.display = "inline-flex";
      };

      document.getElementById("retakePhotosBtn").onclick = resetPhotoCapture;
      document.getElementById("retakePhotosBtnMismatch").onclick =
        resetPhotoCapture;

      // Cancel menu verification button
      document.getElementById("cancelMenuVerificationBtn").onclick = () => {
        menuVerificationAborted = true;
        resetPhotoCapture();
      };

      document.getElementById("updateMenuBtn").onclick = () => {
        // Close this modal and open the menu upload modal
        mb.style.display = "none";
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
        // Find and click the Edit menu images button
        const uploadMenuBtn = document.getElementById("uploadMenuBtn");
        if (uploadMenuBtn) {
          uploadMenuBtn.click();
        } else {
          alert(
            'Please use the "Edit menu images" button in the manager controls to update the menu photos.',
          );
        }
      };

      document.getElementById("reportMenuIssueBtn").onclick = () => {
        // Show a proper modal for reporting issues
        const reportModal = document.createElement("div");
        reportModal.style.cssText = `
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.8); z-index: 10002;
          display: flex; align-items: center; justify-content: center;
        `;

        reportModal.innerHTML = `
          <div style="background: #1e293b; padding: 24px; border-radius: 12px; width: 90%; max-width: 500px; border: 1px solid rgba(148, 163, 184, 0.2);">
            <h3 style="color: #fff; margin: 0 0 16px 0;">Report Issue</h3>
            <p style="color: #94a3b8; margin-bottom: 16px; font-size: 0.9rem;">Please describe what's wrong with the menu comparison.</p>
            <textarea style="width: 100%; height: 100px; background: rgba(0,0,0,0.2); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 8px; color: #fff; padding: 12px; margin-bottom: 16px; resize: vertical;" placeholder="e.g. The menu analysis found differences that don't exist, missed real changes, etc."></textarea>
            <div style="display: flex; justify-content: flex-end; gap: 12px;">
              <button class="cancelReportBtn" style="padding: 8px 16px; background: transparent; border: 1px solid rgba(255,255,255,0.2); color: #fff; border-radius: 6px; cursor: pointer;">Cancel</button>
              <button class="sendReportBtn" style="padding: 8px 16px; background: #dc2626; border: none; color: #fff; border-radius: 6px; cursor: pointer; font-weight: 600;">Send Report</button>
            </div>
          </div>
        `;

        document.body.appendChild(reportModal);

        reportModal.querySelector(".cancelReportBtn").onclick = () =>
          document.body.removeChild(reportModal);

        reportModal.querySelector(".sendReportBtn").onclick = async function () {
          const msg = reportModal.querySelector("textarea").value;
          if (!msg) return;

          this.textContent = "Sending...";
          this.disabled = true;

          try {
            const reportMeta = getIssueReportMeta();
            await fetch(
              "https://fgoiyycctnwnghrvsilt.supabase.co/functions/v1/report-issue",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${SUPABASE_KEY}`,
                  apikey: SUPABASE_KEY,
                },
                body: JSON.stringify({
                  message: msg,
                  restaurantName: rs.name || "Unknown",
                  context: "menu_verification",
                  userEmail: reportMeta.userEmail,
                  reporterName: reportMeta.reporterName,
                  accountName: reportMeta.accountName,
                  accountId: reportMeta.accountId,
                  pageUrl: reportMeta.pageUrl,
                }),
              },
            );

            document.body.removeChild(reportModal);
            mb.style.display = "none";
            if (stream) {
              stream.getTracks().forEach((track) => track.stop());
            }
            alert("Thank you for reporting this issue. Our team will review it.");
          } catch (e) {
            console.error("Failed to report issue:", e);
            this.textContent = "Send Report";
            this.disabled = false;
            alert("Failed to send report. Please try again.");
          }
        };
      };

      document.getElementById("cancelPhotoBtn").onclick = () => {
        mb.style.display = "none";
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
      };
    }


  return { openBrandVerification, collectAllBrandItems };
}
