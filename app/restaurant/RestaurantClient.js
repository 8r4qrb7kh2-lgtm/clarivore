"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import PageShell from "../components/PageShell";
import { useToast } from "../components/ui";
import { loadAllergenDietConfig } from "../lib/allergenConfig";
import {
  fetchManagerRestaurants,
  isManagerUser,
  isOwnerUser,
} from "../lib/managerRestaurants";
import { queryKeys } from "../lib/queryKeys";
import { supabaseClient as supabase } from "../lib/supabase";
import { buildTrainingRestaurantPayload, HOW_IT_WORKS_SLUG } from "./boot/trainingRestaurant";
import RestaurantEditor from "./features/editor/RestaurantEditor";
import RestaurantViewer from "./features/viewer/RestaurantViewer";
import { useOrderFlow } from "./hooks/useOrderFlow";
import { useRestaurantEditor } from "./hooks/useRestaurantEditor";
import { useRestaurantViewer } from "./hooks/useRestaurantViewer";

const CLARIVORE_LOGO_SRC =
  "https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png";

function isTruthyFlag(value) {
  return /^(1|true|yes|editor)$/i.test(String(value || ""));
}

function readManagerModeDefault({ editParam, isQrVisit }) {
  if (isTruthyFlag(editParam)) return "editor";
  if (editParam !== null) return "viewer";
  if (isQrVisit) return "viewer";

  try {
    return localStorage.getItem("clarivoreManagerMode") === "editor"
      ? "editor"
      : "viewer";
  } catch {
    return "viewer";
  }
}

function trackRecentlyViewed(slug) {
  if (!slug) return;
  try {
    const current = JSON.parse(
      localStorage.getItem("recentlyViewedRestaurants") || "[]",
    );
    const filtered = Array.isArray(current)
      ? current.filter((value) => value !== slug)
      : [];
    filtered.unshift(slug);
    localStorage.setItem(
      "recentlyViewedRestaurants",
      JSON.stringify(filtered.slice(0, 10)),
    );
  } catch {
    // Ignore local storage failures.
  }
}

function isMissingSessionError(error) {
  const message = String(error?.message || "");
  if (!message) return false;
  return /auth session missing|session missing|refresh token/i.test(message);
}

function readSessionSavedPreferences(config) {
  const output = { allergies: [], diets: [] };
  if (typeof window === "undefined" || !config) {
    return output;
  }

  try {
    const parsed = JSON.parse(sessionStorage.getItem("qrAllergies") || "[]");
    if (Array.isArray(parsed)) {
      output.allergies = parsed
        .map((value) => config.normalizeAllergen(value))
        .filter(Boolean);
    }
  } catch {
    output.allergies = [];
  }

  try {
    const parsed = JSON.parse(sessionStorage.getItem("qrDiets") || "[]");
    if (Array.isArray(parsed)) {
      output.diets = parsed
        .map((value) => config.normalizeDietLabel(value))
        .filter(Boolean);
    }
  } catch {
    output.diets = [];
  }

  return output;
}

async function loadRestaurantBoot({ slug, isQrVisit, inviteToken }) {
  if (!supabase) {
    throw new Error("Supabase env vars are missing.");
  }

  if (!slug) {
    throw new Error("No restaurant specified.");
  }

  trackRecentlyViewed(slug);

  const config = await loadAllergenDietConfig(supabase);
  const sessionSavedPreferences = readSessionSavedPreferences(config);

  if (slug === HOW_IT_WORKS_SLUG) {
    const managerRestaurants = [];
    const payload = await buildTrainingRestaurantPayload({
      supabaseClient: supabase,
      isQrVisit,
      managerRestaurants,
    });

    return {
      config,
      restaurant: payload.restaurant,
      user: payload.user,
      allergies: payload.allergies || [],
      diets: payload.diets || [],
      canEdit: false,
      managerRestaurants,
      lovedDishNames: [],
      redirect: "",
      inviteToken,
      isHowItWorks: true,
    };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  let user = userData?.user || null;
  if (userError) {
    if (isMissingSessionError(userError)) {
      user = null;
    } else {
      throw userError;
    }
  }

  const { data: restaurant, error: restaurantError } = await supabase
    .from("restaurants")
    .select("*")
    .eq("slug", slug)
    .single();

  if (restaurantError || !restaurant) {
    throw new Error(restaurantError?.message || "Restaurant not found.");
  }

  let allergies = sessionSavedPreferences.allergies;
  let diets = sessionSavedPreferences.diets;
  let canEdit = false;
  let managerRestaurants = [];
  let lovedDishNames = [];

  if (user) {
    const isOwner = isOwnerUser(user);
    const isManager = isManagerUser(user);

    const [{ data: allergyRecord }, { data: managerRecord, error: managerError }] =
      await Promise.all([
        supabase
          .from("user_allergies")
          .select("allergens, diets")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("restaurant_managers")
          .select("id")
          .eq("user_id", user.id)
          .eq("restaurant_id", restaurant.id)
          .maybeSingle(),
      ]);

    if (managerError) {
      console.error("[restaurant] manager lookup failed", managerError);
    }

    const dbAllergies = Array.isArray(allergyRecord?.allergens)
      ? allergyRecord.allergens
      : [];
    const dbDiets = Array.isArray(allergyRecord?.diets) ? allergyRecord.diets : [];

    // Prefer authenticated profile data; if absent, preserve session QR selections.
    if (dbAllergies.length || dbDiets.length) {
      allergies = dbAllergies;
      diets = dbDiets;
    }

    canEdit =
      isOwner || Boolean(managerRecord) || restaurant.name === "Falafel Café";

    if (isManager || isOwner) {
      managerRestaurants = await fetchManagerRestaurants(supabase, user);
    }

    if (isManager && !isOwner && !managerRecord) {
      return {
        config,
        restaurant,
        user,
        allergies,
        diets,
        canEdit: false,
        managerRestaurants,
        lovedDishNames: [],
        redirect: "/restaurants",
        inviteToken,
        isHowItWorks: false,
      };
    }

    const { data: lovedRows } = await supabase
      .from("user_loved_dishes")
      .select("dish_name")
      .eq("user_id", user.id)
      .eq("restaurant_id", restaurant.id);

    lovedDishNames = Array.isArray(lovedRows)
      ? lovedRows
          .map((row) => String(row?.dish_name || "").trim())
          .filter(Boolean)
      : [];
  }

  return {
    config,
    restaurant,
    user: user
      ? {
          ...user,
          managerRestaurants,
        }
      : { loggedIn: false },
    allergies,
    diets,
    canEdit,
    managerRestaurants,
    lovedDishNames,
    redirect: "",
    inviteToken,
    isHowItWorks: false,
  };
}

export default function RestaurantClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { push: pushToast } = useToast();
  const searchParams = useSearchParams();

  const slug = searchParams?.get("slug") || "";
  const qrParam = searchParams?.get("qr");
  const inviteToken = searchParams?.get("invite") || "";
  const dishNameParam = searchParams?.get("dishName") || "";
  const editParam = searchParams?.get("edit") || searchParams?.get("mode");
  const isQrVisit = isTruthyFlag(qrParam);

  const [activeView, setActiveView] = useState("viewer");
  const [favoriteBusyDish, setFavoriteBusyDish] = useState("");

  const bootQuery = useQuery({
    queryKey: queryKeys.restaurant.boot(slug, inviteToken, isQrVisit),
    enabled: Boolean(supabase) && Boolean(slug),
    queryFn: async () =>
      loadRestaurantBoot({
        slug,
        isQrVisit,
        inviteToken,
      }),
    staleTime: 30 * 1000,
  });

  const boot = bootQuery.data;

  useEffect(() => {
    if (!boot?.redirect) return;
    router.replace(boot.redirect);
  }, [boot?.redirect, router]);

  useEffect(() => {
    if (!boot) return;
    const defaultMode = readManagerModeDefault({ editParam, isQrVisit });
    const nextMode = boot.canEdit ? defaultMode : "viewer";
    setActiveView(nextMode);
  }, [boot, editParam, isQrVisit]);

  const lovedDishesSet = useMemo(() => {
    return new Set(boot?.lovedDishNames || []);
  }, [boot?.lovedDishNames]);

  const saveOverlaysMutation = useMutation({
    mutationFn: async (nextOverlays) => {
      if (!supabase) throw new Error("Supabase is not configured.");
      if (!boot?.restaurant?.id) throw new Error("Restaurant missing.");

      const sanitized = Array.isArray(nextOverlays) ? nextOverlays : [];
      const { error } = await supabase
        .from("restaurants")
        .update({
          overlays: sanitized,
          last_confirmed: new Date().toISOString(),
        })
        .eq("id", boot.restaurant.id);

      if (error) throw error;
      return sanitized;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.restaurant.boot(slug, inviteToken, isQrVisit),
      });
      pushToast({
        tone: "success",
        title: "Saved",
        description: "Menu overlays were updated.",
      });
    },
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: async ({ dishName, shouldLove }) => {
      if (!supabase) throw new Error("Supabase is not configured.");
      const user = boot?.user;
      if (!user?.id) {
        throw new Error("Sign in to save loved dishes.");
      }
      if (!boot?.restaurant?.id) {
        throw new Error("Restaurant is not loaded yet.");
      }

      if (shouldLove) {
        const { error } = await supabase.from("user_loved_dishes").upsert(
          {
            user_id: user.id,
            restaurant_id: boot.restaurant.id,
            dish_name: dishName,
          },
          {
            onConflict: "user_id,restaurant_id,dish_name",
          },
        );
        if (error) throw error;
        return { dishName, loved: true };
      }

      const { error } = await supabase
        .from("user_loved_dishes")
        .delete()
        .eq("user_id", user.id)
        .eq("restaurant_id", boot.restaurant.id)
        .eq("dish_name", dishName);

      if (error) throw error;
      return { dishName, loved: false };
    },
    onSuccess: (result) => {
      queryClient.setQueryData(
        queryKeys.restaurant.boot(slug, inviteToken, isQrVisit),
        (current) => {
          if (!current) return current;
          const lovedSet = new Set(current.lovedDishNames || []);
          if (result.loved) {
            lovedSet.add(result.dishName);
          } else {
            lovedSet.delete(result.dishName);
          }
          return {
            ...current,
            lovedDishNames: Array.from(lovedSet),
          };
        },
      );
      pushToast({
        tone: result.loved ? "success" : "neutral",
        title: result.loved ? "Loved dish saved" : "Loved dish removed",
        description: result.dishName,
      });
    },
  });

  const orderFlow = useOrderFlow({
    restaurantId: boot?.restaurant?.id,
    user: boot?.user,
    overlays: boot?.restaurant?.overlays || [],
    preferences: {
      allergies: boot?.allergies || [],
      diets: boot?.diets || [],
    },
  });

  const viewer = useRestaurantViewer({
    restaurant: boot?.restaurant,
    overlays: boot?.restaurant?.overlays || [],
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
      onToggleFavoriteDish: async (dish) => {
        const dishName = String(dish?.id || dish?.name || "").trim();
        if (!dishName) return;
        const shouldLove = !lovedDishesSet.has(dishName);

        try {
          setFavoriteBusyDish(dishName);
          await toggleFavoriteMutation.mutateAsync({ dishName, shouldLove });
        } catch (error) {
          pushToast({
            tone: "danger",
            title: "Favorite update failed",
            description:
              error?.message || "Unable to update favorite right now.",
          });
        } finally {
          setFavoriteBusyDish("");
        }
      },
    },
  });

  const editor = useRestaurantEditor({
    restaurant: boot?.restaurant,
    overlays: boot?.restaurant?.overlays || [],
    permissions: {
      canEdit: boot?.canEdit,
    },
    callbacks: {
      onSave: (nextOverlays) => saveOverlaysMutation.mutateAsync(nextOverlays),
    },
  });

  const onSignOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.replace("/account?mode=signin");
  }, [router]);

  const setMode = useCallback((nextMode) => {
    const normalized = nextMode === "editor" ? "editor" : "viewer";
    setActiveView(normalized);
    try {
      localStorage.setItem(
        "clarivoreManagerMode",
        normalized === "editor" ? "editor" : "viewer",
      );
    } catch {
      // Ignore local storage failures.
    }
  }, []);

  const isViewerMode = !(activeView === "editor" && boot?.canEdit);

  useEffect(() => {
    if (!boot?.restaurant || !isViewerMode) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [boot?.restaurant, isViewerMode]);

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
    return (
      <PageShell>
        <p className="status-text">Loading restaurant...</p>
      </PageShell>
    );
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

  return (
    <PageShell
      shellClassName={isViewerMode ? "page-shell restaurant-legacy-shell" : "page-shell"}
      mainClassName={isViewerMode ? "page-main restaurant-legacy-main" : "page-main"}
      contentClassName={isViewerMode ? "restaurant-legacy-content" : ""}
      topbar={
        <header className="simple-topbar restaurant-legacy-topbar">
          <div className="restaurant-legacy-topbar-inner">
            <div className="restaurant-legacy-mode-slot">
              {boot?.canEdit ? (
                <button
                  type="button"
                  className="restaurant-legacy-mode-toggle"
                  onClick={() => setMode(activeView === "editor" ? "viewer" : "editor")}
                  aria-label={
                    activeView === "editor"
                      ? "Switch to customer mode"
                      : "Switch to editor mode"
                  }
                >
                  <span className="restaurant-legacy-mode-label">
                    {activeView === "editor" ? "Editor mode" : "Customer mode"}
                  </span>
                  <span
                    className={`mode-toggle ${activeView === "editor" ? "active" : ""}`}
                    role="switch"
                    aria-checked={activeView === "editor"}
                  />
                </button>
              ) : null}
            </div>

            <div className="restaurant-legacy-brand-nav">
              <Link className="simple-brand restaurant-legacy-brand" href="/home">
                <img src={CLARIVORE_LOGO_SRC} alt="Clarivore logo" />
                <span>Clarivore</span>
              </Link>
              <nav className="simple-nav restaurant-legacy-nav">
                <Link href="/home">Home</Link>
                <Link href="/restaurants">By restaurant ▾</Link>
                <Link href="/dish-search">By dish ▾</Link>
                <Link href="/help-contact">Help</Link>
                <Link href="/account">Account settings</Link>
              </nav>
            </div>

            <div className="restaurant-legacy-auth-slot">
              {boot?.user?.id ? (
                <button
                  type="button"
                  className="btnLink restaurant-legacy-signout"
                  onClick={onSignOut}
                >
                  Sign out
                </button>
              ) : (
                <Link href="/account?mode=signin" className="btnLink restaurant-legacy-signout">
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </header>
      }
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
        <RestaurantEditor editor={editor} />
      ) : (
        <RestaurantViewer
          restaurant={boot.restaurant}
          viewer={viewer}
          orderFlow={orderFlow}
          lovedDishes={lovedDishesSet}
          favoriteBusyDish={favoriteBusyDish}
        />
      )}
    </PageShell>
  );
}
