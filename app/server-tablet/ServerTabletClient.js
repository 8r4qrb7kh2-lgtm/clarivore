"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabaseClient as supabase } from "../lib/supabase";
import { OWNER_EMAIL, fetchManagerRestaurants } from "../lib/managerRestaurants";
import {
  ORDER_STATUSES,
  applyServerApprove,
  applyServerDispatch,
  applyServerReject,
  deserializeTabletOrder,
  formatTimestamp,
  getFirstName,
  getOrderTimestamps,
  groupOrdersByServer,
  resolveStatusDescriptor,
  shouldShowOrder,
} from "./serverTabletLogic";

const REJECTION_REMOVAL_DELAY_MS = 5000;
const AUTO_REFRESH_INTERVAL_MS = 15000;

function cloneOrder(order) {
  if (!order) return null;
  if (typeof structuredClone === "function") {
    return structuredClone(order);
  }
  return JSON.parse(JSON.stringify(order));
}

export default function ServerTabletClient() {
  const [bootError, setBootError] = useState("");
  const [isBooting, setIsBooting] = useState(true);
  const [isUnauthorized, setIsUnauthorized] = useState(false);
  const [access, setAccess] = useState({ isOwner: false, managedRestaurantIds: [] });

  const [orders, setOrders] = useState([]);
  const [activeServerId, setActiveServerId] = useState(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [hiddenRejectedOrderIds, setHiddenRejectedOrderIds] = useState([]);

  const [refreshing, setRefreshing] = useState(false);
  const [actionOrderId, setActionOrderId] = useState("");
  const [rejectDraft, setRejectDraft] = useState(null);

  const ordersRef = useRef([]);
  const rejectedTimersRef = useRef(new Map());
  const previousStatusesRef = useRef(new Map());
  const activeRefreshPromiseRef = useRef(null);
  const notifyStatusChangeRef = useRef(null);

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const hiddenRejectedSet = useMemo(
    () => new Set(hiddenRejectedOrderIds),
    [hiddenRejectedOrderIds],
  );

  const clearRejectedRemoval = useCallback((orderId) => {
    const timerId = rejectedTimersRef.current.get(orderId);
    if (timerId) {
      window.clearTimeout(timerId);
      rejectedTimersRef.current.delete(orderId);
    }
  }, []);

  const markRejectedHidden = useCallback((orderId) => {
    if (!orderId) return;
    setHiddenRejectedOrderIds((current) =>
      current.includes(orderId) ? current : [...current, orderId],
    );
  }, []);

  const unhideRejected = useCallback((orderId) => {
    if (!orderId) return;
    setHiddenRejectedOrderIds((current) =>
      current.includes(orderId)
        ? current.filter((candidate) => candidate !== orderId)
        : current,
    );
  }, []);

  const isRejectionRemovalExpired = useCallback((order) => {
    if (order?.status !== ORDER_STATUSES.REJECTED_BY_SERVER) return false;
    const value =
      order?.rejectedAt ||
      order?.rejected_at ||
      order?.updatedAt ||
      order?.updated_at;
    if (!value) return false;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return false;
    return Date.now() - parsed >= REJECTION_REMOVAL_DELAY_MS;
  }, []);

  const scheduleRejectedRemoval = useCallback(
    (orderId) => {
      if (!orderId || rejectedTimersRef.current.has(orderId)) return;
      const timerId = window.setTimeout(() => {
        rejectedTimersRef.current.delete(orderId);
        markRejectedHidden(orderId);
      }, REJECTION_REMOVAL_DELAY_MS);
      rejectedTimersRef.current.set(orderId, timerId);
    },
    [markRejectedHidden],
  );

  const handleRejectedOrderLifecycle = useCallback(
    (order, previousStatus) => {
      if (!order?.id) return;
      if (order.status === ORDER_STATUSES.REJECTED_BY_SERVER) {
        if (isRejectionRemovalExpired(order)) {
          clearRejectedRemoval(order.id);
          markRejectedHidden(order.id);
          return;
        }
        unhideRejected(order.id);
        if (previousStatus !== ORDER_STATUSES.REJECTED_BY_SERVER) {
          scheduleRejectedRemoval(order.id);
        }
      } else {
        clearRejectedRemoval(order.id);
        unhideRejected(order.id);
      }
    },
    [
      clearRejectedRemoval,
      isRejectionRemovalExpired,
      markRejectedHidden,
      scheduleRejectedRemoval,
      unhideRejected,
    ],
  );

  const applyOrders = useCallback(
    (incomingOrders) => {
      const nextOrders = Array.isArray(incomingOrders) ? incomingOrders : [];
      const nextOrderIds = new Set(nextOrders.map((order) => order?.id).filter(Boolean));

      nextOrders.forEach((order) => {
        if (!order?.id) return;
        const previousStatus = previousStatusesRef.current.get(order.id);
        if (
          previousStatus &&
          previousStatus !== order.status &&
          typeof notifyStatusChangeRef.current === "function"
        ) {
          notifyStatusChangeRef.current(order.id, order.status, order.customerName);
        }
        previousStatusesRef.current.set(order.id, order.status);
        handleRejectedOrderLifecycle(order, previousStatus);
      });

      for (const orderId of Array.from(previousStatusesRef.current.keys())) {
        if (!nextOrderIds.has(orderId)) {
          previousStatusesRef.current.delete(orderId);
        }
      }

      for (const orderId of Array.from(rejectedTimersRef.current.keys())) {
        if (!nextOrderIds.has(orderId)) {
          clearRejectedRemoval(orderId);
        }
      }

      ordersRef.current = nextOrders;
      setOrders(nextOrders);
    },
    [clearRejectedRemoval, handleRejectedOrderLifecycle],
  );

  const queryOrders = useCallback(async () => {
    if (!supabase) return [];

    let query = supabase
      .from("tablet_orders")
      .select("*")
      .order("created_at", { ascending: true });

    if (!access.isOwner && access.managedRestaurantIds.length > 0) {
      query = query.in("restaurant_id", access.managedRestaurantIds);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data || [])
      .map((row) => deserializeTabletOrder(row))
      .filter(Boolean);
  }, [access]);

  const refreshOrders = useCallback(async () => {
    if (activeRefreshPromiseRef.current) {
      return activeRefreshPromiseRef.current;
    }

    const promise = (async () => {
      const nextOrders = await queryOrders();
      applyOrders(nextOrders);
      return nextOrders;
    })()
      .finally(() => {
        activeRefreshPromiseRef.current = null;
      });

    activeRefreshPromiseRef.current = promise;
    return promise;
  }, [applyOrders, queryOrders]);

  const saveOrder = useCallback(async (order) => {
    if (!supabase) throw new Error("Supabase is not configured.");

    const restaurantId = order?.restaurantId || order?.restaurant_id;
    if (!restaurantId) {
      throw new Error("Order is missing restaurant id.");
    }

    const payload = {
      ...order,
      restaurantId,
      updatedAt: new Date().toISOString(),
    };

    const { error } = await supabase.from("tablet_orders").upsert(
      {
        id: payload.id,
        restaurant_id: payload.restaurantId,
        status: payload.status || ORDER_STATUSES.CODE_ASSIGNED,
        payload,
      },
      { onConflict: "id" },
    );

    if (error) throw error;
    return payload;
  }, []);

  const notifyDinerNotice = useCallback(async (orderId) => {
    if (!supabase || !orderId) return;
    try {
      await supabase.functions.invoke("notify-diner-notice", {
        body: { orderId },
      });
    } catch (error) {
      console.error("[server-tablet-next] failed to notify diner", error);
    }
  }, []);

  const runAction = useCallback(
    async ({ action, orderId, reason }) => {
      if (!orderId) return;
      setActionOrderId(orderId);

      try {
        await refreshOrders();
        const currentOrder = ordersRef.current.find((order) => order.id === orderId);
        if (!currentOrder) return;

        if (currentOrder.status === ORDER_STATUSES.RESCINDED_BY_DINER) {
          window.alert("This notice was rescinded by the diner.");
          return;
        }

        const updatedOrder = cloneOrder(currentOrder);
        if (!updatedOrder) return;

        if (action === "approve") {
          applyServerApprove(updatedOrder);
          applyServerDispatch(updatedOrder);
        } else if (action === "dispatch") {
          applyServerDispatch(updatedOrder);
        } else if (action === "reject") {
          applyServerReject(updatedOrder, reason || "Rejected the notice.");
        } else {
          return;
        }

        await saveOrder(updatedOrder);
        await notifyDinerNotice(updatedOrder.id);
        await refreshOrders();
      } catch (error) {
        console.error("[server-tablet-next] action failed", error);
        window.alert(error?.message || "Unable to update the tablet right now.");
      } finally {
        setActionOrderId("");
      }
    },
    [notifyDinerNotice, refreshOrders, saveOrder],
  );

  const serverGroups = useMemo(
    () =>
      groupOrdersByServer(orders, {
        showCompleted,
        hiddenRejectedSet,
      }),
    [hiddenRejectedSet, orders, showCompleted],
  );

  const serverEntries = useMemo(() => Array.from(serverGroups.entries()), [serverGroups]);

  useEffect(() => {
    if (!serverEntries.length) {
      setActiveServerId(null);
      return;
    }

    if (!activeServerId || !serverGroups.has(activeServerId)) {
      setActiveServerId(serverEntries[0][0]);
    }
  }, [activeServerId, serverEntries, serverGroups]);

  const visibleOrdersForServer = useMemo(() => {
    if (!activeServerId) return [];
    return serverGroups.get(activeServerId) || [];
  }, [activeServerId, serverGroups]);

  const awaitingApprovalCount = useMemo(
    () =>
      orders.filter(
        (order) =>
          order.status === ORDER_STATUSES.SUBMITTED_TO_SERVER &&
          shouldShowOrder(order, { showCompleted, hiddenRejectedSet }),
      ).length,
    [hiddenRejectedSet, orders, showCompleted],
  );

  const readyToDispatchCount = useMemo(
    () =>
      orders.filter(
        (order) =>
          order.status === ORDER_STATUSES.QUEUED_FOR_KITCHEN &&
          shouldShowOrder(order, { showCompleted, hiddenRejectedSet }),
      ).length,
    [hiddenRejectedSet, orders, showCompleted],
  );

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        if (!supabase) {
          throw new Error("Supabase env vars are missing.");
        }

        window.supabaseClient = supabase;

        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();
        if (error) throw error;

        if (!user) {
          window.location.href = "/account?redirect=server-tablet";
          return;
        }

        const isOwner = user.email === OWNER_EMAIL;
        const isManager = user.user_metadata?.role === "manager";
        const managerRestaurants =
          isOwner || isManager
            ? await fetchManagerRestaurants(supabase, user)
            : [];

        const [{ setupTopbar }, notifications] = await Promise.all([
          import(
            /* webpackIgnore: true */
            "/js/shared-nav.js"
          ),
          import(
            /* webpackIgnore: true */
            "/js/order-notifications.js"
          ).catch(() => null),
        ]);

        if (!active) return;

        setupTopbar("server-tablet", user, { managerRestaurants });
        if (typeof notifications?.showOrderNotification === "function") {
          notifyStatusChangeRef.current = notifications.showOrderNotification;
        }

        const hasAccess =
          (isOwner || isManager) &&
          (isOwner || managerRestaurants.length > 0);

        if (!hasAccess) {
          setIsUnauthorized(true);
          setAccess({ isOwner: false, managedRestaurantIds: [] });
          setIsBooting(false);
          return;
        }

        setIsUnauthorized(false);
        setAccess({
          isOwner,
          managedRestaurantIds: managerRestaurants
            .map((restaurant) => restaurant.id)
            .filter(Boolean),
        });
        setIsBooting(false);
      } catch (error) {
        console.error("[server-tablet-next] bootstrap failed", error);
        if (active) {
          setBootError(error?.message || "Failed to load server tablet.");
          setIsBooting(false);
        }
      }
    }

    boot();

    return () => {
      active = false;
      notifyStatusChangeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isBooting || isUnauthorized || !supabase) return;

    refreshOrders().catch((error) => {
      console.error("[server-tablet-next] initial refresh failed", error);
    });
  }, [isBooting, isUnauthorized, refreshOrders]);

  useEffect(() => {
    if (isBooting || isUnauthorized || !supabase) return;

    const managedRestaurantIds = access.managedRestaurantIds;
    const isOwner = access.isOwner;

    const channel = supabase
      .channel("server-tablet-orders-next")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tablet_orders" },
        (payload) => {
          const eventType = payload.eventType;
          const row = eventType === "DELETE" ? payload.old : payload.new;
          const order = deserializeTabletOrder(row);
          if (!order?.id) return;

          if (
            !isOwner &&
            managedRestaurantIds.length > 0 &&
            !managedRestaurantIds.includes(order.restaurantId)
          ) {
            return;
          }

          if (eventType === "DELETE") {
            const nextOrders = ordersRef.current.filter(
              (current) => current.id !== order.id,
            );
            clearRejectedRemoval(order.id);
            unhideRejected(order.id);
            applyOrders(nextOrders);
            return;
          }

          const nextOrders = [...ordersRef.current];
          const index = nextOrders.findIndex((current) => current.id === order.id);
          if (index === -1) {
            nextOrders.push(order);
          } else {
            nextOrders[index] = order;
          }

          applyOrders(nextOrders);
        },
      )
      .subscribe();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [
    access.isOwner,
    access.managedRestaurantIds,
    applyOrders,
    clearRejectedRemoval,
    isBooting,
    isUnauthorized,
    unhideRejected,
  ]);

  useEffect(() => {
    if (isBooting || isUnauthorized) return;

    const timerId = window.setInterval(() => {
      refreshOrders().catch((error) => {
        console.error("[server-tablet-next] auto refresh failed", error);
      });
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isBooting, isUnauthorized, refreshOrders]);

  useEffect(() => {
    return () => {
      for (const timerId of rejectedTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      rejectedTimersRef.current.clear();
    };
  }, []);

  const onRefreshClick = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshOrders();
    } catch (error) {
      console.error("[server-tablet-next] refresh failed", error);
    } finally {
      setRefreshing(false);
    }
  }, [refreshOrders]);

  const onRejectClick = useCallback((order) => {
    setRejectDraft({
      orderId: order.id,
      customerName: order.customerName || "this guest",
      reason: "",
    });
  }, []);

  const onConfirmReject = useCallback(async () => {
    if (!rejectDraft?.orderId) return;
    const { orderId, reason } = rejectDraft;
    setRejectDraft(null);
    await runAction({ action: "reject", orderId, reason });
  }, [rejectDraft, runAction]);

  return (
    <div className="page-shell">
      <style>{`
        .tablet-page {
          display: flex;
          flex-direction: column;
          gap: 24px;
          max-width: 800px;
          margin: 0 auto;
        }

        .tablet-status {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          align-items: center;
        }

        .tablet-filters {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 12px;
          margin-top: 12px;
        }

        .tablet-filter {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 0.9rem;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
        }

        .tablet-filter input {
          width: 16px;
          height: 16px;
          accent-color: #6b7bd9;
          cursor: pointer;
        }

        .tablet-status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(92, 108, 210, 0.15);
          border: 1px solid rgba(92, 108, 210, 0.25);
          border-radius: 999px;
          padding: 8px 16px;
          font-size: 0.9rem;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 500;
        }

        .server-queue {
          display: grid;
          gap: 20px;
        }

        .server-order-card {
          background: linear-gradient(145deg, rgba(26, 35, 65, 0.95), rgba(18, 25, 50, 0.98));
          border-radius: 18px;
          padding: 24px;
          border: 1px solid rgba(92, 108, 210, 0.3);
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.03) inset;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .server-order-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 20px 56px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
        }

        .server-order-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 20px;
          padding-bottom: 16px;
          border-bottom: 1px solid rgba(92, 108, 210, 0.15);
        }

        .server-order-header h2 {
          font-size: 1.4rem;
          font-weight: 600;
          margin: 0 0 8px 0;
          color: #fff;
          letter-spacing: -0.01em;
        }

        .server-order-meta {
          font-size: 0.9rem;
          color: rgba(255, 255, 255, 0.6);
          line-height: 1.6;
        }

        .server-order-meta + .server-order-meta {
          margin-top: 4px;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: 999px;
          font-size: 0.85rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          white-space: nowrap;
        }

        .status-badge[data-tone="warn"] {
          background: linear-gradient(135deg, rgba(255, 193, 7, 0.2), rgba(255, 152, 0, 0.15));
          color: #ffc107;
          border: 1px solid rgba(255, 193, 7, 0.3);
          box-shadow: 0 0 12px rgba(255, 193, 7, 0.15);
        }

        .status-badge[data-tone="warn"]::before {
          content: "";
          width: 8px;
          height: 8px;
          background: #ffc107;
          border-radius: 50%;
          animation: pulse-warn 2s ease-in-out infinite;
        }

        .status-badge[data-tone="info"] {
          background: linear-gradient(135deg, rgba(33, 150, 243, 0.2), rgba(25, 118, 210, 0.15));
          color: #42a5f5;
          border: 1px solid rgba(33, 150, 243, 0.3);
          box-shadow: 0 0 12px rgba(33, 150, 243, 0.15);
        }

        .status-badge[data-tone="info"]::before {
          content: "";
          width: 8px;
          height: 8px;
          background: #42a5f5;
          border-radius: 50%;
          animation: pulse-info 2s ease-in-out infinite;
        }

        .status-badge[data-tone="success"] {
          background: linear-gradient(135deg, rgba(76, 175, 80, 0.2), rgba(56, 142, 60, 0.15));
          color: #66bb6a;
          border: 1px solid rgba(76, 175, 80, 0.3);
          box-shadow: 0 0 12px rgba(76, 175, 80, 0.15);
        }

        .status-badge[data-tone="success"]::before {
          content: "✓";
          font-size: 0.7rem;
        }

        .status-badge[data-tone="danger"] {
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(220, 38, 38, 0.15));
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.35);
          box-shadow: 0 0 12px rgba(239, 68, 68, 0.15);
        }

        .status-badge[data-tone="muted"] {
          background: rgba(92, 108, 210, 0.12);
          color: rgba(255, 255, 255, 0.6);
          border: 1px solid rgba(92, 108, 210, 0.2);
        }

        @keyframes pulse-warn {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }

        @keyframes pulse-info {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }

        .server-order-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 16px;
        }

        .server-order-actions button {
          border-radius: 10px;
          padding: 12px 20px;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .server-order-actions button.primary-btn {
          background: linear-gradient(135deg, #5c6cd2, #4a5bc7);
          border: none;
          color: #fff;
          box-shadow: 0 4px 16px rgba(92, 108, 210, 0.35);
        }

        .server-order-actions button.primary-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #6b7bd9, #5565cf);
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(92, 108, 210, 0.45);
        }

        .server-order-actions button.danger-btn {
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.85), rgba(220, 38, 38, 0.85));
          border: 1px solid rgba(239, 68, 68, 0.6);
          color: #fff;
          box-shadow: 0 4px 14px rgba(239, 68, 68, 0.35);
        }

        .server-order-actions button.danger-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, rgba(248, 113, 113, 0.9), rgba(239, 68, 68, 0.9));
          border-color: rgba(248, 113, 113, 0.8);
          transform: translateY(-1px);
          box-shadow: 0 6px 18px rgba(239, 68, 68, 0.45);
        }

        .server-order-actions button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .empty-tablet-state {
          text-align: center;
          padding: 64px 32px;
          border: 2px dashed rgba(92, 108, 210, 0.3);
          border-radius: 20px;
          color: rgba(255, 255, 255, 0.5);
          background: linear-gradient(145deg, rgba(26, 35, 65, 0.5), rgba(18, 25, 50, 0.6));
          font-size: 1.05rem;
        }

        .server-order-timestamps {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid rgba(92, 108, 210, 0.1);
        }

        .server-order-timestamp {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.5);
          margin-top: 4px;
        }

        .server-order-timestamp-time {
          color: rgba(255, 255, 255, 0.35);
          margin-left: 8px;
        }

        .server-tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }

        .server-tab {
          border-radius: 999px;
          padding: 10px 18px;
          background: rgba(92, 108, 210, 0.12);
          color: rgba(255, 255, 255, 0.6);
          cursor: pointer;
          border: 1px solid transparent;
          font-size: 0.9rem;
          font-weight: 500;
          transition: all 0.2s ease;
        }

        .server-tab:hover {
          background: rgba(92, 108, 210, 0.2);
          color: rgba(255, 255, 255, 0.8);
        }

        .server-tab.is-active {
          background: linear-gradient(135deg, rgba(92, 108, 210, 0.35), rgba(92, 108, 210, 0.25));
          color: #fff;
          border-color: rgba(92, 108, 210, 0.4);
          box-shadow: 0 2px 8px rgba(92, 108, 210, 0.2);
        }

        .server-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(5, 8, 20, 0.75);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 12000;
          padding: 24px;
        }

        .server-modal {
          width: min(420px, 90vw);
          background: linear-gradient(180deg, rgba(14, 20, 50, 0.98), rgba(8, 12, 32, 0.98));
          border: 1px solid rgba(92, 108, 210, 0.4);
          border-radius: 18px;
          box-shadow: 0 28px 60px rgba(4, 8, 26, 0.7);
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 18px;
          color: #f1f5ff;
        }

        .server-modal h3 {
          margin: 0;
          font-size: 1.15rem;
        }

        .server-modal p {
          margin: 0;
          color: #cdd5ff;
          line-height: 1.45;
          font-size: 0.95rem;
        }

        .server-modal textarea {
          width: 100%;
          min-height: 90px;
          border-radius: 10px;
          padding: 10px 12px;
          border: 1px solid rgba(92, 108, 210, 0.4);
          background: rgba(6, 10, 26, 0.9);
          color: #f8fafc;
          resize: vertical;
          font-size: 0.95rem;
        }

        .server-modal textarea:focus {
          outline: 2px solid rgba(120, 140, 255, 0.6);
          outline-offset: 2px;
        }

        .server-modal-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          flex-wrap: wrap;
        }

        .server-modal-actions button {
          padding: 10px 16px;
          border-radius: 10px;
          border: 1px solid transparent;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
        }

        .server-modal-actions .cancel-btn {
          background: rgba(36, 45, 95, 0.8);
          border-color: rgba(92, 108, 210, 0.4);
          color: #e0e7ff;
        }

        .server-modal-actions .cancel-btn:hover {
          background: rgba(52, 63, 130, 0.95);
        }

        .server-modal-actions .confirm-btn {
          background: #ef4444;
          color: #fff;
        }

        .server-modal-actions .confirm-btn:hover {
          background: #f87171;
        }

        @media (max-width: 600px) {
          .tablet-page {
            padding: 0 12px;
          }

          .server-order-card {
            padding: 18px;
          }

          .server-order-header h2 {
            font-size: 1.2rem;
          }

          .server-order-actions {
            flex-direction: column;
          }

          .server-order-actions button {
            width: 100%;
            justify-content: center;
          }

          .server-tabs {
            overflow-x: auto;
            flex-wrap: nowrap;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            -ms-overflow-style: none;
            padding-bottom: 4px;
          }

          .server-tabs::-webkit-scrollbar {
            display: none;
          }

          .server-tab {
            flex-shrink: 0;
          }
        }
      `}</style>

      <header className="simple-topbar">
        <div className="simple-topbar-inner">
          <Link className="simple-brand" href="/restaurants">
            <img
              src="https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png"
              alt="Clarivore logo"
            />
            <span>Clarivore</span>
          </Link>
          <div className="simple-nav" />
          <div
            className="mode-toggle-container"
            id="modeToggleContainer"
            style={{ display: "none" }}
          />
        </div>
      </header>

      <main className="page-main">
        <div className="page-content tablet-page">
          <header>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 16,
                marginBottom: 12,
              }}
            >
              <div>
                <h1>Server monitor</h1>
                <p className="muted-text">
                  Review allergy notices waiting for approval or dispatch.
                </p>
              </div>
              <button
                type="button"
                className="secondary-btn"
                style={{ whiteSpace: "nowrap" }}
                onClick={onRefreshClick}
                disabled={refreshing || isBooting || isUnauthorized}
              >
                {refreshing ? "Refreshing..." : "Refresh orders"}
              </button>
            </div>

            <div className="tablet-status">
              <span className="tablet-status-badge">
                Awaiting approval: {awaitingApprovalCount}
              </span>
              <span className="tablet-status-badge">
                Ready to dispatch: {readyToDispatchCount}
              </span>
            </div>

            <div className="tablet-filters">
              <label className="tablet-filter" htmlFor="server-show-completed">
                <input
                  type="checkbox"
                  id="server-show-completed"
                  checked={showCompleted}
                  onChange={(event) => setShowCompleted(event.target.checked)}
                />
                <span>Show completed/rescinded</span>
              </label>
            </div>
          </header>

          <section>
            {serverEntries.length > 0 ? (
              <div className="server-tabs" role="tablist" aria-label="Server tabs">
                {serverEntries.map(([serverId, serverOrders]) => {
                  const serverName =
                    serverOrders[0]?.serverName || `Server ${serverId}`;
                  const isActive = serverId === activeServerId;
                  return (
                    <button
                      key={serverId}
                      type="button"
                      className={`server-tab${isActive ? " is-active" : ""}`}
                      onClick={() => setActiveServerId(serverId)}
                    >
                      {serverName}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="server-queue">
              {isBooting ? (
                <div className="empty-tablet-state">Loading server monitor...</div>
              ) : isUnauthorized ? (
                <div className="empty-tablet-state">
                  You do not have access to the server station tablet.
                </div>
              ) : bootError ? (
                <div className="empty-tablet-state">{bootError}</div>
              ) : serverEntries.length === 0 ? (
                <div className="empty-tablet-state">
                  Waiting for diners to submit codes. Notices will appear here once received.
                </div>
              ) : visibleOrdersForServer.length === 0 ? (
                <div className="empty-tablet-state">
                  No active notices for this server.
                </div>
              ) : (
                visibleOrdersForServer.map((order) => {
                  const tableLabel = order.tableNumber
                    ? `Table ${order.tableNumber}`
                    : "Table -";
                  const dishes =
                    Array.isArray(order.items) && order.items.length > 0
                      ? order.items.join(", ")
                      : "No dishes listed";
                  const allergies =
                    Array.isArray(order.allergies) && order.allergies.length > 0
                      ? order.allergies.join(", ")
                      : "None listed";
                  const diets =
                    Array.isArray(order.diets) && order.diets.length > 0
                      ? order.diets.join(", ")
                      : "None saved";
                  const descriptor = resolveStatusDescriptor(order.status);
                  const { submittedTime, updates } = getOrderTimestamps(order);
                  const isOrderBusy = actionOrderId === order.id;

                  return (
                    <article className="server-order-card" key={order.id}>
                      <div className="server-order-header">
                        <div>
                          <h2>{`${tableLabel} (${getFirstName(order.customerName)})`}</h2>
                          <div className="server-order-meta">Dishes: {dishes}</div>
                          {submittedTime ? (
                            <div className="server-order-meta">
                              Submitted: {formatTimestamp(submittedTime)}
                            </div>
                          ) : null}
                        </div>
                        <span className="status-badge" data-tone={descriptor.tone}>
                          {descriptor.label}
                        </span>
                      </div>

                      <div className="server-order-meta">Allergies: {allergies}</div>
                      <div className="server-order-meta">Diets: {diets}</div>
                      {order.customNotes ? (
                        <div className="server-order-meta">Notes: {order.customNotes}</div>
                      ) : null}

                      {updates.length > 0 ? (
                        <div className="server-order-timestamps">
                          {updates.map((entry, index) => (
                            <div className="server-order-timestamp" key={`${order.id}-${index}`}>
                              <strong>{entry.actor}:</strong> {entry.message}
                              <span className="server-order-timestamp-time">
                                {formatTimestamp(entry.at)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {order.status === ORDER_STATUSES.SUBMITTED_TO_SERVER ? (
                        <div className="server-order-actions">
                          <button
                            type="button"
                            className="primary-btn"
                            disabled={isOrderBusy}
                            onClick={() =>
                              runAction({ action: "approve", orderId: order.id })
                            }
                          >
                            {isOrderBusy ? "Updating..." : "Approve & stage for kitchen"}
                          </button>
                          <button
                            type="button"
                            className="danger-btn"
                            disabled={isOrderBusy}
                            onClick={() => onRejectClick(order)}
                          >
                            Reject notice
                          </button>
                        </div>
                      ) : null}

                      {order.status === ORDER_STATUSES.QUEUED_FOR_KITCHEN ? (
                        <div className="server-order-actions">
                          <button
                            type="button"
                            className="primary-btn"
                            disabled={isOrderBusy}
                            onClick={() =>
                              runAction({ action: "dispatch", orderId: order.id })
                            }
                          >
                            {isOrderBusy ? "Updating..." : "Send to kitchen"}
                          </button>
                          <button
                            type="button"
                            className="danger-btn"
                            disabled={isOrderBusy}
                            onClick={() => onRejectClick(order)}
                          >
                            Reject notice
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </main>

      {rejectDraft ? (
        <div
          className="server-modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setRejectDraft(null);
            }
          }}
        >
          <div className="server-modal" role="dialog" aria-modal="true">
            <h3>Reject {rejectDraft.customerName}&apos;s notice?</h3>
            <p>
              This will remove the request from the server tablet and alert the diner.
              Add an optional note so they know what to fix.
            </p>
            <textarea
              aria-label="Reason for rejection"
              placeholder="Optional message to diner (for example: Need manager approval first.)"
              value={rejectDraft.reason}
              onChange={(event) =>
                setRejectDraft((current) =>
                  current
                    ? {
                        ...current,
                        reason: event.target.value,
                      }
                    : current,
                )
              }
            />
            <div className="server-modal-actions">
              <button
                type="button"
                className="cancel-btn"
                onClick={() => setRejectDraft(null)}
              >
                Cancel rejection
              </button>
              <button
                type="button"
                className="confirm-btn"
                disabled={actionOrderId === rejectDraft.orderId}
                onClick={onConfirmReject}
              >
                {actionOrderId === rejectDraft.orderId
                  ? "Rejecting..."
                  : "Confirm rejection"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
