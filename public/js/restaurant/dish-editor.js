import { initIngredientPhotoAnalysis } from "./ingredient-photo.js";
import { initDishEditorPhotos } from "./dish-editor-photos.js";
import { requestAiExtraction } from "./dish-editor-extraction.js";
import { createBrandMemory } from "./dish-editor-brand-memory.js";
import { createDishEditorAnalysis } from "./dish-editor-analysis.js";
import {
  dishEditorTemplate,
  imageModalTemplate,
} from "./dish-editor-template.js";

export function initDishEditor(deps = {}) {
  const esc =
    typeof deps.esc === "function" ? deps.esc : (value) => String(value ?? "");
  const state = deps.state || {};
  const normalizeDietLabel = (value) => String(value ?? "").trim();
  const getIssueReportMeta =
    typeof deps.getIssueReportMeta === "function" ? deps.getIssueReportMeta : () => ({});
  const ALLERGENS = Array.isArray(deps.ALLERGENS) ? deps.ALLERGENS : [];
  const ALLERGEN_EMOJI =
    deps.ALLERGEN_EMOJI && typeof deps.ALLERGEN_EMOJI === "object"
      ? deps.ALLERGEN_EMOJI
      : {};
  const DIETS = Array.isArray(deps.DIETS) ? deps.DIETS : [];
  const DIET_EMOJI =
    deps.DIET_EMOJI && typeof deps.DIET_EMOJI === "object" ? deps.DIET_EMOJI : {};
  const normalizeAllergen = (value) => String(value ?? "").trim();
  const getDietAllergenConflicts =
    typeof deps.getDietAllergenConflicts === "function"
      ? deps.getDietAllergenConflicts
      : () => [];
  const cap = typeof deps.cap === "function" ? deps.cap : (value) => String(value ?? "");
  const norm =
    typeof deps.norm === "function"
      ? deps.norm
      : (value) => String(value ?? "").toLowerCase();
  const formatAllergenLabel =
    typeof deps.formatAllergenLabel === "function"
      ? deps.formatAllergenLabel
      : (value) => cap(value);
  const tooltipBodyHTML =
    typeof deps.tooltipBodyHTML === "function" ? deps.tooltipBodyHTML : () => "";
  const send = typeof deps.send === "function" ? deps.send : () => {};
  const toArray = (value) => (Array.isArray(value) ? value.slice() : []);
  const DEBUG_REPORTING = false;
  const debugLog = (...args) => {
    if (DEBUG_REPORTING && typeof console !== "undefined") {
      console.log(...args);
    }
  };
  const debugWarn = (...args) => {
    if (DEBUG_REPORTING && typeof console !== "undefined") {
      console.warn(...args);
    }
  };
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


  let aiAssistBackdrop = null;
  let aiAssistPanel = null;
  let aiAssistCloseBtn = null;
  let aiAssistInput = null;
  let aiAssistDictateBtn = null;
  let aiAssistGenerateBtn = null;
  let aiAssistProcessBtn = null;
  let aiAssistStatusEl = null;
  let aiAssistResultsEl = null;
  let aiAssistTableBody = null;
  let aiAssistAddRowBtn = null;
  let aiAssistApplyBtn = null;
  let aiAssistBrandResults = null;
  let aiAssistVideo = null;
  let aiAssistCaptureBtn = null;
  let aiAssistCancelCameraBtn = null;
  let aiAssistMediaPreview = null;
  let aiAssistElementsBound = false;
  let renderPhotoPreviews = () => {};
  let handleMultipleRecipePhotoUpload = () => {};
  let handleRecipePhotoCamera = () => {};

  const aiAssistState = {
    context: null,
    recognition: null,
    listening: false,
    pendingRequestId: null,
    brandSuggestions: {},
    mediaStream: null,
    detectedDietaryOptions: [],
    originalDishName: null, // Store original dish name when modal opens
    dishNameModified: false, // Track if dish name has been modified and saved locally but not applied to dish
  };

  const AI_BRAND_MEMORY_KEY = "cle:aiBrandMemory:v1";

  // Global tracking of active photo analyses to preserve state across table re-renders
  // Key: rowIdx, Value: { ingredientName, statusText }
  const activePhotoAnalyses = new Map();
  const scanDecisionRequests = new Map();

  let openBrandIdentificationChoice = () => {};
  let showIngredientPhotoUploadModal = () => {};
  let showPhotoAnalysisLoadingInRow = () => {};
  let hidePhotoAnalysisLoadingInRow = () => {};
  let updatePhotoAnalysisLoadingStatus = () => {};
  let showPhotoAnalysisResultButton = () => {};

  const getDishNameForAi = () => {
    const nameInput = document.getElementById("aiAssistNameInput");
    return (
      nameInput?.value?.trim() ||
      (aiAssistState.context?.getCurrentName
        ? aiAssistState.context.getCurrentName()
        : "")
    );
  };

  const analysisApi = createDishEditorAnalysis({
    ensureAiAssistElements,
    collectAiTableData,
    renderAiTable,
    updateAiPreview,
    aiAssistSetStatus,
    getDishNameForAi,
    supabaseClient:
      typeof window !== "undefined" ? window.supabaseClient : null,
    scanDecisionRequests,
    aiAssistState,
    error: console.error,
  });
  const { analyzeIngredientRow, autoAnalyzeIngredientRows } = analysisApi;

  const ingredientPhotoApi = initIngredientPhotoAnalysis({
    esc,
    state,
    aiAssistState,
    collectAiTableData,
    renderAiTable,
    aiAssistSetStatus,
    ensureAiAssistElements,
    normalizeDietLabel,
    normalizeAllergen,
    formatAllergenLabel,
    getDietAllergenConflicts,
    compressImage,
    getIssueReportMeta,
    activePhotoAnalyses,
    ALLERGENS,
    DIETS,
    getSupabaseKey: () =>
      typeof window !== "undefined" ? window.SUPABASE_KEY : "",
  });

  openBrandIdentificationChoice = ingredientPhotoApi.openBrandIdentificationChoice;
  showIngredientPhotoUploadModal =
    ingredientPhotoApi.showIngredientPhotoUploadModal;
  showPhotoAnalysisLoadingInRow =
    ingredientPhotoApi.showPhotoAnalysisLoadingInRow;
  hidePhotoAnalysisLoadingInRow =
    ingredientPhotoApi.hidePhotoAnalysisLoadingInRow;
  updatePhotoAnalysisLoadingStatus =
    ingredientPhotoApi.updatePhotoAnalysisLoadingStatus;
  showPhotoAnalysisResultButton =
    ingredientPhotoApi.showPhotoAnalysisResultButton;

  if (typeof window !== "undefined") {
    window.rotateImage = ingredientPhotoApi.rotateImage;
    window.analyzeWithLabelCropper = ingredientPhotoApi.analyzeWithLabelCropper;
    window.analyzeAllergensWithLabelCropper =
      ingredientPhotoApi.analyzeAllergensWithLabelCropper;
    window.analyzeIngredientPhoto = ingredientPhotoApi.analyzeIngredientPhoto;
    window.showIngredientPhotoUploadModal =
      ingredientPhotoApi.showIngredientPhotoUploadModal;
  }

  const requestAiExtractionWithConfig = (payload) =>
    requestAiExtraction(payload, {
      endpoint:
        state.aiAssistEndpoint ||
        (typeof window !== "undefined" ? window.__CLE_AI_ENDPOINT__ : null),
      supabaseClient:
        typeof window !== "undefined" ? window.supabaseClient : null,
      log: debugLog,
      warn: debugWarn,
      error: console.error,
    });

  const brandMemory = createBrandMemory({
    storageKey: AI_BRAND_MEMORY_KEY,
    norm,
    parseJsonArray,
    toArray,
    state,
    debugLog,
  });
  const rememberBrand = brandMemory.rememberBrand;
  const getRememberedBrand = brandMemory.getRememberedBrand;
  const rebuildBrandMemoryFromRestaurant =
    brandMemory.rebuildBrandMemoryFromRestaurant;

  function aiAssistSetStatus(message = "", tone = "info") {
    if (!aiAssistStatusEl) return;
    aiAssistStatusEl.textContent = message;
    if (message) {
      aiAssistStatusEl.setAttribute("data-tone", tone);
    } else {
      aiAssistStatusEl.removeAttribute("data-tone");
    }
  }

  function ensureAiAssistElements() {
    if (aiAssistBackdrop && aiAssistBackdrop.isConnected) return;
    if (aiAssistBackdrop && !aiAssistBackdrop.isConnected) {
      aiAssistBackdrop = null;
      aiAssistPanel = null;
      aiAssistCloseBtn = null;
      aiAssistInput = null;
      aiAssistDictateBtn = null;
      aiAssistProcessBtn = null;
      aiAssistStatusEl = null;
      aiAssistResultsEl = null;
      aiAssistTableBody = null;
      aiAssistAddRowBtn = null;
      aiAssistApplyBtn = null;
      aiAssistBrandResults = null;
      aiAssistVideo = null;
      aiAssistCaptureBtn = null;
      aiAssistCancelCameraBtn = null;
      aiAssistMediaPreview = null;
      aiAssistElementsBound = false;
    }
    if (!aiAssistBackdrop) {
      const backdrop = document.createElement("div");
      backdrop.className = "aiAssistBackdrop";
      backdrop.id = "aiAssistBackdrop";
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.innerHTML = dishEditorTemplate();
      document.body.appendChild(backdrop);
      aiAssistBackdrop = backdrop;
      aiAssistPanel = backdrop.querySelector("#aiAssistPanel");

      // Create image modal
      if (!document.getElementById("imageModal")) {
        const modal = document.createElement("div");
        modal.id = "imageModal";
        modal.className = "imageModal";
        modal.innerHTML = imageModalTemplate();
        modal.addEventListener("click", (e) => {
          if (e.target.classList.contains("imageModal")) {
            closeImageModal();
          }
        });
        document.body.appendChild(modal);
      }
      aiAssistCloseBtn = backdrop.querySelector("#aiAssistClose");
      aiAssistInput = backdrop.querySelector("#aiAssistInput");
      aiAssistDictateBtn = backdrop.querySelector("#aiAssistDictateBtn");
      aiAssistGenerateBtn = backdrop.querySelector("#aiAssistGenerateBtn");
      aiAssistProcessBtn = backdrop.querySelector("#aiAssistProcessBtn");
      aiAssistStatusEl = backdrop.querySelector("#aiAssistStatus");
      aiAssistResultsEl = backdrop.querySelector("#aiAssistResults");
      aiAssistTableBody = backdrop.querySelector("#aiAssistTableBody");
      aiAssistAddRowBtn = backdrop.querySelector("#aiAssistAddRowBtn");
      aiAssistApplyBtn = backdrop.querySelector("#aiAssistApplyBtn");
      aiAssistBrandResults = backdrop.querySelector("#aiAssistBrandResults");
      aiAssistVideo = backdrop.querySelector("#aiAssistVideo");
      aiAssistCaptureBtn = backdrop.querySelector("#aiAssistCaptureBtn");
      aiAssistCancelCameraBtn = backdrop.querySelector(
        "#aiAssistCancelCameraBtn",
      );
      aiAssistMediaPreview = backdrop.querySelector("#aiAssistMediaPreview");
      window.aiAssistPhotos = []; // Store multiple photos

      aiAssistElementsBound = false;
    }
    if (!aiAssistElementsBound) {
      aiAssistBackdrop.addEventListener("click", (event) => {
        if (event.target === aiAssistBackdrop) closeDishEditor();
      });
      aiAssistCloseBtn.addEventListener("click", () => closeDishEditor());
      aiAssistDictateBtn.addEventListener("click", () => toggleAiDictation());
      if (aiAssistGenerateBtn) {
        aiAssistGenerateBtn.addEventListener("click", () =>
          generateRecipeDescription(),
        );

        // Create update function that we can call from multiple places
        const updateGenerateButtonText = () => {
          const nameInput = document.getElementById("aiAssistNameInput");
          if (nameInput && aiAssistGenerateBtn) {
            const dishName = nameInput.value?.trim() || "recipe";
            aiAssistGenerateBtn.textContent = `✨ Generate generic ${dishName} recipe`;
          }
        };

        // Get save button and name input
        const nameInput = aiAssistBackdrop.querySelector("#aiAssistNameInput");
        const saveNameBtn = aiAssistBackdrop.querySelector(
          "#aiAssistSaveNameBtn",
        );

        if (nameInput) {
          // Initialize original dish name if not already set
          if (
            aiAssistState.originalDishName === null ||
            aiAssistState.originalDishName === undefined
          ) {
            aiAssistState.originalDishName = nameInput.value?.trim() || "";
          }
          let originalDishName = aiAssistState.originalDishName;

          // Function to check if dish name has changed and show/hide save button
          const checkForChanges = () => {
            const currentValue = nameInput.value?.trim() || "";
            if (saveNameBtn) {
              // Show save button if value changed from original
              if (currentValue !== originalDishName && currentValue.length > 0) {
                saveNameBtn.style.display = "block";
              } else {
                saveNameBtn.style.display = "none";
              }
            }
          };

          // Save button click handler - updates generate button and hides save button
          if (saveNameBtn) {
            saveNameBtn.addEventListener("click", () => {
              const newDishName = nameInput.value?.trim() || "";
              const wasChanged = newDishName !== originalDishName;

              originalDishName = newDishName;
              aiAssistState.originalDishName = originalDishName; // Update global state

              // Mark that dish name has been modified (needs to be saved to dish)
              if (wasChanged && newDishName.length > 0) {
                aiAssistState.dishNameModified = true;
                debugLog(
                  "Dish name saved locally - marking as modified. Will prompt on close unless saved to dish.",
                );
              }

              updateGenerateButtonText();
              saveNameBtn.style.display = "none";
            });
          }

          // Check for changes on input events
          nameInput.addEventListener("input", checkForChanges);
          nameInput.addEventListener("change", checkForChanges);
          nameInput.addEventListener("keyup", checkForChanges);
          nameInput.addEventListener("paste", () => {
            setTimeout(checkForChanges, 10); // Small delay to let paste complete
          });

          // Update generate button text on input (but don't save yet)
          nameInput.addEventListener("input", () => {
            // Don't update generate button automatically - wait for save
          });

          // Set initial text right away
          updateGenerateButtonText();

          // Initialize save button state
          checkForChanges();
        }

        // Store the update function globally so we can call it when modal opens
        window.updateGenerateButtonText = updateGenerateButtonText;
      }
      aiAssistProcessBtn.addEventListener("click", () => handleAiProcess());

      // Recipe photo upload/camera handlers
      const uploadRecipeBtn = aiAssistBackdrop.querySelector(
        "#aiAssistUploadRecipeBtn",
      );
      const cameraRecipeBtn = aiAssistBackdrop.querySelector(
        "#aiAssistCameraRecipeBtn",
      );
      const recipeFileInput = aiAssistBackdrop.querySelector(
        "#aiAssistRecipeFileInput",
      );

      if (uploadRecipeBtn && recipeFileInput) {
        uploadRecipeBtn.addEventListener("click", () => {
          recipeFileInput.value = "";
          recipeFileInput.click();
        });
        recipeFileInput.addEventListener("change", () => {
          const files = recipeFileInput.files;
          if (files && files.length) handleMultipleRecipePhotoUpload(files);
        });
      }
      if (cameraRecipeBtn) {
        cameraRecipeBtn.addEventListener("click", () =>
          handleRecipePhotoCamera(),
        );
      }

      const clearAllPhotosBtn = aiAssistBackdrop.querySelector(
        "#aiAssistClearAllPhotosBtn",
      );
      if (clearAllPhotosBtn) {
        clearAllPhotosBtn.addEventListener("click", () => {
          window.aiAssistPhotos = [];
          renderPhotoPreviews();
        });
      }

      aiAssistAddRowBtn.addEventListener("click", () => {
        const data = collectAiTableData();
        data.push({
          name: "",
          allergens: [],
          diets: [],
          brands: [],
          confirmed: false,
          requiresApply: true,
          aiDetectionCompleted: false,
        });
        renderAiTable(data);
      });

      // New confirmation workflow buttons
      // Save Draft button removed per user request

      debugLog("Binding aiAssistApplyBtn:", aiAssistApplyBtn);
      if (aiAssistApplyBtn) {
        aiAssistApplyBtn.addEventListener("click", () => {
          debugLog("Save to Dish button clicked!");
          applyAiIngredientsToOverlay();
        });
      } else {
        console.error("aiAssistApplyBtn not found!");
      }
      if (aiAssistCaptureBtn) {
        aiAssistCaptureBtn.addEventListener("click", () => captureAiPhoto());
      }
      if (aiAssistCancelCameraBtn) {
        aiAssistCancelCameraBtn.addEventListener("click", () =>
          stopAiCamera(true),
        );
      }
      aiAssistTableBody.addEventListener("mousedown", (event) => {
        const applyBtn = event.target.closest?.(".aiIngredientApply");
        if (!applyBtn) return;
        const rowElement = applyBtn.closest("tr");
        const rowIdx = Number(
          applyBtn.dataset.rowIdx || rowElement?.dataset.index || "0",
        );
        aiAssistState.skipNameChangeRowIdx = rowIdx;
      });
      aiAssistTableBody.addEventListener("click", (event) => {
        const applyBtn = event.target.closest?.(".aiIngredientApply");
        if (applyBtn) {
          const rowElement = applyBtn.closest("tr");
          const rowIdx = Number(
            applyBtn.dataset.rowIdx || rowElement?.dataset.index || "0",
          );
          const data = collectAiTableData();
          const tr =
            rowElement ||
            aiAssistTableBody.querySelector(`tr[data-index="${rowIdx}"]`);
          const nameInput = tr ? tr.querySelector(".aiIngredientName") : null;
          const ingredientName = (nameInput?.value || "").trim();
          if (!ingredientName) {
            aiAssistSetStatus("Enter an ingredient name first.", "warn");
            return;
          }

          analyzeIngredientRow(rowIdx, ingredientName);
          return;
        }
        const row = event.target.closest("tr");
        if (!row) return;
        const idx = Number(row.dataset.index || "0");
        if (
          event.target.classList.contains("aiDeleteRow") ||
          event.target.closest(".aiDeleteRow")
        ) {
          const data = collectAiTableData();
          data.splice(idx, 1);
          renderAiTable(data);
          // Mark as unsaved when user deletes a row
          aiAssistState.savedToDish = false;
          return;
        }
        if (
          event.target.classList.contains("aiBrandSearchBtn") ||
          event.target.closest(".aiBrandSearchBtn")
        ) {
          openExistingBrandSearchModal(idx);
          return;
        }
        if (
          event.target.classList.contains("aiBrandAddBtn") ||
          event.target.closest(".aiBrandAddBtn")
        ) {
          openBrandIdentificationChoice(idx);
          return;
        }
        if (
          event.target.classList.contains("aiAppealScanBtn") ||
          event.target.closest(".aiAppealScanBtn")
        ) {
          const rowIdx = Number(
            event.target.dataset.rowIdx ||
              event.target.closest(".aiAppealScanBtn")?.dataset.rowIdx ||
              idx,
          );
          openAiAppealModal(rowIdx);
          return;
        }
        if (
          event.target.classList.contains("aiRemoveAppealBtn") ||
          event.target.closest(".aiRemoveAppealBtn")
        ) {
          const rowIdx = Number(
            event.target.dataset.rowIdx ||
              event.target.closest(".aiRemoveAppealBtn")?.dataset.rowIdx ||
              idx,
          );
          removeAppeal(rowIdx);
          return;
        }
        if (
          event.target.classList.contains("aiRemoveBrand") ||
          event.target.closest(".aiRemoveBrand")
        ) {
          const brandIdx = Number(
            event.target.dataset.brandIdx ||
              event.target.closest(".aiRemoveBrand")?.dataset.brandIdx,
          );
          debugLog("=== DELETE BRAND CLICKED ===");
          debugLog("Row idx:", idx);
          debugLog("Brand idx:", brandIdx);
          if (!isNaN(brandIdx)) {
            const data = collectAiTableData();
            debugLog("Current data before delete:", JSON.stringify(data[idx]));
            if (data[idx] && data[idx].brands) {
              debugLog(
                `Removing brand at index ${brandIdx} from ingredient "${data[idx].name}"`,
              );
              debugLog(
                "Brands before:",
                data[idx].brands.map((b) => b.name),
              );
              data[idx].brands.splice(brandIdx, 1);
              debugLog(
                "Brands after:",
                data[idx].brands.map((b) => b.name),
              );
              // Reset confirmed state since allergens/diets may have changed
              data[idx].confirmed = false;
              debugLog("Re-rendering table with updated data");
              renderAiTable(data);
              aiAssistSetStatus("Brand removed from this ingredient.", "info");
              // Mark as unsaved when user removes a brand
              aiAssistState.savedToDish = false;
            }
          }
          return;
        }
        // Three-state toggle for allergen/diet checkboxes: off → contains → crosscontamination → off
        const checkboxLabel = event.target.closest(
          ".aiAllergenChecklist label, .aiDietChecklist label",
        );
        if (
          checkboxLabel &&
          !checkboxLabel.classList.contains("selectionsDisabled")
        ) {
          event.preventDefault();
          event.stopPropagation();
          const checkbox = checkboxLabel.querySelector('input[type="checkbox"]');
          if (!checkbox || checkbox.disabled) return;

          const currentState = checkbox.dataset.state || "off";
          // Cycle: off → contains → crosscontamination → off
          const nextState =
            currentState === "off"
              ? "contains"
              : currentState === "contains"
                ? "crosscontamination"
                : "off";
          const wasAiDetected = checkbox.dataset.aiDetected === "true";
          const aiState = checkbox.dataset.aiState || "off"; // What AI originally suggested

          // Update checkbox state
          checkbox.dataset.state = nextState;
          checkbox.checked = nextState !== "off";
          checkbox.removeAttribute("data-overlap");

          // Update label class
          checkboxLabel.classList.remove("state-contains", "state-crosscontamination");
          checkboxLabel.dataset.state = nextState;
          if (nextState !== "off") {
            checkboxLabel.classList.add(`state-${nextState}`);
          }

          // Update stateOverridden class based on comparing current state to AI's original state
          // Override if: AI detected but state differs, OR AI didn't detect but user selected something
          const isOverridden =
            (wasAiDetected && nextState !== aiState) ||
            (!wasAiDetected && nextState !== "off");
          if (isOverridden) {
            checkboxLabel.classList.add("stateOverridden");
          } else {
            checkboxLabel.classList.remove("stateOverridden");
          }

          // Update icon
          // Remove any existing state icon (no longer showing emojis)
          let icon = checkboxLabel.querySelector(".state-icon");
          if (icon) icon.remove();

          // Update tooltip
          const tooltipParts = [];
          if (nextState === "contains") {
            tooltipParts.push(
              "Contains - tap to change to Cross-contamination risk",
            );
          } else if (nextState === "crosscontamination") {
            tooltipParts.push("Cross-contamination risk - tap to clear");
          } else {
            tooltipParts.push("Tap to mark as Contains");
          }
          if (isOverridden) {
            if (wasAiDetected && nextState === "off") {
              tooltipParts.push("⚠️ Website suggested Contains - you removed it");
            } else if (wasAiDetected && nextState === "crosscontamination") {
              tooltipParts.push(
                "⚠️ Website suggested Contains - you changed to Cross-contamination",
              );
            } else if (!wasAiDetected) {
              tooltipParts.push("⚠️ Manually added");
            }
          } else if (wasAiDetected) {
            tooltipParts.push("Suggested by website");
          }
          checkboxLabel.title = tooltipParts.join(" • ");

          // Mark as unsaved
          aiAssistState.savedToDish = false;

          // Reset confirm button
          resetConfirmButton(row);

          // Update preview and warning message
          updateAiPreview();
          updateOverrideWarningMessage(row);
          updateDietConflictMessage(row);
          return;
        }
        if (
          event.target.classList.contains("aiAddRememberedBrand") ||
          event.target.closest(".aiAddRememberedBrand")
        ) {
          debugLog("=== ADD REMEMBERED BRAND CLICKED ===");
          const data = collectAiTableData();
          const ingredientName = data[idx]?.name;
          if (ingredientName) {
            const memory = getRememberedBrand(ingredientName);
            if (memory && memory.brand) {
              debugLog(
                `Adding remembered brand "${memory.brand}" for "${ingredientName}"`,
              );
              // Initialize brands array if needed
              if (!data[idx].brands) {
                data[idx].brands = [];
              }
              // Check if this brand is already added
              const brandExists = data[idx].brands.some(
                (b) => b.name === memory.brand,
              );
              if (!brandExists) {
                // IMPORTANT: Only copy brand name and image - NOT ingredient data!
                // The same brand makes different products with different ingredients.
                // E.g., Pacific vegetable broth vs Pacific pita bread are completely different.
                // User needs to scan the actual product to get correct ingredients.
                data[idx].brands.push({
                  name: memory.brand,
                  brandImage: memory.brandImage || "",
                  ingredientsImage: "", // Don't copy - needs fresh scan
                  ingredientsList: [], // Don't copy - needs fresh scan
                  allergens: [], // Don't copy - needs fresh scan
                  diets: [], // Don't copy - needs fresh scan
                });
                // Don't reset confirmed state since we haven't added allergen/diet info yet
                renderAiTable(data);
                aiAssistSetStatus(
                  `Added brand "${memory.brand}". Upload an ingredient label to get ingredients for this product.`,
                  "info",
                );
                // Mark as unsaved when user adds a brand
                aiAssistState.savedToDish = false;
              } else {
                aiAssistSetStatus(
                  `Brand "${memory.brand}" is already added.`,
                  "info",
                );
              }
            }
          }
          return;
        }
        if (event.target.classList.contains("aiConfirmBtn")) {
          const btn = event.target;

          // Check if button is disabled (scan required but not completed)
          if (btn.disabled) {
            aiAssistSetStatus(
              "Please add an ingredient label or appeal before confirming this ingredient.",
              "warn",
            );
            return;
          }

          const isConfirmed = btn.dataset.confirmed === "true";

          // Toggle state
          if (isConfirmed) {
            // Unconfirm
            btn.dataset.confirmed = "false";
            btn.classList.remove("confirmed");
            btn.classList.add("unconfirmed");
            btn.style.background = "#f59e0b";
            btn.style.borderColor = "#f59e0b";
            btn.textContent = "Confirm";
          } else {
            // Confirm
            btn.dataset.confirmed = "true";
            btn.classList.remove("unconfirmed");
            btn.classList.add("confirmed");
            btn.style.background = "#4caf50";
            btn.style.borderColor = "#4caf50";
            btn.textContent = "✓ Confirmed";

            // Hide save error message if shown (since user is now confirming)
            const saveErrorEl = document.getElementById("aiAssistSaveError");
            if (saveErrorEl) saveErrorEl.style.display = "none";
          }

          // Mark as unsaved when confirmation status changes
          aiAssistState.savedToDish = false;
          return;
        }
      });
      aiAssistTableBody.addEventListener("input", (event) => {
        const row = event.target.closest("tr");
        if (!row) return;
        if (event.target.classList.contains("aiIngredientName")) {
          // Do not re-render on each keystroke; AI checks happen on change/Apply.
        }
        // Reset confirm button when user makes changes
        resetConfirmButton(row);
        // Mark as unsaved when user makes changes
        aiAssistState.savedToDish = false;
        // Update preview
        updateAiPreview();
      });
      aiAssistTableBody.addEventListener("change", (event) => {
        const row = event.target.closest("tr");
        if (!row) return;

        if (event.target.classList.contains("aiIngredientName")) {
          const rowIdx = Number(row.dataset.index || "0");
          if (aiAssistState.skipNameChangeRowIdx === rowIdx) {
            aiAssistState.skipNameChangeRowIdx = null;
            return;
          }
          const data = collectAiTableData();
          const entry = data[rowIdx];
          if (entry) {
            entry.name = (event.target.value || "").trim();
            entry.requiresApply = true;
            entry.confirmed = false;
            entry.needsScan = undefined;
            entry.scanDecisionSource = null;
            entry.scanDecisionName = null;
            entry.analysisPending = false;
            entry.analysisMessage = "";
            entry.aiDetectionCompleted = false;
            entry.aiDetectedAllergens = [];
            entry.aiDetectedDiets = [];
            entry.aiDetectedCrossContamination = [];
            entry.aiDetectedCrossContaminationDiets = [];
            entry.allergens = [];
            entry.diets = [];
            entry.crossContamination = [];
            entry.crossContaminationDiets = [];
          }
          renderAiTable(data);
          updateAiPreview();
          return;
        }

        // If allergen or diet checkbox changed, re-render to show override status
        if (
          event.target.classList.contains("aiAllergenCheckbox") ||
          event.target.classList.contains("aiDietCheckbox")
        ) {
          // Small delay to ensure checkbox state is updated before collecting data
          setTimeout(() => {
            const data = collectAiTableData();
            renderAiTable(data);
            // Update preview after re-render
            updateAiPreview();
          }, 0);
        }

        // Reset confirm button when checkboxes/radios change
        resetConfirmButton(row);
        // Mark as unsaved when checkboxes/radios change
        aiAssistState.savedToDish = false;
        // Update preview
        updateAiPreview();
      });
      aiAssistBrandResults.addEventListener("click", (event) => {
        const card = event.target.closest(".aiBrandSuggestion");
        if (!card) return;
        const rowIdx = Number(card.dataset.row || "0");
        const suggestionIdx = Number(card.dataset.index || "0");
        applyBrandSuggestion(rowIdx, suggestionIdx);
      });
      updateAiAssistMediaPreview();
      aiAssistElementsBound = true;
    }
  }

  let scrollLockPosition = 0;

  function toggleAiAssistBackdrop(show) {
    ensureAiAssistElements();
    if (!aiAssistBackdrop) return;
    if (show) {
      // Update generate button text when assistant opens
      if (typeof window.updateGenerateButtonText === "function") {
        window.updateGenerateButtonText();
      } else if (aiAssistGenerateBtn) {
        const nameInput = document.getElementById("aiAssistNameInput");
        if (nameInput) {
          const dishName = nameInput.value?.trim() || "recipe";
          aiAssistGenerateBtn.textContent = `✨ Generate generic ${dishName} recipe`;
        }
      }
      // Re-bind the Save to Dish button every time we show the panel
      // This ensures the handler is attached even if the button was recreated
      const applyBtn = document.getElementById("aiAssistApplyBtn");
      debugLog(
        "toggleAiAssistBackdrop: Re-binding Save to Dish button:",
        applyBtn,
      );
      if (applyBtn) {
        // Remove any existing listeners by cloning the button
        const newApplyBtn = applyBtn.cloneNode(true);
        applyBtn.parentNode.replaceChild(newApplyBtn, applyBtn);
        newApplyBtn.addEventListener("click", () => {
          debugLog("Save to Dish button clicked!");
          applyAiIngredientsToOverlay();
        });
        aiAssistApplyBtn = newApplyBtn;
      } else {
        console.error("toggleAiAssistBackdrop: aiAssistApplyBtn not found!");
      }

      aiAssistBackdrop.classList.add("show");
      aiAssistBackdrop.setAttribute("aria-hidden", "false");
      // Mobile-safe scroll lock: store position and fix body
      scrollLockPosition =
        window.pageYOffset || document.documentElement.scrollTop;
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollLockPosition}px`;
      document.body.style.width = "100%";
      document.body.style.overflow = "hidden";
    } else {
      aiAssistBackdrop.classList.remove("show");
      aiAssistBackdrop.setAttribute("aria-hidden", "true");
      // Restore scroll position and body styles
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      document.body.style.overflow = "";
      window.scrollTo(0, scrollLockPosition);
    }
  }

  function updateAiAssistMediaPreview() {
    ensureAiAssistElements();
    const hasStream = !!aiAssistState.mediaStream;
    if (aiAssistMediaPreview) {
      aiAssistMediaPreview.classList.toggle("show", hasStream);
    }
    if (aiAssistVideo) {
      if (hasStream) {
        aiAssistVideo.classList.remove("aiAssistHidden");
        if (aiAssistVideo.srcObject !== aiAssistState.mediaStream) {
          aiAssistVideo.srcObject = aiAssistState.mediaStream;
        }
        aiAssistVideo.play().catch(() => {});
      } else {
        try {
          aiAssistVideo.pause();
        } catch (_) {}
        aiAssistVideo.srcObject = null;
        aiAssistVideo.classList.add("aiAssistHidden");
      }
    }
    if (aiAssistCaptureBtn) {
      aiAssistCaptureBtn.classList.toggle("aiAssistHidden", !hasStream);
    }
    if (aiAssistCancelCameraBtn) {
      aiAssistCancelCameraBtn.classList.toggle("aiAssistHidden", !hasStream);
    }
  }

  // Compress image to reduce payload size
  function compressImage(dataUrl, maxWidth = 1200, quality = 0.8) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = dataUrl;
    });
  }

  const photoApi = initDishEditorPhotos({
    ensureAiAssistElements,
    aiAssistState,
    compressImage,
    aiAssistSetStatus,
    updateAiAssistMediaPreview,
    getVideoEl: () => aiAssistVideo,
  });
  renderPhotoPreviews = photoApi.renderPhotoPreviews;
  handleMultipleRecipePhotoUpload = photoApi.handleMultipleRecipePhotoUpload;
  handleRecipePhotoCamera = photoApi.handleRecipePhotoCamera;

  async function startAiCamera() {
    ensureAiAssistElements();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      aiAssistSetStatus(
        "Camera capture is not supported in this browser.",
        "warn",
      );
      return;
    }
    try {
      if (aiAssistState.mediaStream) {
        stopAiCamera();
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      aiAssistState.mediaStream = stream;
      updateAiAssistMediaPreview();
      aiAssistSetStatus(
        "Camera ready. Capture the recipe photo when it looks clear.",
        "info",
      );
    } catch (err) {
      console.error("Camera error", err);
      aiAssistSetStatus(
        "Could not access the camera: " + (err.message || err),
        "warn",
      );
    }
  }

  function stopAiCamera(notify) {
    ensureAiAssistElements();
    if (aiAssistState.mediaStream) {
      try {
        aiAssistState.mediaStream.getTracks().forEach((track) => track.stop());
      } catch (_) {}
    }
    aiAssistState.mediaStream = null;
    if (aiAssistVideo) {
      try {
        aiAssistVideo.pause();
      } catch (_) {}
      aiAssistVideo.srcObject = null;
    }
    updateAiAssistMediaPreview();
    if (notify) {
      aiAssistSetStatus("Camera closed.", "info");
    }
  }

  async function captureAiPhoto() {
    ensureAiAssistElements();
    if (!aiAssistVideo || !aiAssistState.mediaStream) {
      aiAssistSetStatus("Start the camera before capturing a photo.", "warn");
      return;
    }
    const width = aiAssistVideo.videoWidth || 1280;
    const height = aiAssistVideo.videoHeight || 720;
    if (!width || !height) {
      aiAssistSetStatus(
        "Camera is still focusing. Try capturing again in a moment.",
        "warn",
      );
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      aiAssistSetStatus("Could not capture the photo.", "warn");
      return;
    }
    ctx.drawImage(aiAssistVideo, 0, 0, width, height);
    const rawImage = canvas.toDataURL("image/jpeg", 0.92);

    // Compress the captured photo
    const compressed = await compressImage(rawImage);

    // Add to photos array for multi-photo workflow
    if (!window.aiAssistPhotos) window.aiAssistPhotos = [];
    window.aiAssistPhotos.push(compressed);

    stopAiCamera();
    renderPhotoPreviews();
    aiAssistSetStatus("Photo captured. Review before processing.", "success");
  }

  function getRowIngredientsList(rowElement) {
    if (!rowElement) return [];
    return parseJsonArray(rowElement.dataset.ingredientsList);
  }

  function updateAiBrandPreview(rowElement) {
    if (!rowElement) return;
    const brandPreview = rowElement.querySelector(".aiBrandPreview");
    if (brandPreview) {
      const parts = [];
      const brandImage = rowElement.dataset.brandImage || "";
      // Only show brandImage (product front photo) in thumbnail, not ingredientsImage
      if (brandImage)
        parts.push(
          `<img src="${esc(brandImage)}" alt="Brand preview" loading="lazy" onclick="openImageModal('${esc(brandImage)}')" title="Click to enlarge">`,
        );
      brandPreview.innerHTML = parts.join("");
    }
    const listNote = rowElement.querySelector(".aiIngredientList");
    if (listNote) {
      const list = getRowIngredientsList(rowElement);
      listNote.textContent = list.length
        ? `Label ingredients: ${list.join(", ")}`
        : "";
    }
  }

  function collectAiTableData() {
    ensureAiAssistElements();
    if (!aiAssistTableBody) return [];
    const data = [];
    aiAssistTableBody.querySelectorAll("tr").forEach((row) => {
      const idx = Number(row.dataset.index || "0");
      const name = row.querySelector(".aiIngredientName")?.value.trim() || "";
      // Collect allergens based on state (contains vs crosscontamination)
      const allergens = [
        ...row.querySelectorAll(".aiAllergenChecklist input:checked"),
      ]
        .filter((input) => input.dataset.state !== "crosscontamination")
        .map((input) => input.value)
        .filter((value) => value !== undefined && value !== null && value !== "");
      let crossContamination = [
        ...row.querySelectorAll(
          '.aiAllergenChecklist input[data-state="crosscontamination"]',
        ),
      ]
        .map((input) => input.value)
        .filter((value) => value !== undefined && value !== null && value !== "");
      const overlapAllergens = [
        ...row.querySelectorAll(
          '.aiAllergenChecklist input[data-overlap="true"]',
        ),
      ]
        .filter((input) => (input.dataset.state || "off") !== "off")
        .map((input) => input.value)
        .filter((value) => value !== undefined && value !== null && value !== "");
      if (overlapAllergens.length) {
        crossContamination = Array.from(
          new Set([...crossContamination, ...overlapAllergens]),
        );
      }
      // Collect diets based on state (contains vs crosscontamination)
      const diets = [...row.querySelectorAll(".aiDietChecklist input:checked")]
        .filter((input) => input.dataset.state !== "crosscontamination")
        .map((input) => input.value)
        .filter((value) => value !== undefined && value !== null && value !== "");
      let crossContaminationDiets = [
        ...row.querySelectorAll(
          '.aiDietChecklist input[data-state="crosscontamination"]',
        ),
      ]
        .map((input) => input.value)
        .filter((value) => value !== undefined && value !== null && value !== "");
      const overlapDiets = [
        ...row.querySelectorAll('.aiDietChecklist input[data-overlap="true"]'),
      ]
        .filter((input) => (input.dataset.state || "off") !== "off")
        .map((input) => input.value)
        .filter((value) => value !== undefined && value !== null && value !== "");
      if (overlapDiets.length) {
        crossContaminationDiets = Array.from(
          new Set([...crossContaminationDiets, ...overlapDiets]),
        );
      }
      const confirmed =
        row.querySelector(".aiConfirmBtn")?.dataset.confirmed === "true";

      // Collect removable status from checkbox (unchecked by default = not substitutable)
      const removableCheckbox = row.querySelector(".aiRemovableCheckbox");
      const removable = removableCheckbox?.checked || false;

      debugLog(
        `collectAiTableData row ${idx} (${name}): removable=${removable}, removableCheckbox=`,
        removableCheckbox,
        "checked=",
        removableCheckbox?.checked,
      );

      // Collect multiple brands
      const parsedBrands = parseJsonArray(row.dataset.brands);
      const brands = toArray(parsedBrands);
      if (brands.length) {
        debugLog(`Row ${idx} brands from dataset:`, brands);
      }

      // Preserve AI-detected allergens and diets (originally detected by AI from recipe)
      const aiDetectedAllergens = parseJsonArray(
        row.dataset.aiDetectedAllergens,
      );
      const aiDetectedDiets = parseJsonArray(row.dataset.aiDetectedDiets);
      const aiDetectedCrossContamination = parseJsonArray(
        row.dataset.aiDetectedCrossContamination,
      );
      const aiDetectedCrossContaminationDiets = parseJsonArray(
        row.dataset.aiDetectedCrossContaminationDiets,
      );

      // Preserve needsScan and userOverriddenScan fields
      const needsScanDefined = row.dataset.needsScan !== undefined;
      const needsScan = needsScanDefined
        ? row.dataset.needsScan === "true" || row.dataset.needsScan === true
        : undefined;
      const userOverriddenScan =
        row.dataset.userOverriddenScan === "true" ||
        row.dataset.userOverriddenScan === true;
      const appealReviewStatus = row.dataset.appealReviewStatus || null;
      const appealReviewNotes = row.dataset.appealReviewNotes || null;
      const scanDecisionSource = row.dataset.scanDecisionSource || null;
      const scanDecisionName = row.dataset.scanDecisionName || null;
      const analysisPending = row.dataset.analysisPending === "true";
      const analysisMessage = row.dataset.analysisMessage || "";
      const requiresApply = row.dataset.requiresApply === "true";
      const issueReported = row.dataset.issueReported === "true";
      const brandImage = row.dataset.brandImage || "";
      debugLog(
        `COLLECT row ${idx}: dataset.needsScan="${row.dataset.needsScan}", dataset.userOverriddenScan="${row.dataset.userOverriddenScan}" -> boolean needsScan=${needsScan}, userOverriddenScan=${userOverriddenScan}`,
      );

      // IMPORTANT: Merge brand allergens/diets into the collected allergens/diets
      // This ensures that brand allergens are always included even if checkboxes weren't checked yet

      // Get all checkbox states (off/contains/crosscontamination) to track user overrides
      const allCheckboxStates = {
        allergens: new Map(), // value -> { state: 'off'|'contains'|'crosscontamination', checked: boolean }
        diets: new Map(),
      };
      row.querySelectorAll(".aiAllergenChecklist input").forEach((input) => {
        const key = input.value;
        if (key === undefined || key === null || key === "") return;
        const state =
          input.dataset.state || (input.checked ? "contains" : "off");
        allCheckboxStates.allergens.set(key, {
          state,
          checked: input.checked,
        });
      });
      row.querySelectorAll(".aiDietChecklist input").forEach((input) => {
        const key = input.value;
        if (key === undefined || key === null || key === "") return;
        const state =
          input.dataset.state || (input.checked ? "contains" : "off");
        allCheckboxStates.diets.set(key, {
          state,
          checked: input.checked,
        });
      });

      const allAllergens = new Set(allergens);
      const allDiets = new Set(diets);
      const allCrossContamination = new Set(crossContamination);
      const allCrossContaminationDiets = new Set(crossContaminationDiets);

      // Merge brand allergens/diets, but ONLY if user hasn't set them to 'off'
      brands.forEach((brand) => {
        if (Array.isArray(brand.allergens)) {
          brand.allergens.forEach((a) => {
            if (a === undefined || a === null || a === "") return;
            const stateInfo = allCheckboxStates.allergens.get(a);
            if (stateInfo?.state !== "off") {
              if (stateInfo?.state === "crosscontamination") {
                allCrossContamination.add(a);
              } else {
                allAllergens.add(a);
              }
            }
          });
        }
        if (Array.isArray(brand.diets)) {
          brand.diets.forEach((d) => {
            if (d === undefined || d === null || d === "") return;
            const stateInfo = allCheckboxStates.diets.get(d);
            if (stateInfo?.state !== "off") {
              if (stateInfo?.state === "crosscontamination") {
                allCrossContaminationDiets.add(d);
              } else {
                allDiets.add(d);
              }
            }
          });
        }
      });

      // Convert back to arrays
      const mergedAllergens = Array.from(allAllergens);
      const mergedDiets = Array.from(allDiets);
      const mergedCrossContamination = Array.from(allCrossContamination);
      const mergedCrossContaminationDiets = Array.from(allCrossContaminationDiets);

      debugLog(
        `Row ${idx} merged allergens:`,
        mergedAllergens,
        "cross-contamination allergens:",
        mergedCrossContamination,
        "merged diets:",
        mergedDiets,
        "cross-contamination diets:",
        mergedCrossContaminationDiets,
      );

      const entry = {
        index: idx,
        name,
        allergens: mergedAllergens,
        diets: mergedDiets,
        crossContamination: mergedCrossContamination,
        crossContaminationDiets: mergedCrossContaminationDiets,
        brands,
        confirmed,
        removable,
        aiDetectedAllergens,
        aiDetectedDiets,
        aiDetectedCrossContamination,
        aiDetectedCrossContaminationDiets,
        needsScan,
        userOverriddenScan,
        appealReviewStatus,
        appealReviewNotes,
        scanDecisionSource,
        scanDecisionName,
        analysisPending,
        analysisMessage,
        requiresApply,
        issueReported,
        brandImage,
      };
      data.push(entry);
    });
    debugLog("collectAiTableData final data:", data);
    return data;
  }

  // Make collectAiTableData globally accessible for auto-fill
  window.collectAiTableData = collectAiTableData;

  function resetConfirmButton(rowElement) {
    if (!rowElement) return;
    const btn = rowElement.querySelector(".aiConfirmBtn");
    if (!btn) return;

    const wasConfirmed = btn.dataset.confirmed === "true";
    if (!wasConfirmed) return; // Already unconfirmed, no need to reset

    // Reset to unconfirmed state
    btn.dataset.confirmed = "false";
    btn.classList.remove("confirmed");
    btn.classList.add("unconfirmed");
    btn.style.background = "#f59e0b";
    btn.style.borderColor = "#f59e0b";
    btn.textContent = "Confirm";
  }

  function updateAiPreview() {
    const previewBox = document.getElementById("aiAssistPreviewBox");
    if (!previewBox) return;

    const rows = collectAiTableData();
    if (!rows || rows.length === 0) {
      previewBox.innerHTML =
        '<div style="color:#8891b0;font-style:italic">Add ingredients to see preview</div>';
      return;
    }

    // Build a temporary overlay object from the AI table data
    const tempOverlay = {
      id: document.getElementById("aiAssistNameInput")?.value || "Dish Name",
      allergens: [],
      diets: [],
      details: {},
      removable: [],
      crossContamination: [],
      ingredientsBlockingDiets: {},
    };

    // Aggregate allergens from all ingredients (OR logic - any ingredient with allergen adds it to dish)
    // Track which ingredients contain each allergen, and whether each is removable
    // An allergen is only "removable" if ALL ingredients containing it are removable
    const allergenDetails = {};
    const allergenIngredientInfo = {}; // { allergen: { ingredients: [...], allRemovable: true/false } }
    rows.forEach((row) => {
      if (Array.isArray(row.allergens)) {
        row.allergens.forEach((allergen) => {
          const key = allergen;
          if (
            key !== undefined &&
            key !== null &&
            key !== "" &&
            !tempOverlay.allergens.includes(key)
          ) {
            tempOverlay.allergens.push(key);
          }
          // Add ingredient detail
          const ingredientLabel = row.name || "";
          const brandLabel =
            row.brands && row.brands.length > 0 ? row.brands[0].name : "";
          const fullLabel = brandLabel
            ? `${ingredientLabel} (${brandLabel})`
            : ingredientLabel;
          if (fullLabel) {
            if (!allergenDetails[key]) allergenDetails[key] = [];
            if (!allergenDetails[key].includes(fullLabel)) {
              allergenDetails[key].push(fullLabel);
            }
          }

          // Track ingredient info for this allergen to determine if ALL are removable
          if (!allergenIngredientInfo[key]) {
            allergenIngredientInfo[key] = { ingredients: [], allRemovable: true };
          }
          allergenIngredientInfo[key].ingredients.push(
            fullLabel || ingredientLabel || "Ingredient",
          );
          // If ANY ingredient with this allergen is NOT removable, the allergen is not removable
          if (row.removable !== true) {
            allergenIngredientInfo[key].allRemovable = false;
          }
        });
      }
    });

    // Build removable array - only if ALL ingredients with that allergen are removable
    Object.entries(allergenIngredientInfo).forEach(([allergen, info]) => {
      if (info.allRemovable && info.ingredients.length > 0) {
        const detail =
          allergenDetails[allergen] && allergenDetails[allergen].length > 0
            ? allergenDetails[allergen].join(", ")
            : allergen;
        tempOverlay.removable.push({ allergen, component: detail });
      }
    });

    // For dietary preferences, use AND logic - dish is only vegan if ALL ingredients are vegan
    // Start with all possible diets, then remove any that aren't supported by ALL ingredients
    const dietOptions = DIETS.slice();
    let dishDiets = new Set(dietOptions);

    // Track which ingredients block each diet and whether they're removable
    const ingredientsBlockingDiets = {};
    dietOptions.forEach((diet) => {
      ingredientsBlockingDiets[diet] = [];
    });

    // Track diet cross-contamination
    const dishCrossContaminationDiets = new Set();

    rows.forEach((row) => {
      // Include crossContaminationDiets since those are still supported, just with cross-contamination risk
      const ingredientDiets = new Set([
        ...(row.diets || []),
        ...(row.crossContaminationDiets || []),
      ]);
      const isIngredientRemovable = row.removable === true;
      const ingredientName = row.name || "";

      // Track crossContaminationDiets at dish level for cross-contamination warning
      if (Array.isArray(row.crossContaminationDiets)) {
        row.crossContaminationDiets.forEach((d) => dishCrossContaminationDiets.add(d));
      }

      // Track which diets this ingredient blocks
      dishDiets.forEach((diet) => {
        if (!ingredientDiets.has(diet)) {
          // This ingredient doesn't support this diet - track it
          if (!ingredientsBlockingDiets[diet]) {
            ingredientsBlockingDiets[diet] = [];
          }
          ingredientsBlockingDiets[diet].push({
            name: ingredientName,
            removable: isIngredientRemovable,
          });
        }
      });
    });

    // Store information about which ingredients block diets for use in preview
    tempOverlay.diets = Array.from(dishDiets);
    tempOverlay.ingredientsBlockingDiets = ingredientsBlockingDiets;
    tempOverlay.crossContaminationDiets = Array.from(dishCrossContaminationDiets);

    // Add details text
    Object.keys(allergenDetails).forEach((key) => {
      const items = allergenDetails[key];
      if (items.length > 0) {
        tempOverlay.details[key] = `Contains ${items.join(", ")}`;
      }
    });

    // Collect cross-contamination allergens from ingredient rows
    const crossContaminationFromRows = new Set();
    rows.forEach((row) => {
      if (Array.isArray(row.crossContamination)) {
        row.crossContamination.forEach((allergen) => {
          const key = allergen;
          if (key !== undefined && key !== null && key !== "") {
            crossContaminationFromRows.add(key);
          }
        });
      }
    });

    tempOverlay.crossContamination = Array.from(crossContaminationFromRows);
    tempOverlay.noCrossContamination = crossContaminationFromRows.size === 0;

    // Use the same tooltip HTML generator that's used for the actual overlays
    const allAllergens = ALLERGENS.slice();
    const allDiets = DIETS.slice();
    let html = tooltipBodyHTML(tempOverlay, allAllergens, allDiets, true);

    // Note: Cross-contamination information is already included in tooltipBodyHTML,
    // so we don't need to add it again here

    previewBox.innerHTML =
      html ||
      '<div style="color:#8891b0;font-style:italic">No preview available</div>';
  }

  // Dynamically update the override warning message when checkboxes are toggled
  function updateOverrideWarningMessage(rowElement) {
    // Find the allergen checklist container in this row
    const allergenChecklist = rowElement.querySelector(".aiAllergenChecklist");
    if (!allergenChecklist) return;

    // Find existing warning message or the spot to insert one
    let warningDiv = rowElement.querySelector(".overrideWarningMessage");

    // Get all overridden items
    const overriddenItems = [];

    // Check allergen checkboxes - compare current state to AI state
    rowElement.querySelectorAll(".aiAllergenChecklist input").forEach((cb) => {
      const aiState = cb.dataset.aiState || "off";
      const currentState = cb.dataset.state || "off";
      const allergen = cb.value;
      const capAllergen = formatAllergenLabel(allergen);
      const aiLabel =
        aiState === "contains"
          ? "Contains"
          : aiState === "crosscontamination"
            ? "Cross-contamination risk"
            : null;
      const userLabel =
        currentState === "contains"
          ? "Contains"
          : currentState === "crosscontamination"
            ? "Cross-contamination risk"
            : null;

      if (aiState !== "off" && currentState === "off") {
        overriddenItems.push(
          `${capAllergen} (AI detected: ${aiLabel} → you removed)`,
        );
      } else if (aiState === "off" && currentState !== "off") {
        overriddenItems.push(`${capAllergen} (you added as: ${userLabel})`);
      } else if (
        aiState !== "off" &&
        currentState !== "off" &&
        aiState !== currentState
      ) {
        overriddenItems.push(
          `${capAllergen} (AI: ${aiLabel} → you: ${userLabel})`,
        );
      }
    });

    // Check diet checkboxes - compare current state to AI state
    rowElement.querySelectorAll(".aiDietChecklist input").forEach((cb) => {
      const aiState = cb.dataset.aiState || "off";
      const currentState = cb.dataset.state || "off";
      const diet = cb.value;
      const aiLabel =
        aiState === "contains"
          ? "Compliant"
          : aiState === "crosscontamination"
            ? "Cross-contamination risk"
            : null;
      const userLabel =
        currentState === "contains"
          ? "Compliant"
          : currentState === "crosscontamination"
            ? "Cross-contamination risk"
            : null;

      if (aiState !== "off" && currentState === "off") {
        overriddenItems.push(`${diet} (AI detected: ${aiLabel} → you removed)`);
      } else if (aiState === "off" && currentState !== "off") {
        overriddenItems.push(`${diet} (you added as: ${userLabel})`);
      } else if (
        aiState !== "off" &&
        currentState !== "off" &&
        aiState !== currentState
      ) {
        overriddenItems.push(`${diet} (AI: ${aiLabel} → you: ${userLabel})`);
      }
    });

    // Find the container that holds the checklists (parent of the flex container)
    const checklistFlexContainer = allergenChecklist
      .closest('[style*="display:flex"]')
      ?.closest('[style*="display:flex"]');

    if (overriddenItems.length > 0) {
      const messageHtml = `<div class="overrideWarningMessage" style="color:#ef4444;font-size:0.85rem;margin-top:8px;padding:8px;background:rgba(239,68,68,0.1);border-radius:6px;border:1px solid rgba(239,68,68,0.3);width:100%">You have overridden the smart detection: ${overriddenItems.join(", ")}</div>`;

      if (warningDiv) {
        warningDiv.outerHTML = messageHtml;
      } else if (checklistFlexContainer) {
        // Insert after the checklist container
        checklistFlexContainer.insertAdjacentHTML("afterend", messageHtml);
      }
    } else if (warningDiv) {
      // No overrides, remove the warning message
      warningDiv.remove();
    }
  }

  function updateDietConflictMessage(rowElement) {
    if (!rowElement) return;

    const allergenInputs = rowElement.querySelectorAll(
      ".aiAllergenChecklist input",
    );
    const dietInputs = rowElement.querySelectorAll(".aiDietChecklist input");
    if (!allergenInputs.length || !dietInputs.length) return;

    const selectedAllergens = new Set();
    allergenInputs.forEach((input) => {
      const state = input.dataset.state || (input.checked ? "contains" : "off");
      if (state === "contains") {
        const key = input.value;
        if (key !== undefined && key !== null && key !== "") {
          selectedAllergens.add(key);
        }
      }
    });

    const selectedDiets = new Set();
    dietInputs.forEach((input) => {
      const state = input.dataset.state || (input.checked ? "contains" : "off");
      if (state === "contains") {
        const diet = input.value;
        if (diet !== undefined && diet !== null && diet !== "") {
          selectedDiets.add(diet);
        }
      }
    });

    const conflicts = [];

    selectedDiets.forEach((diet) => {
      const restricted = getDietAllergenConflicts(diet);
      if (!restricted.length) return;
      const hits = restricted.filter((allergen) =>
        selectedAllergens.has(allergen),
      );
      if (hits.length) conflicts.push({ diet, allergens: hits });
    });

    const existing = rowElement.querySelector(".aiDietConflictMessage");
    const rowContainer = rowElement.closest("tr") || rowElement;

    if (conflicts.length === 0) {
      if (existing) existing.remove();
      return;
    }

    const details = conflicts
      .map((conflict) => {
        const dietLabel = esc(conflict.diet);
        const allergenList = conflict.allergens
          .map((allergen) => esc(formatAllergenLabel(allergen)))
          .join(", ");
        return `<div><strong>${dietLabel}</strong> conflicts with ${allergenList}</div>`;
      })
      .join("");

    if (existing) {
      existing.innerHTML = details;
    } else {
      const messageHtml = `<div class="aiDietConflictMessage">${details}</div>`;
      const overrideMessage = rowElement.querySelector(".overrideWarningMessage");
      const selectionGuard = rowElement.querySelector(".aiSelectionGuard");
      const checklistFlexContainer = rowElement
        .querySelector(".aiAllergenChecklist")
        ?.closest('[style*="display:flex"]')
        ?.closest('[style*="display:flex"]');
      const insertAfter =
        overrideMessage || selectionGuard || checklistFlexContainer;
      if (insertAfter?.insertAdjacentHTML) {
        insertAfter.insertAdjacentHTML("afterend", messageHtml);
      }
    }

    if (rowContainer?.dataset) {
      rowContainer.dataset.dietConflicts = JSON.stringify(conflicts);
    }
  }

  function renderAiTable(rows) {
    ensureAiAssistElements();
    if (!aiAssistTableBody || !aiAssistResultsEl) return;
    const source = Array.isArray(rows) ? rows : collectAiTableData();
    const data = source.map((item) => {
      const copy = { ...item };
      copy.aiDetectionCompleted = copy.aiDetectionCompleted === true;

      if (copy.aiDetectedAllergens === undefined) {
        copy.aiDetectedAllergens = Array.isArray(copy.allergens)
          ? copy.allergens.slice()
          : [];
      } else if (Array.isArray(copy.aiDetectedAllergens)) {
        copy.aiDetectedAllergens = copy.aiDetectedAllergens.slice();
      } else {
        copy.aiDetectedAllergens = [];
      }

      if (copy.aiDetectedDiets === undefined) {
        copy.aiDetectedDiets = Array.isArray(copy.diets)
          ? copy.diets.slice()
          : [];
      } else if (Array.isArray(copy.aiDetectedDiets)) {
        copy.aiDetectedDiets = copy.aiDetectedDiets.slice();
      } else {
        copy.aiDetectedDiets = [];
      }

      // Also copy aiDetectedCrossContamination (allergens detected from "cross-contamination" sections)
      if (Array.isArray(copy.aiDetectedCrossContamination)) {
        copy.aiDetectedCrossContamination =
          copy.aiDetectedCrossContamination.slice();
      } else {
        copy.aiDetectedCrossContamination = [];
      }

      // Also copy aiDetectedCrossContaminationDiets (diets affected by cross-contamination allergens)
      if (Array.isArray(copy.aiDetectedCrossContaminationDiets)) {
        copy.aiDetectedCrossContaminationDiets = copy.aiDetectedCrossContaminationDiets.slice();
      } else {
        copy.aiDetectedCrossContaminationDiets = [];
      }

      return copy;
    });
    debugLog(
      "renderAiTable called with rows:",
      rows && rows.length
        ? rows.map((r) => ({
            name: r.name,
            needsScan: r.needsScan,
            userOverriddenScan: r.userOverriddenScan,
          }))
        : "no rows",
    );

    aiAssistTableBody.innerHTML = "";
    aiAssistState.brandSuggestions = {};
    data.forEach((row, idx) => {
      // Initialize brands array if not present
      if (!row.brands) {
        row.brands = [];
      }

      // NOTE: We NO LONGER load brands from memory here during render.
      // Brands from memory are only loaded when:
      // 1. AI returns initial results (in handleDishEditorResult)
      // 2. User opens a saved draft
      // This prevents the infinite loop where deleting a brand causes it to reload from memory.
      // The memory is now purely for auto-populating NEW ingredients, not re-populating deleted brands.

      const tr = document.createElement("tr");
      tr.dataset.index = idx;
      const allergens = new Set((row.allergens || []).map(norm));

      // Support multiple brands - store in dataset
      const brands = row.brands || [];
      if (brands.length > 0) {
        tr.dataset.brands = JSON.stringify(brands);
      } else {
        delete tr.dataset.brands;
      }

      // Store AI-detected allergens/diets from base ingredient (if this is first render from AI)
      // If row doesn't have aiDetectedAllergens, it means this is the first time rendering from AI results
      // so the current allergens/diets ARE the AI-detected ones
      const baseAiDetectedAllergens = toArray(row.aiDetectedAllergens);
      const baseAiDetectedDiets = toArray(row.aiDetectedDiets);
      const baseAiDetectedCrossContamination = toArray(
        row.aiDetectedCrossContamination,
      );
      const baseAiDetectedCrossContaminationDiets = toArray(
        row.aiDetectedCrossContaminationDiets,
      );

      // Store in dataset so we can preserve them across re-renders
      tr.dataset.aiDetectedAllergens = JSON.stringify(baseAiDetectedAllergens);
      tr.dataset.aiDetectedDiets = JSON.stringify(baseAiDetectedDiets);
      tr.dataset.aiDetectedCrossContamination = JSON.stringify(
        baseAiDetectedCrossContamination,
      );
      tr.dataset.aiDetectedCrossContaminationDiets = JSON.stringify(
        baseAiDetectedCrossContaminationDiets,
      );

      // Preserve needsScan and userOverriddenScan in dataset
      if (typeof row.needsScan === "boolean") {
        tr.dataset.needsScan = String(row.needsScan);
      } else {
        delete tr.dataset.needsScan;
      }
      if (row.userOverriddenScan !== undefined) {
        tr.dataset.userOverriddenScan = String(row.userOverriddenScan);
      }
      if (row.scanDecisionSource) {
        tr.dataset.scanDecisionSource = row.scanDecisionSource;
      } else {
        delete tr.dataset.scanDecisionSource;
      }
      if (row.scanDecisionName) {
        tr.dataset.scanDecisionName = row.scanDecisionName;
      } else {
        delete tr.dataset.scanDecisionName;
      }
      if (row.analysisPending) {
        tr.dataset.analysisPending = "true";
      } else {
        delete tr.dataset.analysisPending;
      }
      if (row.analysisMessage) {
        tr.dataset.analysisMessage = row.analysisMessage;
      } else {
        delete tr.dataset.analysisMessage;
      }
      // Preserve appeal review status and notes
      if (row.appealReviewStatus) {
        tr.dataset.appealReviewStatus = row.appealReviewStatus;
      }
      if (row.appealReviewNotes) {
        tr.dataset.appealReviewNotes = row.appealReviewNotes;
      }
      const requiresApply = row.requiresApply === true;
      if (requiresApply) {
        tr.dataset.requiresApply = "true";
      } else {
        delete tr.dataset.requiresApply;
      }
      if (row.issueReported) {
        tr.dataset.issueReported = "true";
      } else {
        delete tr.dataset.issueReported;
      }
      if (row.brandImage) {
        tr.dataset.brandImage = row.brandImage;
      } else {
        delete tr.dataset.brandImage;
      }
      if (row.aiDetectionCompleted === true) {
        tr.dataset.aiDetectionCompleted = "true";
      } else {
        delete tr.dataset.aiDetectionCompleted;
      }
      const disableSelections = requiresApply;
      const detectionCompleted = row.aiDetectionCompleted === true;

      // Collect AI-detected allergens and diets from base ingredient AND brand labels
      const aiDetectedAllergens = new Set(toArray(baseAiDetectedAllergens));
      const aiDetectedDiets = new Set(toArray(baseAiDetectedDiets));
      // Track which allergens AI detected specifically as "cross-contamination" (cross-contamination)
      const aiDetectedCrossContamination = new Set(
        toArray(baseAiDetectedCrossContamination),
      );
      // Track which diets AI detected as affected by cross-contamination allergens
      const aiDetectedCrossContaminationDiets = new Set(
        toArray(baseAiDetectedCrossContaminationDiets),
      );

      // Add allergens and diets from brand labels
      brands.forEach((brand) => {
        debugLog("Brand data:", brand);
        if (Array.isArray(brand.allergens)) {
          brand.allergens.forEach((a) => {
            debugLog(
              "Adding allergen to aiDetected:",
              a,
            );
            if (a) aiDetectedAllergens.add(a);
          });
        }
        if (Array.isArray(brand.diets)) {
          brand.diets.forEach((d) => {
            debugLog(
              "Adding diet to aiDetected:",
              d,
            );
            if (d) aiDetectedDiets.add(d);
          });
        }
      });
      debugLog("aiDetectedAllergens:", Array.from(aiDetectedAllergens));
      debugLog("aiDetectedDiets:", Array.from(aiDetectedDiets));

      const brandsHTML =
        brands.length > 0
          ? brands
              .map((brand, brandIdx) => {
                debugLog(`Rendering brand ${brandIdx}:`, brand);
                debugLog(`  - brandImage: ${brand.brandImage}`);
                debugLog(`  - ingredientsImage: ${brand.ingredientsImage}`);
                debugLog(
                  `  - ingredientsList: ${brand.ingredientsList ? brand.ingredientsList.length : 0} items`,
                );

                const brandImages = [];
                const seenImageUrls = new Set(); // Track unique image URLs to avoid duplicates

                debugLog(
                  `  - Checking brand.brandImage: "${brand.brandImage}", truthy: ${!!brand.brandImage}, type: ${typeof brand.brandImage}`,
                );
                debugLog(
                  `  - Checking brand.ingredientsImage: "${brand.ingredientsImage}", truthy: ${!!brand.ingredientsImage}, type: ${typeof brand.ingredientsImage}`,
                );

                // Only show brandImage (product front photo) in thumbnail, not ingredientsImage
                if (brand.brandImage) {
                  const imgTag = `<img src="${esc(brand.brandImage)}" alt="${esc(brand.name || "Brand")}" loading="lazy" onclick="openImageModal('${esc(brand.brandImage)}')" title="Click to enlarge">`;
                  debugLog(
                    `  - Adding brandImage tag (length: ${imgTag.length})`,
                  );
                  brandImages.push(imgTag);
                  seenImageUrls.add(brand.brandImage); // Track this URL
                } else {
                  debugLog(`  - SKIPPED brandImage (falsy value)`);
                }

                // Don't show ingredientsImage in thumbnail - only brandImage (product front photo)
                // The ingredientsImage is still stored and can be viewed in the modal/details view
                const ingredientsNote =
                  brand.ingredientsList && brand.ingredientsList.length
                    ? `Label ingredients: ${brand.ingredientsList.map((i) => esc(i)).join(", ")}`
                    : "";

                // Show message if no images are available
                const imagesDisplay =
                  brandImages.length > 0
                    ? brandImages.join("")
                    : '<div style="color:var(--muted);font-size:0.85rem;font-style:italic">No product images available</div>';
                debugLog(
                  `  - Final imagesDisplay length: ${imagesDisplay.length}, brandImages count: ${brandImages.length}`,
                );
                debugLog(
                  `  - imagesDisplay HTML: ${imagesDisplay.substring(0, 200)}...`,
                );

                const brandItemHTML = `
      <div class="aiBrandItem" data-brand-idx="${brandIdx}">
        <div class="aiBrandItemHeader">
          <strong>${esc(brand.name || "Brand " + (brandIdx + 1))}</strong>
          <button type="button" class="btn btnSmall aiRemoveBrand" data-brand-idx="${brandIdx}">×</button>
        </div>
        <div class="aiBrandPreview">${imagesDisplay}</div>
        ${ingredientsNote ? `<div class="aiIngredientList">${ingredientsNote}</div>` : ""}
      </div>
    `;
                debugLog(
                  `  - Brand item HTML length: ${brandItemHTML.length}`,
                );
                return brandItemHTML;
              })
              .join("")
          : "";

      debugLog(`Total brandsHTML length: ${brandsHTML.length}`);

      // If appeal was rejected and scan is required, force unconfirmed state
      // This ensures managers must scan again after a denied appeal
      let isConfirmed = row.confirmed || false;

      // Normalize needsScan to boolean for consistent comparison
      const needsScan = row.needsScan === true || row.needsScan === "true";
      const needsScanDefined =
        row.needsScan !== undefined && row.needsScan !== null;
      const userOverriddenScan =
        row.userOverriddenScan === true || row.userOverriddenScan === "true";
      const issueReported =
        row.issueReported === true || row.issueReported === "true";
      // Check if there's a pending photo analysis result (View Results button will be shown)
      const hasPendingPhotoResult =
        aiAssistState.photoAnalysisResults &&
        aiAssistState.photoAnalysisResults[idx];
      // Check if there's an active photo analysis in progress
      const hasActivePhotoAnalysis = activePhotoAnalyses.has(idx);

      debugLog(
        `DEBUG CONFIRM: row.confirmed=${row.confirmed}, appealReviewStatus="${row.appealReviewStatus}", needsScan=${row.needsScan}->${needsScan}, brands.length=${brands.length}`,
      );
      if (
        row.appealReviewStatus === "rejected" &&
        needsScan &&
        brands.length === 0
      ) {
        isConfirmed = false;
        debugLog(
          `FORCE UNCONFIRMED: Appeal rejected, needsScan=${needsScan}, brands.length=${brands.length}`,
        );
      }
      // Only show scan recommendation if AI recommended it AND user hasn't overridden it AND no issue reported
      const showScanRecommendation =
        needsScan && !userOverriddenScan && !issueReported;
      // Check if scan requirement is satisfied (either scan completed, appealed/overridden, or issue reported)
      const hasBrandsOrOverridden =
        brands.length > 0 || userOverriddenScan || issueReported;
      const scanRequirementSatisfied = !needsScan || hasBrandsOrOverridden;
      // Disable confirm button if scan is required but not completed
      const canConfirm = scanRequirementSatisfied;
      const brandAssignmentLocked = showScanRecommendation && brands.length === 0;
      const selectionsLocked = disableSelections || brandAssignmentLocked;

      // Use allergens/diets from collected data (which already includes merged brands respecting unchecked checkboxes)
      // Don't merge brands again here - collectAiTableData already did that
      const allAllergens = new Set(toArray(row.allergens));
      const allDiets = new Set(toArray(row.diets));
      // Cross-contamination (cross-contamination) allergens/diets
      const crossContamination = new Set(toArray(row.crossContamination));
      const crossContaminationDiets = new Set(
        toArray(row.crossContaminationDiets),
      );

      // Check if there's a remembered brand for this ingredient
      // Only show it if it hasn't already been added to the brands array
      const rememberedBrand = getRememberedBrand(row.name);
      const brandAlreadyAdded =
        rememberedBrand &&
        rememberedBrand.brand &&
        brands.some((b) => b.name === rememberedBrand.brand);
      const rememberBrandHTML =
        rememberedBrand && rememberedBrand.brand && !brandAlreadyAdded
          ? `
    <div class="aiRememberedBrand" data-row-idx="${idx}" style="margin-top:8px;margin-bottom:12px;display:flex;align-items:start;gap:8px;padding:8px;background:rgba(76,175,80,0.05);border-radius:6px;border:1px dashed #4caf50">
      <div style="position:relative;flex-shrink:0">
        ${
          rememberedBrand.brandImage
            ? `<img src="${esc(rememberedBrand.brandImage)}" alt="${esc(rememberedBrand.brand)}" style="width:60px;height:60px;object-fit:contain;border-radius:4px;background:white">`
            : `<div style="width:60px;height:60px;background:#f0f0f0;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:#999;text-align:center">No image</div>`
        }
        <button type="button" class="btn aiAddRememberedBrand" data-row-idx="${idx}" style="position:absolute;top:-6px;right:-6px;width:24px;height:24px;border-radius:50%;background:#4caf50;border:2px solid white;color:white;font-size:1.2rem;font-weight:bold;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.2)" title="Add this brand">+</button>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:0.85rem;color:#2c5530">Previously used brand:</div>
        <div style="font-size:0.9rem;color:#333;margin-top:2px">${esc(rememberedBrand.brand)}</div>
        <div style="font-size:0.75rem;color:#888;margin-top:4px;font-style:italic">Tap + to add, then upload a label</div>
      </div>
    </div>
  `
          : "";

      const scanDecisionNote = "";
      const selectionGuardMessage = disableSelections
        ? `<div class="aiSelectionGuard" style="margin-top:8px;padding:10px 12px;border:1px dashed rgba(245,158,11,0.6);border-radius:6px;background:rgba(245,158,11,0.12);color:#fbbf24;font-size:0.85rem;">
            Enter the ingredient name and tap Apply before editing allergens or diets.
          </div>`
        : "";

      const rowLoadingClass = row.analysisPending ? " is-loading" : "";
      const rowLoadingOverlay = row.analysisPending
        ? `
    <div class="aiRowLoadingOverlay">
      <div class="aiRowLoadingBar">
        <span></span>
      </div>
      <div class="aiRowLoadingText">${esc(row.analysisMessage || "Analyzing ingredient…")}</div>
    </div>
  `
        : "";

      tr.innerHTML = `
    <td colspan="7">
      <div class="aiIngredientRowWrapper">
        <div class="aiIngredientRow${rowLoadingClass}">
        <div class="aiIngredientMain">
          <div class="aiIngredientNameCol">
            <div style="position:relative;display:flex;align-items:center;min-width:280px">
              <input type="text" class="aiIngredientName" placeholder="Ingredient name" value="${esc((row.name || "").toLowerCase())}" style="line-height:1;vertical-align:top;padding-right:80px;width:100%;box-sizing:border-box">
              <button type="button" class="btn aiIngredientApply" data-row-idx="${idx}" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);padding:5px 10px;font-size:0.8rem">Apply</button>
            </div>
            <div class="aiBrandCell" style="${brands.length === 0 && !row.brandImage && !hasPendingPhotoResult && !hasActivePhotoAnalysis && (showScanRecommendation || (needsScanDefined && needsScan === false && !userOverriddenScan)) ? "gap:0;align-items:flex-start" : ""}">
              ${brandsHTML ? `<div class="aiBrandsList">${brandsHTML}</div>` : ""}
              ${
                !brandsHTML && row.brandImage
                  ? `
                <div class="aiBrandsList">
                  <div class="aiBrandItem">
                    <div class="aiBrandItemHeader">
                      <strong>Product Front</strong>
                    </div>
                    <div class="aiBrandPreview">
                      <img src="${esc(row.brandImage)}" alt="Product front" loading="lazy" onclick="openImageModal('${esc(row.brandImage)}')" title="Click to enlarge">
                    </div>
                  </div>
                </div>
              `
                  : ""
              }
            ${
              showScanRecommendation &&
              brands.length === 0 &&
              !row.brandImage &&
              row.appealReviewStatus !== "rejected" &&
              !hasPendingPhotoResult &&
              !hasActivePhotoAnalysis
                ? `<div style="background:#f59e0b;border:2px solid #f59e0b;border-radius:6px;padding:8px 12px;margin-bottom:12px;margin-top:0;line-height:1;vertical-align:top;max-width:100%">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:8px;min-width:0">
                  <span style="font-size:1.2rem">📷</span>
                  <span style="font-weight:600;color:#fff;font-size:0.85rem;white-space:nowrap">Brand assignment required</span>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0">
                  <button type="button" class="btn aiAppealScanBtn" data-row-idx="${idx}" style="background:#dc2626;border-color:#dc2626;padding:6px 10px;font-size:0.8rem;white-space:nowrap">Appeal</button>
                  <button type="button" class="btn aiBrandSearchBtn" style="background:#1e3a8a;border-color:#2b4bb8;padding:6px 10px;font-size:0.8rem;white-space:nowrap">Search existing items</button>
                  <button type="button" class="btn aiBrandAddBtn" style="background:#17663a;border-color:#1a7b46;padding:6px 10px;font-size:0.8rem;white-space:nowrap">Add new item</button>
                </div>
              </div>
              ${scanDecisionNote}
            </div>`
                : needsScanDefined &&
                    needsScan === false &&
                    !userOverriddenScan &&
                    brands.length === 0 &&
                    !row.brandImage &&
                    !hasPendingPhotoResult &&
                    !hasActivePhotoAnalysis
                  ? `<div style="background:#6b7280;border:2px solid #6b7280;border-radius:6px;padding:8px 12px;margin-bottom:12px;margin-top:0;line-height:1;vertical-align:top;max-width:100%">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:8px;min-width:0">
                  <span style="font-size:1rem">✓</span>
                  <span style="color:#fff;font-weight:500;font-size:0.85rem;white-space:nowrap">Brand assignment optional</span>
                </div>
                <button type="button" class="btn aiBrandSearchBtn" style="background:#1e3a8a;border-color:#2b4bb8;padding:6px 10px;font-size:0.8rem;white-space:nowrap">Search existing items</button>
                <button type="button" class="btn aiBrandAddBtn" style="background:#17663a;border-color:#1a7b46;padding:6px 10px;font-size:0.8rem;white-space:nowrap">Add new item</button>
              </div>
              ${scanDecisionNote}
            </div>`
                  : userOverriddenScan && !row.appealReviewStatus
                    ? `<div style="background:#6b7280;border:2px solid #6b7280;border-radius:6px;padding:6px 12px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:0.85rem">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:1rem">✗</span>
                <span style="color:#fff;font-weight:500">Label recommendation overridden by manager</span>
              </div>
              <button type="button" class="btn aiRemoveAppealBtn" data-row-idx="${idx}" style="background:#ef4444;border-color:#dc2626;color:#fff;padding:4px 12px;font-size:0.8rem;white-space:nowrap;margin-left:8px">Remove appeal</button>
            </div>`
                    : ""
            }
            ${
              issueReported && brands.length === 0
                ? `<div style="background:#3b82f6;border:2px solid #3b82f6;border-radius:6px;padding:8px 12px;margin-bottom:12px;margin-top:0;line-height:1.4">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:1.2rem">📋</span>
                <div style="flex:1">
                  <div style="font-weight:600;color:#fff;font-size:0.9rem">Report sent</div>
                  <div style="color:rgba(255,255,255,0.8);font-size:0.8rem;margin-top:2px">Will be addressed as soon as possible</div>
                </div>
              </div>
            </div>`
                : ""
            }
            ${
              row.appealReviewStatus
                ? `
              <div style="background:${row.appealReviewStatus === "approved" ? "#d1fae5" : "#fee2e2"};border:2px solid ${row.appealReviewStatus === "approved" ? "#6ee7b7" : "#fca5a5"};border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:0.85rem">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:${row.appealReviewNotes ? "8px" : "0"};">
                  <span style="font-size:1rem">${row.appealReviewStatus === "approved" ? "✓" : "✗"}</span>
                  <span style="color:${row.appealReviewStatus === "approved" ? "#065f46" : "#991b1b"};font-weight:600">Appeal ${row.appealReviewStatus === "approved" ? "approved" : "denied"}</span>
                </div>
                ${row.appealReviewNotes ? `<div style="color:${row.appealReviewStatus === "approved" ? "#047857" : "#7f1d1d"};font-size:0.8rem;margin-top:4px;font-style:italic">${esc(row.appealReviewNotes)}</div>` : ""}
              </div>
              ${
                row.appealReviewStatus === "approved" &&
                brands.length === 0 &&
                !row.brandImage &&
                !hasPendingPhotoResult &&
                !hasActivePhotoAnalysis
                  ? `<div style="background:#6b7280;border:2px solid #6b7280;border-radius:6px;padding:8px 12px;margin-bottom:12px;margin-top:0;line-height:1;vertical-align:top;max-width:100%">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
                  <div style="display:flex;align-items:center;gap:8px;min-width:0">
                    <span style="font-size:1rem">✓</span>
                    <span style="color:#fff;font-weight:500;font-size:0.85rem;white-space:nowrap">Brand assignment optional</span>
                  </div>
                  <button type="button" class="btn aiBrandSearchBtn" style="background:#1e3a8a;border-color:#2b4bb8;padding:6px 10px;font-size:0.8rem;white-space:nowrap">Search existing items</button>
                  <button type="button" class="btn aiBrandAddBtn" style="background:#17663a;border-color:#1a7b46;padding:6px 10px;font-size:0.8rem;white-space:nowrap">Add new item</button>
                </div>
              </div>`
                  : ""
              }
              ${
                row.appealReviewStatus === "rejected" &&
                brands.length === 0 &&
                !row.brandImage &&
                !hasPendingPhotoResult &&
                !hasActivePhotoAnalysis
                  ? `<div style="background:#f59e0b;border:2px solid #f59e0b;border-radius:6px;padding:8px 12px;margin-bottom:12px;margin-top:0;line-height:1;vertical-align:top;max-width:100%">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
                  <div style="display:flex;align-items:center;gap:8px;min-width:0">
                    <span style="font-size:1.2rem">📷</span>
                    <span style="font-weight:600;color:#fff;font-size:0.85rem;white-space:nowrap">Brand assignment required</span>
                  </div>
                  <div style="display:flex;gap:6px;flex-shrink:0">
                    <button type="button" class="btn aiAppealScanBtn" data-row-idx="${idx}" style="background:#dc2626;border-color:#dc2626;padding:6px 10px;font-size:0.8rem;white-space:nowrap">Appeal</button>
                    <button type="button" class="btn aiBrandSearchBtn" style="background:#1e3a8a;border-color:#2b4bb8;padding:6px 10px;font-size:0.8rem;white-space:nowrap">Search existing items</button>
                    <button type="button" class="btn aiBrandAddBtn" style="background:#17663a;border-color:#1a7b46;padding:6px 10px;font-size:0.8rem;white-space:nowrap">Add new item</button>
                  </div>
                </div>
              </div>`
                  : ""
              }
            `
                : ""
            }
            ${
              !userOverriddenScan &&
              !row.appealReviewStatus &&
              needsScanDefined === false &&
              !row.brandImage &&
              !hasPendingPhotoResult &&
              !hasActivePhotoAnalysis
                ? `<div style="background:#9ca3af;border:2px solid #9ca3af;border-radius:6px;padding:6px 12px;margin-bottom:12px;display:flex;align-items:center;gap:8px;font-size:0.85rem">
              <span style="font-size:1rem">ℹ</span>
              <span style="color:#fff;font-weight:500">Label status: Not determined by AI (manual ingredient entry)</span>
            </div>`
                : ""
            }
            ${rememberBrandHTML}
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:8px">
              <input type="checkbox" class="aiRemovableCheckbox" ${row.removable ? "checked" : ""}>
              <span style="font-size:0.85rem;color:#a8b2d6">Can be removed/replaced</span>
            </label>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:12px">
            <div style="font-size:0.75rem;color:#8891b0;display:inline-flex;flex-wrap:wrap;gap:12px;margin-bottom:4px;padding:8px 10px;background:rgba(76,90,212,0.05);border-radius:6px">
              <span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:12px;height:12px;border:2px solid #6b7280;border-radius:3px"></span>Contains</span>
              <span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:12px;height:12px;border:2px dashed #6b7280;border-radius:3px"></span>Cross-contamination risk</span>
              <span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:10px;height:10px;background:#3b82f6;border-radius:50%"></span>Smart detection</span>
              <span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:50%"></span>Manual override</span>
            </div>
            <div class="aiSelectionGroup${brandAssignmentLocked ? " aiSelectionGroup--locked" : ""}" style="display:flex;gap:20px;margin-top:0">
              <div style="flex:1">
                <div class="aiAllergenChecklist">
                  ${ALLERGENS.map((allergen) => {
                    const allergenNorm = allergen;
                    // Determine state: contains > crosscontamination > off (contains is more severe)
                    const isContains = allAllergens.has(allergenNorm);
                    const isMayContain =
                      crossContamination.has(allergenNorm) && !isContains;
                    const hasOverlap =
                      isContains && crossContamination.has(allergenNorm);
                    const state = isContains
                      ? "contains"
                      : isMayContain
                        ? "crosscontamination"
                        : "off";
                    const checked = isContains || isMayContain ? "checked" : "";
                    const stateClass = state !== "off" ? `state-${state}` : "";
                    const overlapAttr = hasOverlap
                      ? ' data-overlap="true"'
                      : "";
                    const stateIcon = ""; // No longer showing emojis on checkboxes
                    // Check if allergen is in aiDetectedAllergens OR aiDetectedCrossContamination
                    const aiWasSelectedAsContains =
                      aiDetectedAllergens.has(allergenNorm);
                    const aiWasSelectedAsMayContain =
                      aiDetectedCrossContamination.has(allergenNorm);
                    const aiWasSelected =
                      aiWasSelectedAsContains || aiWasSelectedAsMayContain;
                    const aiDetectedClass = aiWasSelected ? "aiDetected" : "";
                    // AI can suggest as "contains" or "crosscontamination" - contains takes priority if both present
                    const aiState = aiWasSelectedAsContains
                      ? "contains"
                      : aiWasSelectedAsMayContain
                        ? "crosscontamination"
                        : "off";
                    const currentlySelected = isContains || isMayContain;
                    // Treat any AI suggestion (allergen or diet) as proof that AI ran,
                    // so manual allergen overrides remain highlighted even if AI found zero allergens.
                    const hasAiDetections =
                      aiDetectedAllergens.size +
                        aiDetectedDiets.size +
                        aiDetectedCrossContamination.size >
                      0;
                    // State is overridden if: AI detected but state changed, OR AI didn't detect but user selected
                    const stateOverridden =
                      (aiWasSelected && state !== aiState) ||
                      (!aiWasSelected && currentlySelected && hasAiDetections);
                    const overrideClass = stateOverridden
                      ? "stateOverridden"
                      : "";
                    const overrideReason =
                      aiWasSelected && !currentlySelected
                        ? "Website selection overridden"
                        : aiWasSelected && state !== aiState
                          ? `Changed from ${aiState === "contains" ? "Contains" : "Cross-contamination"}`
                          : !aiWasSelected && currentlySelected
                            ? "Added manual selection"
                            : "";
                    const tooltipParts = [];
                    if (state === "contains") {
                      tooltipParts.push(
                        "Contains (click to change to Cross-contamination risk)",
                      );
                    } else if (state === "crosscontamination") {
                      tooltipParts.push(
                        "Cross-contamination risk (click to remove)",
                      );
                    } else {
                      tooltipParts.push("Click to mark as Contains");
                    }
                    if (aiDetectedClass && state === aiState) {
                      tooltipParts.push("Suggested by website");
                    } else if (stateOverridden && overrideReason) {
                      tooltipParts.push(overrideReason);
                    }
                    if (disableSelections) {
                      tooltipParts.push(
                        "Enter ingredient name and tap Apply first",
                      );
                    }
                    if (brandAssignmentLocked) {
                      tooltipParts.push(
                        "Add a brand item to edit allergens or diets",
                      );
                    }
                    const tooltipAttr = tooltipParts.length
                      ? `title="${tooltipParts.join(" • ")}"`
                      : "";
                    const disabledAttr = selectionsLocked ? "disabled" : "";
                    const disabledClass = selectionsLocked
                      ? " selectionsDisabled"
                      : "";
                    const allergenEmoji = ALLERGEN_EMOJI[allergenNorm] || "⚠️";
                    return `<label class="${aiDetectedClass} ${overrideClass} ${stateClass}${disabledClass}" data-state="${state}" data-ai-state="${aiState}" ${tooltipAttr}><input type="checkbox" class="aiAllergenCheckbox" value="${esc(allergen)}" data-ai-detected="${aiWasSelected}" data-ai-state="${aiState}" data-state="${state}"${overlapAttr} ${checked} ${disabledAttr}>${allergenEmoji} ${esc(formatAllergenLabel(allergen))}${stateIcon}</label>`;
                  }).join("")}
                </div>
              </div>
              <div style="flex:1">
                <div class="aiDietChecklist">
                  ${DIETS.map((diet) => {
                    // Determine state: contains > crosscontamination > off (contains is more important)
                    // Note: crossContaminationDiets uses raw diet labels, so compare directly
                    const isContains = allDiets.has(diet);
                    const isMayContain = crossContaminationDiets.has(diet) && !isContains;
                    const hasOverlap = isContains && crossContaminationDiets.has(diet);
                    const state = isContains
                      ? "contains"
                      : isMayContain
                        ? "crosscontamination"
                        : "off";
                    const checked = isContains || isMayContain ? "checked" : "";
                    const stateClass = state !== "off" ? `state-${state}` : "";
                    const overlapAttr = hasOverlap
                      ? ' data-overlap="true"'
                      : "";
                    const stateIcon = ""; // No longer showing emojis on checkboxes
                    // Check if diet is in aiDetectedDiets OR aiDetectedCrossContaminationDiets
                    const aiWasSelectedAsContains = aiDetectedDiets.has(diet);
                    const aiWasSelectedAsMayContain =
                      aiDetectedCrossContaminationDiets.has(diet);
                    const aiWasSelected =
                      aiWasSelectedAsContains || aiWasSelectedAsMayContain;
                    const aiDetectedClass = aiWasSelected ? "aiDetected" : "";
                    // AI can suggest as "contains" or "crosscontamination" - contains takes priority for diets
                    const aiState = aiWasSelectedAsContains
                      ? "contains"
                      : aiWasSelectedAsMayContain
                        ? "crosscontamination"
                        : "off";
                    const currentlySelected = allDiets.has(diet) || isMayContain;
                    // Likewise, highlight diet overrides if AI detected anything in either category.
                    const hasAiDetections =
                      aiDetectedDiets.size +
                        aiDetectedAllergens.size +
                        aiDetectedCrossContamination.size +
                        aiDetectedCrossContaminationDiets.size >
                      0;
                    // State is overridden if: AI detected but state changed, OR AI didn't detect but user selected
                    const stateOverridden =
                      (aiWasSelected && state !== aiState) ||
                      (!aiWasSelected && currentlySelected && hasAiDetections);
                    const overrideClass = stateOverridden
                      ? "stateOverridden"
                      : "";
                    const overrideReason =
                      aiWasSelected && !currentlySelected
                        ? "Website selection overridden"
                        : aiWasSelected && state !== aiState
                          ? `Changed from ${aiState === "contains" ? "Contains" : "Cross-contamination"}`
                          : !aiWasSelected && currentlySelected
                            ? "Added manual selection"
                            : "";
                    const tooltipParts = [];
                    if (state === "contains") {
                      tooltipParts.push(
                        "Contains - tap to change to Cross-contamination risk",
                      );
                    } else if (state === "crosscontamination") {
                      tooltipParts.push(
                        "Cross-contamination risk - tap to clear",
                      );
                    } else {
                      tooltipParts.push("Tap to mark as Contains");
                    }
                    if (aiDetectedClass && state === aiState) {
                      tooltipParts.push("Suggested by website");
                    } else if (stateOverridden && overrideReason) {
                      tooltipParts.push(overrideReason);
                    }
                    if (disableSelections) {
                      tooltipParts.push(
                        "Enter ingredient name and tap Apply first",
                      );
                    }
                    if (brandAssignmentLocked) {
                      tooltipParts.push(
                        "Add a brand item to edit allergens or diets",
                      );
                    }
                    const tooltipAttr = tooltipParts.length
                      ? `title="${tooltipParts.join(" • ")}"`
                      : "";
                    const disabledAttr = selectionsLocked ? "disabled" : "";
                    const disabledClass = selectionsLocked
                      ? " selectionsDisabled"
                      : "";
                    const dietEmoji = DIET_EMOJI[diet] || "🍽️";
                    return `<label class="${aiDetectedClass} ${overrideClass} ${stateClass}${disabledClass}" data-state="${state}" data-ai-state="${aiState}" ${tooltipAttr}><input type="checkbox" class="aiDietCheckbox" value="${esc(diet)}" data-ai-detected="${aiWasSelected}" data-ai-state="${aiState}" data-state="${state}"${overlapAttr} ${checked} ${disabledAttr}>${dietEmoji} ${esc(diet)}${stateIcon}</label>`;
                  }).join("")}
                </div>
              </div>
            </div>
            ${selectionGuardMessage}
            ${(() => {
              // Check for manual overrides and build message - show UNDER the checkboxes
              // Only show message if there were AI detections to override
              const hasAiDetections =
                aiDetectedAllergens.size > 0 ||
                aiDetectedDiets.size > 0 ||
                aiDetectedCrossContamination.size > 0;
              if (!hasAiDetections) return "";

              const overriddenItems = [];

              ALLERGENS.forEach((allergen) => {
                const allergenNorm = allergen;
                const aiWasSelectedAsContains =
                  aiDetectedAllergens.has(allergenNorm);
                const aiWasSelectedAsMayContain =
                  aiDetectedCrossContamination.has(allergenNorm);
                const aiWasSelected =
                  aiWasSelectedAsContains || aiWasSelectedAsMayContain;
                const currentlySelectedAsContains =
                  allAllergens.has(allergenNorm);
                const currentlySelectedAsMayContain =
                  crossContamination.has(allergenNorm);
                const currentlySelected =
                  currentlySelectedAsContains || currentlySelectedAsMayContain;

                // Determine current state and AI expected state (contains takes priority if both present)
                const currentState = currentlySelectedAsContains
                  ? "contains"
                  : currentlySelectedAsMayContain
                    ? "crosscontamination"
                    : "off";
                const aiState = aiWasSelectedAsContains
                  ? "contains"
                  : aiWasSelectedAsMayContain
                    ? "crosscontamination"
                    : "off";

                // Only show override if the state actually changed from what AI expected
                if (aiWasSelected && !currentlySelected) {
                  const aiStateLabel =
                    aiState === "contains"
                      ? "Contains"
                      : "Cross-contamination risk";
                  overriddenItems.push(
                    `${formatAllergenLabel(allergen)} (AI detected: ${aiStateLabel} → you removed)`,
                  );
                } else if (!aiWasSelected && currentlySelected) {
                  const userStateLabel =
                    currentState === "contains"
                      ? "Contains"
                      : "Cross-contamination risk";
                  overriddenItems.push(
                    `${formatAllergenLabel(allergen)} (you added as: ${userStateLabel})`,
                  );
                } else if (
                  aiWasSelected &&
                  currentlySelected &&
                  currentState !== aiState
                ) {
                  // State changed (e.g., crosscontamination → contains or contains → crosscontamination)
                  const aiStateLabel =
                    aiState === "contains"
                      ? "Contains"
                      : "Cross-contamination risk";
                  const userStateLabel =
                    currentState === "contains"
                      ? "Contains"
                      : "Cross-contamination risk";
                  overriddenItems.push(
                    `${formatAllergenLabel(allergen)} (AI: ${aiStateLabel} → you: ${userStateLabel})`,
                  );
                }
              });
              DIETS.forEach((diet) => {
                const aiWasSelectedAsContains = aiDetectedDiets.has(diet);
                const aiWasSelectedAsMayContain =
                  aiDetectedCrossContaminationDiets.has(diet);
                const aiWasSelected =
                  aiWasSelectedAsContains || aiWasSelectedAsMayContain;
                const currentlySelectedAsContains = allDiets.has(diet);
                const currentlySelectedAsMayContain = crossContaminationDiets.has(diet);
                const currentlySelected =
                  currentlySelectedAsContains || currentlySelectedAsMayContain;

                // Determine current state and AI expected state (contains takes priority if both present)
                const currentState = currentlySelectedAsContains
                  ? "contains"
                  : currentlySelectedAsMayContain
                    ? "crosscontamination"
                    : "off";
                const aiState = aiWasSelectedAsContains
                  ? "contains"
                  : aiWasSelectedAsMayContain
                    ? "crosscontamination"
                    : "off";

                // Only show override if the state actually changed from what AI expected
                if (aiWasSelected && !currentlySelected) {
                  const aiStateLabel =
                    aiState === "contains"
                      ? "Compliant"
                      : "Cross-contamination risk";
                  overriddenItems.push(
                    `${diet} (AI detected: ${aiStateLabel} → you removed)`,
                  );
                } else if (!aiWasSelected && currentlySelected) {
                  const userStateLabel =
                    currentState === "contains"
                      ? "Compliant"
                      : "Cross-contamination risk";
                  overriddenItems.push(
                    `${diet} (you added as: ${userStateLabel})`,
                  );
                } else if (
                  aiWasSelected &&
                  currentlySelected &&
                  currentState !== aiState
                ) {
                  // State changed (e.g., crosscontamination → contains or contains → crosscontamination)
                  const aiStateLabel =
                    aiState === "contains"
                      ? "Compliant"
                      : "Cross-contamination risk";
                  const userStateLabel =
                    currentState === "contains"
                      ? "Compliant"
                      : "Cross-contamination risk";
                  overriddenItems.push(
                    `${diet} (AI: ${aiStateLabel} → you: ${userStateLabel})`,
                  );
                }
              });
              if (overriddenItems.length > 0) {
                return `<div class="overrideWarningMessage" style="color:#ef4444;font-size:0.85rem;margin-top:8px;padding:8px;background:rgba(239,68,68,0.1);border-radius:6px;border:1px solid rgba(239,68,68,0.3);width:100%">You have overridden the smart detection: ${overriddenItems.map((item) => esc(item)).join(", ")}</div>`;
              }
              return "";
            })()}
          </div>
          <div class="aiConfirmCell" style="position:absolute;top:12px;right:12px;text-align:center;display:flex;flex-direction:column;gap:4px;align-items:center">
            <button type="button" class="btn aiConfirmBtn ${isConfirmed ? "confirmed" : "unconfirmed"}" data-confirmed="${isConfirmed ? "true" : "false"}" ${!canConfirm ? "disabled" : ""} title="${!canConfirm ? "Please add an ingredient label or appeal before confirming" : ""}" style="padding:10px 20px;font-size:0.95rem;font-weight:600;border-radius:8px;min-width:100px;${!canConfirm ? "background:#6b7280;border-color:#6b7280;color:white;cursor:not-allowed;opacity:0.6;" : isConfirmed ? "background:#4caf50;border-color:#4caf50;color:white;" : "background:#f59e0b;border-color:#f59e0b;color:white;"}">${isConfirmed ? "✓ Confirmed" : "Confirm"}</button>
            ${!canConfirm && needsScan ? `<div style="font-size:0.7rem;color:#ef4444;text-align:center">Label required</div>` : ""}
          </div>
        </div>
        <div class="aiRowBrandResults" data-row-idx="${idx}"></div>
        <button type="button" class="btn aiDeleteRow" style="position:absolute;bottom:12px;right:12px;background:#ef4444;border-color:#ef4444;color:white;padding:6px 16px;font-size:0.85rem;border-radius:6px">Delete</button>
        </div>
        ${rowLoadingOverlay}
      </div>
    </td>
  `;
      aiAssistTableBody.appendChild(tr);

      // NOTE: updateAiBrandPreview() is obsolete now that we support multiple brands
      // It was overwriting the brand images we just rendered. Removed.
    });

    // Ensure diet/allergen conflict warnings are rendered based on DB conflicts.
    aiAssistTableBody
      .querySelectorAll("tr")
      .forEach((rowEl) => updateDietConflictMessage(rowEl));
    aiAssistResultsEl.classList.toggle("show", data.length > 0);
    if (aiAssistBrandResults) {
      aiAssistBrandResults.classList.remove("show");
      aiAssistBrandResults.innerHTML = "";
    }

    // Restore loading states for any active photo analyses (from global tracking)
    if (activePhotoAnalyses.size > 0) {
      debugLog(
        `Restoring ${activePhotoAnalyses.size} active photo analysis loading states`,
      );
      for (const [rowIdx, analysisInfo] of activePhotoAnalyses.entries()) {
        showPhotoAnalysisLoadingInRow(
          rowIdx,
          analysisInfo.ingredientName,
          analysisInfo.statusText,
        );
      }
    }

    // Restore "View Results" buttons for completed photo analyses that haven't been applied yet
    if (aiAssistState.photoAnalysisResults) {
      const completedResults = Object.entries(aiAssistState.photoAnalysisResults);
      if (completedResults.length > 0) {
        debugLog(
          `Restoring ${completedResults.length} completed photo analysis result buttons`,
        );
        for (const [rowIdxStr, resultInfo] of completedResults) {
          const rowIdx = parseInt(rowIdxStr, 10);
          // Only restore if not currently in active analyses (would be a loading state)
          if (!activePhotoAnalyses.has(rowIdx)) {
            showPhotoAnalysisResultButton(
              rowIdx,
              resultInfo.ingredientName,
              resultInfo.analysisResult,
              resultInfo.originalPhoto,
            );
          }
        }
      }
    }

    if (window.__pendingIngredientToScroll) {
      const pendingIngredient = window.__pendingIngredientToScroll;
      requestAnimationFrame(() => {
        if (scrollDishEditorToIngredient(pendingIngredient)) {
          window.__pendingIngredientToScroll = null;
        }
      });
    }

    // Update the preview whenever the table is rendered
    updateAiPreview();
  }

  function scrollDishEditorToIngredient(ingredientName) {
    if (!ingredientName || !aiAssistTableBody) return false;
    const target = norm(ingredientName);
    const rows = aiAssistTableBody.querySelectorAll("tr[data-index]");
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const nameInput = row.querySelector(".aiIngredientName");
      if (nameInput && norm(nameInput.value) === target) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        row.style.transition = "background-color 0.3s";
        row.style.backgroundColor = "rgba(76,90,212,0.2)";
        setTimeout(() => {
          row.style.backgroundColor = "";
          setTimeout(() => {
            row.style.transition = "";
          }, 300);
        }, 2000);
        return true;
      }
    }
    return false;
  }

  window.scrollDishEditorToIngredient = scrollDishEditorToIngredient;

  function normalizeIngredientName(name) {
    const lower = name.toLowerCase().trim();
    // Map common variations to standard names
    const aliases = {
      mayo: "mayonnaise",
      cuke: "cucumber",
      cukes: "cucumber",
      pickles: "pickle",
      tomatoes: "tomato",
      onions: "onion",
      peppers: "pepper",
      mushrooms: "mushroom",
      olives: "olive",
      carrots: "carrot",
      potatoes: "potato",
      "celery stalk": "celery",
      "celery stalks": "celery",
    };
    return aliases[lower] || lower;
  }

  function heuristicallyExtractIngredients(text) {
    if (!text) return [];
    const tokens = text
      .split(/\r?\n|\.|;/)
      .map((part) => part.split(/\band\b|\bwith\b|,/i))
      .flat()
      .map((part) => part.trim())
      .filter(Boolean);
    const unique = new Map();
    tokens.forEach((token) => {
      const cleaned = token
        .replace(/[\d/]+/g, "")
        .replace(
          /\b(teaspoons?|tablespoons?|cups?|ounces?|grams?|lbs?|pounds?|ml|l|kg)\b/gi,
          "",
        )
        .replace(/[\(\)]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!cleaned) return;
      const normalized = normalizeIngredientName(cleaned);
      const key = norm(normalized);
      if (unique.has(key)) return;
      unique.set(key, {
        name: normalized,
        brand: "",
        allergens: [],
        crossContamination: [],
        diets: [],
        crossContaminationDiets: [],
        ingredientsList: [normalized],
      });
    });
    if (unique.size === 0) {
      return [{ name: "", brand: "", allergens: [] }];
    }
    return Array.from(unique.values());
  }

  async function openDishEditor(context) {
    debugLog("!!! openDishEditor called", new Error().stack);
    ensureAiAssistElements();
    if (!aiAssistBackdrop) return;

    // IMPORTANT: Clear previous state completely before setting new state
    aiAssistState.context = null;
    aiAssistState.pendingRequestId = null;
    aiAssistState.brandSuggestions = {};
    aiAssistState.detectedDietaryOptions = null;
    aiAssistState.savedToDish = false;
    aiAssistState.initialData = null;

    stopAiCamera();
    updateAiAssistMediaPreview();
    aiAssistSetStatus("");

    // Keep the title generic - dish name is shown in the editable field below
    const titleEl = document.getElementById("aiAssistTitle");
    if (titleEl) {
      titleEl.textContent = "Dish editor";
    }

    // Get the dish name for the input field - MUST be done BEFORE setting context
    const dishName = context?.getCurrentName
      ? context.getCurrentName()
      : context?.dishName || "";
    debugLog("openDishEditor: Setting dish name to:", dishName);

    // Store original dish name to track unsaved changes
    aiAssistState.originalDishName = dishName;
    // Reset dish name modification flag when modal opens
    aiAssistState.dishNameModified = false;

    // Populate the name input field - force the update
    const nameInput = document.getElementById("aiAssistNameInput");
    if (nameInput) {
      // Force clear first, then set new value
      nameInput.value = "";
      setTimeout(() => {
        nameInput.value = dishName;
        debugLog(
          "openDishEditor: Name input field updated to:",
          nameInput.value,
        );
        // Update original dish name after setting the value
        aiAssistState.originalDishName = dishName;
      }, 0);
    }

    // NOW set the context after the name has been determined
    aiAssistState.context = context || {};

    // Show/hide replacement progress card if in replacement flow
    const replacementProgressCard = document.getElementById(
      "aiAssistReplacementProgress",
    );
    const replacementProgressText = document.getElementById(
      "aiAssistReplacementProgressText",
    );
    if (replacementProgressCard && replacementProgressText) {
      if (
        context?.replacementFlow &&
        context?.dishNumber &&
        context?.totalDishes
      ) {
        replacementProgressCard.style.display = "block";
        replacementProgressText.textContent = `Dish ${context.dishNumber} of ${context.totalDishes}`;
      } else {
        replacementProgressCard.style.display = "none";
      }
    }

    // Show/hide delete button and wire up callback
    const deleteBtn = document.getElementById("aiAssistDeleteBtn");
    const deleteWarning = document.getElementById("aiAssistDeleteWarning");
    const confirmDeleteBtn = document.getElementById("aiAssistConfirmDeleteBtn");
    const cancelDeleteBtn = document.getElementById("aiAssistCancelDeleteBtn");

    if (deleteBtn) {
      if (context?.onDelete) {
        deleteBtn.style.display = "block";
        deleteBtn.onclick = () => {
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
            toggleAiAssistBackdrop(false);
            context.onDelete();
          };
        }

        // Set up cancel delete handler
        if (cancelDeleteBtn) {
          cancelDeleteBtn.onclick = () => {
            if (deleteWarning) deleteWarning.style.display = "none";
          };
        }
      } else {
        deleteBtn.style.display = "none";
        deleteBtn.onclick = null;
      }
    }

    // Check if there are existing ingredients to edit
    const existingIngredients = toArray(
      Array.isArray(context?.existingIngredients)
        ? context.existingIngredients
        : [],
    );
    const hasExistingData = existingIngredients.length > 0;

    if (hasExistingData) {
      // Restore appeal states from database before rendering
      const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
      if (restaurantId && window.supabaseClient) {
        try {
          // Load appeals for this specific dish (scoped by restaurant_id AND dish_name)
          // Include review_status, review_notes, and reviewed_at to show appeal review information
          let appealsQuery = window.supabaseClient
            .from("ingredient_scan_appeals")
            .select(
              "ingredient_name, ingredient_row_index, review_status, review_notes, reviewed_at, dish_name",
            )
            .eq("restaurant_id", restaurantId);

          // Filter by dish_name to scope appeals to this specific dish
          // Note: dishName was set earlier in openDishEditor from context.getCurrentName()
          if (dishName) {
            appealsQuery = appealsQuery.eq("dish_name", dishName);
          } else {
            // For legacy appeals without dish_name, only load them if no dish context
            appealsQuery = appealsQuery.is("dish_name", null);
          }

          const { data: appeals } = await appealsQuery;

          if (appeals && appeals.length > 0) {
            // Create a map of ingredient name -> appeal data (including review status)
            const appealMap = new Map();
            appeals.forEach((appeal) => {
              const key = appeal.ingredient_name?.toLowerCase().trim() || "";
              if (key) {
                appealMap.set(key, appeal);
              }
            });

            // Update existing ingredients with appeal state from database
            // BUT preserve any appeal state that's already in aiIngredients (userOverriddenScan/needsScan)
            // The database check is just a fallback for legacy data
            existingIngredients.forEach((ingredient) => {
              const ingredientName = (ingredient.name || "").toLowerCase().trim();
              const appealData = appealMap.get(ingredientName);

              // IMPORTANT: Only set appeal state from database if it's not already in aiIngredients
              // The aiIngredients data is the source of truth since it's saved when "Save to Dish" is clicked
              const alreadyHasAppealState =
                ingredient.userOverriddenScan === true ||
                ingredient.needsScan === false;

              // Load appeal review status if the appeal has been reviewed
              if (
                appealData &&
                appealData.review_status &&
                (appealData.review_status === "approved" ||
                  appealData.review_status === "rejected")
              ) {
                // Only set if not already in ingredient data (preserve existing if present)
                if (!ingredient.appealReviewStatus) {
                  ingredient.appealReviewStatus = appealData.review_status;
                  ingredient.appealReviewNotes = appealData.review_notes || null;
                  ingredient.appealReviewedAt = appealData.reviewed_at || null;
                  debugLog(
                    `LOAD: Loaded appeal review status for "${ingredient.name}": ${appealData.review_status}`,
                  );

                  // If appeal was rejected, restore scan requirement and reset confirmed
                  // This ensures managers must re-scan after a denied appeal
                  if (appealData.review_status === "rejected") {
                    const hasBrands =
                      Array.isArray(ingredient.brands) &&
                      ingredient.brands.length > 0;
                    // When appeal is denied, manager must scan again - restore needsScan requirement
                    ingredient.needsScan = true;
                    ingredient.userOverriddenScan = false;
                    ingredient.confirmed = false;
                    debugLog(
                      `LOAD: Reset needsScan=true, confirmed=false for "${ingredient.name}" due to rejected appeal`,
                    );
                  }
                }
              }

              if (appealData && !alreadyHasAppealState) {
                // Only apply appeal state if no brands are added
                // If brands are added, the scan requirement is already satisfied
                const hasBrands =
                  Array.isArray(ingredient.brands) &&
                  ingredient.brands.length > 0;
                if (!hasBrands) {
                  ingredient.userOverriddenScan = true;
                  ingredient.needsScan = false;
                  debugLog(
                    `LOAD: Restored appeal state from database for "${ingredient.name}"`,
                  );
                } else {
                  // Brand added means scan is satisfied, don't need appeal
                  debugLog(
                    `LOAD: Skipping appeal restoration for "${ingredient.name}" - has brands`,
                  );
                }
              } else if (alreadyHasAppealState) {
                debugLog(
                  `LOAD: Preserving existing appeal state from aiIngredients for "${ingredient.name}":`,
                  {
                    userOverriddenScan: ingredient.userOverriddenScan,
                    needsScan: ingredient.needsScan,
                    appealReviewStatus: ingredient.appealReviewStatus,
                  },
                );
              }
            });
          }
        } catch (err) {
          debugWarn("Failed to load appeals:", err);
          // Continue anyway
        }
      }

      // Skip input screen and go directly to ingredient editing table
      renderAiTable(existingIngredients);
      // Show the results section
      if (aiAssistResultsEl) {
        aiAssistResultsEl.classList.add("show");
      }
      // Set the recipe description textarea for existing items too
      if (aiAssistInput) {
        aiAssistInput.value = context?.seedText || "";
      }
      // Mark as saved since we're just loading existing data
      aiAssistState.savedToDish = true;
      // Store initial data to detect real changes
      aiAssistState.initialData = JSON.stringify(existingIngredients);
    } else {
      // New item - show input screen
      if (aiAssistInput) {
        aiAssistInput.value = context?.seedText || "";
        setTimeout(() => {
          aiAssistInput.focus();
          aiAssistInput.selectionStart = aiAssistInput.value.length;
        }, 120);
      }
      renderAiTable([]);
      aiAssistState.savedToDish = false;
      aiAssistState.initialData = null;
    }

    toggleAiAssistBackdrop(true);
  }

  function openImageModal(imageSrc) {
    const modal = document.getElementById("imageModal");
    const img = document.getElementById("imageModalImg");
    if (modal && img) {
      img.src = imageSrc;
      modal.classList.add("show");
      document.body.style.overflow = "hidden";
    }
  }

  function closeImageModal() {
    const modal = document.getElementById("imageModal");
    if (modal) {
      modal.classList.remove("show");
      document.body.style.overflow = "";
    }
  }

  window.openImageModal = openImageModal;
  window.closeImageModal = closeImageModal;

  function closeDishEditor() {
    ensureAiAssistElements();

    // Hide replacement progress card when closing
    const replacementProgressCard = document.getElementById(
      "aiAssistReplacementProgress",
    );
    if (replacementProgressCard) {
      replacementProgressCard.style.display = "none";
    }

    // Check for unsaved changes (don't prompt if already saved to dish)
    const data = collectAiTableData();
    const hasData = data.length > 0 && data.some((item) => item.name.trim());

    // Check if data has actually changed from initial state
    let dataChanged = false;
    if (aiAssistState.initialData) {
      const currentData = JSON.stringify(data);
      dataChanged = currentData !== aiAssistState.initialData;
    } else {
      // No initial data means this is new work
      dataChanged = hasData;
    }

    // Check if dish name has been changed but not saved
    // This includes both:
    // 1. Dish name was modified and saved locally (dishNameModified flag)
    // 2. Dish name has unsaved local changes (current value differs from original)
    const nameInput = document.getElementById("aiAssistNameInput");
    let dishNameHasUnsavedChanges = false;

    // Check if dish name was modified via Save button but not yet applied to dish
    if (aiAssistState.dishNameModified) {
      dishNameHasUnsavedChanges = true;
      debugLog("Dish name was modified and needs to be saved to dish");
    }

    // Also check if there are current unsaved changes in the input field
    if (
      nameInput &&
      aiAssistState.originalDishName !== null &&
      aiAssistState.originalDishName !== undefined
    ) {
      const currentDishName = nameInput.value?.trim() || "";
      if (
        currentDishName !== aiAssistState.originalDishName &&
        currentDishName.length > 0
      ) {
        dishNameHasUnsavedChanges = true;
        debugLog("Dish name has unsaved local changes");
      }
    }

    const hasUnsavedChanges =
      (dataChanged && !aiAssistState.savedToDish) || dishNameHasUnsavedChanges;

    if (hasUnsavedChanges) {
      // Show inline warning instead of confirm dialog
      const warningEl = document.getElementById("aiAssistUnsavedWarning");
      if (warningEl) {
        warningEl.style.display = "block";

        // Scroll warning into view
        warningEl.scrollIntoView({ behavior: "smooth", block: "start" });

        // Set up button handlers
        const saveAndExitBtn = document.getElementById("aiAssistSaveAndExitBtn");
        const exitWithoutSavingBtn = document.getElementById(
          "aiAssistExitWithoutSavingBtn",
        );
        const cancelExitBtn = document.getElementById("aiAssistCancelExitBtn");

        const handleSaveAndExit = () => {
          warningEl.style.display = "none";

          // Save dish name changes if any (if there are unsaved local changes)
          if (nameInput) {
            const currentDishName = nameInput.value?.trim() || "";
            const saveNameBtn = document.getElementById("aiAssistSaveNameBtn");

            // If there are unsaved changes in the input field, save them first
            if (
              currentDishName !== aiAssistState.originalDishName &&
              currentDishName.length > 0
            ) {
              aiAssistState.originalDishName = currentDishName;
              aiAssistState.dishNameModified = true; // Mark as modified
              // Update generate button text to reflect saved name
              if (typeof window.updateGenerateButtonText === "function") {
                window.updateGenerateButtonText();
              }
              // Hide save button
              if (saveNameBtn) saveNameBtn.style.display = "none";
            }
          }

          // Apply ingredients to dish (same as clicking "Save to Dish" button)
          // This will also mark dishNameModified as false
          applyAiIngredientsToOverlay();
        };

        const handleExitWithoutSaving = () => {
          warningEl.style.display = "none";
          // Continue with the actual close
          performAiAssistClose();
        };

        const handleCancelExit = () => {
          warningEl.style.display = "none";
        };

        // Remove old listeners and add new ones
        if (saveAndExitBtn) {
          saveAndExitBtn.replaceWith(saveAndExitBtn.cloneNode(true));
          document.getElementById("aiAssistSaveAndExitBtn").onclick =
            handleSaveAndExit;
        }
        if (exitWithoutSavingBtn) {
          exitWithoutSavingBtn.replaceWith(exitWithoutSavingBtn.cloneNode(true));
          document.getElementById("aiAssistExitWithoutSavingBtn").onclick =
            handleExitWithoutSaving;
        }
        if (cancelExitBtn) {
          cancelExitBtn.replaceWith(cancelExitBtn.cloneNode(true));
          document.getElementById("aiAssistCancelExitBtn").onclick =
            handleCancelExit;
        }

        return; // Stop here, don't close yet
      }
    }

    // If no unsaved changes, close directly
    performAiAssistClose();
  }

  function performAiAssistClose() {
    // Hide warning if visible
    const warningEl = document.getElementById("aiAssistUnsavedWarning");
    if (warningEl) warningEl.style.display = "none";

    if (aiAssistState.recognition) {
      try {
        aiAssistState.recognition.stop();
      } catch (_) {}
    }
    aiAssistState.recognition = null;
    aiAssistState.listening = false;
    aiAssistState.pendingRequestId = null;
    aiAssistState.brandSuggestions = {};
    aiAssistState.savedToDish = false;
    aiAssistState.originalDishName = null; // Reset dish name tracking on close
    aiAssistState.dishNameModified = false; // Reset dish name modification flag on close
    aiAssistSetStatus("");
    stopAiCamera();
    updateAiAssistMediaPreview();
    if (aiAssistResultsEl) {
      aiAssistResultsEl.classList.remove("show");
    }
    if (aiAssistTableBody) {
      aiAssistTableBody.innerHTML = "";
    }
    if (aiAssistBrandResults) {
      aiAssistBrandResults.classList.remove("show");
      aiAssistBrandResults.innerHTML = "";
    }
    const finalConfirmation = document.getElementById(
      "aiAssistFinalConfirmation",
    );
    if (finalConfirmation) {
      finalConfirmation.classList.add("aiAssistHidden");
    }
    if (aiAssistDictateBtn) aiAssistDictateBtn.textContent = "🎙 Dictate";
    toggleAiAssistBackdrop(false);
  }

  function toggleAiDictation() {
    ensureAiAssistElements();
    if (aiAssistState.listening) {
      if (aiAssistState.recognition) {
        try {
          aiAssistState.recognition.stop();
        } catch (_) {}
      }
      aiAssistState.listening = false;
      aiAssistSetStatus("Dictation stopped.", "info");
      if (aiAssistDictateBtn) aiAssistDictateBtn.textContent = "🎙 Dictate";
      return;
    }
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      aiAssistSetStatus("Dictation is not supported in this browser.", "warn");
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (aiAssistInput) aiAssistInput.value = transcript.trim();
      };
      recognition.onerror = (evt) => {
        aiAssistSetStatus("Dictation error: " + (evt.error || "unknown"), "warn");
      };
      recognition.onend = () => {
        aiAssistState.listening = false;
        aiAssistState.recognition = null;
        if (aiAssistDictateBtn) aiAssistDictateBtn.textContent = "🎙 Dictate";
      };
      recognition.start();
      aiAssistState.recognition = recognition;
      aiAssistState.listening = true;
      aiAssistSetStatus("Dictation active… speak now.");
      if (aiAssistDictateBtn)
        aiAssistDictateBtn.textContent = "⏹ Stop dictation";
    } catch (err) {
      console.error("Dictation failed", err);
      aiAssistSetStatus(
        "Could not start dictation: " + (err.message || err),
        "error",
      );
    }
  }

  async function generateRecipeDescription() {
    ensureAiAssistElements();

    const nameInput = document.getElementById("aiAssistNameInput");
    const dishName = nameInput?.value?.trim() || "";

    if (!dishName) {
      aiAssistSetStatus("Please enter a dish name first.", "warn");
      return;
    }

    if (!aiAssistInput) {
      aiAssistSetStatus("Text input field not found.", "error");
      return;
    }

    // Disable button and show loading
    if (aiAssistGenerateBtn) {
      aiAssistGenerateBtn.disabled = true;
      aiAssistGenerateBtn.textContent = "Generating recipe...";
    }
    aiAssistSetStatus("Generating recipe description...", "info");

    try {
      // Use Supabase Edge Function to call Claude for description generation
      const payload = {
        text: `Generate a detailed recipe description for "${dishName}".`,
        dishName: dishName,
        generateDescription: true, // Flag to indicate this is a description generation request
      };

      const result = await requestAiExtractionWithConfig(payload);

      // Extract description from the result
      let generatedDescription = "";

      if (result?.error) {
        throw new Error(result.error);
      }

      // The Edge Function returns {description: "...", text: "..."} for description generation
      if (result?.description) {
        generatedDescription = result.description;
      } else if (result?.text) {
        generatedDescription = result.text;
      } else if (typeof result === "string") {
        generatedDescription = result;
      } else {
        // Fallback if response format is unexpected
        generatedDescription = `A delicious ${dishName} prepared with fresh ingredients and traditional cooking methods.`;
        aiAssistSetStatus(
          "Generated a basic description. You can edit it to add more details.",
          "warn",
        );
      }

      if (generatedDescription && generatedDescription.trim()) {
        // Insert the generated description into the textarea
        aiAssistInput.value = generatedDescription.trim();
        aiAssistSetStatus(
          "Recipe description generated! Review and edit if needed.",
          "success",
        );
      } else {
        aiAssistSetStatus(
          "Could not generate description. Please try again.",
          "warn",
        );
      }
    } catch (error) {
      console.error("Error generating recipe description:", error);
      aiAssistSetStatus(
        "Failed to generate description: " + (error.message || "Unknown error"),
        "error",
      );
    } finally {
      // Re-enable button
      if (aiAssistGenerateBtn) {
        const nameInput = document.getElementById("aiAssistNameInput");
        const dishName = nameInput?.value?.trim() || "recipe";
        aiAssistGenerateBtn.disabled = false;
        aiAssistGenerateBtn.textContent = `✨ Generate generic ${dishName} recipe`;
      }
    }
  }

  async function fetchBrandSuggestions(query, ingredientName, onProgress) {
    ensureAiAssistElements();
    if (!ingredientName) return [];

    // Extract brand filter from query if present
    const brandQuery =
      query !== ingredientName ? query.replace(ingredientName, "").trim() : "";

    debugLog("Fetching brand suggestions:", { ingredientName, brandQuery });

    try {
      // Call the new AI-powered brand search Supabase edge function
      if (onProgress)
        onProgress(30, "Searching for products...", "Querying product database");

      const response = await window.supabaseClient.functions.invoke(
        "ai-brand-search",
        {
          body: {
            ingredientName,
            brandQuery,
          },
        },
      );

      if (response.error) {
        console.error("AI brand search error:", response.error);
        return [];
      }

      const { products, aiReasoning, searchCount, totalFound, withImages } =
        response.data || {};

      debugLog("AI Brand Search Results:", {
        aiReasoning,
        searchCount,
        totalFound,
        withImages,
        productsReturned: products?.length || 0,
      });

      if (aiReasoning) {
        debugLog("AI reasoning:", aiReasoning);
      }

      if (!products || products.length === 0) {
        debugLog("No brand products found with required images");
        return [];
      }

      if (onProgress)
        onProgress(
          50,
          "Products found",
          `Analyzing ${products.length} product${products.length > 1 ? "s" : ""} with AI...`,
        );

      // Filter products to only include those with BOTH ingredient label image AND text ingredient list
      const filteredProducts = products.filter((product) => {
        // Must have ingredient label image for visual verification
        const hasImage =
          product.ingredientsImage && product.ingredientsImage.trim().length > 0;
        // Must have text ingredient list for allergen/diet detection
        const hasIngredientsList =
          product.ingredientsList && product.ingredientsList.length > 0;
        // Both are required
        return hasImage && hasIngredientsList;
      });

      if (onProgress)
        onProgress(
          60,
          "Preparing ingredient lists...",
          `Loaded ${filteredProducts.length} product${filteredProducts.length > 1 ? "s" : ""} with ingredient labels`,
        );

      // Show progress bar for AI analysis (for top-level progress bar)
      const progressBar = document.getElementById("aiProgressBar");
      const progressBarFill = document.getElementById("aiProgressBarFill");
      if (progressBar && progressBarFill && filteredProducts.length > 0) {
        progressBar.classList.add("show");
        progressBarFill.style.width = "30%";
      }

      // Skip AI allergen/diet analysis for brand ingredient lists
      const analyzedProducts = await Promise.all(
        filteredProducts.map(async (product) => {
          const allergens = [];
          const diets = [];
          return {
            name: product.name || "",
            brand: product.brand || "",
            image: product.image || "",
            ingredientsImage: product.ingredientsImage || "",
            ingredientsList: product.ingredientsList || [],
            allergens,
            diets,
            productUrl: product.productUrl || "",
          };
        }),
      );

      // Complete progress bar
      if (progressBarFill) progressBarFill.style.width = "100%";
      setTimeout(() => {
        if (progressBar) progressBar.classList.remove("show");
        if (progressBarFill) progressBarFill.style.width = "0%";
      }, 300);

      return analyzedProducts;
    } catch (err) {
      console.error("Failed to fetch brand suggestions:", err);
      return [];
    }
  }

  async function openAiBrandSearch(rowIdx) {
    ensureAiAssistElements();
    const rows = collectAiTableData();
    if (!rows[rowIdx]) {
      aiAssistSetStatus("Select an ingredient first.", "warn");
      return;
    }

    const ingredientName = rows[rowIdx].name;
    if (!ingredientName) {
      aiAssistSetStatus(
        "Add an ingredient name before searching for a brand.",
        "warn",
      );
      return;
    }

    // Find the row-specific brand results container
    const rowElement = aiAssistTableBody?.querySelector(
      `tr[data-index="${rowIdx}"]`,
    );
    if (!rowElement) return;
    const rowBrandResults = rowElement.querySelector(".aiRowBrandResults");
    if (!rowBrandResults) return;

    // Show search form
    rowBrandResults.classList.add("show");
    rowBrandResults.innerHTML = `
  <div class="aiBrandSearchForm">
    <div style="margin-bottom:12px">
      <label style="display:block;margin-bottom:6px;font-weight:500">Ingredient: <strong>${esc(ingredientName)}</strong></label>
      <input type="text" class="aiBrandSearchInput" placeholder="Optional: brand name (e.g., 'Chobani', 'Once Again')" style="width:100%;padding:8px;background:#0c102a;border:1px solid rgba(76,90,212,0.4);border-radius:8px;color:#fff">
    </div>
    <div style="display:flex;gap:8px">
      <button type="button" class="btn aiBrandSearchSubmit">Search</button>
      <button type="button" class="btn aiBrandSearchCancel" style="background:#301424;border-color:#4c2138">Cancel</button>
    </div>
  </div>
    `;

    const searchInput = rowBrandResults.querySelector(".aiBrandSearchInput");
    const submitBtn = rowBrandResults.querySelector(".aiBrandSearchSubmit");
    const cancelBtn = rowBrandResults.querySelector(".aiBrandSearchCancel");

    const performSearch = async () => {
      const brandFilter = searchInput.value.trim();
      const query = brandFilter
        ? `${ingredientName} ${brandFilter}`
        : ingredientName;

      aiAssistSetStatus("Searching for brand suggestions…");
      rowBrandResults.innerHTML = `
    <div style="padding:20px;text-align:center">
      <div id="brandSearchStatus" style="font-size:1rem;margin-bottom:12px;color:#a8b2d6">Searching for products...</div>
      <div class="aiProgressBar show" style="display:block;margin:0 auto;max-width:300px">
        <div id="brandSearchProgress" class="aiProgressBarFill" style="width:10%;animation:shimmer 1.5s infinite"></div>
      </div>
      <div id="brandSearchSubtext" style="font-size:0.85rem;margin-top:8px;color:#8891b0">Querying product database</div>
    </div>
  `;

      // Helper to update progress
      const updateProgress = (percent, status, subtext) => {
        const progressBar = document.getElementById("brandSearchProgress");
        const statusEl = document.getElementById("brandSearchStatus");
        const subtextEl = document.getElementById("brandSearchSubtext");
        if (progressBar) progressBar.style.width = percent + "%";
        if (statusEl && status) statusEl.textContent = status;
        if (subtextEl && subtext) subtextEl.textContent = subtext;
      };

      try {
        // Small delay to let DOM update
        await new Promise((resolve) => setTimeout(resolve, 50));
        updateProgress(
          20,
          "Searching for products...",
          "Querying product database",
        );

        const suggestions = await fetchBrandSuggestions(
          query,
          ingredientName,
          updateProgress,
        );

        updateProgress(100, "Complete!", "Products analyzed");
        aiAssistState.brandSuggestions[rowIdx] = suggestions;
        if (!suggestions.length) {
          rowBrandResults.innerHTML = `
        <div style="text-align:center;padding:20px">
          <p style="margin-bottom:12px">No brands found.</p>
          <button type="button" class="btn aiBrandSearchAgain">Try a different search</button>
        </div>
      `;
          rowBrandResults
            .querySelector(".aiBrandSearchAgain")
            .addEventListener("click", () => {
              openAiBrandSearch(rowIdx);
            });
          return;
        }
        rowBrandResults.innerHTML = `
      <div style="background:rgba(220,82,82,0.15);border:1px solid rgba(220,82,82,0.4);border-radius:12px;padding:12px;margin-bottom:16px">
        <strong style="color:#dc5252">⚠️ Safety Warning</strong>
        <p style="margin:8px 0 0 0;font-size:0.9rem;line-height:1.4">Data is crowdsourced and may be outdated or incorrect. ALWAYS verify ingredient labels match the actual product image before relying on allergen information.</p>
      </div>
      ${suggestions
        .map(
          (item, idx) => `
      <div class="aiBrandSuggestion" data-row="${rowIdx}" data-index="${idx}">
        ${item.image ? `<img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy">` : ""}
        <div class="aiBrandSuggestionInfo">
          <strong>${esc(item.name)}</strong>
          ${item.brand ? `<span>${esc(item.brand)}</span>` : ""}
          ${item.ingredientsImage ? '<span style="color:#4c5ad4">✓ Has label image - click to verify</span>' : '<span style="color:#dc5252">⚠️ No label image available</span>'}
          ${item.productUrl ? `<a href="${esc(item.productUrl)}" target="_blank" rel="noopener" style="font-size:0.85rem;color:#4c5ad4">View on Open Food Facts</a>` : ""}
          <button type="button" class="btn btnSmall aiBrandApply" data-row="${rowIdx}" data-index="${idx}" style="margin-top:8px">Add this brand</button>
        </div>
      </div>
    `,
        )
        .join("")}
    <div style="text-align:center;margin-top:16px;padding-top:16px;border-top:1px solid rgba(76,90,212,0.2)">
      <button type="button" class="btn aiBrandSearchAgain">Search again</button>
    </div>
    `;

        // Add click handlers for "Add this brand" buttons
        rowBrandResults.querySelectorAll(".aiBrandApply").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const suggestionIdx = Number(e.target.dataset.index);
            applyBrandSuggestion(rowIdx, suggestionIdx);
          });
        });

        // Add click handler for "Search again" button
        rowBrandResults
          .querySelector(".aiBrandSearchAgain")
          .addEventListener("click", () => {
            openAiBrandSearch(rowIdx);
          });

        aiAssistSetStatus(
          "Review images carefully before applying. Click images to verify ingredient labels match.",
          "warn",
        );
      } catch (err) {
        console.error("Brand lookup failed", err);
        rowBrandResults.innerHTML =
          "<div>Could not retrieve brand information.</div>";
        aiAssistSetStatus("Brand lookup failed. Try again later.", "warn");
      }
    };

    submitBtn.addEventListener("click", performSearch);
    cancelBtn.addEventListener("click", () => {
      rowBrandResults.classList.remove("show");
      rowBrandResults.innerHTML = "";
    });
    searchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        performSearch();
      }
    });

    // Focus the input
    setTimeout(() => searchInput.focus(), 100);
  }

  function applyExistingBrandToRow(rowIdx, brandItem) {
    if (!brandItem) return;
    const suggestion = {
      brand: brandItem.brandName || brandItem.ingredientName || "",
      name: brandItem.brandName || brandItem.ingredientName || "",
      brandImage: brandItem.brandImage || "",
      ingredientsImage: brandItem.ingredientsImage || "",
      ingredientsList: Array.isArray(brandItem.ingredientsList)
        ? brandItem.ingredientsList
        : [],
      allergens: Array.isArray(brandItem.allergens) ? brandItem.allergens : [],
      diets: Array.isArray(brandItem.diets) ? brandItem.diets : [],
      crossContamination: Array.isArray(brandItem.crossContamination)
        ? brandItem.crossContamination
        : [],
      crossContaminationDiets: Array.isArray(brandItem.crossContaminationDiets)
        ? brandItem.crossContaminationDiets
        : [],
    };
    applyBrandSuggestionConfirmed(rowIdx, suggestion);
    aiAssistSetStatus(
      `Added existing item "${brandItem.brandName || brandItem.ingredientName}".`,
      "success",
    );
    aiAssistState.savedToDish = false;
  }

  function openExistingBrandSearchModal(rowIdx) {
    ensureAiAssistElements();
    const rows = collectAiTableData();
    if (!rows[rowIdx]) {
      aiAssistSetStatus("Select an ingredient first.", "warn");
      return;
    }

    const getBrandItems =
      typeof collectAllBrandItems === "function"
        ? collectAllBrandItems
        : window.collectAllBrandItems || window.collectAiBrandItems || null;
    const brandItems = getBrandItems ? getBrandItems() : [];
    const sortedItems = brandItems
      .slice()
      .sort((a, b) => (a.brandName || "").localeCompare(b.brandName || ""));

    const modal = document.createElement("div");
    modal.style.cssText = `
      position:fixed;
      top:0;
      left:0;
      width:100%;
      height:100%;
      background:rgba(6,10,24,0.9);
      display:flex;
      align-items:center;
      justify-content:center;
      z-index:10002;
      padding:20px;
    `;

    const modalContent = document.createElement("div");
    modalContent.style.cssText = `
      background:#0c102a;
      border:2px solid #4c5ad4;
      border-radius:16px;
      width:100%;
      max-width:760px;
      max-height:80vh;
      display:flex;
      flex-direction:column;
      color:#fff;
      padding:20px;
    `;

    modalContent.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px">
        <div>
          <div style="font-size:1.2rem;font-weight:700">Search existing items</div>
          <div style="font-size:0.85rem;color:#a8b2d6">Pick a brand item you've already added elsewhere.</div>
        </div>
        <button type="button" class="btn closeExistingBrandModal" style="background:#301424;border-color:#4c2138">✕</button>
      </div>
      <div style="margin-bottom:12px">
        <input type="text" class="existingBrandSearchInput" placeholder="Search by brand or ingredient" style="width:100%;padding:10px 12px;background:#0c102a;border:1px solid rgba(76,90,212,0.4);border-radius:10px;color:#fff">
      </div>
      <div class="existingBrandSearchList" style="flex:1;overflow:auto;border:1px solid rgba(76,90,212,0.3);border-radius:12px;padding:12px;background:rgba(12,16,42,0.6)">
      </div>
      <div style="margin-top:12px;display:flex;justify-content:flex-end">
        <button type="button" class="btn closeExistingBrandModal" style="background:#301424;border-color:#4c2138">Close</button>
      </div>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    const listEl = modalContent.querySelector(".existingBrandSearchList");
    const searchInput = modalContent.querySelector(".existingBrandSearchInput");

    const renderResults = (query = "") => {
      const term = query.trim().toLowerCase();
      const results = sortedItems
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => {
          if (!term) return true;
          const ingredientNames = Array.isArray(item.ingredientNames)
            ? item.ingredientNames.join(" ")
            : item.ingredientName || "";
          const haystack = [
            item.brandName,
            item.ingredientName,
            ingredientNames,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(term);
        });

      if (!results.length) {
        listEl.innerHTML = `
          <div style="text-align:center;padding:24px;color:#a8b2d6">
            No matching items found.
          </div>
        `;
        return;
      }

      listEl.innerHTML = results
        .map(
          ({ item, index }) => `
        <div style="display:flex;gap:14px;align-items:flex-start;border:1px solid rgba(76,90,212,0.25);border-radius:12px;padding:12px;margin-bottom:12px;background:rgba(16,22,60,0.6)">
          <div style="width:72px;height:72px;border-radius:10px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">
            ${item.brandImage ? `<img src="${esc(item.brandImage)}" alt="${esc(item.brandName || "Brand")}" style="width:100%;height:100%;object-fit:contain" loading="lazy">` : `<span style="font-size:0.7rem;color:#7c8db5;text-align:center">No image</span>`}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:1rem;margin-bottom:4px">${esc(item.brandName || "Brand item")}</div>
            <div style="color:#a8b2d6;font-size:0.85rem;margin-bottom:6px">
              ${
                item.ingredientNames && item.ingredientNames.length > 1
                  ? `Ingredients: ${esc(item.ingredientNames.join(", "))}`
                  : `Ingredient: ${esc(item.ingredientName || "—")}`
              }
            </div>
            <div style="color:#8891b0;font-size:0.8rem;margin-bottom:6px">Used in ${item.dishes.length} dish${item.dishes.length !== 1 ? "es" : ""}</div>
            ${item.allergens && item.allergens.length ? `<div style="color:#fca5a5;font-size:0.78rem;margin-bottom:4px">Contains: ${item.allergens.map((a) => esc(a)).join(", ")}</div>` : ""}
            ${item.crossContamination && item.crossContamination.length ? `<div style="color:#facc15;font-size:0.78rem;margin-bottom:4px">Cross-contamination: ${item.crossContamination.map((a) => esc(a)).join(", ")}</div>` : ""}
            ${item.diets && item.diets.length ? `<div style="color:#93c5fd;font-size:0.78rem;margin-bottom:4px">Diets: ${item.diets.map((d) => esc(d)).join(", ")}</div>` : ""}
            ${item.crossContaminationDiets && item.crossContaminationDiets.length ? `<div style="color:#60a5fa;font-size:0.78rem;margin-bottom:4px">Cross-contam diets: ${item.crossContaminationDiets.map((d) => esc(d)).join(", ")}</div>` : ""}
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0">
            <button type="button" class="btn btnSmall useExistingBrandBtn" data-index="${index}" style="white-space:nowrap">Use this item</button>
          </div>
        </div>
      `,
        )
        .join("");
    };

    renderResults();

    listEl.addEventListener("click", (e) => {
      const applyBtn = e.target.closest(".useExistingBrandBtn");
      if (applyBtn) {
        const idx = Number(applyBtn.dataset.index);
        const item = sortedItems[idx];
        if (item) {
          applyExistingBrandToRow(rowIdx, item);
          document.body.removeChild(modal);
        }
        return;
      }
      const viewBtn = e.target.closest(".viewExistingLabelBtn");
      if (viewBtn) {
        const src = viewBtn.dataset.src || "";
        if (src) openImageModal(src);
      }
    });

    searchInput.addEventListener("input", () => renderResults(searchInput.value));
    setTimeout(() => searchInput.focus(), 100);

    const closeModal = () => {
      if (modal.parentNode) document.body.removeChild(modal);
    };

    modal.querySelectorAll(".closeExistingBrandModal").forEach((btn) => {
      btn.addEventListener("click", closeModal);
    });
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  async function removeAppeal(rowIdx) {
    const rows = collectAiTableData();
    if (!rows[rowIdx]) {
      aiAssistSetStatus(
        "Could not find ingredient to remove appeal from.",
        "warn",
      );
      return;
    }

    const ingredientName = rows[rowIdx].name;
    if (!ingredientName) {
      aiAssistSetStatus("Could not find ingredient name.", "warn");
      return;
    }

    // Confirm removal
    if (
      !confirm(
        `Remove the appeal for "${ingredientName}"? This will restore the scan requirement.`,
      )
    ) {
      return;
    }

    // Delete appeal from database
    const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
    if (restaurantId && window.supabaseClient) {
      try {
        // Get current dish name to scope the delete to this specific dish
        const dishName = aiAssistState.context?.getCurrentName
          ? aiAssistState.context.getCurrentName()
          : "";

        let deleteQuery = window.supabaseClient
          .from("ingredient_scan_appeals")
          .delete()
          .eq("restaurant_id", restaurantId)
          .eq("ingredient_name", ingredientName)
          .eq("ingredient_row_index", rowIdx);

        // Also filter by dish_name to ensure we only delete appeals for this dish
        if (dishName) {
          deleteQuery = deleteQuery.eq("dish_name", dishName);
        } else {
          deleteQuery = deleteQuery.is("dish_name", null);
        }

        const { error: deleteError } = await deleteQuery;

        if (deleteError) {
          console.error("Failed to delete appeal from database:", deleteError);
          // Continue with UI update even if database delete fails
        } else {
          debugLog("Appeal deleted from database successfully");
        }
      } catch (deleteErr) {
        console.error("Exception deleting appeal from database:", deleteErr);
        // Continue with UI update even if database delete fails
      }
    }

    // Remove the appeal state
    const data = collectAiTableData();
    if (data[rowIdx]) {
      data[rowIdx].userOverriddenScan = false;
      // Restore needsScan to true (the AI originally recommended scanning)
      data[rowIdx].needsScan = true;
      // Reset confirmed state since we're changing the scan requirement
      data[rowIdx].confirmed = false;
      debugLog(
        "REMOVE APPEAL: Removed appeal state for row",
        rowIdx,
        data[rowIdx],
      );
      renderAiTable(data);

      // Ensure the confirm button UI is reset
      setTimeout(() => {
        const tableRows = document.querySelectorAll("#aiIngredientList tr");
        if (tableRows[rowIdx]) {
          resetConfirmButton(tableRows[rowIdx]);
        }
      }, 100);
    }

    // Email notification removed per user request - don't send emails when appeals are removed

    aiAssistSetStatus(
      `Appeal removed for "${ingredientName}". Scan requirement restored.`,
      "success",
    );

    // Mark as unsaved so manager is prompted to save changes
    aiAssistState.savedToDish = false;
  }

  async function openAiAppealModal(rowIdx) {
    ensureAiAssistElements();
    const rows = collectAiTableData();
    if (!rows[rowIdx]) {
      aiAssistSetStatus("Select an ingredient first.", "warn");
      return;
    }

    const ingredientName = rows[rowIdx].name;
    if (!ingredientName) {
      aiAssistSetStatus("Add an ingredient name before appealing.", "warn");
      return;
    }

    // Create a full-screen modal overlay for the appeal
    const appealModal = document.createElement("div");
    appealModal.id = "appealScanModal";
    appealModal.style.cssText = `
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.95);
  z-index: 10000;
  display: block;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  padding: 20px;
  padding-top: max(20px, env(safe-area-inset-top));
  padding-bottom: max(24px, env(safe-area-inset-bottom));
  box-sizing: border-box;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  overscroll-behavior: contain;
    `;

    appealModal.innerHTML = `
  <div style="width:100%;max-width:600px;display:flex;flex-direction:column;gap:16px;margin:0 auto;padding-bottom:24px">
    <div style="text-align:center">
      <h3 style="margin:0 0 8px 0;font-size:1.4rem;color:#fff">Appeal AI Scanning Decision</h3>
      <div style="margin:0;color:#a8b2d6;font-size:0.95rem">
        Ingredient: <strong style="color:#fff">${esc(ingredientName)}</strong>
      </div>
      <p style="margin:8px 0 0 0;color:#a8b2d6;font-size:0.9rem">Please take a photo of the food product(s) used for this part of the dish</p>
    </div>
    <div style="position:relative;background:#000;border-radius:12px;overflow:hidden;margin:16px 0">
      <video id="appealCameraVideo" autoplay playsinline muted style="width:100%;height:60vh;max-height:500px;display:none;object-fit:cover"></video>
      <canvas id="appealCameraCanvas" style="display:none"></canvas>
      <img id="appealPhotoPreview" style="width:100%;height:60vh;max-height:500px;object-fit:contain;display:none" alt="Preview">
      <div id="appealCameraPlaceholder" style="width:100%;height:60vh;max-height:500px;display:none;align-items:center;justify-content:center;background:#1a1a1a;color:#a8b2d6;font-size:1.1rem">No photo taken yet</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <label for="appealMessage" style="color:#fff;font-weight:600;font-size:0.95rem">Add a message (optional)</label>
      <textarea id="appealMessage" placeholder="Explain why you disagree with the AI scan recommendation..." style="width:100%;padding:12px;border:2px solid #4c5ad4;border-radius:8px;font-size:0.95rem;font-family:inherit;min-height:80px;resize:vertical;box-sizing:border-box;background:#1a1a1a;color:#fff" maxlength="500"></textarea>
      <div style="text-align:right;color:#a8b2d6;font-size:0.85rem" id="appealMessageCharCount">0/500</div>
    </div>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
      <button type="button" class="btn aiAppealCameraBtn" style="background:#4c5ad4;border-color:#4c5ad4;padding:12px 32px;font-size:1rem">📷 Use Camera</button>
      <button type="button" class="btn aiAppealUploadBtn" style="background:#4c5ad4;border-color:#4c5ad4;padding:12px 32px;font-size:1rem">📁 Upload Photo</button>
      <button type="button" class="btn aiAppealCaptureBtn" style="background:#4c5ad4;border-color:#4c5ad4;padding:12px 32px;font-size:1rem;display:none">Capture Photo</button>
      <button type="button" class="btn aiAppealSubmitBtn" style="background:#17663a;border-color:#1a7b46;padding:12px 32px;font-size:1rem;display:none">Submit Appeal</button>
      <button type="button" class="btn aiAppealCancelBtn" style="background:#ef4444;border-color:#dc2626;padding:12px 32px;font-size:1rem">Cancel</button>
    </div>
    <div id="appealStatus" style="text-align:center;color:#a8b2d6;font-size:0.9rem;min-height:24px"></div>
    <input type="file" id="appealImageUpload" accept="image/*" style="display:none">
  </div>
    `;

    // Lock background scrolling
    scrollLockPosition = window.pageYOffset || document.documentElement.scrollTop;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollLockPosition}px`;
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    document.body.appendChild(appealModal);

    const video = appealModal.querySelector("#appealCameraVideo");
    const canvas = appealModal.querySelector("#appealCameraCanvas");
    const preview = appealModal.querySelector("#appealPhotoPreview");
    const placeholder = appealModal.querySelector("#appealCameraPlaceholder");
    const cameraBtn = appealModal.querySelector(".aiAppealCameraBtn");
    const uploadBtn = appealModal.querySelector(".aiAppealUploadBtn");
    const captureBtn = appealModal.querySelector(".aiAppealCaptureBtn");
    const submitBtn = appealModal.querySelector(".aiAppealSubmitBtn");
    const cancelBtn = appealModal.querySelector(".aiAppealCancelBtn");
    const fileInput = appealModal.querySelector("#appealImageUpload");
    const statusDiv = appealModal.querySelector("#appealStatus");
    const messageTextarea = appealModal.querySelector("#appealMessage");
    const charCountDiv = appealModal.querySelector("#appealMessageCharCount");

    let mediaStream = null;
    let capturedPhoto = null;

    // Character counter for message textarea
    if (messageTextarea && charCountDiv) {
      messageTextarea.addEventListener("input", () => {
        const length = messageTextarea.value.length;
        charCountDiv.textContent = `${length}/500`;
      });
    }

    const stopCamera = () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
      }
      if (video) video.srcObject = null;
    };

    const closeModal = () => {
      stopCamera();
      if (appealModal && appealModal.parentNode) {
        appealModal.parentNode.removeChild(appealModal);
      }
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      document.body.style.overflow = "";
      window.scrollTo(0, scrollLockPosition);
    };

    const showPreview = (dataUrl) => {
      capturedPhoto = dataUrl;
      placeholder.style.display = "none";
      video.style.display = "none";
      preview.style.display = "block";
      preview.src = dataUrl;
      captureBtn.style.display = "none";
      submitBtn.style.display = "inline-block";
      cameraBtn.style.display = "inline-block";
      uploadBtn.style.display = "inline-block";
    };

    cameraBtn.addEventListener("click", async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        mediaStream = stream;
        video.srcObject = stream;
        video.play();
        placeholder.style.display = "none";
        video.style.display = "block";
        preview.style.display = "none";
        captureBtn.style.display = "inline-block";
        submitBtn.style.display = "none";
        statusDiv.textContent =
          "Position the ingredient in view and click Capture";
      } catch (err) {
        console.error("Camera access failed", err);
        statusDiv.textContent =
          "Could not access camera: " + (err.message || err);
        statusDiv.style.color = "#ef4444";
      }
    });

    captureBtn.addEventListener("click", () => {
      if (video && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        showPreview(dataUrl);
        stopCamera();
      }
    });

    uploadBtn.addEventListener("click", () => {
      fileInput.click();
    });

    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          showPreview(event.target.result);
        };
        reader.readAsDataURL(file);
      }
    });

    submitBtn.addEventListener("click", async () => {
      if (!capturedPhoto) {
        statusDiv.textContent = "Please take or upload a photo first";
        statusDiv.style.color = "#ef4444";
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting...";
      statusDiv.textContent = "Submitting appeal...";
      statusDiv.style.color = "#a8b2d6";

      try {
        // Wait for Supabase client to be available
        let client = null;
        if (window.supabaseClient) {
          client = window.supabaseClient;
        } else if (window.getSupabaseClient) {
          client = await window.getSupabaseClient();
        } else {
          // Wait a bit for client to initialize
          await new Promise((resolve) => {
            const check = setInterval(() => {
              if (window.supabaseClient) {
                clearInterval(check);
                client = window.supabaseClient;
                resolve();
              }
            }, 50);
            setTimeout(() => {
              clearInterval(check);
              resolve();
            }, 2000);
          });
          if (!client) throw new Error("Supabase client not available");
        }

        const restaurantId =
          state.restaurant?._id || state.restaurant?.id || null;

        // Upload photo to Supabase storage
        // Convert data URL to blob
        const photoBlob = await (await fetch(capturedPhoto)).blob();
        const fileName = `appeal-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;

        // Try to upload to storage
        let photoUrl = null;
        try {
          const { data: uploadData, error: uploadError } = await client.storage
            .from("ingredient-appeals")
            .upload(fileName, photoBlob, {
              contentType: "image/jpeg",
              upsert: false,
            });

          if (uploadError) {
            console.error(
              "Storage upload failed (400 Bad Request), using data URL instead:",
              uploadError,
            );
            console.error("Upload error details:", {
              message: uploadError.message,
              statusCode: uploadError.statusCode,
              error: uploadError.error,
            });
            // Fallback: use data URL directly if storage fails
            // This is fine - the database can store data URLs
            photoUrl = capturedPhoto;
          } else {
            // Get public URL
            const { data: urlData } = client.storage
              .from("ingredient-appeals")
              .getPublicUrl(fileName);
            photoUrl = urlData.publicUrl;
            debugLog("Photo uploaded successfully to storage:", photoUrl);
          }
        } catch (storageErr) {
          console.error(
            "Storage operation failed with exception, using data URL instead:",
            storageErr,
          );
          // Fallback: use data URL directly if storage bucket doesn't exist or other error
          photoUrl = capturedPhoto;
        }

        // Always ensure we have a photo URL before proceeding
        if (!photoUrl) {
          debugWarn("No photo URL available, using data URL");
          photoUrl = capturedPhoto;
        }

        // Save appeal to database
        // Note: Even if this fails, we'll still update the UI state
        let dbSuccess = false;
        try {
          const managerMessage = messageTextarea
            ? messageTextarea.value.trim()
            : "";
          // Get current dish name to scope appeals per dish
          const dishName = aiAssistState.context?.getCurrentName
            ? aiAssistState.context.getCurrentName()
            : "";
          const { error: dbError } = await client
            .from("ingredient_scan_appeals")
            .insert([
              {
                restaurant_id: restaurantId,
                dish_name: dishName || null,
                ingredient_name: ingredientName,
                ingredient_row_index: rowIdx,
                photo_url: photoUrl,
                ai_recommended_scan: true,
                manager_disagrees: true,
                manager_message: managerMessage || null,
                submitted_at: new Date().toISOString(),
              },
            ]);

          if (dbError) {
            console.error(
              "Database insert failed (RLS policy?), but continuing with UI update:",
              dbError,
            );
            console.error("Database error details:", {
              message: dbError.message,
              code: dbError.code,
              details: dbError.details,
              hint: dbError.hint,
            });
            // Don't throw - we'll still update the UI state
          } else {
            dbSuccess = true;
            debugLog("Appeal record saved to database successfully");
          }
        } catch (dbErr) {
          console.error(
            "Database insert exception (RLS policy?), but continuing with UI update:",
            dbErr,
          );
          // Don't throw - we'll still update the UI state
        }

        // Send email notification
        try {
          const restaurantName = state.restaurant?.name || "Unknown Restaurant";
          const restaurantSlug = state.restaurant?.slug || slug || "";

          const SUPABASE_URL = "https://fgoiyycctnwnghrvsilt.supabase.co";
          await fetch(`${SUPABASE_URL}/functions/v1/send-notification-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_KEY}`,
              apikey: SUPABASE_KEY,
            },
            body: JSON.stringify({
              type: "appeal",
              restaurantName: restaurantName,
              ingredientName: ingredientName,
              photoUrl: photoUrl,
              restaurantSlug: restaurantSlug,
            }),
          }).catch((err) => {
            debugWarn("Failed to send email notification:", err);
            // Don't fail the appeal submission if email fails
          });
        } catch (emailErr) {
          debugWarn("Email notification error:", emailErr);
          // Don't fail the appeal submission if email fails
        }

        if (dbSuccess) {
          statusDiv.textContent =
            "✓ Appeal submitted successfully! We will review it.";
        } else {
          statusDiv.textContent =
            "✓ Appeal recorded locally (database save failed, but your changes are saved). Please save your dish to persist changes.";
          debugWarn(
            "Appeal was not saved to database, but UI state was updated. Manager should save dish to persist.",
          );
        }
        statusDiv.style.color = "#4caf50";

        // Update the row to remove the scan recommendation
        const data = collectAiTableData();
        debugLog(
          "APPEAL: After appeal, before update - data[rowIdx]:",
          data[rowIdx],
        );
        if (data[rowIdx]) {
          data[rowIdx].needsScan = false;
          data[rowIdx].userOverriddenScan = true;
          // Reset confirmed state - user needs to confirm again after appealing
          data[rowIdx].confirmed = false;
          debugLog(
            "APPEAL: After setting userOverriddenScan - data[rowIdx]:",
            JSON.stringify(data[rowIdx], null, 2),
          );
          renderAiTable(data);

          // Ensure the confirm button UI is reset
          setTimeout(() => {
            const tableRows = document.querySelectorAll("#aiIngredientList tr");
            if (tableRows[rowIdx]) {
              resetConfirmButton(tableRows[rowIdx]);
            }
          }, 100);
        }

        // Re-collect after re-render to verify it's saved
        const verifyData = collectAiTableData();
        debugLog(
          "APPEAL: After renderAiTable - verifyData[rowIdx]:",
          JSON.stringify(verifyData[rowIdx], null, 2),
        );
        debugLog(
          "APPEAL: Verifying needsScan and userOverriddenScan are preserved:",
          {
            needsScan: verifyData[rowIdx]?.needsScan,
            userOverriddenScan: verifyData[rowIdx]?.userOverriddenScan,
            confirmed: verifyData[rowIdx]?.confirmed,
          },
        );

        // Mark as unsaved so manager is prompted to save changes
        aiAssistState.savedToDish = false;

        setTimeout(() => {
          closeModal();
          aiAssistSetStatus(
            "Appeal submitted. You can continue working on this ingredient.",
            "success",
          );
        }, 2000);
      } catch (err) {
        console.error("Appeal submission failed", err);
        statusDiv.textContent =
          "Failed to submit appeal: " + (err.message || err);
        statusDiv.style.color = "#ef4444";
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Appeal";
      }
    });

    cancelBtn.addEventListener("click", closeModal);
    appealModal.addEventListener("click", (e) => {
      if (e.target === appealModal) closeModal();
    });
  }


  function applyBrandSuggestionConfirmed(rowIdx, suggestion) {
    const row = aiAssistTableBody?.querySelector(`tr[data-index="${rowIdx}"]`);
    if (!row) return;

    // Get existing brands array
    let brands = [];
    if (row.dataset.brands) {
      try {
        brands = JSON.parse(row.dataset.brands);
      } catch (_) {}
    }

    const coerceLabel = (value) =>
      value && typeof value === "object" && value.name ? value.name : value;

    // Add new brand to the array
    // Extract allergen names from [{name, triggers}] format if needed
    let allergenNames = [];
    if (Array.isArray(suggestion.allergens)) {
      allergenNames = suggestion.allergens
        .map(coerceLabel)
        .filter((value) => value !== undefined && value !== null && value !== "");
    }

    // Extract compliant diet names from dietary_compliance object if needed
    let dietNames = [];
    if (Array.isArray(suggestion.diets)) {
      dietNames = suggestion.diets;
    } else if (suggestion.diets && typeof suggestion.diets === "object") {
      // dietary_compliance object format: {DietName: {is_compliant, reason}}
      dietNames = Object.entries(suggestion.diets)
        .filter(([_, diet]) => diet.is_compliant)
        .map(([name]) => name);
    }
    // Also check dietaryCompliance field
    if (
      dietNames.length === 0 &&
      suggestion.dietaryCompliance &&
      typeof suggestion.dietaryCompliance === "object"
    ) {
      dietNames = Object.entries(suggestion.dietaryCompliance)
        .filter(([_, diet]) => diet.is_compliant)
        .map(([name]) => name);
    }
    dietNames = dietNames.filter(
      (value) => value !== undefined && value !== null && value !== "",
    );

    const normalizedIngredientsList =
      Array.isArray(suggestion.ingredientsList) &&
      suggestion.ingredientsList.length > 0
        ? suggestion.ingredientsList
        : suggestion.ingredientList
          ? [suggestion.ingredientList]
          : typeof suggestion.ingredientsList === "string" &&
              suggestion.ingredientsList.trim()
            ? [suggestion.ingredientsList]
            : [];

    debugLog("Extracted allergen names:", allergenNames);
    debugLog("Extracted diet names:", dietNames);

    const suggestionCrossContamination = [
      ...(Array.isArray(suggestion.crossContamination)
        ? suggestion.crossContamination
        : []),
      ...(Array.isArray(suggestion.crossContaminationAllergens)
        ? suggestion.crossContaminationAllergens
        : []),
    ]
      .map(coerceLabel)
      .filter((value) => value !== undefined && value !== null && value !== "");
    const suggestionCrossContaminationDiets = (
      Array.isArray(suggestion.crossContaminationDiets)
        ? suggestion.crossContaminationDiets
        : []
    )
      .map(coerceLabel)
      .filter((value) => value !== undefined && value !== null && value !== "");

    const newBrand = {
      name: suggestion.brand || suggestion.name || "Brand",
      brandImage: suggestion.brandImage || suggestion.image || "", // Prefer brandImage (product front photo), fallback to image
      ingredientsImage: suggestion.ingredientsImage || "", // Use ingredient label photo
      ingredientsList: normalizedIngredientsList,
      allergens: allergenNames,
      diets: dietNames,
      crossContamination: suggestionCrossContamination,
      crossContaminationDiets: suggestionCrossContaminationDiets,
    };

    debugLog("Adding brand:", newBrand);
    brands.push(newBrand);

    // IMPORTANT: Update the DOM row's dataset BEFORE calling collectAiTableData
    // This ensures the brands data is available when we collect and re-render
    row.dataset.brands = JSON.stringify(brands);
    debugLog("Updated row.dataset.brands:", row.dataset.brands);

    // Collect all allergens and diets from all brands (union)
    const brandAllergens = new Set();
    const brandDiets = new Set();
    const brandCrossContamination = new Set();
    const brandCrossContaminationDiets = new Set();
    brands.forEach((brand) => {
      if (Array.isArray(brand.allergens)) {
        brand.allergens.forEach((a) => {
          if (a !== undefined && a !== null && a !== "")
            brandAllergens.add(a);
        });
      }
      if (Array.isArray(brand.diets)) {
        brand.diets.forEach((d) => {
          if (d !== undefined && d !== null && d !== "") brandDiets.add(d);
        });
      }
      if (Array.isArray(brand.crossContamination)) {
        brand.crossContamination.forEach((a) => {
          if (a !== undefined && a !== null && a !== "")
            brandCrossContamination.add(a);
        });
      }
      if (Array.isArray(brand.crossContaminationDiets)) {
        brand.crossContaminationDiets.forEach((d) => {
          if (d !== undefined && d !== null && d !== "")
            brandCrossContaminationDiets.add(d);
        });
      }
    });
    debugLog("Brand allergens:", Array.from(brandAllergens));
    debugLog("Brand diets:", Array.from(brandDiets));

    // Now collect data first to get base ingredient allergens/diets
    const allData = collectAiTableData();
    debugLog("Collected data before brand apply:", allData[rowIdx]);

    // Merge base ingredient allergens/diets with brand allergens/diets (union)
    if (allData[rowIdx]) {
      // OVERWRITE base allergens/diets with brand allergens/diets
      // This clears any previous AI-detected allergens from the text (e.g. "sesame seeds")
      // and ensures only the brand's allergens are present.
      allData[rowIdx].allergens = Array.from(brandAllergens);

      const mergedBrandDiets = Array.from(brandDiets);
      debugLog("Applying brand diets:", mergedBrandDiets);

      allData[rowIdx].diets = mergedBrandDiets;
      allData[rowIdx].aiDetectedAllergens = Array.from(brandAllergens);
      allData[rowIdx].aiDetectedDiets = mergedBrandDiets;
      allData[rowIdx].confirmed = false;

      // Handle cross-contamination allergens from all brands
      suggestionCrossContamination.forEach((value) =>
        brandCrossContamination.add(value),
      );
      suggestionCrossContaminationDiets.forEach((value) =>
        brandCrossContaminationDiets.add(value),
      );
      const mergedCrossContamination = Array.from(brandCrossContamination);
      const mergedCrossContaminationDiets = Array.from(
        brandCrossContaminationDiets,
      );
      debugLog(
        "Applying cross-contamination allergens:",
        mergedCrossContamination,
      );
      // Store as crossContamination (the field name used by renderAiTable)
      allData[rowIdx].crossContamination = mergedCrossContamination;
      // Also add them to the DOM row's dataset
      row.dataset.crossContamination = JSON.stringify(mergedCrossContamination);

      // Track cross-contamination allergens separately so the UI expects "cross-contamination" state.
      allData[rowIdx].aiDetectedCrossContamination = mergedCrossContamination;
      row.dataset.aiDetectedCrossContamination = JSON.stringify(
        mergedCrossContamination,
      );

      allData[rowIdx].crossContaminationDiets = mergedCrossContaminationDiets;
      row.dataset.crossContaminationDiets = JSON.stringify(
        allData[rowIdx].crossContaminationDiets,
      );

      // Track which diets were detected as crosscontamination by AI
      allData[rowIdx].aiDetectedCrossContaminationDiets =
        mergedCrossContaminationDiets;
      row.dataset.aiDetectedCrossContaminationDiets = JSON.stringify(
        allData[rowIdx].aiDetectedCrossContaminationDiets,
      );

      // Also update the DOM row's dataset so it persists across re-renders
      row.dataset.aiDetectedAllergens = JSON.stringify(
        allData[rowIdx].aiDetectedAllergens,
      );
      row.dataset.aiDetectedDiets = JSON.stringify(
        allData[rowIdx].aiDetectedDiets,
      );
    }

    // Re-render the table with updated data
    // This will automatically update the confirm button state based on scan requirements
    renderAiTable(allData);

    // Close the inline brand results
    const rowBrandResults = aiAssistTableBody?.querySelector(
      `tr[data-index="${rowIdx}"] .aiRowBrandResults`,
    );
    if (rowBrandResults) {
      rowBrandResults.classList.remove("show");
      rowBrandResults.innerHTML = "";
    }

    // Also close the old global results if present
    if (aiAssistBrandResults) {
      aiAssistBrandResults.classList.remove("show");
      aiAssistBrandResults.innerHTML = "";
    }

    aiAssistSetStatus(
      "Brand applied. Please review allergens carefully.",
      "warn",
    );
  }

  async function handleAiProcess() {
    ensureAiAssistElements();
    if (!aiAssistInput) return;
    const text = aiAssistInput.value.trim();
    const hasPhotos = window.aiAssistPhotos && window.aiAssistPhotos.length > 0;
    if (!text && !hasPhotos) {
      aiAssistSetStatus(
        "Describe the dish or add recipe photos before processing.",
        "warn",
      );
      return;
    }

    // Clear existing ingredient data before processing new input
    renderAiTable([]);
    debugLog("Cleared existing ingredient data for fresh processing");

    // If we have photos, process them
    if (hasPhotos) {
      aiAssistSetStatus(
        "Processing " +
          window.aiAssistPhotos.length +
          " recipe photo(s) using AI...",
      );

      // Show progress bar
      const progressBar = document.getElementById("aiProgressBar");
      const progressBarFill = document.getElementById("aiProgressBarFill");
      if (progressBar && progressBarFill) {
        progressBar.classList.add("show");
        progressBarFill.style.width = "20%";
      }

      // Get dish name from input field if available
      const nameInput = document.getElementById("aiAssistNameInput");
      const dishNameForAi =
        nameInput?.value?.trim() ||
        (aiAssistState.context?.getCurrentName
          ? aiAssistState.context.getCurrentName()
          : "");

      for (let i = 0; i < window.aiAssistPhotos.length; i++) {
        const photoData = window.aiAssistPhotos[i];
        const payload = {
          imageData: photoData,
          imageFileName: `recipe_${i + 1}.jpg`,
          text: text || "Please extract all ingredients from this recipe image.",
          dishName: dishNameForAi,
        };

        // Update progress for current photo
        if (progressBarFill) {
          const progress = 20 + (i / window.aiAssistPhotos.length) * 70;
          progressBarFill.style.width = progress + "%";
        }

        try {
          const result = await requestAiExtractionWithConfig(payload);

          // Get dietary options from AI
          const dishDietaryOptions =
            result?.dietaryOptions && Array.isArray(result.dietaryOptions)
              ? result.dietaryOptions
              : [];

          // Add dietary options to each ingredient and preserve needsScan
          const rows = Array.isArray(result?.ingredients)
            ? result.ingredients.map((ing) => {
                const entry = {
                  ...ing,
                  diets: dishDietaryOptions,
                };
                if (ing.needsScan !== undefined && ing.needsScan !== null) {
                  entry.needsScan = ing.needsScan === true || ing.needsScan === "true";
                }
                return entry;
              })
            : [];

          if (rows.length > 0) {
            // Render new data directly (existing data was cleared at start)
            const existingData = collectAiTableData();
            const allRows = [...existingData, ...rows];
            renderAiTable(allRows);
            autoAnalyzeIngredientRows();

            let statusMsg = `Photo ${i + 1}/${window.aiAssistPhotos.length} processed.`;
            if (dishDietaryOptions.length > 0) {
              statusMsg += ` Detected: ${dishDietaryOptions.join(", ")}.`;
            }
            statusMsg += " Review ingredients before applying.";
            aiAssistSetStatus(statusMsg, "info");
          }
        } catch (err) {
          console.error("Recipe photo extraction failed", err);
          aiAssistSetStatus(
            `Failed to read recipe photo ${i + 1}: ` + (err.message || err),
            "error",
          );
        }
      }

      // Complete progress bar
      if (progressBarFill) progressBarFill.style.width = "100%";
      setTimeout(() => {
        if (progressBar) progressBar.classList.remove("show");
        if (progressBarFill) progressBarFill.style.width = "0%";
      }, 300);

      return;
    }

    // Otherwise process text
    aiAssistSetStatus("Preparing to analyze description…");
    // Get dish name from input field if available, otherwise use getCurrentName
    const nameInput = document.getElementById("aiAssistNameInput");
    const dishNameForAi =
      nameInput?.value?.trim() ||
      (aiAssistState.context?.getCurrentName
        ? aiAssistState.context.getCurrentName()
        : "");
    const payload = {
      text,
      dishName: dishNameForAi,
    };
    if (window !== window.parent) {
      const requestId = `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      aiAssistState.pendingRequestId = requestId;
      parent.postMessage(
        {
          type: "aiAssistExtract",
          requestId,
          ...payload,
        },
        "*",
      );
    } else {
      // Show progress bar
      const progressBar = document.getElementById("aiProgressBar");
      const progressBarFill = document.getElementById("aiProgressBarFill");
      if (progressBar && progressBarFill) {
        progressBar.classList.add("show");
        progressBarFill.style.width = "10%";
      }

      (async () => {
        // Continuous progress animation
        let progressInterval = null;
        let currentProgress = 10;

        const startProgressAnimation = () => {
          if (progressInterval) clearInterval(progressInterval);

          // Animate progress continuously from 10% to 90%
          progressInterval = setInterval(() => {
            if (currentProgress < 90) {
              currentProgress += Math.random() * 1 + 0.3; // Increment by 0.3-1.3% each step (slower)
              if (currentProgress > 90) currentProgress = 90;
              if (progressBarFill) {
                progressBarFill.style.width = `${currentProgress}%`;
              }
            }
          }, 200); // Update every 200ms for slower animation
        };

        const stopProgressAnimation = () => {
          if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
          }
        };

        try {
          // Start continuous progress animation
          aiAssistSetStatus("Analyzing input");
          startProgressAnimation();

          const result = await requestAiExtractionWithConfig(payload);

          // Stop animation and jump to completion
          stopProgressAnimation();
          currentProgress = 95;
          if (progressBarFill) progressBarFill.style.width = "95%";

          const rows = Array.isArray(result?.ingredients)
            ? result.ingredients
            : [];

          // Clean up ingredient names and ensure needsScan is set
          rows.forEach((row) => {
            if (row.name) {
              // Remove text in parentheses and trim
              row.name = row.name.replace(/\s*\([^)]*\)\s*/g, "").trim();
              // Remove common prefixes/suffixes
              row.name = row.name
                .replace(
                  /\s*(optional|garnish|topping|for serving|for garnish)\s*$/gi,
                  "",
                )
                .trim();
            }
            if (row.needsScan !== undefined && row.needsScan !== null) {
              row.needsScan = row.needsScan === true || row.needsScan === "true";
            }
          });

          // NOTE: Brands from memory are now shown as thumbnails with + buttons
          // in the renderAiTable function, rather than auto-populating.
          // This gives users control over whether to use remembered brands.

          // Render new data directly (existing data was cleared at start)
          renderAiTable(rows);
          autoAnalyzeIngredientRows();

          let statusMsg = rows.length
            ? "Dish ingredient suggestions ready. Please review and confirm each ingredient before saving."
            : "AI could not extract ingredients from the description.";
          aiAssistSetStatus(statusMsg, "info");

          // Complete progress bar
          stopProgressAnimation();
          if (progressBarFill) progressBarFill.style.width = "100%";
          setTimeout(() => {
            if (progressBar) progressBar.classList.remove("show");
            if (progressBarFill) progressBarFill.style.width = "0%";
          }, 300);
        } catch (err) {
          console.error("AI extraction failed", err);

          // Stop animation and hide progress bar on error
          stopProgressAnimation();
          if (progressBar) progressBar.classList.remove("show");
          if (progressBarFill) progressBarFill.style.width = "0%";

          // Check for specific error types
          const errorMsg = err.message || String(err);
          let statusMsg = "";

          if (
            errorMsg.includes("Anthropic API key") ||
            errorMsg.includes("API key not configured")
          ) {
            statusMsg =
              "AI service error: Anthropic API key not configured. Please check Supabase Edge Function settings.";
          } else if (
            errorMsg.includes("Failed to proxy") ||
            errorMsg.includes("proxy")
          ) {
            statusMsg =
              "AI service error: Proxy endpoint unavailable. Check if /api/ai-proxy is deployed.";
          } else if (errorMsg.includes("network") || errorMsg.includes("fetch")) {
            statusMsg =
              "AI service error: Network connection failed. Please check your internet connection.";
          } else {
            statusMsg =
              "AI service error: " +
              (errorMsg.substring(0, 100) || "Unknown error");
          }

          if (text) {
            const ingredients = toArray(
              heuristicallyExtractIngredients(text),
            );
            // Render new data directly (existing data was cleared at start)
            renderAiTable(ingredients);
            autoAnalyzeIngredientRows();

            statusMsg +=
              " Fallback: Generated a draft using local parsing. Review before applying.";
            aiAssistSetStatus(statusMsg, "warn");
          } else {
            aiAssistSetStatus(
              statusMsg || "AI assistant request failed: " + errorMsg,
              "warn",
            );
          }
        }
      })();
    }
  }

  function handleDishEditorResult(payload) {
    ensureAiAssistElements();
    if (!payload || payload.requestId !== aiAssistState.pendingRequestId) return;
    aiAssistState.pendingRequestId = null;
    const rows = Array.isArray(payload.ingredients) ? payload.ingredients : [];

    // Clean up ingredient names and ensure needsScan is set
    rows.forEach((row) => {
      if (row.name) {
        // Remove text in parentheses and trim
        row.name = row.name.replace(/\s*\([^)]*\)\s*/g, "").trim();
        // Remove common prefixes/suffixes
        row.name = row.name
          .replace(
            /\s*(optional|garnish|topping|for serving|for garnish)\s*$/gi,
            "",
          )
          .trim();
      }
      if (row.needsScan !== undefined && row.needsScan !== null) {
        row.needsScan = row.needsScan === true || row.needsScan === "true";
      }
    });
    const sanitizedRows = toArray(rows);

    // NOTE: Brands from memory are now shown as thumbnails with + buttons
    // in the renderAiTable function, rather than auto-populating.
    // This gives users control over whether to use remembered brands.

    // NOTE: Do NOT call rememberBrand here - brands should only be saved when dish is saved to server
    renderAiTable(sanitizedRows);
    autoAnalyzeIngredientRows();
    aiAssistSetStatus(
      sanitizedRows.length
        ? "Dish ingredient suggestions ready. Please review and confirm each ingredient before saving."
        : "AI could not extract ingredients from the description.",
      "info",
    );
  }

  function handleDishEditorError(payload) {
    ensureAiAssistElements();
    if (!payload || payload.requestId !== aiAssistState.pendingRequestId) return;
    aiAssistState.pendingRequestId = null;
    aiAssistSetStatus(payload.error || "AI assistant request failed.", "warn");
  }

  function applyAiIngredientsToOverlay() {
    debugLog("applyAiIngredientsToOverlay called");
    ensureAiAssistElements();
    const rows = toArray(collectAiTableData());

    // Hide any previous save error
    const saveErrorEl = document.getElementById("aiAssistSaveError");
    const saveErrorDetailsEl = document.getElementById(
      "aiAssistSaveErrorDetails",
    );
    if (saveErrorEl) saveErrorEl.style.display = "none";

    // Validate dish name is not empty
    const nameInput = document.getElementById("aiAssistNameInput");
    if (nameInput && !nameInput.value.trim()) {
      debugLog("Dish name is empty");
      if (saveErrorEl && saveErrorDetailsEl) {
        saveErrorDetailsEl.textContent = "Please enter a dish name before saving";
        saveErrorEl.style.display = "block";
        saveErrorEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      // Focus the name input field
      nameInput.focus();
      nameInput.style.border = "2px solid #dc2626";
      setTimeout(() => {
        nameInput.style.border = "1px solid rgba(76,90,212,0.35)";
      }, 2000);
      return;
    }

    if (!rows.length) {
      debugLog("No rows to apply");
      aiAssistSetStatus("Add at least one ingredient before applying.", "warn");
      return;
    }

    // Check if all ingredients are confirmed
    const unconfirmed = rows.filter(
      (item) => item.name.trim() && !item.confirmed,
    );
    if (unconfirmed.length > 0) {
      const ingredientNames = unconfirmed.map((item) => item.name).join(", ");
      debugLog("Unconfirmed ingredients:", ingredientNames);

      // Show error at bottom near Save to Dish button
      if (saveErrorEl && saveErrorDetailsEl) {
        saveErrorDetailsEl.textContent = `Please click "Confirm" for: ${ingredientNames}`;
        saveErrorEl.style.display = "block";
        saveErrorEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }

      return;
    }

    // Collect cross-contamination allergens from ingredient rows
    const crossContaminationFromRows = new Set();
    rows.forEach((row) => {
      if (Array.isArray(row.crossContamination)) {
        row.crossContamination.forEach((allergen) => {
          if (allergen) crossContaminationFromRows.add(allergen);
        });
      }
    });

    const crossContaminationData = {
      noCrossContamination: crossContaminationFromRows.size === 0,
      allergens: Array.from(crossContaminationFromRows),
    };

    debugLog("Cross-contamination data from rows:", crossContaminationData);

    // Mark as saved
    aiAssistState.savedToDish = true;
    // Clear dish name modification flag since dish is now saved
    aiAssistState.dishNameModified = false;

    debugLog(
      "aiAssistState.context?.onApply exists?",
      !!aiAssistState.context?.onApply,
    );
    debugLog(
      "SAVE TO DISH: About to save rows - checking for userOverriddenScan:",
      rows.map((r) => ({
        name: r.name,
        userOverriddenScan: r.userOverriddenScan,
      })),
    );

    if (aiAssistState.context?.onApply) {
      // Pass ingredients, dietary options, and cross-contamination data to the overlay
      const dataToApply = {
        ingredients: rows,
        dietaryOptions: aiAssistState.detectedDietaryOptions || [],
        crossContamination: crossContaminationData,
      };
      debugLog("Calling onApply with:", {
        rowCount: rows.length,
        dataToApply,
      });
      aiAssistState.context.onApply(rows, dataToApply);
    } else {
      console.error("No onApply callback found!");
    }
    closeDishEditor();
    aiAssistSetStatus("");
  }


  return {
    aiAssistState,
    aiAssistSetStatus,
    ensureAiAssistElements,
    collectAiTableData,
    renderAiTable,
    openDishEditor,
    handleDishEditorResult,
    handleDishEditorError,
    getAiAssistBackdrop: () => aiAssistBackdrop,
    getAiAssistTableBody: () => aiAssistTableBody,
    rebuildBrandMemoryFromRestaurant,
    openBrandIdentificationChoice,
    showIngredientPhotoUploadModal,
    showPhotoAnalysisLoadingInRow,
    hidePhotoAnalysisLoadingInRow,
    updatePhotoAnalysisLoadingStatus,
    showPhotoAnalysisResultButton,
  };
}
