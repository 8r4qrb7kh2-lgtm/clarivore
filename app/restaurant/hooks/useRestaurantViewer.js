"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createCompatibilityEngine } from "../features/shared/compatibility";

function normalizeOverlay(overlay, index) {
  const dishName =
    String(overlay?.id || overlay?.name || overlay?.title || `Dish ${index + 1}`).trim() ||
    `Dish ${index + 1}`;

  const pageIndex = Number.isFinite(Number(overlay?.pageIndex))
    ? Number(overlay.pageIndex)
    : 0;

  return {
    ...overlay,
    id: dishName,
    name: dishName,
    pageIndex: Math.max(0, pageIndex),
    x: Number(overlay?.x || 0),
    y: Number(overlay?.y || 0),
    w: Number(overlay?.w || 0),
    h: Number(overlay?.h || 0),
  };
}

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeImageList(restaurant) {
  if (Array.isArray(restaurant?.menu_images) && restaurant.menu_images.length) {
    return restaurant.menu_images.filter(Boolean);
  }
  if (restaurant?.menu_image) return [restaurant.menu_image];
  return [];
}

function asText(value) {
  return String(value || "").trim();
}

export function useRestaurantViewer({
  restaurant,
  overlays,
  preferences,
  mode,
  callbacks,
  initialDishName = "",
}) {
  const [selectedDishId, setSelectedDishId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [initialDishResolved, setInitialDishResolved] = useState(false);

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

  const menuImages = useMemo(() => normalizeImageList(restaurant), [restaurant]);
  const pageCount = menuImages.length || 1;

  useEffect(() => {
    setCurrentPageIndex((previous) => clamp(previous, 0, pageCount - 1));
  }, [pageCount]);

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

  useEffect(() => {
    setInitialDishResolved(false);
  }, [initialDishName]);

  useEffect(() => {
    if (!initialDishName || initialDishResolved || !overlaysWithStatus.length) {
      return;
    }
    const normalized = asText(initialDishName).toLowerCase();
    if (!normalized) {
      setInitialDishResolved(true);
      return;
    }

    const match = overlaysWithStatus.find((overlay) => {
      const name = asText(overlay?.name || overlay?.id).toLowerCase();
      return name === normalized;
    });

    if (match) {
      setSelectedDishId(match.id);
      setCurrentPageIndex(clamp(match.pageIndex || 0, 0, pageCount - 1));
    }
    setInitialDishResolved(true);
  }, [initialDishName, initialDishResolved, overlaysWithStatus, pageCount]);

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

  const currentPageOverlays = useMemo(
    () =>
      filteredOverlays.filter((overlay) => {
        const pageIndex = Number.isFinite(Number(overlay.pageIndex))
          ? Number(overlay.pageIndex)
          : 0;
        return pageIndex === currentPageIndex;
      }),
    [currentPageIndex, filteredOverlays],
  );

  const selectedDish = useMemo(() => {
    if (!selectedDishId) return currentPageOverlays[0] || null;
    return (
      currentPageOverlays.find((overlay) => overlay.id === selectedDishId) ||
      null
    );
  }, [currentPageOverlays, selectedDishId]);

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

  const selectDish = useCallback((dishId, pageIndex = currentPageIndex) => {
    setSelectedDishId(String(dishId || ""));
    setCurrentPageIndex(clamp(Number(pageIndex) || 0, 0, pageCount - 1));
  }, [currentPageIndex, pageCount]);

  const setPageIndex = useCallback((nextPageIndex) => {
    setCurrentPageIndex(clamp(Number(nextPageIndex) || 0, 0, pageCount - 1));
    setSelectedDishId("");
  }, [pageCount]);

  const nextPage = useCallback(() => {
    setCurrentPageIndex((current) => clamp(current + 1, 0, pageCount - 1));
    setSelectedDishId("");
  }, [pageCount]);

  const previousPage = useCallback(() => {
    setCurrentPageIndex((current) => clamp(current - 1, 0, pageCount - 1));
    setSelectedDishId("");
  }, [pageCount]);

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

  const savedAllergens = useMemo(
    () =>
      (preferences?.allergies || []).map((value) => ({
        key: value,
        label: preferences?.formatAllergenLabel
          ? preferences.formatAllergenLabel(value)
          : asText(value),
        emoji: preferences?.getAllergenEmoji
          ? preferences.getAllergenEmoji(value)
          : "",
      })),
    [
      preferences?.allergies,
      preferences?.formatAllergenLabel,
      preferences?.getAllergenEmoji,
    ],
  );

  const savedDiets = useMemo(
    () =>
      (preferences?.diets || []).map((value) => ({
        key: value,
        label: preferences?.formatDietLabel
          ? preferences.formatDietLabel(value)
          : asText(value),
        emoji: preferences?.getDietEmoji ? preferences.getDietEmoji(value) : "",
      })),
    [preferences?.diets, preferences?.formatDietLabel, preferences?.getDietEmoji],
  );

  return {
    mode,
    query,
    setQuery,
    statusFilter,
    setStatusFilter,
    overlays: overlaysWithStatus,
    filteredOverlays,
    currentPageOverlays,
    selectedDish,
    selectedDishId,
    selectDish,
    statusCounts,
    addDishToOrder,
    toggleFavoriteDish,
    menuImages,
    currentPageIndex,
    pageCount,
    currentPageImage: menuImages[currentPageIndex] || menuImages[0] || "",
    setPageIndex,
    nextPage,
    previousPage,
    savedAllergens,
    savedDiets,
  };
}

export default useRestaurantViewer;
