"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import AppTopbar from "../components/AppTopbar";
import AppLoadingScreen from "../components/AppLoadingScreen";
import PageShell from "../components/PageShell";
import { useToast } from "../components/ui";
import { useIngredientScanController } from "../components/ingredient-scan/useIngredientScanController";
import {
  isManagerUser,
  isOwnerUser,
} from "../lib/managerRestaurants";
import { queryKeys } from "../lib/queryKeys";
import { supabaseClient as supabase } from "../lib/supabase";
import UnsavedChangesModal from "./client/UnsavedChangesModal";
import { createRestaurantEditorCallbacks } from "./client/editorCallbacks";
import {
  isTruthyFlag,
  readManagerModeDefault,
} from "./client/navigationModeUtils";
import { loadRestaurantBoot } from "./client/restaurantBootLoader";
import { useRestaurantPersistence } from "./client/useRestaurantPersistence";
import { useRuntimeConfigHealth } from "./client/useRuntimeConfigHealth";
import { useUnsavedNavigationGuard } from "./client/useUnsavedNavigationGuard";
import RestaurantEditor from "./features/editor/RestaurantEditor";
import RestaurantViewer from "./features/viewer/RestaurantViewer";
import { useOrderFlow } from "./hooks/useOrderFlow";
import { useRestaurantEditor } from "./hooks/useRestaurantEditor";
import { useRestaurantViewer } from "./hooks/useRestaurantViewer";

export default function RestaurantClient() {
  const router = useRouter();
  const { push: pushToast } = useToast();
  const searchParams = useSearchParams();
  const ingredientScan = useIngredientScanController();

  // Read all route/query inputs once so downstream hooks can use plain values.
  const slug = searchParams?.get("slug") || "";
  const qrParam = searchParams?.get("qr");
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
  const shouldOpenLog = isTruthyFlag(openLogParam);
  const shouldOpenConfirm = isTruthyFlag(openConfirmParam);
  const shouldOpenAi = isTruthyFlag(openAiParam);
  const shouldAutoReplaceBrand = isTruthyFlag(autoReplaceBrandParam);

  const [activeView, setActiveView] = useState(() =>
    readManagerModeDefault({ editParam, isQrVisit }),
  );
  const [favoriteBusyDish, setFavoriteBusyDish] = useState("");

  const {
    runtimeConfigChecked,
    runtimeMissingKeys,
    runtimeConfigBlocked,
    runtimeConfigErrorMessage,
  } = useRuntimeConfigHealth();

  // Single runtime source for restaurant/menu state in this page:
  // bootQuery -> loadRestaurantBoot -> database `restaurants` table.
  const bootQuery = useQuery({
    queryKey: queryKeys.restaurant.boot(slug, inviteToken, isQrVisit),
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

  // Respect redirect responses from boot loader (manager access checks).
  useEffect(() => {
    if (!boot?.redirect) return;
    router.replace(boot.redirect);
  }, [boot?.redirect, router]);

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
    editorAuthorName,
    pushToast,
  });

  const orderFlow = useOrderFlow({
    restaurantId: restaurantFromDatabase?.id,
    user: boot?.user,
    overlays: restaurantFromDatabase?.overlays || [],
    preferences: {
      allergies: boot?.allergies || [],
      diets: boot?.diets || [],
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

  const viewer = useRestaurantViewer({
    // Viewer reads from the same DB-backed restaurant object as editor.
    restaurant: restaurantFromDatabase,
    overlays: restaurantFromDatabase?.overlays || [],
    initialDishName: dishNameParam,
    preferences: {
      allergies: boot?.allergies || [],
      diets: boot?.diets || [],
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
      onAddDishToOrder: (dish) => {
        orderFlow.addDish(dish);
      },
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
      autoReplaceBrand: shouldAutoReplaceBrand,
      replaceBrandKey: replaceBrandKeyParam,
      replaceBrandName: replaceBrandNameParam,
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

  const isEditorMode = activeView === "editor" && boot?.canEdit;
  const isOwner = isOwnerUser(boot?.user);
  const isManager = isManagerUser(boot?.user);
  const currentRestaurantSlug = boot?.restaurant?.slug || slug;

  const topbar = (
    <AppTopbar
      mode={isEditorMode ? "editor" : "customer"}
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

      {activeView === "editor" && boot.canEdit ? (
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
      ) : (
        <RestaurantViewer
          restaurant={boot.restaurant}
          viewer={viewer}
          orderFlow={orderFlow}
          lovedDishes={lovedDishesSet}
          favoriteBusyDish={favoriteBusyDish}
        />
      )}

      <UnsavedChangesModal modalState={navigationGuard.modal} />
      {ingredientScan.modalNode}
    </PageShell>
  );
}
