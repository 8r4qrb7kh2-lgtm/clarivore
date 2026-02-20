import { NextResponse } from "next/server";
import {
  asText,
  prisma,
  requireRestaurantAccessSession,
} from "../restaurant-write/_shared/writeGatewayUtils";

export const runtime = "nodejs";

const EDITOR_LOCK_TABLE = "public.restaurant_editor_locks";
const LOCK_TTL_SECONDS = 75;
const MAX_SESSION_KEY_CHARS = 160;
const MAX_INSTANCE_CHARS = 160;
const MAX_NAME_CHARS = 120;
const MAX_EMAIL_CHARS = 160;

let ensureInfrastructurePromise = null;

function trimText(value, maxChars = 0) {
  const text = asText(value);
  if (!maxChars || text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function resolveHolderName(user) {
  const meta = user?.user_metadata || {};
  const rawMeta = user?.raw_user_meta_data || {};
  const first = asText(meta.first_name || rawMeta.first_name);
  const last = asText(meta.last_name || rawMeta.last_name);
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;

  const fallbackName = asText(
    meta.full_name ||
      rawMeta.full_name ||
      meta.name ||
      rawMeta.name ||
      meta.display_name ||
      rawMeta.display_name,
  );
  if (fallbackName) return fallbackName;

  const email = asText(user?.email);
  if (!email) return "Manager";
  const userPart = email.split("@")[0];
  return trimText(userPart.replace(/[._]+/g, " ").trim(), MAX_NAME_CHARS) || "Manager";
}

function mapLockRow(lockRow) {
  if (!lockRow) return null;
  return {
    restaurantId: asText(lockRow.restaurant_id),
    userId: asText(lockRow.user_id),
    sessionKey: asText(lockRow.session_key),
    holderName: asText(lockRow.holder_name),
    holderEmail: asText(lockRow.holder_email),
    holderInstance: asText(lockRow.holder_instance),
    acquiredAt: lockRow.acquired_at || null,
    lastHeartbeatAt: lockRow.last_heartbeat_at || null,
    expiresAt: lockRow.expires_at || null,
  };
}

function buildAvailabilityPayload({ lockRow, session, sessionKey }) {
  const activeLock = mapLockRow(lockRow);
  if (!activeLock) {
    return {
      success: true,
      available: true,
      owned: false,
      blocked: false,
      reason: "",
      lock: null,
    };
  }

  const sameSession =
    activeLock.userId === asText(session?.userId) && activeLock.sessionKey === asText(sessionKey);

  if (sameSession) {
    return {
      success: true,
      available: true,
      owned: true,
      blocked: false,
      reason: "",
      lock: activeLock,
    };
  }

  return {
    success: true,
    available: false,
    owned: false,
    blocked: true,
    reason:
      activeLock.userId === asText(session?.userId)
        ? "same_user_other_instance"
        : "another_editor_active",
    lock: activeLock,
  };
}

async function ensureEditorLockInfrastructure() {
  if (ensureInfrastructurePromise) {
    return ensureInfrastructurePromise;
  }

  ensureInfrastructurePromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${EDITOR_LOCK_TABLE} (
        restaurant_id uuid PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
        user_id uuid NOT NULL,
        session_key text NOT NULL,
        holder_name text NOT NULL DEFAULT '',
        holder_email text NOT NULL DEFAULT '',
        holder_instance text NOT NULL DEFAULT '',
        acquired_at timestamptz NOT NULL DEFAULT now(),
        last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_restaurant_editor_locks_expires_at
        ON ${EDITOR_LOCK_TABLE} (expires_at);
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_restaurant_editor_locks_user_id
        ON ${EDITOR_LOCK_TABLE} (user_id);
    `);
  })().catch((error) => {
    ensureInfrastructurePromise = null;
    throw error;
  });

  return ensureInfrastructurePromise;
}

async function readActiveLockForRestaurant(restaurantId) {
  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT
      restaurant_id,
      user_id,
      session_key,
      holder_name,
      holder_email,
      holder_instance,
      acquired_at,
      last_heartbeat_at,
      expires_at
    FROM ${EDITOR_LOCK_TABLE}
    WHERE restaurant_id = $1::uuid
      AND expires_at > now()
    LIMIT 1
  `,
    restaurantId,
  );

  return rows?.[0] || null;
}

async function attemptLockUpsert({
  restaurantId,
  userId,
  sessionKey,
  holderName,
  holderEmail,
  holderInstance,
  allowSameUserTakeover = false,
}) {
  const rows = await prisma.$queryRawUnsafe(
    `
    INSERT INTO ${EDITOR_LOCK_TABLE} (
      restaurant_id,
      user_id,
      session_key,
      holder_name,
      holder_email,
      holder_instance,
      acquired_at,
      last_heartbeat_at,
      expires_at,
      updated_at
    )
    VALUES (
      $1::uuid,
      $2::uuid,
      $3,
      $4,
      $5,
      $6,
      now(),
      now(),
      now() + make_interval(secs => $7::int),
      now()
    )
    ON CONFLICT (restaurant_id) DO UPDATE
    SET
      user_id = EXCLUDED.user_id,
      session_key = EXCLUDED.session_key,
      holder_name = EXCLUDED.holder_name,
      holder_email = EXCLUDED.holder_email,
      holder_instance = EXCLUDED.holder_instance,
      last_heartbeat_at = now(),
      expires_at = now() + make_interval(secs => $7::int),
      updated_at = now()
    WHERE
      ${EDITOR_LOCK_TABLE}.session_key = EXCLUDED.session_key
      OR ${EDITOR_LOCK_TABLE}.expires_at <= now()
      OR ($8::boolean AND ${EDITOR_LOCK_TABLE}.user_id = EXCLUDED.user_id)
    RETURNING
      restaurant_id,
      user_id,
      session_key,
      holder_name,
      holder_email,
      holder_instance,
      acquired_at,
      last_heartbeat_at,
      expires_at
  `,
    restaurantId,
    userId,
    sessionKey,
    holderName,
    holderEmail,
    holderInstance,
    LOCK_TTL_SECONDS,
    allowSameUserTakeover,
  );

  return rows?.[0] || null;
}

async function acquireEditorLock({
  restaurantId,
  sessionKey,
  holderInstance,
  session,
  allowSameUserTakeover = false,
}) {
  const holderName = trimText(resolveHolderName(session?.user), MAX_NAME_CHARS) || "Manager";
  const holderEmail = trimText(session?.userEmail, MAX_EMAIL_CHARS);
  const safeInstance = trimText(holderInstance, MAX_INSTANCE_CHARS);

  const lockRow = await attemptLockUpsert({
    restaurantId,
    userId: session.userId,
    sessionKey,
    holderName,
    holderEmail,
    holderInstance: safeInstance,
    allowSameUserTakeover,
  });

  if (lockRow) {
    return buildAvailabilityPayload({
      lockRow,
      session,
      sessionKey,
    });
  }

  const activeLock = await readActiveLockForRestaurant(restaurantId);
  if (activeLock) {
    return buildAvailabilityPayload({
      lockRow: activeLock,
      session,
      sessionKey,
    });
  }

  const retryLock = await attemptLockUpsert({
    restaurantId,
    userId: session.userId,
    sessionKey,
    holderName,
    holderEmail,
    holderInstance: safeInstance,
    allowSameUserTakeover,
  });
  if (retryLock) {
    return buildAvailabilityPayload({
      lockRow: retryLock,
      session,
      sessionKey,
    });
  }

  throw new Error("Failed to acquire editor lock");
}

async function readEditorLockStatus({
  restaurantId,
  sessionKey,
  session,
}) {
  const lockRow = await readActiveLockForRestaurant(restaurantId);
  return buildAvailabilityPayload({
    lockRow,
    session,
    sessionKey,
  });
}

async function releaseEditorLock({
  restaurantId,
  sessionKey,
  userId,
}) {
  const result = await prisma.$executeRawUnsafe(
    `
    DELETE FROM ${EDITOR_LOCK_TABLE}
    WHERE restaurant_id = $1::uuid
      AND user_id = $2::uuid
      AND session_key = $3
  `,
    restaurantId,
    userId,
    sessionKey,
  );

  return Number(result || 0) > 0;
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const action = asText(body?.action).toLowerCase() || "status";
  const restaurantId = asText(body?.restaurantId);
  const sessionKey = trimText(body?.sessionKey, MAX_SESSION_KEY_CHARS);
  const holderInstance = trimText(body?.holderInstance, MAX_INSTANCE_CHARS);

  if (!restaurantId) {
    return NextResponse.json(
      { success: false, error: "restaurantId is required." },
      { status: 400 },
    );
  }

  if (!sessionKey) {
    return NextResponse.json(
      { success: false, error: "sessionKey is required." },
      { status: 400 },
    );
  }

  if (!["acquire", "refresh", "release", "status"].includes(action)) {
    return NextResponse.json(
      { success: false, error: "Unsupported editor lock action." },
      { status: 400 },
    );
  }

  try {
    await ensureEditorLockInfrastructure();
    const session = await requireRestaurantAccessSession(request, restaurantId);

    if (action === "release") {
      const released = await releaseEditorLock({
        restaurantId,
        sessionKey,
        userId: session.userId,
      });
      return NextResponse.json(
        {
          success: true,
          released,
        },
        { status: 200 },
      );
    }

    if (action === "status") {
      const payload = await readEditorLockStatus({
        restaurantId,
        sessionKey,
        session,
      });
      return NextResponse.json(payload, { status: 200 });
    }

    const payload = await acquireEditorLock({
      restaurantId,
      sessionKey,
      holderInstance,
      session,
      allowSameUserTakeover: action === "acquire",
    });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const message = asText(error?.message) || "Editor lock request failed.";
    const status =
      message === "Missing authorization token" || message === "Invalid user session"
        ? 401
        : message === "Not authorized" || message === "Admin access required"
          ? 403
          : message === "restaurantId is required"
            ? 400
            : 500;

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status },
    );
  }
}
