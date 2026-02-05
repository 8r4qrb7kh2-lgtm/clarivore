"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

const DAY_MS = 24 * 60 * 60 * 1000;

function getWeeksAgoInfo(date) {
  if (!date) return { text: "Never", color: "#888" };
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return { text: "Never", color: "#888" };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const compareDate = new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
  );

  const diffDays = Math.floor((today - compareDate) / DAY_MS);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffDays < 7) return { text: "this week", color: "#4caf50" };
  if (diffWeeks === 1) return { text: "last week", color: "#8bc34a" };
  if (diffWeeks === 2) return { text: "two weeks ago", color: "#ff9800" };
  if (diffWeeks === 3) return { text: "three weeks ago", color: "#f44336" };
  if (diffDays <= 30) return { text: "one month ago", color: "#f44336" };
  return { text: `${diffWeeks} weeks ago`, color: "#f44336" };
}

export default function RestaurantsClient() {
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
        if (!authData?.user && !isQR) {
          window.location.replace("/index.html");
          return;
        }
      } catch (error) {
        console.error("Auth check failed", error);
        window.location.replace("/index.html");
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
          setRestaurants(Array.isArray(data) ? data : []);
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
  }, [isQR]);

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
    <div className="page-shell">
      <header className="simple-topbar">
        <div className="simple-topbar-inner">
          <Link className="simple-brand" href="/home.html">
            <img
              src="https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png"
              alt="Clarivore logo"
            />
            <span>Clarivore</span>
          </Link>
          <div className="simple-nav">
            <Link href="/home.html">Home</Link>
            <Link href="/account.html">Account</Link>
          </div>
        </div>
      </header>

      <main className="page-main">
        <div className="page-content">
          <h1 style={{ textAlign: "center", marginBottom: 8 }}>
            All restaurants
          </h1>
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
              sorted.map((restaurant) => {
                const info = getWeeksAgoInfo(restaurant.last_confirmed);
                return (
                  <article key={restaurant.id} className="restaurant-card">
                    <div className="restaurant-card-media">
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
                      <p className="meta" style={{ color: info.color }}>
                        Last confirmed by staff: {info.text}
                      </p>
                      <a
                        className="cta-button"
                        href={`/restaurant.html?slug=${restaurant.slug}`}
                      >
                        View menu
                      </a>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="empty-state">
                No restaurants yet. Encourage your favorite spots to join!
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
