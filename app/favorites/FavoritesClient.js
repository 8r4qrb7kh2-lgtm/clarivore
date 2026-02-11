"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageShell from "../components/PageShell";
import RestaurantCard from "../components/RestaurantCard";
import RestaurantGridState from "../components/RestaurantGridState";
import SimpleTopbar from "../components/SimpleTopbar";
import {
  fetchManagerRestaurants,
  isManagerUser,
  isOwnerUser,
} from "../lib/managerRestaurants";
import { queryKeys } from "../lib/queryKeys";
import { filterRestaurantsByVisibility } from "../lib/restaurantVisibility";
import { supabaseClient as supabase } from "../lib/supabase";
import { createDinerTopbarLinks } from "../lib/topbarLinks";

export default function FavoritesClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const isQR = searchParams?.get("qr") === "1";

  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("");
  const [busyId, setBusyId] = useState(null);

  const authQuery = useQuery({
    queryKey: queryKeys.auth.user("favorites"),
    queryFn: async () => {
      if (!supabase) return null;
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data?.user || null;
    },
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (!isQR && authQuery.isSuccess && !authQuery.data) {
      router.replace("/account?redirect=favorites");
      return;
    }
    if (!isQR && authQuery.isError) {
      router.replace("/account?redirect=favorites");
    }
  }, [authQuery.data, authQuery.isError, authQuery.isSuccess, isQR, router]);

  const managerAccessQuery = useQuery({
    queryKey: [
      "favorites",
      "manager-access",
      { userId: authQuery.data?.id || null },
    ],
    enabled: Boolean(supabase) && Boolean(authQuery.data),
    queryFn: async () => {
      const user = authQuery.data;
      const isOwner = isOwnerUser(user);
      const isManager = isManagerUser(user);
      let managerRestaurants = [];

      if (isManager || isOwner) {
        managerRestaurants = await fetchManagerRestaurants(supabase, user);
      }

      return {
        isOwner,
        isManager,
        managerRestaurants,
      };
    },
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    const access = managerAccessQuery.data;
    if (!access) return;
    if (access.isManager && !access.isOwner) {
      const targetRestaurant = access.managerRestaurants[0];
      router.replace(
        targetRestaurant
          ? `/restaurant?slug=${encodeURIComponent(targetRestaurant.slug)}`
          : "/server-tablet",
      );
    }
  }, [managerAccessQuery.data, router]);

  const favoritesQuery = useQuery({
    queryKey: queryKeys.favorites.page(authQuery.data?.id || null),
    enabled:
      Boolean(supabase) &&
      Boolean(authQuery.data) &&
      !(managerAccessQuery.data?.isManager && !managerAccessQuery.data?.isOwner),
    queryFn: async () => {
      const user = authQuery.data;

      const { data: favorites, error: favoritesError } = await supabase
        .from("user_favorites")
        .select("restaurant_id")
        .eq("user_id", user.id);

      if (favoritesError) {
        throw new Error("Unable to load favorites.");
      }

      const ids = (favorites || [])
        .map((row) => row.restaurant_id)
        .filter(Boolean)
        .map((id) => String(id));

      if (!ids.length) {
        return {
          restaurants: [],
          favoriteIds: [],
        };
      }

      const { data: restaurantsData, error: restaurantsError } = await supabase
        .from("restaurants")
        .select("*")
        .in("id", ids)
        .order("name");

      if (restaurantsError) {
        throw new Error("Unable to load my restaurants.");
      }

      const filtered = filterRestaurantsByVisibility(restaurantsData || [], {
        user,
      });
      const visibleIds = new Set(filtered.map((restaurant) => String(restaurant.id)));

      return {
        restaurants: filtered,
        favoriteIds: ids.filter((id) => visibleIds.has(id)),
      };
    },
    staleTime: 60 * 1000,
  });

  const favoritesMutation = useMutation({
    mutationFn: async ({ restaurantId, isFavorite }) => {
      if (!supabase) {
        throw new Error("Supabase env vars are missing.");
      }

      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      if (!user) {
        router.replace("/account?redirect=favorites");
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
          .insert([{ user_id: user.id, restaurant_id: restaurantId }]);
        if (error) throw error;
      }

      return { restaurantId: String(restaurantId), isFavorite };
    },
    onMutate: ({ restaurantId }) => {
      setBusyId(String(restaurantId));
      setStatus("");
      setStatusType("");
    },
    onSuccess: (result) => {
      if (!result) return;
      queryClient.setQueryData(
        queryKeys.favorites.page(authQuery.data?.id || null),
        (current) => {
          const base = current || { restaurants: [], favoriteIds: [] };
          const favoriteIds = new Set((base.favoriteIds || []).map(String));
          let restaurants = Array.isArray(base.restaurants)
            ? [...base.restaurants]
            : [];

          if (result.isFavorite) {
            favoriteIds.delete(result.restaurantId);
            restaurants = restaurants.filter(
              (restaurant) => String(restaurant.id) !== result.restaurantId,
            );
          } else {
            favoriteIds.add(result.restaurantId);
          }

          return {
            ...base,
            restaurants,
            favoriteIds: Array.from(favoriteIds),
          };
        },
      );

      setStatus(result.isFavorite ? "Removed from favorites." : "Added to favorites!");
      setStatusType("success");
    },
    onError: (error) => {
      console.error("Favorite toggle failed", error);
      setStatus(error?.message || "Unable to update favorite.");
      setStatusType("error");
    },
    onSettled: () => {
      setBusyId(null);
    },
  });

  const loading =
    authQuery.isPending ||
    managerAccessQuery.isPending ||
    favoritesQuery.isPending;

  const queryStatus = !supabase
    ? "Supabase env vars are missing."
    : favoritesQuery.isError
      ? favoritesQuery.error?.message || "Unable to load favorites."
      : "";

  const effectiveStatus = status || queryStatus;
  const effectiveStatusType =
    statusType || (queryStatus ? "error" : "");

  const restaurants = favoritesQuery.data?.restaurants || [];
  const favoriteSet = useMemo(
    () => new Set((favoritesQuery.data?.favoriteIds || []).map(String)),
    [favoritesQuery.data?.favoriteIds],
  );

  const user = authQuery.data || null;

  const toggleFavorite = async (restaurantId) => {
    if (!restaurantId) return;
    if (busyId) return;

    const restaurantKey = String(restaurantId);
    const isFavorite = favoriteSet.has(restaurantKey);

    favoritesMutation.mutate({
      restaurantId: restaurantKey,
      isFavorite,
    });
  };

  const onSignOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.replace("/account?mode=signin");
  }, [router]);

  return (
    <PageShell
      contentClassName="favorite-container"
      topbar={
        <SimpleTopbar
          brandHref="/home"
          links={createDinerTopbarLinks({
            includeFavorites: false,
            includeDashboard: Boolean(managerAccessQuery.data?.hasAccess),
            dashboardVisible: Boolean(managerAccessQuery.data?.hasAccess),
          })}
          showAuthAction
          signedIn={Boolean(user?.id)}
          onSignOut={onSignOut}
        />
      }
    >
      <h1 style={{ textAlign: "center", marginBottom: 8 }}>My restaurants</h1>
      <RestaurantGridState
        status={effectiveStatus}
        statusTone={effectiveStatusType}
        loading={loading}
        loadingText="Loading favorites..."
        restaurants={restaurants}
        emptyText="No favorites yet. Add favorites from the All restaurants page."
        renderRestaurant={(restaurant) => {
          const restaurantKey = restaurant.id ? String(restaurant.id) : "";
          const isFavorite = restaurantKey && favoriteSet.has(restaurantKey);
          const showAll = isOwnerUser(user) || isManagerUser(user);

          return (
            <RestaurantCard
              key={restaurant.id}
              restaurant={restaurant}
              confirmationShowAll={showAll}
              mediaOverlay={
                restaurantKey ? (
                  <button
                    className={`favorite-toggle${isFavorite ? " is-active" : ""}`}
                    type="button"
                    aria-pressed={isFavorite}
                    aria-label={
                      isFavorite ? "Remove from favorites" : "Add to favorites"
                    }
                    disabled={busyId === restaurantKey}
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
