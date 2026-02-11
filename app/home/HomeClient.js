"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import PageShell from "../components/PageShell";
import SimpleTopbar from "../components/SimpleTopbar";
import RestaurantCard from "../components/RestaurantCard";
import RestaurantGridState from "../components/RestaurantGridState";
import { queryKeys } from "../lib/queryKeys";
import { filterRestaurantsByVisibility } from "../lib/restaurantVisibility";
import { supabaseClient as supabase } from "../lib/supabase";
import { createDinerTopbarLinks } from "../lib/topbarLinks";
import { resolveGreetingFirstName } from "../lib/userIdentity";

export default function HomeClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isQR = searchParams?.get("qr") === "1";
  const authQuery = useQuery({
    queryKey: queryKeys.auth.user("home"),
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
      router.replace("/account?mode=signin");
      return;
    }
    if (!isQR && authQuery.isSuccess && !authQuery.data) {
      router.replace("/account?mode=signin");
    }
  }, [authQuery.data, authQuery.isError, authQuery.isSuccess, isQR, router]);

  const restaurantsQuery = useQuery({
    queryKey: [
      "restaurants",
      "home",
      { isQR, userId: authQuery.data?.id || null },
    ],
    enabled: Boolean(supabase) && (isQR || Boolean(authQuery.data)),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, slug, menu_image, last_confirmed")
        .order("last_confirmed", { ascending: false })
        .limit(6);
      if (error) throw error;
      return filterRestaurantsByVisibility(Array.isArray(data) ? data : [], {
        user: authQuery.data || null,
      });
    },
    staleTime: 60 * 1000,
  });

  const greeting = useMemo(
    () => resolveGreetingFirstName(authQuery.data || null),
    [authQuery.data],
  );

  const restaurants = restaurantsQuery.data || [];
  const loading = authQuery.isPending || restaurantsQuery.isPending;
  const status = !supabase
    ? "Supabase env vars are missing."
    : restaurantsQuery.isError
      ? "Error loading restaurants."
      : "";

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
