import { getShowOverlayDetails } from "./restaurantRuntimeBridge.js";

const HOW_IT_WORKS_TOUR_STEPS = [
  {
    id: "intro",
    title: "Meet the training menu",
    body: "This sandbox mirrors a live Clarivore restaurant. Walk through each step here before editing a real menu.",
    selector: ".banner",
    action: "reset",
  },
  {
    id: "allergens",
    title: "Practice allergen filters",
    body: "Toggle the allergen chips and watch Grilled Tofu update immediately. We'll auto-select Peanut for you now.",
    selector: "#savedChips",
    action: "demoAllergens",
  },
  {
    id: "diets",
    title: "Layer a dietary preference",
    body: "Add Vegan to see how Clarivore combines diet goals with allergens in real time.",
    selector: "#dietChips",
    action: "demoDiets",
  },
  {
    id: "details",
    title: "Open a dish overlay",
    body: "Tap the outline around Grilled Tofu or press the blue 'i' badge to view its allergen, diet, and ingredient breakdown.",
    selector: '[data-item-id="Grilled Tofu"]',
    action: "highlightTofu",
  },
  {
    id: "notice",
    title: "Send a sample notice",
    body: "Use the 'Send allergy & diet notice' drawer to practice messaging the kitchen. This simulator is safe to experiment with.",
    selector: "#orderSidebar",
    action: "openNotice",
  },
];
let sharedHowTourController = null;

export function createHowItWorksTour({
  state,
  renderSelector,
  renderDietSelector,
  updateOrderSidebar,
  openOrderSidebar,
  rerenderLayer,
} = {}) {
  function getHowItWorksTourController() {
    if (!sharedHowTourController) {
      sharedHowTourController = {
        index: 0,
        container: null,
        replayBtn: null,
        spotlight: null,
        currentSelector: null,
        dismissed: false,
        titleEl: null,
        bodyEl: null,
        progressEl: null,
        prevBtn: null,
        nextBtn: null,
      };
    }
    return sharedHowTourController;
  }

  function ensureHowItWorksTourElements() {
    const ctrl = getHowItWorksTourController();
    if (!ctrl.container) {
      const container = document.createElement("div");
      container.className = "how-tour-coach hidden";
      container.innerHTML = `
        <div class="how-tour-header">
          <span class="how-tour-chip">How it works</span>
          <button type="button" class="how-tour-close" aria-label="Hide training guide">×</button>
        </div>
        <h3 class="how-tour-title">Training guide</h3>
        <p class="how-tour-body">Follow the steps to see every control in action.</p>
        <div class="how-tour-progress">Step 1</div>
        <div class="how-tour-controls">
          <button type="button" class="how-tour-prev">Previous</button>
          <button type="button" class="how-tour-next">Next</button>
        </div>
      `;
      document.body.appendChild(container);
      ctrl.container = container;
      ctrl.titleEl = container.querySelector(".how-tour-title");
      ctrl.bodyEl = container.querySelector(".how-tour-body");
      ctrl.progressEl = container.querySelector(".how-tour-progress");
      ctrl.prevBtn = container.querySelector(".how-tour-prev");
      ctrl.nextBtn = container.querySelector(".how-tour-next");
      ctrl.closeBtn = container.querySelector(".how-tour-close");
    }

    if (!ctrl.replayBtn) {
      const replayBtn = document.createElement("button");
      replayBtn.type = "button";
      replayBtn.className = "how-tour-replay";
      replayBtn.textContent = "Show guide";
      document.body.appendChild(replayBtn);
      ctrl.replayBtn = replayBtn;
      replayBtn.addEventListener("click", () => {
        ctrl.index = 0;
        ctrl.dismissed = false;
        replayBtn.classList.remove("show");
        ctrl.container.classList.remove("hidden");
        renderHowItWorksTourStep();
      });
    }

    if (!ctrl.spotlight) {
      const spotlight = document.createElement("div");
      spotlight.className = "how-tour-spotlight";
      document.body.appendChild(spotlight);
      ctrl.spotlight = spotlight;
      if (typeof addEventListener === "function") {
        addEventListener("scroll", updateHowItWorksSpotlight, {
          passive: true,
        });
        addEventListener("resize", updateHowItWorksSpotlight, {
          passive: true,
        });
      }
    }

    if (!ctrl.prevBtn.__tourBound) {
      ctrl.prevBtn.__tourBound = true;
      ctrl.prevBtn.addEventListener("click", () => {
        if (ctrl.index > 0) {
          ctrl.index -= 1;
          renderHowItWorksTourStep();
        }
      });
    }

    if (!ctrl.nextBtn.__tourBound) {
      ctrl.nextBtn.__tourBound = true;
      ctrl.nextBtn.addEventListener("click", () => {
        if (ctrl.index < HOW_IT_WORKS_TOUR_STEPS.length - 1) {
          ctrl.index += 1;
          renderHowItWorksTourStep();
        } else {
          hideHowItWorksTour({ permanent: true });
        }
      });
    }

    if (!ctrl.closeBtn.__tourBound) {
      ctrl.closeBtn.__tourBound = true;
      ctrl.closeBtn.addEventListener("click", () =>
        hideHowItWorksTour({ permanent: true }),
      );
    }

    return ctrl;
  }

  function updateHowItWorksSpotlight() {
    const ctrl = getHowItWorksTourController();
    const spotlight = ctrl.spotlight;
    if (!spotlight || !ctrl.currentSelector) {
      if (spotlight) spotlight.classList.remove("show");
      return;
    }
    const target = document.querySelector(ctrl.currentSelector);
    if (!target) {
      spotlight.classList.remove("show");
      return;
    }
    const rect = target.getBoundingClientRect();
    const pad = 12;
    const leftOffset = typeof scrollX === "number" ? scrollX : 0;
    const topOffset = typeof scrollY === "number" ? scrollY : 0;
    spotlight.style.left = `${leftOffset + rect.left - pad}px`;
    spotlight.style.top = `${topOffset + rect.top - pad}px`;
    spotlight.style.width = `${rect.width + pad * 2}px`;
    spotlight.style.height = `${rect.height + pad * 2}px`;
    spotlight.classList.add("show");
  }

  function setHowItWorksTourHighlight(selector, attempt = 0) {
    const ctrl = ensureHowItWorksTourElements();
    ctrl.currentSelector = selector || null;
    if (!selector) {
      updateHowItWorksSpotlight();
      return;
    }
    const target = document.querySelector(selector);
    if (target) {
      try {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (_) {}
      updateHowItWorksSpotlight();
    } else if (attempt < 15) {
      setTimeout(() => setHowItWorksTourHighlight(selector, attempt + 1), 350);
    }
  }

  function setTrainingFilters({ allergies, diets } = {}) {
    if (!state?.isHowItWorks) return;
    let changed = false;
    if (Array.isArray(allergies)) {
      state.allergies = allergies;
      try {
        sessionStorage.setItem("qrAllergies", JSON.stringify(allergies));
      } catch (_) {}
      const chipsHost = document.getElementById("savedChips");
      if (chipsHost && typeof renderSelector === "function")
        renderSelector(chipsHost);
      changed = true;
    }
    if (Array.isArray(diets)) {
      state.diets = diets;
      try {
        sessionStorage.setItem("qrDiets", JSON.stringify(diets));
      } catch (_) {}
      const dietHost = document.getElementById("dietChips");
      if (dietHost && typeof renderDietSelector === "function")
        renderDietSelector(dietHost);
      changed = true;
    }
    if (changed) {
      if (typeof rerenderLayer === "function") rerenderLayer();
      if (typeof updateOrderSidebar === "function") updateOrderSidebar();
    }
  }

  function focusTrainingOverlay(name) {
    const overlays = Array.isArray(state?.restaurant?.overlays)
      ? state.restaurant.overlays
      : [];
    const item = overlays.find((o) => (o.id || o.name) === name);
    const escaped = name.replace(/\"/g, '\\"');
    const overlayEl = document.querySelector(`[data-item-id="${escaped}"]`);
    if (overlayEl) {
      overlayEl.scrollIntoView({ behavior: "smooth", block: "center" });
      const showOverlayDetails = getShowOverlayDetails();
      if (typeof showOverlayDetails === "function" && item) {
        showOverlayDetails(
          { type: "click", pointerType: "mouse" },
          item,
          overlayEl,
        );
      }
    }
  }

  function runHowItWorksTourAction(step) {
    if (!state?.isHowItWorks || !step || !step.action) return;
    switch (step.action) {
      case "reset":
        setTrainingFilters({ allergies: [], diets: [] });
        break;
      case "demoAllergens":
        setTrainingFilters({ allergies: ["peanut"], diets: [] });
        break;
      case "demoDiets":
        setTrainingFilters({ allergies: ["peanut"], diets: ["Vegan"] });
        break;
      case "highlightTofu":
        setTrainingFilters({ allergies: ["peanut"], diets: ["Vegan"] });
        focusTrainingOverlay("Grilled Tofu");
        break;
      case "openNotice":
        if (typeof openOrderSidebar === "function") openOrderSidebar();
        break;
      default:
        break;
    }
  }

  function renderHowItWorksTourStep() {
    const ctrl = ensureHowItWorksTourElements();
    const step =
      HOW_IT_WORKS_TOUR_STEPS[ctrl.index] || HOW_IT_WORKS_TOUR_STEPS[0];
    if (!step) return;

    ctrl.titleEl.textContent = step.title;
    ctrl.bodyEl.textContent = step.body;
    ctrl.progressEl.textContent = `Step ${ctrl.index + 1} of ${HOW_IT_WORKS_TOUR_STEPS.length}`;
    ctrl.prevBtn.disabled = ctrl.index === 0;
    ctrl.nextBtn.textContent =
      ctrl.index === HOW_IT_WORKS_TOUR_STEPS.length - 1 ? "Finish" : "Next";

    setHowItWorksTourHighlight(step.selector);
    runHowItWorksTourAction(step);
  }

  function hideHowItWorksTour({ permanent = false, hideReplay = false } = {}) {
    const ctrl = getHowItWorksTourController();
    if (ctrl.container) {
      ctrl.container.classList.add("hidden");
    }
    ctrl.currentSelector = null;
    updateHowItWorksSpotlight();
    if (ctrl.replayBtn) {
      if (permanent && !hideReplay) {
        ctrl.replayBtn.classList.add("show");
      } else if (hideReplay) {
        ctrl.replayBtn.classList.remove("show");
      }
    }
    if (permanent) {
      ctrl.dismissed = true;
    }
  }

  function maybeInitHowItWorksTour() {
    const ctrl = getHowItWorksTourController();
    if (!state?.isHowItWorks) {
      hideHowItWorksTour({ permanent: false, hideReplay: true });
      ctrl.dismissed = false;
      return;
    }

    ensureHowItWorksTourElements();
    if (ctrl.dismissed) {
      hideHowItWorksTour({ permanent: true });
      return;
    }
    ctrl.container.classList.remove("hidden");
    if (ctrl.replayBtn) {
      ctrl.replayBtn.classList.remove("show");
    }
    if (ctrl.index >= HOW_IT_WORKS_TOUR_STEPS.length) {
      ctrl.index = 0;
    }
    renderHowItWorksTourStep();
  }

  return {
    maybeInitHowItWorksTour,
    hideHowItWorksTour,
  };
}
