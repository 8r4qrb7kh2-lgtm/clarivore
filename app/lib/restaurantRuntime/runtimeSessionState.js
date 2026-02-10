const fallbackSessionState = {
  orderItems: [],
  orderItemSelections: new Set(),
  lovedDishesSet: new Set(),
  supabaseClient: null,
  __openOrderConfirmDrawer: null,
};

function getSessionRoot() {
  if (typeof window !== "undefined") return window;
  return fallbackSessionState;
}

export function getOrderItems() {
  const root = getSessionRoot();
  if (!Array.isArray(root.orderItems)) {
    root.orderItems = [];
  }
  return root.orderItems;
}

export function setOrderItems(items) {
  const root = getSessionRoot();
  root.orderItems = Array.isArray(items) ? items : [];
  return root.orderItems;
}

export function getOrderItemSelections() {
  const root = getSessionRoot();
  if (!(root.orderItemSelections instanceof Set)) {
    root.orderItemSelections = new Set();
  }
  return root.orderItemSelections;
}

export function getLovedDishesSet() {
  const root = getSessionRoot();
  if (!(root.lovedDishesSet instanceof Set)) {
    root.lovedDishesSet = new Set();
  }
  return root.lovedDishesSet;
}

export function setLovedDishesSet(value) {
  const root = getSessionRoot();
  root.lovedDishesSet = value instanceof Set ? value : new Set();
  return root.lovedDishesSet;
}

export function getSupabaseClient() {
  const root = getSessionRoot();
  return root.supabaseClient || null;
}

export function setSupabaseClient(client) {
  const root = getSessionRoot();
  root.supabaseClient = client || null;
  return root.supabaseClient;
}

export function setOpenOrderConfirmDrawer(fn) {
  const root = getSessionRoot();
  root.__openOrderConfirmDrawer = typeof fn === "function" ? fn : null;
  return root.__openOrderConfirmDrawer;
}
