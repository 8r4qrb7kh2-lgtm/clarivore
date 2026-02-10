"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseClient as supabase } from "../lib/supabase";
import { OWNER_EMAIL, fetchManagerRestaurants } from "../lib/managerRestaurants";

function formatDate(dateValue) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString();
}

function dishKey(restaurantId, dishName) {
  return `${String(restaurantId)}:${dishName}`;
}

export default function MyDishesClient() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState({ text: "", tone: "" });
  const [bootError, setBootError] = useState("");
  const [isLoadingLoved, setIsLoadingLoved] = useState(true);
  const [isLoadingOrdered, setIsLoadingOrdered] = useState(true);
  const [lovedSections, setLovedSections] = useState([]);
  const [orderedSections, setOrderedSections] = useState([]);

  const showStatus = useCallback((text, tone = "") => {
    setStatus({ text, tone });
    if (!text) return;
    window.setTimeout(() => {
      setStatus((current) => (current.text === text ? { text: "", tone: "" } : current));
    }, 3000);
  }, []);

  const loadLovedDishes = useCallback(
    async (authUser) => {
      if (!supabase || !authUser?.id) return;
      try {
        setIsLoadingLoved(true);
        const { data: lovedDishesData, error: lovedError } = await supabase
          .from("user_loved_dishes")
          .select("restaurant_id, dish_name, created_at")
          .eq("user_id", authUser.id)
          .order("created_at", { ascending: false });
        if (lovedError) throw lovedError;

        const rows = Array.isArray(lovedDishesData) ? lovedDishesData : [];
        const lovedKeys = new Set(
          rows.map((row) => dishKey(row.restaurant_id, row.dish_name)),
        );
        if (!rows.length) {
          setLovedSections([]);
          return lovedKeys;
        }

        const restaurantIds = [...new Set(rows.map((row) => row.restaurant_id).filter(Boolean))];
        const { data: restaurantsData, error: restaurantsError } = await supabase
          .from("restaurants")
          .select("id, name, slug")
          .in("id", restaurantIds);
        if (restaurantsError) throw restaurantsError;

        const restaurantsMap = new Map();
        (restaurantsData || []).forEach((row) => {
          restaurantsMap.set(String(row.id), {
            id: row.id,
            name: row.name || "Unknown Restaurant",
            slug: row.slug || "",
          });
        });

        const grouped = new Map();
        rows.forEach((row) => {
          const key = String(row.restaurant_id);
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key).push(row);
        });

        const sections = [...grouped.entries()]
          .sort((a, b) => b[1].length - a[1].length)
          .map(([restaurantId, dishes]) => {
            const restaurant = restaurantsMap.get(restaurantId) || {
              id: restaurantId,
              name: "Unknown Restaurant",
              slug: "",
            };
            return {
              restaurantId,
              restaurantName: restaurant.name,
              restaurantSlug: restaurant.slug,
              dishes: dishes.map((dish) => ({
                restaurantId: dish.restaurant_id,
                dishName: dish.dish_name,
                createdAt: dish.created_at || null,
              })),
            };
          });

        setLovedSections(sections);
        return lovedKeys;
      } catch (error) {
        console.error("[my-dishes] failed to load loved dishes", error);
        showStatus("Failed to load favorite dishes.", "error");
        setLovedSections([]);
        return new Set();
      } finally {
        setIsLoadingLoved(false);
      }
    },
    [showStatus],
  );

  const loadPreviouslyOrderedDishes = useCallback(
    async (authUser, currentLovedKeys) => {
      if (!supabase || !authUser?.id) return;
      try {
        setIsLoadingOrdered(true);
        const { data: orders, error } = await supabase
          .from("tablet_orders")
          .select("restaurant_id, payload, created_at")
          .eq("status", "acknowledged")
          .eq("payload->>userId", authUser.id)
          .order("created_at", { ascending: false });
        if (error) throw error;

        const rows = Array.isArray(orders) ? orders : [];
        if (!rows.length) {
          setOrderedSections([]);
          return;
        }

        const uniqueDishes = new Map();
        rows.forEach((order) => {
          const payload = order.payload || {};
          const items = Array.isArray(payload.items) ? payload.items : [];
          items.forEach((dishName) => {
            const key = dishKey(order.restaurant_id, dishName);
            if (!uniqueDishes.has(key)) {
              uniqueDishes.set(key, {
                restaurantId: order.restaurant_id,
                dishName,
                createdAt: order.created_at || null,
                isLoved: currentLovedKeys.has(key),
              });
            }
          });
        });

        const dishRows = [...uniqueDishes.values()];
        if (!dishRows.length) {
          setOrderedSections([]);
          return;
        }

        const restaurantIds = [...new Set(dishRows.map((row) => row.restaurantId).filter(Boolean))];
        const { data: restaurantsData, error: restaurantsError } = await supabase
          .from("restaurants")
          .select("id, name, slug")
          .in("id", restaurantIds);
        if (restaurantsError) throw restaurantsError;

        const restaurantsMap = new Map();
        (restaurantsData || []).forEach((row) => {
          restaurantsMap.set(String(row.id), {
            id: row.id,
            name: row.name || "Unknown Restaurant",
            slug: row.slug || "",
          });
        });

        const grouped = new Map();
        const restaurantLatest = new Map();
        dishRows.forEach((row) => {
          const restaurantId = String(row.restaurantId);
          if (!grouped.has(restaurantId)) grouped.set(restaurantId, []);
          grouped.get(restaurantId).push(row);
          const existing = restaurantLatest.get(restaurantId);
          if (!existing || new Date(row.createdAt) > new Date(existing)) {
            restaurantLatest.set(restaurantId, row.createdAt);
          }
        });

        const sections = [...grouped.entries()]
          .sort((a, b) => {
            const aDate = new Date(restaurantLatest.get(a[0]) || 0).getTime();
            const bDate = new Date(restaurantLatest.get(b[0]) || 0).getTime();
            return bDate - aDate;
          })
          .map(([restaurantId, dishes]) => {
            const restaurant = restaurantsMap.get(restaurantId) || {
              id: restaurantId,
              name: "Unknown Restaurant",
              slug: "",
            };
            const sortedDishes = dishes
              .slice()
              .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            return {
              restaurantId,
              restaurantName: restaurant.name,
              restaurantSlug: restaurant.slug,
              dishes: sortedDishes,
            };
          });

        setOrderedSections(sections);
      } catch (error) {
        console.error("[my-dishes] failed to load order history", error);
        showStatus("Failed to load order history.", "error");
        setOrderedSections([]);
      } finally {
        setIsLoadingOrdered(false);
      }
    },
    [showStatus],
  );

  const reloadData = useCallback(
    async (authUser) => {
      const lovedKeys = await loadLovedDishes(authUser);
      await loadPreviouslyOrderedDishes(authUser, lovedKeys || new Set());
    },
    [loadLovedDishes, loadPreviouslyOrderedDishes],
  );

  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        if (!supabase) {
          throw new Error("Supabase env vars are missing.");
        }

        const {
          data: { user: authUser },
          error: authError,
        } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!authUser) {
          router.replace("/account?redirect=my-dishes");
          return;
        }

        const isOwner = authUser.email === OWNER_EMAIL;
        const isManager = authUser.user_metadata?.role === "manager";
        const managerRestaurants =
          isManager || isOwner
            ? await fetchManagerRestaurants(supabase, authUser)
            : [];

        if (isManager && !isOwner) {
          const targetRestaurant = managerRestaurants[0];
          router.replace(
            targetRestaurant
            ? `/restaurant?slug=${encodeURIComponent(targetRestaurant.slug)}`
            : "/server-tablet",
          );
          return;
        }
        if (!isMounted) return;
        setUser(authUser);
        await reloadData(authUser);
      } catch (error) {
        console.error("[my-dishes] boot failed", error);
        if (isMounted) {
          setBootError(error?.message || "Failed to load My Dishes.");
          setIsLoadingLoved(false);
          setIsLoadingOrdered(false);
        }
      }
    }

    init();
    return () => {
      isMounted = false;
    };
  }, [reloadData, router]);

  const isManagerOrOwner =
    user?.email === OWNER_EMAIL || user?.user_metadata?.role === "manager";

  const onSignOut = useCallback(async () => {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
      router.replace("/account?mode=signin");
    } catch (error) {
      console.error("[my-dishes] sign-out failed", error);
      showStatus("Unable to sign out right now.", "error");
    }
  }, [router, showStatus]);

  const onUnloveDish = useCallback(
    async (restaurantId, dishName) => {
      if (!supabase || !user?.id || !restaurantId || !dishName) return;
      try {
        const { error } = await supabase
          .from("user_loved_dishes")
          .delete()
          .eq("user_id", user.id)
          .eq("restaurant_id", restaurantId)
          .eq("dish_name", dishName);
        if (error) throw error;

        setLovedSections((sections) =>
          sections
            .map((section) => ({
              ...section,
              dishes: section.dishes.filter(
                (dish) =>
                  !(
                    String(dish.restaurantId) === String(restaurantId) &&
                    dish.dishName === dishName
                  ),
              ),
            }))
            .filter((section) => section.dishes.length > 0),
        );

        setOrderedSections((sections) =>
          sections.map((section) => ({
            ...section,
            dishes: section.dishes.map((dish) =>
              String(dish.restaurantId) === String(restaurantId) &&
              dish.dishName === dishName
                ? { ...dish, isLoved: false }
                : dish,
            ),
          })),
        );

        showStatus("Dish removed from favorites", "success");
      } catch (error) {
        console.error("[my-dishes] failed to remove favorite", error);
        showStatus("Failed to remove dish", "error");
      }
    },
    [showStatus, user],
  );

  const renderDish = useCallback((dish, restaurantSlug, canUnlove = false) => {
    const dishUrl = `/restaurant?slug=${encodeURIComponent(
      restaurantSlug || "",
    )}&dishName=${encodeURIComponent(dish.dishName)}`;
    return (
      <div
        className="dish-item"
        key={`${dish.restaurantId}:${dish.dishName}:${dish.createdAt || ""}`}
        onClick={() => {
          if (!restaurantSlug) return;
          router.push(dishUrl);
        }}
      >
        <span className="dish-name">{dish.dishName}</span>
        <span className="dish-actions">
          {canUnlove ? (
            <button
              className="unlove-btn"
              title="Remove from favorites"
              onClick={(event) => {
                event.stopPropagation();
                onUnloveDish(dish.restaurantId, dish.dishName);
              }}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
              Remove
            </button>
          ) : null}
          {dish.createdAt ? (
            <span className="dish-date">{formatDate(dish.createdAt)}</span>
          ) : null}
          <Link
            href={dishUrl}
            className="dish-launch-link"
            title="View dish details"
            onClick={(event) => event.stopPropagation()}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </Link>
        </span>
      </div>
    );
  }, [onUnloveDish, router]);

  const lovedEmpty = useMemo(
    () =>
      !isLoadingLoved && lovedSections.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: "1.1rem", marginBottom: 8 }}>
            No favorite dishes yet
          </p>
          <p style={{ marginBottom: 16 }}>
            Click the heart icon on any dish to save it.
          </p>
          <Link href="/dish-search" style={{ color: "var(--accent)", textDecoration: "none" }}>
            Search for dishes →
          </Link>
        </div>
      ) : null,
    [isLoadingLoved, lovedSections.length],
  );

  const orderedEmpty = useMemo(
    () =>
      !isLoadingOrdered && orderedSections.length === 0 ? (
        <div className="empty-state">No order history found.</div>
      ) : null,
    [isLoadingOrdered, orderedSections.length],
  );

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
            <Link href="/favorites">My restaurants</Link>
            <Link href="/dish-search">Dish search</Link>
            {isManagerOrOwner ? (
              <Link href="/manager-dashboard">Dashboard</Link>
            ) : null}
            <Link href="/help-contact">Help</Link>
            <button type="button" className="btnLink" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="page-main">
        <div className="page-content">
          <h1 style={{ textAlign: "center", marginBottom: 8 }}>My Dishes</h1>
          <p style={{ textAlign: "center", color: "var(--muted)", marginBottom: 32 }}>
            Your favorite and previously ordered dishes
          </p>

          {status.text ? (
            <p className={`status-text ${status.tone || ""}`}>{status.text}</p>
          ) : null}
          {bootError ? <p className="status-text error">{bootError}</p> : null}

          <div className="two-column-container">
            <div className="column">
              <div className="column-header">
                <h2>Loved Dishes</h2>
              </div>
              <p className="column-description">Dishes you have saved to your favorites</p>
              <div id="loved-dishes-container">
                {isLoadingLoved ? <div className="loading">Loading your favorite dishes...</div> : null}
                {!isLoadingLoved
                  ? lovedSections.map((section) => (
                      <div className="restaurant-section" key={`loved-${section.restaurantId}`}>
                        <div className="restaurant-section-header">
                          <h3 className="restaurant-section-name">
                            {section.restaurantSlug ? (
                              <Link href={`/restaurant?slug=${encodeURIComponent(section.restaurantSlug)}`}>
                                {section.restaurantName}
                              </Link>
                            ) : (
                              section.restaurantName
                            )}
                          </h3>
                          <span className="restaurant-dish-count">
                            {section.dishes.length} dish
                            {section.dishes.length !== 1 ? "es" : ""}
                          </span>
                        </div>
                        {section.dishes.map((dish) =>
                          renderDish(dish, section.restaurantSlug, true),
                        )}
                      </div>
                    ))
                  : null}
                {lovedEmpty}
              </div>
            </div>

            <div className="column">
              <div className="column-header">
                <h2>Previously Ordered</h2>
              </div>
              <p className="column-description">Dishes from your approved orders</p>
              <div id="ordered-dishes-container">
                {isLoadingOrdered ? <div className="loading">Loading your order history...</div> : null}
                {!isLoadingOrdered
                  ? orderedSections.map((section) => (
                      <div className="restaurant-section" key={`ordered-${section.restaurantId}`}>
                        <div className="restaurant-section-header">
                          <h3 className="restaurant-section-name">
                            {section.restaurantSlug ? (
                              <Link href={`/restaurant?slug=${encodeURIComponent(section.restaurantSlug)}`}>
                                {section.restaurantName}
                              </Link>
                            ) : (
                              section.restaurantName
                            )}
                          </h3>
                          <span className="restaurant-dish-count">
                            {section.dishes.length} dish
                            {section.dishes.length !== 1 ? "es" : ""}
                          </span>
                        </div>
                        {section.dishes.map((dish) =>
                          renderDish(dish, section.restaurantSlug, false),
                        )}
                      </div>
                    ))
                  : null}
                {orderedEmpty}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
