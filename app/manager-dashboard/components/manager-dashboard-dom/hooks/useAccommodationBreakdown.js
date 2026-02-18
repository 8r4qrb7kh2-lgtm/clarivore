import { useMemo } from "react";
import { getOverlayDishName, normalizeDishKey } from "../utils/menuUtils";

// Produces allergen/diet coverage and view-conflict summaries for the heatmap breakdown card.
export function useAccommodationBreakdown({
  allOverlays,
  rawInteractions,
  ALLERGENS,
  DIETS,
  normalizeAllergen,
  normalizeDietLabel,
}) {
  return useMemo(() => {
    if (!allOverlays.length) return null;

    const dishOverlayMap = {};
    allOverlays.forEach((overlay, index) => {
      const dishName = getOverlayDishName(overlay, index);
      const key = normalizeDishKey(dishName);
      if (key && !dishOverlayMap[key]) {
        dishOverlayMap[key] = overlay;
      }
    });

    // Dish-level coverage answers: for each restriction, how many dishes are safe/accommodable/unsafe.
    const allergenDishStats = {};
    ALLERGENS.forEach((allergen) => {
      allergenDishStats[allergen] = { safe: 0, accommodated: 0, cannot: 0 };
    });

    const dietDishStats = {};
    DIETS.forEach((diet) => {
      dietDishStats[diet] = { safe: 0, cannot: 0 };
    });

    const totalDishes = allOverlays.length;

    allOverlays.forEach((overlay) => {
      const dishAllergens = (overlay.allergens || []).map(normalizeAllergen).filter(Boolean);
      const removableAllergens = (overlay.removable || [])
        .map((entry) => normalizeAllergen(entry?.allergen || ""))
        .filter(Boolean);
      const dishDiets = new Set((overlay.diets || []).map(normalizeDietLabel).filter(Boolean));

      ALLERGENS.forEach((allergen) => {
        if (!dishAllergens.includes(allergen)) {
          allergenDishStats[allergen].safe += 1;
        } else if (removableAllergens.includes(allergen)) {
          allergenDishStats[allergen].accommodated += 1;
        } else {
          allergenDishStats[allergen].cannot += 1;
        }
      });

      DIETS.forEach((diet) => {
        if (dishDiets.has(diet)) {
          dietDishStats[diet].safe += 1;
        } else {
          dietDishStats[diet].cannot += 1;
        }
      });
    });

    // View-level conflict answers: for each user view, did the dish conflict and was it accommodable.
    const allergenViewStats = {};
    ALLERGENS.forEach((allergen) => {
      allergenViewStats[allergen] = { noConflict: 0, accommodated: 0, cannot: 0 };
    });

    const dietViewStats = {};
    DIETS.forEach((diet) => {
      dietViewStats[diet] = { noConflict: 0, cannot: 0 };
    });

    let totalViews = 0;

    rawInteractions.forEach((interaction) => {
      const key = normalizeDishKey(interaction?.dish_name);
      if (!key) return;
      const overlay = dishOverlayMap[key];
      if (!overlay) return;

      totalViews += 1;

      const userAllergens = (interaction.user_allergens || [])
        .map(normalizeAllergen)
        .filter(Boolean);
      const userDiets = (interaction.user_diets || [])
        .map(normalizeDietLabel)
        .filter(Boolean);

      const dishAllergens = (overlay.allergens || []).map(normalizeAllergen).filter(Boolean);
      const removableAllergens = (overlay.removable || [])
        .map((entry) => normalizeAllergen(entry?.allergen || ""))
        .filter(Boolean);
      const dishDietSet = new Set((overlay.diets || []).map(normalizeDietLabel).filter(Boolean));

      ALLERGENS.forEach((allergen) => {
        const userHasAllergen = userAllergens.includes(allergen);
        const dishHasAllergen = dishAllergens.includes(allergen);

        if (!userHasAllergen) {
          allergenViewStats[allergen].noConflict += 1;
        } else if (dishHasAllergen && removableAllergens.includes(allergen)) {
          allergenViewStats[allergen].accommodated += 1;
        } else if (dishHasAllergen) {
          allergenViewStats[allergen].cannot += 1;
        } else {
          allergenViewStats[allergen].noConflict += 1;
        }
      });

      DIETS.forEach((diet) => {
        const userHasDiet = userDiets.includes(diet);
        if (!userHasDiet || dishDietSet.has(diet)) {
          dietViewStats[diet].noConflict += 1;
        } else {
          dietViewStats[diet].cannot += 1;
        }
      });
    });

    // Hide empty restriction rows to keep the visualization focused.
    const relevantAllergens = ALLERGENS.filter(
      (allergen) =>
        allergenDishStats[allergen].accommodated > 0 ||
        allergenDishStats[allergen].cannot > 0,
    );
    const relevantDiets = DIETS.filter((diet) => dietDishStats[diet].cannot > 0);

    return {
      totalDishes,
      totalViews,
      allergenDishStats,
      allergenViewStats,
      dietDishStats,
      dietViewStats,
      relevantAllergens,
      relevantDiets,
    };
  }, [
    ALLERGENS,
    DIETS,
    allOverlays,
    normalizeAllergen,
    normalizeDietLabel,
    rawInteractions,
  ]);
}
