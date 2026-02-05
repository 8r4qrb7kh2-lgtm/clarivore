"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase =
  supabaseUrl && supabaseAnonKey
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

function getDisplayName(user) {
  if (!user) return "there";
  const meta = user.user_metadata || {};
  const name =
    meta.first_name ||
    meta.full_name ||
    meta.name ||
    user.email ||
    "there";
  return String(name).split(" ")[0];
}

export default function HomeClient() {
  const searchParams = useSearchParams();
  const isQR = searchParams?.get("qr") === "1";
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [restaurants, setRestaurants] = useState([]);
  const [user, setUser] = useState(null);

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
        if (isMounted) setUser(authData?.user || null);
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
          .order("last_confirmed", { ascending: false })
          .limit(6);

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

  const greeting = useMemo(() => getDisplayName(user), [user]);

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
            <Link href="/restaurants">Restaurants</Link>
            <Link href="/favorites">My restaurants</Link>
            <Link href="/dish-search">Dish search</Link>
            <Link href="/help-contact">Help</Link>
            <Link href="/account">Account</Link>
          </div>
        </div>
      </header>

      <main className="page-main">
        <section className="home-hero">
          <p className="eyebrow">Welcome back</p>
          <h1>Hi {greeting}. Let’s plan a safe meal.</h1>
          <p className="home-lead">
            Search verified dishes, track your favorites, and confirm allergens
            before you order.
          </p>
          <div className="home-actions">
            <Link href="/restaurants" className="home-action-card">
              <span className="home-action-title">Browse restaurants</span>
              <span className="home-action-desc">
                Explore menus with staff-confirmed allergen checks.
              </span>
            </Link>
            <Link href="/dish-search" className="home-action-card">
              <span className="home-action-title">Search by dish</span>
              <span className="home-action-desc">
                Find a dish and see allergy flags instantly.
              </span>
            </Link>
            <Link href="/favorites" className="home-action-card">
              <span className="home-action-title">My restaurants</span>
              <span className="home-action-desc">
                Jump back into your saved spots.
              </span>
            </Link>
            <Link href="/help-contact" className="home-action-card">
              <span className="home-action-title">Need help?</span>
              <span className="home-action-desc">
                Get answers and send feedback to Clarivore.
              </span>
            </Link>
          </div>
        </section>

        <section className="home-section">
          <div className="home-section-header">
            <div>
              <h2>Recently confirmed menus</h2>
              <p className="home-section-subtitle">
                These restaurants have recent staff confirmations.
              </p>
            </div>
            <Link className="cta-button ghost" href="/restaurants">
              View all
            </Link>
          </div>

          <p
            className={`status-text ${status ? "error" : ""}`}
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
                Loading restaurants...
              </p>
            ) : restaurants.length ? (
              restaurants.map((restaurant) => {
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
              <p
                style={{
                  color: "var(--muted)",
                  textAlign: "center",
                  gridColumn: "1 / -1",
                }}
              >
                No recent confirmations yet.
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
