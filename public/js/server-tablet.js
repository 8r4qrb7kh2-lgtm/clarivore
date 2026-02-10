import supabaseClient from './supabase-client.js';
import { setupTopbar } from './shared-nav.js';
import { fetchManagerRestaurants } from './manager-context.js';
import {
  fetchTabletOrders,
  saveTabletOrder,
  subscribeToTabletOrderChanges
} from './tablet-orders-api.js';
import { notifyDinerNotice } from './notice-notifications.js';
import {
  serverApprove,
  serverDispatchToKitchen,
  serverReject,
  ORDER_STATUSES
} from './tablet-simulation-logic.mjs';
import { showOrderNotification } from './order-notifications.js';

const OWNER_EMAIL = 'matt.29.ds@gmail.com';

const statusContainer = document.getElementById('server-status');
const queueContainer = document.getElementById('server-queue');
const tabsContainer = document.getElementById('server-tabs');
const refreshBtn = document.getElementById('refresh-btn');
const completedToggle = document.getElementById('server-show-completed');

const STATUS_DESCRIPTORS = {
  [ORDER_STATUSES.CODE_ASSIGNED]: { label: 'Waiting for diner', tone: 'muted' },
  [ORDER_STATUSES.SUBMITTED_TO_SERVER]: { label: 'Needs approval', tone: 'warn' },
  [ORDER_STATUSES.QUEUED_FOR_KITCHEN]: { label: 'Ready to dispatch', tone: 'info' },
  [ORDER_STATUSES.REJECTED_BY_SERVER]: { label: 'Rejected', tone: 'danger' },
  [ORDER_STATUSES.WITH_KITCHEN]: { label: 'Sent to kitchen', tone: 'success' },
  [ORDER_STATUSES.ACKNOWLEDGED]: { label: 'Acknowledged', tone: 'success' },
  [ORDER_STATUSES.AWAITING_USER_RESPONSE]: { label: 'Awaiting diner response', tone: 'warn' },
  [ORDER_STATUSES.QUESTION_ANSWERED]: { label: 'Diner responded', tone: 'success' },
  [ORDER_STATUSES.RESCINDED_BY_DINER]: { label: 'Rescinded by diner', tone: 'muted' },
  [ORDER_STATUSES.REJECTED_BY_KITCHEN]: { label: 'Rejected by kitchen', tone: 'danger' }
};

const tabletState = {
  orders: []
};

const REJECTION_REMOVAL_DELAY_MS = 5000;
const AUTO_REFRESH_INTERVAL_MS = 15000;
const rejectedRemovalTimers = new Map();
const hiddenRejectedOrders = new Set();

const completedStatuses = new Set([
  ORDER_STATUSES.WITH_KITCHEN,
  ORDER_STATUSES.ACKNOWLEDGED,
  ORDER_STATUSES.AWAITING_USER_RESPONSE,
  ORDER_STATUSES.QUESTION_ANSWERED,
  ORDER_STATUSES.REJECTED_BY_SERVER,
  ORDER_STATUSES.RESCINDED_BY_DINER,
  ORDER_STATUSES.REJECTED_BY_KITCHEN
]);

let activeServerId = null;
let managedRestaurantIds = [];
let isOwner = false;
let unsubscribeRealtime = null;
const previousOrderStatuses = new Map();
let autoRefreshTimerId = null;
let activeRefreshPromise = null;
let showCompleted = false;

if (completedToggle) {
  completedToggle.checked = false;
  completedToggle.addEventListener('change', () => {
    showCompleted = completedToggle.checked;
    renderServerQueue();
  });
}

function ensureActiveServerId() {
  const groups = groupOrdersByServer();
  if (groups.size === 0) {
    activeServerId = null;
    return;
  }
  if (!activeServerId || !groups.has(activeServerId)) {
    activeServerId = Array.from(groups.keys())[0];
  }
}

function groupOrdersByServer() {
  const relevantStatuses = new Set([
    ORDER_STATUSES.SUBMITTED_TO_SERVER,
    ORDER_STATUSES.QUEUED_FOR_KITCHEN,
    ORDER_STATUSES.REJECTED_BY_SERVER,
    ORDER_STATUSES.RESCINDED_BY_DINER,
    ORDER_STATUSES.WITH_KITCHEN,
    ORDER_STATUSES.ACKNOWLEDGED,
    ORDER_STATUSES.AWAITING_USER_RESPONSE,
    ORDER_STATUSES.QUESTION_ANSWERED,
    ORDER_STATUSES.REJECTED_BY_KITCHEN
  ]);
  const map = new Map();
  for (const order of tabletState.orders) {
    if (!order?.serverCode || !relevantStatuses.has(order.status)) continue;
    if (!shouldShowOrder(order)) continue;
    const serverId = order.serverId || parseServerId(order.serverCode);
    if (!map.has(serverId)) {
      map.set(serverId, []);
    }
    map.get(serverId).push(order);
  }
  return map;
}

function parseServerId(code) {
  const value = String(code || '');
  return value.slice(0, 4) || '0000';
}

function formatStatusBadge(order) {
  const descriptor = STATUS_DESCRIPTORS[order.status] || { label: order.status, tone: 'muted' };
  return `<span class="status-badge" data-tone="${descriptor.tone}">${descriptor.label}</span>`;
}

function getFirstName(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'Guest';
  return raw.split(/\s+/)[0];
}

function formatTimestamp(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getOrderTimestamps(order) {
  const history = Array.isArray(order.history) ? order.history : [];
  const submittedEntry = history.find(e => e.message && (e.message.includes('Submitted') || e.message.includes('submitted')));
  const submittedTime = submittedEntry?.at || order.updatedAt || order.createdAt;
  const updates = history.filter(e => e.at && e.at !== submittedTime).map(e => ({
    actor: e.actor || 'System',
    message: e.message || 'Status update',
    at: e.at
  }));
  return { submittedTime, updates };
}

function renderStatusSummary() {
  if (!statusContainer) return;
  const awaitingApproval = tabletState.orders.filter(
    (order) => order.status === ORDER_STATUSES.SUBMITTED_TO_SERVER && shouldShowOrder(order)
  ).length;
  const queuedForKitchen = tabletState.orders.filter(
    (order) => order.status === ORDER_STATUSES.QUEUED_FOR_KITCHEN && shouldShowOrder(order)
  ).length;

  const parts = [];
  parts.push(`<span class="tablet-status-badge">Awaiting approval: ${awaitingApproval}</span>`);
  parts.push(`<span class="tablet-status-badge">Ready to dispatch: ${queuedForKitchen}</span>`);
  statusContainer.innerHTML = parts.join('');
}

function renderServerTabs() {
  if (!tabsContainer) return;
  const groups = groupOrdersByServer();
  if (!groups.size) {
    tabsContainer.innerHTML = '';
    return;
  }
  const buttons = Array.from(groups.entries()).map(([serverId, orders]) => {
    const name = orders[0]?.serverName || `Server ${serverId}`;
    const isActive = serverId === activeServerId;
    return `<button type="button" class="server-tab${isActive ? ' is-active' : ''}" data-server-id="${serverId}">${name}</button>`;
  });
  tabsContainer.innerHTML = buttons.join('');
}

function renderServerQueue() {
  renderStatusSummary();
  renderServerTabs();
  if (!queueContainer) return;

  const groups = groupOrdersByServer();
  if (!groups.size) {
    queueContainer.innerHTML = `
      <div class="empty-tablet-state">
        Waiting for diners to submit codes. Notices will appear here once received.
      </div>
    `;
    return;
  }

  ensureActiveServerId();
  const orders = groups.get(activeServerId) || [];
  if (!orders.length) {
    queueContainer.innerHTML = `
      <div class="empty-tablet-state">
        No active notices for this server.
      </div>
    `;
    return;
  }

  const cards = orders
    .map((order) => {
      const tableLabel = order.tableNumber ? `Table ${order.tableNumber}` : 'Table —';
      const firstName = getFirstName(order.customerName);
      const dishes = Array.isArray(order.items) && order.items.length
        ? order.items.join(', ')
        : 'No dishes listed';
      const allergies = Array.isArray(order.allergies) && order.allergies.length
        ? order.allergies.join(', ')
        : 'None listed';
      const diets = Array.isArray(order.diets) && order.diets.length
        ? order.diets.join(', ')
        : 'None saved';

      let actions = '';
      if (order.status === ORDER_STATUSES.SUBMITTED_TO_SERVER) {
        actions = `
          <div class="server-order-actions">
            <button type="button" class="primary-btn" data-action="approve" data-order-id="${order.id}">Approve &amp; stage for kitchen</button>
            <button type="button" class="danger-btn" data-action="reject" data-order-id="${order.id}">Reject notice</button>
          </div>
        `;
      } else if (order.status === ORDER_STATUSES.QUEUED_FOR_KITCHEN) {
        actions = `
          <div class="server-order-actions">
            <button type="button" class="primary-btn" data-action="dispatch" data-order-id="${order.id}">Send to kitchen</button>
            <button type="button" class="danger-btn" data-action="reject" data-order-id="${order.id}">Reject notice</button>
          </div>
        `;
      }

      const { submittedTime, updates } = getOrderTimestamps(order);
      const submittedTimeStr = submittedTime ? formatTimestamp(submittedTime) : '';
      const updatesHtml = updates.length > 0 ? `
        <div class="server-order-timestamps">
          ${updates.map(u => `<div class="server-order-timestamp"><strong>${u.actor}:</strong> ${u.message} <span class="server-order-timestamp-time">${formatTimestamp(u.at)}</span></div>`).join('')}
        </div>
      ` : '';
      
      return `
        <article class="server-order-card" data-order-id="${order.id}">
          <div class="server-order-header">
            <div>
              <h2>${tableLabel} (${firstName})</h2>
              <div class="server-order-meta">Dishes: ${dishes}</div>
              ${submittedTimeStr ? `<div class="server-order-meta">Submitted: ${submittedTimeStr}</div>` : ''}
            </div>
            ${formatStatusBadge(order)}
          </div>
          <div class="server-order-meta">Allergies: ${allergies}</div>
          <div class="server-order-meta">Diets: ${diets}</div>
          ${order.customNotes ? `<div class="server-order-meta">Notes: ${order.customNotes}</div>` : ''}
          ${updatesHtml}
          ${actions}
        </article>
      `;
    })
    .join('');

  queueContainer.innerHTML = cards;
}

function findOrder(orderId) {
  return tabletState.orders.find((order) => order.id === orderId) || null;
}

async function refreshOrders() {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }
  activeRefreshPromise = (async () => {
    try {
      const orders = await fetchTabletOrders(isOwner || managedRestaurantIds.length === 0 ? [] : managedRestaurantIds);
      setOrders(orders);
    } catch (error) {
      console.error('[server-tablet] failed to load orders', error);
    } finally {
      activeRefreshPromise = null;
    }
  })();
  return activeRefreshPromise;
}

function setOrders(newOrders) {
  const orders = Array.isArray(newOrders) ? [...newOrders] : [];

  // Check for status changes and show notifications
  for (const order of orders) {
    const previousStatus = previousOrderStatuses.get(order.id);
    if (previousStatus && previousStatus !== order.status) {
      showOrderNotification(order.id, order.status, order.customerName);
    }
    previousOrderStatuses.set(order.id, order.status);
    handleRejectedOrderLifecycle(order, previousStatus);
  }

  tabletState.orders = orders;
  ensureActiveServerId();
  renderServerQueue();

  // Clean up timers for orders no longer present
  for (const orderId of Array.from(rejectedRemovalTimers.keys())) {
    if (!tabletState.orders.some((order) => order.id === orderId)) {
      clearRejectedRemoval(orderId);
    }
  }
}

async function startRealtime() {
  stopRealtime();
  try {
    unsubscribeRealtime = await subscribeToTabletOrderChanges(({ eventType, order }) => {
      if (!order) return;
      if (!isOwner && managedRestaurantIds.length && !managedRestaurantIds.includes(order.restaurantId)) {
        return;
      }
      const index = tabletState.orders.findIndex((o) => o.id === order.id);
      if (eventType === 'DELETE') {
        if (index !== -1) {
          tabletState.orders.splice(index, 1);
          previousOrderStatuses.delete(order.id);
        }
        clearRejectedRemoval(order.id);
        hiddenRejectedOrders.delete(order.id);
      } else {
        // Check for status change before updating
        const previousStatus = previousOrderStatuses.get(order.id);
        if (previousStatus && previousStatus !== order.status) {
          showOrderNotification(order.id, order.status, order.customerName);
        }
        previousOrderStatuses.set(order.id, order.status);
        handleRejectedOrderLifecycle(order, previousStatus);

        if (index === -1) {
          tabletState.orders.push(order);
        } else {
          tabletState.orders[index] = order;
        }
      }
      ensureActiveServerId();
      renderServerQueue();
    });
  } catch (error) {
    console.error('[server-tablet] failed to subscribe to realtime changes', error);
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimerId = setInterval(() => {
    refreshOrders().catch((error) => {
      console.error('[server-tablet] auto refresh failed', error);
    });
  }, AUTO_REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (autoRefreshTimerId) {
    clearInterval(autoRefreshTimerId);
    autoRefreshTimerId = null;
  }
}

function stopRealtime() {
  if (typeof unsubscribeRealtime === 'function') {
    unsubscribeRealtime();
    unsubscribeRealtime = null;
  }
  stopAutoRefresh();
}

async function handleServerAction(action, orderId) {
  await refreshOrders();
  const order = findOrder(orderId);
  if (!order) return;
  if (order.status === ORDER_STATUSES.RESCINDED_BY_DINER) {
    alert('This notice was rescinded by the diner.');
    return;
  }
  const previousStatus = previousOrderStatuses.get(orderId);
  try {
    if (action === 'approve') {
      serverApprove({ orders: tabletState.orders }, orderId);
      serverDispatchToKitchen({ orders: tabletState.orders }, orderId);
    } else if (action === 'dispatch') {
      serverDispatchToKitchen({ orders: tabletState.orders }, orderId);
    } else if (action === 'reject') {
      const { confirmed, reason } = await showRejectionConfirm(order);
      if (!confirmed) return;
      const rejectionReason = reason?.trim() || 'Rejected the notice.';
      serverReject({ orders: tabletState.orders }, orderId, rejectionReason);
      order.rejectedAt = order.updatedAt;
      previousOrderStatuses.set(orderId, order.status);
      handleRejectedOrderLifecycle(order, previousStatus);
    } else {
      return;
    }
    await saveTabletOrder(order, { restaurantId: order.restaurantId });
    notifyDinerNotice({ orderId: order.id, client: supabaseClient });
    renderServerQueue();
  } catch (error) {
    console.error('[server-tablet] action failed', error);
    alert(error?.message || 'Unable to update the tablet right now.');
  }
}

tabsContainer?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-server-id]');
  if (!button) return;
  const serverId = button.getAttribute('data-server-id');
  if (!serverId || serverId === activeServerId) return;
  activeServerId = serverId;
  renderServerQueue();
});

queueContainer?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.getAttribute('data-action');
  const orderId = button.getAttribute('data-order-id');
  if (!action || !orderId) return;
  handleServerAction(action, orderId);
});

refreshBtn?.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing...';
  try {
    await refreshOrders();
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh orders';
  }
});

async function requireAuth() {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error) {
    console.error('[server-tablet] auth error', error);
    return null;
  }
  const user = data?.user;
  if (!user) {
    window.location.href = '/account?redirect=server-tablet';
    return null;
  }
  return user;
}

function showUnauthorized() {
  if (queueContainer) {
    queueContainer.innerHTML = `
      <div class="empty-tablet-state">
        You do not have access to the server station tablet. Contact your Clarivore admin if this is unexpected.
      </div>
    `;
  }
}

async function bootstrap() {
  const user = await requireAuth();
  if (!user) return;

  isOwner = user.email === OWNER_EMAIL;
  const role = user.user_metadata?.role;
  const isManager = role === 'manager';

  let managerRestaurants = [];
  if (isManager || isOwner) {
    managerRestaurants = await fetchManagerRestaurants(supabaseClient, user.id);
  }

  setupTopbar('server-tablet', user, { managerRestaurants });

  if (!(isOwner || isManager)) {
    showUnauthorized();
    return;
  }

  if (isManager && !isOwner && managerRestaurants.length === 0) {
    showUnauthorized();
    return;
  }

  managedRestaurantIds = managerRestaurants.map((r) => r.id).filter(Boolean);

  await refreshOrders();
  await startRealtime();
  startAutoRefresh();
}

window.addEventListener('beforeunload', () => {
  stopRealtime();
});

bootstrap();

let rejectionDialogStylesInjected = false;

function ensureRejectionDialogStyles() {
  if (rejectionDialogStylesInjected) return;
  rejectionDialogStylesInjected = true;
  const style = document.createElement('style');
  style.id = 'server-rejection-dialog-styles';
  style.textContent = `
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
      flex-wrap: wrap;
      gap: 12px;
      justify-content: flex-end;
    }
    .server-modal-actions button {
      padding: 10px 16px;
      border-radius: 10px;
      border: 1px solid transparent;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
    }
    .server-modal-actions button.server-modal-cancel {
      background: rgba(36, 45, 95, 0.8);
      border-color: rgba(92, 108, 210, 0.4);
      color: #e0e7ff;
    }
    .server-modal-actions button.server-modal-cancel:hover {
      background: rgba(52, 63, 130, 0.95);
    }
    .server-modal-actions button.server-modal-confirm {
      background: #ef4444;
      color: #fff;
    }
    .server-modal-actions button.server-modal-confirm:hover {
      background: #f87171;
    }
  `;
  document.head.appendChild(style);
}

function showRejectionConfirm(order) {
  ensureRejectionDialogStyles();
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'server-modal-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'server-modal';
    const guestName = order.customerName || 'this guest';
    dialog.innerHTML = `
      <h3>Reject ${guestName}'s notice?</h3>
      <p>This will remove the request from the server tablet and alert the diner. Add an optional note so they know what to fix.</p>
      <textarea aria-label="Reason for rejection" placeholder="Optional message to diner (e.g. Need manager approval first.)"></textarea>
      <div class="server-modal-actions">
        <button type="button" class="server-modal-cancel">Cancel rejection</button>
        <button type="button" class="server-modal-confirm">Confirm rejection</button>
      </div>
    `;

    const textarea = dialog.querySelector('textarea');
    const cancelBtn = dialog.querySelector('.server-modal-cancel');
    const confirmBtn = dialog.querySelector('.server-modal-confirm');

    const cleanup = (result) => {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      resolve(result);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        cleanup({ confirmed: false, reason: '' });
      }
    };

    cancelBtn.addEventListener('click', () => cleanup({ confirmed: false, reason: '' }));
    confirmBtn.addEventListener('click', () => {
      cleanup({ confirmed: true, reason: textarea.value });
    });
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        cleanup({ confirmed: false, reason: '' });
      }
    });

    document.addEventListener('keydown', onKeyDown);

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    textarea.focus();
  });
}

function clearRejectedRemoval(orderId) {
  const timer = rejectedRemovalTimers.get(orderId);
  if (timer) {
    clearTimeout(timer);
    rejectedRemovalTimers.delete(orderId);
  }
}

function removeRejectedOrder(orderId) {
  const index = tabletState.orders.findIndex((order) => order.id === orderId);
  if (index === -1) return;
  const order = tabletState.orders[index];
  if (order.status !== ORDER_STATUSES.REJECTED_BY_SERVER) return;

  rejectedRemovalTimers.delete(orderId);
  hiddenRejectedOrders.add(orderId);
  ensureActiveServerId();
  renderServerQueue();
}

function scheduleRejectedRemoval(orderId) {
  if (rejectedRemovalTimers.has(orderId)) return;
  const timer = setTimeout(() => {
    removeRejectedOrder(orderId);
  }, REJECTION_REMOVAL_DELAY_MS);
  rejectedRemovalTimers.set(orderId, timer);
}

function handleRejectedOrderLifecycle(order, previousStatus) {
  if (order.status === ORDER_STATUSES.REJECTED_BY_SERVER) {
    if (isRejectionRemovalExpired(order)) {
      hiddenRejectedOrders.add(order.id);
      clearRejectedRemoval(order.id);
      return;
    }
    hiddenRejectedOrders.delete(order.id);
    if (previousStatus !== ORDER_STATUSES.REJECTED_BY_SERVER) {
      scheduleRejectedRemoval(order.id);
    }
  } else {
    clearRejectedRemoval(order.id);
    hiddenRejectedOrders.delete(order.id);
  }
}

function isOrderHidden(order) {
  if (showCompleted) return false;
  return order.status === ORDER_STATUSES.REJECTED_BY_SERVER && hiddenRejectedOrders.has(order.id);
}

function shouldShowOrder(order) {
  if (!order) return false;
  if (!showCompleted && completedStatuses.has(order.status)) return false;
  if (isOrderHidden(order)) return false;
  return true;
}

function isRejectionRemovalExpired(order) {
  if (order.status !== ORDER_STATUSES.REJECTED_BY_SERVER) return false;
  const timestampValue = order.rejectedAt || order.rejected_at || order.updatedAt || order.updated_at;
  if (!timestampValue) return false;
  const parsed = Date.parse(timestampValue);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed >= REJECTION_REMOVAL_DELAY_MS;
}
