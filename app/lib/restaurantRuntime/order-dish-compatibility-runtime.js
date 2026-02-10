export function createOrderDishCompatibilityRuntime(options = {}) {
  const getRestaurantOverlays =
    typeof options.getRestaurantOverlays === "function"
      ? options.getRestaurantOverlays
      : () => [];
  const getUserAllergies =
    typeof options.getUserAllergies === "function"
      ? options.getUserAllergies
      : () => [];
  const getUserDiets =
    typeof options.getUserDiets === "function" ? options.getUserDiets : () => [];
  const normalizeAllergen =
    typeof options.normalizeAllergen === "function"
      ? options.normalizeAllergen
      : (value) => String(value ?? "").trim();
  const normalizeDietLabel =
    typeof options.normalizeDietLabel === "function"
      ? options.normalizeDietLabel
      : (value) => String(value ?? "").trim();
  const getDietAllergenConflicts =
    typeof options.getDietAllergenConflicts === "function"
      ? options.getDietAllergenConflicts
      : () => [];
  const formatOrderListLabel =
    typeof options.formatOrderListLabel === "function"
      ? options.formatOrderListLabel
      : (value) => String(value ?? "");
  const esc =
    typeof options.esc === "function"
      ? options.esc
      : (value) => String(value ?? "");

  function getDishOverlayByName(dishName) {
    const overlays = getRestaurantOverlays();
    const target = (dishName || "").toString().trim().toLowerCase();
    if (!target) return null;
    return (
      overlays.find((overlay) => {
        const candidate = (overlay.id || overlay.name || "")
          .toString()
          .trim()
          .toLowerCase();
        return candidate === target;
      }) || null
    );
  }

  function renderCompatibilityList(messages, extraClass) {
    if (!messages || messages.length === 0) return "";
    const className = extraClass
      ? `orderDishStatusList ${extraClass}`
      : "orderDishStatusList";
    const items = messages
      .map((msg) => {
        const type = msg.type || "info";
        return `<li class="${type}">${esc(msg.text)}</li>`;
      })
      .join("");
    return `<ul class="${className}">${items}</ul>`;
  }

  function getDishCompatibilityDetails(dishName) {
    const userAllergies = getUserAllergies();
    const userDiets = getUserDiets();
    const dish = getDishOverlayByName(dishName);
    const details = {
      dish,
      severity: "success",
      badgeLabel: "Meets all requirements",
      allergenMessages: [],
      dietMessages: [],
      hasPreferences: userAllergies.length > 0 || userDiets.length > 0,
      issues: {
        allergens: [],
        diets: [],
      },
    };

    const severityRank = { success: 0, warn: 1, danger: 2 };
    let highestRank = -1;
    const trackSeverity = (type) => {
      const rank = severityRank[type];
      if (rank !== undefined && rank > highestRank) {
        highestRank = rank;
      }
    };

    if (!dish) {
      if (details.hasPreferences) {
        details.severity = "warn";
        details.badgeLabel = "Check with staff";
        if (userAllergies.length) {
          details.allergenMessages.push({
            type: "warn",
            text: "Allergen details unavailable for this item.",
          });
          trackSeverity("warn");
        } else {
          details.allergenMessages.push({
            type: "info",
            text: "Allergen details unavailable for this item.",
          });
        }
        if (userDiets.length) {
          details.dietMessages.push({
            type: "warn",
            text: "Dietary compatibility unknown.",
          });
          trackSeverity("warn");
        }
      } else {
        details.severity = "info";
        details.badgeLabel = "No saved preferences";
        details.allergenMessages.push({
          type: "info",
          text: "No allergies saved",
        });
        details.dietMessages.push({
          type: "info",
          text: "No diets saved",
        });
      }
      return details;
    }

    const dishAllergens = (dish.allergens || [])
      .map(normalizeAllergen)
      .filter(Boolean);
    const dishDietSet = new Set(
      (dish.diets || []).map(normalizeDietLabel).filter(Boolean),
    );
    const removableAllergens = new Set(
      (dish.removable || [])
        .map((item) => normalizeAllergen(item.allergen || ""))
        .filter(Boolean),
    );

    if (userAllergies.length === 0) {
      details.allergenMessages.push({ type: "info", text: "No allergies saved" });
    } else {
      userAllergies.forEach((allergen) => {
        const normalized = normalizeAllergen(allergen);
        if (!normalized) return;
        const friendly = formatOrderListLabel(allergen);
        const hasAllergen = dishAllergens.includes(normalized);
        if (!hasAllergen) {
          details.allergenMessages.push({
            type: "success",
            text: `Doesn't contain ${friendly}`,
          });
        } else if (removableAllergens.has(normalized)) {
          details.allergenMessages.push({
            type: "warn",
            text: `Can be made ${friendly}-free`,
          });
          trackSeverity("warn");
        } else {
          details.allergenMessages.push({
            type: "danger",
            text: `Contains ${friendly}`,
          });
          trackSeverity("danger");
          details.issues.allergens.push(friendly);
        }
      });
    }

    const normalizedDiets = (userDiets || [])
      .map(normalizeDietLabel)
      .filter(Boolean);

    if (normalizedDiets.length === 0) {
      details.dietMessages.push({
        type: "info",
        text: "No diets saved",
      });
    } else {
      normalizedDiets.forEach((diet) => {
        const friendlyDiet = formatOrderListLabel(diet);
        const conflicts = getDietAllergenConflicts(diet);
        const blockingAllergens = conflicts.filter((allergen) =>
          dishAllergens.includes(allergen),
        );
        const allBlockingRemovable =
          blockingAllergens.length > 0 &&
          blockingAllergens.every((allergen) =>
            removableAllergens.has(allergen),
          );

        if (dishDietSet.has(diet)) {
          details.dietMessages.push({
            type: "success",
            text: `Meets ${friendlyDiet}`,
          });
        } else if (allBlockingRemovable) {
          details.dietMessages.push({
            type: "warn",
            text: `Can be made ${friendlyDiet}`,
          });
          trackSeverity("warn");
        } else if (blockingAllergens.length > 0) {
          details.dietMessages.push({
            type: "danger",
            text: `Not ${friendlyDiet}`,
          });
          trackSeverity("danger");
          details.issues.diets.push(friendlyDiet);
        } else {
          details.dietMessages.push({
            type: "danger",
            text: `Not ${friendlyDiet}`,
          });
          trackSeverity("danger");
          details.issues.diets.push(friendlyDiet);
        }
      });
    }

    if (details.issues.allergens.length > 0 || details.issues.diets.length > 0) {
      details.severity = "danger";
      details.badgeLabel = "Cannot be accommodated";
    } else if (highestRank === 1) {
      details.severity = "warn";
      details.badgeLabel = "Can be removed/replaced";
    } else if (details.hasPreferences) {
      details.severity = "success";
      details.badgeLabel = "Meets all requirements";
    } else {
      details.severity = "info";
      details.badgeLabel = "No saved preferences";
    }

    return details;
  }

  function renderCompatibilitySection(title, messages) {
    const list = renderCompatibilityList(messages);
    if (!list) return "";
    return `<div class="orderConfirmDishSection">
  <div class="orderConfirmDishSectionTitle">${esc(title)}</div>
  ${list}
    </div>`;
  }

  function getDishSeverityClass(details) {
    return (
      {
        success: "orderConfirmDishBadge--success",
        warn: "orderConfirmDishBadge--warn",
        danger: "orderConfirmDishBadge--danger",
        info: "orderConfirmDishBadge--info",
      }[details?.severity] || "orderConfirmDishBadge--info"
    );
  }

  function createDishSummaryCard(dishName) {
    const details = getDishCompatibilityDetails(dishName);
    const severityClass = getDishSeverityClass(details);
    const allergenSection = renderCompatibilitySection(
      "Allergens",
      details.allergenMessages,
    );
    const dietSection = renderCompatibilitySection("Diets", details.dietMessages);
    const sections = [allergenSection, dietSection].filter(Boolean).join("");
    const body =
      sections ||
      '<p class="orderConfirmDishNote">No saved allergies or diets.</p>';
    return `
  <article class="orderConfirmDishCard" data-severity="${details.severity}">
    <div class="orderConfirmDishCardHeader">
      <div class="orderConfirmDishName">${esc(dishName)}</div>
      <span class="orderConfirmDishBadge ${severityClass}">${esc(details.badgeLabel)}</span>
    </div>
    ${body}
  </article>
    `;
  }

  function buildAddToOrderWarningMessage(dishName, details) {
    const parts = [];
    if (details.issues?.allergens?.length) {
      const list = details.issues.allergens.join(", ");
      parts.push(`${dishName} contains ${list} that cannot be accommodated.`);
    }
    if (details.issues?.diets?.length) {
      const list = details.issues.diets.join(", ");
      parts.push(
        `${dishName} does not meet your ${list} preference${details.issues.diets.length > 1 ? "s" : ""}.`,
      );
    }
    const intro = parts.length
      ? parts.join(" ")
      : "This dish may not align with your saved preferences.";
    return `${intro} Are you sure you want to add this to your order?`;
  }

  function hasBlockingCompatibilityIssues(details) {
    if (!details || !details.issues) return false;
    return Boolean(
      (details.issues.allergens && details.issues.allergens.length > 0) ||
        (details.issues.diets && details.issues.diets.length > 0),
    );
  }

  return {
    getDishCompatibilityDetails,
    createDishSummaryCard,
    buildAddToOrderWarningMessage,
    hasBlockingCompatibilityIssues,
  };
}
