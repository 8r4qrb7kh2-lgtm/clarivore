import { loadAllergenDietConfig } from "../../lib/allergenConfig";
import {
  fetchManagerRestaurants,
  isManagerUser,
  isOwnerUser,
} from "../../lib/managerRestaurants";
import { hydrateRestaurantWithTableMenuState } from "../../lib/restaurantMenuStateClient";

// Keep a short "recently viewed" list so returning users can reopen restaurants quickly.
function trackRecentlyViewed(slug) {
  if (!slug) return;
  try {
    const current = JSON.parse(
      localStorage.getItem("recentlyViewedRestaurants") || "[]",
    );
    const filtered = Array.isArray(current)
      ? current.filter((value) => value !== slug)
      : [];
    filtered.unshift(slug);
    localStorage.setItem(
      "recentlyViewedRestaurants",
      JSON.stringify(filtered.slice(0, 10)),
    );
  } catch {
    // Storage failures should never block the page from loading.
  }
}

// Supabase can return several text variants for "no active auth session".
function isMissingSessionError(error) {
  const message = String(error?.message || "");
  if (!message) return false;
  return /auth session missing|session missing|refresh token/i.test(message);
}

// QR flows may stage temporary selections in session storage before sign-in.
function readSessionSavedPreferences(config) {
  const output = { allergies: [], diets: [] };
  if (typeof window === "undefined" || !config) {
    return output;
  }

  try {
    const parsed = JSON.parse(sessionStorage.getItem("qrAllergies") || "[]");
    if (Array.isArray(parsed)) {
      output.allergies = parsed
        .map((value) => config.normalizeAllergen(value))
        .filter(Boolean);
    }
  } catch {
    output.allergies = [];
  }

  try {
    const parsed = JSON.parse(sessionStorage.getItem("qrDiets") || "[]");
    if (Array.isArray(parsed)) {
      output.diets = parsed
        .map((value) => config.normalizeDietLabel(value))
        .filter(Boolean);
    }
  } catch {
    output.diets = [];
  }

  return output;
}

// Build the initial restaurant page payload.
// Data source rule: the restaurant itself is always read from the `restaurants` table.
export async function loadRestaurantBoot({
  slug,
  isQrVisit,
  inviteToken,
  supabaseClient,
}) {
  if (!supabaseClient) {
    throw new Error("Supabase env vars are missing.");
  }

  if (!slug) {
    throw new Error("No restaurant specified.");
  }

  trackRecentlyViewed(slug);

  // Config values (normalizers, labels, emojis) are loaded once for both viewer and editor.
  const config = await loadAllergenDietConfig(supabaseClient);
  const sessionSavedPreferences = readSessionSavedPreferences(config);

  const { data: userData, error: userError } = await supabaseClient.auth.getUser();
  let user = userData?.user || null;
  if (userError) {
    if (isMissingSessionError(userError)) {
      user = null;
    } else {
      throw userError;
    }
  }

  // Primary runtime source: restaurant core fields + table-backed menu state.
  const { data: restaurantBase, error: restaurantError } = await supabaseClient
    .from("restaurants")
    .select(
      "id, slug, name, last_confirmed, created_at, updated_at, menu_url, last_checked, monitor_enabled, total_checks, emails_sent, check_frequency_hours, delivery_url, website, phone, map_location, write_version",
    )
    .eq("slug", slug)
    .single();

  if (restaurantError || !restaurantBase) {
    throw new Error(restaurantError?.message || "Restaurant not found.");
  }
  const restaurant = await hydrateRestaurantWithTableMenuState(
    supabaseClient,
    restaurantBase,
  );

  // Start with session preferences, then override with persisted profile values when available.
  let allergies = sessionSavedPreferences.allergies;
  let diets = sessionSavedPreferences.diets;
  let canEdit = false;
  let managerRestaurants = [];
  let lovedDishNames = [];

  if (user) {
    const isOwner = isOwnerUser(user);
    const isManager = isManagerUser(user);

    const [{ data: allergyRecord }, { data: managerRecord, error: managerError }] =
      await Promise.all([
        supabaseClient
          .from("user_allergies")
          .select("allergens, diets")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabaseClient
          .from("restaurant_managers")
          .select("id")
          .eq("user_id", user.id)
          .eq("restaurant_id", restaurant.id)
          .maybeSingle(),
      ]);

    if (managerError) {
      console.error("[restaurant] manager lookup failed", managerError);
    }

    const dbAllergies = Array.isArray(allergyRecord?.allergens)
      ? allergyRecord.allergens
      : [];
    const dbDiets = Array.isArray(allergyRecord?.diets) ? allergyRecord.diets : [];

    if (dbAllergies.length || dbDiets.length) {
      allergies = dbAllergies;
      diets = dbDiets;
    }

    // Edit access is role-driven only.
    canEdit = isOwner || Boolean(managerRecord);

    if (isManager || isOwner) {
      managerRestaurants = await fetchManagerRestaurants(supabaseClient, user);
    }

    // Managers not assigned to this restaurant are redirected to the restaurant list.
    if (isManager && !isOwner && !managerRecord) {
      return {
        config,
        restaurant,
        user,
        allergies,
        diets,
        canEdit: false,
        managerRestaurants,
        lovedDishNames: [],
        redirect: "/restaurants",
        inviteToken,
      };
    }

    const { data: lovedRows } = await supabaseClient
      .from("user_loved_dishes")
      .select("dish_name")
      .eq("user_id", user.id)
      .eq("restaurant_id", restaurant.id);

    lovedDishNames = Array.isArray(lovedRows)
      ? lovedRows
          .map((row) => String(row?.dish_name || "").trim())
          .filter(Boolean)
      : [];
  }

  return {
    config,
    restaurant,
    user: user
      ? {
          ...user,
          managerRestaurants,
        }
      : { loggedIn: false },
    allergies,
    diets,
    canEdit,
    managerRestaurants,
    lovedDishNames,
    redirect: "",
    inviteToken,
  };
}
