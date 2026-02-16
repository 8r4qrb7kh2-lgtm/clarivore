import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { isOwnerUser } from "../../../lib/managerRestaurants";

export const PENDING_SAVE_BATCH_TABLE = "public.editor_pending_save_batches_v2";
export const PENDING_SAVE_ROW_TABLE = "public.editor_pending_save_rows_v2";

const globalForPrisma = globalThis;
export const prisma = globalForPrisma.__clarivorePrisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__clarivorePrisma = prisma;
}

export function asText(value) {
  return String(value || "").trim();
}

export function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeStringList(values) {
  const seen = new Set();
  const output = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = asText(value);
    const token = normalizeToken(text);
    if (!token || seen.has(token)) return;
    seen.add(token);
    output.push(text);
  });
  return output.sort((left, right) => left.localeCompare(right));
}

export function toDishKey(value) {
  const text = asText(value);
  return normalizeToken(text) || text;
}

export function readOverlayDishName(overlay) {
  return asText(overlay?.id || overlay?.name || overlay?.dishName);
}

export function readOverlayIngredients(overlay) {
  return Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];
}

export function normalizeIngredientRow(row, index) {
  return {
    rowIndex: Number.isFinite(Number(row?.rowIndex))
      ? Math.max(Math.floor(Number(row.rowIndex)), 0)
      : index,
    name: asText(row?.name) || `Ingredient ${index + 1}`,
    allergens: normalizeStringList(row?.allergens),
    crossContaminationAllergens: normalizeStringList(row?.crossContaminationAllergens),
    diets: normalizeStringList(row?.diets),
    crossContaminationDiets: normalizeStringList(row?.crossContaminationDiets),
    removable: Boolean(row?.removable),
  };
}

export function getStateHashForSave({ overlays, menuImages }) {
  const safeOverlays = Array.isArray(overlays) ? overlays : [];
  const safeMenuImages = Array.isArray(menuImages) ? menuImages.filter(Boolean) : [];
  return JSON.stringify({ overlays: safeOverlays, menuImages: safeMenuImages });
}

export function toJsonSafe(value, fallback) {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

export async function ensurePendingSaveTables(client = prisma) {
  if (!client || typeof client.$executeRawUnsafe !== "function") return;

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${PENDING_SAVE_BATCH_TABLE} (
      id uuid PRIMARY KEY,
      restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
      created_by uuid NOT NULL,
      author text,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'discarded')),
      state_hash text,
      staged_overlays jsonb NOT NULL DEFAULT '[]'::jsonb,
      staged_menu_image text,
      staged_menu_images jsonb NOT NULL DEFAULT '[]'::jsonb,
      change_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      row_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      applied_at timestamptz
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS editor_pending_save_batches_v2_restaurant_idx
    ON ${PENDING_SAVE_BATCH_TABLE} (restaurant_id, created_at DESC)
  `);

  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS editor_pending_save_batches_v2_status_idx
    ON ${PENDING_SAVE_BATCH_TABLE} (status, created_at DESC)
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${PENDING_SAVE_ROW_TABLE} (
      id uuid PRIMARY KEY,
      batch_id uuid NOT NULL REFERENCES ${PENDING_SAVE_BATCH_TABLE}(id) ON DELETE CASCADE,
      sort_order integer NOT NULL DEFAULT 0,
      dish_name text,
      row_index integer,
      ingredient_name text,
      change_type text NOT NULL,
      field_key text,
      before_value jsonb,
      after_value jsonb,
      summary text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS editor_pending_save_rows_v2_batch_idx
    ON ${PENDING_SAVE_ROW_TABLE} (batch_id, sort_order, created_at)
  `);
}

export async function requireManagerSession(request, restaurantId) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  if (!token) {
    throw new Error("Missing authorization token");
  }

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authKey = serviceRoleKey || anonKey;

  if (!supabaseUrl || !authKey) {
    throw new Error("Supabase server credentials missing");
  }

  const supabase = createClient(supabaseUrl, authKey, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    throw new Error("Invalid user session");
  }

  if (isOwnerUser(userData.user)) {
    return {
      userId: userData.user.id,
      userEmail: asText(userData.user.email),
    };
  }

  const manager = await prisma.restaurant_managers.findFirst({
    where: {
      user_id: userData.user.id,
      restaurant_id: restaurantId,
    },
  });

  if (!manager) {
    throw new Error("Not authorized");
  }

  return {
    userId: userData.user.id,
    userEmail: asText(userData.user.email),
  };
}
