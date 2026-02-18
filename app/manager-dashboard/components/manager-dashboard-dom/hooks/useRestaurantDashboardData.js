import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseClient as supabase } from "../../../../lib/supabase";
import { hydrateRestaurantWithTableMenuState } from "../../../../lib/restaurantMenuStateClient";
import { normalizeDishKey } from "../utils/menuUtils";

// Loads the primary dashboard datasets for the selected restaurant.
// This hook owns network lifecycle state (loading + error) and normalized local copies of each table.
export function useRestaurantDashboardData({
  hasManagerAccess,
  selectedRestaurantId,
  loadChatState,
  clearChatState,
  onRestaurantDataLoaded,
}) {
  const onRestaurantDataLoadedRef = useRef(onRestaurantDataLoaded);

  useEffect(() => {
    onRestaurantDataLoadedRef.current = onRestaurantDataLoaded;
  }, [onRestaurantDataLoaded]);

  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [dashboardError, setDashboardError] = useState("");

  const [currentRestaurantData, setCurrentRestaurantData] = useState(null);
  const [recentChangeLogs, setRecentChangeLogs] = useState([]);
  const [dishAnalytics, setDishAnalytics] = useState([]);
  const [accommodationRequests, setAccommodationRequests] = useState([]);
  const [rawInteractions, setRawInteractions] = useState([]);
  const [rawLoves, setRawLoves] = useState([]);
  const [dishOrders, setDishOrders] = useState({});

  const loadDashboardData = useCallback(
    async (restaurantId) => {
      if (!supabase || !restaurantId) return;

      setIsLoadingDashboard(true);
      setDashboardError("");

      try {
        // Fetch all sections in parallel so the dashboard paints with one coherent snapshot.
        const [
          restaurantResult,
          changeLogsResult,
          analyticsResult,
          requestsResult,
          interactionsResult,
          lovesResult,
          ordersResult,
        ] = await Promise.all([
          supabase
            .from("restaurants")
            .select("id, name, slug, last_confirmed, write_version")
            .eq("id", restaurantId)
            .single(),
          supabase
            .from("change_logs")
            .select("id, timestamp, changes")
            .eq("restaurant_id", restaurantId)
            .order("timestamp", { ascending: false })
            .limit(3),
          supabase.from("dish_analytics").select("*").eq("restaurant_id", restaurantId),
          supabase
            .from("accommodation_requests")
            .select("*")
            .eq("restaurant_id", restaurantId)
            .order("created_at", { ascending: false }),
          supabase
            .from("dish_interactions")
            .select("user_id, user_allergens, user_diets, dish_name")
            .eq("restaurant_id", restaurantId),
          supabase
            .from("user_loved_dishes")
            .select("user_id, dish_name")
            .eq("restaurant_id", restaurantId),
          supabase
            .from("tablet_orders")
            .select("payload")
            .eq("restaurant_id", restaurantId),
        ]);

        if (restaurantResult.error) throw restaurantResult.error;
        if (changeLogsResult.error) throw changeLogsResult.error;
        if (analyticsResult.error) throw analyticsResult.error;
        if (requestsResult.error) throw requestsResult.error;
        if (interactionsResult.error) throw interactionsResult.error;

        const restaurantBase = restaurantResult.data || null;
        const restaurant = restaurantBase
          ? await hydrateRestaurantWithTableMenuState(supabase, restaurantBase)
          : null;
        const changeLogs = Array.isArray(changeLogsResult.data) ? changeLogsResult.data : [];
        const analytics = Array.isArray(analyticsResult.data) ? analyticsResult.data : [];
        const requests = Array.isArray(requestsResult.data) ? requestsResult.data : [];
        const interactions = Array.isArray(interactionsResult.data)
          ? interactionsResult.data
          : [];
        const loves = Array.isArray(lovesResult.data) ? lovesResult.data : [];
        const orders = Array.isArray(ordersResult.data) ? ordersResult.data : [];

        // Convert order payloads into per-dish counts used by heatmap metrics.
        const nextDishOrders = {};
        orders.forEach((row) => {
          const payload = row?.payload || {};
          const dishes = Array.isArray(payload.dishes)
            ? payload.dishes
            : Array.isArray(payload.items)
              ? payload.items
              : [];

          dishes.forEach((entry) => {
            const dishName =
              typeof entry === "string"
                ? entry
                : entry?.name || entry?.dish_name || entry?.id || "";
            if (!dishName) return;

            const key = normalizeDishKey(dishName);
            nextDishOrders[key] = (nextDishOrders[key] || 0) + 1;
          });

          if (payload.dish_name) {
            const key = normalizeDishKey(payload.dish_name);
            nextDishOrders[key] = (nextDishOrders[key] || 0) + 1;
          }
        });

        setCurrentRestaurantData(restaurant);
        setRecentChangeLogs(changeLogs);
        setDishAnalytics(analytics);
        setAccommodationRequests(requests);
        setRawInteractions(interactions);
        setRawLoves(loves);
        setDishOrders(nextDishOrders);

        if (typeof onRestaurantDataLoadedRef.current === "function") {
          onRestaurantDataLoadedRef.current(restaurant);
        }

        await loadChatState(restaurantId);
      } catch (error) {
        console.error("[manager-dashboard-next] failed to load dashboard data", error);
        setDashboardError(error?.message || "Failed to load manager dashboard data.");
        setCurrentRestaurantData(null);
        setRecentChangeLogs([]);
        setDishAnalytics([]);
        setAccommodationRequests([]);
        setRawInteractions([]);
        setRawLoves([]);
        setDishOrders({});
        clearChatState();
      } finally {
        setIsLoadingDashboard(false);
      }
    },
    [clearChatState, loadChatState],
  );

  useEffect(() => {
    if (!hasManagerAccess || !selectedRestaurantId) return;
    loadDashboardData(selectedRestaurantId);
  }, [hasManagerAccess, loadDashboardData, selectedRestaurantId]);

  return {
    isLoadingDashboard,
    dashboardError,
    currentRestaurantData,
    setCurrentRestaurantData,
    recentChangeLogs,
    dishAnalytics,
    accommodationRequests,
    setAccommodationRequests,
    rawInteractions,
    rawLoves,
    dishOrders,
    loadDashboardData,
  };
}
