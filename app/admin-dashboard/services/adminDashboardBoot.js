import { OWNER_EMAIL, fetchManagerRestaurants } from "../../lib/managerRestaurants";
import { supabaseClient as supabase } from "../../lib/supabase";

export async function prepareAdminDashboardBootPayload() {
  if (!supabase) {
    return {
      user: null,
      isAdmin: false,
      managerRestaurants: [],
      topbarSetupDone: false,
      signOutHandlerBound: false,
    };
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      isAdmin: false,
      managerRestaurants: [],
      topbarSetupDone: false,
      signOutHandlerBound: false,
    };
  }

  const isAdmin = user.email === OWNER_EMAIL;
  const managerRestaurants = isAdmin
    ? await fetchManagerRestaurants(supabase, user)
    : [];

  return {
    user,
    isAdmin,
    managerRestaurants,
    topbarSetupDone: false,
    signOutHandlerBound: false,
  };
}
