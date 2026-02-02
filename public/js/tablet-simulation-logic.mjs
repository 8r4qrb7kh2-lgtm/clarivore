/**
 * Pure state management helpers for the allergy acknowledgement tablet simulation.
 * These functions intentionally avoid touching the DOM so that they can be unit tested
 * both in the browser and in Node-based smoke tests.
 */

export const ORDER_STATUSES = Object.freeze({
  DRAFT: 'draft',
  CODE_ASSIGNED: 'awaiting_user_submission',
  SUBMITTED_TO_SERVER: 'awaiting_server_approval',
  QUEUED_FOR_KITCHEN: 'queued_for_kitchen',
  WITH_KITCHEN: 'with_kitchen',
  ACKNOWLEDGED: 'acknowledged',
  AWAITING_USER_RESPONSE: 'awaiting_user_response',
  QUESTION_ANSWERED: 'question_answered',
  REJECTED_BY_SERVER: 'rejected_by_server',
  RESCINDED_BY_DINER: 'rescinded_by_diner',
  REJECTED_BY_KITCHEN: 'rejected_by_kitchen'
});

export const DINING_MODES = Object.freeze({
  DINE_IN: 'dine-in',
  DELIVERY: 'delivery'
});

const resolveDefaultAllergens = (config) => {
  if (!config || !Array.isArray(config.ALLERGENS)) return [];
  const labels =
    config.ALLERGEN_LABELS && typeof config.ALLERGEN_LABELS === 'object'
      ? config.ALLERGEN_LABELS
      : {};
  return config.ALLERGENS.map((key) => labels[key] || key);
};

export const DEFAULT_ALLERGENS = resolveDefaultAllergens(
  typeof window !== 'undefined' ? window.ALLERGEN_DIET_CONFIG : null
);

const DEFAULT_CHEFS = [
  { id: 'chef-laila', name: 'Chef Laila Hassan', faceIdTag: 'FACE-LH-2031', role: 'Sous Chef' },
  { id: 'chef-masako', name: 'Chef Masako Ito', faceIdTag: 'FACE-MI-1178', role: 'Expeditor' },
  { id: 'chef-diego', name: 'Chef Diego Alvarez', faceIdTag: 'FACE-DA-8823', role: 'Executive Chef' }
];

export function createInitialState(overrides = {}) {
  return {
    orders: [],
    chefs: overrides.chefs ?? structuredClone(DEFAULT_CHEFS),
    lastServerCode: null
  };
}

function structuredClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function createOrderDraft(formData) {
  if (!formData.customerName?.trim()) {
    throw new Error('Customer name is required to draft an order.');
  }
  if (!formData.restaurantName?.trim()) {
    throw new Error('Restaurant name is required.');
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    customerName: formData.customerName.trim(),
    restaurantName: formData.restaurantName.trim(),
    diningMode: formData.diningMode ?? DINING_MODES.DINE_IN,
    tableOrPickup: formData.tableOrPickup?.trim() ?? '',
    deliveryAddress: formData.deliveryAddress?.trim() ?? '',
    allergies: Array.isArray(formData.allergies) ? [...new Set(formData.allergies)] : [],
    customNotes: formData.customNotes?.trim() ?? '',
    status: ORDER_STATUSES.DRAFT,
    serverCode: null,
    kitchenQuestion: null,
    faceIdAudit: [],
    history: []
  };
}

export function requestServerCode(state, orderDraft, opts = {}) {
  const order = structuredClone(orderDraft);
  if (order.status !== ORDER_STATUSES.DRAFT) {
    throw new Error('Can only request a server code for a draft order.');
  }

  const code = opts.code ?? generateServerCode(state.lastServerCode);
  state.lastServerCode = code;

  order.serverCode = code;
  order.status = ORDER_STATUSES.CODE_ASSIGNED;
  pushHistory(order, 'Server tablet', `Generated submission code ${code}`);

  state.orders.push(order);
  return order;
}

function generateServerCode(previousCode) {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (code === previousCode);
  return code;
}

export function submitOrderToServer(state, orderId, providedCode) {
  const order = requireOrder(state, orderId);
  if (order.status !== ORDER_STATUSES.CODE_ASSIGNED) {
    throw new Error('Order is not accepting submissions right now.');
  }
  if (String(providedCode).trim() !== order.serverCode) {
    throw new Error('Server code does not match.');
  }
  order.status = ORDER_STATUSES.SUBMITTED_TO_SERVER;
  pushHistory(order, 'Diner', 'Submitted allergies to server station tablet.');
  order.updatedAt = new Date().toISOString();
  return order;
}

export function serverApprove(state, orderId) {
  const order = requireOrder(state, orderId);
  if (order.status !== ORDER_STATUSES.SUBMITTED_TO_SERVER) {
    throw new Error('Order is not waiting for server approval.');
  }
  order.status = ORDER_STATUSES.QUEUED_FOR_KITCHEN;
  pushHistory(order, 'Server', 'Marked ready for kitchen timing.');
  order.updatedAt = new Date().toISOString();
  return order;
}

export function serverDispatchToKitchen(state, orderId) {
  const order = requireOrder(state, orderId);
  if (order.status !== ORDER_STATUSES.QUEUED_FOR_KITCHEN) {
    throw new Error('Order cannot be dispatched from its current status.');
  }
  order.status = ORDER_STATUSES.WITH_KITCHEN;
  pushHistory(order, 'Server', 'Dispatched to kitchen tablet.');
  order.updatedAt = new Date().toISOString();
  return order;
}

export function serverReject(state, orderId, reason) {
  const order = requireOrder(state, orderId);
  if (![ORDER_STATUSES.SUBMITTED_TO_SERVER, ORDER_STATUSES.QUEUED_FOR_KITCHEN].includes(order.status)) {
    throw new Error('Only pending server orders can be rejected.');
  }
  order.status = ORDER_STATUSES.REJECTED_BY_SERVER;
  pushHistory(order, 'Server', reason?.trim() ? `Rejected: ${reason.trim()}` : 'Rejected the notice.');
  order.updatedAt = new Date().toISOString();
  order.rejectedAt = order.updatedAt;
  return order;
}

export function kitchenAcknowledge(state, orderId, chefId) {
  const order = requireOrder(state, orderId);
  if (![ORDER_STATUSES.WITH_KITCHEN, ORDER_STATUSES.QUESTION_ANSWERED].includes(order.status)) {
    throw new Error('Kitchen can only acknowledge orders currently on deck.');
  }
  const chef = state.chefs.find(c => c.id === chefId);
  if (!chef) {
    throw new Error('Selected chef is not FaceID enrolled.');
  }
  order.status = ORDER_STATUSES.ACKNOWLEDGED;
  const timestamp = new Date().toISOString();
  order.faceIdAudit.push({
    chefId: chef.id,
    chefName: chef.name,
    faceIdTag: chef.faceIdTag,
    at: timestamp
  });
  pushHistory(order, 'Kitchen', `Chef ${chef.name} acknowledged allergies with FaceID scan.`);
  order.updatedAt = timestamp;
  return order;
}

export function kitchenAskQuestion(state, orderId, questionText) {
  const order = requireOrder(state, orderId);
  if (![ORDER_STATUSES.WITH_KITCHEN, ORDER_STATUSES.ACKNOWLEDGED, ORDER_STATUSES.QUESTION_ANSWERED].includes(order.status)) {
    throw new Error('Kitchen can only send questions for active orders.');
  }
  if (!questionText?.trim()) {
    throw new Error('Question text is required.');
  }
  order.kitchenQuestion = {
    text: questionText.trim(),
    response: null,
    askedAt: new Date().toISOString()
  };
  order.status = ORDER_STATUSES.AWAITING_USER_RESPONSE;
  pushHistory(order, 'Kitchen', `Sent a yes/no question: "${order.kitchenQuestion.text}"`);
  order.updatedAt = new Date().toISOString();
  return order;
}

export function kitchenReject(state, orderId, reason) {
  const order = requireOrder(state, orderId);
  if (![ORDER_STATUSES.WITH_KITCHEN, ORDER_STATUSES.ACKNOWLEDGED, ORDER_STATUSES.AWAITING_USER_RESPONSE, ORDER_STATUSES.QUESTION_ANSWERED].includes(order.status)) {
    throw new Error('Kitchen can only reject active orders.');
  }
  order.status = ORDER_STATUSES.REJECTED_BY_KITCHEN;
  const message = reason?.trim()
    ? `Rejected by kitchen: ${reason.trim()}`
    : 'Rejected by kitchen.';
  pushHistory(order, 'Kitchen', message);
  order.updatedAt = new Date().toISOString();
  order.rejectedAt = order.updatedAt;
  return order;
}

export function userRespondToQuestion(state, orderId, yesNo) {
  const order = requireOrder(state, orderId);
  if (order.status !== ORDER_STATUSES.AWAITING_USER_RESPONSE || !order.kitchenQuestion) {
    throw new Error('No kitchen question awaiting a response.');
  }
  if (!['yes', 'no'].includes(yesNo)) {
    throw new Error('Response must be "yes" or "no".');
  }
  order.kitchenQuestion.response = yesNo;
  order.kitchenQuestion.respondedAt = new Date().toISOString();
  order.status = ORDER_STATUSES.QUESTION_ANSWERED;
  pushHistory(order, 'Diner', `Responded "${yesNo.toUpperCase()}" to kitchen follow-up.`);
  order.updatedAt = new Date().toISOString();
  return order;
}

export function getOrdersByStatus(state, statuses) {
  const statusList = Array.isArray(statuses) ? statuses : [statuses];
  return state.orders.filter(order => statusList.includes(order.status));
}

export function requireOrder(state, orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) {
    throw new Error('Order not found.');
  }
  return order;
}

function pushHistory(order, actor, message) {
  order.history.push({
    at: new Date().toISOString(),
    actor,
    message
  });
}

export function canServerApprove(order) {
  return order.status === ORDER_STATUSES.SUBMITTED_TO_SERVER;
}

export function canServerDispatch(order) {
  return order.status === ORDER_STATUSES.QUEUED_FOR_KITCHEN;
}

export function canKitchenAcknowledge(order) {
  return order.status === ORDER_STATUSES.WITH_KITCHEN;
}

export function canKitchenAskQuestion(order) {
  return [ORDER_STATUSES.WITH_KITCHEN, ORDER_STATUSES.ACKNOWLEDGED].includes(order.status);
}

export function canUserRespond(order) {
  return order.status === ORDER_STATUSES.AWAITING_USER_RESPONSE && Boolean(order.kitchenQuestion);
}
