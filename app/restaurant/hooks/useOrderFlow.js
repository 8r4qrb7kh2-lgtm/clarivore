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

function makeOrderId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
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

function clonePayload(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // fall through
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function pushOrderHistory(payload, actor, message) {
  const history = ensureArray(payload?.history);
  history.push({
    at: new Date().toISOString(),
    actor,
    message,
  });
  payload.history = history;
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

function parseServerCodeParts(value) {
  const normalized = trim(value).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return {
      serverCode: "",
      serverId: "",
      tableNumber: "",
    };
  }

  const serverIdMatch = normalized.match(/\d{4}/);
  const serverId = serverIdMatch ? trim(serverIdMatch[0]) : "";
  let tableNumber = "";

  if (serverId) {
    const serverIndex = normalized.indexOf(serverId);
    const afterServerId = normalized
      .slice(serverIndex + serverId.length)
      .replace(/^[\s:|,+#-]+/, "");
    const tableMatch = afterServerId.match(/(?:table\s*)?([a-z0-9][a-z0-9-]*)/i);
    tableNumber = tableMatch ? trim(tableMatch[1]).toUpperCase() : "";
  }

  return {
    serverCode: normalized,
    serverId,
    tableNumber,
  };
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
        .select("id,restaurant_id,status,payload,created_at,updated_at")
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
        const kitchenQuestionPayload =
          payload?.kitchenQuestion && typeof payload.kitchenQuestion === "object"
            ? payload.kitchenQuestion
            : null;
        const kitchenQuestionText = trim(kitchenQuestionPayload?.text);
        const kitchenQuestionResponse = trim(kitchenQuestionPayload?.response);
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
          kitchenQuestion: kitchenQuestionText
            ? {
                text: kitchenQuestionText,
                response: kitchenQuestionResponse,
                askedAt: trim(kitchenQuestionPayload?.askedAt),
                respondedAt: trim(kitchenQuestionPayload?.respondedAt),
              }
            : null,
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
      const parsedServerCode = parseServerCodeParts(serverCode);

      if (diningMode === "dine-in" && !serverCode) {
        throw new Error("Server code is required for dine-in notices.");
      }

      const orderId = makeOrderId();
      const now = new Date().toISOString();

      const payload = {
        id: orderId,
        restaurantId,
        restaurant_id: restaurantId,
        userId: user?.id || null,
        customerName,
        diningMode,
        serverCode: parsedServerCode.serverCode || null,
        serverId: parsedServerCode.serverId || null,
        tableNumber: parsedServerCode.tableNumber || null,
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

  const noticeActionMutation = useMutation({
    mutationFn: async ({ noticeId, action, response }) => {
      const normalizedNoticeId = trim(noticeId);
      if (!supabase) throw new Error("Supabase is not configured.");
      if (!normalizedNoticeId) throw new Error("Notice id is missing.");

      const { data: row, error: rowError } = await supabase
        .from("tablet_orders")
        .select("id,restaurant_id,status,payload")
        .eq("id", normalizedNoticeId)
        .maybeSingle();

      if (rowError) throw rowError;
      if (!row) throw new Error("Notice was not found.");

      const payload = clonePayload(readPayload(row.payload));
      const payloadUserId = trim(payload?.userId);
      if (trim(user?.id) && payloadUserId && payloadUserId !== trim(user.id)) {
        throw new Error("You can only update your own notices.");
      }

      const currentStatus = trim(row.status || payload.status);
      const now = new Date().toISOString();
      const normalizedAction = trim(action).toLowerCase();
      let nextStatus = currentStatus;

      payload.id = trim(payload.id || row.id || normalizedNoticeId);
      payload.restaurantId = payload.restaurantId || row.restaurant_id || restaurantId || null;
      payload.restaurant_id = payload.restaurantId;
      payload.status = currentStatus || payload.status || ORDER_STATUSES.SUBMITTED_TO_SERVER;
      payload.updatedAt = now;

      if (normalizedAction === "respond") {
        const normalizedResponse = trim(response).toLowerCase();
        if (!["yes", "no"].includes(normalizedResponse)) {
          throw new Error("Response must be yes or no.");
        }
        const kitchenQuestion =
          payload?.kitchenQuestion && typeof payload.kitchenQuestion === "object"
            ? payload.kitchenQuestion
            : null;
        if (!trim(kitchenQuestion?.text)) {
          throw new Error("No kitchen follow-up question is available for this notice.");
        }
        if (currentStatus !== ORDER_STATUSES.AWAITING_USER_RESPONSE) {
          throw new Error("This notice is not waiting on your follow-up response.");
        }

        payload.kitchenQuestion = {
          ...kitchenQuestion,
          response: normalizedResponse,
          respondedAt: now,
        };
        nextStatus = ORDER_STATUSES.QUESTION_ANSWERED;
        payload.status = nextStatus;
        pushOrderHistory(
          payload,
          "Diner",
          `Responded "${normalizedResponse.toUpperCase()}" to kitchen follow-up.`,
        );
      } else if (normalizedAction === "rescind") {
        if (
          [
            ORDER_STATUSES.RESCINDED_BY_DINER,
            ORDER_STATUSES.REJECTED_BY_SERVER,
            ORDER_STATUSES.REJECTED_BY_KITCHEN,
          ].includes(currentStatus)
        ) {
          throw new Error("This notice cannot be rescinded in its current status.");
        }
        nextStatus = ORDER_STATUSES.RESCINDED_BY_DINER;
        payload.status = nextStatus;
        pushOrderHistory(payload, "Diner", "Rescinded notice.");
      } else {
        throw new Error("Unsupported notice action.");
      }

      const { error: updateError } = await supabase.from("tablet_orders").upsert(
        {
          id: payload.id,
          restaurant_id: payload.restaurantId,
          status: nextStatus,
          payload,
        },
        { onConflict: "id" },
      );
      if (updateError) throw updateError;

      return {
        noticeId: payload.id,
        status: nextStatus,
      };
    },
    onMutate: ({ noticeId }) => ({
      noticeId: trim(noticeId),
    }),
    onSuccess: ({ noticeId, status }) => {
      if (status === ORDER_STATUSES.RESCINDED_BY_DINER) {
        setActiveOrderId((current) => (current === noticeId ? "" : current));
      }
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

  const respondToKitchenQuestion = useCallback(
    async (noticeId, response) => {
      return noticeActionMutation.mutateAsync({
        noticeId,
        action: "respond",
        response,
      });
    },
    [noticeActionMutation],
  );

  const rescindNotice = useCallback(
    async (noticeId) => {
      return noticeActionMutation.mutateAsync({
        noticeId,
        action: "rescind",
      });
    },
    [noticeActionMutation],
  );

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
    respondToKitchenQuestion,
    rescindNotice,
    isNoticeActionPending: noticeActionMutation.isPending,
    noticeActionError: noticeActionMutation.error?.message || "",
    noticeActionTargetId: noticeActionMutation.variables?.noticeId || "",
    clearNoticeActionError: noticeActionMutation.reset,
    reset,
  };
}

export default useOrderFlow;
