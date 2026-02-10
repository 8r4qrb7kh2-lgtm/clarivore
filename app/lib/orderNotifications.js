let notificationContainer = null;
let activeNotifications = new Map();

const STATUS_MESSAGES = {
  awaiting_user_submission: "Your order code is ready",
  awaiting_server_approval: "Your order has been submitted to the server",
  queued_for_kitchen: "Your order has been approved and staged for kitchen",
  with_kitchen: "Your order is now with the kitchen",
  acknowledged: "The kitchen has acknowledged your allergies",
  awaiting_user_response: "The kitchen has a follow-up question for you",
  question_answered: "Your response has been sent to the kitchen",
  rejected_by_server: "Your order was rejected by the server",
  rescinded_by_diner: "The diner rescinded this notice",
  rejected_by_kitchen: "The kitchen rejected this notice",
};

const STATUS_TONES = {
  awaiting_user_submission: "info",
  awaiting_server_approval: "info",
  queued_for_kitchen: "success",
  with_kitchen: "active",
  acknowledged: "success",
  awaiting_user_response: "warn",
  question_answered: "info",
  rejected_by_server: "danger",
  rescinded_by_diner: "muted",
  rejected_by_kitchen: "danger",
};

function ensureNotificationContainer() {
  if (notificationContainer) return notificationContainer;

  notificationContainer = document.createElement("div");
  notificationContainer.id = "notification-container";
  notificationContainer.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 400px;
    pointer-events: none;
  `;
  document.body.appendChild(notificationContainer);
  return notificationContainer;
}

function createNotificationBanner(orderId, status, customerName) {
  const message = STATUS_MESSAGES[status] || "Order status updated";
  const tone = STATUS_TONES[status] || "info";

  const banner = document.createElement("div");
  banner.className = "order-notification";
  banner.dataset.orderId = orderId;
  banner.dataset.tone = tone;
  banner.style.cssText = `
    background: rgba(8, 12, 30, 0.98);
    color: #f8fafc;
    border-radius: 14px;
    padding: 16px;
    box-shadow: 0 18px 40px rgba(5, 10, 35, 0.6);
    border: 1px solid rgba(92, 108, 210, 0.3);
    pointer-events: auto;
    animation: slideInRight 0.3s ease-out;
    display: flex;
    flex-direction: column;
    gap: 12px;
  `;

  const header = document.createElement("div");
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  `;

  const content = document.createElement("div");
  content.innerHTML = `
    <div style="font-weight: 600; margin-bottom: 4px;">${customerName ? `${customerName}'s order` : "Order update"}</div>
    <div style="font-size: 0.9rem; color: var(--text-muted);">${message}</div>
  `;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.style.cssText = `
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  closeBtn.addEventListener("click", () => dismissNotification(orderId));

  header.appendChild(content);
  header.appendChild(closeBtn);
  banner.appendChild(header);

  const actions = document.createElement("div");
  actions.style.cssText = `
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  `;

  const viewBtn = document.createElement("button");
  viewBtn.type = "button";
  viewBtn.className = "primary-btn";
  viewBtn.textContent = "View order";
  viewBtn.style.cssText = `
    font-size: 0.85rem;
    padding: 8px 14px;
    border-radius: 8px;
  `;
  viewBtn.addEventListener("click", () => {
    const currentPath = window.location.pathname || "";
    window.location.href = currentPath.includes("/kitchen-tablet")
      ? "/kitchen-tablet"
      : "/server-tablet";
    dismissNotification(orderId);
  });

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "secondary-btn";
  dismissBtn.textContent = "Dismiss";
  dismissBtn.style.cssText = `
    font-size: 0.85rem;
    padding: 8px 14px;
    border-radius: 8px;
  `;
  dismissBtn.addEventListener("click", () => dismissNotification(orderId));

  actions.appendChild(viewBtn);
  actions.appendChild(dismissBtn);
  banner.appendChild(actions);

  if (!document.getElementById("notification-animations")) {
    const style = document.createElement("style");
    style.id = "notification-animations";
    style.textContent = `
      @keyframes slideInRight {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOutRight {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  return banner;
}

function dismissNotification(orderId) {
  const banner = activeNotifications.get(orderId);
  if (!banner) return;

  banner.style.animation = "slideOutRight 0.3s ease-out";
  setTimeout(() => {
    banner.remove();
    activeNotifications.delete(orderId);
  }, 300);
}

export function showOrderNotification(orderId, status, customerName) {
  if (activeNotifications.has(orderId)) {
    const existing = activeNotifications.get(orderId);
    if (existing.dataset.status === status) {
      return;
    }
    dismissNotification(orderId);
  }

  const container = ensureNotificationContainer();
  const banner = createNotificationBanner(orderId, status, customerName);
  banner.dataset.status = status;
  container.appendChild(banner);
  activeNotifications.set(orderId, banner);

  setTimeout(() => {
    dismissNotification(orderId);
  }, 10000);
}

export function clearAllNotifications() {
  for (const orderId of activeNotifications.keys()) {
    dismissNotification(orderId);
  }
}
