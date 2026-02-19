"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import AppTopbar from "../components/AppTopbar";
import AppLoadingScreen from "../components/AppLoadingScreen";
import GuestTopbar from "../components/GuestTopbar";
import PageShell from "../components/PageShell";
import { useToast } from "../components/ui";
import { useIngredientScanController } from "../components/ingredient-scan/useIngredientScanController";
import {
  isManagerUser,
  isOwnerUser,
} from "../lib/managerRestaurants";
import { queryKeys } from "../lib/queryKeys";
import { supabaseClient as supabase } from "../lib/supabase";
import EditorLockBlockedModal from "./client/EditorLockBlockedModal";
import UnsavedChangesModal from "./client/UnsavedChangesModal";
import { createRestaurantEditorCallbacks } from "./client/editorCallbacks";
import {
  isTruthyFlag,
  readManagerModeDefault,
} from "./client/navigationModeUtils";
import { loadRestaurantBoot } from "./client/restaurantBootLoader";
import { useEditorLock } from "./client/useEditorLock";
import { useRestaurantPersistence } from "./client/useRestaurantPersistence";
import { useRuntimeConfigHealth } from "./client/useRuntimeConfigHealth";
import { useUnsavedNavigationGuard } from "./client/useUnsavedNavigationGuard";
import {
  deriveDishStateFromIngredients,
  normalizeIngredientEntry,
} from "./features/editor/editorUtils";
import RestaurantEditor from "./features/editor/RestaurantEditor";
import RestaurantOrderSidebar from "./features/order/RestaurantOrderSidebar";
import RestaurantViewer from "./features/viewer/RestaurantViewer";
import { useOrderFlow } from "./hooks/useOrderFlow";
import { useRestaurantEditor } from "./hooks/useRestaurantEditor";
import { useRestaurantViewer } from "./hooks/useRestaurantViewer";

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeBrandKey(value) {
  return asText(value).toLowerCase();
}

function resolveBrandVerificationKey(brand) {
  const barcodeKey = normalizeBrandKey(brand?.barcode);
  if (barcodeKey) return `barcode:${barcodeKey}`;
  const nameKey = normalizeBrandKey(brand?.name || brand?.productName);
  if (nameKey) return `name:${nameKey}`;
  return "";
}

function normalizeStringList(values, normalizer) {
  const seen = new Set();
  const output = [];
  (Array.isArray(values) ? values : []).forEach((entry) => {
    const raw = asText(entry);
    if (!raw) return;
    const normalized =
      typeof normalizer === "function" ? asText(normalizer(raw)) || raw : raw;
    const token = normalizeToken(normalized);
    if (!token || seen.has(token)) return;
    seen.add(token);
    output.push(normalized);
  });
  return output;
}

const QR_ALLERGIES_KEY = "qrAllergies";
const QR_DIETS_KEY = "qrDiets";

function saveGuestSessionPreferences({ allergies, diets }) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(QR_ALLERGIES_KEY, JSON.stringify(allergies));
    sessionStorage.setItem(QR_DIETS_KEY, JSON.stringify(diets));
  } catch {
    // Ignore storage errors so viewer interactions are not blocked.
  }
}

function brandNameMatchesTarget(candidateName, { targetBrandName, targetBrandNameToken }) {
  const normalizedName = normalizeBrandKey(candidateName);
  if (targetBrandName && normalizedName === targetBrandName) {
    return true;
  }
  const normalizedToken = normalizeToken(candidateName);
  return Boolean(targetBrandNameToken && normalizedToken && normalizedToken === targetBrandNameToken);
}

function ingredientMatchesBrandTarget(
  ingredient,
  { targetBrandKey, targetBrandName, targetBrandNameToken },
) {
  const brands = Array.isArray(ingredient?.brands) ? ingredient.brands : [];

  if (targetBrandKey) {
    const hasKeyMatch = brands.some(
      (brand) => normalizeBrandKey(resolveBrandVerificationKey(brand)) === targetBrandKey,
    );
    if (hasKeyMatch) return true;
  }

  if (targetBrandName || targetBrandNameToken) {
    const hasNameMatch = brands.some(
      (brand) =>
        brandNameMatchesTarget(brand?.name || brand?.productName, {
          targetBrandName,
          targetBrandNameToken,
        }),
    );
    if (hasNameMatch) return true;

    const appliedBrandName = asText(
      ingredient?.appliedBrandItem || ingredient?.appliedBrand || ingredient?.brandName,
    );
    if (
      appliedBrandName &&
      brandNameMatchesTarget(appliedBrandName, {
        targetBrandName,
        targetBrandNameToken,
      })
    ) {
      return true;
    }
  }

  return false;
}

function findSeedIngredientName(
  overlays,
  { targetBrandKey, targetBrandName, targetBrandNameToken, fallbackBrandName },
) {
  for (const overlay of Array.isArray(overlays) ? overlays : []) {
    const ingredients = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];
    for (const ingredient of ingredients) {
      if (
        !ingredientMatchesBrandTarget(ingredient, {
          targetBrandKey,
          targetBrandName,
          targetBrandNameToken,
        })
      ) {
        continue;
      }
      const ingredientName = asText(ingredient?.name);
      if (ingredientName) return ingredientName;
    }
  }
  return asText(fallbackBrandName) || "Brand item";
}

function buildReplacementBrandFromScan(result, fallbackName, config) {
  const ingredientText = asText(result?.ingredientText);
  const ingredientLines = normalizeStringList(
    Array.isArray(result?.ingredientsList) && result.ingredientsList.length
      ? result.ingredientsList
      : ingredientText
        ? [ingredientText]
        : [],
  );

  return {
    name: asText(result?.productName) || asText(fallbackName) || "Brand item",
    barcode: "",
    brandImage: asText(result?.brandImage),
    image: "",
    ingredientsImage: asText(result?.ingredientsImage),
    ingredientsList: ingredientLines,
    ingredientList: ingredientText || ingredientLines.join(" "),
    allergens: normalizeStringList(result?.allergens, config?.normalizeAllergen),
    crossContaminationAllergens: normalizeStringList(
      result?.crossContaminationAllergens,
      config?.normalizeAllergen,
    ),
    diets: normalizeStringList(result?.diets, config?.normalizeDietLabel),
    crossContaminationDiets: normalizeStringList(
      result?.crossContaminationDiets,
      config?.normalizeDietLabel,
    ),
  };
}

function applyReplacementBrandToIngredient(ingredient, replacementBrand) {
  const replacementName = asText(replacementBrand?.name);
  const replacementBarcode = asText(replacementBrand?.barcode);
  const replacementBrandImage = asText(
    replacementBrand?.brandImage || replacementBrand?.image || replacementBrand?.ingredientsImage,
  );
  const replacementIngredientsList = normalizeStringList(replacementBrand?.ingredientsList);
  const replacementIngredientList = asText(
    replacementBrand?.ingredientList || replacementIngredientsList.join(" "),
  );
  const compactBrand = {
    ...replacementBrand,
    brandImage: replacementBrandImage,
    ingredientsImage: "",
    image: "",
    ingredientsList: replacementIngredientsList,
    ingredientList: replacementIngredientList,
  };

  const next = {
    ...ingredient,
    allergens: replacementBrand.allergens,
    diets: replacementBrand.diets,
    crossContaminationAllergens: replacementBrand.crossContaminationAllergens,
    crossContaminationDiets: replacementBrand.crossContaminationDiets,
    aiDetectedAllergens: replacementBrand.allergens,
    aiDetectedDiets: replacementBrand.diets,
    aiDetectedCrossContaminationAllergens: replacementBrand.crossContaminationAllergens,
    aiDetectedCrossContaminationDiets: replacementBrand.crossContaminationDiets,
    brands: [{ ...compactBrand }],
    confirmed: false,
  };

  if (replacementName) {
    next.appliedBrandItem = replacementName;
    next.appliedBrand = replacementName;
    next.brandName = replacementName;
  } else {
    delete next.appliedBrandItem;
    delete next.appliedBrand;
    delete next.brandName;
  }

  if (replacementBarcode) {
    next.barcode = replacementBarcode;
  } else {
    delete next.barcode;
  }

  // Keep replacement image/text only on the selected brand object to avoid payload duplication.
  delete next.brandImage;
  delete next.ingredientsImage;
  delete next.image;
  delete next.ingredientList;
  delete next.ingredientsList;

  return next;
}

function applyBrandReplacementToOverlays({
  overlays,
  replacementBrand,
  targetBrandKey,
  targetBrandName,
  targetBrandNameToken,
  configuredDiets,
}) {
  const matchedOverlayKeys = [];
  const matchedDishNames = new Set();
  const matchedIngredientNames = new Set();
  const dishReplacementCounts = new Map();
  let replacedRows = 0;

  const nextOverlays = (Array.isArray(overlays) ? overlays : []).map((overlay, overlayIndex) => {
    const ingredients = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];
    let changed = false;

    const nextIngredients = ingredients.map((ingredient) => {
      if (
        !ingredientMatchesBrandTarget(ingredient, {
          targetBrandKey,
          targetBrandName,
          targetBrandNameToken,
        })
      ) {
        return ingredient;
      }

      changed = true;
      replacedRows += 1;
      const dishName = asText(overlay?.id || overlay?.name || `Dish ${overlayIndex + 1}`);
      const ingredientName = asText(ingredient?.name);
      if (dishName) {
        matchedDishNames.add(dishName);
        dishReplacementCounts.set(dishName, (dishReplacementCounts.get(dishName) || 0) + 1);
      }
      if (ingredientName) matchedIngredientNames.add(ingredientName);

      return applyReplacementBrandToIngredient(ingredient, replacementBrand);
    });

    if (!changed) return overlay;

    const normalizedIngredients = nextIngredients.map((row, rowIndex) =>
      normalizeIngredientEntry(row, rowIndex),
    );
    const derived = deriveDishStateFromIngredients({
      ingredients: normalizedIngredients,
      existingDetails: overlay?.details,
      configuredDiets: Array.isArray(configuredDiets) ? configuredDiets : [],
    });

    if (asText(overlay?._editorKey)) {
      matchedOverlayKeys.push(asText(overlay._editorKey));
    }

    return {
      ...overlay,
      ingredients: derived.ingredients,
      aiIngredients: JSON.stringify(derived.ingredients),
      allergens: derived.allergens,
      diets: derived.diets,
      details: derived.details,
      removable: derived.removable,
      crossContaminationAllergens: derived.crossContaminationAllergens,
      crossContaminationDiets: derived.crossContaminationDiets,
      ingredientsBlockingDiets: derived.ingredientsBlockingDiets,
    };
  });

  return {
    overlays: nextOverlays,
    replacedRows,
    firstOverlayKey: matchedOverlayKeys[0] || "",
    dishNames: Array.from(matchedDishNames),
    ingredientNames: Array.from(matchedIngredientNames),
    dishCounts: Array.from(dishReplacementCounts.entries()).map(([dishName, count]) => ({
      dishName,
      count,
    })),
  };
}

function stripAutoReplaceParamsFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const keys = ["autoReplaceBrand", "replaceBrandKey", "replaceBrandName"];
  let changed = false;
  keys.forEach((key) => {
    if (!url.searchParams.has(key)) return;
    url.searchParams.delete(key);
    changed = true;
  });
  if (!changed) return;
  const query = url.searchParams.toString();
  const nextUrl = `${url.pathname}${query ? `?${query}` : ""}${url.hash || ""}`;
  window.history.replaceState({}, document.title, nextUrl);
}

export default function RestaurantClient() {
  const router = useRouter();
  const { push: pushToast } = useToast();
  const searchParams = useSearchParams();
  const ingredientScan = useIngredientScanController();

  // Read all route/query inputs once so downstream hooks can use plain values.
  const slug = searchParams?.get("slug") || "";
  const qrParam = searchParams?.get("qr");
  const guestParam = searchParams?.get("guest");
  const inviteToken = searchParams?.get("invite") || "";
  const dishNameParam = searchParams?.get("dishName") || "";
  const ingredientNameParam = searchParams?.get("ingredientName") || "";
  const editParam = searchParams?.get("edit") || searchParams?.get("mode");
  const openLogParam = searchParams?.get("openLog");
  const openConfirmParam = searchParams?.get("openConfirm");
  const openAiParam = searchParams?.get("openAI");
  const autoReplaceBrandParam = searchParams?.get("autoReplaceBrand");
  const replaceBrandKeyParam = searchParams?.get("replaceBrandKey") || "";
  const replaceBrandNameParam = searchParams?.get("replaceBrandName") || "";
  const isQrVisit = isTruthyFlag(qrParam);
  const isGuestVisit = isTruthyFlag(guestParam);
  const shouldOpenLog = isTruthyFlag(openLogParam);
  const shouldOpenConfirm = isTruthyFlag(openConfirmParam);
  const shouldOpenAi = isTruthyFlag(openAiParam);
  const shouldAutoReplaceBrand = isTruthyFlag(autoReplaceBrandParam);

  const [activeView, setActiveView] = useState(() =>
    readManagerModeDefault({ editParam, isQrVisit }),
  );
  const [favoriteBusyDish, setFavoriteBusyDish] = useState("");
  const [orderSidebarOpen, setOrderSidebarOpen] = useState(false);
  const autoReplaceBrandRunRef = useRef(false);
  const isMountedRef = useRef(true);

  const {
    runtimeConfigChecked,
    runtimeMissingKeys,
    runtimeConfigBlocked,
    runtimeConfigErrorMessage,
  } = useRuntimeConfigHealth();

  // Single runtime source for restaurant/menu state in this page:
  // bootQuery -> loadRestaurantBoot -> database `restaurants` table.
  const bootQuery = useQuery({
    queryKey: queryKeys.restaurant.boot(
      slug,
      inviteToken,
      isQrVisit,
      isGuestVisit,
    ),
    enabled: Boolean(supabase) && Boolean(slug),
    queryFn: async () =>
      loadRestaurantBoot({
        slug,
        isQrVisit,
        inviteToken,
        supabaseClient: supabase,
      }),
    staleTime: 30 * 1000,
  });

  const boot = bootQuery.data;
  // Viewer/editor consume this same object, so all dish/menu data comes from one place.
  const restaurantFromDatabase = boot?.restaurant || null;
  const isGuestViewerSession =
    Boolean(isGuestVisit) && !inviteToken && !boot?.user?.id;
  const [guestSelections, setGuestSelections] = useState({
    allergies: [],
    diets: [],
  });
  const guestSelectionsInitializedRef = useRef(false);

  const guestReturnToPath = useMemo(() => {
    const query = searchParams?.toString();
    return `/restaurant${query ? `?${query}` : ""}`;
  }, [searchParams]);

  const guestAccountSigninHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("mode", "signin");
    params.set("guest", "1");
    params.set("returnTo", guestReturnToPath);
    return `/account?${params.toString()}`;
  }, [guestReturnToPath]);

  const guestAccountSignupHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("mode", "signup");
    params.set("guest", "1");
    params.set("returnTo", guestReturnToPath);
    return `/account?${params.toString()}`;
  }, [guestReturnToPath]);

  useEffect(() => {
    if (!isGuestViewerSession) {
      guestSelectionsInitializedRef.current = false;
      setGuestSelections({ allergies: [], diets: [] });
      return;
    }

    if (!boot) return;
    if (guestSelectionsInitializedRef.current) return;
    guestSelectionsInitializedRef.current = true;

    setGuestSelections({
      allergies: normalizeStringList(
        boot?.allergies || [],
        boot?.config?.normalizeAllergen,
      ),
      diets: normalizeStringList(boot?.diets || [], boot?.config?.normalizeDietLabel),
    });
  }, [
    boot?.allergies,
    boot?.config?.normalizeAllergen,
    boot?.config?.normalizeDietLabel,
    boot?.diets,
    isGuestViewerSession,
  ]);

  const effectiveAllergies = isGuestViewerSession
    ? guestSelections.allergies
    : boot?.allergies || [];
  const effectiveDiets = isGuestViewerSession ? guestSelections.diets : boot?.diets || [];

  const guestPreferenceOptions = useMemo(() => {
    const allergenValues = normalizeStringList(
      boot?.config?.ALLERGENS,
      boot?.config?.normalizeAllergen,
    );
    const dietValues = normalizeStringList(
      boot?.config?.DIETS,
      boot?.config?.normalizeDietLabel,
    );

    return {
      allergens: allergenValues.map((value) => ({
        key: value,
        label: boot?.config?.formatAllergenLabel
          ? boot.config.formatAllergenLabel(value)
          : value,
        emoji: boot?.config?.getAllergenEmoji
          ? boot.config.getAllergenEmoji(value)
          : "",
      })),
      diets: dietValues.map((value) => ({
        key: value,
        label: boot?.config?.formatDietLabel
          ? boot.config.formatDietLabel(value)
          : value,
        emoji: boot?.config?.getDietEmoji ? boot.config.getDietEmoji(value) : "",
      })),
    };
  }, [
    boot?.config?.ALLERGENS,
    boot?.config?.DIETS,
    boot?.config?.formatAllergenLabel,
    boot?.config?.formatDietLabel,
    boot?.config?.getAllergenEmoji,
    boot?.config?.getDietEmoji,
    boot?.config?.normalizeAllergen,
    boot?.config?.normalizeDietLabel,
  ]);

  const onSaveGuestPreferences = useCallback(
    ({ allergies, diets }) => {
      if (!isGuestViewerSession) return;

      const nextAllergies = normalizeStringList(
        allergies,
        boot?.config?.normalizeAllergen,
      );
      const nextDiets = normalizeStringList(
        diets,
        boot?.config?.normalizeDietLabel,
      );

      setGuestSelections({
        allergies: nextAllergies,
        diets: nextDiets,
      });
      saveGuestSessionPreferences({
        allergies: nextAllergies,
        diets: nextDiets,
      });
    },
    [
      boot?.config?.normalizeAllergen,
      boot?.config?.normalizeDietLabel,
      isGuestViewerSession,
    ],
  );

  // Respect redirect responses from boot loader (manager access checks).
  useEffect(() => {
    if (!boot?.redirect) return;
    router.replace(boot.redirect);
  }, [boot?.redirect, router]);

  // Keep unauthenticated direct restaurant visits inside the guest onboarding flow.
  useEffect(() => {
    if (!boot?.restaurant) return;
    if (boot?.user?.id) return;
    if (inviteToken) return;
    if (isGuestVisit || isQrVisit) return;

    const safeSlug = asText(boot?.restaurant?.slug || slug);
    const nextPath = safeSlug
      ? `/restaurant?slug=${encodeURIComponent(safeSlug)}`
      : "/restaurant";
    router.replace(`/guest?next=${encodeURIComponent(nextPath)}`);
  }, [
    boot?.restaurant,
    boot?.restaurant?.slug,
    boot?.user?.id,
    inviteToken,
    isGuestVisit,
    isQrVisit,
    router,
    slug,
  ]);

  // Re-evaluate default mode whenever boot data or mode-related query params change.
  useEffect(() => {
    if (!boot) return;
    const defaultMode = readManagerModeDefault({ editParam, isQrVisit });
    const nextMode = boot.canEdit ? defaultMode : "viewer";
    setActiveView(nextMode);
  }, [boot, editParam, isQrVisit]);

  const lovedDishesSet = useMemo(() => {
    return new Set(boot?.lovedDishNames || []);
  }, [boot?.lovedDishNames]);

  // Build a stable display name for write history/change logs.
  const editorAuthorName = useMemo(() => {
    const firstName = boot?.user?.user_metadata?.first_name || "";
    const lastName = boot?.user?.user_metadata?.last_name || "";
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;
    if (boot?.user?.name) return String(boot.user.name);
    if (boot?.user?.email) return String(boot.user.email).split("@")[0];
    return "Manager";
  }, [boot?.user]);

  const {
    saveDraft,
    confirmInfo,
    saveRestaurantSettings,
    toggleFavorite,
    preparePendingSave,
    applyPendingSave,
    loadChangeLogs,
    loadPendingSaveTable,
  } = useRestaurantPersistence({
    supabaseClient: supabase,
    boot,
    slug,
    inviteToken,
    isQrVisit,
    isGuestVisit,
    editorAuthorName,
    pushToast,
  });

  const orderFlow = useOrderFlow({
    restaurantId: restaurantFromDatabase?.id,
    user: boot?.user,
    overlays: restaurantFromDatabase?.overlays || [],
    preferences: {
      allergies: effectiveAllergies,
      diets: effectiveDiets,
      formatAllergenLabel: boot?.config?.formatAllergenLabel,
      formatDietLabel: boot?.config?.formatDietLabel,
      getAllergenEmoji: boot?.config?.getAllergenEmoji,
      getDietEmoji: boot?.config?.getDietEmoji,
    },
  });

  // Viewer favorite toggle is kept here because it updates local busy UI state.
  const onToggleFavoriteDish = useCallback(
    async (dish) => {
      const dishName = String(dish?.id || dish?.name || "").trim();
      if (!dishName) return;
      const shouldLove = !lovedDishesSet.has(dishName);

      try {
        setFavoriteBusyDish(dishName);
        await toggleFavorite({ dishName, shouldLove });
      } catch (error) {
        pushToast({
          tone: "danger",
          title: "Favorite update failed",
          description: error?.message || "Unable to update favorite right now.",
        });
      } finally {
        setFavoriteBusyDish("");
      }
    },
    [lovedDishesSet, pushToast, toggleFavorite],
  );

  const onAddDishToOrder = useCallback(
    (dish) => {
      const dishName = String(dish?.id || dish?.name || "").trim();
      if (!dishName) return;

      const alreadySelected = orderFlow.selectedDishNames.includes(dishName);
      orderFlow.addDish(dishName);
      setOrderSidebarOpen(true);
      pushToast({
        tone: alreadySelected ? "neutral" : "success",
        title: alreadySelected ? "Dish already in order" : "Dish added to order",
        description: dishName,
      });
    },
    [orderFlow.addDish, orderFlow.selectedDishNames, pushToast],
  );

  const viewer = useRestaurantViewer({
    // Viewer reads from the same DB-backed restaurant object as editor.
    restaurant: restaurantFromDatabase,
    overlays: restaurantFromDatabase?.overlays || [],
    initialDishName: dishNameParam,
    preferences: {
      allergies: effectiveAllergies,
      diets: effectiveDiets,
      normalizeAllergen: boot?.config?.normalizeAllergen,
      normalizeDietLabel: boot?.config?.normalizeDietLabel,
      getDietAllergenConflicts: boot?.config?.getDietAllergenConflicts,
      formatAllergenLabel: boot?.config?.formatAllergenLabel,
      formatDietLabel: boot?.config?.formatDietLabel,
      getAllergenEmoji: boot?.config?.getAllergenEmoji,
      getDietEmoji: boot?.config?.getDietEmoji,
    },
    mode: activeView,
    callbacks: {
      onAddDishToOrder,
      onToggleFavoriteDish,
    },
  });

  const editorCallbacks = useMemo(() => {
    return createRestaurantEditorCallbacks({
      supabaseClient: supabase,
      boot,
      slug,
      editorAuthorName,
      runtimeConfigBlocked,
      runtimeConfigErrorMessage,
      ingredientScan,
      persistence: {
        saveDraft,
        confirmInfo,
        saveRestaurantSettings,
        preparePendingSave,
        applyPendingSave,
        loadChangeLogs,
        loadPendingSaveTable,
      },
    });
  }, [
    applyPendingSave,
    boot,
    confirmInfo,
    editorAuthorName,
    ingredientScan,
    loadChangeLogs,
    loadPendingSaveTable,
    preparePendingSave,
    runtimeConfigBlocked,
    runtimeConfigErrorMessage,
    saveDraft,
    saveRestaurantSettings,
    slug,
  ]);

  const editor = useRestaurantEditor({
    // Editor also receives only the DB-backed restaurant object.
    restaurant: restaurantFromDatabase,
    overlays: restaurantFromDatabase?.overlays || [],
    permissions: {
      canEdit: boot?.canEdit,
    },
    config: boot?.config,
    previewPreferences: {
      allergies: boot?.allergies || [],
      diets: boot?.diets || [],
    },
    params: {
      openLog: shouldOpenLog,
      openConfirm: shouldOpenConfirm,
      dishName: dishNameParam,
      openAI: shouldOpenAi,
      ingredientName: ingredientNameParam,
    },
    callbacks: editorCallbacks,
  });

  const onSignOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.replace("/account?mode=signin");
  }, [router]);

  const navigationGuard = useUnsavedNavigationGuard({
    activeView,
    setActiveView,
    editor,
    router,
    searchParams,
    slug,
    restaurantSlug: boot?.restaurant?.slug || slug,
  });

  const isEditorRequested = activeView === "editor" && Boolean(boot?.canEdit);
  const editorLock = useEditorLock({
    supabaseClient: supabase,
    restaurantId: boot?.restaurant?.id || "",
    isEditorRequested,
    userId: boot?.user?.id || "",
  });
  const isEditorMode = isEditorRequested && editorLock.granted;
  const editorAccessBlocked = isEditorRequested && editorLock.blocked;
  const editorAccessChecking = isEditorRequested && editorLock.checking;

  const activeNoticeCount = Array.isArray(orderFlow.activeNotices)
    ? orderFlow.activeNotices.length
    : 0;
  const completedNoticeCount = Array.isArray(orderFlow.completedNotices)
    ? orderFlow.completedNotices.length
    : 0;
  const hasOrderSidebarContent =
    orderFlow.selectedDishNames.length > 0 ||
    activeNoticeCount > 0 ||
    completedNoticeCount > 0;
  const orderSidebarBadgeCount = orderFlow.selectedDishNames.length + activeNoticeCount;

  useEffect(() => {
    if (!hasOrderSidebarContent && orderSidebarOpen) {
      setOrderSidebarOpen(false);
    }
  }, [hasOrderSidebarContent, orderSidebarOpen]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Dashboard-driven brand replacement flow:
  // route to editor -> open scan modal -> apply replacements in draft only.
  useEffect(() => {
    if (!isEditorMode) return;
    if (!shouldAutoReplaceBrand) return;
    if (autoReplaceBrandRunRef.current) return;
    if (!Array.isArray(editor?.draftOverlays) || !editor.draftOverlays.length) return;

    autoReplaceBrandRunRef.current = true;
    stripAutoReplaceParamsFromUrl();

    const targetBrandKey = normalizeBrandKey(replaceBrandKeyParam);
    const targetBrandName = normalizeBrandKey(replaceBrandNameParam);
    const targetBrandNameToken = normalizeToken(replaceBrandNameParam);

    const run = async () => {
      try {
        const seedIngredientName = findSeedIngredientName(editor.draftOverlays, {
          targetBrandKey,
          targetBrandName,
          targetBrandNameToken,
          fallbackBrandName: replaceBrandNameParam,
        });

        const scanResult = await ingredientScan.openScan({
          ingredientName: seedIngredientName,
          supportedDiets: Array.isArray(boot?.config?.DIETS) ? boot.config.DIETS : [],
          scanProfile: "dish_editor_brand",
        });
        if (!isMountedRef.current || !scanResult) return;

        const replacementBrand = buildReplacementBrandFromScan(
          scanResult,
          replaceBrandNameParam || seedIngredientName,
          boot?.config,
        );

        const replacement = applyBrandReplacementToOverlays({
          overlays: editor.draftOverlays,
          replacementBrand,
          targetBrandKey,
          targetBrandName,
          targetBrandNameToken,
          configuredDiets: Array.isArray(boot?.config?.DIETS) ? boot.config.DIETS : [],
        });

        if (!replacement.replacedRows) {
          pushToast({
            tone: "danger",
            title: "No rows updated",
            description: "No ingredient rows matched the selected brand item.",
          });
          return;
        }

        editor.applyOverlayList(replacement.overlays);
        queueMicrotask(() => {
          editor.pushHistory();
          if (replacement.firstOverlayKey) {
            editor.openDishEditor(replacement.firstOverlayKey);
          }
        });

        pushToast({
          tone: "success",
          title: "Brand replacement staged",
          description: `Updated ${replacement.replacedRows} ingredient row${replacement.replacedRows === 1 ? "" : "s"}. Reconfirm each affected row, then click Save to site.`,
        });
      } catch (error) {
        if (!isMountedRef.current) return;
        pushToast({
          tone: "danger",
          title: "Brand replacement failed",
          description: error?.message || "Unable to start brand replacement flow.",
        });
      }
    };

    run();
  }, [
    autoReplaceBrandRunRef,
    boot?.config,
    editor,
    ingredientScan,
    isEditorMode,
    pushToast,
    replaceBrandKeyParam,
    replaceBrandNameParam,
    shouldAutoReplaceBrand,
  ]);

  // Lock body scrolling so the restaurant surface controls the viewport.
  useEffect(() => {
    if (!boot?.restaurant) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [boot?.restaurant]);

  if (!supabase) {
    return (
      <PageShell>
        <p className="status-text error">Supabase env vars are missing.</p>
      </PageShell>
    );
  }

  if (!slug) {
    return (
      <PageShell>
        <p className="status-text error">No restaurant specified.</p>
      </PageShell>
    );
  }

  if (bootQuery.isLoading) {
    return <AppLoadingScreen label="restaurant" />;
  }

  if (bootQuery.isError || !boot?.restaurant) {
    return (
      <PageShell>
        <p className="status-text error">
          {bootQuery.error?.message || "Failed to load restaurant page."}
        </p>
      </PageShell>
    );
  }

  const isOwner = isOwnerUser(boot?.user);
  const isManager = isManagerUser(boot?.user);
  const currentRestaurantSlug = boot?.restaurant?.slug || slug;
  const shouldRenderEditor = isEditorMode;
  const shouldRenderViewer = !isEditorRequested || editorAccessBlocked;

  const topbar = isGuestViewerSession
    ? (
      <GuestTopbar brandHref="/guest" signInHref={guestAccountSigninHref} />
    )
    : (
      <AppTopbar
        mode={isEditorRequested ? "editor" : "customer"}
        user={boot?.user || null}
        managerRestaurants={isOwner || isManager ? boot?.managerRestaurants || [] : []}
        currentRestaurantSlug={currentRestaurantSlug}
        showModeToggle={Boolean(boot?.canEdit)}
        onModeChange={(nextMode) =>
          navigationGuard.setMode(nextMode === "editor" ? "editor" : "viewer")
        }
        onSignOut={onSignOut}
        onNavigate={navigationGuard.onRestaurantNavigate}
      />
    );

  const useRestaurantViewportShell = Boolean(boot?.restaurant);

  return (
    <PageShell
      shellClassName={
        useRestaurantViewportShell ? "page-shell restaurant-shell" : "page-shell"
      }
      mainClassName={
        useRestaurantViewportShell ? "page-main restaurant-main" : "page-main"
      }
      contentClassName={useRestaurantViewportShell ? "restaurant-content" : ""}
      topbar={topbar}
    >
      {inviteToken && !boot?.user?.id ? (
        <div className="mb-4 rounded-xl border border-[rgba(76,90,212,0.5)] bg-[rgba(76,90,212,0.2)] p-3 text-[#dce5ff]">
          <p className="m-0 text-sm">
            You have been invited as a manager. Sign up to activate manager access.
          </p>
          <a
            href={`/account?invite=${encodeURIComponent(inviteToken)}`}
            className="btn btnPrimary mt-2 inline-flex"
          >
            Sign up to activate access
          </a>
        </div>
      ) : null}

      {editorAccessChecking ? (
        <div className="mb-4 rounded-xl border border-[rgba(76,90,212,0.45)] bg-[rgba(17,22,48,0.88)] px-4 py-3 text-sm text-[#dce5ff]">
          Checking editor availability...
        </div>
      ) : null}

      {shouldRenderEditor ? (
        <>
          {runtimeConfigBlocked ? (
            <div className="mb-4 rounded-xl border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
              <strong>Runtime configuration missing.</strong> AI actions are disabled
              until these env vars are set: {runtimeMissingKeys.join(", ")}.
            </div>
          ) : null}
          <RestaurantEditor
            editor={editor}
            onNavigate={navigationGuard.onRestaurantNavigate}
            runtimeConfigHealth={{
              checked: runtimeConfigChecked,
              blocked: runtimeConfigBlocked,
              missing: runtimeMissingKeys,
            }}
          />
        </>
      ) : shouldRenderViewer ? (
        <>
          <RestaurantViewer
            restaurant={boot.restaurant}
            viewer={viewer}
            lovedDishes={lovedDishesSet}
            favoriteBusyDish={favoriteBusyDish}
            preferenceTitlePrefix={isGuestViewerSession ? "Selected" : "Saved"}
            showPreferenceEdit={!isGuestViewerSession}
            allowGuestPreferenceEditing={isGuestViewerSession}
            guestPreferenceOptions={guestPreferenceOptions}
            onSaveGuestPreferences={onSaveGuestPreferences}
            showGuestSignupPrompt={isGuestViewerSession}
            guestSignupHref={guestAccountSignupHref}
          />
          {hasOrderSidebarContent ? (
            <RestaurantOrderSidebar
              orderFlow={orderFlow}
              user={boot.user}
              isGuest={isGuestViewerSession}
              guestSignupHref={guestAccountSignupHref}
              isOpen={orderSidebarOpen}
              onToggleOpen={() => setOrderSidebarOpen((current) => !current)}
              badgeCount={orderSidebarBadgeCount}
            />
          ) : null}
        </>
      ) : null}

      <EditorLockBlockedModal
        open={editorAccessBlocked}
        message={editorLock.message}
        refreshBusy={editorLock.refreshBusy || editorAccessChecking}
        onRefresh={editorLock.refreshStatus}
        onReturnDashboard={() => {
          router.replace("/manager-dashboard");
        }}
      />

      {editorAccessBlocked ? null : (
        <>
          <UnsavedChangesModal modalState={navigationGuard.modal} />
          {ingredientScan.modalNode}
        </>
      )}
    </PageShell>
  );
}
