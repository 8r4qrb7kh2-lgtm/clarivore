"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageShell from "../components/PageShell";
import RestaurantCard from "../components/RestaurantCard";
import RestaurantGridState from "../components/RestaurantGridState";
import SimpleTopbar from "../components/SimpleTopbar";
import {
  fetchManagerRestaurants,
  isManagerUser,
  isOwnerUser,
} from "../lib/managerRestaurants";
import { filterRestaurantsByVisibility } from "../lib/restaurantVisibility";
import { supabaseClient as supabase } from "../lib/supabase";

export default function FavoritesClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isQR = searchParams?.get("qr") === "1";

  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("");
  const [loading, setLoading] = useState(true);
  const [restaurants, setRestaurants] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [busyId, setBusyId] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      if (!supabase) {
        setStatus("Supabase env vars are missing.");
        setLoading(false);
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) {
        console.error("Auth error", authError);
      }
      const user = authData?.user;
      if (!user && !isQR) {
        router.replace("/account?redirect=favorites");
        return;
      }
      if (!user) {
        setLoading(false);
        return;
      }
      if (isMounted) setUser(user);

      const isOwner = isOwnerUser(user);
      const isManager = isManagerUser(user);

      let managerRestaurants = [];
      if (isManager || isOwner) {
        managerRestaurants = await fetchManagerRestaurants(supabase, user);
      }

      if (isManager && !isOwner) {
        const targetRestaurant = managerRestaurants[0];
        router.replace(
          targetRestaurant
            ? `/restaurant?slug=${encodeURIComponent(targetRestaurant.slug)}`
            : "/server-tablet",
        );
        return;
      }

      try {
        setLoading(true);
        const { data: favorites, error: favoritesError } = await supabase
          .from("user_favorites")
          .select("restaurant_id")
          .eq("user_id", user.id);

        if (favoritesError) {
          console.error("Failed to load favorites", favoritesError);
          if (isMounted) {
            setStatus("Unable to load favorites.");
            setStatusType("error");
            setRestaurants([]);
          }
          return;
        }

        const ids = (favorites || [])
          .map((row) => row.restaurant_id)
          .filter(Boolean);
        const nextFavorites = new Set(ids.map(String));
        if (isMounted) setFavoriteIds(nextFavorites);

        if (!ids.length) {
          if (isMounted) setRestaurants([]);
          return;
        }

        const { data: restaurantsData, error } = await supabase
          .from("restaurants")
          .select("*")
          .in("id", ids)
          .order("name");

        if (error) {
          console.error("Failed to load restaurant details", error);
          if (isMounted) {
            setStatus("Unable to load my restaurants.");
            setStatusType("error");
          }
          return;
        }

        const filtered = filterRestaurantsByVisibility(restaurantsData || [], {
          user,
        });

        if (isMounted) {
          setRestaurants(filtered);
          if (!filtered.length) {
            setFavoriteIds(new Set());
          }
        }
      } catch (error) {
        console.error("Favorites load failed", error);
        if (isMounted) {
          setStatus("Unable to load favorites.");
          setStatusType("error");
          setRestaurants([]);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, [isQR, router]);

  const favoriteSet = useMemo(() => favoriteIds, [favoriteIds]);

  const toggleFavorite = async (restaurantId) => {
    if (!supabase || !restaurantId) return;
    if (busyId) return;
    setBusyId(restaurantId);
    setStatus("");
    setStatusType("");

    try {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      if (!user) {
        router.replace("/account?redirect=favorites");
        return;
      }

      const isFavorite = favoriteSet.has(String(restaurantId));
      if (isFavorite) {
        const { error } = await supabase
          .from("user_favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("restaurant_id", restaurantId);
        if (error) throw error;

        setFavoriteIds((prev) => {
          const next = new Set(prev);
          next.delete(String(restaurantId));
          return next;
        });
        setRestaurants((prev) =>
          prev.filter((restaurant) => String(restaurant.id) !== String(restaurantId)),
        );
        setStatus("Removed from favorites.");
        setStatusType("success");
      } else {
        const { error } = await supabase
          .from("user_favorites")
          .insert([{ user_id: user.id, restaurant_id: restaurantId }]);
        if (error) throw error;
        setFavoriteIds((prev) => new Set(prev).add(String(restaurantId)));
        setStatus("Added to favorites!");
        setStatusType("success");
      }
    } catch (error) {
      console.error("Favorite toggle failed", error);
      setStatus(error.message || "Unable to update favorite.");
      setStatusType("error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageShell
      contentClassName="favorite-container"
      topbar={
        <SimpleTopbar
          brandHref="/home"
          links={[
            { href: "/home", label: "Home" },
            { href: "/restaurants", label: "Restaurants" },
            { href: "/dish-search", label: "Dish search" },
            { href: "/help-contact", label: "Help" },
            { href: "/account", label: "Account" },
          ]}
        />
      }
    >
      <h1 style={{ textAlign: "center", marginBottom: 8 }}>My restaurants</h1>
      <RestaurantGridState
        status={status}
        statusTone={statusType}
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
