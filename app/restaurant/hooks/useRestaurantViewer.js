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

function asText(value) {
  return String(value || "").trim();
}

function normalizeImageList(restaurant, overlays) {
  const explicit = Array.isArray(restaurant?.menuImages)
    ? restaurant.menuImages.filter(Boolean)
    : [];

  if (!explicit.length && restaurant?.menuImage) {
    explicit.push(restaurant.menuImage);
  }

  const maxOverlayPage = overlays.reduce((max, overlay) => {
    const pageIndex = Number.isFinite(Number(overlay?.pageIndex))
      ? Number(overlay.pageIndex)
      : 0;
    return Math.max(max, pageIndex);
  }, 0);

  const requiredLength = Math.max(explicit.length, maxOverlayPage + 1, 1);
  const fallbackImage = explicit[0] || restaurant?.menuImage || "";
  const out = [...explicit];

  while (out.length < requiredLength) {
    out.push(fallbackImage);
  }

  return out;
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

  const normalizedOverlays = useMemo(() => {
    const list = Array.isArray(overlays)
      ? overlays
      : Array.isArray(restaurant?.overlays)
        ? restaurant.overlays
        : [];

    return list.map((overlay, index) => normalizeOverlay(overlay, index));
  }, [overlays, restaurant?.overlays]);

  const menuImages = useMemo(
    () => normalizeImageList(restaurant, normalizedOverlays),
    [normalizedOverlays, restaurant],
  );
  const pageCount = menuImages.length;

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
    }
    setInitialDishResolved(true);
  }, [initialDishName, initialDishResolved, overlaysWithStatus]);

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

  const menuPages = useMemo(
    () =>
      menuImages.map((image, pageIndex) => ({
        pageIndex,
        image,
        overlays: filteredOverlays.filter((overlay) => {
          const overlayPage = Number.isFinite(Number(overlay.pageIndex))
            ? Number(overlay.pageIndex)
            : 0;
          return overlayPage === pageIndex;
        }),
      })),
    [filteredOverlays, menuImages],
  );

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
    menuPages,
    selectedDish,
    selectedDishId,
    selectDish,
    statusCounts,
    addDishToOrder,
    toggleFavoriteDish,
    pageCount,
    menuImages,
    savedAllergens,
    savedDiets,
  };
}

export default useRestaurantViewer;
