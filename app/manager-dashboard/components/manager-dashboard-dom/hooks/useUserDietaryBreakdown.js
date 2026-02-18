import { useMemo } from "react";

// Calculates unique-user distribution for allergens and diets used by the pie-chart section.
export function useUserDietaryBreakdown({
  rawInteractions,
  ALLERGENS,
  DIETS,
  ALLERGEN_EMOJI,
  DIET_EMOJI,
  normalizeAllergen,
  normalizeDietLabel,
  formatAllergenLabel,
}) {
  return useMemo(() => {
    if (!rawInteractions.length) return null;

    const allergenUserSets = {};
    ALLERGENS.forEach((allergen) => {
      allergenUserSets[allergen] = new Set();
    });

    const dietUserSets = {};
    DIETS.forEach((diet) => {
      dietUserSets[diet] = new Set();
    });

    const usersWithNoAllergens = new Set();
    const usersWithNoDiets = new Set();
    const allUsers = new Set();

    rawInteractions.forEach((interaction) => {
      const userId = interaction?.user_id;
      if (!userId) return;

      allUsers.add(userId);

      const userAllergens = (interaction.user_allergens || [])
        .map(normalizeAllergen)
        .filter(Boolean);
      const userDiets = (interaction.user_diets || []).map(normalizeDietLabel).filter(Boolean);

      if (!userAllergens.length) {
        usersWithNoAllergens.add(userId);
      }
      if (!userDiets.length) {
        usersWithNoDiets.add(userId);
      }

      userAllergens.forEach((allergen) => {
        if (allergenUserSets[allergen]) {
          allergenUserSets[allergen].add(userId);
        }
      });

      userDiets.forEach((diet) => {
        if (dietUserSets[diet]) {
          dietUserSets[diet].add(userId);
        }
      });
    });

    const allergenData = ALLERGENS.map((allergen) => ({
      name: allergen,
      label: formatAllergenLabel(allergen),
      count: allergenUserSets[allergen].size,
      emoji: ALLERGEN_EMOJI[allergen] || "",
    }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count);

    if (usersWithNoAllergens.size > 0) {
      allergenData.push({
        name: "No allergies",
        label: "No allergies",
        count: usersWithNoAllergens.size,
        emoji: "✓",
      });
    }

    const dietData = DIETS.map((diet) => ({
      name: diet,
      label: diet,
      count: dietUserSets[diet].size,
      emoji: DIET_EMOJI[diet] || "",
    }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count);

    if (usersWithNoDiets.size > 0) {
      dietData.push({
        name: "No diets",
        label: "No diets",
        count: usersWithNoDiets.size,
        emoji: "✓",
      });
    }

    return {
      uniqueUserCount: allUsers.size,
      allergenData,
      dietData,
    };
  }, [
    ALLERGENS,
    ALLERGEN_EMOJI,
    DIETS,
    DIET_EMOJI,
    formatAllergenLabel,
    normalizeAllergen,
    normalizeDietLabel,
    rawInteractions,
  ]);
}
