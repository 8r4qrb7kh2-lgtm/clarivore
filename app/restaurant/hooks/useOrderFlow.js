"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ORDER_STATUSES } from "../../lib/tabletSimulationLogic.mjs";
import { supabaseClient as supabase } from "../../lib/supabase";
import { queryKeys } from "../../lib/queryKeys";

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

function makeOrderId(restaurantId, userId) {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `notice-${restaurantId}-${userId || "guest"}-${suffix}`;
}

function trim(value) {
  return String(value ?? "").trim();
}

export function useOrderFlow({ restaurantId, user, overlays, preferences }) {
  const [selectedDishNames, setSelectedDishNames] = useState([]);
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
      return rows.filter((row) => String(row?.payload?.userId || "") === String(user.id));
    },
  });

  const activeOrder = useMemo(() => {
    const rows = Array.isArray(orderStatusQuery.data) ? orderStatusQuery.data : [];
    if (!rows.length) return null;

    if (activeOrderId) {
      return rows.find((row) => row.id === activeOrderId) || rows[0];
    }

    return rows[0];
  }, [activeOrderId, orderStatusQuery.data]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error("Supabase is not configured.");
      if (!restaurantId) throw new Error("Restaurant is not loaded yet.");
      if (!selectedDishNames.length) {
        throw new Error("Select at least one dish before submitting.");
      }

      const customerName = trim(formState.customerName) || trim(user?.user_metadata?.first_name) || "Guest";

      const orderId = makeOrderId(restaurantId, user?.id || "");
      const now = new Date().toISOString();

      const payload = {
        id: orderId,
        restaurantId,
        restaurant_id: restaurantId,
        userId: user?.id || null,
        customerName,
        diningMode: formState.diningMode,
        serverCode: trim(formState.serverCode) || null,
        customNotes: trim(formState.notes),
        allergies: Array.isArray(preferences?.allergies) ? preferences.allergies : [],
        diets: Array.isArray(preferences?.diets) ? preferences.diets : [],
        selectedDishes: [...selectedDishNames],
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

      return { orderId, payload };
    },
    onSuccess: (result) => {
      setActiveOrderId(result.orderId);
      setSelectedDishNames([]);
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
      current.includes(dishName) ? current : [...current, dishName],
    );
  }, []);

  const removeDish = useCallback((dishName) => {
    const normalized = trim(dishName);
    if (!normalized) return;

    setSelectedDishNames((current) =>
      current.filter((item) => trim(item) !== normalized),
    );
  }, []);

  const toggleDish = useCallback(
    (dish) => {
      const dishName = trim(dish?.name || dish?.id || dish);
      if (!dishName) return;

      setSelectedDishNames((current) => {
        if (current.includes(dishName)) {
          return current.filter((item) => item !== dishName);
        }
        return [...current, dishName];
      });
    },
    [],
  );

  const updateFormField = useCallback((field, value) => {
    setFormState((current) => ({
      ...current,
      [field]: value,
    }));
  }, []);

  const reset = useCallback(() => {
    setSelectedDishNames([]);
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
    addDish,
    removeDish,
    toggleDish,
    formState,
    updateFormField,
    submitNotice: submitMutation.mutateAsync,
    isSubmitting: submitMutation.isPending,
    submitError: submitMutation.error?.message || "",
    activeOrder,
    activeOrderId,
    statusLabel,
    statusError: orderStatusQuery.error?.message || "",
    refreshStatus: orderStatusQuery.refetch,
    isStatusLoading: orderStatusQuery.isLoading,
    reset,
  };
}

export default useOrderFlow;
