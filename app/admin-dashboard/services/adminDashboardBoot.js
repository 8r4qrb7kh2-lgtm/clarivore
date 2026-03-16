import { supabaseClient as supabase } from "../../lib/supabase";
import {
  createAdminDashboardBypassUser,
  isAdminDashboardDevBypassEnabled,
} from "./adminDashboardAccess";

export async function prepareAdminDashboardBootPayload() {
  if (isAdminDashboardDevBypassEnabled()) {
    return {
      user: createAdminDashboardBypassUser(),
      isAdmin: true,
    };
  }

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

  const { data: adminMembership, error: adminError } = await supabase
    .from("app_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError) {
    console.error("[admin-dashboard-next] failed to verify admin membership", adminError);
  }

  const isAdmin = Boolean(adminMembership?.user_id);

  return {
    user,
    isAdmin,
  };
}
