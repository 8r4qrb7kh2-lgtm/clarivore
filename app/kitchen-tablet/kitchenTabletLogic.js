import {
  ORDER_STATUSES,
  formatTimestamp,
  getFirstName,
  getOrderTimestamps,
  resolveStatusDescriptor,
  deserializeTabletOrder,
} from "../server-tablet/serverTabletLogic";

export {
  ORDER_STATUSES,
  formatTimestamp,
  getFirstName,
  getOrderTimestamps,
  resolveStatusDescriptor,
  deserializeTabletOrder,
};

export const KITCHEN_STATUS_DESCRIPTORS = Object.freeze({
  [ORDER_STATUSES.WITH_KITCHEN]: {
    label: "Awaiting acknowledgement",
    tone: "warn",
  },
  [ORDER_STATUSES.ACKNOWLEDGED]: { label: "Acknowledged", tone: "success" },
  [ORDER_STATUSES.AWAITING_USER_RESPONSE]: {
    label: "Waiting on diner",
    tone: "warn",
  },
  [ORDER_STATUSES.QUESTION_ANSWERED]: {
    label: "Awaiting acknowledgement",
    tone: "warn",
  },
  [ORDER_STATUSES.RESCINDED_BY_DINER]: {
    label: "Rescinded by diner",
    tone: "muted",
  },
  [ORDER_STATUSES.REJECTED_BY_KITCHEN]: {
    label: "Rejected by kitchen",
    tone: "danger",
  },
});

export const KITCHEN_RELEVANT_STATUSES = new Set([
  ORDER_STATUSES.WITH_KITCHEN,
  ORDER_STATUSES.ACKNOWLEDGED,
  ORDER_STATUSES.AWAITING_USER_RESPONSE,
  ORDER_STATUSES.QUESTION_ANSWERED,
  ORDER_STATUSES.RESCINDED_BY_DINER,
  ORDER_STATUSES.REJECTED_BY_KITCHEN,
]);

export const KITCHEN_COMPLETED_STATUSES = new Set([
  ORDER_STATUSES.ACKNOWLEDGED,
  ORDER_STATUSES.RESCINDED_BY_DINER,
  ORDER_STATUSES.REJECTED_BY_KITCHEN,
]);

const DEFAULT_ACK_ACTOR = {
  chefId: "kitchen-default",
  chefName: "Kitchen team",
  role: "Kitchen",
};

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function pushHistory(order, actor, message) {
  const history = ensureArray(order.history);
  history.push({
    at: new Date().toISOString(),
    actor,
    message,
  });
  order.history = history;
}

export function canRenderKitchenOrder(order, showCompleted) {
  if (!order || !KITCHEN_RELEVANT_STATUSES.has(order.status)) return false;
  if (!showCompleted && KITCHEN_COMPLETED_STATUSES.has(order.status)) return false;
  return true;
}

export function kitchenAcknowledgeOrder(order, actor = DEFAULT_ACK_ACTOR) {
  if (
    ![ORDER_STATUSES.WITH_KITCHEN, ORDER_STATUSES.QUESTION_ANSWERED].includes(
      order.status,
    )
  ) {
    throw new Error("Kitchen can only acknowledge active orders.");
  }

  const at = new Date().toISOString();
  const audit = ensureArray(order.faceIdAudit);
  audit.push({
    chefId: actor.chefId,
    chefName: actor.chefName,
    role: actor.role,
    at,
  });
  order.faceIdAudit = audit;
  order.status = ORDER_STATUSES.ACKNOWLEDGED;
  order.updatedAt = at;
  pushHistory(order, "Kitchen", `${actor.chefName} acknowledged the notice.`);
  return order;
}

export function kitchenAskQuestionOrder(order, text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    throw new Error("Question text is required.");
  }

  if (
    ![
      ORDER_STATUSES.WITH_KITCHEN,
      ORDER_STATUSES.ACKNOWLEDGED,
      ORDER_STATUSES.QUESTION_ANSWERED,
    ].includes(order.status)
  ) {
    throw new Error("Kitchen can only send questions for active orders.");
  }

  order.kitchenQuestion = {
    text: normalized,
    response: null,
    askedAt: new Date().toISOString(),
  };
  order.status = ORDER_STATUSES.AWAITING_USER_RESPONSE;
  order.updatedAt = new Date().toISOString();
  pushHistory(order, "Kitchen", `Sent a yes/no question: "${normalized}"`);
  return order;
}

export function kitchenRejectOrder(order, reason) {
  if (
    ![
      ORDER_STATUSES.WITH_KITCHEN,
      ORDER_STATUSES.ACKNOWLEDGED,
      ORDER_STATUSES.AWAITING_USER_RESPONSE,
      ORDER_STATUSES.QUESTION_ANSWERED,
    ].includes(order.status)
  ) {
    throw new Error("Kitchen can only reject active orders.");
  }

  const note = String(reason || "").trim();
  order.status = ORDER_STATUSES.REJECTED_BY_KITCHEN;
  order.updatedAt = new Date().toISOString();
  order.rejectedAt = order.updatedAt;
  pushHistory(
    order,
    "Kitchen",
    note ? `Rejected by kitchen: ${note}` : "Rejected by kitchen.",
  );
  return order;
}
