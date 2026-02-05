// Initialize Supabase
const SUPABASE_URL = "https://fgoiyycctnwnghrvsilt.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnb2l5eWNjdG53bmdocnZzaWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA0MzY1MjYsImV4cCI6MjA3NjAxMjUyNn0.xlSSXr0Gl7j-vsckrj-2anpPmp4BG2SUIdN-_dquSA8";
const CLARIVORE_PUSH_PUBLIC_KEY =
  "BLwHDRRCZBQE_RHLUlRBgrKcKjHGKxIM4UaYWkRHzUMfQZIkNVBERTHL2cvJ1koMTUYlpgfEdslZjj0nh3DLSG0";
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
window.supabaseClient = supabaseClient;
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_KEY = SUPABASE_KEY;
window.CLARIVORE_PUSH_PUBLIC_KEY = CLARIVORE_PUSH_PUBLIC_KEY;
// ========== Editor Lock Management ==========
// Prevents multiple users OR same user in multiple tabs/devices from editing simultaneously
const EditorLock = {
  heartbeatInterval: null,
  HEARTBEAT_MS: 30000, // Send heartbeat every 30 seconds
  currentRestaurantId: null,
  hasLock: false,
  // Generate a unique session ID for this browser tab (persists across page refreshes via sessionStorage)
  sessionId: (() => {
    const storageKey = "clarivore_editor_session_id";
    let sid = sessionStorage.getItem(storageKey);
    if (!sid) {
      sid = crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem(storageKey, sid);
    }
    return sid;
  })(),
  // Cache the auth token for synchronous release during page unload
  cachedAuthToken: null,

  async acquire(restaurantId, userEmail, userName) {
    // Cache the auth token for later synchronous release
    try {
      const { data } = await supabaseClient.auth.getSession();
      this.cachedAuthToken = data?.session?.access_token || null;
    } catch (e) {
      console.warn("Could not cache auth token:", e);
    }
    try {
      const { data, error } = await supabaseClient.rpc("acquire_editor_lock", {
        p_restaurant_id: restaurantId,
        p_user_email: userEmail,
        p_user_name: userName || null,
        p_session_id: this.sessionId,
        p_lock_timeout_seconds: 120,
      });

      if (error) {
        console.error("Error acquiring editor lock:", error);
        return { success: false, error: error.message };
      }

      if (data?.success) {
        this.currentRestaurantId = restaurantId;
        this.hasLock = true;
        this.startHeartbeat(restaurantId);
        console.log("Editor lock acquired for session:", this.sessionId);
        return { success: true };
      } else if (data?.locked) {
        console.log(
          "Editor is locked by:",
          data.locked_by_email,
          "same_user:",
          data.same_user,
        );
        return {
          success: false,
          locked: true,
          sameUser: data.same_user || false,
          lockedBy: data.locked_by_name || data.locked_by_email,
          lockedByEmail: data.locked_by_email,
          lockedAt: data.locked_at,
        };
      } else {
        return { success: false, error: data?.error || "Unknown error" };
      }
    } catch (err) {
      console.error("Exception acquiring editor lock:", err);
      return { success: false, error: err.message };
    }
  },

  async release() {
    if (!this.currentRestaurantId) return;

    this.stopHeartbeat();

    try {
      const { data, error } = await supabaseClient.rpc("release_editor_lock", {
        p_restaurant_id: this.currentRestaurantId,
        p_session_id: this.sessionId,
      });

      if (error) {
        console.error("Error releasing editor lock:", error);
      } else {
        console.log("Editor lock released for session:", this.sessionId);
      }
    } catch (err) {
      console.error("Exception releasing editor lock:", err);
    }

    this.currentRestaurantId = null;
    this.hasLock = false;
  },

  async heartbeat() {
    if (!this.currentRestaurantId || !this.hasLock) return;

    try {
      const { data, error } = await supabaseClient.rpc(
        "heartbeat_editor_lock",
        {
          p_restaurant_id: this.currentRestaurantId,
          p_session_id: this.sessionId,
        },
      );

      if (error || !data?.success) {
        console.warn(
          "Heartbeat failed, lock may have been lost:",
          error || data?.error,
        );
        // Lock was lost - could show a warning to the user
        this.hasLock = false;
        this.stopHeartbeat();
      }
    } catch (err) {
      console.error("Exception during heartbeat:", err);
    }
  },

  startHeartbeat(restaurantId) {
    this.stopHeartbeat(); // Clear any existing interval
    this.heartbeatInterval = setInterval(
      () => this.heartbeat(),
      this.HEARTBEAT_MS,
    );
    // Also send initial heartbeat
    this.heartbeat();
  },

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  },
};

window.EditorLock = EditorLock;

// Helper to release lock via keepalive fetch (survives page unload)
function releaseEditorLockSync() {
  if (!EditorLock.hasLock || !EditorLock.currentRestaurantId) return;

  const token = EditorLock.cachedAuthToken;
  if (!token) {
    console.warn("No cached auth token for lock release");
    return;
  }

  // Use fetch with keepalive to ensure request completes even after page unloads
  const url = `${SUPABASE_URL}/rest/v1/rpc/release_editor_lock`;

  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      p_restaurant_id: EditorLock.currentRestaurantId,
      p_session_id: EditorLock.sessionId,
    }),
    keepalive: true, // Critical: allows request to outlive the page
  }).catch(() => {}); // Ignore errors on unload

  EditorLock.hasLock = false;
  EditorLock.stopHeartbeat();
}

// Release lock when page unloads (navigation, tab close, refresh)
window.addEventListener("pagehide", () => {
  releaseEditorLockSync();
});

// Also try on beforeunload as backup
window.addEventListener("beforeunload", () => {
  releaseEditorLockSync();
});

// UI helpers for the lock modal
function showEditorLockModal(lockedBy, lockedAt, sameUser = false) {
  const backdrop = document.getElementById("editorLockBackdrop");
  const titleEl = document.getElementById("editorLockTitle");
  const messageEl = document.querySelector(".editorLockMessage");
  const userSpan = document.getElementById("editorLockUser");
  const sinceSpan = document.getElementById("editorLockSince");
  const infoEl = document.querySelector(".editorLockInfo");

  if (sameUser) {
    // Same user, different tab/device
    if (titleEl) titleEl.textContent = "Editor Open in Another Tab";
    if (messageEl)
      messageEl.innerHTML =
        "You already have the editor open in <span>another browser tab or device</span>.";
    if (infoEl)
      infoEl.textContent =
        'Close the other tab and click "Check again" to continue editing here.';
  } else {
    // Different user
    if (titleEl) titleEl.textContent = "Editor Currently in Use";
    if (messageEl)
      messageEl.innerHTML = `<span id="editorLockUser">${lockedBy}</span> is currently editing this restaurant's menu.`;
    if (infoEl)
      infoEl.textContent =
        "To avoid conflicts, only one person can edit at a time. The editor will become available when they finish or after 2 minutes of inactivity.";
  }

  if (userSpan && !sameUser) userSpan.textContent = lockedBy;
  if (sinceSpan) {
    const date = new Date(lockedAt);
    sinceSpan.textContent = date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (backdrop) backdrop.style.display = "flex";
}

function hideEditorLockModal() {
  const backdrop = document.getElementById("editorLockBackdrop");
  if (backdrop) backdrop.style.display = "none";
}

// Set up lock modal button handlers
document.getElementById("editorLockRefresh")?.addEventListener("click", () => {
  // Reload page to try again
  window.location.reload();
});

window.showEditorLockModal = showEditorLockModal;
window.hideEditorLockModal = hideEditorLockModal;
// ========== End Editor Lock Management ==========

// Get slug from URL
const urlParams = new URLSearchParams(window.location.search);
const slug = urlParams.get("slug");
const qrParam = urlParams.get("qr");
const isQrVisit = qrParam ? /^(1|true|yes)$/i.test(qrParam) : false;
window.__qrVisit = isQrVisit;

// Check for manager invite token
const inviteToken = urlParams.get("invite");
if (inviteToken) {
  // Show manager invite banner
  const managerInviteBanner = document.getElementById("managerInviteBanner");
  const managerInviteSignupBtn = document.getElementById(
    "managerInviteSignupBtn",
  );

  if (managerInviteBanner) {
    managerInviteBanner.style.display = "flex";
    document.body.classList.add("managerInviteBannerVisible");

    // Handle signup button click - go to account page with invite token preserved
    if (managerInviteSignupBtn) {
      managerInviteSignupBtn.onclick = () => {
        window.location.href = `account.html?invite=${encodeURIComponent(inviteToken)}`;
      };
    }
  }
}

// Track recently viewed restaurants
if (slug) {
  try {
    const recentlyViewed = JSON.parse(
      localStorage.getItem("recentlyViewedRestaurants") || "[]",
    );
    // Remove if already exists (to move to front)
    const filtered = recentlyViewed.filter((s) => s !== slug);
    // Add to front
    filtered.unshift(slug);
    // Keep only most recent 10
    localStorage.setItem(
      "recentlyViewedRestaurants",
      JSON.stringify(filtered.slice(0, 10)),
    );
  } catch (e) {
    console.warn("Could not track recently viewed restaurant:", e);
  }
}

const HOW_IT_WORKS_SLUG = "how-it-works";
const HOW_IT_WORKS_MENU_IMAGE = "images/how-it-works-menu.png";
const HOW_IT_WORKS_OVERLAYS = [
  {
    id: "Grilled Tofu",
    name: "Grilled Tofu",
    title: "Grilled Tofu",
    description: "With vegetables and potatoes",
    x: 13,
    y: 21,
    w: 52,
    h: 11,
    allergens: ["soy"],
    removable: [
      {
        allergen: "soy",
        instructions: "Ask for olive oil dressing instead of soy glaze",
      },
    ],
    diets: ["Vegan", "Vegetarian", "Gluten-free"],
    crossContamination: ["peanut"],
    price: "$18",
    details: {
      description:
        "House-marinated tofu served with charred vegetables and crispy potatoes.",
      tags: ["Chef favorite", "Training example"],
    },
    ingredients: [
      { name: "Tofu", allergens: ["soy"] },
      { name: "Roasted vegetables", allergens: [] },
      { name: "Baby potatoes", allergens: [] },
      { name: "Herb oil", allergens: [] },
    ],
  },
  {
    id: "Spaghetti Bolognese",
    name: "Spaghetti Bolognese",
    title: "Spaghetti Bolognese",
    description: "With tomato sauce and basil",
    x: 13,
    y: 33.5,
    w: 52,
    h: 11,
    allergens: ["wheat", "milk"],
    removable: [
      { allergen: "milk", instructions: "Request no parmesan topping" },
    ],
    diets: ["Pescatarian"],
    crossContamination: ["egg"],
    price: "$22",
    details: {
      description:
        "Slow-simmered sauce tossed with spaghetti and finished with basil.",
      tags: ["House classic", "Training example"],
    },
    ingredients: [
      { name: "Spaghetti", allergens: ["wheat"] },
      { name: "Parmesan", allergens: ["milk"] },
      { name: "Tomato-basil sauce", allergens: [] },
    ],
  },
];

const HOW_IT_WORKS_RESTAURANT = {
  id: "tour-how-it-works",
  _id: "tour-how-it-works",
  name: "How It Works Training Menu",
  slug: HOW_IT_WORKS_SLUG,
  menu_image: HOW_IT_WORKS_MENU_IMAGE,
  last_confirmed: "2025-11-14T00:00:00.000Z",
  overlays: HOW_IT_WORKS_OVERLAYS,
  website: null,
  phone: null,
  delivery_url: null,
};
const isHowItWorksSlug = slug === HOW_IT_WORKS_SLUG;

// Check for editor mode URL parameter or manager mode preference
const editParam = urlParams.get("edit") || urlParams.get("mode");
const hasExplicitModeParam = editParam !== null;
let shouldStartInEditor =
  editParam === "true" || editParam === "editor" || editParam === "1";
if (!hasExplicitModeParam && !isQrVisit) {
  try {
    const storedMode = localStorage.getItem("clarivoreManagerMode");
    if (storedMode === "editor") {
      shouldStartInEditor = true;
    }
  } catch (e) {
    console.warn("Could not read manager mode preference:", e);
  }
}
window.__startInEditor = shouldStartInEditor;
if (shouldStartInEditor) {
  console.log(
    hasExplicitModeParam
      ? "Editor mode requested via URL parameter"
      : "Editor mode requested via manager mode preference",
  );
}

// Check for openLog parameter to auto-open change log modal
const openLogParam = urlParams.get("openLog");
window.__openLogOnLoad = openLogParam === "true" || openLogParam === "1";
if (window.__openLogOnLoad)
  console.log("Change log modal requested via URL parameter");

// Check for openConfirm parameter to auto-open confirmation modal
const openConfirmParam = urlParams.get("openConfirm");
window.__openConfirmOnLoad =
  openConfirmParam === "true" || openConfirmParam === "1";
if (window.__openConfirmOnLoad)
  console.log("Confirmation modal requested via URL parameter");

if (!slug) {
  document.body.innerHTML =
    '<div style="color: #ef4444; text-align: center; padding: 40px;">Error: No restaurant specified</div>';
} else {
  // Fetch restaurant data
  async function loadRestaurant() {
    const managerRestaurantsList = [];

    if (isHowItWorksSlug) {
      await loadTrainingRestaurant(managerRestaurantsList);
      return;
    }

    const { data: restaurant, error } = await supabaseClient
      .from("restaurants")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error) {
      console.error("Error loading restaurant:", error);
      document.body.innerHTML =
        '<div style="color: #ef4444; text-align: center; padding: 40px;">Error loading restaurant</div>';
      return;
    }

    if (!restaurant) {
      document.body.innerHTML =
        '<div style="color: #ef4444; text-align: center; padding: 40px;">Restaurant not found</div>';
      return;
    }

    // Get current user
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    // Get user allergies and diets if logged in
    let allergies = [];
    let diets = [];
    let canEdit = false;
    const OWNER_EMAIL = "matt.29.ds@gmail.com";
    if (user) {
      const userRole = user.user_metadata?.role || null;
      const isOwner = user.email === OWNER_EMAIL;

      const { data: record } = await supabaseClient
        .from("user_allergies")
        .select("allergens, diets")
        .eq("user_id", user.id)
        .maybeSingle();
      allergies = record?.allergens || [];
      diets = record?.diets || [];

      // Load loved dishes
      try {
        const { data: lovedData } = await supabaseClient
          .from("user_loved_dishes")
          .select("restaurant_id, dish_name")
          .eq("user_id", user.id);
        if (lovedData) {
          window.lovedDishesSet = new Set(
            lovedData.map((d) => `${String(d.restaurant_id)}:${d.dish_name}`),
          );
        } else {
          window.lovedDishesSet = new Set();
        }
      } catch (err) {
        console.warn("Failed to load loved dishes", err);
        window.lovedDishesSet = new Set();
      }

      const { data: managerRecord, error: managerError } = await supabaseClient
        .from("restaurant_managers")
        .select("id")
        .eq("user_id", user.id)
        .eq("restaurant_id", restaurant.id)
        .maybeSingle();
      if (managerError) {
        console.error("Manager lookup failed", managerError);
      }
      console.log("Manager row:", managerRecord, "error:", managerError);

      if (userRole === "manager" && !isOwner && !managerRecord) {
        window.location.href = "restaurants.html";
        return;
      }

      // Admin always has manager access to all restaurants
      // Regular managers need to be in restaurant_managers table
      // TEMPORARY: Make everyone a manager for Falafel Café
      canEdit =
        isOwner || !!managerRecord || restaurant.name === "Falafel Café";

      // Fetch ALL restaurants the manager has access to (for navigation)
      if (isOwner) {
        // Owner sees all restaurants in nav - fetch all
        const { data: allRestaurants } = await supabaseClient
          .from("restaurants")
          .select("id, slug, name")
          .order("name");
        if (allRestaurants) {
          allRestaurants.forEach((r) =>
            managerRestaurantsList.push({
              id: r.id,
              slug: r.slug,
              name: r.name || "Restaurant",
            }),
          );
        }
      } else if (userRole === "manager") {
        // Fetch all restaurants this manager has access to
        const { data: allAssignments } = await supabaseClient
          .from("restaurant_managers")
          .select("restaurant_id")
          .eq("user_id", user.id);
        if (allAssignments && allAssignments.length > 0) {
          const restaurantIds = allAssignments
            .map((a) => a.restaurant_id)
            .filter(Boolean);
          const { data: managerRestaurants } = await supabaseClient
            .from("restaurants")
            .select("id, slug, name")
            .in("id", restaurantIds)
            .order("name");
          if (managerRestaurants) {
            managerRestaurants.forEach((r) =>
              managerRestaurantsList.push({
                id: r.id,
                slug: r.slug,
                name: r.name || "Restaurant",
              }),
            );
          }
        }
      }
    }

    // Send data to the embedded page script
    // Check if editor mode should be activated via URL parameter
    let initialPage = "restaurant";
    const wantsEditorMode = window.__startInEditor && canEdit;

    // If trying to enter editor mode, check/acquire the lock first
    if (wantsEditorMode && user) {
      const lockResult = await EditorLock.acquire(
        restaurant.id,
        user.email,
        user.user_metadata?.first_name || null,
      );

      if (lockResult.success) {
        initialPage = "editor";
      } else if (lockResult.locked) {
        // Show the lock modal (with different message if same user in another tab)
        showEditorLockModal(
          lockResult.lockedBy,
          lockResult.lockedAt,
          lockResult.sameUser,
        );
        initialPage = "restaurant";
        // Clear the flag so inner script doesn't try to override
        window.__startInEditor = false;
        // User can still view, just not edit
      } else {
        // Some other error - log it but allow viewing
        console.error("Could not acquire editor lock:", lockResult.error);
        initialPage = "restaurant";
        window.__startInEditor = false;
      }
    } else if (wantsEditorMode) {
      // No user but wants editor - shouldn't happen but fall back
      initialPage = "restaurant";
    }

    const bootPayload = {
      page: initialPage,
      restaurant,
      user: user
        ? {
            loggedIn: true,
            email: user.email,
            id: user.id,
            name: user.user_metadata?.first_name || null,
            role: user.user_metadata?.role || null,
            managerRestaurants: managerRestaurantsList,
          }
        : { loggedIn: false },
      allergies: allergies,
      diets: diets,
      canEdit: canEdit,
      canEditSource: canEdit ? "manager-row" : "none",
      qr: isQrVisit,
      isHowItWorks: false,
    };
    window.__restaurantBootPayload = bootPayload;
    window.postMessage(bootPayload, "*");
  }

  loadRestaurant();
}

async function loadTrainingRestaurant(managerRestaurantsList) {
  let allergies = [];
  let diets = [];
  let userPayload = { loggedIn: false };

  try {
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
    if (user) {
      userPayload = {
        loggedIn: true,
        email: user.email,
        id: user.id,
        name: user.user_metadata?.first_name || null,
        role: user.user_metadata?.role || null,
        managerRestaurants: managerRestaurantsList,
      };

      const { data: record } = await supabaseClient
        .from("user_allergies")
        .select("allergens, diets")
        .eq("user_id", user.id)
        .maybeSingle();
      allergies = record?.allergens || [];
      diets = record?.diets || [];
    }
  } catch (error) {
    console.warn("Training restaurant: failed to load user profile", error);
  }

  window.lovedDishesSet = new Set();

  const restaurantClone = JSON.parse(JSON.stringify(HOW_IT_WORKS_RESTAURANT));
  const bootPayload = {
    page: "restaurant",
    restaurant: restaurantClone,
    user: userPayload,
    allergies,
    diets,
    canEdit: false,
    canEditSource: "tour",
    qr: isQrVisit,
    isHowItWorks: true,
  };
  window.__restaurantBootPayload = bootPayload;
  window.postMessage(bootPayload, "*");
}
