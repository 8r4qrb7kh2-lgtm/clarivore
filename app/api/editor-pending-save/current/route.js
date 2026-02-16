import { NextResponse } from "next/server";
import {
  asText,
  ensurePendingSaveTables,
  PENDING_SAVE_BATCH_TABLE,
  PENDING_SAVE_ROW_TABLE,
  prisma,
  requireManagerSession,
} from "../_shared/pendingSaveUtils";

export const runtime = "nodejs";

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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const restaurantId = asText(searchParams.get("restaurantId"));

  if (!restaurantId) {
    return NextResponse.json({ error: "restaurantId is required" }, { status: 400 });
  }

  try {
    const { userId } = await requireManagerSession(request, restaurantId);
    await ensurePendingSaveTables(prisma);

    const batchRows = await prisma.$queryRawUnsafe(
      `
      SELECT *
      FROM ${PENDING_SAVE_BATCH_TABLE}
      WHERE restaurant_id = $1::uuid
        AND created_by = $2::uuid
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `,
      restaurantId,
      userId,
    );

    const batch = batchRows?.[0] || null;
    if (!batch) {
      return NextResponse.json({ success: true, batch: null, rows: [] });
    }

    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT *
      FROM ${PENDING_SAVE_ROW_TABLE}
      WHERE batch_id = $1::uuid
      ORDER BY sort_order ASC, created_at ASC
    `,
      batch.id,
    );

    return NextResponse.json({
      success: true,
      batch: {
        id: asText(batch.id),
        restaurant_id: asText(batch.restaurant_id),
        created_by: asText(batch.created_by),
        author: asText(batch.author),
        status: asText(batch.status),
        state_hash: asText(batch.state_hash),
        row_count: Number(batch.row_count) || 0,
        created_at: batch.created_at || null,
        updated_at: batch.updated_at || null,
        applied_at: batch.applied_at || null,
        change_payload: parseJsonValue(batch.change_payload, {}),
      },
      rows: (Array.isArray(rows) ? rows : []).map((row) => ({
        id: asText(row.id),
        batch_id: asText(row.batch_id),
        sort_order: Number(row.sort_order) || 0,
        dish_name: asText(row.dish_name),
        row_index:
          Number.isFinite(Number(row.row_index)) && row.row_index !== null
            ? Number(row.row_index)
            : null,
        ingredient_name: asText(row.ingredient_name),
        change_type: asText(row.change_type),
        field_key: asText(row.field_key),
        before_value: parseJsonValue(row.before_value, null),
        after_value: parseJsonValue(row.after_value, null),
        summary: asText(row.summary),
        created_at: row.created_at || null,
      })),
    });
  } catch (error) {
    const message = asText(error?.message) || "Failed to load pending table.";
    const status =
      message === "Missing authorization token"
        ? 401
        : message === "Invalid user session"
          ? 401
          : message === "Not authorized"
            ? 403
            : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
