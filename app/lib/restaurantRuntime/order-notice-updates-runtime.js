export function createOrderNoticeUpdatesRuntime(options = {}) {
  const state = options.state || {};
  const ORDER_UPDATE_MESSAGES =
    options.ORDER_UPDATE_MESSAGES &&
    typeof options.ORDER_UPDATE_MESSAGES === "object"
      ? options.ORDER_UPDATE_MESSAGES
      : {};
  const esc =
    typeof options.esc === "function"
      ? options.esc
      : (value) => String(value ?? "");
  const onOpenOrderSidebar =
    typeof options.onOpenOrderSidebar === "function"
      ? options.onOpenOrderSidebar
      : () => {};
  const onRenderOrderSidebarStatus =
    typeof options.onRenderOrderSidebarStatus === "function"
      ? options.onRenderOrderSidebarStatus
      : () => {};
  const setTimeoutFn =
    typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const requestAnimationFrameFn =
    typeof options.requestAnimationFrame === "function"
      ? options.requestAnimationFrame
      : (callback) => setTimeoutFn(callback, 0);

  let noticeBannerContainer = null;
  let noticeUpdatesPrimed = false;
  const noticeUpdateCache = new Map();

  function ensureNoticeBannerContainer() {
    if (noticeBannerContainer) return noticeBannerContainer;
    if (typeof document === "undefined") return null;
    const container = document.createElement("div");
    container.className = "noticeUpdateBannerStack";
    document.body?.appendChild(container);
    noticeBannerContainer = container;
    return container;
  }

  function getLatestExternalUpdate(order) {
    const history = Array.isArray(order?.history) ? order.history : [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const entry = history[i];
      if (!entry) continue;
      if (entry.actor && entry.actor !== "Diner") {
        return {
          actor: entry.actor || "Update",
          message: entry.message || "",
          at: entry.at || "",
        };
      }
    }
    return null;
  }

  function buildNoticeUpdateSnapshot(order) {
    if (!order || !order.id) return null;
    const latestExternal = getLatestExternalUpdate(order);
    return {
      status: order.status || "",
      externalAt: latestExternal?.at || "",
      latestExternal,
    };
  }

  function getNoticeUpdateMessage(order, latestExternal) {
    if (latestExternal?.message) return latestExternal.message;
    if (order?.status && ORDER_UPDATE_MESSAGES[order.status]) {
      return ORDER_UPDATE_MESSAGES[order.status];
    }
    return "Your notice was updated.";
  }

  function getNoticeDishTitle(order) {
    const items = Array.isArray(order?.items) ? order.items : [];
    const dishNames = items
      .map((item) => (item ?? "").toString().trim())
      .filter(Boolean);
    if (!dishNames.length) return "your dish";
    if (dishNames.length === 1) return dishNames[0];
    return `${dishNames[0]} + ${dishNames.length - 1} more`;
  }

  function attachNoticeBannerInteractions(banner, { onDismiss, onTap } = {}) {
    let startY = null;
    let deltaY = 0;
    let pointerId = null;
    let moved = false;
    let suppressClick = false;

    const reset = () => {
      startY = null;
      deltaY = 0;
      pointerId = null;
      moved = false;
      banner.style.transition = "";
      banner.style.transform = "";
      banner.style.opacity = "";
    };

    const maybeSuppressClick = () => {
      suppressClick = true;
      setTimeoutFn(() => {
        suppressClick = false;
      }, 50);
    };

    banner.addEventListener("pointerdown", (event) => {
      pointerId = event.pointerId;
      startY = event.clientY;
      moved = false;
      banner.setPointerCapture?.(pointerId);
      banner.style.transition = "none";
    });

    banner.addEventListener("pointermove", (event) => {
      if (pointerId === null || event.pointerId !== pointerId || startY === null)
        return;
      const nextDelta = event.clientY - startY;
      if (nextDelta > 0) return;
      deltaY = nextDelta;
      if (Math.abs(deltaY) > 6) moved = true;
      banner.style.transform = `translateY(${deltaY}px)`;
      const opacity = Math.max(0.2, 1 + deltaY / 80);
      banner.style.opacity = `${opacity}`;
    });

    banner.addEventListener("pointerup", () => {
      if (deltaY < -40) {
        maybeSuppressClick();
        if (typeof onDismiss === "function") onDismiss();
        reset();
        return;
      }
      if (!moved && typeof onTap === "function") {
        onTap();
      }
      reset();
    });

    banner.addEventListener("pointercancel", reset);

    banner.addEventListener("click", (event) => {
      if (suppressClick) {
        event.preventDefault();
        return;
      }
      if (typeof onTap === "function") onTap();
    });
  }

  function dismissNoticeBanner(banner) {
    if (!banner) return;
    banner.classList.add("is-dismissed");
    setTimeoutFn(() => {
      banner.remove();
    }, 240);
  }

  function showNoticeUpdateBanner(order, latestExternal) {
    const container = ensureNoticeBannerContainer();
    if (!container || typeof document === "undefined") return;
    const banner = document.createElement("div");
    const dishTitle = getNoticeDishTitle(order);
    const title = dishTitle ? `Notice update for ${dishTitle}` : "Notice update";
    const message = getNoticeUpdateMessage(order, latestExternal);
    banner.className = "noticeUpdateBanner";
    banner.innerHTML = `
      <div class="noticeUpdateBannerTitle">${esc(title)}</div>
      <div class="noticeUpdateBannerBody">${esc(message)}</div>
    `;
    container.appendChild(banner);
    requestAnimationFrameFn(() => {
      banner.classList.add("is-visible");
    });

    const handleDismiss = () => dismissNoticeBanner(banner);
    attachNoticeBannerInteractions(banner, {
      onDismiss: handleDismiss,
      onTap: () => {
        onOpenOrderSidebar();
        onRenderOrderSidebarStatus(order);
      },
    });

    setTimeoutFn(() => {
      dismissNoticeBanner(banner);
    }, 9000);
  }

  function handleNoticeUpdates(orders) {
    const currentUserId = state.user?.id || null;
    const trackedOrders = Array.isArray(orders)
      ? orders.filter((order) => {
          if (!order || !order.id) return false;
          if (currentUserId && order.userId && order.userId !== currentUserId) {
            return false;
          }
          return true;
        })
      : [];

    if (!noticeUpdatesPrimed) {
      trackedOrders.forEach((order) => {
        const snapshot = buildNoticeUpdateSnapshot(order);
        if (snapshot) {
          noticeUpdateCache.set(order.id, snapshot);
        }
      });
      noticeUpdatesPrimed = true;
      return;
    }

    const activeIds = new Set();
    trackedOrders.forEach((order) => {
      activeIds.add(order.id);
      const snapshot = buildNoticeUpdateSnapshot(order);
      if (!snapshot) return;
      const previous = noticeUpdateCache.get(order.id);
      if (previous && snapshot.externalAt && snapshot.externalAt !== previous.externalAt) {
        if (snapshot.latestExternal?.actor && snapshot.latestExternal.actor !== "Diner") {
          showNoticeUpdateBanner(order, snapshot.latestExternal);
        }
      }
      noticeUpdateCache.set(order.id, snapshot);
    });

    Array.from(noticeUpdateCache.keys()).forEach((key) => {
      if (!activeIds.has(key)) {
        noticeUpdateCache.delete(key);
      }
    });
  }

  return {
    handleNoticeUpdates,
  };
}
