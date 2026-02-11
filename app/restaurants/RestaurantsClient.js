"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import PageShell from "../components/PageShell";
import RestaurantCard from "../components/RestaurantCard";
import RestaurantGridState from "../components/RestaurantGridState";
import SimpleTopbar from "../components/SimpleTopbar";
import { queryKeys } from "../lib/queryKeys";
import { filterRestaurantsByVisibility } from "../lib/restaurantVisibility";
import { supabaseClient as supabase } from "../lib/supabase";
import { createDinerTopbarLinks } from "../lib/topbarLinks";

export default function RestaurantsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isQR = searchParams?.get("qr") === "1";
  const [sortMode, setSortMode] = useState("name");
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
    if (!isQR && authQuery.isError) {
      router.replace("/account?redirect=restaurants");
      return;
    }
    if (!isQR && authQuery.isSuccess && !authQuery.data) {
      router.replace("/account?redirect=restaurants");
    }
  }, [authQuery.data, authQuery.isError, authQuery.isSuccess, isQR, router]);

  const restaurantsQuery = useQuery({
    queryKey: ["restaurants", "page", { isQR, userId: authQuery.data?.id || null }],
    enabled: Boolean(supabase) && (isQR || Boolean(authQuery.data)),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, slug, menu_image, last_confirmed")
        .order("name", { ascending: true });

      if (error) throw error;
      return filterRestaurantsByVisibility(Array.isArray(data) ? data : [], {
        user: authQuery.data || null,
      });
    },
    staleTime: 60 * 1000,
  });

  const restaurants = restaurantsQuery.data || [];
  const loading = authQuery.isPending || restaurantsQuery.isPending;
  const status = !supabase
    ? "Supabase env vars are missing."
    : restaurantsQuery.isError
      ? "Error loading restaurants."
      : "";

  const sorted = useMemo(() => {
    const list = [...restaurants];
    if (sortMode === "last_confirmed") {
      list.sort((a, b) => {
        const aDate = a.last_confirmed ? new Date(a.last_confirmed).getTime() : 0;
        const bDate = b.last_confirmed ? new Date(b.last_confirmed).getTime() : 0;
        return bDate - aDate;
      });
      return list;
    }
    return list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [restaurants, sortMode]);

  return (
    <PageShell
      topbar={
        <SimpleTopbar
          brandHref="/home"
          links={createDinerTopbarLinks({
            includeRestaurants: false,
            includeFavorites: false,
            includeDishSearch: false,
            includeHelp: false,
          })}
        />
      }
    >
      <h1 style={{ textAlign: "center", marginBottom: 8 }}>All restaurants</h1>
      <RestaurantGridState
        status={status}
        statusTone={status ? "error" : ""}
        statusId="restaurant-status"
        statusMarginBottom={16}
        betweenContent={
          <select
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
          </select>
        }
        loading={loading}
        loadingText="Loading restaurants..."
        restaurants={sorted}
        emptyText="No restaurants yet. Encourage your favorite spots to join!"
        renderRestaurant={(restaurant) => (
          <RestaurantCard
            key={restaurant.id}
            restaurant={restaurant}
            confirmationUseMonthLabel
          />
        )}
      />
    </PageShell>
  );
}
