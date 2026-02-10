import { resolveAccountName } from "../userIdentity.js";

export function initEditorSaveFlow(deps = {}) {
  const state = deps.state || {};
  const rs = deps.rs || {};
  const overlays = Array.isArray(deps.overlays) ? deps.overlays : [];
  const menuImages = Array.isArray(deps.menuImages) ? deps.menuImages : [];
  const originalMenuImages = Array.isArray(deps.originalMenuImages)
    ? deps.originalMenuImages
    : [];
  const saveBtn = deps.saveBtn || null;
  const esc =
    typeof deps.esc === "function"
      ? deps.esc
      : (value) => String(value ?? "");
  const formatAllergenLabel =
    typeof deps.formatAllergenLabel === "function"
      ? deps.formatAllergenLabel
      : (value) => {
          const raw = String(value || "");
          return raw
            .split(" ")
            .map((part) =>
              part
                ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
                : "",
            )
            .join(" ");
        };
  const send = typeof deps.send === "function" ? deps.send : () => {};
  const setDirty = typeof deps.setDirty === "function" ? deps.setDirty : () => {};
  const pushHistory =
    typeof deps.pushHistory === "function" ? deps.pushHistory : () => {};
  const renderEditor =
    typeof deps.renderEditor === "function" ? deps.renderEditor : () => {};
  const getDrawAll =
    typeof deps.getDrawAll === "function" ? deps.getDrawAll : () => deps.drawAll;

  const getPendingChanges =
    typeof deps.getPendingChanges === "function" ? deps.getPendingChanges : () => [];
  const setPendingChanges =
    typeof deps.setPendingChanges === "function" ? deps.setPendingChanges : () => {};
  const getOriginalOverlaysRef =
    typeof deps.getOriginalOverlaysRef === "function"
      ? deps.getOriginalOverlaysRef
      : () => "[]";
  const setOriginalOverlaysRef =
    typeof deps.setOriginalOverlaysRef === "function"
      ? deps.setOriginalOverlaysRef
      : () => {};
  const getOriginalRestaurantSettings =
    typeof deps.getOriginalRestaurantSettings === "function"
      ? deps.getOriginalRestaurantSettings
      : () => ({
          website: null,
          phone: null,
          delivery_url: null,
        });

  let saveReviewBackdrop = null;
  let saveReviewIsSaving = false;
  let saveReviewHasError = false;
  let lastSavePayload = null;

  function setSaveState(s) {
    if (!saveBtn) return;
    if (s === "saving") {
      saveReviewHasError = false;
      saveBtn.classList.remove("savePulse");
      if (saveBtn.dataset.retry) {
        delete saveBtn.dataset.retry;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      saveBtn.classList.remove("btnSuccess", "btnDanger", "btnPrimary");
      saveBtn.classList.add("btn");
    } else if (s === "saved") {
      saveReviewHasError = false;
      saveBtn.classList.remove("savePulse");
      if (saveBtn.dataset.retry) {
        delete saveBtn.dataset.retry;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Saved";
      saveBtn.classList.remove("btn", "btnDanger", "btnPrimary");
      saveBtn.classList.add("btnSuccess");
      // Update originalOverlaysRef after successful save
      setOriginalOverlaysRef(JSON.stringify(overlays));
      setTimeout(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save to site";
        saveBtn.classList.remove("btnSuccess", "btnDanger");
        saveBtn.classList.add("btnPrimary");
        setPendingChanges([]);
        setDirty(false);
      }, 900);
    } else if (s === "error") {
      saveReviewHasError = true;
      saveBtn.classList.remove("savePulse");
      saveBtn.dataset.retry = "1";
      saveBtn.disabled = false;
      saveBtn.textContent = "Retry save";
      saveBtn.classList.remove("btnSuccess", "btnPrimary");
      saveBtn.classList.add("btnDanger");
      // Make error state more visible
      saveBtn.title =
        "Save failed. Click to retry. Check console (F12) for error details.";
    }
  }

  function setSaveReviewSavingState(isSaving, message = "") {
    saveReviewIsSaving = isSaving;
    if (!saveReviewBackdrop) return;
    const confirmBtn = saveReviewBackdrop.querySelector(
      "#saveReviewConfirmBtn",
    );
    const cancelBtn = saveReviewBackdrop.querySelector("#saveReviewCancelBtn");
    const statusEl = saveReviewBackdrop.querySelector("#saveReviewStatus");
    const undoButtons = saveReviewBackdrop.querySelectorAll(
      'button[data-action="undo"]',
    );
    if (confirmBtn) {
      confirmBtn.disabled = isSaving;
      if (isSaving) {
        confirmBtn.textContent = "Saving...";
      } else {
        confirmBtn.textContent = saveReviewHasError
          ? "Retry Save"
          : "Confirm & Save";
      }
    }
    if (cancelBtn) {
      cancelBtn.disabled = isSaving;
      cancelBtn.textContent = isSaving ? "Saving..." : "Cancel save";
    }
    undoButtons.forEach((btn) => {
      btn.disabled = isSaving;
      btn.style.opacity = isSaving ? "0.6" : "";
    });
    if (statusEl) {
      if (isSaving || message) {
        statusEl.textContent = message || "Saving changes...";
        statusEl.style.display = "block";
        statusEl.style.color = "#a8b2d6";
      } else {
        statusEl.textContent = "";
        statusEl.style.display = "none";
      }
    }
  }

  function setSaveReviewErrorState(message) {
    if (!saveReviewBackdrop) return;
    saveReviewHasError = true;
    setSaveReviewSavingState(false, message);
    const statusEl = saveReviewBackdrop.querySelector("#saveReviewStatus");
    if (statusEl) {
      statusEl.style.color = "#f87171";
    }
  }

  function formatChangesForLog(changesList) {
    const fullName =
      resolveAccountName(state.user, state.user?.email || "User") || "User";

    console.log("formatChangesForLog: user data =", {
      user_metadata: state.user?.user_metadata,
      raw_user_meta_data: state.user?.raw_user_meta_data,
      name: state.user?.name,
      resolvedFullName: fullName,
    });

    const grouped = {};
    const generalChanges = [];

    (changesList || []).forEach((change) => {
      // Handle both string entries and object entries { text, details }
      let changeText,
        changeDetails = null;
      if (typeof change === "string") {
        changeText = change;
      } else if (typeof change === "object" && change.text) {
        changeText = change.text;
        changeDetails = change.details || null;
      } else {
        return; // Skip invalid entries
      }

      const colonIndex = changeText.indexOf(":");
      if (colonIndex > 0) {
        const itemName = changeText.substring(0, colonIndex).trim();
        const itemChange = changeText.substring(colonIndex + 1).trim();
        if (!grouped[itemName]) grouped[itemName] = [];
        if (itemChange) {
          // Store as object with details if available, otherwise just the string
          if (changeDetails) {
            grouped[itemName].push({
              text: itemChange,
              details: changeDetails,
            });
          } else {
            grouped[itemName].push(itemChange);
          }
        }
      } else if (changeText.trim()) {
        // General changes - store as object with details if available
        if (changeDetails) {
          generalChanges.push({
            text: changeText.trim(),
            details: changeDetails,
          });
        } else {
          generalChanges.push(changeText.trim());
        }
      }
    });

    return {
      author: fullName,
      general: generalChanges,
      items: grouped,
    };
  }

  function normalizeChangeText(change) {
    if (!change) return "";
    if (typeof change === "string") return change;
    if (typeof change === "object" && change.text) return String(change.text);
    return "";
  }

  function removePendingChangeText(changeText) {
    if (!changeText) return;
    const current = getPendingChanges();
    const filtered = current.filter((entry) => {
      const entryText = normalizeChangeText(entry);
      return entryText !== changeText;
    });
    setPendingChanges(filtered);
  }

  function collectSaveChanges() {
    const pending = getPendingChanges();
    // Combine pendingChanges (UI-tracked) with describeOverlayChanges (comparison-based)
    const uiChanges = [...pending];
    const comparisonChanges = describeOverlayChanges(
      JSON.parse(getOriginalOverlaysRef() || "[]"),
      overlays,
    );

    // Extract renamed dishes to filter out redundant add/remove changes
    const renamedDishes = new Map(); // oldName -> newName
    uiChanges.forEach((change) => {
      const renameMatch = normalizeChangeText(change).match(
        /^Renamed "(.+)" to "(.+)"$/,
      );
      if (renameMatch) {
        renamedDishes.set(renameMatch[1], renameMatch[2]);
      }
    });

    // Merge and deduplicate changes, filtering out redundant add/remove for renames
    const allChanges = [...uiChanges];
    comparisonChanges.forEach((change) => {
      const changeText = normalizeChangeText(change);
      if (!changeText) return;

      // Only add if not already in uiChanges (avoid duplicates)
      if (uiChanges.includes(changeText)) return;

      // Skip "Added overlay" for new name if it was renamed
      const addedMatch = changeText.match(/^(.+): Added overlay$/);
      if (addedMatch) {
        const dishName = addedMatch[1];
        for (const [oldName, newName] of renamedDishes) {
          if (newName === dishName) return;
        }
      }

      // Skip "Removed overlay" for old name if it was renamed
      const removedMatch = changeText.match(/^(.+): Removed overlay$/);
      if (removedMatch) {
        const dishName = removedMatch[1];
        if (renamedDishes.has(dishName)) return;
      }

      allChanges.push(change);
    });

    let changesList = allChanges;
    // Check if restaurant settings changed
    const currentRestaurantSettings = {
      website: state.restaurant?.website || null,
      phone: state.restaurant?.phone || null,
      delivery_url: state.restaurant?.delivery_url || null,
    };
    const originalRestaurantSettings = getOriginalRestaurantSettings() || {};
    const restaurantSettingsChanged =
      originalRestaurantSettings.website !==
        currentRestaurantSettings.website ||
      originalRestaurantSettings.phone !== currentRestaurantSettings.phone ||
      originalRestaurantSettings.delivery_url !==
        currentRestaurantSettings.delivery_url;

    if (restaurantSettingsChanged) {
      changesList.push(
        "Updated restaurant settings (website, phone, delivery URL)",
      );
    }

    if (!changesList.length) {
      // Check if aiIngredients changed even if describeOverlayChanges didn't catch it
      try {
        const originalOverlays = JSON.parse(getOriginalOverlaysRef() || "[]");
        const originalById = new Map(
          originalOverlays.filter((o) => o && o.id).map((o) => [o.id, o]),
        );
        const aiIngredientChanges = [];

        overlays.forEach((overlay) => {
          if (!overlay || !overlay.id) return;
          const original = originalById.get(overlay.id);
          if (!original) return;

          const currentAiIngredients = overlay.aiIngredients;
          const originalAiIngredients = original.aiIngredients;
          const changed =
            JSON.stringify(currentAiIngredients) !==
            JSON.stringify(originalAiIngredients);

          if (changed) {
            const dishName = overlay.id || "Unknown dish";
            if (!originalAiIngredients && currentAiIngredients) {
              aiIngredientChanges.push(`${dishName}: Added ingredient data`);
            } else if (originalAiIngredients && !currentAiIngredients) {
              aiIngredientChanges.push(`${dishName}: Removed ingredient data`);
            } else {
              aiIngredientChanges.push(`${dishName}: Updated ingredient data`);
            }
          }
        });

        if (aiIngredientChanges.length) {
          changesList = aiIngredientChanges;
        }
      } catch (e) {
        console.error("SAVE REVIEW: Error checking aiIngredients changes:", e);
      }
    }

    const restaurantSettingsToSave = restaurantSettingsChanged
      ? {
          website: currentRestaurantSettings.website,
          phone: currentRestaurantSettings.phone,
          delivery_url: currentRestaurantSettings.delivery_url,
        }
      : null;

    return { changesList, restaurantSettingsToSave };
  }

  function closeSaveReviewModal() {
    if (saveReviewBackdrop && saveReviewBackdrop.parentNode) {
      saveReviewBackdrop.parentNode.removeChild(saveReviewBackdrop);
    }
    saveReviewBackdrop = null;
    saveReviewIsSaving = false;
    if (window.__saveReviewControl) {
      window.__saveReviewControl = null;
    }
  }

  function renderSaveReviewModal(reviewItems, onConfirm, onCancel) {
    if (!saveReviewBackdrop) {
      saveReviewBackdrop = document.createElement("div");
      saveReviewBackdrop.className = "saveReviewBackdrop";
      saveReviewBackdrop.addEventListener("click", (e) => {
        if (saveReviewIsSaving) return;
        if (e.target === saveReviewBackdrop && typeof onCancel === "function")
          onCancel();
      });
      document.body.appendChild(saveReviewBackdrop);
    } else {
      saveReviewBackdrop.innerHTML = "";
    }

    const modal = document.createElement("div");
    modal.className = "saveReviewModal";
    modal.innerHTML = `
      <div class="saveReviewHeader">
        <div>
          <div style="font-size:1.25rem;font-weight:700">Review your changes</div>
          <div style="color:var(--muted);font-size:0.9rem;margin-top:4px">Confirm everything looks right before saving to the website.</div>
        </div>
      </div>
      <div id="saveReviewStatus" style="display:none;margin:8px 0 12px;color:#a8b2d6;font-size:0.9rem"></div>
      <div class="saveReviewList" id="saveReviewList"></div>
      <div class="saveReviewActions">
        <button class="btn" type="button" id="saveReviewCancelBtn">Cancel save</button>
        <button class="btn btnPrimary" type="button" id="saveReviewConfirmBtn">Confirm & Save</button>
      </div>
    `;
    saveReviewBackdrop.appendChild(modal);

    const list = modal.querySelector("#saveReviewList");
    list.innerHTML = reviewItems
      .map(
        (item, index) => `
      <div class="saveReviewItem" data-review-index="${index}">
        <div class="saveReviewItemText">${esc(item.text)}</div>
        <button class="btn" type="button" data-action="undo" data-review-index="${index}">Undo</button>
      </div>
    `,
      )
      .join("");

    modal.querySelector("#saveReviewCancelBtn").onclick = onCancel;
    modal.querySelector("#saveReviewConfirmBtn").onclick = onConfirm;
    list.querySelectorAll('button[data-action="undo"]').forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.reviewIndex);
        const item = reviewItems[idx];
        if (item && typeof item.undo === "function") {
          item.undo();
        }
      };
    });

    window.__saveReviewControl = {
      close: closeSaveReviewModal,
      setSaving: setSaveReviewSavingState,
      setError: setSaveReviewErrorState,
      isOpen: () => !!saveReviewBackdrop,
    };
    setSaveReviewSavingState(false);
  }

  function sendSavePayload(payload) {
    if (!payload) return;
    saveReviewHasError = false;
    lastSavePayload = payload;
    setSaveReviewSavingState(true, "Saving changes to the website...");
    setSaveState("saving");
    send(payload);
  }

  function openSaveReviewModal() {
    const { changesList } = collectSaveChanges();
    if (!changesList.length) {
      closeSaveReviewModal();
      setSaveState("saved");
      return;
    }

    const originalOverlays = JSON.parse(getOriginalOverlaysRef() || "[]");
    const reviewItems = changesList.map((change, index) => {
      const changeText = normalizeChangeText(change);
      const item = { id: `${index}-${changeText}`, text: changeText };

      const renameMatch = changeText.match(/^Renamed "(.+)" to "(.+)"$/);
      const addedMatch = changeText.match(/^(.+): Added overlay$/);
      const removedMatch = changeText.match(/^(.+): Removed overlay$/);
      const dishMatch = changeText.includes(":")
        ? changeText.split(":")[0].trim()
        : "";
      const isSettings = changeText.startsWith("Updated restaurant settings");
      const isMenuChange = /menu page|menu image|menu images/i.test(changeText);

      item.undo = () => {
        const replaceOverlay = (name) => {
          if (!name) return;
          const original = originalOverlays.find(
            (o) => o && (o.id === name || o.name === name),
          );
          const currentIdx = overlays.findIndex(
            (o) => o && (o.id === name || o.name === name),
          );
          if (original) {
            const restored = JSON.parse(JSON.stringify(original));
            if (currentIdx >= 0) {
              overlays[currentIdx] = restored;
            } else {
              overlays.push(restored);
            }
          } else if (currentIdx >= 0) {
            overlays.splice(currentIdx, 1);
          }
          const drawAll = getDrawAll();
          if (typeof drawAll === "function") {
            drawAll();
          }
          setDirty(true);
          pushHistory();
        };

        if (isSettings) {
          const originalRestaurantSettings = getOriginalRestaurantSettings() || {};
          if (state.restaurant) {
            state.restaurant.website = originalRestaurantSettings.website;
            state.restaurant.phone = originalRestaurantSettings.phone;
            state.restaurant.delivery_url =
              originalRestaurantSettings.delivery_url;
          }
          removePendingChangeText(changeText);
          setDirty(true);
          openSaveReviewModal();
          return;
        }

        if (isMenuChange) {
          window.__editorOverrideOverlays = JSON.parse(
            JSON.stringify(overlays),
          );
          window.__editorOverrideMenuImages = JSON.parse(
            JSON.stringify(originalMenuImages),
          );
          window.__editorForceDirty = true;
          closeSaveReviewModal();
          renderEditor();
          return;
        }

        if (renameMatch) {
          const oldName = renameMatch[1];
          const newName = renameMatch[2];
          const newIdx = overlays.findIndex(
            (o) => o && (o.id === newName || o.name === newName),
          );
          if (newIdx >= 0) {
            overlays.splice(newIdx, 1);
          }
          replaceOverlay(oldName);
          removePendingChangeText(changeText);
          openSaveReviewModal();
          return;
        }

        if (addedMatch) {
          const dishName = addedMatch[1].trim();
          const idx = overlays.findIndex(
            (o) => o && (o.id === dishName || o.name === dishName),
          );
          if (idx >= 0) {
            overlays.splice(idx, 1);
            const drawAll = getDrawAll();
            if (typeof drawAll === "function") {
              drawAll();
            }
            setDirty(true);
            pushHistory();
          }
          removePendingChangeText(changeText);
          openSaveReviewModal();
          return;
        }

        if (removedMatch) {
          const dishName = removedMatch[1].trim();
          replaceOverlay(dishName);
          removePendingChangeText(changeText);
          openSaveReviewModal();
          return;
        }

        if (dishMatch) {
          replaceOverlay(dishMatch);
          removePendingChangeText(changeText);
          openSaveReviewModal();
          return;
        }

        removePendingChangeText(changeText);
        openSaveReviewModal();
      };

      return item;
    });

    renderSaveReviewModal(
      reviewItems,
      () => {
        const { changesList: confirmChanges, restaurantSettingsToSave } =
          collectSaveChanges();
        if (!confirmChanges.length) {
          closeSaveReviewModal();
          setSaveState("saved");
          return;
        }
        const formattedChanges = formatChangesForLog(confirmChanges);
        const payload = {
          type: "saveOverlays",
          overlays,
          menuImages: menuImages,
          menuImage: menuImages[0] || rs.menuImage || "",
          changes: formattedChanges,
          restaurantSettings: restaurantSettingsToSave,
        };
        sendSavePayload(payload);
      },
      () => {
        closeSaveReviewModal();
      },
    );
  }

  if (saveBtn) {
    saveBtn.onclick = () => {
      if (saveBtn.dataset.retry && lastSavePayload) {
        sendSavePayload(lastSavePayload);
        return;
      }
      openSaveReviewModal();
    };
  }

  function describeOverlayChanges(oldOverlays, newOverlays) {
    const changes = [];
    const oldList = Array.isArray(oldOverlays) ? oldOverlays : [];
    const newList = Array.isArray(newOverlays) ? newOverlays : [];
    const oldById = new Map(
      oldList.filter((o) => o && o.id).map((o) => [o.id, o]),
    );
    const newById = new Map(
      newList.filter((o) => o && o.id).map((o) => [o.id, o]),
    );

    // Compare each new item against its original version (by ID, not index)
    newList.forEach((item) => {
      if (!item || !item.id) return;
      const itemName = item.id || "Item";
      const old = oldById.get(item.id);

      if (old) {
        // Check if aiIngredients changed - if so, we'll use ingredient-level tracking instead of dish-level
        const oldAiIngredients = old.aiIngredients;
        const newAiIngredients = item.aiIngredients;
        const hasAiIngredientsChange =
          JSON.stringify(oldAiIngredients) !== JSON.stringify(newAiIngredients);

        // Note: Dish-level allergen/diet changes are not logged here.
        // All allergen/diet changes should come from ingredient-level tracking in aiIngredients.

        // Track position changes (with tolerance for floating-point comparison)
        const positionTolerance = 0.01;
        const posChanged = (a, b) =>
          Math.abs((a || 0) - (b || 0)) > positionTolerance;
        const moved =
          posChanged(old.x, item.x) ||
          posChanged(old.y, item.y) ||
          posChanged(old.w, item.w) ||
          posChanged(old.h, item.h);
        if (moved) {
          changes.push(`${itemName}: Adjusted overlay position`);
        }

        // Note: Cross-contamination changes are tracked in pendingChanges (doneBtn handler),
        // not here, to avoid duplicate logging.

        // Track aiIngredients changes with specific details
        // (oldAiIngredients, newAiIngredients, hasAiIngredientsChange already declared above)
        if (hasAiIngredientsChange) {
          if (!oldAiIngredients && newAiIngredients) {
            // First time adding ingredient data - show what was added
            try {
              const newIngList =
                typeof newAiIngredients === "string"
                  ? JSON.parse(newAiIngredients)
                  : newAiIngredients;
              if (Array.isArray(newIngList) && newIngList.length > 0) {
                newIngList.forEach((ing) => {
                  const ingName = ing.name || "Unknown";
                  const makeEntry = (text) => ({
                    text,
                    details: {
                      ingredient: ingName,
                      before: {
                        allergens: [],
                        crossContamination: [],
                        diets: [],
                        crossContaminationDiets: [],
                      },
                      after: {
                        allergens: ing.allergens || [],
                        crossContamination: ing.crossContamination || [],
                        diets: ing.diets || [],
                        crossContaminationDiets: ing.crossContaminationDiets || [],
                      },
                    },
                  });

                  // List allergens added
                  (ing.allergens || []).forEach((a) => {
                    const displayName = formatAllergenLabel(a);
                    changes.push(
                      makeEntry(
                        `${itemName}: ${ingName}: [Smart detection] added ${displayName} (contains)`,
                      ),
                    );
                  });
                  (ing.crossContamination || []).forEach((a) => {
                    const displayName = formatAllergenLabel(a);
                    changes.push(
                      makeEntry(
                        `${itemName}: ${ingName}: [Smart detection] added ${displayName} (cross-contamination risk)`,
                      ),
                    );
                  });

                  // List diets added
                  (ing.diets || []).forEach((d) => {
                    changes.push(
                      makeEntry(
                        `${itemName}: ${ingName}: [Smart detection] added ${d} (compliant)`,
                      ),
                    );
                  });
                  (ing.crossContaminationDiets || []).forEach((d) => {
                    changes.push(
                      makeEntry(
                        `${itemName}: ${ingName}: [Smart detection] added ${d} (cross-contamination risk)`,
                      ),
                    );
                  });

                  // List brands added
                  (ing.brands || []).forEach((b) => {
                    changes.push(
                      makeEntry(
                        `${itemName}: ${ingName}: ${b.name} added as brand item`,
                      ),
                    );
                  });

                  // If no allergens, diets, or brands, just note the ingredient was added
                  if (
                    !ing.allergens?.length &&
                    !ing.crossContamination?.length &&
                    !ing.diets?.length &&
                    !ing.crossContaminationDiets?.length &&
                    !ing.brands?.length
                  ) {
                    changes.push({
                      text: `${itemName}: ${ingName}: Added ingredient`,
                      details: null,
                    });
                  }
                });
              } else {
                changes.push(`${itemName}: Added ingredient data`);
              }
            } catch (e) {
              changes.push(`${itemName}: Added ingredient data`);
            }
          } else if (oldAiIngredients && !newAiIngredients) {
            changes.push(`${itemName}: Removed ingredient data`);
          } else {
            // Parse and compare to find specific changes
            try {
              const oldIngList =
                typeof oldAiIngredients === "string"
                  ? JSON.parse(oldAiIngredients)
                  : oldAiIngredients;
              const newIngList =
                typeof newAiIngredients === "string"
                  ? JSON.parse(newAiIngredients)
                  : newAiIngredients;

              if (Array.isArray(oldIngList) && Array.isArray(newIngList)) {
                const specificChanges = [];

                // Check each ingredient for changes
                newIngList.forEach((newIng) => {
                  const oldIng = oldIngList.find((o) => o.name === newIng.name);
                  if (oldIng) {
                    // Detect if smart detection ran by comparing old vs new AI detection arrays
                    const oldAiDetectedAllergens = new Set(
                      (oldIng.aiDetectedAllergens || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                    );
                    const oldAiDetectedCrossContamination = new Set(
                      (oldIng.aiDetectedCrossContamination || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                    );
                    const oldAiDetectedDiets = new Set(
                      (oldIng.aiDetectedDiets || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                    );
                    const oldAiDetectedCrossContaminationDiets = new Set(
                      (oldIng.aiDetectedCrossContaminationDiets || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                    );

                    const newAiDetectedAllergens = new Set(
                      (newIng.aiDetectedAllergens || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                    );
                    const newAiDetectedCrossContamination = new Set(
                      (newIng.aiDetectedCrossContamination || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                    );
                    const newAiDetectedDiets = new Set(
                      (newIng.aiDetectedDiets || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                    );
                    const newAiDetectedCrossContaminationDiets = new Set(
                      (newIng.aiDetectedCrossContaminationDiets || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                    );

                    // Smart detection ran if any AI detection arrays changed
                    const aiDetectionChanged =
                      JSON.stringify([...oldAiDetectedAllergens].sort()) !==
                        JSON.stringify([...newAiDetectedAllergens].sort()) ||
                      JSON.stringify(
                        [...oldAiDetectedCrossContamination].sort(),
                      ) !==
                        JSON.stringify(
                          [...newAiDetectedCrossContamination].sort(),
                        ) ||
                      JSON.stringify([...oldAiDetectedDiets].sort()) !==
                        JSON.stringify([...newAiDetectedDiets].sort()) ||
                      JSON.stringify(
                        [...oldAiDetectedCrossContaminationDiets].sort(),
                      ) !==
                        JSON.stringify(
                          [...newAiDetectedCrossContaminationDiets].sort(),
                        );

                    const smartPrefix = aiDetectionChanged
                      ? "[Smart detection] "
                      : "";

                    // Helper to create change entry with before/after details
                    const makeChangeEntry = (text, ingredientName) => ({
                      text,
                      details: {
                        ingredient: ingredientName,
                        before: {
                          allergens: oldIng.allergens || [],
                          crossContamination: oldIng.crossContamination || [],
                          diets: oldIng.diets || [],
                          crossContaminationDiets: oldIng.crossContaminationDiets || [],
                        },
                        after: {
                          allergens: newIng.allergens || [],
                          crossContamination: newIng.crossContamination || [],
                          diets: newIng.diets || [],
                          crossContaminationDiets: newIng.crossContaminationDiets || [],
                        },
                      },
                    });

                    // Build complete state maps for old and new to detect transitions
                    const getItemState = (item, itemType, ing) => {
                      const key = String(item ?? "").trim();
                      if (!key) return "none";
                      if (itemType === "allergen") {
                        if (
                          (ing.allergens || [])
                            .map((a) => String(a ?? "").trim())
                            .includes(key)
                        )
                          return "contains";
                        if (
                          (ing.crossContamination || [])
                            .map((a) => String(a ?? "").trim())
                            .includes(key)
                        )
                          return "cross-contam";
                      } else {
                        if (
                          (ing.diets || [])
                            .map((a) => String(a ?? "").trim())
                            .includes(key)
                        )
                          return "compliant";
                        if (
                          (ing.crossContaminationDiets || [])
                            .map((a) => String(a ?? "").trim())
                            .includes(key)
                        )
                          return "cross-contam";
                      }
                      return "none";
                    };

                    // Get all unique allergens from both old and new
                    const allAllergens = new Set([
                      ...(oldIng.allergens || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                      ...(oldIng.crossContamination || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                      ...(newIng.allergens || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                      ...(newIng.crossContamination || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                    ]);

                    // Get all unique diets from both old and new
                    const allDiets = new Set([
                      ...(oldIng.diets || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                      ...(oldIng.crossContaminationDiets || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                      ...(newIng.diets || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                      ...(newIng.crossContaminationDiets || [])
                        .map((a) => String(a ?? "").trim())
                        .filter(Boolean),
                    ]);

                    // Track allergen state changes
                    allAllergens.forEach((allergen) => {
                      const oldState = getItemState(
                        allergen,
                        "allergen",
                        oldIng,
                      );
                      const newState = getItemState(
                        allergen,
                        "allergen",
                        newIng,
                      );
                      const displayName = formatAllergenLabel(allergen);

                      if (oldState !== newState) {
                        if (oldState === "none" && newState === "contains") {
                          specificChanges.push(
                            makeChangeEntry(
                              `${newIng.name}: ${smartPrefix}added ${displayName} (contains)`,
                              newIng.name,
                            ),
                          );
                        } else if (
                          oldState === "none" &&
                          newState === "cross-contam"
                        ) {
                          specificChanges.push(
                            makeChangeEntry(
                              `${newIng.name}: ${smartPrefix}added ${displayName} (cross-contamination risk)`,
                              newIng.name,
                            ),
                          );
                        } else if (
                          oldState === "contains" &&
                          newState === "none"
                        ) {
                          specificChanges.push(
                            makeChangeEntry(
                              `${newIng.name}: ${smartPrefix}removed ${displayName} (was: contains)`,
                              newIng.name,
                            ),
                          );
                        } else if (
                          oldState === "cross-contam" &&
                          newState === "none"
                        ) {
                          specificChanges.push(
                            makeChangeEntry(
                              `${newIng.name}: ${smartPrefix}removed ${displayName} (was: cross-contamination risk)`,
                              newIng.name,
                            ),
                          );
                        } else if (
                          oldState === "contains" &&
                          newState === "cross-contam"
                        ) {
                          specificChanges.push(
                            makeChangeEntry(
                              `${newIng.name}: ${smartPrefix}changed ${displayName} from contains -> cross-contamination risk`,
                              newIng.name,
                            ),
                          );
                        } else if (
                          oldState === "cross-contam" &&
                          newState === "contains"
                        ) {
                          specificChanges.push(
                            makeChangeEntry(
                              `${newIng.name}: ${smartPrefix}changed ${displayName} from cross-contamination risk -> contains`,
                              newIng.name,
                            ),
                          );
                        }
                      }
                    });

                    // Track diet state changes
                    allDiets.forEach((diet) => {
                      const oldState = getItemState(diet, "diet", oldIng);
                      const newState = getItemState(diet, "diet", newIng);

                      if (oldState !== newState) {
                        if (oldState === "none" && newState === "compliant") {
                          specificChanges.push(
                            makeChangeEntry(
                              `${newIng.name}: ${smartPrefix}added ${diet} (compliant)`,
                              newIng.name,
                            ),
                          );
                        } else if (
                          oldState === "none" &&
                          newState === "cross-contam"
                        ) {
                          specificChanges.push(
                            makeChangeEntry(
                              `${newIng.name}: ${smartPrefix}added ${diet} (cross-contamination risk)`,
                              newIng.name,
                            ),
                          );
                        } else if (
                          oldState === "compliant" &&
                          newState === "none"
                        ) {
                          specificChanges.push(
                            makeChangeEntry(
                              `${newIng.name}: ${smartPrefix}removed ${diet} (was: compliant)`,
                              newIng.name,
                            ),
                          );
                        } else if (
                          oldState === "cross-contam" &&
                          newState === "none"
                        ) {
                          specificChanges.push(
                            makeChangeEntry(
                              `${newIng.name}: ${smartPrefix}removed ${diet} (was: cross-contamination risk)`,
                              newIng.name,
                            ),
                          );
                        } else if (
                          oldState === "compliant" &&
                          newState === "cross-contam"
                        ) {
                          specificChanges.push(
                            makeChangeEntry(
                              `${newIng.name}: ${smartPrefix}changed ${diet} from compliant -> cross-contamination risk`,
                              newIng.name,
                            ),
                          );
                        } else if (
                          oldState === "cross-contam" &&
                          newState === "compliant"
                        ) {
                          specificChanges.push(
                            makeChangeEntry(
                              `${newIng.name}: ${smartPrefix}changed ${diet} from cross-contamination risk -> compliant`,
                              newIng.name,
                            ),
                          );
                        }
                      }
                    });

                    // Check for added brands
                    const oldBrands = oldIng.brands || [];
                    const newBrands = newIng.brands || [];
                    const getBrandKey = (b) => `${b.name}|${b.barcode || ""}`;
                    const oldBrandKeys = new Set(oldBrands.map(getBrandKey));
                    const newBrandKeys = new Set(newBrands.map(getBrandKey));

                    newBrands.forEach((b) => {
                      if (!oldBrandKeys.has(getBrandKey(b))) {
                        specificChanges.push(
                          makeChangeEntry(
                            `${newIng.name}: ${b.name} added as brand item`,
                            newIng.name,
                          ),
                        );
                      }
                    });

                    oldBrands.forEach((b) => {
                      if (!newBrandKeys.has(getBrandKey(b))) {
                        specificChanges.push(
                          makeChangeEntry(
                            `${newIng.name}: ${b.name} removed as brand item`,
                            newIng.name,
                          ),
                        );
                      }
                    });
                  }
                });

                // Check for added/removed ingredients
                const oldNames = new Set(oldIngList.map((i) => i.name));
                const newNames = new Set(newIngList.map((i) => i.name));
                const addedIngs = [...newNames].filter((n) => !oldNames.has(n));
                const removedIngs = [...oldNames].filter(
                  (n) => !newNames.has(n),
                );
                if (addedIngs.length)
                  specificChanges.push({
                    text: `Added ingredient: ${addedIngs.join(", ")}`,
                    details: null,
                  });
                if (removedIngs.length)
                  specificChanges.push({
                    text: `Removed ingredient: ${removedIngs.join(", ")}`,
                    details: null,
                  });

                if (specificChanges.length > 0) {
                  // Add each specific change with the dish name prefix
                  // specificChanges now contains objects { text, details }
                  specificChanges.forEach((sc) => {
                    if (typeof sc === "string") {
                      // Backwards compatibility for string entries
                      changes.push({
                        text: `${itemName}: ${sc}`,
                        details: null,
                      });
                    } else {
                      changes.push({
                        text: `${itemName}: ${sc.text}`,
                        details: sc.details,
                      });
                    }
                  });
                } else {
                  changes.push(`${itemName}: Updated ingredient data`);
                }
              } else {
                changes.push(`${itemName}: Updated ingredient data`);
              }
            } catch (e) {
              changes.push(`${itemName}: Updated ingredient data`);
            }
          }
        }
      } else {
        // New overlay added
        changes.push(`${itemName}: Added overlay`);
      }
    });

    // Find removed overlays
    oldList.forEach((item) => {
      if (!item || !item.id) return;
      if (!newById.has(item.id)) {
        const itemName = item.id || "Item";
        changes.push(`${itemName}: Removed overlay`);
      }
    });

    return changes;
  }

  return {
    setSaveState,
    formatChangesForLog,
    describeOverlayChanges,
  };
}
