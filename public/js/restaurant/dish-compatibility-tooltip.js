export function createTooltipBodyHTML(deps = {}) {
  const normalizeAllergen =
    typeof deps.normalizeAllergen === "function"
      ? deps.normalizeAllergen
      : (value) => String(value ?? "").trim();
  const normalizeDietLabel =
    typeof deps.normalizeDietLabel === "function"
      ? deps.normalizeDietLabel
      : (value) => String(value ?? "").trim();
  const getDietAllergenConflicts =
    typeof deps.getDietAllergenConflicts === "function"
      ? deps.getDietAllergenConflicts
      : () => [];
  const ALLERGEN_EMOJI =
    deps.ALLERGEN_EMOJI && typeof deps.ALLERGEN_EMOJI === "object"
      ? deps.ALLERGEN_EMOJI
      : {};
  const DIET_EMOJI =
    deps.DIET_EMOJI && typeof deps.DIET_EMOJI === "object" ? deps.DIET_EMOJI : {};
  const formatAllergenLabel =
    typeof deps.formatAllergenLabel === "function"
      ? deps.formatAllergenLabel
      : (value) => String(value ?? "");
  const esc =
    typeof deps.esc === "function"
      ? deps.esc
      : (value) => String(value ?? "");
  const prefersMobileInfo =
    typeof deps.prefersMobileInfo === "function"
      ? deps.prefersMobileInfo
      : () => false;

  function computeStatus(item, sel, userDiets) {
    const userAllergens = (sel || []).map(normalizeAllergen).filter(Boolean);
    const normalizedDiets = (userDiets || [])
      .map(normalizeDietLabel)
      .filter(Boolean);
    const hasAllergenReqs = userAllergens.length > 0;
    const hasDietReqs = normalizedDiets.length > 0;

    if (!hasAllergenReqs && !hasDietReqs) return "neutral";

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

    const itemDiets = new Set(
      (item.diets || []).map(normalizeDietLabel).filter(Boolean),
    );
    const meetsDietReqs =
      !hasDietReqs || normalizedDiets.every((diet) => itemDiets.has(diet));

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
          ) {
            return false;
          }
          if (
            blockingIngredients.length > 0 &&
            !allBlockingIngredientsRemovable
          ) {
            return false;
          }
          return true;
        });
      }
    }

    if (!meetsDietReqs && !canBeMadeForDiets) return "unsafe";
    if (hasAllergenIssues && !allergenRemovableAll) return "unsafe";
    if (hasAllergenIssues && allergenRemovableAll) return "removable";
    if (!meetsDietReqs && canBeMadeForDiets) return "removable";
    return "safe";
  }

  function hasCrossContamination(item, sel, userDiets) {
    const userAllergens = (sel || []).map(normalizeAllergen).filter(Boolean);
    const hasAllergenCross =
      userAllergens.length > 0 &&
      (item.crossContamination || [])
        .map(normalizeAllergen)
        .filter(Boolean)
        .some((a) => userAllergens.includes(a));

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

  return function tooltipBodyHTML(item, sel, userDiets, isClick = false) {
    const status = computeStatus(item, sel, userDiets);
    const details = item.details || {};
    const hasCross = hasCrossContamination(item, sel, userDiets);
    const normalizedAllergens = (sel || [])
      .map(normalizeAllergen)
      .filter(Boolean);
    const normalizedDiets = (userDiets || [])
      .map(normalizeDietLabel)
      .filter(Boolean);

    const isMobile = prefersMobileInfo();
    const showDetails = isMobile || isClick;

    if (!normalizedAllergens.length && !normalizedDiets.length) {
      return `<div class="note">No diets saved. Sign in to save them.</div>`;
    }

    let html = "";

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

            if (showDetails) {
              const ingredientInfo = details[detailKey] || details[a];
              if (ingredientInfo) {
                const ingredients = ingredientInfo.replace(/^Contains\s+/i, "");
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

            if (showDetails) {
              const ingredientInfo = details[detailKey] || details[a];
              if (ingredientInfo) {
                const ingredients = ingredientInfo.replace(/^Contains\s+/i, "");
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

      html += `</div>`;
    }

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

        const conflicts = getDietAllergenConflicts(userDiet);
        const itemAllergens = (item.allergens || [])
          .map(normalizeAllergen)
          .filter(Boolean);
        const conflictingAllergens = conflicts.filter((allergen) =>
          itemAllergens.includes(allergen),
        );

        const allConflictingAllergensRemovable =
          conflictingAllergens.length > 0 &&
          conflictingAllergens.every((allergen) =>
            removableAllergens.has(allergen),
          );

        const blockingIngredients =
          item.ingredientsBlockingDiets?.[userDiet] || [];
        const allBlockingIngredientsRemovable =
          blockingIngredients.length > 0 &&
          blockingIngredients.every((ing) => ing.removable);

        const hasRemovableBlockers =
          (conflictingAllergens.length > 0 &&
            allConflictingAllergensRemovable) ||
          (blockingIngredients.length > 0 && allBlockingIngredientsRemovable);

        if (isDietMet && !hasRemovableBlockers) {
          html += `<div style="margin-bottom:6px;color:#4cc85a;font-size:0.9rem">${emoji} This dish is <strong>${esc(userDiet)}</strong></div>`;
        } else if (isDietMet && hasRemovableBlockers) {
          html += `<div style="margin-bottom:6px;color:#facc15;font-size:0.9rem">${emoji} Can be made <strong>${esc(userDiet)}</strong></div>`;
        } else {
          let canBeMade = false;
          const hasBlockingIngredientsInfo =
            item.ingredientsBlockingDiets !== undefined;

          if (hasBlockingIngredientsInfo) {
            const noBlockingIngredients = blockingIngredients.length === 0;
            const noConflictingAllergens = conflictingAllergens.length === 0;

            canBeMade =
              (noBlockingIngredients || allBlockingIngredientsRemovable) &&
              (noConflictingAllergens || allConflictingAllergensRemovable);
          } else {
            canBeMade =
              conflictingAllergens.length > 0 &&
              allConflictingAllergensRemovable;
          }

          if (canBeMade) {
            html += `<div style="margin-bottom:6px;color:#facc15;font-size:0.9rem">${emoji} Can be made <strong>${esc(userDiet)}</strong></div>`;
          } else {
            let dietText = `${emoji} This dish is not <strong>${esc(userDiet)}</strong>`;

            if (showDetails && blockingIngredients.length > 0) {
              const ingredientNames = blockingIngredients
                .map((ing) => ing.name || ing)
                .filter((name) => name)
                .join(", ");
              if (ingredientNames) {
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

      allergenCrossHits.forEach((a) => {
        const emoji = ALLERGEN_EMOJI[normalizeAllergen(a)] || "";
        allCrossItems.push(
          `${emoji} <strong>${esc(formatAllergenLabel(a))}</strong>`,
        );
      });

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
  };
}
