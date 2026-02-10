"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PageShell from "../components/PageShell";
import SimpleTopbar from "../components/SimpleTopbar";
import RestaurantCard from "../components/RestaurantCard";
import RestaurantGridState from "../components/RestaurantGridState";
import { filterRestaurantsByVisibility } from "../lib/restaurantVisibility";
import { supabaseClient as supabase } from "../lib/supabase";
import { createDinerTopbarLinks } from "../lib/topbarLinks";
import { resolveGreetingFirstName } from "../lib/userIdentity";

export default function HomeClient() {
  const router = useRouter();
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

      let authUser = null;
      try {
        const { data: authData, error: authError } =
          await supabase.auth.getUser();
        if (authError) throw authError;
        authUser = authData?.user || null;
        if (!authUser && !isQR) {
          router.replace("/account?mode=signin");
          return;
        }
        if (isMounted) setUser(authUser);
      } catch (error) {
        console.error("Auth check failed", error);
        router.replace("/account?mode=signin");
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

  const greeting = useMemo(() => resolveGreetingFirstName(user), [user]);

  return (
    <PageShell
      wrapContent={false}
      topbar={
        <SimpleTopbar
          brandHref="/home"
          links={createDinerTopbarLinks({ includeHome: false })}
        />
      }
    >
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

        <RestaurantGridState
          status={status}
          statusTone={status ? "error" : ""}
          loading={loading}
          loadingText="Loading restaurants..."
          restaurants={restaurants}
          emptyText="No recent confirmations yet."
          renderRestaurant={(restaurant) => (
            <RestaurantCard
              key={restaurant.id}
              restaurant={restaurant}
              confirmationUseMonthLabel
            />
          )}
        />
      </section>
    </PageShell>
  );
}
