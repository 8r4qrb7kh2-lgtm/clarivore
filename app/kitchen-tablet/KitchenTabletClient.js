"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseClient as supabase } from "../lib/supabase";
import { OWNER_EMAIL, fetchManagerRestaurants } from "../lib/managerRestaurants";
import { showOrderNotification } from "../lib/orderNotifications";
import {
  KITCHEN_RELEVANT_STATUSES,
  KITCHEN_STATUS_DESCRIPTORS,
  ORDER_STATUSES,
  canRenderKitchenOrder,
  deserializeTabletOrder,
  formatTimestamp,
  getFirstName,
  getOrderTimestamps,
  kitchenAcknowledgeOrder,
  kitchenAskQuestionOrder,
  kitchenRejectOrder,
} from "./kitchenTabletLogic";

const AUTO_REFRESH_INTERVAL_MS = 15000;

function cloneOrder(order) {
  if (!order) return null;
  if (typeof structuredClone === "function") {
    return structuredClone(order);
  }
  return JSON.parse(JSON.stringify(order));
}

function statusDescriptor(status) {
  return (
    KITCHEN_STATUS_DESCRIPTORS[status] || {
      label: String(status || "Unknown"),
      tone: "muted",
    }
  );
}

export default function KitchenTabletClient() {
  const router = useRouter();
  const [bootError, setBootError] = useState("");
  const [isBooting, setIsBooting] = useState(true);
  const [isUnauthorized, setIsUnauthorized] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [access, setAccess] = useState({ isOwner: false, managedRestaurantIds: [] });

  const [orders, setOrders] = useState([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionOrderId, setActionOrderId] = useState("");
  const [promptDraft, setPromptDraft] = useState(null);

  const ordersRef = useRef([]);
  const previousStatusesRef = useRef(new Map());
  const activeRefreshPromiseRef = useRef(null);
  const notifyStatusChangeRef = useRef(showOrderNotification);

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const visibleOrders = useMemo(
    () =>
      orders.filter((order) => {
        if (!KITCHEN_RELEVANT_STATUSES.has(order.status)) return false;
        return canRenderKitchenOrder(order, showCompleted);
      }),
    [orders, showCompleted],
  );

  const applyOrders = useCallback((incomingOrders) => {
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
    });

    for (const orderId of Array.from(previousStatusesRef.current.keys())) {
      if (!nextOrderIds.has(orderId)) {
        previousStatusesRef.current.delete(orderId);
      }
    }

    ordersRef.current = nextOrders;
    setOrders(nextOrders);
  }, []);

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
    })().finally(() => {
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
        status: payload.status || ORDER_STATUSES.WITH_KITCHEN,
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
      console.error("[kitchen-tablet-next] failed to notify diner", error);
    }
  }, []);

  const runAction = useCallback(
    async ({ action, orderId, value }) => {
      if (!orderId) return;
      setActionOrderId(orderId);

      try {
        await refreshOrders();
        const currentOrder = ordersRef.current.find((order) => order.id === orderId);
        if (!currentOrder) {
          throw new Error("Order not found.");
        }

        const latestOrder = cloneOrder(currentOrder);
        if (!latestOrder) return;

        if (action === "acknowledge") {
          kitchenAcknowledgeOrder(latestOrder);
        } else if (action === "question") {
          kitchenAskQuestionOrder(latestOrder, value);
        } else if (action === "reject") {
          kitchenRejectOrder(latestOrder, value);
        } else {
          return;
        }

        await saveOrder(latestOrder);
        await notifyDinerNotice(latestOrder.id);
        await refreshOrders();
      } catch (error) {
        console.error("[kitchen-tablet-next] action failed", error);
        window.alert(error?.message || "Unable to update this notice right now.");
      } finally {
        setActionOrderId("");
      }
    },
    [notifyDinerNotice, refreshOrders, saveOrder],
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
          router.replace("/account?redirect=kitchen-tablet");
          return;
        }
        setAuthUser(user);

        const isOwner = user.email === OWNER_EMAIL;
        const isManager = user.user_metadata?.role === "manager";
        const managerRestaurants =
          isOwner || isManager
            ? await fetchManagerRestaurants(supabase, user)
            : [];

        if (!active) return;

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
        console.error("[kitchen-tablet-next] bootstrap failed", error);
        if (active) {
          setBootError(error?.message || "Failed to load kitchen tablet.");
          setIsBooting(false);
        }
      }
    }

    boot();

    return () => {
      active = false;
      notifyStatusChangeRef.current = null;
    };
  }, [router]);

  const onSignOut = useCallback(async () => {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
      router.replace("/account?mode=signin");
    } catch (error) {
      console.error("[kitchen-tablet-next] sign-out failed", error);
      setBootError("Unable to sign out right now.");
    }
  }, [router]);

  useEffect(() => {
    if (isBooting || isUnauthorized || !supabase) return;

    refreshOrders().catch((error) => {
      console.error("[kitchen-tablet-next] initial refresh failed", error);
    });
  }, [isBooting, isUnauthorized, refreshOrders]);

  useEffect(() => {
    if (isBooting || isUnauthorized || !supabase) return;

    const managedRestaurantIds = access.managedRestaurantIds;
    const isOwner = access.isOwner;

    const channel = supabase
      .channel("kitchen-tablet-orders-next")
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
            applyOrders(
              ordersRef.current.filter((current) => current.id !== order.id),
            );
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
  }, [access.isOwner, access.managedRestaurantIds, applyOrders, isBooting, isUnauthorized]);

  useEffect(() => {
    if (isBooting || isUnauthorized) return;

    const timerId = window.setInterval(() => {
      refreshOrders().catch((error) => {
        console.error("[kitchen-tablet-next] auto refresh failed", error);
      });
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isBooting, isUnauthorized, refreshOrders]);

  const onRefreshClick = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshOrders();
    } catch (error) {
      console.error("[kitchen-tablet-next] refresh failed", error);
    } finally {
      setRefreshing(false);
    }
  }, [refreshOrders]);

  const onActionClick = useCallback((action, order) => {
    if (!order?.id) return;

    if (action === "question") {
      setPromptDraft({
        mode: "question",
        orderId: order.id,
        title: "Send follow-up question",
        message: "Dictate the yes/no follow-up you need the diner to answer:",
        confirmText: "Send question",
        placeholder: "Type the follow-up question...",
        value: "",
      });
      return;
    }

    if (action === "reject") {
      setPromptDraft({
        mode: "reject",
        orderId: order.id,
        title: "Reject notice",
        message: "Why are you rejecting this notice?",
        confirmText: "Reject order",
        placeholder: "Share the reason for rejecting this notice...",
        value: "",
      });
      return;
    }

    runAction({ action, orderId: order.id });
  }, [runAction]);

  const onConfirmPrompt = useCallback(async () => {
    if (!promptDraft?.orderId || !promptDraft.mode) return;

    const text = String(promptDraft.value || "").trim();
    if (promptDraft.mode === "question" && !text) {
      window.alert("Add a question before sending.");
      return;
    }

    const orderId = promptDraft.orderId;
    const mode = promptDraft.mode;
    setPromptDraft(null);

    await runAction({
      action: mode,
      orderId,
      value: text,
    });
  }, [promptDraft, runAction]);

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

        .kitchen-queue {
          display: grid;
          gap: 20px;
        }

        .kitchen-card {
          background: linear-gradient(145deg, rgba(26, 35, 65, 0.95), rgba(18, 25, 50, 0.98));
          border-radius: 18px;
          padding: 24px;
          border: 1px solid rgba(92, 108, 210, 0.3);
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.03) inset;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .kitchen-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 20px 56px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
        }

        .kitchen-card header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 20px;
          padding-bottom: 16px;
          border-bottom: 1px solid rgba(92, 108, 210, 0.15);
        }

        .kitchen-card header h2 {
          font-size: 1.4rem;
          font-weight: 600;
          margin: 0 0 8px 0;
          color: #fff;
          letter-spacing: -0.01em;
        }

        .kitchen-meta {
          font-size: 0.9rem;
          color: rgba(255, 255, 255, 0.6);
          line-height: 1.6;
        }

        .kitchen-meta + .kitchen-meta {
          margin-top: 4px;
        }

        .kitchen-action-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin: 8px 0 16px;
        }

        .question-inline {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: baseline;
        }

        .question-inline strong {
          color: #fff;
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

        .kitchen-action-row button {
          border-radius: 10px;
          padding: 12px 20px;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .kitchen-action-row .primary-btn {
          background: linear-gradient(135deg, #5c6cd2, #4a5bc7);
          border: none;
          color: #fff;
          box-shadow: 0 4px 16px rgba(92, 108, 210, 0.35);
        }

        .kitchen-action-row .primary-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #6b7bd9, #5565cf);
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(92, 108, 210, 0.45);
        }

        .kitchen-action-row .secondary-btn {
          background: rgba(92, 108, 210, 0.12);
          border: 1px solid rgba(92, 108, 210, 0.3);
          color: rgba(255, 255, 255, 0.8);
        }

        .kitchen-action-row .secondary-btn:hover:not(:disabled) {
          background: rgba(92, 108, 210, 0.2);
          border-color: rgba(92, 108, 210, 0.4);
        }

        .kitchen-action-row .danger-btn {
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.85), rgba(220, 38, 38, 0.85));
          border: 1px solid rgba(239, 68, 68, 0.6);
          color: #fff;
          box-shadow: 0 4px 14px rgba(239, 68, 68, 0.35);
        }

        .kitchen-action-row .danger-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, rgba(248, 113, 113, 0.9), rgba(239, 68, 68, 0.9));
          border-color: rgba(248, 113, 113, 0.8);
          transform: translateY(-1px);
          box-shadow: 0 6px 18px rgba(239, 68, 68, 0.45);
        }

        .kitchen-action-row button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .question-card,
        .ack-log {
          margin-top: 16px;
          padding: 16px;
          border-radius: 12px;
          background: rgba(92, 108, 210, 0.1);
          border: 1px solid rgba(92, 108, 210, 0.15);
          color: rgba(255, 255, 255, 0.75);
          font-size: 0.9rem;
          line-height: 1.5;
        }

        .question-card strong,
        .ack-log strong {
          color: rgba(255, 255, 255, 0.9);
        }

        .ack-log ul {
          margin: 8px 0 0 0;
          padding-left: 20px;
        }

        .ack-log li {
          margin-top: 4px;
          color: rgba(255, 255, 255, 0.6);
        }

        .kitchen-timestamps {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid rgba(92, 108, 210, 0.1);
        }

        .kitchen-timestamp {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.5);
          margin-top: 4px;
        }

        .kitchen-timestamp-time {
          color: rgba(255, 255, 255, 0.35);
          margin-left: 8px;
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

        .kitchen-prompt-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(7, 10, 24, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          z-index: 4000;
        }

        .kitchen-prompt-modal {
          width: min(460px, 92vw);
          background: rgba(14, 20, 44, 0.98);
          border-radius: 16px;
          padding: 20px;
          border: 1px solid rgba(92, 108, 210, 0.35);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .kitchen-prompt-modal h3 {
          margin: 0;
          font-size: 1.2rem;
          color: #fff;
        }

        .kitchen-prompt-modal p {
          margin: 0;
          color: rgba(255, 255, 255, 0.7);
          font-size: 0.95rem;
          line-height: 1.5;
        }

        .kitchen-prompt-modal textarea {
          width: 100%;
          min-height: 120px;
          border-radius: 12px;
          border: 1px solid rgba(92, 108, 210, 0.4);
          background: rgba(9, 14, 34, 0.9);
          color: #fff;
          padding: 12px 14px;
          font-size: 0.95rem;
          resize: vertical;
        }

        .kitchen-prompt-modal textarea:focus {
          outline: none;
          border-color: rgba(92, 108, 210, 0.7);
          box-shadow: 0 0 0 3px rgba(92, 108, 210, 0.2);
        }

        .kitchen-prompt-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          justify-content: flex-end;
        }

        @media (max-width: 600px) {
          .tablet-page {
            padding: 0 12px;
          }

          .kitchen-card {
            padding: 18px;
          }

          .kitchen-card header h2 {
            font-size: 1.2rem;
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
          <div className="simple-nav">
            <Link href="/manager-dashboard">Dashboard</Link>
            <Link href="/server-tablet">Server monitor</Link>
            <Link href="/help-contact">Help</Link>
            {authUser ? (
              <button type="button" className="btnLink" onClick={onSignOut}>
                Sign out
              </button>
            ) : (
              <Link href="/account?mode=signin">Sign in</Link>
            )}
          </div>
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
                <h1>Kitchen monitor</h1>
                <p className="muted-text">
                  Acknowledgements and follow-ups for active allergy notices.
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

            <div className="tablet-filters">
              <label className="tablet-filter" htmlFor="kitchen-show-completed">
                <input
                  type="checkbox"
                  id="kitchen-show-completed"
                  checked={showCompleted}
                  onChange={(event) => setShowCompleted(event.target.checked)}
                />
                <span>Show completed/rescinded</span>
              </label>
            </div>
          </header>

          <section>
            <div className="kitchen-queue">
              {isBooting ? (
                <div className="empty-tablet-state">Loading kitchen monitor...</div>
              ) : isUnauthorized ? (
                <div className="empty-tablet-state">
                  You do not have access to the kitchen line tablet.
                </div>
              ) : bootError ? (
                <div className="empty-tablet-state">{bootError}</div>
              ) : visibleOrders.length === 0 ? (
                <div className="empty-tablet-state">
                  Kitchen is idle. Notices appear here after the server dispatches them.
                </div>
              ) : (
                visibleOrders.map((order) => {
                  const allergies =
                    Array.isArray(order.allergies) && order.allergies.length
                      ? order.allergies.join(", ")
                      : "None listed";
                  const dishes =
                    Array.isArray(order.items) && order.items.length
                      ? order.items.join(", ")
                      : "No dishes listed";
                  const tableLabel = order.tableNumber
                    ? `Table ${order.tableNumber}`
                    : "Table -";
                  const descriptor = statusDescriptor(order.status);
                  const { submittedTime, updates } = getOrderTimestamps(order);
                  const isBusy = actionOrderId === order.id;

                  const canAskQuestion =
                    ![
                      ORDER_STATUSES.RESCINDED_BY_DINER,
                      ORDER_STATUSES.REJECTED_BY_KITCHEN,
                    ].includes(order.status) &&
                    [
                      ORDER_STATUSES.WITH_KITCHEN,
                      ORDER_STATUSES.ACKNOWLEDGED,
                      ORDER_STATUSES.QUESTION_ANSWERED,
                    ].includes(order.status);

                  const canReject =
                    ![
                      ORDER_STATUSES.RESCINDED_BY_DINER,
                      ORDER_STATUSES.REJECTED_BY_KITCHEN,
                    ].includes(order.status);

                  return (
                    <article className="kitchen-card" key={order.id}>
                      <header>
                        <div>
                          <h2>{`${tableLabel} (${getFirstName(order.customerName)})`}</h2>
                          <div className="kitchen-meta">Allergies: {allergies}</div>
                          <div className="kitchen-meta">Dishes: {dishes}</div>
                          {submittedTime ? (
                            <div className="kitchen-meta">
                              Submitted: {formatTimestamp(submittedTime)}
                            </div>
                          ) : null}
                        </div>
                        <span className="status-badge" data-tone={descriptor.tone}>
                          {descriptor.label}
                        </span>
                      </header>

                      <div className="kitchen-action-row">
                        {order.status === ORDER_STATUSES.RESCINDED_BY_DINER ? (
                          <button type="button" className="secondary-btn" disabled>
                            Rescinded by diner
                          </button>
                        ) : order.status === ORDER_STATUSES.REJECTED_BY_KITCHEN ? (
                          <button type="button" className="secondary-btn" disabled>
                            Rejected by kitchen
                          </button>
                        ) : [
                            ORDER_STATUSES.WITH_KITCHEN,
                            ORDER_STATUSES.QUESTION_ANSWERED,
                          ].includes(order.status) ? (
                          <button
                            type="button"
                            className="primary-btn"
                            disabled={isBusy}
                            onClick={() => onActionClick("acknowledge", order)}
                          >
                            {isBusy ? "Updating..." : "Acknowledge notice"}
                          </button>
                        ) : order.status === ORDER_STATUSES.ACKNOWLEDGED ? (
                          <button type="button" className="secondary-btn" disabled>
                            Acknowledged
                          </button>
                        ) : (
                          <button type="button" className="secondary-btn" disabled>
                            Waiting on diner
                          </button>
                        )}

                        {canAskQuestion ? (
                          <button
                            type="button"
                            className="secondary-btn"
                            disabled={isBusy}
                            onClick={() => onActionClick("question", order)}
                          >
                            Send follow-up question
                          </button>
                        ) : null}

                        {canReject ? (
                          <button
                            type="button"
                            className="danger-btn"
                            disabled={isBusy}
                            onClick={() => onActionClick("reject", order)}
                          >
                            Reject order
                          </button>
                        ) : null}
                      </div>

                      {order.kitchenQuestion ? (
                        <div className="question-card">
                          <div className="question-inline">
                            <strong>{canAskQuestion ? "Previous follow-up:" : "Follow-up:"}</strong>
                            <span>{order.kitchenQuestion.text}</span>
                          </div>
                          <span className="kitchen-meta">
                            {order.kitchenQuestion.response
                              ? `Diner responded ${String(
                                  order.kitchenQuestion.response,
                                ).toUpperCase()}`
                              : "Awaiting diner response"}
                          </span>
                        </div>
                      ) : null}

                      {updates.length > 0 ? (
                        <div className="kitchen-timestamps">
                          {updates.map((entry, index) => (
                            <div className="kitchen-timestamp" key={`${order.id}-${index}`}>
                              <strong>{entry.actor}:</strong> {entry.message}
                              <span className="kitchen-timestamp-time">
                                {formatTimestamp(entry.at)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {Array.isArray(order.faceIdAudit) && order.faceIdAudit.length ? (
                        <div className="ack-log">
                          <strong>Acknowledgements</strong>
                          <ul>
                            {order.faceIdAudit.map((entry, index) => (
                              <li key={`${order.id}-ack-${index}`}>
                                {entry.chefName}
                                {entry.role ? ` - ${entry.role}` : ""}
                                {entry.at ? ` - ${formatTimestamp(entry.at)}` : ""}
                              </li>
                            ))}
                          </ul>
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

      {promptDraft ? (
        <div
          className="kitchen-prompt-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setPromptDraft(null);
            }
          }}
        >
          <div className="kitchen-prompt-modal" role="dialog" aria-modal="true">
            <h3>{promptDraft.title}</h3>
            <p>{promptDraft.message}</p>
            <textarea
              placeholder={promptDraft.placeholder}
              value={promptDraft.value}
              onChange={(event) =>
                setPromptDraft((current) =>
                  current
                    ? {
                        ...current,
                        value: event.target.value,
                      }
                    : current,
                )
              }
            />
            <div className="kitchen-prompt-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setPromptDraft(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={actionOrderId === promptDraft.orderId}
                onClick={onConfirmPrompt}
              >
                {actionOrderId === promptDraft.orderId
                  ? "Saving..."
                  : promptDraft.confirmText}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
