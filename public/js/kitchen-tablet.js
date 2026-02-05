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
  createInitialState,
  kitchenAcknowledge,
  kitchenAskQuestion,
  kitchenReject,
  ORDER_STATUSES
} from './tablet-simulation-logic.mjs';
import { showOrderNotification } from './order-notifications.js';

const OWNER_EMAIL = 'matt.29.ds@gmail.com';

const queueContainer = document.getElementById('kitchen-queue');
const refreshBtn = document.getElementById('refresh-btn');
const completedToggle = document.getElementById('kitchen-show-completed');
const promptBackdrop = document.getElementById('kitchenPromptBackdrop');
const promptTitle = document.getElementById('kitchenPromptTitle');
const promptMessage = document.getElementById('kitchenPromptMessage');
const promptInput = document.getElementById('kitchenPromptInput');
const promptCancel = document.getElementById('kitchenPromptCancel');
const promptConfirm = document.getElementById('kitchenPromptConfirm');

const STATUS_DESCRIPTORS = {
  [ORDER_STATUSES.WITH_KITCHEN]: { label: 'Awaiting FaceID', tone: 'warn' },
  [ORDER_STATUSES.ACKNOWLEDGED]: { label: 'Acknowledged', tone: 'success' },
  [ORDER_STATUSES.AWAITING_USER_RESPONSE]: { label: 'Waiting on diner', tone: 'warn' },
  [ORDER_STATUSES.QUESTION_ANSWERED]: { label: 'Awaiting FaceID', tone: 'warn' },
  [ORDER_STATUSES.RESCINDED_BY_DINER]: { label: 'Rescinded by diner', tone: 'muted' },
  [ORDER_STATUSES.REJECTED_BY_KITCHEN]: { label: 'Rejected by kitchen', tone: 'danger' }
};

const tabletState = {
  orders: [],
  chefs: []
};

const defaultSimulationState = createInitialState();
if (Array.isArray(defaultSimulationState?.chefs)) {
  tabletState.chefs = [...defaultSimulationState.chefs];
}

let managedRestaurantIds = [];
let isOwner = false;
let unsubscribeRealtime = null;
const previousOrderStatuses = new Map();

const AUTO_REFRESH_INTERVAL_MS = 15000;
let autoRefreshTimerId = null;
let showCompleted = false;
let promptResolve = null;

function closeKitchenPrompt(value) {
  if (!promptResolve) return;
  const resolve = promptResolve;
  promptResolve = null;
  if (promptBackdrop) {
    promptBackdrop.classList.remove('show');
    promptBackdrop.hidden = true;
  }
  resolve(value);
}

function openKitchenPrompt(options = {}) {
  if (!promptBackdrop || !promptInput || !promptTitle || !promptMessage || !promptConfirm) {
    return Promise.resolve(null);
  }
  if (promptResolve) {
    promptResolve(null);
    promptResolve = null;
  }
  promptTitle.textContent = options.title || 'Add note';
  promptMessage.textContent = options.message || '';
  promptInput.value = options.value || '';
  promptInput.placeholder = options.placeholder || '';
  promptConfirm.textContent = options.confirmText || 'Confirm';
  promptBackdrop.hidden = false;
  requestAnimationFrame(() => {
    promptBackdrop.classList.add('show');
    promptInput.focus();
  });
  return new Promise((resolve) => {
    promptResolve = resolve;
  });
}

if (promptCancel) {
  promptCancel.addEventListener('click', () => closeKitchenPrompt(null));
}
if (promptConfirm) {
  promptConfirm.addEventListener('click', () => {
    closeKitchenPrompt(promptInput?.value?.trim() || '');
  });
}
if (promptBackdrop) {
  promptBackdrop.addEventListener('click', (event) => {
    if (event.target === promptBackdrop) {
      closeKitchenPrompt(null);
    }
  });
}
if (promptInput) {
  promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeKitchenPrompt(null);
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      closeKitchenPrompt(promptInput.value.trim());
    }
  });
}

const completedStatuses = new Set([
  ORDER_STATUSES.ACKNOWLEDGED,
  ORDER_STATUSES.RESCINDED_BY_DINER,
  ORDER_STATUSES.REJECTED_BY_KITCHEN
]);

if (completedToggle) {
  completedToggle.checked = false;
  completedToggle.addEventListener('change', () => {
    showCompleted = completedToggle.checked;
    renderKitchenQueue();
  });
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

function renderKitchenQueue() {
  if (!queueContainer) return;

  const relevantStatuses = new Set([
    ORDER_STATUSES.WITH_KITCHEN,
    ORDER_STATUSES.ACKNOWLEDGED,
    ORDER_STATUSES.AWAITING_USER_RESPONSE,
    ORDER_STATUSES.QUESTION_ANSWERED,
    ORDER_STATUSES.RESCINDED_BY_DINER,
    ORDER_STATUSES.REJECTED_BY_KITCHEN
  ]);

  const activeOrders = tabletState.orders.filter((order) => {
    if (!relevantStatuses.has(order.status)) return false;
    if (!showCompleted && completedStatuses.has(order.status)) return false;
    return true;
  });
  if (!activeOrders.length) {
    queueContainer.innerHTML = `
      <div class="empty-tablet-state">
        Kitchen is idle. Notices appear here after the server dispatches them.
      </div>
    `;
    return;
  }

  const cards = activeOrders
    .map((order) => {
      const allergies = Array.isArray(order.allergies) && order.allergies.length
        ? order.allergies.join(', ')
        : 'None listed';
      const dishes = Array.isArray(order.items) && order.items.length
        ? order.items.join(', ')
        : 'No dishes listed';
      const tableLabel = order.tableNumber ? `Table ${order.tableNumber}` : 'Table —';
      const firstName = getFirstName(order.customerName);

      const chefOptions = tabletState.chefs
        .map((chef) => `<option value="${chef.id}">${chef.name} • ${chef.role}</option>`)
        .join('');

      let faceIdControls = '';
      if (order.status === ORDER_STATUSES.RESCINDED_BY_DINER) {
        faceIdControls = `
          <div class="hardware-buttons">
            <button type="button" class="secondary-btn" disabled>
              Rescinded by diner
            </button>
          </div>
        `;
      } else if (order.status === ORDER_STATUSES.REJECTED_BY_KITCHEN) {
        faceIdControls = `
          <div class="hardware-buttons">
            <button type="button" class="secondary-btn" disabled>
              Rejected by kitchen
            </button>
          </div>
        `;
      } else if ([ORDER_STATUSES.WITH_KITCHEN, ORDER_STATUSES.QUESTION_ANSWERED].includes(order.status)) {
        faceIdControls = `
          <div class="hardware-buttons" data-role="faceid-controls">
            <label style="display:flex;flex-direction:column;gap:6px;">
              <span class="kitchen-meta">Chef on duty</span>
              <select data-role="chef-select">
                ${chefOptions}
              </select>
            </label>
            <button type="button" class="primary-btn" data-action="acknowledge" data-order-id="${order.id}">
              Acknowledge &amp; FaceID
            </button>
          </div>
        `;
      } else if (order.status === ORDER_STATUSES.ACKNOWLEDGED) {
        faceIdControls = `
          <div class="hardware-buttons">
            <button type="button" class="secondary-btn" disabled>
              Acknowledged
            </button>
          </div>
        `;
      } else {
        faceIdControls = `
          <div class="hardware-buttons">
            <button type="button" class="secondary-btn" disabled>
              Waiting on diner
            </button>
          </div>
        `;
      }

      let questionControls = '';
      if (order.status === ORDER_STATUSES.RESCINDED_BY_DINER || order.status === ORDER_STATUSES.REJECTED_BY_KITCHEN) {
        questionControls = '';
      } else if ([ORDER_STATUSES.WITH_KITCHEN, ORDER_STATUSES.ACKNOWLEDGED, ORDER_STATUSES.QUESTION_ANSWERED].includes(order.status)) {
        questionControls = `
          <div class="hardware-buttons">
            <button type="button" class="secondary-btn" data-action="question" data-order-id="${order.id}">
              Send follow-up question
            </button>
          </div>
        `;
        if (order.kitchenQuestion) {
          questionControls += `
            <div class="question-card">
              <strong>Previous follow-up:</strong> ${order.kitchenQuestion.text}<br>
              <span class="kitchen-meta">
                ${order.kitchenQuestion.response
              ? `Diner responded ${order.kitchenQuestion.response.toUpperCase()}`
              : 'Awaiting diner response'}
              </span>
            </div>
          `;
        }
      } else if (order.kitchenQuestion) {
        questionControls = `
          <div class="question-card">
            <strong>Follow-up:</strong> ${order.kitchenQuestion.text}<br>
            <span class="kitchen-meta">
              ${order.kitchenQuestion.response
            ? `Diner responded ${order.kitchenQuestion.response.toUpperCase()}`
            : 'Awaiting diner response'}
            </span>
          </div>
        `;
      }

      let rejectControls = '';
      if (order.status !== ORDER_STATUSES.RESCINDED_BY_DINER && order.status !== ORDER_STATUSES.REJECTED_BY_KITCHEN) {
        rejectControls = `
          <div class="hardware-buttons">
            <button type="button" class="danger-btn" data-action="reject" data-order-id="${order.id}">
              Reject order
            </button>
          </div>
        `;
      }

      let faceIdLog = '';
      if (Array.isArray(order.faceIdAudit) && order.faceIdAudit.length) {
        const items = order.faceIdAudit
          .map((entry) => `<li>${entry.chefName} • ${entry.role || ''} • ${formatTimestamp(entry.at)}</li>`)
          .join('');
        faceIdLog = `
          <div class="faceid-log">
            <strong>FaceID acknowledgements</strong>
            <ul>${items}</ul>
          </div>
        `;
      }

      const { submittedTime, updates } = getOrderTimestamps(order);
      const submittedTimeStr = submittedTime ? formatTimestamp(submittedTime) : '';
      const updatesHtml = updates.length > 0 ? `
        <div class="kitchen-timestamps">
          ${updates.map(u => `<div class="kitchen-timestamp"><strong>${u.actor}:</strong> ${u.message} <span class="kitchen-timestamp-time">${formatTimestamp(u.at)}</span></div>`).join('')}
        </div>
      ` : '';

      return `
        <article class="kitchen-card" data-order-id="${order.id}">
          <header>
            <div>
              <h2>${tableLabel} (${firstName})</h2>
              <div class="kitchen-meta">Allergies: ${allergies}</div>
              <div class="kitchen-meta">Dishes: ${dishes}</div>
              ${submittedTimeStr ? `<div class="kitchen-meta">Submitted: ${submittedTimeStr}</div>` : ''}
            </div>
            ${formatStatusBadge(order)}
          </header>
          ${faceIdControls}
          ${questionControls}
          ${rejectControls}
          ${updatesHtml}
          ${faceIdLog}
        </article>
      `;
    })
    .join('');

  queueContainer.innerHTML = cards;
}

function findOrder(orderId) {
  return tabletState.orders.find((order) => order.id === orderId) || null;
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
  }

  tabletState.orders = orders;
  renderKitchenQueue();
}

async function refreshOrders() {
  try {
    const orders = await fetchTabletOrders(isOwner || managedRestaurantIds.length === 0 ? [] : managedRestaurantIds);
    setOrders(orders);
  } catch (error) {
    console.error('[kitchen-tablet] failed to load orders', error);
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
      if (eventType === 'DELETE') {
        tabletState.orders = tabletState.orders.filter((o) => o.id !== order.id);
        previousOrderStatuses.delete(order.id);
      } else {
        // Check for status change before updating
        const previousStatus = previousOrderStatuses.get(order.id);
        if (previousStatus && previousStatus !== order.status) {
          showOrderNotification(order.id, order.status, order.customerName);
        }
        previousOrderStatuses.set(order.id, order.status);

        const idx = tabletState.orders.findIndex((o) => o.id === order.id);
        if (idx === -1) {
          tabletState.orders.push(order);
        } else {
          tabletState.orders[idx] = order;
        }
      }
      renderKitchenQueue();
    });
  } catch (error) {
    console.error('[kitchen-tablet] failed to subscribe to realtime changes', error);
  }
}

function stopRealtime() {
  if (typeof unsubscribeRealtime === 'function') {
    unsubscribeRealtime();
    unsubscribeRealtime = null;
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimerId = setInterval(() => {
    refreshOrders().catch((error) => {
      console.error('[kitchen-tablet] auto refresh failed', error);
    });
  }, AUTO_REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (autoRefreshTimerId) {
    clearInterval(autoRefreshTimerId);
    autoRefreshTimerId = null;
  }
}

async function handleAcknowledge(order, card) {
  console.log('[kitchen-tablet] handleAcknowledge called', { orderId: order.id, card });
  const select = card.querySelector('[data-role="chef-select"]');
  console.log('[kitchen-tablet] chef select element:', select);
  let chefId = select?.value;
  console.log('[kitchen-tablet] selected chef ID:', chefId);
  if (!chefId) {
    // Fallback: if no chef selected, use the first available chef
    if (tabletState.chefs && tabletState.chefs.length > 0) {
      const fallbackChef = tabletState.chefs[0];
      console.warn('[kitchen-tablet] No chef selected, falling back to first chef:', fallbackChef.id);
      chefId = fallbackChef.id;
      if (select) {
        select.value = chefId; // update UI select
      }
    } else {
      console.error('[kitchen-tablet] No chef selected and no chefs available');
      alert('Select the chef acknowledging the notice.');
      return;
    }
  }
  try {
    console.log('[kitchen-tablet] Calling kitchenAcknowledge');
    kitchenAcknowledge({ orders: tabletState.orders, chefs: tabletState.chefs }, order.id, chefId);
    console.log('[kitchen-tablet] Saving order');
    await saveTabletOrder(order, { restaurantId: order.restaurantId });
    notifyDinerNotice({ orderId: order.id, client: supabaseClient });
    console.log('[kitchen-tablet] Re-rendering queue');
    renderKitchenQueue();
  } catch (error) {
    console.error('[kitchen-tablet] acknowledge failed', error);
    alert(error?.message || 'Unable to acknowledge this notice right now.');
  }
}

async function handleQuestion(order) {
  const question = await openKitchenPrompt({
    title: 'Send follow-up question',
    message: 'Dictate the yes/no follow-up you need the diner to answer:',
    placeholder: 'Type the follow-up question...',
    confirmText: 'Send question'
  });
  if (question === null) return;
  const text = question.trim();
  if (!text) {
    alert('Add a question before sending.');
    return;
  }
  try {
    kitchenAskQuestion({ orders: tabletState.orders, chefs: tabletState.chefs }, order.id, text);
    await saveTabletOrder(order, { restaurantId: order.restaurantId });
    notifyDinerNotice({ orderId: order.id, client: supabaseClient });
    renderKitchenQueue();
  } catch (error) {
    console.error('[kitchen-tablet] question failed', error);
    alert(error?.message || 'Unable to send the follow-up question.');
  }
}

async function handleReject(order) {
  const reason = await openKitchenPrompt({
    title: 'Reject notice',
    message: 'Why are you rejecting this notice?',
    placeholder: 'Share the reason for rejecting this notice...',
    confirmText: 'Reject order'
  });
  if (reason === null) return;
  try {
    kitchenReject({ orders: tabletState.orders, chefs: tabletState.chefs }, order.id, reason);
    await saveTabletOrder(order, { restaurantId: order.restaurantId });
    notifyDinerNotice({ orderId: order.id, client: supabaseClient });
    renderKitchenQueue();
  } catch (error) {
    console.error('[kitchen-tablet] reject failed', error);
    alert(error?.message || 'Unable to reject this notice right now.');
  }
}

queueContainer?.addEventListener('click', (event) => {
  console.log('[kitchen-tablet] Click event on queue container', event.target);
  const button = event.target.closest('[data-action]');
  if (!button) {
    console.log('[kitchen-tablet] No button with data-action found');
    return;
  }
  console.log('[kitchen-tablet] Button clicked:', button);
  const action = button.getAttribute('data-action');
  const orderId = button.getAttribute('data-order-id');
  console.log('[kitchen-tablet] Action:', action, 'Order ID:', orderId);
  if (!action || !orderId) return;
  // Find the parent card by class name instead of data-order-id to avoid finding the button itself
  const card = button.closest('.kitchen-card');
  const order = findOrder(orderId);
  console.log('[kitchen-tablet] Card:', card, 'Order:', order);
  if (!order || !card) return;

  if (action === 'acknowledge') {
    console.log('[kitchen-tablet] Calling handleAcknowledge');
    handleAcknowledge(order, card);
  } else if (action === 'question') {
    console.log('[kitchen-tablet] Calling handleQuestion');
    handleQuestion(order);
  } else if (action === 'reject') {
    console.log('[kitchen-tablet] Calling handleReject');
    handleReject(order);
  }
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
    console.error('[kitchen-tablet] auth error', error);
    return null;
  }
  const user = data?.user;
  if (!user) {
    window.location.href = 'account.html?redirect=kitchen-tablet';
    return null;
  }
  return user;
}

function showUnauthorized() {
  if (queueContainer) {
    queueContainer.innerHTML = `
      <div class="empty-tablet-state">
        You do not have access to the kitchen line tablet. Contact your Clarivore admin if this is unexpected.
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

  setupTopbar('kitchen-tablet', user, { managerRestaurants });

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
  stopAutoRefresh();
});

bootstrap();
