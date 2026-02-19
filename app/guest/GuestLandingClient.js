"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import AppLoadingScreen from "../components/AppLoadingScreen";
import GuestTopbar from "../components/GuestTopbar";
import PageShell from "../components/PageShell";
import FormSectionCard from "../components/forms/FormSectionCard";
import { loadAllergenDietConfig } from "../lib/allergenConfig";
import { hydrateRestaurantsWithTableMenuState } from "../lib/restaurantMenuStateClient";
import { supabaseClient as supabase } from "../lib/supabase";

const QR_ALLERGIES_KEY = "qrAllergies";
const QR_DIETS_KEY = "qrDiets";
const FALLBACK_MENU_IMAGE = "https://via.placeholder.com/400x300";

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeUnique(values, normalizeValue) {
  const seen = new Set();
  const output = [];

  (Array.isArray(values) ? values : []).forEach((value) => {
    const normalized = asText(
      typeof normalizeValue === "function" ? normalizeValue(value) : value,
    );
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(normalized);
  });

  return output;
}

function readSessionSelection(key, normalizeValue) {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) || "[]");
    return normalizeUnique(parsed, normalizeValue);
  } catch {
    return [];
  }
}

function saveSessionSelections({ allergies, diets }) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(QR_ALLERGIES_KEY, JSON.stringify(allergies));
    sessionStorage.setItem(QR_DIETS_KEY, JSON.stringify(diets));
  } catch {
    // Ignore storage failures; the viewer still loads with defaults.
  }
}

function toggleSelection(list, value) {
  return list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value];
}

export default function GuestLandingClient() {
  const router = useRouter();
  const [searchText, setSearchText] = useState("");
  const [selectedRestaurantSlug, setSelectedRestaurantSlug] = useState("");
  const [selectedAllergies, setSelectedAllergies] = useState([]);
  const [selectedDiets, setSelectedDiets] = useState([]);
  const [status, setStatus] = useState("");
  const initializedSelectionsRef = useRef(false);

  const bootQuery = useQuery({
    queryKey: ["guest-landing", "boot"],
    enabled: Boolean(supabase),
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (!supabase) {
        throw new Error("Supabase env vars are missing.");
      }

      const [{ data: userData }, config] = await Promise.all([
        supabase.auth.getUser(),
        loadAllergenDietConfig(supabase),
      ]);

      if (userData?.user) {
        return {
          redirect: "/home",
          config,
          restaurants: [],
        };
      }

      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, slug, last_confirmed")
        .order("name", { ascending: true });

      if (error) throw error;

      const restaurants = await hydrateRestaurantsWithTableMenuState(
        supabase,
        Array.isArray(data) ? data : [],
      );

      return {
        redirect: "",
        config,
        restaurants,
      };
    },
  });

  useEffect(() => {
    if (!bootQuery.data?.redirect) return;
    router.replace(bootQuery.data.redirect);
  }, [bootQuery.data?.redirect, router]);

  useEffect(() => {
    const config = bootQuery.data?.config;
    if (!config || initializedSelectionsRef.current) return;
    initializedSelectionsRef.current = true;

    setSelectedAllergies(
      readSessionSelection(QR_ALLERGIES_KEY, config.normalizeAllergen),
    );
    setSelectedDiets(
      readSessionSelection(QR_DIETS_KEY, config.normalizeDietLabel),
    );
  }, [bootQuery.data?.config]);

  const config = bootQuery.data?.config;
  const restaurants = bootQuery.data?.restaurants || [];
  const normalizedSearch = asText(searchText).toLowerCase();

  const filteredRestaurants = useMemo(() => {
    if (!normalizedSearch) return restaurants;
    return restaurants.filter((restaurant) =>
      asText(restaurant?.name).toLowerCase().includes(normalizedSearch),
    );
  }, [normalizedSearch, restaurants]);

  const selectedRestaurant = useMemo(
    () =>
      restaurants.find(
        (restaurant) => asText(restaurant?.slug) === asText(selectedRestaurantSlug),
      ) || null,
    [restaurants, selectedRestaurantSlug],
  );

  const onContinue = useCallback(() => {
    if (!selectedRestaurantSlug || !config) {
      setStatus("Choose a restaurant to continue.");
      return;
    }

    setStatus("");
    const normalizedAllergies = normalizeUnique(
      selectedAllergies,
      config.normalizeAllergen,
    );
    const normalizedDiets = normalizeUnique(selectedDiets, config.normalizeDietLabel);

    saveSessionSelections({
      allergies: normalizedAllergies,
      diets: normalizedDiets,
    });

    router.push(
      `/restaurant?slug=${encodeURIComponent(selectedRestaurantSlug)}&qr=1&guest=1`,
    );
  }, [config, router, selectedAllergies, selectedDiets, selectedRestaurantSlug]);

  const renderChips = useCallback(
    (items, selected, setSelected, formatter, emojiGetter) => (
      <div className="guest-chip-list">
        {items.map((item) => {
          const active = selected.includes(item);
          return (
            <button
              key={item}
              type="button"
              className={`chip guest-chip ${active ? "active" : ""}`.trim()}
              onClick={() => {
                setSelected((current) => toggleSelection(current, item));
              }}
            >
              {asText(emojiGetter(item) || "") ? `${emojiGetter(item)} ` : ""}
              {formatter(item)}
            </button>
          );
        })}
      </div>
    ),
    [],
  );

  if (!supabase) {
    return (
      <PageShell topbar={<GuestTopbar />}>
        <p className="status-text error">Supabase env vars are missing.</p>
      </PageShell>
    );
  }

  if (bootQuery.isPending || !config) {
    return <AppLoadingScreen label="guest landing" />;
  }

  if (bootQuery.isError) {
    return (
      <PageShell topbar={<GuestTopbar />}>
        <p className="status-text error">
          {bootQuery.error?.message || "Failed to load restaurants."}
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell shellClassName="page-shell route-guest" topbar={<GuestTopbar />}>
      <div className="guest-layout">
        <FormSectionCard className="guest-card">
          <header className="guest-header">
            <p className="guest-eyebrow">Guest Menu Access</p>
            <h1>Choose a restaurant, then set your allergens and diets</h1>
            <p className="guest-lead">
              We will open the restaurant menu with your selected preferences
              applied.
            </p>
          </header>

          <section className="guest-section">
            <div className="guest-section-head">
              <h2>Restaurants</h2>
              {selectedRestaurant ? (
                <p className="guest-selected-name">
                  Selected: {selectedRestaurant.name}
                </p>
              ) : null}
            </div>

            <label htmlFor="guest-restaurant-search" className="guest-search-label">
              Search restaurants
            </label>
            <input
              id="guest-restaurant-search"
              type="search"
              placeholder="Search the Clarivore restaurant library..."
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              className="guest-search-input"
            />

            {filteredRestaurants.length ? (
              <div className="guest-restaurant-grid">
                {filteredRestaurants.map((restaurant) => {
                  const restaurantSlug = asText(restaurant?.slug);
                  const isSelected = restaurantSlug === selectedRestaurantSlug;

                  return (
                    <button
                      key={restaurantSlug || restaurant?.id}
                      type="button"
                      className={`guest-restaurant-option ${
                        isSelected ? "is-selected" : ""
                      }`.trim()}
                      onClick={() => {
                        setSelectedRestaurantSlug(restaurantSlug);
                        setStatus("");
                      }}
                    >
                      <div className="guest-restaurant-option-media">
                        <img
                          src={restaurant?.menuImage || FALLBACK_MENU_IMAGE}
                          alt={restaurant?.name || "Restaurant"}
                        />
                      </div>
                      <span className="guest-restaurant-option-name">
                        {restaurant?.name || "Restaurant"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="status-text">No restaurants match your search.</p>
            )}
          </section>

          <section className="guest-section">
            <h2>Select allergens</h2>
            {renderChips(
              config.ALLERGENS,
              selectedAllergies,
              setSelectedAllergies,
              config.formatAllergenLabel,
              config.getAllergenEmoji,
            )}
          </section>

          <section className="guest-section">
            <h2>Select diets</h2>
            {renderChips(
              config.DIETS,
              selectedDiets,
              setSelectedDiets,
              config.formatDietLabel,
              config.getDietEmoji,
            )}
          </section>

          <div className="guest-actions">
            <button
              type="button"
              className="btn btnPrimary"
              onClick={onContinue}
              disabled={!selectedRestaurantSlug}
            >
              Continue to restaurant menu
            </button>
            {status ? <p className="status-text error">{status}</p> : null}
          </div>
        </FormSectionCard>
      </div>
    </PageShell>
  );
}
