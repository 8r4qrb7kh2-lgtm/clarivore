import { OWNER_EMAIL, fetchManagerRestaurants } from "../../lib/managerRestaurants";
import { supabaseClient as supabase } from "../../lib/supabase";

export async function prepareManagerDashboardBootPayload() {
  if (!supabase) {
    return {
      user: null,
      isOwner: false,
      isManager: false,
      managerRestaurants: [],
      managedRestaurants: [],
    };
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return {
      user: null,
      isOwner: false,
      isManager: false,
      managerRestaurants: [],
      managedRestaurants: [],
    };
  }

  const isOwner = user.email === OWNER_EMAIL;
  const isManager = user.user_metadata?.role === "manager";
  const managerRestaurants =
    isOwner || isManager ? await fetchManagerRestaurants(supabase, user) : [];

  return {
    user,
    isOwner,
    isManager,
    managerRestaurants,
    managedRestaurants: managerRestaurants,
  };
}

