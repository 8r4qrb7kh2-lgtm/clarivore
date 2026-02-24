"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AppTopbar from "../components/AppTopbar";
import AppLoadingScreen from "../components/AppLoadingScreen";
import PageShell from "../components/PageShell";
import RestaurantCard from "../components/RestaurantCard";
import RestaurantGridState from "../components/RestaurantGridState";
import RestaurantsMapPreview from "./RestaurantsMapPreview";
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
import {
  formatDistanceMiles,
  isValidUsZip,
  normalizeUsZip,
  resolveRestaurantDistanceData,
  sanitizeUsZipInput,
} from "./googleMapsLocation";

const ZIP_STORAGE_KEY = "clarivore:restaurants:zip";

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

export default function RestaurantsClient({ googleMapsApiKey = "" }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const isQR = searchParams?.get("qr") === "1";
  const [sortMode, setSortMode] = useState("distance");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState("");
  const [busyFavoriteId, setBusyFavoriteId] = useState("");
  const [zipCodeInput, setZipCodeInput] = useState("");
  const mapsApiKey = String(googleMapsApiKey || "").trim();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedZip = sanitizeUsZipInput(window.localStorage.getItem(ZIP_STORAGE_KEY));
    if (savedZip) {
      setZipCodeInput(savedZip);
    }
  }, []);

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
        .select("id, name, slug, last_confirmed, website, map_location")
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

  const normalizedZipCode = normalizeUsZip(zipCodeInput);
  const zipCodeValid = isValidUsZip(normalizedZipCode);
  const distanceSortActive = sortMode === "distance";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!zipCodeValid) return;
    window.localStorage.setItem(ZIP_STORAGE_KEY, normalizedZipCode);
  }, [normalizedZipCode, zipCodeValid]);

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
  const restaurantLocationFingerprint = useMemo(
    () =>
      restaurants
        .map((restaurant) =>
          [
            String(restaurant?.id || ""),
            String(restaurant?.name || ""),
            String(restaurant?.website || ""),
            String(restaurant?.map_location || ""),
          ].join(":"),
        )
        .join("|"),
    [restaurants],
  );

  const distanceLookupQuery = useQuery({
    queryKey: [
      "restaurants",
      "distance-lookup",
      {
        zipCode: normalizedZipCode,
        restaurantFingerprint: restaurantLocationFingerprint,
      },
    ],
    enabled:
      distanceSortActive &&
      zipCodeValid &&
      Boolean(mapsApiKey) &&
      restaurants.length > 0,
    queryFn: async () =>
      resolveRestaurantDistanceData({
        restaurants,
        zipCode: normalizedZipCode,
        apiKey: mapsApiKey,
      }),
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });

  const distanceByRestaurantId = distanceLookupQuery.data?.byRestaurantId || {};
  const mapPreviewLocations = useMemo(
    () =>
      [...(Array.isArray(distanceLookupQuery.data?.locations) ? distanceLookupQuery.data.locations : [])]
        .sort((a, b) => {
          const aDistance = Number.isFinite(a?.distanceMiles)
            ? Number(a.distanceMiles)
            : Number.POSITIVE_INFINITY;
          const bDistance = Number.isFinite(b?.distanceMiles)
            ? Number(b.distanceMiles)
            : Number.POSITIVE_INFINITY;
          return aDistance - bDistance;
        }),
    [distanceLookupQuery.data?.locations],
  );

  const sortedRestaurants = useMemo(() => {
    if (sortMode === "distance") {
      return [...restaurants].sort((a, b) => {
        const aId = String(a?.id || "");
        const bId = String(b?.id || "");
        const aDistance = Number.isFinite(distanceByRestaurantId[aId]?.distanceMiles)
          ? Number(distanceByRestaurantId[aId].distanceMiles)
          : Number.POSITIVE_INFINITY;
        const bDistance = Number.isFinite(distanceByRestaurantId[bId]?.distanceMiles)
          ? Number(distanceByRestaurantId[bId].distanceMiles)
          : Number.POSITIVE_INFINITY;
        if (aDistance !== bDistance) return aDistance - bDistance;
        return (a?.name || "").localeCompare(b?.name || "");
      });
    }

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
  }, [
    allergies,
    compatibilityEngine,
    diets,
    distanceByRestaurantId,
    hasPreferenceFilters,
    restaurants,
    sortMode,
  ]);

  const queryStatus = !supabase
    ? "Supabase env vars are missing."
    : restaurantsQuery.isError
      ? restaurantsQuery.error?.message || "Error loading restaurants."
      : "";

  const friendlySortStatus =
    sortMode === "friendly" && !hasPreferenceFilters
      ? "Add allergens or diets in account settings to use this sort."
      : "";

  const distanceSortStatus =
      !distanceSortActive
      ? ""
      : !mapsApiKey
        ? "Location sort needs a Google Maps API key."
        : !normalizedZipCode
          ? "Enter your ZIP code to sort restaurants by distance."
          : !zipCodeValid
            ? "Enter a valid US ZIP code (for example: 44114)."
            : distanceLookupQuery.isPending
              ? "Finding restaurant locations..."
              : distanceLookupQuery.isError
                ? distanceLookupQuery.error?.message ||
                  "Unable to look up restaurant locations."
                : !mapPreviewLocations.length
                  ? "No restaurant locations were matched for this ZIP code."
                  : "";

  const effectiveStatus =
    status || queryStatus || friendlySortStatus || distanceSortStatus;
  const effectiveStatusTone =
    statusTone ||
    (queryStatus || (distanceSortActive && distanceLookupQuery.isError)
      ? "error"
      : "");

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
          <div className="restaurants-toolbar">
            {distanceSortActive && zipCodeValid && mapsApiKey ? (
              <RestaurantsMapPreview
                apiKey={mapsApiKey}
                zipCode={normalizedZipCode}
                locations={mapPreviewLocations}
                isLoading={distanceLookupQuery.isPending}
              />
            ) : null}
            <div
              className={`restaurants-toolbar-controls${distanceSortActive ? "" : " is-single"}`}
            >
              <label className="restaurants-control" htmlFor="sort-select">
                <span>Sort</span>
                <select
                  id="sort-select"
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value)}
                >
                  <option value="name">Sort: Name (A-Z)</option>
                  <option value="distance">Sort: Nearest to me</option>
                  <option value="last_confirmed">Sort: Allergens last confirmed</option>
                  <option value="friendly">Sort: Most allergy/diet friendly</option>
                </select>
              </label>

              {distanceSortActive ? (
                <label className="restaurants-control" htmlFor="location-zip-input">
                  <span>ZIP code</span>
                  <input
                    id="location-zip-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    placeholder="Enter ZIP code"
                    value={zipCodeInput}
                    onChange={(event) =>
                      setZipCodeInput(sanitizeUsZipInput(event.target.value))
                    }
                    maxLength={10}
                  />
                </label>
              ) : null}
            </div>
          </div>
        }
        loading={loading}
        loadingText="Loading restaurants..."
        restaurants={sortedRestaurants}
        emptyText={emptyText}
        renderRestaurant={(restaurant) => {
          const restaurantKey = restaurant?.id ? String(restaurant.id) : "";
          const isFavorite = restaurantKey && favoriteSet.has(restaurantKey);
          const distanceInfo = distanceByRestaurantId[restaurantKey];
          const distanceMeta =
            sortMode === "distance" && restaurantKey
              ? distanceInfo
                ? `Distance: ${formatDistanceMiles(distanceInfo.distanceMiles)}`
                : zipCodeValid && !distanceLookupQuery.isPending
                  ? "Distance: unavailable"
                  : ""
              : "";
          const locationMeta =
            sortMode === "distance" && distanceInfo?.formattedAddress
              ? `Near: ${distanceInfo.formattedAddress}`
              : "";

          return (
            <RestaurantCard
              key={restaurant.id}
              restaurant={restaurant}
              confirmationShowAll={isOwner || isManager}
              confirmationUseMonthLabel
              additionalMeta={[distanceMeta, locationMeta]}
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
