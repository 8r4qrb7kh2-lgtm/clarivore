import { resolveManagerRestaurantAccess } from "../../lib/managerRestaurants";
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

  const access = await resolveManagerRestaurantAccess(supabase, user);

  return {
    user,
    isOwner: access.isOwner,
    isManager: access.isManager,
    managerRestaurants: access.managerRestaurants,
    managedRestaurants: access.managerRestaurants,
  };
}
