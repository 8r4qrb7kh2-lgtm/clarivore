"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

function sanitizeOverlay(overlay, fallbackName = "New dish") {
  const name =
    String(overlay?.id || overlay?.name || fallbackName).trim() || fallbackName;

  return {
    ...overlay,
    id: name,
    name,
    description: String(overlay?.description || ""),
    x: Number(overlay?.x || 0),
    y: Number(overlay?.y || 0),
    w: Number(overlay?.w || 0),
    h: Number(overlay?.h || 0),
    allergens: Array.isArray(overlay?.allergens)
      ? overlay.allergens.filter(Boolean)
      : [],
    diets: Array.isArray(overlay?.diets) ? overlay.diets.filter(Boolean) : [],
    removable: Array.isArray(overlay?.removable)
      ? overlay.removable.filter(Boolean)
      : [],
  };
}

function createNewOverlay(index) {
  return {
    id: `Dish ${index + 1}`,
    name: `Dish ${index + 1}`,
    description: "",
    x: 8,
    y: Math.max(4, (index * 6) % 80),
    w: 84,
    h: 8,
    allergens: [],
    diets: [],
    removable: [],
    details: {},
    ingredients: [],
  };
}

export function useRestaurantEditor({
  restaurant,
  overlays,
  permissions,
  callbacks,
}) {
  const [draftOverlays, setDraftOverlays] = useState([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const canEdit = Boolean(permissions?.canEdit);

  useEffect(() => {
    const nextOverlays = Array.isArray(overlays)
      ? overlays
      : Array.isArray(restaurant?.overlays)
        ? restaurant.overlays
        : [];

    const sanitized = nextOverlays.map((overlay, index) =>
      sanitizeOverlay(overlay, `Dish ${index + 1}`),
    );

    setDraftOverlays(sanitized);
    setSelectedOverlayId((current) => current || sanitized[0]?.id || "");
    setSaveError("");
  }, [overlays, restaurant?.id, restaurant?.overlays]);

  const selectedOverlay = useMemo(() => {
    if (!selectedOverlayId) return draftOverlays[0] || null;
    return draftOverlays.find((overlay) => overlay.id === selectedOverlayId) || null;
  }, [draftOverlays, selectedOverlayId]);

  const originalSerialized = useMemo(() => {
    const original = Array.isArray(overlays)
      ? overlays
      : Array.isArray(restaurant?.overlays)
        ? restaurant.overlays
        : [];

    return JSON.stringify(original || []);
  }, [overlays, restaurant?.overlays]);

  const draftSerialized = useMemo(() => JSON.stringify(draftOverlays || []), [draftOverlays]);
  const isDirty = draftSerialized !== originalSerialized;

  const updateOverlay = useCallback((overlayId, patch) => {
    setDraftOverlays((current) =>
      current.map((overlay) => {
        if (overlay.id !== overlayId) return overlay;

        const nextOverlay = {
          ...overlay,
          ...patch,
        };

        const nextName = String(nextOverlay.name || nextOverlay.id || "").trim();
        if (nextName) {
          nextOverlay.id = nextName;
          nextOverlay.name = nextName;
        }

        return sanitizeOverlay(nextOverlay, overlay.id || "Dish");
      }),
    );
  }, []);

  const addOverlay = useCallback(() => {
    setDraftOverlays((current) => {
      const next = [...current, createNewOverlay(current.length)];
      setSelectedOverlayId(next[next.length - 1]?.id || "");
      return next;
    });
  }, []);

  const removeOverlay = useCallback((overlayId) => {
    setDraftOverlays((current) => {
      const next = current.filter((overlay) => overlay.id !== overlayId);
      if (!next.length) {
        setSelectedOverlayId("");
        return [];
      }

      setSelectedOverlayId((existing) => {
        if (existing && next.some((overlay) => overlay.id === existing)) {
          return existing;
        }
        return next[0].id;
      });

      return next;
    });
  }, []);

  const save = useCallback(async () => {
    if (!canEdit || !restaurant?.id) {
      setSaveError("You do not have permission to edit this restaurant.");
      return { success: false };
    }

    setSaveError("");
    setIsSaving(true);

    try {
      await callbacks?.onSave?.(draftOverlays);
      return { success: true };
    } catch (error) {
      const message =
        error?.message ||
        "Failed to save menu overlays. Please try again.";
      setSaveError(message);
      return { success: false, error };
    } finally {
      setIsSaving(false);
    }
  }, [callbacks, canEdit, draftOverlays, restaurant?.id]);

  return {
    canEdit,
    draftOverlays,
    selectedOverlay,
    selectedOverlayId,
    setSelectedOverlayId,
    updateOverlay,
    addOverlay,
    removeOverlay,
    isDirty,
    isSaving,
    saveError,
    save,
  };
}

export default useRestaurantEditor;
