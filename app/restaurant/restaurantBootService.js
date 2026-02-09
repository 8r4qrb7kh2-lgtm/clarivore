import {
  DEFAULT_PUSH_PUBLIC_KEY,
  supabaseAnonKey,
  supabaseUrl,
} from "../lib/supabase";
import { fetchManagerRestaurants, OWNER_EMAIL } from "../lib/managerRestaurants";
import { buildTrainingRestaurantPayload, HOW_IT_WORKS_SLUG } from "./boot/trainingRestaurant";
import { applyConsoleReportingPreference, applyModeFlags, attachInviteBanner, trackRecentlyViewed } from "./boot/pageFlags";
import { createEditorLock, hideEditorLockModal, showEditorLockModal } from "./boot/editorLock";

export function initRestaurantBootGlobals(supabaseClient) {
  window.supabaseClient = supabaseClient;
  window.SUPABASE_URL = supabaseUrl;
  window.SUPABASE_KEY = supabaseAnonKey;
  window.CLARIVORE_PUSH_PUBLIC_KEY = DEFAULT_PUSH_PUBLIC_KEY;
  window.showEditorLockModal = showEditorLockModal;
  window.hideEditorLockModal = hideEditorLockModal;
}

export { applyConsoleReportingPreference };

export async function buildRestaurantBootPayload({
  supabaseClient,
  slug,
  isQrVisit,
  inviteToken,
}) {
  attachInviteBanner(inviteToken);
  trackRecentlyViewed(slug);

  const urlParams = new URLSearchParams(window.location.search);
  applyModeFlags({
    editParam: urlParams.get("edit") || urlParams.get("mode"),
    isQrVisit,
    openLogParam: urlParams.get("openLog"),
    openConfirmParam: urlParams.get("openConfirm"),
  });

  const lock = createEditorLock({
    supabaseClient,
    supabaseUrl,
    supabaseAnonKey,
  });

  const refreshButton = document.getElementById("editorLockRefresh");
  if (refreshButton) {
    refreshButton.onclick = () => window.location.reload();
  }

  window.EditorLock = lock;

  if (slug === HOW_IT_WORKS_SLUG) {
    const managerRestaurants = [];
    const payload = await buildTrainingRestaurantPayload({
      supabaseClient,
      isQrVisit,
      managerRestaurants,
    });
    return { payload, lock };
  }

  const { data: restaurant, error: restaurantError } = await supabaseClient
    .from("restaurants")
    .select("*")
    .eq("slug", slug)
    .single();

  if (restaurantError || !restaurant) {
    return {
      payload: null,
      error: restaurantError?.message || "Restaurant not found",
      lock,
    };
  }

  const {
    data: { user },
  } = await supabaseClient.auth.getUser();

  let allergies = [];
  let diets = [];
  let canEdit = false;
  let managerRestaurants = [];

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

    try {
      const { data: lovedData } = await supabaseClient
        .from("user_loved_dishes")
        .select("restaurant_id, dish_name")
        .eq("user_id", user.id);
      window.lovedDishesSet = new Set(
        (lovedData || []).map(
          (entry) => `${String(entry.restaurant_id)}:${entry.dish_name}`,
        ),
      );
    } catch (error) {
      console.warn("Failed to load loved dishes", error);
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

    if (userRole === "manager" && !isOwner && !managerRecord) {
      return { payload: null, redirect: "/restaurants", lock };
    }

    canEdit = isOwner || Boolean(managerRecord) || restaurant.name === "Falafel Café";
    managerRestaurants = await fetchManagerRestaurants(supabaseClient, user);
  } else {
    window.lovedDishesSet = new Set();
  }

  let initialPage = "restaurant";
  const wantsEditorMode = window.__startInEditor && canEdit;

  if (wantsEditorMode && user) {
    const lockResult = await lock.acquire(
      restaurant.id,
      user.email,
      user.user_metadata?.first_name || null,
    );

    if (lockResult.success) {
      initialPage = "editor";
    } else if (lockResult.locked) {
      showEditorLockModal({
        lockedBy: lockResult.lockedBy,
        lockedAt: lockResult.lockedAt,
        sameUser: lockResult.sameUser,
      });
      initialPage = "restaurant";
      window.__startInEditor = false;
    } else {
      console.error("Could not acquire editor lock", lockResult.error);
      initialPage = "restaurant";
      window.__startInEditor = false;
    }
  }

  const payload = {
    page: initialPage,
    restaurant,
    user: user
      ? {
          loggedIn: true,
          email: user.email,
          id: user.id,
          name: user.user_metadata?.first_name || null,
          role: user.user_metadata?.role || null,
          managerRestaurants,
        }
      : { loggedIn: false },
    allergies,
    diets,
    canEdit,
    canEditSource: canEdit ? "manager-row" : "none",
    qr: isQrVisit,
    isHowItWorks: false,
  };

  return { payload, lock };
}
