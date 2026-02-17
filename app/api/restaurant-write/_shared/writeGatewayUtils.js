import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { isOwnerUser } from "../../../lib/managerRestaurants";
import {
  asText,
  getStateHashForSave,
  normalizeIngredientRow,
  normalizeStringList,
  normalizeToken,
  prisma,
  readOverlayDishName,
  readOverlayIngredients,
  toDishKey,
  toJsonSafe,
} from "../../editor-pending-save/_shared/pendingSaveUtils";

export { asText, prisma };

export const RESTAURANT_WRITE_BATCH_TABLE = "public.restaurant_write_batches";
export const RESTAURANT_WRITE_OP_TABLE = "public.restaurant_write_ops";

export const WRITE_SCOPE_TYPES = {
  RESTAURANT: "RESTAURANT",
  ADMIN_GLOBAL: "ADMIN_GLOBAL",
};

export const RESTAURANT_WRITE_OPERATION_TYPES = {
  MENU_STATE_REPLACE: "MENU_STATE_REPLACE",
  RESTAURANT_SETTINGS_UPDATE: "RESTAURANT_SETTINGS_UPDATE",
  CONFIRM_INFO: "CONFIRM_INFO",
  BRAND_REPLACEMENT: "BRAND_REPLACEMENT",
  RESTAURANT_CREATE: "RESTAURANT_CREATE",
  RESTAURANT_DELETE: "RESTAURANT_DELETE",
};

const RESTAURANT_SCOPED_OPS = new Set([
  RESTAURANT_WRITE_OPERATION_TYPES.MENU_STATE_REPLACE,
  RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_SETTINGS_UPDATE,
  RESTAURANT_WRITE_OPERATION_TYPES.CONFIRM_INFO,
  RESTAURANT_WRITE_OPERATION_TYPES.BRAND_REPLACEMENT,
  RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_DELETE,
]);

const OWNER_ONLY_OPS = new Set([
  RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_CREATE,
  RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_DELETE,
]);

const ALL_OPERATION_TYPES = new Set(Object.values(RESTAURANT_WRITE_OPERATION_TYPES));

function parseBearerToken(request) {
  const authHeader = request.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
}

function parseJsonValue(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function parseJsonArray(value, fallback = []) {
  const parsed = parseJsonValue(value, fallback);
  return Array.isArray(parsed) ? parsed : fallback;
}

function toSafeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.floor(numeric);
}

function toSafeVersion(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(Math.floor(numeric), 0);
}

function slugifyName(value) {
  return asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeScopeType(value) {
  const token = asText(value).toUpperCase();
  if (token === WRITE_SCOPE_TYPES.RESTAURANT) return WRITE_SCOPE_TYPES.RESTAURANT;
  if (token === WRITE_SCOPE_TYPES.ADMIN_GLOBAL) return WRITE_SCOPE_TYPES.ADMIN_GLOBAL;
  return "";
}

function normalizeOperationType(value) {
  const token = asText(value).toUpperCase();
  if (!token || !ALL_OPERATION_TYPES.has(token)) return "";
  return token;
}

function resolveScopeKey(scopeType, restaurantId) {
  if (scopeType === WRITE_SCOPE_TYPES.RESTAURANT) {
    return asText(restaurantId);
  }
  if (scopeType === WRITE_SCOPE_TYPES.ADMIN_GLOBAL) {
    return "admin-global";
  }
  return "";
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildDishRowMap(overlays) {
  const dishMap = new Map();
  (Array.isArray(overlays) ? overlays : []).forEach((overlay) => {
    const dishName = readOverlayDishName(overlay);
    if (!dishName) return;

    const dishKey = toDishKey(dishName);
    const normalizedRows = readOverlayIngredients(overlay).map((row, index) =>
      normalizeIngredientRow(row, index),
    );

    const rowMap = new Map();
    normalizedRows.forEach((row, index) => {
      const safeIndex = Number.isFinite(Number(row.rowIndex))
        ? Math.max(Math.floor(Number(row.rowIndex)), 0)
        : index;
      rowMap.set(safeIndex, { ...row, rowIndex: safeIndex });
    });

    dishMap.set(dishKey, {
      dishName,
      rowMap,
      rowCount: normalizedRows.length,
    });
  });
  return dishMap;
}

function buildMenuChangeRows({ baselineOverlays, overlays }) {
  const baselineDishMap = buildDishRowMap(baselineOverlays);
  const currentDishMap = buildDishRowMap(overlays);
  const allDishKeys = Array.from(
    new Set([...baselineDishMap.keys(), ...currentDishMap.keys()]),
  );

  const output = [];

  allDishKeys.forEach((dishKey) => {
    const baselineDish = baselineDishMap.get(dishKey) || {
      dishName: "Dish",
      rowMap: new Map(),
      rowCount: 0,
    };
    const currentDish = currentDishMap.get(dishKey) || {
      dishName: baselineDish.dishName,
      rowMap: new Map(),
      rowCount: 0,
    };

    const dishName = asText(currentDish.dishName || baselineDish.dishName) || "Dish";
    const maxRows = Math.max(baselineDish.rowCount, currentDish.rowCount);

    for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
      const beforeRow = baselineDish.rowMap.get(rowIndex) || null;
      const afterRow = currentDish.rowMap.get(rowIndex) || null;

      if (!beforeRow && !afterRow) continue;

      if (!beforeRow && afterRow) {
        output.push({
          dishName,
          rowIndex,
          ingredientName: asText(afterRow.name) || `Ingredient ${rowIndex + 1}`,
          changeType: "ingredient_row_added",
          fieldKey: "ingredient_row",
          beforeValue: null,
          afterValue: afterRow,
          summary: `${dishName}: Added ingredient row ${asText(afterRow.name) || `Ingredient ${rowIndex + 1}`}`,
        });
        continue;
      }

      if (beforeRow && !afterRow) {
        output.push({
          dishName,
          rowIndex,
          ingredientName: asText(beforeRow.name) || `Ingredient ${rowIndex + 1}`,
          changeType: "ingredient_row_removed",
          fieldKey: "ingredient_row",
          beforeValue: beforeRow,
          afterValue: null,
          summary: `${dishName}: Removed ingredient row ${asText(beforeRow.name) || `Ingredient ${rowIndex + 1}`}`,
        });
        continue;
      }

      const ingredientName =
        asText(afterRow?.name) || asText(beforeRow?.name) || `Ingredient ${rowIndex + 1}`;

      const fieldComparisons = [
        {
          fieldKey: "name",
          changeType: "ingredient_name_changed",
          beforeValue: asText(beforeRow?.name),
          afterValue: asText(afterRow?.name),
          summary: `${dishName}: ${ingredientName}: Ingredient row name updated`,
        },
        {
          fieldKey: "allergens",
          changeType: "ingredient_allergens_changed",
          beforeValue: normalizeStringList(beforeRow?.allergens),
          afterValue: normalizeStringList(afterRow?.allergens),
          summary: `${dishName}: ${ingredientName}: Contains allergen selection updated`,
        },
        {
          fieldKey: "cross_contamination_allergens",
          changeType: "ingredient_cross_allergens_changed",
          beforeValue: normalizeStringList(beforeRow?.crossContaminationAllergens),
          afterValue: normalizeStringList(afterRow?.crossContaminationAllergens),
          summary: `${dishName}: ${ingredientName}: Cross-contamination allergen selection updated`,
        },
        {
          fieldKey: "diets",
          changeType: "ingredient_diets_changed",
          beforeValue: normalizeStringList(beforeRow?.diets),
          afterValue: normalizeStringList(afterRow?.diets),
          summary: `${dishName}: ${ingredientName}: Diet compatibility updated`,
        },
        {
          fieldKey: "cross_contamination_diets",
          changeType: "ingredient_cross_diets_changed",
          beforeValue: normalizeStringList(beforeRow?.crossContaminationDiets),
          afterValue: normalizeStringList(afterRow?.crossContaminationDiets),
          summary: `${dishName}: ${ingredientName}: Cross-contamination diet risk updated`,
        },
        {
          fieldKey: "removable",
          changeType: "ingredient_removable_changed",
          beforeValue: Boolean(beforeRow?.removable),
          afterValue: Boolean(afterRow?.removable),
          summary: `${dishName}: ${ingredientName}: Removable flag updated`,
        },
      ];

      fieldComparisons.forEach((entry) => {
        if (valuesEqual(entry.beforeValue, entry.afterValue)) return;
        output.push({
          dishName,
          rowIndex,
          ingredientName,
          changeType: entry.changeType,
          fieldKey: entry.fieldKey,
          beforeValue: entry.beforeValue,
          afterValue: entry.afterValue,
          summary: entry.summary,
        });
      });
    }
  });

  return output;
}

function buildIngredientRowsFromOverlays(overlays) {
  const output = [];

  (Array.isArray(overlays) ? overlays : []).forEach((overlay) => {
    const dishName = readOverlayDishName(overlay);
    if (!dishName) return;

    const ingredients = readOverlayIngredients(overlay).map((row, index) =>
      normalizeIngredientRow(row, index),
    );

    ingredients.forEach((ingredient, index) => {
      output.push({
        dishName,
        rowIndex: index,
        rowText: asText(ingredient.name) || `Ingredient ${index + 1}`,
        removable: Boolean(ingredient.removable),
        allergens: Array.isArray(ingredient.allergens) ? ingredient.allergens : [],
        crossContaminationAllergens: Array.isArray(ingredient.crossContaminationAllergens)
          ? ingredient.crossContaminationAllergens
          : [],
        diets: Array.isArray(ingredient.diets) ? ingredient.diets : [],
        crossContaminationDiets: Array.isArray(ingredient.crossContaminationDiets)
          ? ingredient.crossContaminationDiets
          : [],
      });
    });
  });

  return output;
}

function buildTokenMap(items, labelSelector) {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const label = asText(labelSelector(item));
    const token = normalizeToken(label);
    if (!token) return;
    map.set(token, item.id);
  });
  return map;
}

export async function ensureRestaurantWriteInfrastructure(client = prisma) {
  if (!client || typeof client.$executeRawUnsafe !== "function") return;

  await client.$executeRawUnsafe(`
    ALTER TABLE public.restaurants
    ADD COLUMN IF NOT EXISTS write_version bigint NOT NULL DEFAULT 0
  `);

  await client.$executeRawUnsafe(`
    UPDATE public.restaurants
    SET write_version = 0
    WHERE write_version IS NULL
  `);

  await client.$executeRawUnsafe(`
    ALTER TABLE public.restaurants
    ALTER COLUMN write_version SET DEFAULT 0
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${RESTAURANT_WRITE_BATCH_TABLE} (
      id uuid PRIMARY KEY,
      scope_type text NOT NULL,
      scope_key text NOT NULL,
      restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
      created_by uuid NOT NULL,
      author text,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'discarded', 'failed')),
      base_write_version bigint,
      review_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      applied_at timestamptz,
      discarded_at timestamptz
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS restaurant_write_batches_scope_idx
    ON ${RESTAURANT_WRITE_BATCH_TABLE} (scope_type, scope_key, created_by, created_at DESC)
  `);

  await client.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS restaurant_write_batches_pending_scope_idx
    ON ${RESTAURANT_WRITE_BATCH_TABLE} (scope_type, scope_key, created_by)
    WHERE status = 'pending'
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${RESTAURANT_WRITE_OP_TABLE} (
      id uuid PRIMARY KEY,
      batch_id uuid NOT NULL REFERENCES ${RESTAURANT_WRITE_BATCH_TABLE}(id) ON DELETE CASCADE,
      sort_order integer NOT NULL DEFAULT 0,
      operation_type text NOT NULL,
      operation_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      summary text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (batch_id, operation_type)
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS restaurant_write_ops_batch_idx
    ON ${RESTAURANT_WRITE_OP_TABLE} (batch_id, sort_order, created_at)
  `);

  await client.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'set_updated_at'
          AND n.nspname = 'public'
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'set_restaurant_write_batches_updated_at'
        ) THEN
          CREATE TRIGGER set_restaurant_write_batches_updated_at
          BEFORE UPDATE ON ${RESTAURANT_WRITE_BATCH_TABLE}
          FOR EACH ROW
          EXECUTE FUNCTION public.set_updated_at();
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'set_restaurant_write_ops_updated_at'
        ) THEN
          CREATE TRIGGER set_restaurant_write_ops_updated_at
          BEFORE UPDATE ON ${RESTAURANT_WRITE_OP_TABLE}
          FOR EACH ROW
          EXECUTE FUNCTION public.set_updated_at();
        END IF;
      END IF;
    END $$;
  `);

  await client.$executeRawUnsafe(`
    ALTER TABLE ${RESTAURANT_WRITE_BATCH_TABLE}
    ENABLE ROW LEVEL SECURITY
  `);
  await client.$executeRawUnsafe(`
    ALTER TABLE ${RESTAURANT_WRITE_OP_TABLE}
    ENABLE ROW LEVEL SECURITY
  `);
}

function getSupabaseAuthClient() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authKey = serviceRoleKey || anonKey;

  if (!supabaseUrl || !authKey) {
    throw new Error("Supabase server credentials missing");
  }

  return createClient(supabaseUrl, authKey, {
    auth: { persistSession: false },
  });
}

export async function requireAuthenticatedSession(request) {
  const token = parseBearerToken(request);
  if (!token) {
    throw new Error("Missing authorization token");
  }

  const supabase = getSupabaseAuthClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    throw new Error("Invalid user session");
  }

  return {
    userId: userData.user.id,
    userEmail: asText(userData.user.email),
    user: userData.user,
  };
}

export async function requireOwnerSession(request) {
  const session = await requireAuthenticatedSession(request);
  if (!isOwnerUser(session.user)) {
    throw new Error("Owner access required");
  }
  return session;
}

export async function requireRestaurantAccessSession(request, restaurantId) {
  const safeRestaurantId = asText(restaurantId);
  if (!safeRestaurantId) {
    throw new Error("restaurantId is required");
  }

  const session = await requireAuthenticatedSession(request);
  if (isOwnerUser(session.user)) {
    return {
      ...session,
      isOwner: true,
    };
  }

  const manager = await prisma.restaurant_managers.findFirst({
    where: {
      user_id: session.userId,
      restaurant_id: safeRestaurantId,
    },
  });

  if (!manager) {
    throw new Error("Not authorized");
  }

  return {
    ...session,
    isOwner: false,
  };
}

export async function getRestaurantWriteVersion(
  client,
  restaurantId,
  { lock = false } = {},
) {
  const safeRestaurantId = asText(restaurantId);
  if (!safeRestaurantId) {
    throw new Error("restaurantId is required");
  }

  const rows = await client.$queryRawUnsafe(
    `
    SELECT id, COALESCE(write_version, 0) AS write_version
    FROM public.restaurants
    WHERE id = $1::uuid
    ${lock ? "FOR UPDATE" : ""}
    LIMIT 1
  `,
    safeRestaurantId,
  );

  const row = rows?.[0] || null;
  if (!row?.id) {
    throw new Error("Restaurant not found");
  }

  return {
    id: asText(row.id),
    writeVersion: toSafeVersion(row.write_version, 0),
  };
}

function normalizeMenuStatePayload(operationPayload) {
  const overlays = Array.isArray(operationPayload?.overlays) ? operationPayload.overlays : [];
  const baselineOverlays = Array.isArray(operationPayload?.baselineOverlays)
    ? operationPayload.baselineOverlays
    : [];
  const menuImages = (Array.isArray(operationPayload?.menuImages)
    ? operationPayload.menuImages
    : []
  )
    .map((value) => asText(value))
    .filter(Boolean);
  const menuImage = asText(operationPayload?.menuImage) || menuImages[0] || "";
  if (!menuImages.length && menuImage) {
    menuImages.push(menuImage);
  }

  const stateHash =
    asText(operationPayload?.stateHash) ||
    getStateHashForSave({
      overlays,
      menuImages,
    });

  const changePayload = toJsonSafe(operationPayload?.changePayload, {});
  const rows = buildMenuChangeRows({ baselineOverlays, overlays });

  return {
    overlays: toJsonSafe(overlays, []),
    baselineOverlays: toJsonSafe(baselineOverlays, []),
    menuImage,
    menuImages,
    stateHash,
    changePayload,
    rows: rows.map((row, index) => ({
      id: `row:${index}`,
      sortOrder: index,
      dishName: row.dishName,
      rowIndex: row.rowIndex,
      ingredientName: row.ingredientName,
      changeType: row.changeType,
      fieldKey: row.fieldKey,
      beforeValue: row.beforeValue,
      afterValue: row.afterValue,
      summary: row.summary,
    })),
    rowCount: rows.length,
  };
}

function normalizeRestaurantSettingsPayload(operationPayload) {
  return {
    website: asText(operationPayload?.website) || null,
    phone: asText(operationPayload?.phone) || null,
    delivery_url: asText(operationPayload?.delivery_url) || null,
    menu_url: asText(operationPayload?.menu_url) || null,
    changePayload: toJsonSafe(operationPayload?.changePayload, {}),
  };
}

function normalizeConfirmInfoPayload(operationPayload) {
  const confirmedAt = asText(operationPayload?.confirmedAt) || new Date().toISOString();
  return {
    confirmedAt,
    photos: (Array.isArray(operationPayload?.photos) ? operationPayload.photos : [])
      .map((value) => asText(value))
      .filter(Boolean),
    changePayload: toJsonSafe(operationPayload?.changePayload, {}),
  };
}

function normalizeBrandReplacementPayload(operationPayload) {
  const overlays = Array.isArray(operationPayload?.overlays) ? operationPayload.overlays : [];
  const menuImages = (Array.isArray(operationPayload?.menuImages)
    ? operationPayload.menuImages
    : []
  )
    .map((value) => asText(value))
    .filter(Boolean);
  const menuImage = asText(operationPayload?.menuImage) || menuImages[0] || "";
  if (!menuImages.length && menuImage) {
    menuImages.push(menuImage);
  }

  return {
    overlays: toJsonSafe(overlays, []),
    menuImage,
    menuImages,
    changePayload: toJsonSafe(operationPayload?.changePayload, {}),
  };
}

function normalizeRestaurantCreatePayload(operationPayload) {
  const name = asText(operationPayload?.name);
  const slug = asText(operationPayload?.slug) || slugifyName(name);
  const menuImage = asText(operationPayload?.menuImage || operationPayload?.menu_image);
  const menuImages = (Array.isArray(operationPayload?.menuImages)
    ? operationPayload.menuImages
    : []
  )
    .map((value) => asText(value))
    .filter(Boolean);
  if (!menuImages.length && menuImage) {
    menuImages.push(menuImage);
  }

  return {
    name,
    slug,
    menuImage,
    menuImages,
    overlays: toJsonSafe(
      Array.isArray(operationPayload?.overlays) ? operationPayload.overlays : [],
      [],
    ),
    website: asText(operationPayload?.website) || null,
    phone: asText(operationPayload?.phone) || null,
    delivery_url: asText(operationPayload?.delivery_url) || null,
    menu_url: asText(operationPayload?.menu_url) || null,
  };
}

function normalizeRestaurantDeletePayload(operationPayload, restaurantId) {
  return {
    restaurantId: asText(operationPayload?.restaurantId) || asText(restaurantId),
  };
}

export function normalizeOperationPayload({
  operationType,
  operationPayload,
  restaurantId,
}) {
  switch (operationType) {
    case RESTAURANT_WRITE_OPERATION_TYPES.MENU_STATE_REPLACE:
      return normalizeMenuStatePayload(operationPayload);
    case RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_SETTINGS_UPDATE:
      return normalizeRestaurantSettingsPayload(operationPayload);
    case RESTAURANT_WRITE_OPERATION_TYPES.CONFIRM_INFO:
      return normalizeConfirmInfoPayload(operationPayload);
    case RESTAURANT_WRITE_OPERATION_TYPES.BRAND_REPLACEMENT:
      return normalizeBrandReplacementPayload(operationPayload);
    case RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_CREATE:
      return normalizeRestaurantCreatePayload(operationPayload);
    case RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_DELETE:
      return normalizeRestaurantDeletePayload(operationPayload, restaurantId);
    default:
      return toJsonSafe(operationPayload, {});
  }
}

export function validateWriteStageRequest(body) {
  const scopeType = normalizeScopeType(body?.scopeType);
  const restaurantId = asText(body?.restaurantId);
  const operationType = normalizeOperationType(body?.operationType);
  const summary = asText(body?.summary) || operationType;
  const sortOrder = toSafeInteger(body?.sortOrder, 0);
  const expectedWriteVersion = Number.isFinite(Number(body?.expectedWriteVersion))
    ? toSafeVersion(body.expectedWriteVersion)
    : null;

  if (!scopeType) {
    throw new Error("scopeType is required");
  }

  if (!operationType) {
    throw new Error("operationType is required");
  }

  if (scopeType === WRITE_SCOPE_TYPES.RESTAURANT && !restaurantId) {
    throw new Error("restaurantId is required for restaurant scope");
  }

  if (RESTAURANT_SCOPED_OPS.has(operationType) && !restaurantId) {
    throw new Error("restaurantId is required for this operation");
  }

  if (
    operationType === RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_CREATE &&
    scopeType !== WRITE_SCOPE_TYPES.ADMIN_GLOBAL
  ) {
    throw new Error("RESTAURANT_CREATE must use ADMIN_GLOBAL scope");
  }

  if (
    operationType === RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_DELETE &&
    scopeType !== WRITE_SCOPE_TYPES.RESTAURANT
  ) {
    throw new Error("RESTAURANT_DELETE must use RESTAURANT scope");
  }

  const scopeKey = resolveScopeKey(scopeType, restaurantId);
  if (!scopeKey) {
    throw new Error("Invalid write scope");
  }

  const normalizedPayload = normalizeOperationPayload({
    operationType,
    operationPayload: body?.operationPayload,
    restaurantId,
  });

  if (operationType === RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_CREATE) {
    if (!asText(normalizedPayload?.name) || !asText(normalizedPayload?.slug)) {
      throw new Error("Restaurant create payload requires name and slug");
    }
  }

  if (operationType === RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_DELETE) {
    if (!asText(normalizedPayload?.restaurantId)) {
      throw new Error("Restaurant delete payload requires restaurantId");
    }
  }

  return {
    scopeType,
    scopeKey,
    restaurantId,
    operationType,
    operationPayload: normalizedPayload,
    summary,
    sortOrder,
    expectedWriteVersion,
  };
}

export async function authorizeWriteStage({
  request,
  operationType,
  restaurantId,
}) {
  if (OWNER_ONLY_OPS.has(operationType)) {
    return await requireOwnerSession(request);
  }

  if (RESTAURANT_SCOPED_OPS.has(operationType)) {
    return await requireRestaurantAccessSession(request, restaurantId);
  }

  return await requireAuthenticatedSession(request);
}

export function buildReviewSummary(batch, operations) {
  const normalizedOps = (Array.isArray(operations) ? operations : []).map((operation) => ({
    id: asText(operation?.id),
    operationType: asText(operation?.operation_type || operation?.operationType),
    summary: asText(operation?.summary),
    sortOrder: toSafeInteger(operation?.sort_order ?? operation?.sortOrder, 0),
    createdAt: operation?.created_at || operation?.createdAt || null,
    payload: parseJsonValue(operation?.operation_payload ?? operation?.operationPayload, {}),
  }));

  const menuOp = normalizedOps.find(
    (operation) =>
      operation.operationType === RESTAURANT_WRITE_OPERATION_TYPES.MENU_STATE_REPLACE,
  );

  const reviewSummary = {
    operationCount: normalizedOps.length,
    operationTypes: normalizedOps.map((operation) => operation.operationType),
    summaries: normalizedOps.map((operation) => operation.summary).filter(Boolean),
    menuRows: Array.isArray(menuOp?.payload?.rows) ? menuOp.payload.rows : [],
    rowCount: Number(menuOp?.payload?.rowCount) || 0,
    stateHash: asText(menuOp?.payload?.stateHash),
    baseWriteVersion: toSafeVersion(
      batch?.base_write_version ?? batch?.baseWriteVersion,
      0,
    ),
  };

  return reviewSummary;
}

export function mapBatchForResponse(batch) {
  if (!batch) return null;
  return {
    id: asText(batch.id),
    scopeType: asText(batch.scope_type),
    scopeKey: asText(batch.scope_key),
    restaurantId: asText(batch.restaurant_id),
    createdBy: asText(batch.created_by),
    author: asText(batch.author),
    status: asText(batch.status),
    baseWriteVersion: toSafeVersion(batch.base_write_version, 0),
    reviewSummary: parseJsonValue(batch.review_summary, {}),
    createdAt: batch.created_at || null,
    updatedAt: batch.updated_at || null,
    appliedAt: batch.applied_at || null,
    discardedAt: batch.discarded_at || null,
  };
}

export function mapOperationsForResponse(operations) {
  return (Array.isArray(operations) ? operations : []).map((operation) => ({
    id: asText(operation.id),
    batchId: asText(operation.batch_id),
    operationType: asText(operation.operation_type),
    summary: asText(operation.summary),
    sortOrder: toSafeInteger(operation.sort_order, 0),
    payload: parseJsonValue(operation.operation_payload, {}),
    createdAt: operation.created_at || null,
    updatedAt: operation.updated_at || null,
  }));
}

export async function loadPendingBatchForScope({
  client = prisma,
  scopeType,
  scopeKey,
  userId,
}) {
  const batchRows = await client.$queryRawUnsafe(
    `
    SELECT *
    FROM ${RESTAURANT_WRITE_BATCH_TABLE}
    WHERE scope_type = $1
      AND scope_key = $2
      AND created_by = $3::uuid
      AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `,
    scopeType,
    scopeKey,
    userId,
  );

  const batch = batchRows?.[0] || null;
  if (!batch) {
    return { batch: null, operations: [] };
  }

  const operations = await client.$queryRawUnsafe(
    `
    SELECT *
    FROM ${RESTAURANT_WRITE_OP_TABLE}
    WHERE batch_id = $1::uuid
    ORDER BY sort_order ASC, created_at ASC
  `,
    batch.id,
  );

  return {
    batch,
    operations: Array.isArray(operations) ? operations : [],
  };
}

export async function syncIngredientStatusFromOverlays(tx, restaurantId, overlays) {
  await tx.dish_ingredient_rows.deleteMany({
    where: {
      restaurant_id: restaurantId,
    },
  });

  const allergenRows = await tx.allergens.findMany({
    where: { is_active: true },
    select: { id: true, key: true },
  });

  const dietRows = await tx.diets.findMany({
    where: { is_active: true, is_supported: true },
    select: { id: true, label: true },
  });

  const allergenIdByToken = buildTokenMap(allergenRows, (item) => item.key);
  const dietIdByToken = buildTokenMap(dietRows, (item) => item.label);
  const supportedDietLabels = dietRows.map((row) => row.label);

  const ingredientRows = buildIngredientRowsFromOverlays(overlays);
  if (ingredientRows.length) {
    await tx.dish_ingredient_rows.createMany({
      data: ingredientRows.map((row) => ({
        restaurant_id: restaurantId,
        dish_name: row.dishName,
        row_index: row.rowIndex,
        row_text: row.rowText || null,
      })),
    });
  }

  const insertedRows = await tx.dish_ingredient_rows.findMany({
    where: { restaurant_id: restaurantId },
    select: { id: true, dish_name: true, row_index: true },
  });

  const ingredientRowIdByDishAndIndex = new Map();
  insertedRows.forEach((row) => {
    ingredientRowIdByDishAndIndex.set(
      `${asText(row.dish_name)}::${Number(row.row_index)}`,
      row.id,
    );
  });

  const allergenEntries = [];
  const dietEntries = [];

  ingredientRows.forEach((row) => {
    const rowId = ingredientRowIdByDishAndIndex.get(
      `${asText(row.dishName)}::${Number(row.rowIndex)}`,
    );
    if (!rowId) return;

    const allergenStatusByToken = new Map();
    (Array.isArray(row.allergens) ? row.allergens : []).forEach((value) => {
      const token = normalizeToken(value);
      if (!token) return;
      allergenStatusByToken.set(token, {
        is_violation: true,
        is_cross_contamination: false,
      });
    });

    (Array.isArray(row.crossContaminationAllergens)
      ? row.crossContaminationAllergens
      : []
    ).forEach((value) => {
      const token = normalizeToken(value);
      if (!token) return;
      const current = allergenStatusByToken.get(token) || {
        is_violation: false,
        is_cross_contamination: false,
      };
      current.is_cross_contamination = true;
      allergenStatusByToken.set(token, current);
    });

    allergenStatusByToken.forEach((status, token) => {
      const allergenId = allergenIdByToken.get(token);
      if (!allergenId) return;
      allergenEntries.push({
        ingredient_row_id: rowId,
        allergen_id: allergenId,
        is_violation: Boolean(status.is_violation),
        is_cross_contamination: Boolean(status.is_cross_contamination),
        is_removable: Boolean(row.removable),
      });
    });

    const compatibleDietTokens = new Set(
      (Array.isArray(row.diets) ? row.diets : []).map((value) => normalizeToken(value)),
    );
    const crossDietTokens = new Set(
      (Array.isArray(row.crossContaminationDiets) ? row.crossContaminationDiets : []).map(
        (value) => normalizeToken(value),
      ),
    );

    supportedDietLabels.forEach((label) => {
      const dietId = dietIdByToken.get(normalizeToken(label));
      if (!dietId) return;

      const labelToken = normalizeToken(label);
      if (crossDietTokens.has(labelToken)) {
        dietEntries.push({
          ingredient_row_id: rowId,
          diet_id: dietId,
          is_violation: false,
          is_cross_contamination: true,
          is_removable: Boolean(row.removable),
        });
        return;
      }

      if (!compatibleDietTokens.has(labelToken)) {
        dietEntries.push({
          ingredient_row_id: rowId,
          diet_id: dietId,
          is_violation: true,
          is_cross_contamination: false,
          is_removable: Boolean(row.removable),
        });
      }
    });
  });

  if (allergenEntries.length) {
    await tx.dish_ingredient_allergens.createMany({ data: allergenEntries });
  }
  if (dietEntries.length) {
    await tx.dish_ingredient_diets.createMany({ data: dietEntries });
  }

  return {
    rows: ingredientRows.length,
    allergens: allergenEntries.length,
    diets: dietEntries.length,
  };
}

export async function bumpRestaurantWriteVersion(tx, restaurantId) {
  const safeRestaurantId = asText(restaurantId);
  if (!safeRestaurantId) return 0;

  const rows = await tx.$queryRawUnsafe(
    `
    UPDATE public.restaurants
    SET write_version = COALESCE(write_version, 0) + 1
    WHERE id = $1::uuid
    RETURNING write_version
  `,
    safeRestaurantId,
  );

  return toSafeVersion(rows?.[0]?.write_version, 0);
}

export async function applyWriteOperations({
  tx,
  batch,
  operations,
  userEmail,
}) {
  const touchedRestaurantIds = new Set();
  const deletedRestaurantIds = new Set();
  const createdRestaurants = [];
  const operationResults = [];

  for (const operation of operations) {
    const operationType = asText(operation?.operation_type);
    const payload = parseJsonValue(operation?.operation_payload, {});
    const summary = asText(operation?.summary);

    switch (operationType) {
      case RESTAURANT_WRITE_OPERATION_TYPES.MENU_STATE_REPLACE: {
        const restaurantId = asText(batch?.restaurant_id);
        const overlays = Array.isArray(payload?.overlays) ? payload.overlays : [];
        const menuImages = (Array.isArray(payload?.menuImages) ? payload.menuImages : [])
          .map((value) => asText(value))
          .filter(Boolean);
        const menuImage = asText(payload?.menuImage) || menuImages[0] || null;
        if (!menuImages.length && menuImage) {
          menuImages.push(menuImage);
        }

        await tx.restaurants.update({
          where: { id: restaurantId },
          data: {
            overlays: toJsonSafe(overlays, []),
            menu_image: menuImage || null,
            menu_images: toJsonSafe(menuImages, []),
          },
        });

        const syncResult = await syncIngredientStatusFromOverlays(
          tx,
          restaurantId,
          overlays,
        );

        await tx.change_logs.create({
          data: {
            restaurant_id: restaurantId,
            type: "update",
            description: asText(batch?.author) || "Manager",
            changes: JSON.stringify(toJsonSafe(payload?.changePayload, {})),
            user_email: userEmail || null,
            photos: [],
            timestamp: new Date(),
          },
        });

        touchedRestaurantIds.add(restaurantId);
        operationResults.push({
          operationType,
          summary,
          ...syncResult,
        });
        break;
      }

      case RESTAURANT_WRITE_OPERATION_TYPES.BRAND_REPLACEMENT: {
        const restaurantId = asText(batch?.restaurant_id);
        const overlays = Array.isArray(payload?.overlays) ? payload.overlays : [];
        const menuImages = (Array.isArray(payload?.menuImages) ? payload.menuImages : [])
          .map((value) => asText(value))
          .filter(Boolean);
        const menuImage = asText(payload?.menuImage) || menuImages[0] || null;
        if (!menuImages.length && menuImage) {
          menuImages.push(menuImage);
        }

        await tx.restaurants.update({
          where: { id: restaurantId },
          data: {
            overlays: toJsonSafe(overlays, []),
            menu_image: menuImage || null,
            menu_images: toJsonSafe(menuImages, []),
          },
        });

        const syncResult = await syncIngredientStatusFromOverlays(
          tx,
          restaurantId,
          overlays,
        );

        await tx.change_logs.create({
          data: {
            restaurant_id: restaurantId,
            type: "update",
            description: asText(batch?.author) || "Manager",
            changes: JSON.stringify(toJsonSafe(payload?.changePayload, {})),
            user_email: userEmail || null,
            photos: [],
            timestamp: new Date(),
          },
        });

        touchedRestaurantIds.add(restaurantId);
        operationResults.push({
          operationType,
          summary,
          ...syncResult,
        });
        break;
      }

      case RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_SETTINGS_UPDATE: {
        const restaurantId = asText(batch?.restaurant_id);
        const nextSettings = {
          website: asText(payload?.website) || null,
          phone: asText(payload?.phone) || null,
          delivery_url: asText(payload?.delivery_url) || null,
          menu_url: asText(payload?.menu_url) || null,
        };

        await tx.restaurants.update({
          where: { id: restaurantId },
          data: nextSettings,
        });

        await tx.change_logs.create({
          data: {
            restaurant_id: restaurantId,
            type: "update",
            description: asText(batch?.author) || "Manager",
            changes: JSON.stringify(toJsonSafe(payload?.changePayload, nextSettings)),
            user_email: userEmail || null,
            photos: [],
            timestamp: new Date(),
          },
        });

        touchedRestaurantIds.add(restaurantId);
        operationResults.push({
          operationType,
          summary,
        });
        break;
      }

      case RESTAURANT_WRITE_OPERATION_TYPES.CONFIRM_INFO: {
        const restaurantId = asText(batch?.restaurant_id);
        const confirmedAt = asText(payload?.confirmedAt) || new Date().toISOString();

        await tx.restaurants.update({
          where: { id: restaurantId },
          data: {
            last_confirmed: new Date(confirmedAt),
          },
        });

        await tx.change_logs.create({
          data: {
            restaurant_id: restaurantId,
            type: "confirm",
            description: asText(batch?.author) || "Manager",
            changes: JSON.stringify(toJsonSafe(payload?.changePayload, {})),
            user_email: userEmail || null,
            photos: toJsonSafe(
              (Array.isArray(payload?.photos) ? payload.photos : [])
                .map((value) => asText(value))
                .filter(Boolean),
              [],
            ),
            timestamp: new Date(confirmedAt),
          },
        });

        touchedRestaurantIds.add(restaurantId);
        operationResults.push({
          operationType,
          summary,
          confirmedAt,
        });
        break;
      }

      case RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_CREATE: {
        const created = await tx.restaurants.create({
          data: {
            name: asText(payload?.name),
            slug: asText(payload?.slug),
            menu_image: asText(payload?.menuImage) || null,
            menu_images: toJsonSafe(
              (Array.isArray(payload?.menuImages) ? payload.menuImages : [])
                .map((value) => asText(value))
                .filter(Boolean),
              [],
            ),
            overlays: toJsonSafe(
              Array.isArray(payload?.overlays) ? payload.overlays : [],
              [],
            ),
            website: asText(payload?.website) || null,
            phone: asText(payload?.phone) || null,
            delivery_url: asText(payload?.delivery_url) || null,
            menu_url: asText(payload?.menu_url) || null,
            last_confirmed: null,
          },
          select: {
            id: true,
            slug: true,
          },
        });

        await tx.$executeRawUnsafe(
          `
          UPDATE public.restaurants
          SET write_version = 1
          WHERE id = $1::uuid
        `,
          created.id,
        );

        createdRestaurants.push({
          id: asText(created.id),
          slug: asText(created.slug),
          writeVersion: 1,
        });

        operationResults.push({
          operationType,
          summary,
          restaurantId: asText(created.id),
          slug: asText(created.slug),
        });
        break;
      }

      case RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_DELETE: {
        const restaurantId = asText(payload?.restaurantId || batch?.restaurant_id);
        if (!restaurantId) {
          throw new Error("Restaurant delete operation missing restaurant id.");
        }

        await tx.restaurants.delete({
          where: { id: restaurantId },
        });

        deletedRestaurantIds.add(restaurantId);
        operationResults.push({
          operationType,
          summary,
          restaurantId,
        });
        break;
      }

      default:
        throw new Error(`Unsupported operation type: ${operationType}`);
    }
  }

  const nextWriteVersions = [];
  for (const restaurantId of touchedRestaurantIds) {
    if (deletedRestaurantIds.has(restaurantId)) continue;
    const writeVersion = await bumpRestaurantWriteVersion(tx, restaurantId);
    nextWriteVersions.push({
      restaurantId,
      writeVersion,
    });
  }

  return {
    operationResults,
    nextWriteVersions,
    createdRestaurants,
  };
}
