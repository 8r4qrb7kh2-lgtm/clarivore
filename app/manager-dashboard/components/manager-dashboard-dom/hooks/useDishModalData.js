import { useMemo } from "react";
import {
  computeDishStatusForUser,
  getOverlayDishName,
  normalizeDishKey,
} from "../utils/menuUtils";

// Builds detailed analytics payload for the selected heatmap dish modal.
export function useDishModalData({
  activeDishName,
  allOverlays,
  accommodationRequests,
  rawInteractions,
  rawLoves,
  dishOrders,
  userProfilesById,
  DIETS,
  normalizeAllergen,
  normalizeDietLabel,
}) {
  return useMemo(() => {
    if (!activeDishName) return null;

    const dishKey = normalizeDishKey(activeDishName);

    const overlay = allOverlays.find((entry, index) => {
      const name = getOverlayDishName(entry, index);
      return normalizeDishKey(name) === dishKey;
    });

    if (!overlay) return null;

    const dishAllergens = (overlay.allergens || []).map(normalizeAllergen).filter(Boolean);
    const removableAllergens = (overlay.removable || [])
      .map((entry) => normalizeAllergen(entry?.allergen || ""))
      .filter(Boolean);

    const canAccommodateAllergens = dishAllergens.filter((allergen) =>
      removableAllergens.includes(allergen),
    );
    const cannotAccommodateAllergens = dishAllergens.filter(
      (allergen) => !removableAllergens.includes(allergen),
    );

    const dishDietSet = new Set((overlay.diets || []).map(normalizeDietLabel).filter(Boolean));
    const cannotAccommodateDiets = DIETS.filter((diet) => !dishDietSet.has(diet));

    const dishInteractions = rawInteractions.filter(
      (interaction) => normalizeDishKey(interaction?.dish_name) === dishKey,
    );

    // View-level status counts.
    let viewsSafe = 0;
    let viewsRemovable = 0;
    let viewsUnsafe = 0;

    dishInteractions.forEach((interaction) => {
      const status = computeDishStatusForUser(
        overlay,
        interaction?.user_allergens || [],
        interaction?.user_diets || [],
        normalizeAllergen,
        normalizeDietLabel,
      );

      if (status === "safe") viewsSafe += 1;
      else if (status === "removable") viewsRemovable += 1;
      else if (status === "unsafe") viewsUnsafe += 1;
    });

    const viewsTotal = viewsSafe + viewsRemovable + viewsUnsafe;

    // Unique-user status counts (deduplicated by user id).
    const seenUsers = new Set();
    let uniqueSafe = 0;
    let uniqueRemovable = 0;
    let uniqueUnsafe = 0;

    dishInteractions.forEach((interaction) => {
      const userId = interaction?.user_id;
      if (!userId || seenUsers.has(userId)) return;
      seenUsers.add(userId);

      const profile = userProfilesById[userId];
      const status = computeDishStatusForUser(
        overlay,
        profile?.allergens || [],
        profile?.diets || [],
        normalizeAllergen,
        normalizeDietLabel,
      );

      if (status === "safe") uniqueSafe += 1;
      else if (status === "removable") uniqueRemovable += 1;
      else if (status === "unsafe") uniqueUnsafe += 1;
    });

    // Love interactions classified by viewer status.
    let lovesSafe = 0;
    let lovesRemovable = 0;
    let lovesUnsafe = 0;

    rawLoves
      .filter((entry) => normalizeDishKey(entry?.dish_name) === dishKey)
      .forEach((entry) => {
        const profile = userProfilesById[entry?.user_id];
        const status = computeDishStatusForUser(
          overlay,
          profile?.allergens || [],
          profile?.diets || [],
          normalizeAllergen,
          normalizeDietLabel,
        );

        if (status === "safe") lovesSafe += 1;
        else if (status === "removable") lovesRemovable += 1;
        else if (status === "unsafe") lovesUnsafe += 1;
      });

    const lovesTotal = lovesSafe + lovesRemovable + lovesUnsafe;
    const ordersTotal = dishOrders[dishKey] || 0;

    // Compute menu-wide averages for comparison rows.
    const allDishKeys = [
      ...new Set(
        rawInteractions
          .map((interaction) => normalizeDishKey(interaction?.dish_name))
          .filter(Boolean),
      ),
    ];
    const numberOfDishes = allDishKeys.length || 1;

    let totalViewsAcrossMenu = 0;
    let totalSafeAcrossMenu = 0;
    let totalRemovableAcrossMenu = 0;
    let totalUnsafeAcrossMenu = 0;

    allDishKeys.forEach((candidateKey) => {
      const candidateOverlay = allOverlays.find((entry, index) => {
        const name = getOverlayDishName(entry, index);
        return normalizeDishKey(name) === candidateKey;
      });

      rawInteractions
        .filter((interaction) => normalizeDishKey(interaction?.dish_name) === candidateKey)
        .forEach((interaction) => {
          totalViewsAcrossMenu += 1;
          const status = computeDishStatusForUser(
            candidateOverlay,
            interaction?.user_allergens || [],
            interaction?.user_diets || [],
            normalizeAllergen,
            normalizeDietLabel,
          );

          if (status === "safe") totalSafeAcrossMenu += 1;
          else if (status === "removable") totalRemovableAcrossMenu += 1;
          else totalUnsafeAcrossMenu += 1;
        });
    });

    const averageViews = Math.round(totalViewsAcrossMenu / numberOfDishes);
    const averageSafe = totalSafeAcrossMenu / numberOfDishes;
    const averageRemovable = totalRemovableAcrossMenu / numberOfDishes;
    const averageUnsafe = totalUnsafeAcrossMenu / numberOfDishes;
    const averageTotal = averageSafe + averageRemovable + averageUnsafe;

    // Count which restrictions are most commonly conflicting for this dish.
    const allergenConflictCounts = {};
    cannotAccommodateAllergens.concat(canAccommodateAllergens).forEach((allergen) => {
      allergenConflictCounts[allergen] = 0;
    });

    const dietConflictCounts = {};
    cannotAccommodateDiets.forEach((diet) => {
      dietConflictCounts[diet] = 0;
    });

    dishInteractions.forEach((interaction) => {
      const userAllergens = (interaction.user_allergens || [])
        .map(normalizeAllergen)
        .filter(Boolean);
      const userDiets = (interaction.user_diets || []).map(normalizeDietLabel).filter(Boolean);

      userAllergens.forEach((allergen) => {
        if (Object.prototype.hasOwnProperty.call(allergenConflictCounts, allergen)) {
          allergenConflictCounts[allergen] += 1;
        }
      });

      userDiets.forEach((diet) => {
        if (Object.prototype.hasOwnProperty.call(dietConflictCounts, diet)) {
          dietConflictCounts[diet] += 1;
        }
      });
    });

    const maxConflict = Math.max(
      1,
      ...Object.values(allergenConflictCounts),
      ...Object.values(dietConflictCounts),
    );

    return {
      dishName: activeDishName,
      canAccommodateAllergens,
      cannotAccommodateAllergens,
      cannotAccommodateDiets,
      requestsCount: accommodationRequests.filter(
        (request) => normalizeDishKey(request?.dish_name) === dishKey,
      ).length,
      views: {
        safe: viewsSafe,
        removable: viewsRemovable,
        unsafe: viewsUnsafe,
        total: viewsTotal,
      },
      unique: {
        safe: uniqueSafe,
        removable: uniqueRemovable,
        unsafe: uniqueUnsafe,
        total: uniqueSafe + uniqueRemovable + uniqueUnsafe,
      },
      loves: {
        safe: lovesSafe,
        removable: lovesRemovable,
        unsafe: lovesUnsafe,
        total: lovesTotal,
      },
      ordersTotal,
      averages: {
        views: averageViews,
        safe: averageSafe,
        removable: averageRemovable,
        unsafe: averageUnsafe,
        total: averageTotal,
      },
      allergenConflictCounts,
      dietConflictCounts,
      maxConflict,
    };
  }, [
    DIETS,
    accommodationRequests,
    activeDishName,
    allOverlays,
    dishOrders,
    normalizeAllergen,
    normalizeDietLabel,
    rawInteractions,
    rawLoves,
    userProfilesById,
  ]);
}
