import { createClient } from "@supabase/supabase-js";
import {
  asText,
  isAppAdminUser,
  prisma,
  requireAuthenticatedSession,
} from "../../restaurant-write/_shared/writeGatewayUtils";

export const runtime = "nodejs";

function json(payload, status = 200) {
  return Response.json(payload, { status });
}

function buildDisplayName(user) {
  if (!user || typeof user !== "object") return "";
  const meta = user.user_metadata || {};
  const rawMeta = user.raw_user_meta_data || {};
  const first = asText(meta.first_name || rawMeta.first_name);
  const last = asText(meta.last_name || rawMeta.last_name);
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;

  const name = asText(
    meta.full_name || rawMeta.full_name || meta.name || rawMeta.name || meta.display_name || rawMeta.display_name,
  );
  if (name) return name;

  const email = asText(user.email);
  if (!email) return "";
  return email.split("@")[0].replace(/[._]+/g, " ").trim();
}

function createSupabaseAdminClient() {
  const supabaseUrl =
    asText(process.env.SUPABASE_URL) || asText(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = asText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

async function listManagers() {
  const [restaurants, links] = await Promise.all([
    prisma.restaurants.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    }),
    prisma.restaurant_managers.findMany({
      select: { restaurant_id: true, user_id: true, created_at: true },
    }),
  ]);

  const uniqueUserIds = Array.from(new Set(links.map((entry) => asText(entry.user_id)).filter(Boolean)));
  const userMap = new Map();
  const supabaseAdmin = createSupabaseAdminClient();

  if (supabaseAdmin) {
    for (const userId of uniqueUserIds) {
      try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (error || !data?.user) {
          userMap.set(userId, { email: null, name: "" });
          continue;
        }

        userMap.set(userId, {
          email: asText(data.user.email) || null,
          name: buildDisplayName(data.user),
        });
      } catch {
        userMap.set(userId, { email: null, name: "" });
      }
    }
  }

  const restaurantMap = new Map(
    restaurants.map((entry) => [
      asText(entry.id),
      {
        id: asText(entry.id),
        name: asText(entry.name),
        slug: asText(entry.slug),
        managers: [],
      },
    ]),
  );

  links.forEach((link) => {
    const restaurantId = asText(link.restaurant_id);
    const userId = asText(link.user_id);
    const target = restaurantMap.get(restaurantId);
    if (!target) return;

    const userInfo = userMap.get(userId) || { email: null, name: "" };
    target.managers.push({
      user_id: userId,
      email: userInfo.email,
      name: userInfo.name,
      created_at: link.created_at,
    });
  });

  return Array.from(restaurantMap.values());
}

async function revokeManager({ restaurantId, userId }) {
  const result = await prisma.restaurant_managers.deleteMany({
    where: {
      restaurant_id: restaurantId,
      user_id: userId,
    },
  });

  if (Number(result?.count || 0) < 1) {
    throw new Error("Manager access not found.");
  }
}

export async function POST(request) {
  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  try {
    const session = await requireAuthenticatedSession(request);
    const isAdmin = await isAppAdminUser(prisma, session.userId);
    if (!isAdmin) {
      return json({ error: "Unauthorized" }, 403);
    }

    const action = asText(payload?.action) || "list";
    if (action === "list") {
      const restaurants = await listManagers();
      return json({ restaurants }, 200);
    }

    if (action === "revoke") {
      const restaurantId = asText(payload?.restaurantId);
      const userId = asText(payload?.userId);
      if (!restaurantId || !userId) {
        return json({ error: "Missing restaurantId or userId" }, 400);
      }

      await revokeManager({ restaurantId, userId });
      return json({ success: true }, 200);
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    const message = asText(error?.message) || "Request failed";
    const status =
      message === "Missing authorization token" || message === "Invalid user session"
        ? 401
        : message === "Unauthorized"
          ? 403
          : message === "Manager access not found."
            ? 404
            : 500;
    return json({ error: message }, status);
  }
}
