const STORAGE_KEY = 'clarivore:tablet-state-v1';
const CHANNEL_NAME = 'clarivore-tablet-state';

const sourceId = crypto.randomUUID();
const listeners = new Set();
const channel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel(CHANNEL_NAME)
  : null;

let lastPersistedPayload = null;

function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const orders = Array.isArray(raw.orders) ? raw.orders : [];
  const chefs = Array.isArray(raw.chefs) ? raw.chefs : [];
  const lastServerCode = raw.lastServerCode ?? null;
  const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now();
  return {
    orders: JSON.parse(JSON.stringify(orders)),
    chefs: JSON.parse(JSON.stringify(chefs)),
    lastServerCode,
    updatedAt
  };
}

function notifyListeners(payload, origin) {
  if (!payload) return;
  lastPersistedPayload = payload;
  listeners.forEach((handler) => {
    try {
      handler(payload, origin);
    } catch (err) {
      console.error('[tablet-sync] listener error', err);
    }
  });
}

export function getPersistedTabletState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return sanitizeState(parsed);
  } catch (error) {
    console.warn('[tablet-sync] failed to read persisted state', error);
    return null;
  }
}

export function persistTabletState(state) {
  const payload = sanitizeState({
    ...state,
    updatedAt: Date.now()
  });
  if (!payload) return null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error('[tablet-sync] failed to persist state', error);
  }
  if (channel) {
    try {
      channel.postMessage({ sourceId, payload });
    } catch (error) {
      console.error('[tablet-sync] broadcast failed', error);
    }
  }
  lastPersistedPayload = payload;
  return payload;
}

export function subscribeToTabletState(handler) {
  if (typeof handler !== 'function') {
    return () => {};
  }
  listeners.add(handler);
  if (lastPersistedPayload) {
    // Microtask to avoid synchronous mutation during subscription
    Promise.resolve().then(() => handler(lastPersistedPayload, 'initial'));
  }
  return () => listeners.delete(handler);
}

if (channel) {
  channel.addEventListener('message', (event) => {
    const { sourceId: originId, payload } = event.data || {};
    if (!payload || originId === sourceId) return;
    const sanitized = sanitizeState(payload);
    if (!sanitized) return;
    notifyListeners(sanitized, 'channel');
  });
}

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    const parsed = JSON.parse(event.newValue);
    const sanitized = sanitizeState(parsed);
    if (!sanitized) return;
    notifyListeners(sanitized, 'storage');
  } catch (error) {
    console.warn('[tablet-sync] failed to process storage event', error);
  }
});


