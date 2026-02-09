export const ORDER_STATUSES = Object.freeze({
  DRAFT: "draft",
  CODE_ASSIGNED: "awaiting_user_submission",
  SUBMITTED_TO_SERVER: "awaiting_server_approval",
  QUEUED_FOR_KITCHEN: "queued_for_kitchen",
  WITH_KITCHEN: "with_kitchen",
  ACKNOWLEDGED: "acknowledged",
  AWAITING_USER_RESPONSE: "awaiting_user_response",
  QUESTION_ANSWERED: "question_answered",
  REJECTED_BY_SERVER: "rejected_by_server",
  RESCINDED_BY_DINER: "rescinded_by_diner",
  REJECTED_BY_KITCHEN: "rejected_by_kitchen",
});

export const STATUS_DESCRIPTORS = Object.freeze({
  [ORDER_STATUSES.CODE_ASSIGNED]: { label: "Waiting for diner", tone: "muted" },
  [ORDER_STATUSES.SUBMITTED_TO_SERVER]: { label: "Needs approval", tone: "warn" },
  [ORDER_STATUSES.QUEUED_FOR_KITCHEN]: { label: "Ready to dispatch", tone: "info" },
  [ORDER_STATUSES.REJECTED_BY_SERVER]: { label: "Rejected", tone: "danger" },
  [ORDER_STATUSES.WITH_KITCHEN]: { label: "Sent to kitchen", tone: "success" },
  [ORDER_STATUSES.ACKNOWLEDGED]: { label: "Acknowledged", tone: "success" },
  [ORDER_STATUSES.AWAITING_USER_RESPONSE]: {
    label: "Awaiting diner response",
    tone: "warn",
  },
  [ORDER_STATUSES.QUESTION_ANSWERED]: { label: "Diner responded", tone: "success" },
  [ORDER_STATUSES.RESCINDED_BY_DINER]: { label: "Rescinded by diner", tone: "muted" },
  [ORDER_STATUSES.REJECTED_BY_KITCHEN]: { label: "Rejected by kitchen", tone: "danger" },
});

export const COMPLETED_STATUSES = new Set([
  ORDER_STATUSES.WITH_KITCHEN,
  ORDER_STATUSES.ACKNOWLEDGED,
  ORDER_STATUSES.AWAITING_USER_RESPONSE,
  ORDER_STATUSES.QUESTION_ANSWERED,
  ORDER_STATUSES.REJECTED_BY_SERVER,
  ORDER_STATUSES.RESCINDED_BY_DINER,
  ORDER_STATUSES.REJECTED_BY_KITCHEN,
]);

const RELEVANT_SERVER_STATUSES = new Set([
  ORDER_STATUSES.SUBMITTED_TO_SERVER,
  ORDER_STATUSES.QUEUED_FOR_KITCHEN,
  ORDER_STATUSES.REJECTED_BY_SERVER,
  ORDER_STATUSES.RESCINDED_BY_DINER,
  ORDER_STATUSES.WITH_KITCHEN,
  ORDER_STATUSES.ACKNOWLEDGED,
  ORDER_STATUSES.AWAITING_USER_RESPONSE,
  ORDER_STATUSES.QUESTION_ANSWERED,
  ORDER_STATUSES.REJECTED_BY_KITCHEN,
]);

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  return value && typeof value === "object" ? value : {};
}

export function deserializeTabletOrder(row) {
  if (!row) return null;
  const payload = ensureObject(row.payload);
  return {
    ...payload,
    id: row.id || payload.id,
    status: row.status || payload.status || ORDER_STATUSES.CODE_ASSIGNED,
    restaurantId: row.restaurant_id || payload.restaurantId || null,
    createdAt: row.created_at || payload.createdAt || null,
    updatedAt: row.updated_at || payload.updatedAt || null,
    rejectedAt: row.rejected_at || payload.rejectedAt || null,
    history: ensureArray(payload.history),
    items: ensureArray(payload.items),
    allergies: ensureArray(payload.allergies),
    diets: ensureArray(payload.diets),
  };
}

export function parseServerId(code) {
  const value = String(code || "");
  return value.slice(0, 4) || "0000";
}

export function getFirstName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "Guest";
  return raw.split(/\s+/)[0];
}

export function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function getOrderTimestamps(order) {
  const history = ensureArray(order?.history);
  const submittedEntry = history.find((entry) => {
    const message = String(entry?.message || "");
    return message.includes("Submitted") || message.includes("submitted");
  });

  const submittedTime = submittedEntry?.at || order?.updatedAt || order?.createdAt;
  const updates = history
    .filter((entry) => entry?.at && entry.at !== submittedTime)
    .map((entry) => ({
      actor: entry?.actor || "System",
      message: entry?.message || "Status update",
      at: entry.at,
    }));

  return { submittedTime, updates };
}

export function resolveStatusDescriptor(status) {
  return STATUS_DESCRIPTORS[status] || { label: status || "Unknown", tone: "muted" };
}

export function shouldShowOrder(order, { showCompleted, hiddenRejectedSet }) {
  if (!order) return false;
  if (!showCompleted && COMPLETED_STATUSES.has(order.status)) return false;
  if (
    order.status === ORDER_STATUSES.REJECTED_BY_SERVER &&
    hiddenRejectedSet?.has(order.id)
  ) {
    return false;
  }
  return true;
}

export function groupOrdersByServer(orders, options) {
  const groups = new Map();
  for (const order of ensureArray(orders)) {
    if (!order?.serverCode || !RELEVANT_SERVER_STATUSES.has(order.status)) continue;
    if (!shouldShowOrder(order, options)) continue;

    const serverId = order.serverId || parseServerId(order.serverCode);
    if (!groups.has(serverId)) groups.set(serverId, []);
    groups.get(serverId).push(order);
  }
  return groups;
}

function pushHistory(order, actor, message) {
  const nextHistory = ensureArray(order.history);
  nextHistory.push({
    at: new Date().toISOString(),
    actor,
    message,
  });
  order.history = nextHistory;
}

export function applyServerApprove(order) {
  if (order.status !== ORDER_STATUSES.SUBMITTED_TO_SERVER) {
    throw new Error("Order is not waiting for server approval.");
  }
  order.status = ORDER_STATUSES.QUEUED_FOR_KITCHEN;
  pushHistory(order, "Server", "Marked ready for kitchen timing.");
  order.updatedAt = new Date().toISOString();
  return order;
}

export function applyServerDispatch(order) {
  if (order.status !== ORDER_STATUSES.QUEUED_FOR_KITCHEN) {
    throw new Error("Order cannot be dispatched from its current status.");
  }
  order.status = ORDER_STATUSES.WITH_KITCHEN;
  pushHistory(order, "Server", "Dispatched to kitchen tablet.");
  order.updatedAt = new Date().toISOString();
  return order;
}

export function applyServerReject(order, reason) {
  if (
    ![
      ORDER_STATUSES.SUBMITTED_TO_SERVER,
      ORDER_STATUSES.QUEUED_FOR_KITCHEN,
    ].includes(order.status)
  ) {
    throw new Error("Only pending server orders can be rejected.");
  }

  const note = String(reason || "").trim() || "Rejected the notice.";
  order.status = ORDER_STATUSES.REJECTED_BY_SERVER;
  pushHistory(order, "Server", note.startsWith("Rejected") ? note : `Rejected: ${note}`);
  order.updatedAt = new Date().toISOString();
  order.rejectedAt = order.updatedAt;
  return order;
}
