"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ORDER_STATUSES } from "../../lib/tabletSimulationLogic.mjs";
import { supabaseClient as supabase } from "../../lib/supabase";
import { queryKeys } from "../../lib/queryKeys";
import {
  buildAllergenRows,
  buildAllergenCrossRows,
  buildDietRows,
  buildDietCrossRows,
  mergeSectionRows,
} from "../features/shared/dishDetailRows";

const STATUS_LABELS = {
  [ORDER_STATUSES.DRAFT]: "Draft",
  [ORDER_STATUSES.CODE_ASSIGNED]: "Waiting for server code",
  [ORDER_STATUSES.SUBMITTED_TO_SERVER]: "Waiting for server approval",
  [ORDER_STATUSES.QUEUED_FOR_KITCHEN]: "Queued for kitchen",
  [ORDER_STATUSES.WITH_KITCHEN]: "With kitchen",
  [ORDER_STATUSES.ACKNOWLEDGED]: "Acknowledged",
  [ORDER_STATUSES.AWAITING_USER_RESPONSE]: "Kitchen follow-up",
  [ORDER_STATUSES.QUESTION_ANSWERED]: "Follow-up answered",
  [ORDER_STATUSES.REJECTED_BY_SERVER]: "Rejected by server",
  [ORDER_STATUSES.RESCINDED_BY_DINER]: "Rescinded",
  [ORDER_STATUSES.REJECTED_BY_KITCHEN]: "Rejected by kitchen",
};

const ACTIVE_NOTICE_STATUSES = new Set([
  ORDER_STATUSES.SUBMITTED_TO_SERVER,
  ORDER_STATUSES.QUEUED_FOR_KITCHEN,
  ORDER_STATUSES.WITH_KITCHEN,
  ORDER_STATUSES.AWAITING_USER_RESPONSE,
  ORDER_STATUSES.QUESTION_ANSWERED,
]);

function makeOrderId(restaurantId, userId) {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `notice-${restaurantId}-${userId || "guest"}-${suffix}`;
}

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return trim(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readPayload(value) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function uniqueDishNames(values) {
  const seen = new Set();
  const output = [];
  (Array.isArray(values) ? values : []).forEach((entry) => {
    const dishName = trim(entry);
    if (!dishName) return;
    const token = normalizeToken(dishName);
    if (!token || seen.has(token)) return;
    seen.add(token);
    output.push(dishName);
  });
  return output;
}

function hasDishName(values, target) {
  const targetToken = normalizeToken(target);
  if (!targetToken) return false;
  return (Array.isArray(values) ? values : []).some(
    (value) => normalizeToken(value) === targetToken,
  );
}

function removeDishNames(values, namesToRemove) {
  const removeTokens = new Set(
    uniqueDishNames(namesToRemove).map((value) => normalizeToken(value)),
  );
  if (!removeTokens.size) return uniqueDishNames(values);
  return uniqueDishNames(values).filter(
    (value) => !removeTokens.has(normalizeToken(value)),
  );
}

function formatDiningModeLabel(value) {
  const normalized = trim(value).toLowerCase();
  if (normalized === "dine-in") return "Dine-in";
  if (normalized === "delivery" || normalized === "pickup") {
    return "Delivery / pickup";
  }
  return trim(value) || "Unknown";
}

function normalizeNoticeDishes(payload) {
  const selectedDishes = Array.isArray(payload?.selectedDishes)
    ? payload.selectedDishes
    : [];
  const itemDishes = (Array.isArray(payload?.items) ? payload.items : []).map((item) =>
    trim(item?.dishName || item?.name || item),
  );
  return uniqueDishNames([...selectedDishes, ...itemDishes]);
}

function buildPreferenceItems(values, formatLabel, getEmoji) {
  return (Array.isArray(values) ? values : []).map((value) => {
    const key = trim(value);
    return {
      key,
      label: trim(typeof formatLabel === "function" ? formatLabel(value) : value) || key,
      emoji: trim(typeof getEmoji === "function" ? getEmoji(value) : ""),
    };
  });
}

export function useOrderFlow({ restaurantId, user, overlays, preferences }) {
  const [selectedDishNames, setSelectedDishNames] = useState([]);
  const [checkedDishNames, setCheckedDishNames] = useState([]);
  const [formState, setFormState] = useState({
    customerName: "",
    diningMode: "dine-in",
    serverCode: "",
    notes: "",
  });
  const [activeOrderId, setActiveOrderId] = useState("");

  const orderStatusQuery = useQuery({
    queryKey: queryKeys.restaurant.orders(restaurantId, user?.id || ""),
    enabled: Boolean(supabase) && Boolean(restaurantId),
    refetchInterval: activeOrderId ? 12000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tablet_orders")
        .select("id,status,payload,updated_at")
        .eq("restaurant_id", restaurantId)
        .order("updated_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      if (!user?.id) return rows;
      return rows.filter(
        (row) => String(readPayload(row?.payload)?.userId || "") === String(user.id),
      );
    },
  });

  const submittedRows = useMemo(() => {
    return Array.isArray(orderStatusQuery.data) ? orderStatusQuery.data : [];
  }, [orderStatusQuery.data]);

  const activeOrder = useMemo(() => {
    const rows = submittedRows;
    if (!rows.length) return null;

    if (activeOrderId) {
      return rows.find((row) => row.id === activeOrderId) || rows[0];
    }

    return rows[0];
  }, [activeOrderId, submittedRows]);

  const notices = useMemo(() => {
    return submittedRows
      .map((row) => {
        const payload = readPayload(row?.payload);
        const status = trim(row?.status || payload?.status);
        const selectedDishes = normalizeNoticeDishes(payload);
        if (!status || !selectedDishes.length) return null;

        return {
          id: trim(row?.id || payload?.id),
          status,
          statusLabel: STATUS_LABELS[status] || status,
          selectedDishes,
          customerName: trim(payload?.customerName),
          diningMode: trim(payload?.diningMode),
          diningModeLabel: formatDiningModeLabel(payload?.diningMode),
          serverCode: trim(payload?.serverCode),
          customNotes: trim(payload?.customNotes),
          createdAt: trim(row?.created_at || payload?.createdAt),
          updatedAt: trim(row?.updated_at || payload?.updatedAt),
        };
      })
      .filter(Boolean);
  }, [submittedRows]);

  const activeNotices = useMemo(() => {
    return notices.filter((notice) => ACTIVE_NOTICE_STATUSES.has(notice.status));
  }, [notices]);

  const normalizedOverlays = useMemo(() => {
    return (Array.isArray(overlays) ? overlays : []).map((overlay, index) => {
      const dishName = trim(overlay?.id || overlay?.name || overlay?.title || `Dish ${index + 1}`);
      return {
        ...overlay,
        id: dishName,
        name: dishName,
      };
    });
  }, [overlays]);

  const overlayByDishName = useMemo(() => {
    const map = new Map();
    normalizedOverlays.forEach((overlay) => {
      const token = normalizeToken(overlay?.id || overlay?.name);
      if (!token || map.has(token)) return;
      map.set(token, overlay);
    });
    return map;
  }, [normalizedOverlays]);

  const savedAllergens = useMemo(() => {
    return buildPreferenceItems(
      preferences?.allergies,
      preferences?.formatAllergenLabel,
      preferences?.getAllergenEmoji,
    );
  }, [
    preferences?.allergies,
    preferences?.formatAllergenLabel,
    preferences?.getAllergenEmoji,
  ]);

  const savedDiets = useMemo(() => {
    return buildPreferenceItems(
      preferences?.diets,
      preferences?.formatDietLabel,
      preferences?.getDietEmoji,
    );
  }, [
    preferences?.diets,
    preferences?.formatDietLabel,
    preferences?.getDietEmoji,
  ]);

  const getDishNoticeRows = useCallback(
    (dishName) => {
      const normalizedDishName = trim(dishName);
      const overlay = overlayByDishName.get(normalizeToken(normalizedDishName)) || {
        id: normalizedDishName,
        name: normalizedDishName,
      };

      const allergenRows = mergeSectionRows(
        buildAllergenRows(overlay, savedAllergens),
        buildAllergenCrossRows(overlay, savedAllergens),
      );
      const dietRows = mergeSectionRows(
        buildDietRows(overlay, savedDiets),
        buildDietCrossRows(overlay, savedDiets),
      );

      return {
        allergenRows,
        dietRows,
        rows: [...allergenRows, ...dietRows],
      };
    },
    [overlayByDishName, savedAllergens, savedDiets],
  );

  const submitMutation = useMutation({
    mutationFn: async (dishNamesForNotice = []) => {
      if (!supabase) throw new Error("Supabase is not configured.");
      if (!restaurantId) throw new Error("Restaurant is not loaded yet.");
      const submittedDishNames = uniqueDishNames(
        dishNamesForNotice.length ? dishNamesForNotice : checkedDishNames,
      );
      if (!submittedDishNames.length) {
        throw new Error("Select at least one dish before submitting.");
      }

      const customerName = trim(formState.customerName) || trim(user?.user_metadata?.first_name) || "Guest";
      const diningMode = trim(formState.diningMode) || "dine-in";
      const serverCode = trim(formState.serverCode);

      if (diningMode === "dine-in" && !serverCode) {
        throw new Error("Server code is required for dine-in notices.");
      }

      const orderId = makeOrderId(restaurantId, user?.id || "");
      const now = new Date().toISOString();

      const payload = {
        id: orderId,
        restaurantId,
        restaurant_id: restaurantId,
        userId: user?.id || null,
        customerName,
        diningMode,
        serverCode: serverCode || null,
        customNotes: trim(formState.notes),
        allergies: Array.isArray(preferences?.allergies) ? preferences.allergies : [],
        diets: Array.isArray(preferences?.diets) ? preferences.diets : [],
        selectedDishes: [...submittedDishNames],
        status: ORDER_STATUSES.SUBMITTED_TO_SERVER,
        createdAt: now,
        updatedAt: now,
      };

      const { error } = await supabase.from("tablet_orders").upsert(
        {
          id: orderId,
          restaurant_id: restaurantId,
          status: ORDER_STATUSES.SUBMITTED_TO_SERVER,
          payload,
        },
        { onConflict: "id" },
      );
      if (error) throw error;

      return { orderId, payload, submittedDishNames };
    },
    onSuccess: (result) => {
      setActiveOrderId(result.orderId);
      setSelectedDishNames((current) =>
        removeDishNames(current, result.submittedDishNames),
      );
      setCheckedDishNames((current) =>
        removeDishNames(current, result.submittedDishNames),
      );
      setFormState((current) => ({
        ...current,
        serverCode: "",
        notes: "",
      }));
      orderStatusQuery.refetch();
    },
  });

  const addDish = useCallback((dish) => {
    const dishName = trim(dish?.name || dish?.id || dish);
    if (!dishName) return;

    setSelectedDishNames((current) =>
      hasDishName(current, dishName) ? current : [...current, dishName],
    );
    setCheckedDishNames((current) =>
      hasDishName(current, dishName) ? current : [...current, dishName],
    );
  }, []);

  const removeDish = useCallback((dishName) => {
    const normalized = trim(dishName);
    if (!normalized) return;

    setSelectedDishNames((current) =>
      removeDishNames(current, [normalized]),
    );
    setCheckedDishNames((current) =>
      removeDishNames(current, [normalized]),
    );
  }, []);

  const toggleDish = useCallback(
    (dish) => {
      const dishName = trim(dish?.name || dish?.id || dish);
      if (!dishName) return;

      setSelectedDishNames((current) => {
        if (hasDishName(current, dishName)) {
          return removeDishNames(current, [dishName]);
        }
        return [...current, dishName];
      });

      setCheckedDishNames((current) => {
        if (hasDishName(current, dishName)) {
          return removeDishNames(current, [dishName]);
        }
        return [...current, dishName];
      });
    },
    [],
  );

  const toggleDishSelection = useCallback(
    (dishName) => {
      const normalized = trim(dishName);
      if (!normalized || !hasDishName(selectedDishNames, normalized)) return;

      setCheckedDishNames((current) => {
        if (hasDishName(current, normalized)) {
          return removeDishNames(current, [normalized]);
        }
        return [...current, normalized];
      });
    },
    [selectedDishNames],
  );

  const isDishSelectedForNotice = useCallback(
    (dishName) => hasDishName(checkedDishNames, dishName),
    [checkedDishNames],
  );

  const updateFormField = useCallback((field, value) => {
    setFormState((current) => ({
      ...current,
      [field]: value,
    }));
  }, []);

  const reset = useCallback(() => {
    setSelectedDishNames([]);
    setCheckedDishNames([]);
    setFormState({
      customerName: "",
      diningMode: "dine-in",
      serverCode: "",
      notes: "",
    });
    setActiveOrderId("");
  }, []);

  const statusLabel = activeOrder?.status
    ? STATUS_LABELS[activeOrder.status] || activeOrder.status
    : "No submitted notice";

  return {
    overlays,
    selectedDishNames,
    checkedDishNames,
    addDish,
    removeDish,
    toggleDish,
    toggleDishSelection,
    isDishSelectedForNotice,
    formState,
    updateFormField,
    submitNotice: submitMutation.mutateAsync,
    isSubmitting: submitMutation.isPending,
    submitError: submitMutation.error?.message || "",
    activeOrder,
    activeOrderId,
    statusLabel,
    notices,
    activeNotices,
    getDishNoticeRows,
    savedAllergens,
    savedDiets,
    statusError: orderStatusQuery.error?.message || "",
    refreshStatus: orderStatusQuery.refetch,
    isStatusLoading: orderStatusQuery.isLoading,
    reset,
  };
}

export default useOrderFlow;
