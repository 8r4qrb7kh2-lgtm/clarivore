const OWNER_EMAIL = "matt.29.ds@gmail.com";

export function createDishInteractionTracker(options = {}) {
  const {
    state,
    normalizeAllergen,
    normalizeDietLabel,
    supabaseClient,
  } = options;

  const trackedDishes = new Set();

  return async function trackDishInteraction(item) {
    if (!item || !state.user?.loggedIn) return;

    const isOwner = state.user?.email === OWNER_EMAIL;
    const isManager = state.user?.role === "manager";
    if (isOwner || isManager) return;

    const dishName = item.id || item.name || item.label;
    if (!dishName) return;

    const trackKey = `${state.restaurant?.id}-${dishName}`;
    if (trackedDishes.has(trackKey)) return;
    trackedDishes.add(trackKey);

    try {
      const restaurantId = state.restaurant?.id || state.restaurant?._id;
      if (!restaurantId || !supabaseClient) return;

      const userAllergens = (state.allergies || [])
        .map(normalizeAllergen)
        .filter(Boolean);
      const userDiets = (state.diets || [])
        .map(normalizeDietLabel)
        .filter(Boolean);

      let dishStatus = "neutral";
      const dishAllergens = (item.allergens || [])
        .map(normalizeAllergen)
        .filter(Boolean);
      const dishDiets = (item.diets || [])
        .map(normalizeDietLabel)
        .filter(Boolean);
      const removable = (item.removable || [])
        .map((entry) => normalizeAllergen(entry.allergen))
        .filter(Boolean);

      const hasAllergenConflict = userAllergens.some((allergen) =>
        dishAllergens.includes(allergen),
      );
      const hasDietConflict = userDiets.some((diet) => !dishDiets.includes(diet));

      if (hasAllergenConflict || hasDietConflict) {
        const nonRemovableAllergens = userAllergens.filter(
          (allergen) =>
            dishAllergens.includes(allergen) && !removable.includes(allergen),
        );
        if (nonRemovableAllergens.length > 0 || hasDietConflict) {
          dishStatus = "unsafe";
        } else {
          dishStatus = "removable";
        }
      } else if (userAllergens.length > 0 || userDiets.length > 0) {
        dishStatus = "safe";
      }

      const { error } = await supabaseClient.from("dish_interactions").insert([
        {
          restaurant_id: restaurantId,
          dish_name: dishName,
          user_id: state.user.id,
          user_allergens: userAllergens,
          user_diets: userDiets,
          dish_status: dishStatus,
        },
      ]);

      if (error) {
        console.warn("Failed to track dish interaction:", error);
      }
    } catch (error) {
      console.warn("Error tracking dish interaction:", error);
    }
  };
}
