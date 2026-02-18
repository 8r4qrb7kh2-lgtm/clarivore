"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AppTopbar from "../components/AppTopbar";
import AppLoadingScreen from "../components/AppLoadingScreen";
import PageShell from "../components/PageShell";
import RestaurantCard from "../components/RestaurantCard";
import RestaurantGridState from "../components/RestaurantGridState";
import { loadAllergenDietConfig } from "../lib/allergenConfig";
import {
  isManagerUser,
  isOwnerUser,
  resolveManagerRestaurantAccess,
} from "../lib/managerRestaurants";
import { queryKeys } from "../lib/queryKeys";
import { hydrateRestaurantsWithTableMenuState } from "../lib/restaurantMenuStateClient";
import { filterRestaurantsByVisibility } from "../lib/restaurantVisibility";
import { supabaseClient as supabase } from "../lib/supabase";
import { createCompatibilityEngine } from "../restaurant/features/shared/compatibility";

function normalizeOverlays(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sortByName(restaurants) {
  return [...restaurants].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

function computeRestaurantFriendlyScore(restaurant, allergies, diets, engine) {
  const overlays = normalizeOverlays(restaurant?.overlays);
  if (!overlays.length) return -1;

  let safeCount = 0;
  let removableCount = 0;
  let totalCount = 0;

  overlays.forEach((overlay) => {
    const status = engine.computeStatus(overlay, allergies, diets);
    totalCount += 1;
    if (status === "safe") safeCount += 1;
    if (status === "removable") removableCount += 1;
  });

  if (!totalCount) return -1;
  return (safeCount + removableCount * 0.5) / totalCount;
}

export default function RestaurantsClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const isQR = searchParams?.get("qr") === "1";
  const [sortMode, setSortMode] = useState("name");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState("");
  const [busyFavoriteId, setBusyFavoriteId] = useState("");

  const authQuery = useQuery({
    queryKey: queryKeys.auth.user("restaurants"),
    queryFn: async () => {
      if (!supabase) return null;
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data?.user || null;
    },
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (isQR) return;
    if (authQuery.isError) {
      router.replace("/account?redirect=restaurants");
      return;
    }
    if (authQuery.isSuccess && !authQuery.data) {
      router.replace("/account?redirect=restaurants");
    }
  }, [authQuery.data, authQuery.isError, authQuery.isSuccess, isQR, router]);

  const managerAccessQuery = useQuery({
    queryKey: ["restaurants", "manager-access", { userId: authQuery.data?.id || null }],
    enabled: Boolean(supabase) && Boolean(authQuery.data) && !isQR,
    queryFn: async () => resolveManagerRestaurantAccess(supabase, authQuery.data),
    staleTime: 60 * 1000,
  });

  const favoritesQueryKey = ["restaurants", "favorite-ids", { userId: authQuery.data?.id || null }];

  const favoritesQuery = useQuery({
    queryKey: favoritesQueryKey,
    enabled: Boolean(supabase) && Boolean(authQuery.data) && !isQR,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_favorites")
        .select("restaurant_id")
        .eq("user_id", authQuery.data.id);

      if (error) throw error;
      return (data || [])
        .map((row) => String(row?.restaurant_id || "").trim())
        .filter(Boolean);
    },
    staleTime: 30 * 1000,
  });

  const preferenceQuery = useQuery({
    queryKey: ["restaurants", "preferences", { userId: authQuery.data?.id || null }],
    enabled: Boolean(supabase) && Boolean(authQuery.data) && !isQR,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_allergies")
        .select("allergens,diets")
        .eq("user_id", authQuery.data.id)
        .maybeSingle();

      if (error) throw error;
      return {
        allergens: Array.isArray(data?.allergens) ? data.allergens : [],
        diets: Array.isArray(data?.diets) ? data.diets : [],
      };
    },
    staleTime: 60 * 1000,
  });

  const configQuery = useQuery({
    queryKey: ["restaurants", "allergen-diet-config"],
    enabled: Boolean(supabase),
    queryFn: async () => loadAllergenDietConfig(supabase),
    staleTime: 5 * 60 * 1000,
  });

  const restaurantsQuery = useQuery({
    queryKey: [
      "restaurants",
      "page",
      {
        isQR,
        userId: authQuery.data?.id || null,
        managerReady:
          managerAccessQuery.isSuccess || managerAccessQuery.isError || !authQuery.data,
      },
    ],
    enabled:
      Boolean(supabase) &&
      (isQR || Boolean(authQuery.data)) &&
      (isQR || !authQuery.data || managerAccessQuery.isSuccess || managerAccessQuery.isError),
    queryFn: async () => {
      const user = authQuery.data || null;
      const managerAccess = managerAccessQuery.data || null;
      const isOwner = isOwnerUser(user);
      const isManager = isManagerUser(user);

      let query = supabase
        .from("restaurants")
        .select("id, name, slug, last_confirmed")
        .order("name", { ascending: true });

      if (isManager && !isOwner) {
        const managedIds = Array.isArray(managerAccess?.managedRestaurantIds)
          ? managerAccess.managedRestaurantIds.filter(Boolean)
          : [];
        if (!managedIds.length) return [];
        query = query.in("id", managedIds);
      }

      const { data, error } = await query;
      if (error) throw error;

      const list = await hydrateRestaurantsWithTableMenuState(
        supabase,
        Array.isArray(data) ? data : [],
      );
      return filterRestaurantsByVisibility(list, { user });
    },
    staleTime: 30 * 1000,
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: async ({ restaurantId, isFavorite }) => {
      if (!supabase) {
        throw new Error("Supabase env vars are missing.");
      }

      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (!user) {
        router.replace("/account?redirect=restaurants");
        return null;
      }

      if (isFavorite) {
        const { error } = await supabase
          .from("user_favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("restaurant_id", restaurantId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_favorites")
          .upsert(
            {
              user_id: user.id,
              restaurant_id: restaurantId,
            },
            { onConflict: "user_id,restaurant_id" },
          );
        if (error) throw error;
      }

      return { restaurantId: String(restaurantId), isFavorite };
    },
    onMutate: ({ restaurantId }) => {
      setBusyFavoriteId(String(restaurantId));
      setStatus("");
      setStatusTone("");
    },
    onSuccess: (result) => {
      if (!result) return;

      queryClient.setQueryData(favoritesQueryKey, (current) => {
        const next = new Set((current || []).map((item) => String(item)));
        if (result.isFavorite) {
          next.delete(result.restaurantId);
        } else {
          next.add(result.restaurantId);
        }
        return Array.from(next);
      });

      queryClient.invalidateQueries({
        queryKey: queryKeys.favorites.page(authQuery.data?.id || null),
      });

      setStatus(result.isFavorite ? "Removed from favorites." : "Added to favorites!");
      setStatusTone("success");
    },
    onError: (error) => {
      console.error("Favorite toggle failed", error);
      setStatus(error?.message || "Unable to update favorite.");
      setStatusTone("error");
    },
    onSettled: () => {
      setBusyFavoriteId("");
    },
  });

  useEffect(() => {
    if (!status) return undefined;
    const timer = window.setTimeout(() => {
      setStatus("");
      setStatusTone("");
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const user = authQuery.data || null;
  const isOwner = isOwnerUser(user);
  const isManager = isManagerUser(user);
  const managerAccess = managerAccessQuery.data || null;
  const restaurants = restaurantsQuery.data || [];
  const favoriteIds = favoritesQuery.data || [];
  const favoriteSet = useMemo(() => new Set(favoriteIds.map(String)), [favoriteIds]);
  const allergies = preferenceQuery.data?.allergens || [];
  const diets = preferenceQuery.data?.diets || [];

  const compatibilityEngine = useMemo(
    () =>
      createCompatibilityEngine({
        normalizeAllergen: configQuery.data?.normalizeAllergen,
        normalizeDietLabel: configQuery.data?.normalizeDietLabel,
        getDietAllergenConflicts: configQuery.data?.getDietAllergenConflicts,
      }),
    [
      configQuery.data?.getDietAllergenConflicts,
      configQuery.data?.normalizeAllergen,
      configQuery.data?.normalizeDietLabel,
    ],
  );

  const hasPreferenceFilters = allergies.length > 0 || diets.length > 0;
  const sortedRestaurants = useMemo(() => {
    if (sortMode === "last_confirmed") {
      return [...restaurants].sort((a, b) => {
        const aDate = a?.last_confirmed ? new Date(a.last_confirmed).getTime() : 0;
        const bDate = b?.last_confirmed ? new Date(b.last_confirmed).getTime() : 0;
        return bDate - aDate;
      });
    }

    if (sortMode === "friendly" && hasPreferenceFilters) {
      return [...restaurants].sort((a, b) => {
        const aScore = computeRestaurantFriendlyScore(
          a,
          allergies,
          diets,
          compatibilityEngine,
        );
        const bScore = computeRestaurantFriendlyScore(
          b,
          allergies,
          diets,
          compatibilityEngine,
        );
        if (bScore !== aScore) return bScore - aScore;
        return (a?.name || "").localeCompare(b?.name || "");
      });
    }

    return sortByName(restaurants);
  }, [allergies, compatibilityEngine, diets, hasPreferenceFilters, restaurants, sortMode]);

  const queryStatus = !supabase
    ? "Supabase env vars are missing."
    : restaurantsQuery.isError
      ? restaurantsQuery.error?.message || "Error loading restaurants."
      : "";

  const friendlySortStatus =
    sortMode === "friendly" && !hasPreferenceFilters
      ? "Add allergens or diets in account settings to use this sort."
      : "";

  const effectiveStatus = status || queryStatus || friendlySortStatus;
  const effectiveStatusTone = statusTone || (queryStatus || friendlySortStatus ? "error" : "");

  const emptyText =
    isManager && !isOwner
      ? "No restaurants assigned to your account yet."
      : "No restaurants yet. Encourage your favorite spots to join!";

  const canFavorite = Boolean(user?.id) && !isManager;

  const onSignOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.replace("/account?mode=signin");
  }, [router]);

  const loading =
    authQuery.isPending ||
    managerAccessQuery.isPending ||
    restaurantsQuery.isPending ||
    favoritesQuery.isPending ||
    preferenceQuery.isPending ||
    configQuery.isPending;

  if (loading) {
    return <AppLoadingScreen label="restaurants" />;
  }

  const toggleFavorite = (restaurantId) => {
    if (!restaurantId || busyFavoriteId) return;

    const restaurantKey = String(restaurantId);
    const isFavorite = favoriteSet.has(restaurantKey);
    toggleFavoriteMutation.mutate({
      restaurantId: restaurantKey,
      isFavorite,
    });
  };

  return (
    <PageShell
      topbar={
        <AppTopbar
          mode="customer"
          user={user || null}
          showAuthAction={!isQR}
          onSignOut={!isQR ? onSignOut : undefined}
        />
      }
    >
      <h1 style={{ textAlign: "center", marginBottom: 8 }}>All restaurants</h1>
      <RestaurantGridState
        status={effectiveStatus}
        statusTone={effectiveStatusTone}
        statusId="restaurant-status"
        statusMarginBottom={16}
        betweenContent={
          <select
            id="sort-select"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value)}
            style={{
              display: "block",
              maxWidth: 300,
              margin: "0 auto 20px",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--panel)",
              color: "var(--text)",
            }}
          >
            <option value="name">Sort: Name (A-Z)</option>
            <option value="last_confirmed">Sort: Allergens last confirmed</option>
            <option value="friendly">Sort: Most allergy/diet friendly</option>
          </select>
        }
        loading={loading}
        loadingText="Loading restaurants..."
        restaurants={sortedRestaurants}
        emptyText={emptyText}
        renderRestaurant={(restaurant) => {
          const restaurantKey = restaurant?.id ? String(restaurant.id) : "";
          const isFavorite = restaurantKey && favoriteSet.has(restaurantKey);

          return (
            <RestaurantCard
              key={restaurant.id}
              restaurant={restaurant}
              confirmationShowAll={isOwner || isManager}
              confirmationUseMonthLabel
              mediaOverlay={
                canFavorite && restaurantKey ? (
                  <button
                    className={`favorite-toggle${isFavorite ? " is-active" : ""}`}
                    type="button"
                    aria-pressed={isFavorite}
                    aria-label={
                      isFavorite ? "Remove from favorites" : "Add to favorites"
                    }
                    disabled={busyFavoriteId === restaurantKey}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleFavorite(restaurantKey);
                    }}
                  >
                    {isFavorite ? "★" : "☆"}
                  </button>
                ) : null
              }
            />
          );
        }}
      />
    </PageShell>
  );
}
