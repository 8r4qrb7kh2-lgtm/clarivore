"use client";

import { useCallback, useMemo, useState } from "react";
import { createCompatibilityEngine } from "../features/shared/compatibility";

function normalizeOverlay(overlay, index) {
  const dishName =
    String(overlay?.id || overlay?.name || overlay?.title || `Dish ${index + 1}`).trim() ||
    `Dish ${index + 1}`;

  return {
    ...overlay,
    id: dishName,
    name: dishName,
    x: Number(overlay?.x || 0),
    y: Number(overlay?.y || 0),
    w: Number(overlay?.w || 0),
    h: Number(overlay?.h || 0),
  };
}

export function useRestaurantViewer({
  restaurant,
  overlays,
  preferences,
  mode,
  callbacks,
}) {
  const [selectedDishId, setSelectedDishId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const engine = useMemo(
    () =>
      createCompatibilityEngine({
        normalizeAllergen: preferences?.normalizeAllergen,
        normalizeDietLabel: preferences?.normalizeDietLabel,
        getDietAllergenConflicts: preferences?.getDietAllergenConflicts,
      }),
    [
      preferences?.getDietAllergenConflicts,
      preferences?.normalizeAllergen,
      preferences?.normalizeDietLabel,
    ],
  );

  const normalizedOverlays = useMemo(() => {
    const list = Array.isArray(overlays)
      ? overlays
      : Array.isArray(restaurant?.overlays)
        ? restaurant.overlays
        : [];

    return list.map((overlay, index) => normalizeOverlay(overlay, index));
  }, [overlays, restaurant?.overlays]);

  const overlaysWithStatus = useMemo(() => {
    return normalizedOverlays.map((overlay) => {
      const status = engine.computeStatus(
        overlay,
        preferences?.allergies || [],
        preferences?.diets || [],
      );
      const hasCrossContamination = engine.hasCrossContamination(
        overlay,
        preferences?.allergies || [],
        preferences?.diets || [],
      );

      return {
        ...overlay,
        compatibilityStatus: status,
        hasCrossContamination,
      };
    });
  }, [
    engine,
    normalizedOverlays,
    preferences?.allergies,
    preferences?.diets,
  ]);

  const filteredOverlays = useMemo(() => {
    const normalizedQuery = String(query || "").toLowerCase().trim();

    return overlaysWithStatus.filter((overlay) => {
      if (
        statusFilter !== "all" &&
        overlay.compatibilityStatus !== statusFilter
      ) {
        return false;
      }

      if (!normalizedQuery) return true;

      const haystack = `${overlay.name} ${overlay.description || ""} ${overlay.id || ""}`
        .toLowerCase()
        .trim();
      return haystack.includes(normalizedQuery);
    });
  }, [overlaysWithStatus, query, statusFilter]);

  const selectedDish = useMemo(() => {
    if (!selectedDishId) return filteredOverlays[0] || overlaysWithStatus[0] || null;
    return (
      overlaysWithStatus.find((overlay) => overlay.id === selectedDishId) ||
      null
    );
  }, [filteredOverlays, overlaysWithStatus, selectedDishId]);

  const statusCounts = useMemo(() => {
    return overlaysWithStatus.reduce(
      (acc, overlay) => {
        const key = overlay.compatibilityStatus || "neutral";
        if (!Object.prototype.hasOwnProperty.call(acc, key)) {
          acc[key] = 0;
        }
        acc[key] += 1;
        return acc;
      },
      { all: overlaysWithStatus.length, safe: 0, removable: 0, unsafe: 0, neutral: 0 },
    );
  }, [overlaysWithStatus]);

  const selectDish = useCallback((dishId) => {
    setSelectedDishId(String(dishId || ""));
  }, []);

  const addDishToOrder = useCallback(
    (dish) => {
      if (!dish) return;
      callbacks?.onAddDishToOrder?.(dish);
    },
    [callbacks],
  );

  const toggleFavoriteDish = useCallback(
    (dish) => {
      if (!dish) return;
      callbacks?.onToggleFavoriteDish?.(dish);
    },
    [callbacks],
  );

  return {
    mode,
    query,
    setQuery,
    statusFilter,
    setStatusFilter,
    overlays: overlaysWithStatus,
    filteredOverlays,
    selectedDish,
    selectedDishId,
    selectDish,
    statusCounts,
    addDishToOrder,
    toggleFavoriteDish,
  };
}

export default useRestaurantViewer;
