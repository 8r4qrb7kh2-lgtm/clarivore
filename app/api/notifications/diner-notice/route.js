import {
  asText,
  isAppAdminUser,
  prisma,
  requireAuthenticatedSession,
} from "../../restaurant-write/_shared/writeGatewayUtils";

export const runtime = "nodejs";

const STATUS_MESSAGES = {
  awaiting_server_approval: "Your notice is waiting for server approval.",
  queued_for_kitchen: "Your notice has been approved and queued for the kitchen.",
  with_kitchen: "Your notice is now with the kitchen.",
  acknowledged: "The kitchen acknowledged your notice.",
  awaiting_user_response: "The kitchen has a follow-up question.",
  question_answered: "Your response was sent to the kitchen.",
  rejected_by_server: "The server rejected your notice.",
  rejected_by_kitchen: "The kitchen rejected your notice.",
  rescinded_by_diner: "You rescinded this notice.",
};

function json(payload, status = 200) {
  return Response.json(payload, { status });
}

function latestExternalUpdate(history) {
  const entries = Array.isArray(history) ? history : [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (asText(entry?.actor) && asText(entry?.actor) !== "Diner") {
      return entry;
    }
  }
  return null;
}

function buildNotificationBody(status, message) {
  const raw = asText(message) || STATUS_MESSAGES[status] || "Your notice was updated.";
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 177)}...`;
}

function buildDishTitle(items) {
  const list = Array.isArray(items)
    ? items.map((item) => asText(item)).filter(Boolean)
    : [];
  if (!list.length) return "your dish";
  if (list.length === 1) return list[0];
  return `${list[0]} + ${list.length - 1} more`;
}

async function ensureCallerAuthorized({ userId, restaurantId }) {
  const isAdmin = await isAppAdminUser(prisma, userId);
  if (isAdmin) return true;

  const manager = await prisma.restaurant_managers.findFirst({
    where: {
      user_id: userId,
      restaurant_id: restaurantId,
    },
    select: { id: true },
  });

  return Boolean(manager?.id);
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const session = await requireAuthenticatedSession(request);
    const orderId = asText(body?.orderId);
    if (!orderId) {
      return json({ error: "Missing orderId" }, 400);
    }

    const orderRow = await prisma.tablet_orders.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, payload: true, restaurant_id: true },
    });

    if (!orderRow) {
      return json({ error: "Order not found" }, 404);
    }

    const payload = orderRow.payload && typeof orderRow.payload === "object" ? orderRow.payload : {};
    const restaurantId = asText(payload.restaurantId || orderRow.restaurant_id);

    const authorized = await ensureCallerAuthorized({
      userId: session.userId,
      restaurantId,
    });

    if (!authorized) {
      return json({ error: "Not authorized" }, 403);
    }

    const userId = asText(payload.userId || payload.user_id);
    if (!userId) {
      return json({ skipped: true, reason: "no_user" }, 200);
    }

    const restaurant = restaurantId
      ? await prisma.restaurants.findUnique({
          where: { id: restaurantId },
          select: { name: true, slug: true },
        })
      : null;

    const history = Array.isArray(payload.history) ? payload.history : [];
    const latestUpdate = latestExternalUpdate(history);
    const status = asText(orderRow.status || payload.status);
    const bodyText = buildNotificationBody(status, latestUpdate?.message);
    const dishTitle = buildDishTitle(payload.items);
    const title = dishTitle ? `Notice update for ${dishTitle}` : "Notice update";
    const url = asText(restaurant?.slug)
      ? `/restaurant?slug=${encodeURIComponent(asText(restaurant.slug))}`
      : "/restaurants";

    // Placeholder until web push/APNS transport is migrated fully into Next runtime.
    console.log("[diner-notice] notification", {
      orderId,
      userId,
      title,
      body: bodyText,
      url,
    });

    return json(
      {
        success: true,
        pushesSent: 0,
        iosPushesSent: 0,
      },
      200,
    );
  } catch (error) {
    const message = asText(error?.message) || "Request failed";
    const status =
      message === "Missing authorization token" || message === "Invalid user session"
        ? 401
        : message === "Not authorized"
          ? 403
          : 500;

    return json({ error: message }, status);
  }
}
