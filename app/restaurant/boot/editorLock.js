export function showEditorLockModal({ lockedBy, lockedAt, sameUser }) {
  const backdrop = document.getElementById("editorLockBackdrop");
  const titleEl = document.getElementById("editorLockTitle");
  const messageEl = backdrop?.querySelector(".editorLockMessage");
  const userSpan = document.getElementById("editorLockUser");
  const sinceSpan = document.getElementById("editorLockSince");
  const infoEl = backdrop?.querySelector(".editorLockInfo");

  if (!backdrop) return;

  if (sameUser) {
    if (titleEl) titleEl.textContent = "Editor Open in Another Tab";
    if (messageEl) {
      messageEl.innerHTML =
        "You already have the editor open in <span>another browser tab or device</span>.";
    }
    if (infoEl) {
      infoEl.textContent =
        "Close the other tab and click \"Check again\" to continue editing here.";
    }
  } else {
    if (titleEl) titleEl.textContent = "Editor Currently in Use";
    if (messageEl) {
      messageEl.innerHTML =
        `<span id=\"editorLockUser\">${lockedBy}</span> is currently editing this restaurant's menu.`;
    }
    if (infoEl) {
      infoEl.textContent =
        "To avoid conflicts, only one person can edit at a time. The editor will become available when they finish or after 2 minutes of inactivity.";
    }
  }

  if (userSpan && !sameUser) userSpan.textContent = lockedBy;
  if (sinceSpan) {
    const date = new Date(lockedAt);
    sinceSpan.textContent = date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  backdrop.style.display = "flex";
}

export function hideEditorLockModal() {
  const backdrop = document.getElementById("editorLockBackdrop");
  if (backdrop) backdrop.style.display = "none";
}

export function createEditorLock({ supabaseClient, supabaseUrl, supabaseAnonKey }) {
  const editorLock = {
    heartbeatInterval: null,
    HEARTBEAT_MS: 30000,
    currentRestaurantId: null,
    hasLock: false,
    cachedAuthToken: null,
    sessionId: (() => {
      const key = "clarivore_editor_session_id";
      let sid = sessionStorage.getItem(key);
      if (!sid) {
        sid = crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem(key, sid);
      }
      return sid;
    })(),

    async acquire(restaurantId, userEmail, userName) {
      try {
        const { data } = await supabaseClient.auth.getSession();
        this.cachedAuthToken = data?.session?.access_token || null;
      } catch (_) {}

      try {
        const { data, error } = await supabaseClient.rpc("acquire_editor_lock", {
          p_restaurant_id: restaurantId,
          p_user_email: userEmail,
          p_user_name: userName || null,
          p_session_id: this.sessionId,
          p_lock_timeout_seconds: 120,
        });

        if (error) return { success: false, error: error.message };

        if (data?.success) {
          this.currentRestaurantId = restaurantId;
          this.hasLock = true;
          this.startHeartbeat();
          return { success: true };
        }

        if (data?.locked) {
          return {
            success: false,
            locked: true,
            sameUser: data.same_user || false,
            lockedBy: data.locked_by_name || data.locked_by_email,
            lockedByEmail: data.locked_by_email,
            lockedAt: data.locked_at,
          };
        }

        return { success: false, error: data?.error || "Unknown lock error" };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },

    async release() {
      if (!this.currentRestaurantId) return;
      this.stopHeartbeat();
      try {
        await supabaseClient.rpc("release_editor_lock", {
          p_restaurant_id: this.currentRestaurantId,
          p_session_id: this.sessionId,
        });
      } catch (_) {}
      this.currentRestaurantId = null;
      this.hasLock = false;
    },

    async heartbeat() {
      if (!this.currentRestaurantId || !this.hasLock) return;
      try {
        const { data, error } = await supabaseClient.rpc("heartbeat_editor_lock", {
          p_restaurant_id: this.currentRestaurantId,
          p_session_id: this.sessionId,
        });

        if (error || !data?.success) {
          this.hasLock = false;
          this.stopHeartbeat();
        }
      } catch (_) {
        this.hasLock = false;
        this.stopHeartbeat();
      }
    },

    startHeartbeat() {
      this.stopHeartbeat();
      this.heartbeatInterval = setInterval(() => this.heartbeat(), this.HEARTBEAT_MS);
      this.heartbeat();
    },

    stopHeartbeat() {
      if (!this.heartbeatInterval) return;
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    },
  };

  function releaseEditorLockSync() {
    if (!editorLock.hasLock || !editorLock.currentRestaurantId) return;
    const token = editorLock.cachedAuthToken;
    if (!token) return;

    const url = `${supabaseUrl}/rest/v1/rpc/release_editor_lock`;

    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        p_restaurant_id: editorLock.currentRestaurantId,
        p_session_id: editorLock.sessionId,
      }),
      keepalive: true,
    }).catch(() => {});

    editorLock.hasLock = false;
    editorLock.stopHeartbeat();
  }

  window.addEventListener("pagehide", releaseEditorLockSync);
  window.addEventListener("beforeunload", releaseEditorLockSync);

  return editorLock;
}
