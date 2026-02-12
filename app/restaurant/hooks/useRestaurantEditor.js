"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const HISTORY_LIMIT = 50;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function asText(value) {
  return String(value || "").trim();
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeRectValue(value, fallback = 0) {
  return clamp(normalizeNumber(value, fallback), 0, 100);
}

function resolveOverlayScale(overlays) {
  const values = [];

  (Array.isArray(overlays) ? overlays : []).forEach((overlay) => {
    const candidates = [
      overlay?.x,
      overlay?.y,
      overlay?.w,
      overlay?.h,
      overlay?.left,
      overlay?.top,
      overlay?.width,
      overlay?.height,
    ];

    candidates.forEach((value) => {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) values.push(Math.abs(parsed));
    });
  });

  if (!values.length) return "percent";
  const maxCoord = Math.max(...values);
  if (maxCoord > 0 && maxCoord <= 1.2) return "ratio";
  if (maxCoord > 150 && maxCoord <= 1200) return "thousand";
  return "percent";
}

function resolvePageOffset(overlays, pageCount) {
  const values = (Array.isArray(overlays) ? overlays : [])
    .map((overlay) =>
      firstFiniteNumber(
        overlay?.pageIndex,
        overlay?.page,
        overlay?.pageNumber,
        overlay?.page_number,
      ),
    )
    .filter((value) => Number.isFinite(value));

  if (!values.length) return 0;
  const minPage = Math.min(...values);
  const maxPage = Math.max(...values);
  const hasZero = values.some((value) => value === 0);

  // Legacy exports occasionally store page numbers as 1-based.
  if (!hasZero && minPage >= 1 && pageCount > 0 && maxPage <= pageCount) {
    return 1;
  }
  return 0;
}

function buildOverlayNormalizationContext(overlays, pageCount) {
  return {
    scale: resolveOverlayScale(overlays),
    pageOffset: resolvePageOffset(overlays, pageCount),
  };
}

function normalizeOverlay(overlay, index, fallbackKey, context = {}) {
  const fallbackName = `Dish ${index + 1}`;
  const rawName = asText(overlay?.id || overlay?.name || fallbackName);
  const name = rawName || fallbackName;

  const scale =
    context?.scale === "ratio"
      ? 100
      : context?.scale === "thousand"
        ? 0.1
        : 1;

  const rawPage = firstFiniteNumber(
    overlay?.pageIndex,
    overlay?.page,
    overlay?.pageNumber,
    overlay?.page_number,
  );
  const pageOffset = Number(context?.pageOffset) || 0;
  const pageIndex = Number.isFinite(rawPage)
    ? Math.max(0, Math.floor(rawPage - pageOffset))
    : 0;

  const rawX = firstFiniteNumber(overlay?.x, overlay?.left);
  const rawY = firstFiniteNumber(overlay?.y, overlay?.top);
  const rawW = firstFiniteNumber(overlay?.w, overlay?.width);
  const rawH = firstFiniteNumber(overlay?.h, overlay?.height);

  return {
    ...overlay,
    _editorKey:
      asText(overlay?._editorKey) || fallbackKey || `ov-${Date.now()}-${index}`,
    id: name,
    name,
    description: asText(overlay?.description),
    x: normalizeRectValue(Number.isFinite(rawX) ? rawX * scale : 8, 8),
    y: normalizeRectValue(Number.isFinite(rawY) ? rawY * scale : 8, 8),
    w: clamp(normalizeRectValue(Number.isFinite(rawW) ? rawW * scale : 20, 20), 0.5, 100),
    h: clamp(normalizeRectValue(Number.isFinite(rawH) ? rawH * scale : 8, 8), 0.5, 100),
    pageIndex,
    allergens: Array.isArray(overlay?.allergens) ? overlay.allergens.filter(Boolean) : [],
    diets: Array.isArray(overlay?.diets) ? overlay.diets.filter(Boolean) : [],
    removable: Array.isArray(overlay?.removable) ? overlay.removable.filter(Boolean) : [],
    crossContaminationAllergens: Array.isArray(overlay?.crossContaminationAllergens)
      ? overlay.crossContaminationAllergens.filter(Boolean)
      : [],
    crossContaminationDiets: Array.isArray(overlay?.crossContaminationDiets)
      ? overlay.crossContaminationDiets.filter(Boolean)
      : [],
    details: overlay?.details && typeof overlay.details === "object" ? overlay.details : {},
    ingredients: Array.isArray(overlay?.ingredients) ? overlay.ingredients : [],
    ingredientsBlockingDiets:
      overlay?.ingredientsBlockingDiets &&
      typeof overlay.ingredientsBlockingDiets === "object"
        ? overlay.ingredientsBlockingDiets
        : {},
  };
}

function ensureOverlayVisibility(overlay, pageCount = 1) {
  const maxPageIndex = Math.max(Number(pageCount) - 1, 0);
  const next = { ...overlay };

  const pageIndex = Number.isFinite(Number(next.pageIndex))
    ? Number(next.pageIndex)
    : 0;
  next.pageIndex = clamp(Math.floor(pageIndex), 0, maxPageIndex);

  let x = normalizeRectValue(next.x, 8);
  let y = normalizeRectValue(next.y, 8);
  let w = clamp(normalizeRectValue(next.w, 20), 0.5, 100);
  let h = clamp(normalizeRectValue(next.h, 8), 0.5, 100);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
    x = 8;
    y = 8;
    w = 20;
    h = 8;
  }

  if (x + w <= 0.5 || y + h <= 0.5 || x >= 99.5 || y >= 99.5) {
    x = 8;
    y = 8;
    w = Math.max(w, 20);
    h = Math.max(h, 8);
  }

  w = clamp(w, 0.5, 100);
  h = clamp(h, 0.5, 100);
  x = clamp(x, 0, 100 - w);
  y = clamp(y, 0, 100 - h);

  next.x = x;
  next.y = y;
  next.w = w;
  next.h = h;

  return next;
}

function buildMenuImages(restaurant) {
  const explicit = Array.isArray(restaurant?.menu_images)
    ? restaurant.menu_images.filter(Boolean)
    : Array.isArray(restaurant?.menuImages)
      ? restaurant.menuImages.filter(Boolean)
      : [];

  if (!explicit.length && restaurant?.menu_image) {
    explicit.push(restaurant.menu_image);
  }
  if (!explicit.length && restaurant?.menuImage) {
    explicit.push(restaurant.menuImage);
  }

  if (!explicit.length) {
    explicit.push("");
  }

  return explicit;
}

function stripEditorOverlay(overlay) {
  const next = { ...overlay };
  delete next._editorKey;

  const name = asText(next.name || next.id || "Dish");
  next.id = name;
  next.name = name;
  next.pageIndex = Math.max(0, Math.floor(normalizeNumber(next.pageIndex, 0)));
  next.x = normalizeRectValue(next.x, 0);
  next.y = normalizeRectValue(next.y, 0);
  next.w = clamp(normalizeRectValue(next.w, 1), 0.5, 100);
  next.h = clamp(normalizeRectValue(next.h, 1), 0.5, 100);

  return next;
}

function serializeEditorState(overlays, menuImages) {
  return JSON.stringify({
    overlays: (Array.isArray(overlays) ? overlays : []).map(stripEditorOverlay),
    menuImages: Array.isArray(menuImages) ? menuImages.filter(Boolean) : [],
  });
}

function createEmptySettingsDraft(restaurant) {
  return {
    website: asText(restaurant?.website),
    phone: asText(restaurant?.phone),
    delivery_url: asText(restaurant?.delivery_url),
    menu_url: asText(restaurant?.menu_url),
  };
}

function serializeSettingsDraft(value) {
  return JSON.stringify({
    website: asText(value?.website),
    phone: asText(value?.phone),
    delivery_url: asText(value?.delivery_url),
    menu_url: asText(value?.menu_url),
  });
}

function parseChangeLogPayload(log) {
  const raw = log?.changes;
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildDefaultChangeLogPayload({ author, pendingChanges, snapshot }) {
  const grouped = {};
  const general = [];
  (Array.isArray(pendingChanges) ? pendingChanges : []).forEach((line) => {
    const text = asText(line);
    if (!text) return;
    const splitIndex = text.indexOf(":");
    if (splitIndex > 0) {
      const itemName = asText(text.slice(0, splitIndex));
      const entry = asText(text.slice(splitIndex + 1));
      if (!itemName) {
        general.push(text);
        return;
      }
      if (!grouped[itemName]) grouped[itemName] = [];
      if (entry) grouped[itemName].push(entry);
      return;
    }
    general.push(text);
  });

  if (!general.length && !Object.keys(grouped).length) {
    general.push("Menu overlays updated");
  }

  return {
    author: author || "Manager",
    general,
    items: grouped,
    snapshot,
  };
}

function computeDietBlockers(ingredients, diets) {
  const rows = Array.isArray(ingredients) ? ingredients : [];
  const dietList = Array.isArray(diets) ? diets : [];
  const output = {};

  dietList.forEach((diet) => {
    const blockers = rows
      .filter((ingredient) => {
        if (!Array.isArray(ingredient?.diets)) return true;
        return !ingredient.diets.includes(diet);
      })
      .map((ingredient) => ({
        ingredient: ingredient?.name || "Ingredient",
        removable: Boolean(ingredient?.removable),
      }));

    if (blockers.length) {
      output[diet] = blockers;
    }
  });

  return output;
}

async function toDataUrlFromImage(source) {
  const text = asText(source);
  if (!text) return "";
  if (text.startsWith("data:")) return text;

  try {
    const response = await fetch(text);
    if (!response.ok) return "";
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image blob"));
      reader.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
}

function matchOverlayByDishName(overlays, dishName) {
  const target = asText(dishName).toLowerCase();
  if (!target) return null;
  return (
    (Array.isArray(overlays) ? overlays : []).find((overlay) => {
      const id = asText(overlay?.id || overlay?.name).toLowerCase();
      if (!id) return false;
      if (id === target) return true;
      const normalizedId = id.replace(/[^a-z0-9]/g, "");
      const normalizedTarget = target.replace(/[^a-z0-9]/g, "");
      return normalizedId && normalizedTarget && normalizedId === normalizedTarget;
    }) || null
  );
}

export function useRestaurantEditor({
  restaurant,
  overlays,
  permissions,
  config,
  previewPreferences,
  params,
  callbacks,
}) {
  const canEdit = Boolean(permissions?.canEdit);

  const [draftOverlays, setDraftOverlays] = useState([]);
  const [draftMenuImages, setDraftMenuImages] = useState([""]);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [zoomScale, setZoomScale] = useState(1);
  const [selectedOverlayKey, setSelectedOverlayKey] = useState("");
  const [pendingChanges, setPendingChanges] = useState([]);

  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle");

  const [dishEditorOpen, setDishEditorOpen] = useState(false);
  const [dishAiAssistOpen, setDishAiAssistOpen] = useState(false);
  const [changeLogOpen, setChangeLogOpen] = useState(false);
  const [confirmInfoOpen, setConfirmInfoOpen] = useState(false);
  const [menuPagesOpen, setMenuPagesOpen] = useState(false);
  const [restaurantSettingsOpen, setRestaurantSettingsOpen] = useState(false);
  const [detectWizardOpen, setDetectWizardOpen] = useState(false);

  const [changeLogs, setChangeLogs] = useState([]);
  const [loadingChangeLogs, setLoadingChangeLogs] = useState(false);
  const [changeLogError, setChangeLogError] = useState("");

  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState("");

  const [restaurantSettingsDraft, setRestaurantSettingsDraft] = useState(
    createEmptySettingsDraft(restaurant),
  );
  const [settingsSaveBusy, setSettingsSaveBusy] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState("");

  const [detectWizardState, setDetectWizardState] = useState({
    loading: false,
    dishes: [],
    currentIndex: 0,
    error: "",
  });
  const [initialDishResolved, setInitialDishResolved] = useState(false);

  const [aiAssistDraft, setAiAssistDraft] = useState({
    text: "",
    imageData: "",
    loading: false,
    error: "",
    result: null,
  });

  const baselineRef = useRef("");
  const settingsBaselineRef = useRef("");
  const historyRef = useRef([]);
  const saveStatusTimerRef = useRef(0);
  const [historyIndex, setHistoryIndex] = useState(0);

  const overlaysRef = useRef(draftOverlays);
  const menuImagesRef = useRef(draftMenuImages);
  const pendingChangesRef = useRef(pendingChanges);

  useEffect(() => {
    overlaysRef.current = draftOverlays;
  }, [draftOverlays]);

  useEffect(() => {
    menuImagesRef.current = draftMenuImages;
  }, [draftMenuImages]);

  useEffect(() => {
    pendingChangesRef.current = pendingChanges;
  }, [pendingChanges]);

  const clearSaveStatusTimer = useCallback(() => {
    if (saveStatusTimerRef.current) {
      window.clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = 0;
    }
  }, []);

  useEffect(() => {
    return () => clearSaveStatusTimer();
  }, [clearSaveStatusTimer]);

  const appendPendingChange = useCallback((line) => {
    const text = asText(line);
    if (!text) return;
    setPendingChanges((current) => [...current, text]);
  }, []);

  const captureSnapshot = useCallback(() => {
    return {
      overlays: JSON.parse(JSON.stringify(overlaysRef.current || [])),
      menuImages: JSON.parse(JSON.stringify(menuImagesRef.current || [])),
      pendingChanges: [...(pendingChangesRef.current || [])],
    };
  }, []);

  const pushHistory = useCallback(() => {
    const snapshot = captureSnapshot();
    const serialized = serializeEditorState(snapshot.overlays, snapshot.menuImages);

    const currentList = historyRef.current.slice(0, historyIndex + 1);
    const last = currentList[currentList.length - 1];
    if (last && serializeEditorState(last.overlays, last.menuImages) === serialized) {
      return;
    }

    currentList.push(snapshot);
    while (currentList.length > HISTORY_LIMIT) {
      currentList.shift();
    }

    historyRef.current = currentList;
    setHistoryIndex(currentList.length - 1);
  }, [captureSnapshot, historyIndex]);

  const restoreHistorySnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    const images = Array.isArray(snapshot.menuImages) && snapshot.menuImages.length
      ? snapshot.menuImages
      : [""];
    const context = buildOverlayNormalizationContext(snapshot.overlays, images.length);
    const overlaysList = Array.isArray(snapshot.overlays)
      ? snapshot.overlays.map((overlay, index) =>
          ensureOverlayVisibility(
            normalizeOverlay(
              overlay,
              index,
              overlay?._editorKey || `ov-${Date.now()}-${index}`,
              context,
            ),
            images.length,
          ),
        )
      : [];

    setDraftOverlays(overlaysList);
    setDraftMenuImages(images);
    setPendingChanges(Array.isArray(snapshot.pendingChanges) ? snapshot.pendingChanges : []);
    setSelectedOverlayKey((current) => {
      if (current && overlaysList.some((overlay) => overlay._editorKey === current)) {
        return current;
      }
      return overlaysList[0]?._editorKey || "";
    });
    setActivePageIndex((current) =>
      clamp(current, 0, Math.max(images.length - 1, 0)),
    );
  }, []);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    const snapshot = historyRef.current[nextIndex];
    if (!snapshot) return;
    restoreHistorySnapshot(snapshot);
    setHistoryIndex(nextIndex);
  }, [historyIndex, restoreHistorySnapshot]);

  const redo = useCallback(() => {
    if (historyIndex >= historyRef.current.length - 1) return;
    const nextIndex = historyIndex + 1;
    const snapshot = historyRef.current[nextIndex];
    if (!snapshot) return;
    restoreHistorySnapshot(snapshot);
    setHistoryIndex(nextIndex);
  }, [historyIndex, restoreHistorySnapshot]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historyRef.current.length - 1;

  useEffect(() => {
    const nextOverlaysRaw = Array.isArray(overlays)
      ? overlays
      : Array.isArray(restaurant?.overlays)
        ? restaurant.overlays
        : [];

    const nextMenuImages = buildMenuImages(restaurant);
    const context = buildOverlayNormalizationContext(nextOverlaysRaw, nextMenuImages.length);
    const nextOverlays = nextOverlaysRaw.map((overlay, index) =>
      ensureOverlayVisibility(
        normalizeOverlay(
          overlay,
          index,
          overlay?._editorKey || `ov-${Date.now()}-${index}`,
          context,
        ),
        nextMenuImages.length,
      ),
    );

    const nextBaseline = serializeEditorState(nextOverlays, nextMenuImages);
    baselineRef.current = nextBaseline;

    const settingsDraft = createEmptySettingsDraft(restaurant);
    settingsBaselineRef.current = serializeSettingsDraft(settingsDraft);

    setDraftOverlays(nextOverlays);
    setDraftMenuImages(nextMenuImages);
    setActivePageIndex(0);
    setZoomScale(1);
    setSelectedOverlayKey(nextOverlays[0]?._editorKey || "");
    setPendingChanges([]);
    setSaveError("");
    setIsSaving(false);
    clearSaveStatusTimer();
    setSaveStatus("idle");

    setRestaurantSettingsDraft(settingsDraft);
    setSettingsSaveError("");

    const firstSnapshot = {
      overlays: JSON.parse(JSON.stringify(nextOverlays)),
      menuImages: [...nextMenuImages],
      pendingChanges: [],
    };
    historyRef.current = [firstSnapshot];
    setHistoryIndex(0);

    setDishEditorOpen(false);
    setDishAiAssistOpen(false);
    setChangeLogOpen(Boolean(params?.openLog));
    setConfirmInfoOpen(Boolean(params?.openConfirm));
    setMenuPagesOpen(false);
    setRestaurantSettingsOpen(false);
    setDetectWizardOpen(false);
    setDetectWizardState({
      loading: false,
      dishes: [],
      currentIndex: 0,
      error: "",
    });
    setInitialDishResolved(false);

    setAiAssistDraft({
      text: "",
      imageData: "",
      loading: false,
      error: "",
      result: null,
    });
  }, [
    clearSaveStatusTimer,
    overlays,
    restaurant?.id,
    restaurant?.overlays,
    restaurant?.menu_images,
    restaurant?.menu_image,
    restaurant?.menuImages,
    restaurant?.menuImage,
    restaurant?.website,
    restaurant?.phone,
    restaurant?.delivery_url,
    restaurant?.menu_url,
    params?.openConfirm,
    params?.openLog,
  ]);

  const editorStateSerialized = useMemo(
    () => serializeEditorState(draftOverlays, draftMenuImages),
    [draftMenuImages, draftOverlays],
  );

  const isDirty = editorStateSerialized !== baselineRef.current;
  const settingsDirty =
    serializeSettingsDraft(restaurantSettingsDraft) !== settingsBaselineRef.current;

  useEffect(() => {
    if (!isDirty) return;
    if (saveStatus === "saving") return;
    if (saveStatus !== "idle") {
      clearSaveStatusTimer();
      setSaveStatus("idle");
    }
  }, [clearSaveStatusTimer, isDirty, saveStatus]);

  const selectedOverlay = useMemo(() => {
    if (!selectedOverlayKey) return draftOverlays[0] || null;
    return (
      draftOverlays.find((overlay) => overlay._editorKey === selectedOverlayKey) ||
      draftOverlays[0] ||
      null
    );
  }, [draftOverlays, selectedOverlayKey]);

  const selectedOverlayIndex = useMemo(() => {
    if (!selectedOverlay?._editorKey) return -1;
    return draftOverlays.findIndex(
      (overlay) => overlay._editorKey === selectedOverlay._editorKey,
    );
  }, [draftOverlays, selectedOverlay?._editorKey]);

  const selectedPageIndex = selectedOverlay
    ? clamp(
        Number.isFinite(Number(selectedOverlay.pageIndex))
          ? Number(selectedOverlay.pageIndex)
          : 0,
        0,
        Math.max(draftMenuImages.length - 1, 0),
      )
    : activePageIndex;

  const overlaysByPage = useMemo(() => {
    const pages = Array.from({ length: Math.max(draftMenuImages.length, 1) }, (_, index) => ({
      pageIndex: index,
      image: draftMenuImages[index] || "",
      overlays: [],
    }));

    draftOverlays.forEach((overlay) => {
      const page = clamp(
        Number.isFinite(Number(overlay.pageIndex)) ? Number(overlay.pageIndex) : 0,
        0,
        Math.max(pages.length - 1, 0),
      );
      pages[page].overlays.push(overlay);
    });

    return pages;
  }, [draftMenuImages, draftOverlays]);

  const applyOverlayList = useCallback((updater) => {
    setDraftOverlays((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      overlaysRef.current = next;
      return next;
    });
  }, []);

  const updateOverlay = useCallback((overlayKey, patch, options = {}) => {
    if (!overlayKey) return;

    applyOverlayList((current) =>
      current.map((overlay, index) => {
        if (overlay._editorKey !== overlayKey) return overlay;
        const next = ensureOverlayVisibility(
          normalizeOverlay(
            {
              ...overlay,
              ...(typeof patch === "function" ? patch(overlay) : patch),
            },
            index,
            overlay._editorKey,
          ),
          menuImagesRef.current.length,
        );

        // Keep within bounds after resize/drag edits.
        next.w = clamp(next.w, 0.5, 100);
        next.h = clamp(next.h, 0.5, 100);
        next.x = clamp(next.x, 0, 100 - next.w);
        next.y = clamp(next.y, 0, 100 - next.h);

        return next;
      }),
    );

    if (options?.changeText) {
      appendPendingChange(options.changeText);
    }

    if (options?.recordHistory) {
      queueMicrotask(() => pushHistory());
    }
  }, [appendPendingChange, applyOverlayList, pushHistory]);

  const addOverlay = useCallback(() => {
    const nextKey = `ov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    applyOverlayList((current) => {
      const nextIndex = current.length;
      const next = [
        ...current,
        ensureOverlayVisibility(
          normalizeOverlay(
            {
              _editorKey: nextKey,
              id: `Dish ${nextIndex + 1}`,
              name: `Dish ${nextIndex + 1}`,
              description: "",
              x: 10,
              y: 10,
              w: 22,
              h: 8,
              pageIndex: activePageIndex,
              allergens: [],
              diets: [],
              removable: [],
              crossContaminationAllergens: [],
              crossContaminationDiets: [],
              details: {},
              ingredients: [],
            },
            nextIndex,
            nextKey,
          ),
          menuImagesRef.current.length,
        ),
      ];
      return next;
    });

    setSelectedOverlayKey(nextKey);
    appendPendingChange(`Dish ${draftOverlays.length + 1}: Added overlay`);
    queueMicrotask(() => pushHistory());
  }, [
    activePageIndex,
    appendPendingChange,
    applyOverlayList,
    draftOverlays.length,
    pushHistory,
  ]);

  const removeOverlay = useCallback((overlayKey) => {
    const overlay = overlaysRef.current.find((item) => item._editorKey === overlayKey);
    const overlayName = asText(overlay?.id || overlay?.name || "Dish");

    applyOverlayList((current) => current.filter((item) => item._editorKey !== overlayKey));
    setSelectedOverlayKey((current) => {
      if (current !== overlayKey) return current;
      const fallback = overlaysRef.current.find((item) => item._editorKey !== overlayKey);
      return fallback?._editorKey || "";
    });

    appendPendingChange(`${overlayName}: Removed overlay`);
    queueMicrotask(() => pushHistory());
  }, [appendPendingChange, applyOverlayList, pushHistory]);

  const selectOverlay = useCallback((overlayKey) => {
    setSelectedOverlayKey(asText(overlayKey));
  }, []);

  const openDishEditor = useCallback((overlayKey) => {
    if (!overlayKey) return;
    setSelectedOverlayKey(overlayKey);
    setDishEditorOpen(true);
  }, []);

  const closeDishEditor = useCallback(() => {
    setDishEditorOpen(false);
    setDishAiAssistOpen(false);
    setAiAssistDraft((current) => ({
      ...current,
      loading: false,
      error: "",
    }));
  }, []);

  const updateSelectedOverlay = useCallback(
    (patch, options = {}) => {
      if (!selectedOverlay?._editorKey) return;
      updateOverlay(selectedOverlay._editorKey, patch, options);
    },
    [selectedOverlay?._editorKey, updateOverlay],
  );

  const toggleSelectedAllergen = useCallback((allergenKey) => {
    const key = asText(allergenKey);
    if (!key || !selectedOverlay?._editorKey) return;

    updateOverlay(selectedOverlay._editorKey, (overlay) => {
      const nextSet = new Set(overlay.allergens || []);
      if (nextSet.has(key)) {
        nextSet.delete(key);
      } else {
        nextSet.add(key);
      }

      const nextDetails = { ...(overlay.details || {}) };
      if (!nextSet.has(key)) {
        delete nextDetails[key];
      }

      const nextRemovable = (overlay.removable || []).filter(
        (item) => asText(item?.allergen) !== key,
      );

      const nextCross = (overlay.crossContaminationAllergens || []).filter(
        (item) => asText(item) !== key,
      );

      return {
        allergens: Array.from(nextSet),
        details: nextDetails,
        removable: nextRemovable,
        crossContaminationAllergens: nextSet.has(key)
          ? overlay.crossContaminationAllergens || []
          : nextCross,
      };
    });
  }, [selectedOverlay?._editorKey, updateOverlay]);

  const setSelectedAllergenDetail = useCallback((allergenKey, value) => {
    const key = asText(allergenKey);
    if (!key || !selectedOverlay?._editorKey) return;

    updateOverlay(selectedOverlay._editorKey, (overlay) => ({
      details: {
        ...(overlay.details || {}),
        [key]: asText(value),
      },
    }));
  }, [selectedOverlay?._editorKey, updateOverlay]);

  const setSelectedAllergenRemovable = useCallback((allergenKey, checked) => {
    const key = asText(allergenKey);
    if (!key || !selectedOverlay?._editorKey) return;

    updateOverlay(selectedOverlay._editorKey, (overlay) => {
      const existing = Array.isArray(overlay.removable) ? overlay.removable : [];
      const filtered = existing.filter((item) => asText(item?.allergen) !== key);
      if (checked) {
        filtered.push({
          allergen: key,
          component: asText((overlay.details || {})[key]) || key,
        });
      }
      return {
        removable: filtered,
      };
    });
  }, [selectedOverlay?._editorKey, updateOverlay]);

  const setSelectedAllergenCrossContamination = useCallback((allergenKey, checked) => {
    const key = asText(allergenKey);
    if (!key || !selectedOverlay?._editorKey) return;

    updateOverlay(selectedOverlay._editorKey, (overlay) => {
      const set = new Set(Array.isArray(overlay.crossContaminationAllergens) ? overlay.crossContaminationAllergens : []);
      if (checked) {
        set.add(key);
      } else {
        set.delete(key);
      }
      return {
        crossContaminationAllergens: Array.from(set),
      };
    });
  }, [selectedOverlay?._editorKey, updateOverlay]);

  const toggleSelectedDiet = useCallback((dietLabel) => {
    const diet = asText(dietLabel);
    if (!diet || !selectedOverlay?._editorKey) return;

    updateOverlay(selectedOverlay._editorKey, (overlay) => {
      const set = new Set(overlay.diets || []);
      if (set.has(diet)) set.delete(diet);
      else set.add(diet);
      return { diets: Array.from(set) };
    });
  }, [selectedOverlay?._editorKey, updateOverlay]);

  const addMenuPages = useCallback((images, options = {}) => {
    const values = (Array.isArray(images) ? images : [])
      .map((value) => asText(value))
      .filter(Boolean);
    if (!values.length) {
      return { added: 0, startIndex: menuImagesRef.current.length };
    }

    const currentLength = Math.max(menuImagesRef.current.length, 1);
    const requestedIndex = Number(options?.atIndex);
    const insertAt = Number.isFinite(requestedIndex)
      ? clamp(Math.floor(requestedIndex), 0, currentLength)
      : currentLength;

    setDraftMenuImages((current) => {
      const next = [...current];
      next.splice(insertAt, 0, ...values);
      menuImagesRef.current = next;
      return next;
    });

    if (insertAt < currentLength) {
      applyOverlayList((current) =>
        current.map((overlay) => {
          const page = Number.isFinite(Number(overlay.pageIndex))
            ? Number(overlay.pageIndex)
            : 0;
          if (page >= insertAt) {
            return { ...overlay, pageIndex: page + values.length };
          }
          return overlay;
        }),
      );
    }

    setActivePageIndex((current) => {
      if (Number.isFinite(Number(options?.focusIndex))) {
        return clamp(
          insertAt + Math.floor(Number(options.focusIndex)),
          0,
          Math.max(menuImagesRef.current.length - 1, 0),
        );
      }
      return clamp(current, 0, Math.max(menuImagesRef.current.length - 1, 0));
    });

    appendPendingChange(
      `Menu pages: Added ${values.length} page${values.length === 1 ? "" : "s"}`,
    );
    queueMicrotask(() => pushHistory());

    return {
      added: values.length,
      startIndex: insertAt,
    };
  }, [appendPendingChange, applyOverlayList, pushHistory]);

  const addMenuPage = useCallback((imageDataUrl) => {
    const value = asText(imageDataUrl);
    if (!value) return;
    addMenuPages([value]);
  }, [addMenuPages]);

  const replaceMenuPageWithSections = useCallback((index, sections) => {
    const entries = (Array.isArray(sections) ? sections : [])
      .map((section) => {
        if (typeof section === "string") {
          return {
            dataUrl: asText(section),
            yStart: 0,
            yEnd: 100,
          };
        }

        const dataUrl = asText(section?.dataUrl || section?.image);
        const rawStart = Number(section?.yStart ?? section?.bounds?.yStart ?? 0);
        const rawEnd = Number(section?.yEnd ?? section?.bounds?.yEnd ?? 100);
        return {
          dataUrl,
          yStart: clamp(Number.isFinite(rawStart) ? rawStart : 0, 0, 100),
          yEnd: clamp(Number.isFinite(rawEnd) ? rawEnd : 100, 0, 100),
        };
      })
      .filter((entry) => entry.dataUrl);

    if (!entries.length) return { replaced: false, sectionCount: 0 };

    const normalizedEntries = entries.map((entry, entryIndex) => {
      const defaultStart = (entryIndex * 100) / entries.length;
      const defaultEnd = ((entryIndex + 1) * 100) / entries.length;
      const yStart = Number.isFinite(entry.yStart) ? entry.yStart : defaultStart;
      const yEnd = Number.isFinite(entry.yEnd) ? entry.yEnd : defaultEnd;
      const safeStart = clamp(Math.min(yStart, yEnd), 0, 100);
      const safeEnd = clamp(Math.max(yStart, yEnd), 0, 100);
      return {
        dataUrl: entry.dataUrl,
        yStart: safeStart,
        yEnd: safeEnd <= safeStart ? Math.min(100, safeStart + 0.1) : safeEnd,
      };
    });

    const targetIndex = clamp(
      Number(index) || 0,
      0,
      Math.max(menuImagesRef.current.length - 1, 0),
    );
    const delta = normalizedEntries.length - 1;
    const nextPageCount = Math.max(menuImagesRef.current.length + delta, 1);

    setDraftMenuImages((current) => {
      const next = [...current];
      next.splice(
        targetIndex,
        1,
        ...normalizedEntries.map((entry) => entry.dataUrl),
      );
      menuImagesRef.current = next.length ? next : [""];
      return menuImagesRef.current;
    });

    applyOverlayList((current) =>
      current.map((overlay) => {
        const page = Number.isFinite(Number(overlay.pageIndex))
          ? Number(overlay.pageIndex)
          : 0;

        if (page < targetIndex) {
          return ensureOverlayVisibility(overlay, nextPageCount);
        }

        if (page > targetIndex) {
          return ensureOverlayVisibility(
            { ...overlay, pageIndex: page + delta },
            nextPageCount,
          );
        }

        if (normalizedEntries.length === 1) {
          return ensureOverlayVisibility(
            { ...overlay, pageIndex: targetIndex },
            nextPageCount,
          );
        }

        const top = clamp(Number(overlay.y) || 0, 0, 100);
        const height = clamp(Number(overlay.h) || 1, 0.5, 100);
        const bottom = clamp(top + height, 0, 100);
        const centerY = top + height / 2;

        let targetSectionIndex = 0;
        let bestOverlap = -1;

        normalizedEntries.forEach((entry, entryIndex) => {
          const overlap = Math.max(
            0,
            Math.min(bottom, entry.yEnd) - Math.max(top, entry.yStart),
          );
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            targetSectionIndex = entryIndex;
          }
        });

        if (bestOverlap <= 0) {
          const fallbackIndex = normalizedEntries.findIndex(
            (entry) => centerY >= entry.yStart && centerY <= entry.yEnd,
          );
          if (fallbackIndex >= 0) targetSectionIndex = fallbackIndex;
        }

        const section =
          normalizedEntries[targetSectionIndex] || normalizedEntries[0] || null;
        if (!section) {
          return ensureOverlayVisibility(
            { ...overlay, pageIndex: targetIndex },
            nextPageCount,
          );
        }

        const sectionSpan = Math.max(section.yEnd - section.yStart, 0.1);
        const clippedTop = clamp(top, section.yStart, section.yEnd);
        const clippedBottom = clamp(bottom, section.yStart, section.yEnd);
        let sectionTop = ((clippedTop - section.yStart) / sectionSpan) * 100;
        let sectionBottom = ((clippedBottom - section.yStart) / sectionSpan) * 100;

        if (sectionBottom - sectionTop < 0.5) {
          const center = ((centerY - section.yStart) / sectionSpan) * 100;
          sectionTop = clamp(center - 1, 0, 99.5);
          sectionBottom = clamp(center + 1, sectionTop + 0.5, 100);
        }

        return ensureOverlayVisibility(
          {
            ...overlay,
            pageIndex: targetIndex + targetSectionIndex,
            y: sectionTop,
            h: Math.max(0.5, sectionBottom - sectionTop),
          },
          nextPageCount,
        );
      }),
    );

    setActivePageIndex((current) => {
      if (current < targetIndex) return current;
      if (current === targetIndex) return targetIndex;
      return clamp(current + delta, 0, Math.max(nextPageCount - 1, 0));
    });

    appendPendingChange(
      `Menu pages: Replaced page ${targetIndex + 1} with ${normalizedEntries.length} section${normalizedEntries.length === 1 ? "" : "s"}`,
    );
    queueMicrotask(() => pushHistory());

    return { replaced: true, sectionCount: normalizedEntries.length };
  }, [appendPendingChange, applyOverlayList, pushHistory]);

  const replaceMenuPage = useCallback((index, imageDataUrl) => {
    const value = asText(imageDataUrl);
    if (!value) return;
    replaceMenuPageWithSections(index, [value]);
  }, [replaceMenuPageWithSections]);

  const removeMenuPage = useCallback((index) => {
    const targetIndex = clamp(Number(index) || 0, 0, Math.max(draftMenuImages.length - 1, 0));

    setDraftMenuImages((current) => {
      const next = current.filter((_, i) => i !== targetIndex);
      if (!next.length) {
        next.push("");
      }
      menuImagesRef.current = next;
      return next;
    });

    applyOverlayList((current) => {
      const next = current
        .filter((overlay) => {
          const page = Number.isFinite(Number(overlay.pageIndex))
            ? Number(overlay.pageIndex)
            : 0;
          return page !== targetIndex;
        })
        .map((overlay) => {
          const page = Number.isFinite(Number(overlay.pageIndex))
            ? Number(overlay.pageIndex)
            : 0;
          if (page > targetIndex) {
            return { ...overlay, pageIndex: page - 1 };
          }
          return overlay;
        });
      return next;
    });

    setActivePageIndex((current) => clamp(current, 0, Math.max(menuImagesRef.current.length - 1, 0)));
    appendPendingChange(`Menu pages: Removed page ${targetIndex + 1}`);
    queueMicrotask(() => pushHistory());
  }, [appendPendingChange, applyOverlayList, draftMenuImages.length, pushHistory]);

  const jumpToPage = useCallback((index) => {
    setActivePageIndex((current) =>
      clamp(Number(index) || current, 0, Math.max(menuImagesRef.current.length - 1, 0)),
    );
  }, []);

  const zoomIn = useCallback(() => {
    setZoomScale((current) => clamp(Number((current + 0.25).toFixed(2)), 0.5, 3));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomScale((current) => clamp(Number((current - 0.25).toFixed(2)), 0.5, 3));
  }, []);

  const zoomReset = useCallback(() => {
    setZoomScale(1);
  }, []);

  const loadChangeLogs = useCallback(async () => {
    if (!callbacks?.onLoadChangeLogs || !restaurant?.id) return;
    setLoadingChangeLogs(true);
    setChangeLogError("");

    try {
      const logs = await callbacks.onLoadChangeLogs(restaurant.id);
      setChangeLogs(Array.isArray(logs) ? logs : []);
    } catch (error) {
      setChangeLogError(error?.message || "Failed to load change log.");
    } finally {
      setLoadingChangeLogs(false);
    }
  }, [callbacks, restaurant?.id]);

  useEffect(() => {
    if (!changeLogOpen) return;
    loadChangeLogs();
  }, [changeLogOpen, loadChangeLogs]);

  const restoreFromChangeLog = useCallback((log) => {
    const parsed = parseChangeLogPayload(log);
    const snapshot =
      parsed?.snapshot ||
      parsed?.__editorSnapshot ||
      (parsed?.meta && typeof parsed.meta === "object" ? parsed.meta.snapshot : null);

    const nextSnapshot = snapshot && typeof snapshot === "object"
      ? {
          overlays: Array.isArray(snapshot.overlays) ? snapshot.overlays : [],
          menuImages: Array.isArray(snapshot.menuImages)
            ? snapshot.menuImages
            : Array.isArray(snapshot.menu_images)
              ? snapshot.menu_images
              : [],
          pendingChanges: ["Restored overlays from previous version"],
        }
      : null;

    if (!nextSnapshot) return { success: false };

    restoreHistorySnapshot(nextSnapshot);
    appendPendingChange("Restored overlays from previous version");
    queueMicrotask(() => pushHistory());
    return { success: true };
  }, [appendPendingChange, pushHistory, restoreHistorySnapshot]);

  const save = useCallback(async () => {
    if (!canEdit || !restaurant?.id) {
      setSaveError("You do not have permission to edit this restaurant.");
      setSaveStatus("error");
      return { success: false };
    }

    if (!callbacks?.onSaveDraft) {
      setSaveError("Save callback is not configured.");
      setSaveStatus("error");
      return { success: false };
    }

    clearSaveStatusTimer();
    setSaveError("");
    setSaveStatus("saving");
    setIsSaving(true);

    try {
      const cleanedOverlays = (overlaysRef.current || []).map(stripEditorOverlay);
      const cleanedMenuImages = (menuImagesRef.current || []).filter(Boolean);
      const menuImage = cleanedMenuImages[0] || "";

      const snapshot = {
        overlays: cleanedOverlays,
        menuImages: cleanedMenuImages,
      };

      const author =
        asText(callbacks?.getAuthorName?.()) || asText(callbacks?.authorName) || "Manager";

      const changePayload = buildDefaultChangeLogPayload({
        author,
        pendingChanges: pendingChangesRef.current,
        snapshot,
      });

      await callbacks.onSaveDraft({
        overlays: cleanedOverlays,
        menuImages: cleanedMenuImages,
        menuImage,
        changePayload,
      });

      baselineRef.current = serializeEditorState(cleanedOverlays, cleanedMenuImages);
      setPendingChanges([]);

      const snapshotAfterSave = {
        overlays: JSON.parse(JSON.stringify(overlaysRef.current || [])),
        menuImages: JSON.parse(JSON.stringify(menuImagesRef.current || [])),
        pendingChanges: [],
      };

      historyRef.current = [snapshotAfterSave];
      setHistoryIndex(0);

      setSaveStatus("saved");
      saveStatusTimerRef.current = window.setTimeout(() => {
        saveStatusTimerRef.current = 0;
        setSaveStatus("idle");
      }, 900);

      return { success: true };
    } catch (error) {
      const message = error?.message || "Failed to save editor changes.";
      setSaveError(message);
      setSaveStatus("error");
      return { success: false, error };
    } finally {
      setIsSaving(false);
    }
  }, [callbacks, canEdit, clearSaveStatusTimer, restaurant?.id]);

  const discardUnsavedChanges = useCallback(() => {
    clearSaveStatusTimer();

    const baselineSnapshot = historyRef.current[0];
    if (baselineSnapshot) {
      restoreHistorySnapshot({
        overlays: JSON.parse(JSON.stringify(baselineSnapshot.overlays || [])),
        menuImages: JSON.parse(JSON.stringify(baselineSnapshot.menuImages || [])),
        pendingChanges: [],
      });
    }

    setPendingChanges([]);
    setSaveError("");
    setIsSaving(false);
    setSaveStatus("idle");

    return { success: true };
  }, [clearSaveStatusTimer, restoreHistorySnapshot]);

  const confirmInfo = useCallback(async (photos) => {
    if (!callbacks?.onConfirmInfo || !restaurant?.id) {
      setConfirmError("Confirm callback is not configured.");
      return { success: false };
    }

    setConfirmBusy(true);
    setConfirmError("");

    try {
      const payload = {
        restaurantId: restaurant.id,
        timestamp: new Date().toISOString(),
        photos: Array.isArray(photos) ? photos : [],
      };
      const result = await callbacks.onConfirmInfo(payload);
      return { success: true, result };
    } catch (error) {
      setConfirmError(error?.message || "Failed to confirm information.");
      return { success: false, error };
    } finally {
      setConfirmBusy(false);
    }
  }, [callbacks, restaurant?.id]);

  const saveRestaurantSettings = useCallback(async () => {
    if (!callbacks?.onSaveRestaurantSettings || !restaurant?.id) {
      setSettingsSaveError("Restaurant settings callback is not configured.");
      return { success: false };
    }

    setSettingsSaveBusy(true);
    setSettingsSaveError("");

    try {
      const payload = {
        website: asText(restaurantSettingsDraft.website),
        phone: asText(restaurantSettingsDraft.phone),
        delivery_url: asText(restaurantSettingsDraft.delivery_url),
        menu_url: asText(restaurantSettingsDraft.menu_url),
      };

      await callbacks.onSaveRestaurantSettings({
        restaurantId: restaurant.id,
        ...payload,
      });

      settingsBaselineRef.current = serializeSettingsDraft(payload);
      return { success: true };
    } catch (error) {
      setSettingsSaveError(error?.message || "Failed to save restaurant settings.");
      return { success: false, error };
    } finally {
      setSettingsSaveBusy(false);
    }
  }, [callbacks, restaurant?.id, restaurantSettingsDraft]);

  const applyAiResultToSelectedOverlay = useCallback((result) => {
    if (!selectedOverlay?._editorKey || !result) return;

    const ingredients = Array.isArray(result.ingredients) ? result.ingredients : [];

    const allergens = Array.from(
      new Set(
        ingredients
          .flatMap((ingredient) =>
            Array.isArray(ingredient?.allergens) ? ingredient.allergens : [],
          )
          .filter(Boolean),
      ),
    );

    const diets = Array.isArray(result.dietaryOptions)
      ? result.dietaryOptions.filter(Boolean)
      : Array.from(
          new Set(
            ingredients
              .flatMap((ingredient) =>
                Array.isArray(ingredient?.diets) ? ingredient.diets : [],
              )
              .filter(Boolean),
          ),
        );

    const details = {};
    allergens.forEach((allergen) => {
      const matched = ingredients
        .filter((ingredient) =>
          Array.isArray(ingredient?.allergens)
            ? ingredient.allergens.includes(allergen)
            : false,
        )
        .map((ingredient) => asText(ingredient?.name))
        .filter(Boolean);
      if (matched.length) {
        details[allergen] = `Contains ${Array.from(new Set(matched)).join(", ")}`;
      }
    });

    const ingredientsBlockingDiets = computeDietBlockers(ingredients, diets);

    updateOverlay(selectedOverlay._editorKey, {
      allergens,
      diets,
      details,
      ingredients,
      removable: [],
      crossContaminationAllergens: [],
      crossContaminationDiets: [],
      ingredientsBlockingDiets,
    });

    appendPendingChange(`${selectedOverlay.id || "Dish"}: Applied AI ingredient analysis`);
    queueMicrotask(() => pushHistory());
  }, [appendPendingChange, pushHistory, selectedOverlay, updateOverlay]);

  const runAiDishAnalysis = useCallback(async () => {
    if (!selectedOverlay || !callbacks?.onAnalyzeDish) return { success: false };

    setAiAssistDraft((current) => ({
      ...current,
      loading: true,
      error: "",
      result: null,
    }));

    try {
      const result = await callbacks.onAnalyzeDish({
        dishName: selectedOverlay.id || selectedOverlay.name,
        text: aiAssistDraft.text,
        imageData: aiAssistDraft.imageData,
      });

      setAiAssistDraft((current) => ({
        ...current,
        loading: false,
        result,
      }));

      return { success: true, result };
    } catch (error) {
      setAiAssistDraft((current) => ({
        ...current,
        loading: false,
        error: error?.message || "Failed to analyze dish.",
      }));
      return { success: false, error };
    }
  }, [aiAssistDraft.imageData, aiAssistDraft.text, callbacks, selectedOverlay]);

  const runIngredientLabelScan = useCallback(async () => {
    if (!selectedOverlay || !callbacks?.onOpenIngredientLabelScan) {
      return { success: false };
    }

    try {
      const ingredientName = selectedOverlay.name || selectedOverlay.id || "Ingredient";
      const result = await callbacks.onOpenIngredientLabelScan({ ingredientName });
      if (result?.productName || result?.ingredientsList || result?.allergens) {
        const ingredients = [
          {
            name: result.productName || ingredientName,
            allergens: Array.isArray(result.allergens) ? result.allergens : [],
            diets: Array.isArray(result.diets) ? result.diets : [],
            crossContaminationAllergens: Array.isArray(result.crossContaminationAllergens)
              ? result.crossContaminationAllergens
              : [],
            crossContaminationDiets: Array.isArray(result.crossContaminationDiets)
              ? result.crossContaminationDiets
              : [],
            removable: false,
            ingredientsList: Array.isArray(result.ingredientsList)
              ? result.ingredientsList
              : [],
          },
        ];

        applyAiResultToSelectedOverlay({
          ingredients,
          dietaryOptions: Array.isArray(result.diets) ? result.diets : [],
        });
      }
      return { success: true, result };
    } catch (error) {
      return { success: false, error };
    }
  }, [applyAiResultToSelectedOverlay, callbacks, selectedOverlay]);

  const detectMenuCorners = useCallback(async ({ imageData, width, height }) => {
    if (!callbacks?.onDetectMenuCorners) {
      return {
        success: false,
        error: "Corner detection callback is not configured.",
      };
    }

    try {
      const result = await callbacks.onDetectMenuCorners({
        imageData,
        width,
        height,
      });
      return {
        success: Boolean(result?.success),
        corners: result?.corners || null,
        description: asText(result?.description),
        error: asText(result?.error),
      };
    } catch (error) {
      return {
        success: false,
        corners: null,
        error: error?.message || "Failed to detect menu corners.",
      };
    }
  }, [callbacks]);

  const runDetectDishes = useCallback(async () => {
    if (!callbacks?.onDetectMenuDishes) return { success: false };

    const image = draftMenuImages[activePageIndex] || "";
    const imageData = await toDataUrlFromImage(image);
    if (!imageData) {
      setDetectWizardState({
        loading: false,
        dishes: [],
        currentIndex: 0,
        error: "No menu image available for dish detection.",
      });
      setDetectWizardOpen(true);
      return { success: false };
    }

    setDetectWizardState((current) => ({
      ...current,
      loading: true,
      error: "",
      dishes: [],
      currentIndex: 0,
    }));
    setDetectWizardOpen(true);

    try {
      const result = await callbacks.onDetectMenuDishes({
        imageData,
        pageIndex: activePageIndex,
      });

      const dishes = Array.isArray(result?.dishes)
        ? result.dishes.map((dish, index) => ({
            name: asText(dish?.name || `Dish ${index + 1}`),
            mapped: false,
          }))
        : [];

      setDetectWizardState({
        loading: false,
        dishes,
        currentIndex: 0,
        error: dishes.length ? "" : "No dishes detected.",
      });

      return { success: dishes.length > 0, result };
    } catch (error) {
      setDetectWizardState({
        loading: false,
        dishes: [],
        currentIndex: 0,
        error: error?.message || "Failed to detect dishes.",
      });
      return { success: false, error };
    }
  }, [activePageIndex, callbacks, draftMenuImages]);

  const mapDetectedDish = useCallback((rect) => {
    const dishes = Array.isArray(detectWizardState.dishes) ? detectWizardState.dishes : [];
    if (!dishes.length) return null;

    const target = dishes[detectWizardState.currentIndex];
    if (!target?.name) return null;

    const nextOverlayKey = `ov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextOverlay = ensureOverlayVisibility(
      normalizeOverlay(
        {
          _editorKey: nextOverlayKey,
          id: target.name,
          name: target.name,
          description: "",
          x: clamp(Number(rect?.x) || 0, 0, 99),
          y: clamp(Number(rect?.y) || 0, 0, 99),
          w: clamp(Number(rect?.w) || 8, 1, 100),
          h: clamp(Number(rect?.h) || 6, 1, 100),
          pageIndex: activePageIndex,
          allergens: [],
          diets: [],
          removable: [],
          crossContaminationAllergens: [],
          crossContaminationDiets: [],
          details: {},
        },
        draftOverlays.length,
        nextOverlayKey,
      ),
      menuImagesRef.current.length,
    );

    applyOverlayList((current) => [...current, nextOverlay]);
    setSelectedOverlayKey(nextOverlayKey);

    appendPendingChange(`${nextOverlay.id}: Added overlay manually`);

    setDetectWizardState((current) => {
      const nextDishes = current.dishes.map((dish, index) =>
        index === current.currentIndex ? { ...dish, mapped: true } : dish,
      );

      let nextIndex = current.currentIndex;
      const forward = nextDishes.findIndex((dish, index) => index > current.currentIndex && !dish.mapped);
      if (forward >= 0) {
        nextIndex = forward;
      } else {
        const any = nextDishes.findIndex((dish) => !dish.mapped);
        nextIndex = any >= 0 ? any : current.currentIndex;
      }

      return {
        ...current,
        dishes: nextDishes,
        currentIndex: nextIndex,
      };
    });

    queueMicrotask(() => pushHistory());
    return nextOverlay;
  }, [
    activePageIndex,
    appendPendingChange,
    applyOverlayList,
    detectWizardState.currentIndex,
    detectWizardState.dishes,
    draftOverlays.length,
    pushHistory,
  ]);

  const setDetectWizardIndex = useCallback((nextIndex) => {
    setDetectWizardState((current) => ({
      ...current,
      currentIndex: clamp(
        Number(nextIndex) || 0,
        0,
        Math.max(current.dishes.length - 1, 0),
      ),
    }));
  }, []);

  const closeDetectWizard = useCallback(() => {
    setDetectWizardOpen(false);
    setDetectWizardState({
      loading: false,
      dishes: [],
      currentIndex: 0,
      error: "",
    });
  }, []);

  useEffect(() => {
    if (initialDishResolved) return;
    if (!params?.dishName || !draftOverlays.length) return;
    const match = matchOverlayByDishName(draftOverlays, params.dishName);
    if (!match) return;
    setSelectedOverlayKey(match._editorKey);
    setActivePageIndex(match.pageIndex || 0);
    setDishEditorOpen(true);
    if (params?.openAI) {
      setDishAiAssistOpen(true);
      if (params?.ingredientName) {
        setAiAssistDraft((current) => ({
          ...current,
          text: `Ingredient focus: ${asText(params.ingredientName)}`,
        }));
      }
    }
    setInitialDishResolved(true);
  }, [
    draftOverlays,
    initialDishResolved,
    params?.dishName,
    params?.ingredientName,
    params?.openAI,
  ]);

  useEffect(() => {
    if (!canEdit) return undefined;

    const handleKeyDown = (event) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      if (!modifier) return;

      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if (
        event.key.toLowerCase() === "y" ||
        (event.key.toLowerCase() === "z" && event.shiftKey)
      ) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canEdit, redo, undo]);

  useEffect(() => {
    if (!isDirty) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  return {
    canEdit,
    overlays: draftOverlays,
    draftOverlays,
    draftMenuImages,
    overlaysByPage,
    selectedOverlay,
    selectedOverlayIndex,
    selectedOverlayKey,
    selectedPageIndex,
    activePageIndex,
    zoomScale,

    pendingChanges,
    isDirty,
    saveError,
    isSaving,
    saveStatus,

    canUndo,
    canRedo,
    undo,
    redo,
    pushHistory,

    selectOverlay,
    updateOverlay,
    updateSelectedOverlay,
    addOverlay,
    removeOverlay,

    openDishEditor,
    closeDishEditor,
    dishEditorOpen,

    dishAiAssistOpen,
    setDishAiAssistOpen,
    aiAssistDraft,
    setAiAssistDraft,
    runAiDishAnalysis,
    applyAiResultToSelectedOverlay,
    runIngredientLabelScan,
    detectMenuCorners,

    toggleSelectedAllergen,
    setSelectedAllergenDetail,
    setSelectedAllergenRemovable,
    setSelectedAllergenCrossContamination,
    toggleSelectedDiet,

    jumpToPage,
    setActivePageIndex,
    zoomIn,
    zoomOut,
    zoomReset,
    setZoomScale,

    save,
    discardUnsavedChanges,
    confirmInfo,
    confirmBusy,
    confirmError,

    changeLogOpen,
    setChangeLogOpen,
    changeLogs,
    loadingChangeLogs,
    changeLogError,
    loadChangeLogs,
    restoreFromChangeLog,

    menuPagesOpen,
    setMenuPagesOpen,
    addMenuPages,
    addMenuPage,
    replaceMenuPage,
    replaceMenuPageWithSections,
    removeMenuPage,

    restaurantSettingsOpen,
    setRestaurantSettingsOpen,
    restaurantSettingsDraft,
    setRestaurantSettingsDraft,
    saveRestaurantSettings,
    settingsDirty,
    settingsSaveBusy,
    settingsSaveError,

    detectWizardOpen,
    setDetectWizardOpen,
    detectWizardState,
    runDetectDishes,
    mapDetectedDish,
    setDetectWizardIndex,
    closeDetectWizard,

    config: {
      allergens: Array.isArray(config?.ALLERGENS) ? config.ALLERGENS : [],
      diets: Array.isArray(config?.DIETS) ? config.DIETS : [],
      formatAllergenLabel:
        typeof config?.formatAllergenLabel === "function"
          ? config.formatAllergenLabel
          : (value) => asText(value),
      formatDietLabel:
        typeof config?.formatDietLabel === "function"
          ? config.formatDietLabel
          : (value) => asText(value),
      getAllergenEmoji:
        typeof config?.getAllergenEmoji === "function"
          ? config.getAllergenEmoji
          : () => "",
      getDietEmoji:
        typeof config?.getDietEmoji === "function"
          ? config.getDietEmoji
          : () => "",
      savedAllergens: (Array.isArray(previewPreferences?.allergies)
        ? previewPreferences.allergies
        : []
      ).map((value) => ({
        key: value,
        label:
          typeof config?.formatAllergenLabel === "function"
            ? config.formatAllergenLabel(value)
            : asText(value),
        emoji:
          typeof config?.getAllergenEmoji === "function"
            ? config.getAllergenEmoji(value)
            : "",
      })),
      savedDiets: (Array.isArray(previewPreferences?.diets) ? previewPreferences.diets : []).map(
        (value) => ({
          key: value,
          label:
            typeof config?.formatDietLabel === "function"
              ? config.formatDietLabel(value)
              : asText(value),
          emoji:
            typeof config?.getDietEmoji === "function" ? config.getDietEmoji(value) : "",
        }),
      ),
    },
  };
}

export default useRestaurantEditor;
