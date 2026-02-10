export function prefersMobileInfo() {
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

export function createMobileInfoHelpers(deps = {}) {
  const normalizeAllergen =
    typeof deps.normalizeAllergen === "function"
      ? deps.normalizeAllergen
      : (value) => String(value ?? "").trim();
  const normalizeDietLabel =
    typeof deps.normalizeDietLabel === "function"
      ? deps.normalizeDietLabel
      : (value) => String(value ?? "").trim();
  const formatAllergenLabel =
    typeof deps.formatAllergenLabel === "function"
      ? deps.formatAllergenLabel
      : (value) => String(value ?? "");
  const ALLERGEN_EMOJI =
    deps.ALLERGEN_EMOJI && typeof deps.ALLERGEN_EMOJI === "object"
      ? deps.ALLERGEN_EMOJI
      : {};
  const DIET_EMOJI =
    deps.DIET_EMOJI && typeof deps.DIET_EMOJI === "object" ? deps.DIET_EMOJI : {};
  const esc =
    typeof deps.esc === "function"
      ? deps.esc
      : (value) => String(value ?? "");

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

    const allergenRed = [];
    const allergenGreen = [];
    const allergenYellow = [];
    const dietRed = [];
    const dietGreen = [];
    const dietYellow = [];

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

    const renderColumn = (redItems, yellowItems, greenItems, title) => {
      let col = `<div class="mobileInfoColumn">`;
      col += `<div style="font-size:0.65rem;color:#9ca3af;margin-bottom:4px;font-weight:600">${title}</div>`;

      redItems.forEach((itemData) => {
        col += `<div style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:4px 6px;margin-bottom:3px">`;
        col += `<div style="color:#fca5a5;font-size:0.75rem;font-weight:500">${itemData.emoji} ${esc(itemData.text)}</div>`;
        if (itemData.subtext) {
          col += `<div style="color:rgba(252,165,165,0.6);font-size:0.65rem;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(itemData.subtext)}</div>`;
        }
        col += `</div>`;
      });

      yellowItems.forEach((itemData) => {
        col += `<div style="background:rgba(250,204,21,0.12);border:1px solid rgba(250,204,21,0.25);border-radius:6px;padding:3px 6px;margin-bottom:3px">`;
        col += `<div style="color:#fde047;font-size:0.7rem">⚠️ ${itemData.emoji} ${esc(itemData.text)}</div>`;
        col += `</div>`;
      });

      if (greenItems.length > 0) {
        col += `<div style="display:flex;flex-wrap:wrap;gap:3px">`;
        greenItems.forEach((itemData) => {
          col += `<div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);border-radius:4px;padding:2px 5px;font-size:0.65rem;color:#86efac">${itemData.emoji} ${esc(itemData.text)}</div>`;
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

    let html = `<div class="mobileInfoColumns" style="padding:6px 0">`;
    html += renderColumn(
      allergenRed,
      allergenYellow,
      allergenGreen,
      "ALLERGENS",
    );
    html += renderColumn(dietRed, dietYellow, dietGreen, "DIETS");
    html += `</div>`;
    return html;
  }

  return {
    mobileCompactBodyHTML,
    toggleLoveDishInTooltip,
  };
}
