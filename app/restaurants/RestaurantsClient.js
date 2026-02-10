"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageShell from "../components/PageShell";
import RestaurantCard from "../components/RestaurantCard";
import SimpleTopbar from "../components/SimpleTopbar";
import { filterRestaurantsByVisibility } from "../lib/restaurantVisibility";
import { supabaseClient as supabase } from "../lib/supabase";

export default function RestaurantsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isQR = searchParams?.get("qr") === "1";
  const [status, setStatus] = useState("");
  const [sortMode, setSortMode] = useState("name");
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      if (!supabase) {
        setStatus("Supabase env vars are missing.");
        setLoading(false);
        return;
      }

      try {
        const { data: authData, error: authError } =
          await supabase.auth.getUser();
        if (authError) throw authError;
        const authUser = authData?.user || null;
        if (!authUser && !isQR) {
          router.replace("/account?redirect=restaurants");
          return;
        }
      } catch (error) {
        console.error("Auth check failed", error);
        if (!isQR) {
          router.replace("/account?redirect=restaurants");
        }
        return;
      }

      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("restaurants")
          .select("id, name, slug, menu_image, last_confirmed")
          .order("name", { ascending: true });

        if (error) throw error;
        if (isMounted) {
          setRestaurants(
            filterRestaurantsByVisibility(Array.isArray(data) ? data : [], {
              user: authUser,
            }),
          );
          setStatus("");
        }
      } catch (error) {
        console.error("Failed to load restaurants", error);
        if (isMounted) {
          setStatus("Error loading restaurants.");
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
          links={[
            { href: "/home", label: "Home" },
            { href: "/account", label: "Account" },
          ]}
        />
      }
    >
      <h1 style={{ textAlign: "center", marginBottom: 8 }}>All restaurants</h1>
      <p
        id="restaurant-status"
        className={`status-text ${status ? "error" : ""}`}
        style={{ textAlign: "center", marginBottom: 16 }}
      >
        {status}
      </p>
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

      <div className="restaurant-grid">
        {loading ? (
          <p
            style={{
              color: "var(--muted)",
              textAlign: "center",
              gridColumn: "1 / -1",
            }}
          >
            Loading restaurants...
          </p>
        ) : sorted.length ? (
          sorted.map((restaurant) => (
            <RestaurantCard
              key={restaurant.id}
              restaurant={restaurant}
              confirmationUseMonthLabel
            />
          ))
        ) : (
          <div className="empty-state">
            No restaurants yet. Encourage your favorite spots to join!
          </div>
        )}
      </div>
    </PageShell>
  );
}
