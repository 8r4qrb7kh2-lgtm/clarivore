import { isOwnerUser } from "../../lib/managerRestaurants";
import { supabaseClient as supabase } from "../../lib/supabase";

export async function prepareAdminDashboardBootPayload() {
  if (!supabase) {
    return {
      user: null,
      isAdmin: false,
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
    };
  }

  const isAdmin = isOwnerUser(user);

  return {
    user,
    isAdmin,
  };
}
