export function cloneTabletOrder(order) {
  if (!order) return null;
  if (typeof structuredClone === "function") {
    return structuredClone(order);
  }
  try {
    return JSON.parse(JSON.stringify(order));
  } catch {
    return null;
  }
}

export async function fetchAccessibleTabletOrders({
  supabase,
  access,
  deserializeOrder,
}) {
  if (!supabase) return [];

  let query = supabase
    .from("tablet_orders")
    .select("*")
    .order("created_at", { ascending: true });

  if (!access?.isOwner && access?.managedRestaurantIds?.length > 0) {
    query = query.in("restaurant_id", access.managedRestaurantIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  if (typeof deserializeOrder !== "function") {
    return rows;
  }
  return rows.map((row) => deserializeOrder(row)).filter(Boolean);
}

export async function upsertTabletOrder({ supabase, order, fallbackStatus }) {
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
      status: payload.status || fallbackStatus || null,
      payload,
    },
    { onConflict: "id" },
  );

  if (error) throw error;
  return payload;
}

export async function notifyDinerNoticeUpdate({ supabase, orderId, logLabel }) {
  if (!supabase || !orderId) return;
  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;

    const accessToken = String(session?.access_token || "").trim();
    if (!accessToken) {
      throw new Error("Missing access token");
    }

    const response = await fetch("/api/notifications/diner-notice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ orderId }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `Notification request failed (${response.status})`);
    }
  } catch (error) {
    if (logLabel) {
      console.error(`[${logLabel}] failed to notify diner`, error);
    } else {
      console.error("[tablet-order-persistence] failed to notify diner", error);
    }
  }
}
