import { useEffect, useMemo } from "react";
import {
  computeDishStatusForUser,
  getOverlayDishName,
  normalizeDishKey,
} from "../utils/menuUtils";

// Computes all data required by the menu heatmap widget.
// Inputs are raw overlays/interactions/loves/orders/requests plus active metric/page selections.
export function useHeatmapMetrics({
  currentRestaurantData,
  heatmapMetric,
  heatmapPage,
  setHeatmapPage,
  rawInteractions,
  rawLoves,
  dishOrders,
  accommodationRequests,
  normalizeAllergen,
  normalizeDietLabel,
}) {
  const allOverlays = useMemo(
    () => (Array.isArray(currentRestaurantData?.overlays) ? currentRestaurantData.overlays : []),
    [currentRestaurantData?.overlays],
  );

  const menuImages = useMemo(() => {
    const list = Array.isArray(currentRestaurantData?.menu_images)
      ? [...currentRestaurantData.menu_images]
      : [];
    if (!list.length && currentRestaurantData?.menu_image) {
      list.push(currentRestaurantData.menu_image);
    }
    return list.filter(Boolean);
  }, [currentRestaurantData]);

  useEffect(() => {
    // Clamp page when image count shrinks (for example after restaurant switch).
    if (heatmapPage < menuImages.length) return;
    setHeatmapPage(0);
  }, [heatmapPage, menuImages.length, setHeatmapPage]);

  const pageOverlays = useMemo(() => {
    return allOverlays.filter((overlay) => {
      const page = overlay?.pageIndex ?? overlay?.page ?? 0;
      return page === heatmapPage;
    });
  }, [allOverlays, heatmapPage]);

  // Unique user profile map lets downstream computations reuse normalized restriction sets.
  const userProfilesById = useMemo(() => {
    const map = {};
    rawInteractions.forEach((interaction) => {
      const userId = interaction?.user_id;
      if (!userId || map[userId]) return;
      map[userId] = {
        allergens: (interaction.user_allergens || []).map(normalizeAllergen).filter(Boolean),
        diets: (interaction.user_diets || []).map(normalizeDietLabel).filter(Boolean),
      };
    });
    return map;
  }, [normalizeAllergen, normalizeDietLabel, rawInteractions]);

  const metricByDish = useMemo(() => {
    const metrics = {};

    if (heatmapMetric === "views") {
      rawInteractions.forEach((interaction) => {
        const key = normalizeDishKey(interaction?.dish_name);
        if (!key) return;
        metrics[key] = (metrics[key] || 0) + 1;
      });
      return metrics;
    }

    if (heatmapMetric === "loves") {
      rawLoves.forEach((love) => {
        const key = normalizeDishKey(love?.dish_name);
        if (!key) return;
        metrics[key] = (metrics[key] || 0) + 1;
      });
      return metrics;
    }

    if (heatmapMetric === "orders") {
      return { ...dishOrders };
    }

    if (heatmapMetric === "requests") {
      accommodationRequests.forEach((request) => {
        const key = normalizeDishKey(request?.dish_name);
        if (!key) return;
        metrics[key] = (metrics[key] || 0) + 1;
      });
      return metrics;
    }

    if (heatmapMetric === "accommodation") {
      // Build first overlay per dish for status classification calculations.
      const dishOverlayMap = {};
      allOverlays.forEach((overlay, index) => {
        const dishName = getOverlayDishName(overlay, index);
        const key = normalizeDishKey(dishName);
        if (key && !dishOverlayMap[key]) {
          dishOverlayMap[key] = overlay;
        }
      });

      const dishViewCounts = {};
      const dishAccommodated = {};

      rawInteractions.forEach((interaction) => {
        const key = normalizeDishKey(interaction?.dish_name);
        if (!key) return;

        const overlay = dishOverlayMap[key];
        if (!overlay) return;

        dishViewCounts[key] = (dishViewCounts[key] || 0) + 1;

        const status = computeDishStatusForUser(
          overlay,
          interaction?.user_allergens || [],
          interaction?.user_diets || [],
          normalizeAllergen,
          normalizeDietLabel,
        );

        if (status !== "unsafe") {
          dishAccommodated[key] = (dishAccommodated[key] || 0) + 1;
        }
      });

      Object.keys(dishViewCounts).forEach((key) => {
        const total = dishViewCounts[key];
        const accommodated = dishAccommodated[key] || 0;
        metrics[key] = total > 0 ? Math.round((accommodated / total) * 100) : 0;
      });

      return metrics;
    }

    return metrics;
  }, [
    accommodationRequests,
    allOverlays,
    dishOrders,
    heatmapMetric,
    normalizeAllergen,
    normalizeDietLabel,
    rawInteractions,
    rawLoves,
  ]);

  const metricBounds = useMemo(() => {
    const values = Object.values(metricByDish);
    return {
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 1,
    };
  }, [metricByDish]);

  const heatmapMetricLabel = useMemo(() => {
    switch (heatmapMetric) {
      case "views":
        return "views";
      case "loves":
        return "loves";
      case "orders":
        return "orders";
      case "requests":
        return "requests";
      case "accommodation":
        return "% accommodated";
      default:
        return "views";
    }
  }, [heatmapMetric]);

  return {
    allOverlays,
    menuImages,
    pageOverlays,
    userProfilesById,
    metricByDish,
    metricBounds,
    heatmapMetricLabel,
  };
}
