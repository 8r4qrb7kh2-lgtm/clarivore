"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import SimpleTopbar from "../components/SimpleTopbar";
import {
  buildAllergenDietConfig,
  loadAllergenDietConfig,
} from "../lib/allergenConfig";
import {
  fetchManagerRestaurants,
  isManagerUser,
  isOwnerUser,
} from "../lib/managerRestaurants";
import {
  supabaseClient as supabase,
  supabaseAnonKey,
  supabaseUrl,
} from "../lib/supabase";

export default function DishSearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isQR = searchParams?.get("qr") === "1";

  const [config, setConfig] = useState(() => buildAllergenDietConfig());
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("");
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [userAllergies, setUserAllergies] = useState([]);
  const [userDiets, setUserDiets] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [favoriteRestaurantIds, setFavoriteRestaurantIds] = useState(new Set());
  const [selectedRestaurantIds, setSelectedRestaurantIds] = useState(new Set());
  const [dishViewCounts, setDishViewCounts] = useState({});
  const [includeAccommodated, setIncludeAccommodated] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [searchActive, setSearchActive] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const dropdownRef = useRef(null);

  const {
    normalizeAllergen,
    normalizeDietLabel,
    formatAllergenLabel,
    getAllergenEmoji,
    getDietEmoji,
    getDietAllergenConflicts,
  } = config;

  useEffect(() => {
    let isMounted = true;

    async function load() {
      if (!supabase) {
        setStatus("Supabase env vars are missing.");
        setStatusType("error");
        setLoading(false);
        return;
      }

      const { data: authData, error: authError } =
        await supabase.auth.getUser();
      if (authError) {
        console.error("Auth error", authError);
      }
      const currentUser = authData?.user;
      if (!currentUser && !isQR) {
        router.replace("/account?redirect=dish-search");
        return;
      }
      if (!currentUser) {
        setLoading(false);
        return;
      }

      if (isMounted) setUser(currentUser);

      const isOwner = isOwnerUser(currentUser);
      const isManager = isManagerUser(currentUser);

      let managerRestaurants = [];
      if (isManager || isOwner) {
        managerRestaurants = await fetchManagerRestaurants(supabase, currentUser);
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

      const loadedConfig = await loadAllergenDietConfig(supabase);
      if (isMounted) setConfig(loadedConfig);

      try {
        const { data: record } = await supabase
          .from("user_allergies")
          .select("allergens, diets")
          .eq("user_id", currentUser.id)
          .maybeSingle();

        const allergies = (record?.allergens || [])
          .map(loadedConfig.normalizeAllergen)
          .filter(Boolean);
        const diets = (record?.diets || [])
          .map(loadedConfig.normalizeDietLabel)
          .filter(Boolean);

        if (isMounted) {
          setUserAllergies(allergies);
          setUserDiets(diets);
        }
      } catch (error) {
        console.warn("Failed to load user preferences", error);
      }

      try {
        const { data: favorites, error } = await supabase
          .from("user_favorites")
          .select("restaurant_id")
          .eq("user_id", currentUser.id);
        if (!error) {
          if (isMounted) {
            setFavoriteRestaurantIds(
              new Set((favorites || []).map((row) => String(row.restaurant_id))),
            );
          }
        }
      } catch (error) {
        console.warn("Failed to load favorites", error);
      }

      try {
        const { data, error } = await supabase
          .from("restaurants")
          .select("id, name, slug, overlays")
          .order("name");
        if (!error) {
          if (isMounted) {
            setRestaurants(Array.isArray(data) ? data : []);
            setSelectedRestaurantIds(
              new Set((data || []).map((row) => String(row.id))),
            );
          }
        }
      } catch (error) {
        console.error("Failed to load restaurants", error);
      }

      try {
        const { data: interactions } = await supabase
          .from("dish_interactions")
          .select("restaurant_id, dish_name");
        if (isMounted) {
          const counts = {};
          (interactions || []).forEach((row) => {
            const key = `${row.restaurant_id}:${row.dish_name}`;
            counts[key] = (counts[key] || 0) + 1;
          });
          setDishViewCounts(counts);
        }
      } catch (error) {
        console.warn("Failed to load dish view counts", error);
      }

      if (isMounted) setLoading(false);
    }

    load();

    return () => {
      isMounted = false;
    };
  }, [isQR, router]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (event) => {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [dropdownOpen]);

  const dropdownLabel = useMemo(() => {
    const total = restaurants.length;
    const selected = selectedRestaurantIds.size;
    if (selected === 0) return "No restaurants";
    if (selected === total) return "All restaurants";
    return `${selected} restaurant${selected !== 1 ? "s" : ""} selected`;
  }, [restaurants.length, selectedRestaurantIds]);

  const restaurantOverlayMap = useMemo(() => {
    const map = new Map();
    restaurants.forEach((restaurant) => {
      map.set(
        String(restaurant.id),
        Array.isArray(restaurant.overlays) ? restaurant.overlays : [],
      );
    });
    return map;
  }, [restaurants]);

  const normalize = (value) => String(value || "").toLowerCase().trim();

  const hasCrossContamination = (item) => {
    if (!userAllergies.length) return false;
    if (item.noCrossContamination) return false;
    const cross = item.crossContamination || [];
    return cross.some((allergen) => {
      const normalized = normalizeAllergen(allergen);
      return normalized && userAllergies.includes(normalized);
    });
  };

  const computeStatus = (item) => {
    const allergens = (item.allergens || [])
      .map(normalizeAllergen)
      .filter(Boolean);
    const removable = new Set(
      (item.removable || [])
        .map((row) => normalizeAllergen(row.allergen))
        .filter(Boolean),
    );

    const hits = allergens.filter((allergen) => userAllergies.includes(allergen));
    const unsafeHits = hits.filter((allergen) => !removable.has(allergen));

    if (unsafeHits.length > 0 || hasCrossContamination(item)) {
      return "unsafe";
    }

    if (hits.length > 0) {
      return "removable";
    }

    if (userDiets.length > 0) {
      const itemDiets = new Set(
        (item.diets || []).map(normalizeDietLabel).filter(Boolean),
      );
      for (const diet of userDiets) {
        const conflicts = getDietAllergenConflicts(diet);
        const conflictingAllergens = conflicts.filter((allergen) =>
          allergens.includes(allergen),
        );
        const canBeMade =
          conflictingAllergens.length > 0 &&
          conflictingAllergens.every((allergen) => removable.has(allergen));
        const isMet = itemDiets.has(diet);
        if (!isMet && !canBeMade) {
          return "unsafe";
        }
      }
    }

    return "safe";
  };

  const buildAllSections = () => {
    if (!user || (userAllergies.length === 0 && userDiets.length === 0)) {
      return [];
    }
    const sections = [];
    restaurants.forEach((restaurant) => {
      const overlays = Array.isArray(restaurant.overlays)
        ? restaurant.overlays
        : [];
      if (!overlays.length) return;
      if (
        selectedRestaurantIds.size > 0 &&
        !selectedRestaurantIds.has(String(restaurant.id))
      ) {
        return;
      }

      const safeDishes = [];
      const accommodatedDishes = [];

      overlays.forEach((overlay) => {
        const dishName = overlay.name || overlay.id || "";
        if (!dishName) return;
        const status = computeStatus(overlay);
        const isSafe = status === "safe";
        const isAccommodated = status === "removable";
        if (!isSafe && !isAccommodated) return;
        if (isAccommodated && !includeAccommodated) return;

        const viewKey = `${restaurant.id}:${dishName}`;
        const viewCount = dishViewCounts[viewKey] || 0;
        const entry = {
          name: dishName,
          views: viewCount,
          restaurant_id: restaurant.id,
          restaurant_slug: restaurant.slug,
        };
        if (isSafe) safeDishes.push(entry);
        if (isAccommodated) accommodatedDishes.push(entry);
      });

      safeDishes.sort((a, b) => b.views - a.views);
      accommodatedDishes.sort((a, b) => b.views - a.views);

      const totalAvailable = includeAccommodated
        ? safeDishes.length + accommodatedDishes.length
        : safeDishes.length;
      if (!totalAvailable) return;

      sections.push({
        restaurant,
        safeDishes,
        accommodatedDishes: includeAccommodated ? accommodatedDishes : [],
        searchMatchDishes: [],
        totalDishes: totalAvailable,
      });
    });

    sections.sort((a, b) => b.totalDishes - a.totalDishes);
    return sections;
  };

  const findFullOverlayData = (dishName, restaurantId) => {
    const overlays = restaurantOverlayMap.get(String(restaurantId)) || [];
    if (!overlays.length) return null;
    const normalizedName = normalize(dishName);
    return (
      overlays.find((overlay) => {
        const overlayName = normalize(overlay.name || overlay.id || "");
        return (
          overlayName === normalizedName ||
          overlayName.includes(normalizedName) ||
          normalizedName.includes(overlayName)
        );
      }) || null
    );
  };

  const buildSearchSections = (results = searchResults) => {
    if (!results || !Array.isArray(results)) return [];
    const restaurantMap = new Map();

    results.forEach((result) => {
      if (
        selectedRestaurantIds.size > 0 &&
        !selectedRestaurantIds.has(String(result.restaurant_id))
      ) {
        return;
      }
      if (result.top_dishes && Array.isArray(result.top_dishes)) {
        result.top_dishes.forEach((dish) => {
          const overlay = findFullOverlayData(dish.name, result.restaurant_id);
          const aiStatus = dish.status || "";
          const isSafeByAI = aiStatus === "meets_all_requirements";
          const isAccommodatedByAI = aiStatus === "can_accommodate";
          const doesNotMeetDiet = aiStatus === "does_not_meet_diet";

          const localStatus = overlay ? computeStatus(overlay) : null;
          const isSafe =
            isSafeByAI || (localStatus === "safe" && !doesNotMeetDiet);
          const isAccommodated =
            isAccommodatedByAI || (localStatus === "removable" && !doesNotMeetDiet);

          if (!isSafe && !isAccommodated && !doesNotMeetDiet) return;
          if (isAccommodated && !includeAccommodated && !doesNotMeetDiet) return;

          const restaurantKey = String(result.restaurant_id);
          if (!restaurantMap.has(restaurantKey)) {
            restaurantMap.set(restaurantKey, {
              restaurant: {
                id: result.restaurant_id,
                name: result.restaurant_name,
                slug: result.restaurant_slug,
              },
              safeDishes: [],
              accommodatedDishes: [],
              searchMatchDishes: [],
            });
          }

          const group = restaurantMap.get(restaurantKey);
          const viewKey = `${result.restaurant_id}:${dish.name}`;
          const viewCount = dishViewCounts[viewKey] || 0;
          const dishData = {
            name: dish.name,
            relevance_score: dish.relevance_score || 0,
            views: viewCount,
            overlay,
            doesNotMeetDiet,
          };

          if (doesNotMeetDiet) {
            group.searchMatchDishes.push(dishData);
          } else if (isSafe) {
            group.safeDishes.push(dishData);
          } else if (isAccommodated) {
            group.accommodatedDishes.push(dishData);
          }
        });
      }
    });

    const sections = Array.from(restaurantMap.values()).filter(
      (group) =>
        group.safeDishes.length ||
        group.accommodatedDishes.length ||
        group.searchMatchDishes.length,
    );

    sections.forEach((section) => {
      section.safeDishes.sort((a, b) => b.relevance_score - a.relevance_score);
      section.accommodatedDishes.sort(
        (a, b) => b.relevance_score - a.relevance_score,
      );
      section.searchMatchDishes.sort(
        (a, b) => b.relevance_score - a.relevance_score,
      );
      section.totalDishes =
        section.safeDishes.length +
        section.accommodatedDishes.length +
        section.searchMatchDishes.length;
    });

    sections.sort((a, b) => b.totalDishes - a.totalDishes);
    return sections;
  };

  const sections = useMemo(() => {
    if (searchActive) {
      return buildSearchSections(searchResults);
    }
    return buildAllSections();
  }, [
    searchActive,
    searchResults,
    restaurants,
    selectedRestaurantIds,
    includeAccommodated,
    userAllergies,
    userDiets,
    dishViewCounts,
    config,
  ]);

  const runSearch = async () => {
    const trimmed = (searchInput || "").trim();
    if (!trimmed) {
      setSearchResults(null);
      setSearchActive(false);
      setStatus("");
      setStatusType("");
      return;
    }

    setStatus("Searching menus...");
    setStatusType("");
    setSearchActive(true);
    setSearchResults([]);

    const payload = {
      userQuery: trimmed,
      userAllergens: userAllergies,
      userDiets,
    };

    try {
      let data = null;
      const invokeRes = await supabase.functions.invoke("ai-dish-search", {
        body: payload,
      });
      if (!invokeRes.error) {
        data = invokeRes.data;
      }

      if (!data && supabaseUrl && supabaseAnonKey) {
        const res = await fetch(`${supabaseUrl}/functions/v1/ai-dish-search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseAnonKey}`,
            apikey: supabaseAnonKey,
          },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          data = await res.json();
        }
      }

      if (data) {
        const results = Array.isArray(data.results) ? data.results : [];
        if (results.length > 0) {
          const filtered = buildSearchSections(results);
          setSearchResults(results);
          if (filtered.length > 0) {
            setStatus("Search complete.");
            setStatusType("success");
          } else {
            setStatus("No dishes found matching your search.");
            setStatusType("error");
          }
          return;
        }
      }

      setSearchResults([]);
      setStatus("No dishes found matching your search.");
      setStatusType("error");
    } catch (error) {
      console.error("Search failed", error);
      setStatus("Search failed. Please try again.");
      setStatusType("error");
    }
  };

  const handleSelectAll = () => {
    setSelectedRestaurantIds(
      new Set(restaurants.map((row) => String(row.id))),
    );
  };

  const handleClearAll = () => {
    setSelectedRestaurantIds(new Set());
  };

  const handleSelectFavorites = () => {
    setSelectedRestaurantIds(new Set(Array.from(favoriteRestaurantIds)));
  };

  const handleToggleRestaurant = (id) => {
    setSelectedRestaurantIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const showPreferences = userAllergies.length || userDiets.length;

  const emptyState = () => {
    if (searchActive) {
      return (
        <div className="empty-state" style={{ gridColumn: "1 / -1" }}>
          <p style={{ margin: 0 }}>No dishes found matching your search.</p>
        </div>
      );
    }
    if (userAllergies.length === 0 && userDiets.length === 0) {
      return (
        <div className="empty-state" style={{ gridColumn: "1 / -1" }}>
          <p style={{ margin: 0 }}>
            Set up your allergens and diets in your{" "}
            <Link href="/account" style={{ color: "var(--accent)" }}>
              account
            </Link>{" "}
            to see dishes you can eat.
          </p>
        </div>
      );
    }
    if (selectedRestaurantIds.size === 0) {
      return (
        <div className="empty-state" style={{ gridColumn: "1 / -1" }}>
          <p style={{ margin: 0 }}>
            No restaurants selected. Use the dropdown above to select
            restaurants.
          </p>
        </div>
      );
    }
    return null;
  };

  const handleDishNavigate = (slug, dishName) => {
    if (!slug) return;
    router.push(
      `/restaurant?slug=${encodeURIComponent(slug)}&dishName=${encodeURIComponent(
        dishName,
      )}`,
    );
  };

  return (
    <div className="page-shell">
      <SimpleTopbar
        brandHref="/home"
        links={[
          { href: "/home", label: "Home" },
          { href: "/restaurants", label: "Restaurants" },
          { href: "/favorites", label: "My restaurants" },
          { href: "/account", label: "Account" },
          { href: "/help-contact", label: "Help" },
        ]}
      />

      <main className="page-main">
        <div className="page-content">
          <h1
            style={{
              textAlign: "center",
              marginBottom: 16,
              fontSize: "clamp(1.6rem, 1.2rem + 1.2vw, 2.2rem)",
            }}
          >
            Dish search
          </h1>

          {showPreferences ? (
            <div
              id="user-preferences-display"
              style={{ maxWidth: 900, margin: "0 auto 24px" }}
            >
              <div className="preference-row">
                <div className="preference-panel pill">
                  <div className="preference-header">
                    <div className="preference-title">Saved allergens</div>
                    <Link href="/account" className="btnLink preference-edit">
                      Edit
                    </Link>
                  </div>
                  <div className="preference-chips chips">
                    {userAllergies.length ? (
                      userAllergies.map((allergen) => (
                        <span
                          key={allergen}
                          className="chip active preference-chip"
                        >
                          {getAllergenEmoji(allergen) || "⚠️"}{" "}
                          {formatAllergenLabel(allergen)}
                        </span>
                      ))
                    ) : (
                      <span className="note">
                        No saved allergens. Use "Edit saved allergens".
                      </span>
                    )}
                  </div>
                </div>
                <div className="preference-panel pill">
                  <div className="preference-header">
                    <div className="preference-title">Saved diets</div>
                    <Link href="/account" className="btnLink preference-edit">
                      Edit
                    </Link>
                  </div>
                  <div className="preference-chips chips">
                    {userDiets.length ? (
                      userDiets.map((diet) => (
                        <span
                          key={diet}
                          className="chip active preference-chip"
                        >
                          {getDietEmoji(diet) || "✓"} {diet}
                        </span>
                      ))
                    ) : (
                      <span className="note">
                        No saved diets. Use "Edit saved diets".
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="search-controls">
            <input
              id="search-input"
              type="text"
              placeholder="Describe what you want (e.g., spicy vegan noodles, nut-free dessert)"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runSearch();
              }}
            />
            <button type="button" className="cta-button" onClick={runSearch}>
              Search
            </button>
          </div>

          <div id="search-filters">
            <div
              className="filter-toggle"
              role="button"
              tabIndex={0}
              onClick={() => setIncludeAccommodated((prev) => !prev)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setIncludeAccommodated((prev) => !prev);
                }
              }}
            >
              <span>Include dishes that can be made to comply</span>
              <div
                className={`mode-toggle ${includeAccommodated ? "active" : ""}`}
                role="switch"
                aria-checked={includeAccommodated ? "true" : "false"}
              />
            </div>

            <div className="restaurant-dropdown" ref={dropdownRef}>
              <button
                type="button"
                id="restaurant-dropdown-btn"
                onClick={() => setDropdownOpen((prev) => !prev)}
              >
                <span id="restaurant-dropdown-label">{dropdownLabel}</span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="currentColor"
                >
                  <path d="M2 4l4 4 4-4z" />
                </svg>
              </button>
              {dropdownOpen ? (
                <div id="restaurant-dropdown-menu">
                  <div className="restaurant-dropdown-actions">
                    <button type="button" onClick={handleSelectAll}>
                      Select All
                    </button>
                    <button type="button" onClick={handleClearAll}>
                      Clear All
                    </button>
                    <button type="button" onClick={handleSelectFavorites}>
                      ⭐ Favorites
                    </button>
                  </div>
                  <div id="restaurant-checkboxes">
                    {restaurants.map((restaurant) => {
                      const id = String(restaurant.id);
                      const checked = selectedRestaurantIds.has(id);
                      return (
                        <label key={id} className="restaurant-checkbox-item">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleToggleRestaurant(id)}
                          />
                          <span>{restaurant.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <p className={`status-text ${statusType}`} style={{ textAlign: "center" }}>
            {status}
          </p>

          <div id="dish-results-container">
            {loading ? (
              <div className="empty-state">
                <p style={{ margin: 0 }}>Loading dishes...</p>
              </div>
            ) : sections.length ? (
              sections.map((section) => {
                const isSearchMode = searchActive;
                const safeDishes = isSearchMode
                  ? section.safeDishes
                  : section.safeDishes.slice(0, 10);
                const accommodatedDishes = isSearchMode
                  ? section.accommodatedDishes
                  : section.accommodatedDishes.slice(0, 10);
                const safeOverflow =
                  !isSearchMode && section.safeDishes.length > 10
                    ? section.safeDishes.length - 10
                    : 0;
                const accommodatedOverflow =
                  !isSearchMode && section.accommodatedDishes.length > 10
                    ? section.accommodatedDishes.length - 10
                    : 0;
                const totalDishes =
                  section.safeDishes.length +
                  section.accommodatedDishes.length +
                  (section.searchMatchDishes?.length || 0);

                const dishItem = (dish, slug) => (
                  <div
                    key={`${slug}-${dish.name}`}
                    className="restaurant-dish-item"
                    onClick={() => handleDishNavigate(slug, dish.name)}
                  >
                    <span className="restaurant-dish-name">{dish.name}</span>
                    <span className="restaurant-dish-views">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      {dish.views || 0}
                      <Link
                        href={`/restaurant?slug=${encodeURIComponent(
                          slug || "",
                        )}&dishName=${encodeURIComponent(dish.name)}`}
                        className="dish-launch-link"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <svg
                          width="12"
                          height="12"
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

                return (
                  <div key={section.restaurant?.id} className="restaurant-section">
                    <div className="restaurant-section-header">
                      <h3 className="restaurant-section-name">
                        <Link
                          href={`/restaurant?slug=${encodeURIComponent(
                            section.restaurant?.slug || "",
                          )}`}
                        >
                          {section.restaurant?.name}
                        </Link>
                      </h3>
                      <span className="restaurant-section-count">
                        {totalDishes} dish{totalDishes !== 1 ? "es" : ""} found
                      </span>
                    </div>
                    <div className="restaurant-section-columns">
                      <div className="restaurant-section-column">
                        <div className="restaurant-section-column-title">
                          <span className="safe-dot" />
                          Safe ({section.safeDishes.length})
                        </div>
                        {safeDishes.length ? (
                          safeDishes.map((dish) =>
                            dishItem(dish, section.restaurant?.slug),
                          )
                        ) : (
                          <p className="no-dishes-message">No safe dishes found</p>
                        )}
                        {safeOverflow ? (
                          <p className="section-overflow">
                            + {safeOverflow} more
                          </p>
                        ) : null}
                      </div>

                      {includeAccommodated && section.accommodatedDishes.length ? (
                        <div className="restaurant-section-column">
                          <div className="restaurant-section-column-title">
                            <span className="accommodated-dot" />
                            Can be accommodated ({section.accommodatedDishes.length})
                          </div>
                          {accommodatedDishes.map((dish) =>
                            dishItem(dish, section.restaurant?.slug),
                          )}
                          {accommodatedOverflow ? (
                            <p className="section-overflow">
                              + {accommodatedOverflow} more
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {isSearchMode && section.searchMatchDishes?.length ? (
                        <div className="restaurant-section-column">
                          <div className="restaurant-section-column-title">
                            <span className="search-match-dot" />
                            Matches search ({section.searchMatchDishes.length})
                          </div>
                          {section.searchMatchDishes.map((dish) =>
                            dishItem(dish, section.restaurant?.slug),
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              emptyState()
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
