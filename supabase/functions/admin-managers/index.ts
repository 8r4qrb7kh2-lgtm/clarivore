import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function jsonResponse(payload: unknown, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function buildDisplayName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  raw_user_meta_data?: Record<string, unknown> | null;
} | null) {
  if (!user) return "";
  const meta = (user.user_metadata || {}) as Record<string, string>;
  const rawMeta = (user.raw_user_meta_data || {}) as Record<string, string>;
  const first = (meta.first_name || rawMeta.first_name || "").trim();
  const last = (meta.last_name || rawMeta.last_name || "").trim();
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  const name =
    (meta.full_name || rawMeta.full_name || meta.name || rawMeta.name || meta.display_name || rawMeta.display_name || "")
      .trim();
  if (name) return name;
  const email = user.email || "";
  return email ? email.split("@")[0].replace(/[._]+/g, " ").trim() : "";
}

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return null;
  const authClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await authClient.auth.getUser();
  if (error || !data?.user) return null;
  const { data: adminMembership, error: adminError } = await supabaseAdmin
    .from("app_admins")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (adminError || !adminMembership?.user_id) return null;
  return data.user;
}

async function listManagers() {
  const { data: restaurants, error: restaurantError } = await supabaseAdmin
    .from("restaurants")
    .select("id, name, slug")
    .order("name");
  if (restaurantError) throw restaurantError;

  const { data: links, error: linkError } = await supabaseAdmin
    .from("restaurant_managers")
    .select("restaurant_id, user_id, created_at");
  if (linkError) throw linkError;

  const uniqueUserIds = Array.from(
    new Set((links || []).map((row) => row.user_id).filter(Boolean)),
  );

  const userMap = new Map<string, { email: string | null; name: string }>();
  for (const userId of uniqueUserIds) {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error || !data?.user) {
      userMap.set(userId, { email: null, name: "" });
      continue;
    }
    userMap.set(userId, {
      email: data.user.email || null,
      name: buildDisplayName(data.user),
    });
  }

  const restaurantMap = new Map(
    (restaurants || []).map((r) => [
      r.id,
      { id: r.id, name: r.name, slug: r.slug, managers: [] as Record<string, unknown>[] },
    ]),
  );

  (links || []).forEach((link) => {
    const entry = restaurantMap.get(link.restaurant_id);
    if (!entry) return;
    const userInfo = userMap.get(link.user_id) || { email: null, name: "" };
    entry.managers.push({
      user_id: link.user_id,
      email: userInfo.email,
      name: userInfo.name,
      created_at: link.created_at,
    });
  });

  return Array.from(restaurantMap.values());
}

async function revokeManager(restaurantId: string, userId: string) {
  const { data, error } = await supabaseAdmin.rpc("set_manager_access", {
    p_user_id: userId,
    p_restaurant_id: restaurantId,
    p_enabled: false,
  });
  if (error) throw error;
  if (!data?.success) {
    throw new Error(data?.message || "Failed to update manager access.");
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  const adminUser = await requireAdmin(req);
  if (!adminUser) {
    return jsonResponse({ error: "Unauthorized" }, 403, corsHeaders);
  }

  let payload: { action?: string; restaurantId?: string; userId?: string } = {};
  try {
    payload = await req.json();
  } catch (_) {
    payload = {};
  }

  const action = payload?.action || "list";

  try {
    if (action === "list") {
      const restaurants = await listManagers();
      return jsonResponse({ restaurants }, 200, corsHeaders);
    }

    if (action === "revoke") {
      const restaurantId = payload?.restaurantId;
      const userId = payload?.userId;
      if (!restaurantId || !userId) {
        return jsonResponse({ error: "Missing restaurantId or userId" }, 400, corsHeaders);
      }
      await revokeManager(restaurantId, userId);
      return jsonResponse({ success: true }, 200, corsHeaders);
    }

    return jsonResponse({ error: "Unsupported action" }, 400, corsHeaders);
  } catch (error) {
    console.error("admin-managers error:", error);
    return jsonResponse({ error: error.message || "Request failed" }, 500, corsHeaders);
  }
});
