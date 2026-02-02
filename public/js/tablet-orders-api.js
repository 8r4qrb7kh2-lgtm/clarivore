import supabaseClient from './supabase-client.js';

const MISSING_TABLE_ERROR_CODES = new Set(['PGRST205', 'PGRST117', '42P01']);
let bootstrapPromise = null;

function ensureSupabase() {
  if (!supabaseClient) {
    throw new Error('Supabase client not available');
  }
  return supabaseClient;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function isMissingTableError(error) {
  if (!error) return false;
  const code = (error.code || '').toString().toUpperCase();
  if (MISSING_TABLE_ERROR_CODES.has(code)) return true;
  const msg = (error.message || '').toString().toLowerCase();
  return msg.includes('does not exist') || msg.includes('schema cache');
}

function getSupabaseUrl(client) {
  const candidate =
    client?.rest?.url ||
    globalThis.SUPABASE_URL ||
    globalThis.SUPABASE_PROJECT_URL ||
    '';
  // Remove /rest/v1 suffix if present (from client.rest.url)
  const url = typeof candidate === 'string' ? candidate.replace(/\/$/, '') : '';
  return url.replace(/\/rest\/v1$/, '');
}

function getAnonKey() {
  return (
    (typeof globalThis.SUPABASE_ANON_KEY === 'string' && globalThis.SUPABASE_ANON_KEY) ||
    (typeof globalThis.SUPABASE_KEY === 'string' && globalThis.SUPABASE_KEY) ||
    ''
  );
}

async function bootstrapTabletOrders(client) {
  if (!client) return false;
  if (bootstrapPromise) return bootstrapPromise;

  const supabaseUrl = getSupabaseUrl(client);
  const anonKey = getAnonKey();
  if (!supabaseUrl || !anonKey) {
    console.warn('[tablet-orders-api] Missing Supabase URL or anon key; skipping bootstrap.');
    return false;
  }

  const endpoint = `${supabaseUrl}/functions/v1/tablet-orders-bootstrap`;
  bootstrapPromise = fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey
    },
    body: JSON.stringify({ ensure: true })
  })
    .then(async (response) => {
      if (!response.ok) {
        const text = await response.text();
        if (response.status === 404) {
          throw new Error('Tablet orders bootstrap function not deployed. Run `supabase functions deploy tablet-orders-bootstrap` to enable it.');
        }
        throw new Error(`Bootstrap failed (${response.status}): ${text}`);
      }
      return true;
    })
    .catch((error) => {
      console.error('[tablet-orders-api] Bootstrap request failed', error);
      throw error;
    });

  try {
    return await bootstrapPromise;
  } catch (error) {
    bootstrapPromise = null;
    throw error;
  }
}

export async function ensureTabletOrdersReady() {
  const client = ensureSupabase();
  return bootstrapTabletOrders(client);
}

function resetBootstrapCache() {
  bootstrapPromise = null;
}

export function deserializeTabletOrder(row) {
  if (!row) return null;
  const payload = normalizeObject(row.payload);
  const order = {
    ...payload,
    id: row.id || payload.id,
    status: row.status || payload.status || 'awaiting_user_submission',
    restaurantId: row.restaurant_id || payload.restaurantId || null,
    createdAt: row.created_at || payload.createdAt || null,
    updatedAt: row.updated_at || payload.updatedAt || null
  };
  order.history = normalizeArray(order.history);
  order.items = normalizeArray(order.items);
  order.allergies = normalizeArray(order.allergies);
  order.diets = normalizeArray(order.diets);
  order.kitchenMessages = normalizeArray(order.kitchenMessages);
  order.faceIdAudit = normalizeArray(order.faceIdAudit);
  return order;
}

function serializeTabletOrder(order, restaurantId) {
  if (!order?.id) {
    throw new Error('Tablet order must have an id before saving.');
  }
  const payload = {
    ...order,
    restaurantId: restaurantId ?? order.restaurantId ?? null,
    updatedAt: new Date().toISOString()
  };
  if (!payload.restaurantId) {
    throw new Error('Tablet order requires a restaurantId.');
  }
  return {
    id: payload.id,
    restaurant_id: payload.restaurantId,
    status: payload.status || 'awaiting_user_submission',
    payload: payload
  };
}

export async function fetchTabletOrders(restaurantIds = [], options = {}) {
  const client = ensureSupabase();
  await bootstrapTabletOrders(client);

  let attempt = 0;
  while (attempt < 2) {
    let query = client
      .from('tablet_orders')
      .select('*')
      .order('created_at', { ascending: options.ascending ?? true });
    if (Array.isArray(restaurantIds) && restaurantIds.length > 0) {
      query = query.in('restaurant_id', restaurantIds);
    }
    const { data, error } = await query;
    if (!error) {
      return (data || []).map(deserializeTabletOrder);
    }
    if (isMissingTableError(error) && attempt === 0) {
      resetBootstrapCache();
      await bootstrapTabletOrders(client);
      attempt += 1;
      continue;
    }
    throw error;
  }

  return [];
}

export async function saveTabletOrder(order, { restaurantId } = {}) {
  const client = ensureSupabase();
  await bootstrapTabletOrders(client);

  let attempt = 0;
  const payload = serializeTabletOrder(order, restaurantId);

  while (attempt < 2) {
    const { error } = await client.from('tablet_orders').upsert(payload, { onConflict: 'id' });
    if (!error) {
      return payload;
    }
    if (isMissingTableError(error) && attempt === 0) {
      resetBootstrapCache();
      await bootstrapTabletOrders(client);
      attempt += 1;
      continue;
    }
    throw error;
  }

  return payload;
}

export async function deleteTabletOrder(orderId) {
  if (!orderId) return;
  const client = ensureSupabase();
  await bootstrapTabletOrders(client);

  let attempt = 0;
  while (attempt < 2) {
    const { error } = await client.from('tablet_orders').delete().eq('id', orderId);
    if (!error) {
      return;
    }
    if (isMissingTableError(error) && attempt === 0) {
      resetBootstrapCache();
      await bootstrapTabletOrders(client);
      attempt += 1;
      continue;
    }
    throw error;
  }
}

export async function subscribeToTabletOrderChanges(callback) {
  const client = ensureSupabase();
  try {
    await bootstrapTabletOrders(client);
  } catch (error) {
    console.error('[tablet-orders-api] Realtime subscription skipped; bootstrap failed.', error);
    return () => {};
  }

  const channel = client
    .channel('tablet-orders-broadcast')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tablet_orders' },
      (payload) => {
        if (typeof callback === 'function') {
          callback({
            eventType: payload.eventType,
            order:
              payload.eventType === 'DELETE'
                ? deserializeTabletOrder(payload.old)
                : deserializeTabletOrder(payload.new)
          });
        }
      }
    )
    .subscribe();

  return () => {
    if (channel) {
      client.removeChannel(channel);
    }
  };
}

