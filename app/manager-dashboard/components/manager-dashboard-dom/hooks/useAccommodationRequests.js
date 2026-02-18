import { useCallback, useMemo, useState } from "react";
import { supabaseClient as supabase } from "../../../../lib/supabase";
import { REQUEST_ACTION_CONFIG } from "../constants/dashboardConstants";
import { resolveAllergenMetricKeys } from "../utils/menuUtils";

function buildRequestSuggestions({
  accommodationRequests,
  dishAnalytics,
  ALLERGENS,
  normalizeAllergen,
  normalizeDietLabel,
  formatAllergenLabel,
}) {
  // Suggestions combine two signals:
  // 1) repeated accommodation requests by dish, and
  // 2) high-traffic dishes that frequently appear unsafe.
  const suggestions = [];
  const requestsByDish = {};

  accommodationRequests.forEach((request) => {
    const dishName = String(request?.dish_name || "").trim();
    if (!dishName) return;

    if (!requestsByDish[dishName]) {
      requestsByDish[dishName] = { count: 0, allergens: {}, diets: {} };
    }

    requestsByDish[dishName].count += 1;

    (request.requested_allergens || []).forEach((allergen) => {
      const normalized = normalizeAllergen(allergen);
      if (!normalized) return;
      requestsByDish[dishName].allergens[normalized] =
        (requestsByDish[dishName].allergens[normalized] || 0) + 1;
    });

    (request.requested_diets || []).forEach((diet) => {
      const normalized = normalizeDietLabel(diet);
      if (!normalized) return;
      requestsByDish[dishName].diets[normalized] =
        (requestsByDish[dishName].diets[normalized] || 0) + 1;
    });
  });

  Object.entries(requestsByDish).forEach(([dishName, details]) => {
    if (details.count < 2) return;

    const topAllergen = Object.entries(details.allergens).sort((a, b) => b[1] - a[1])[0];
    const topDiet = Object.entries(details.diets).sort((a, b) => b[1] - a[1])[0];

    if (topAllergen && topAllergen[1] >= 2) {
      suggestions.push({
        title: `Add ${formatAllergenLabel(topAllergen[0])}-free option for "${dishName}"`,
        description: `${topAllergen[1]} users requested a ${formatAllergenLabel(
          topAllergen[0],
        )}-free version. Consider adding a substitution path.`,
        potentialUsers: topAllergen[1] * 5,
        priority: topAllergen[1] >= 5 ? "high" : topAllergen[1] >= 3 ? "medium" : "low",
      });
    }

    if (topDiet && topDiet[1] >= 2) {
      suggestions.push({
        title: `Make "${dishName}" available for ${topDiet[0]} diners`,
        description: `${topDiet[1]} ${topDiet[0]} users requested this dish. Consider creating a ${topDiet[0]} variant.`,
        potentialUsers: topDiet[1] * 5,
        priority: topDiet[1] >= 5 ? "high" : topDiet[1] >= 3 ? "medium" : "low",
      });
    }
  });

  dishAnalytics.forEach((dish) => {
    const total = Number(dish?.total_interactions || 0);
    const unsafe = Number(dish?.unsafe_interactions || 0);
    if (total < 10 || unsafe / total <= 0.5) return;

    const metricKeys = resolveAllergenMetricKeys(dish, normalizeAllergen);
    const topAllergen = ALLERGENS.map((allergen) => ({
      allergen,
      count: Number(dish?.[metricKeys[allergen]] || 0),
    }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count)[0];

    if (!topAllergen) return;

    suggestions.push({
      title: `High demand for allergen-friendly "${dish?.dish_name || "dish"}"`,
      description: `${unsafe} users viewed this dish but it was unsafe. ${
        topAllergen.count
      } users with ${formatAllergenLabel(topAllergen.allergen)} restrictions showed interest.`,
      potentialUsers: unsafe,
      priority: unsafe >= 20 ? "high" : unsafe >= 10 ? "medium" : "low",
    });
  });

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => {
    const rankDelta = (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99);
    if (rankDelta !== 0) return rankDelta;
    return (b.potentialUsers || 0) - (a.potentialUsers || 0);
  });

  return suggestions.slice(0, 5);
}

// Owns accommodation request tab state, modal state, and action submission workflow.
export function useAccommodationRequests({
  accommodationRequests,
  setAccommodationRequests,
  selectedRestaurantId,
  userId,
  setStatus,
  dishAnalytics,
  ALLERGENS,
  normalizeAllergen,
  normalizeDietLabel,
  formatAllergenLabel,
}) {
  const [requestFilter, setRequestFilter] = useState("pending");
  const [activeRequestAction, setActiveRequestAction] = useState(null);
  const [requestResponseText, setRequestResponseText] = useState("");
  const [isUpdatingRequest, setIsUpdatingRequest] = useState(false);

  const resetRequestUIForRestaurantChange = useCallback(() => {
    // Switching restaurants should always return the request area to a clean default state.
    setRequestFilter("pending");
    setActiveRequestAction(null);
    setRequestResponseText("");
  }, []);

  const pendingRequestCount = useMemo(
    () =>
      accommodationRequests.filter(
        (request) => String(request?.status || "pending").toLowerCase() === "pending",
      ).length,
    [accommodationRequests],
  );

  const filteredRequests = useMemo(() => {
    if (requestFilter === "all") return accommodationRequests;
    return accommodationRequests.filter(
      (request) => String(request?.status || "pending").toLowerCase() === "pending",
    );
  }, [accommodationRequests, requestFilter]);

  const requestSuggestions = useMemo(
    () =>
      buildRequestSuggestions({
        accommodationRequests,
        dishAnalytics,
        ALLERGENS,
        normalizeAllergen,
        normalizeDietLabel,
        formatAllergenLabel,
      }),
    [
      accommodationRequests,
      dishAnalytics,
      ALLERGENS,
      normalizeAllergen,
      normalizeDietLabel,
      formatAllergenLabel,
    ],
  );

  const openRequestActionModal = useCallback((request, action) => {
    if (!request?.id || !REQUEST_ACTION_CONFIG[action]) return;

    setActiveRequestAction({
      requestId: request.id,
      dishName: request.dish_name || "Unknown dish",
      action,
    });
    setRequestResponseText("");
  }, []);

  const closeRequestActionModal = useCallback(() => {
    if (isUpdatingRequest) return;
    setActiveRequestAction(null);
    setRequestResponseText("");
  }, [isUpdatingRequest]);

  const submitRequestAction = useCallback(async () => {
    if (!supabase || !activeRequestAction?.requestId || !selectedRestaurantId) return;

    const config = REQUEST_ACTION_CONFIG[activeRequestAction.action];
    if (!config) return;

    const now = new Date().toISOString();
    const trimmedResponse = String(requestResponseText || "").trim();

    setIsUpdatingRequest(true);
    try {
      const updates = {
        status: activeRequestAction.action,
        manager_response: trimmedResponse || null,
        manager_reviewed_at: now,
        manager_reviewed_by: userId || null,
        updated_at: now,
      };

      const { error } = await supabase
        .from("accommodation_requests")
        .update(updates)
        .eq("id", activeRequestAction.requestId)
        .eq("restaurant_id", selectedRestaurantId);

      if (error) throw error;

      // Apply optimistic local patch so UI updates without full refetch.
      setAccommodationRequests((current) =>
        current.map((request) =>
          request.id === activeRequestAction.requestId
            ? {
                ...request,
                ...updates,
              }
            : request,
        ),
      );

      setStatus(`${config.title} complete.`, "success");
      setActiveRequestAction(null);
      setRequestResponseText("");
    } catch (error) {
      console.error("[manager-dashboard-next] failed to update request", error);
      setStatus("Failed to update request. Please try again.", "error");
    } finally {
      setIsUpdatingRequest(false);
    }
  }, [
    activeRequestAction,
    requestResponseText,
    selectedRestaurantId,
    setAccommodationRequests,
    setStatus,
    userId,
  ]);

  const activeRequestActionConfig = activeRequestAction
    ? REQUEST_ACTION_CONFIG[activeRequestAction.action] || null
    : null;

  return {
    requestFilter,
    setRequestFilter,
    pendingRequestCount,
    filteredRequests,
    requestSuggestions,
    activeRequestAction,
    activeRequestActionConfig,
    requestResponseText,
    setRequestResponseText,
    isUpdatingRequest,
    openRequestActionModal,
    closeRequestActionModal,
    submitRequestAction,
    resetRequestUIForRestaurantChange,
  };
}
