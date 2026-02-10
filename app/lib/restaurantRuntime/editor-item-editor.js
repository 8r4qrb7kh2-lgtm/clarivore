export function createEditorItemEditor(deps = {}) {
  const {
    configureModalClose,
    mb,
    esc,
    aiAssistSetStatus,
    cap,
    normalizeAllergen,
    normalizeDietLabel,
    formatAllergenLabel,
    getDietAllergenConflicts,
    tooltipBodyHTML,
    ALLERGENS,
    DIETS,
    pendingChanges,
    overlays,
    drawAll,
    setDirty,
    pushHistory,
    openDishEditor,
  } = deps;

  return function openItemEditor(it, idx) {
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
  };
}
