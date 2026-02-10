function addToggleHandlers(element, toggle) {
  element.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggle();
    },
    { passive: false },
  );

  element.addEventListener(
    "touchend",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggle();
    },
    { passive: false },
  );

  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  });
}

function renderReadOnlyChips({
  container,
  values,
  emptyMessage,
  emojiMap,
  fallbackEmoji,
  mapLabel,
  div,
  esc,
  updateFullScreenAllergySummary,
  includeSummary,
}) {
  container.innerHTML = "";
  if (!values.length) {
    container.appendChild(div(`<div class="note">${emptyMessage}</div>`));
    if (includeSummary) updateFullScreenAllergySummary();
    return;
  }

  const row = div("", "chips");
  row.style.cssText = "flex-wrap:nowrap;overflow-x:auto;gap:3px;";
  values.forEach((value) => {
    const emoji = emojiMap[value] || fallbackEmoji;
    const label = mapLabel(value);
    const chip = div(`${emoji} ${esc(label)}`, "chip active");
    chip.style.cssText =
      "flex-shrink:0;padding:4px 8px;font-size:0.75rem;white-space:nowrap;";
    row.appendChild(chip);
  });
  container.appendChild(row);
  if (includeSummary) updateFullScreenAllergySummary();
}

export function initRestaurantFilters(options = {}) {
  const {
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
    getCurrentMobileInfoItem,
    updateFullScreenAllergySummary,
    rerenderLayer,
  } = options;

  function renderSavedChips(container) {
    const saved = (state.allergies || []).map(normalizeAllergen).filter(Boolean);
    renderReadOnlyChips({
      container,
      values: saved,
      emptyMessage: 'No saved allergens. Use "Edit saved allergens".',
      emojiMap: ALLERGEN_EMOJI,
      fallbackEmoji: "🔴",
      mapLabel: (value) => formatAllergenLabel(value),
      div,
      esc,
      updateFullScreenAllergySummary,
      includeSummary: true,
    });
  }

  function renderSavedDiets(container) {
    const saved = (state.diets || []).map(normalizeDietLabel).filter(Boolean);
    renderReadOnlyChips({
      container,
      values: saved,
      emptyMessage: 'No saved diets. Use "Edit saved diets".',
      emojiMap: DIET_EMOJI,
      fallbackEmoji: "🍽️",
      mapLabel: (value) => value,
      div,
      esc,
      updateFullScreenAllergySummary,
      includeSummary: false,
    });
  }

  function renderSelectedChips(container) {
    const selected = (state.allergies || [])
      .map(normalizeAllergen)
      .filter(Boolean);
    renderReadOnlyChips({
      container,
      values: selected,
      emptyMessage: "No allergens selected.",
      emojiMap: ALLERGEN_EMOJI,
      fallbackEmoji: "🔴",
      mapLabel: (value) => formatAllergenLabel(value),
      div,
      esc,
      updateFullScreenAllergySummary,
      includeSummary: true,
    });
  }

  function renderSelectedDiets(container) {
    const selected = (state.diets || []).map(normalizeDietLabel).filter(Boolean);
    renderReadOnlyChips({
      container,
      values: selected,
      emptyMessage: "No diets selected.",
      emojiMap: DIET_EMOJI,
      fallbackEmoji: "🍽️",
      mapLabel: (value) => value,
      div,
      esc,
      updateFullScreenAllergySummary,
      includeSummary: false,
    });
  }

  function renderSelector(container) {
    container.innerHTML = "";
    const row = div("", "chips");
    row.setAttribute("role", "list");
    const selected = new Set(
      (state.allergies || []).map(normalizeAllergen).filter(Boolean),
    );

    ALLERGENS.forEach((allergen) => {
      const isActive = selected.has(allergen);
      const emoji = ALLERGEN_EMOJI[allergen] || "🔴";
      const chip = div(
        `${emoji} ${esc(formatAllergenLabel(allergen))}`,
        "chip clickable" + (isActive ? " active" : ""),
      );
      chip.setAttribute("role", "button");
      chip.setAttribute("tabindex", "0");
      chip.setAttribute("aria-pressed", isActive ? "true" : "false");
      chip.dataset.value = allergen;

      const toggle = () => {
        if (selected.has(allergen)) selected.delete(allergen);
        else selected.add(allergen);

        state.allergies = [...selected];
        updateFullScreenAllergySummary();

        try {
          sessionStorage.setItem("qrAllergies", JSON.stringify(state.allergies));
        } catch (_) {
          // Ignore storage failures
        }

        renderSelector(container);
        rerenderLayer();
        send({ type: "qrAllergies", allergies: state.allergies });
        if (prefersMobileInfo()) {
          renderMobileInfo(getCurrentMobileInfoItem());
        }
      };

      addToggleHandlers(chip, toggle);
      row.appendChild(chip);
    });

    container.appendChild(row);
    updateFullScreenAllergySummary();
  }

  function renderDietSelector(container) {
    container.innerHTML = "";
    const row = div("", "chips");
    row.setAttribute("role", "list");
    const selected = new Set((state.diets || []).map(normalizeDietLabel).filter(Boolean));

    DIETS.forEach((diet) => {
      const isActive = selected.has(diet);
      const emoji = DIET_EMOJI[diet] || "🍽️";
      const chip = div(
        `${emoji} ${esc(diet)}`,
        "chip clickable" + (isActive ? " active" : ""),
      );
      chip.setAttribute("role", "button");
      chip.setAttribute("tabindex", "0");
      chip.setAttribute("aria-pressed", isActive ? "true" : "false");
      chip.dataset.value = diet;

      const toggle = () => {
        if (selected.has(diet)) selected.delete(diet);
        else selected.add(diet);

        state.diets = [...selected];

        try {
          sessionStorage.setItem("qrDiets", JSON.stringify(state.diets));
        } catch (_) {
          // Ignore storage failures
        }

        renderDietSelector(container);
        rerenderLayer();
        if (prefersMobileInfo()) {
          renderMobileInfo(getCurrentMobileInfoItem());
        }
      };

      addToggleHandlers(chip, toggle);
      row.appendChild(chip);
    });

    container.appendChild(row);
  }

  return {
    renderSavedChips,
    renderSavedDiets,
    renderSelectedChips,
    renderSelectedDiets,
    renderSelector,
    renderDietSelector,
  };
}
