"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

const OWNER_EMAIL = "matt.29.ds@gmail.com";
const DAY_MS = 24 * 60 * 60 * 1000;

function getWeeksAgoInfo(date, showAll = false) {
  if (!date) return { text: "Never", color: "#888", shouldHide: false };
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime()))
    return { text: "Never", color: "#888", shouldHide: false };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const compareDate = new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
  );

  const diffDays = Math.floor((today - compareDate) / DAY_MS);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffDays > 30 && !showAll) {
    return { text: null, color: null, shouldHide: true };
  }

  if (diffDays < 7) return { text: "this week", color: "#4caf50" };
  if (diffWeeks === 1) return { text: "last week", color: "#8bc34a" };
  if (diffWeeks === 2) return { text: "two weeks ago", color: "#ff9800" };
  if (diffWeeks === 3) return { text: "three weeks ago", color: "#f44336" };
  if (showAll) return { text: `${diffWeeks} weeks ago`, color: "#f44336" };
  return { text: "one month ago", color: "#f44336" };
}

async function fetchManagerRestaurants(user) {
  if (!supabase || !user?.id) return [];
  const isOwner = user.email === OWNER_EMAIL;

  if (isOwner) {
    const { data, error } = await supabase
      .from("restaurants")
      .select("id, name, slug")
      .order("name");
    if (error) {
      console.error("[favorites] failed to load owner restaurants", error);
      return [];
    }
    return (data || [])
      .filter((row) => row && row.id && row.slug)
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name || "Restaurant",
      }));
  }

  const { data: assignments, error } = await supabase
    .from("restaurant_managers")
    .select("restaurant_id")
    .eq("user_id", user.id);

  if (error) {
    console.error("[favorites] failed to load manager assignments", error);
    return [];
  }

  const restaurantIds = (assignments || [])
    .map((row) => row.restaurant_id)
    .filter(Boolean);

  if (!restaurantIds.length) return [];

  const { data: restaurants, error: restaurantError } = await supabase
    .from("restaurants")
    .select("id, name, slug")
    .in("id", restaurantIds);

  if (restaurantError) {
    console.error("[favorites] failed to load manager restaurants", restaurantError);
    return [];
  }

  return (restaurants || [])
    .filter((row) => row && row.id && row.slug)
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name || "Restaurant",
    }));
}

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

      const isOwner = user.email === OWNER_EMAIL;
      const isManager = user.user_metadata?.role === "manager";

      let managerRestaurants = [];
      if (isManager || isOwner) {
        managerRestaurants = await fetchManagerRestaurants(user);
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

        let filtered = restaurantsData || [];
        if (!isOwner && !isManager) {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          filtered = filtered.filter((restaurant) => {
            if (!restaurant.last_confirmed) return false;
            const lastConfirmed = new Date(restaurant.last_confirmed);
            return lastConfirmed >= thirtyDaysAgo;
          });
        }

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
    <div className="page-shell">
      <header className="simple-topbar">
        <div className="simple-topbar-inner">
          <Link className="simple-brand" href="/home">
            <img
              src="https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png"
              alt="Clarivore logo"
            />
            <span>Clarivore</span>
          </Link>
          <div className="simple-nav">
            <Link href="/home">Home</Link>
            <Link href="/restaurants">Restaurants</Link>
            <Link href="/dish-search">Dish search</Link>
            <Link href="/help-contact">Help</Link>
            <Link href="/account">Account</Link>
          </div>
        </div>
      </header>

      <main className="page-main">
        <div className="page-content favorite-container">
          <h1 style={{ textAlign: "center", marginBottom: 8 }}>
            My restaurants
          </h1>
          <p
            className={`status-text ${statusType}`}
            style={{ textAlign: "center" }}
          >
            {status}
          </p>
          <div className="restaurant-grid">
            {loading ? (
              <p
                style={{
                  color: "var(--muted)",
                  textAlign: "center",
                  gridColumn: "1 / -1",
                }}
              >
                Loading favorites...
              </p>
            ) : restaurants.length ? (
              restaurants.map((restaurant) => {
                const restaurantKey = restaurant.id
                  ? String(restaurant.id)
                  : "";
                const isFavorite = restaurantKey && favoriteSet.has(restaurantKey);
                const showAll =
                  user?.email === OWNER_EMAIL ||
                  user?.user_metadata?.role === "manager";
                const info = getWeeksAgoInfo(restaurant.last_confirmed, showAll);

                return (
                  <article key={restaurant.id} className="restaurant-card">
                    <div className="restaurant-card-media">
                      {restaurantKey && (
                        <button
                          className={`favorite-toggle${
                            isFavorite ? " is-active" : ""
                          }`}
                          type="button"
                          aria-pressed={isFavorite}
                          aria-label={
                            isFavorite
                              ? "Remove from favorites"
                              : "Add to favorites"
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
                      )}
                      <img
                        src={
                          restaurant.menu_image ||
                          "https://via.placeholder.com/400x300"
                        }
                        alt={restaurant.name || "Restaurant"}
                      />
                    </div>
                    <div className="restaurant-card-content">
                      <h3>{restaurant.name}</h3>
                      {info.text ? (
                        <p className="meta" style={{ color: info.color }}>
                          Last confirmed by staff: {info.text}
                        </p>
                      ) : null}
                      <Link
                        className="cta-button"
                        href={`/restaurant?slug=${encodeURIComponent(
                          restaurant.slug,
                        )}`}
                      >
                        View menu
                      </Link>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="empty-state" style={{ gridColumn: "1 / -1" }}>
                No favorites yet. Add favorites from the All restaurants page.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
