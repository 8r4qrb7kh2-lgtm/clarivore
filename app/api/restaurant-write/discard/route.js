import { NextResponse } from "next/server";
import { isOwnerUser } from "../../../lib/managerRestaurants";
import {
  asText,
  ensureRestaurantWriteInfrastructure,
  prisma,
  requireAuthenticatedSession,
  RESTAURANT_WRITE_BATCH_TABLE,
  WRITE_SCOPE_TYPES,
} from "../_shared/writeGatewayUtils";

export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const batchId = asText(body?.batchId);
  if (!batchId) {
    return NextResponse.json({ error: "batchId is required" }, { status: 400 });
  }

  try {
    const session = await requireAuthenticatedSession(request);
    await ensureRestaurantWriteInfrastructure(prisma);

    const result = await prisma.$transaction(async (tx) => {
      const batchRows = await tx.$queryRawUnsafe(
        `
        SELECT *
        FROM ${RESTAURANT_WRITE_BATCH_TABLE}
        WHERE id = $1::uuid
          AND status = 'pending'
        LIMIT 1
      `,
        batchId,
      );

      const batch = batchRows?.[0] || null;
      if (!batch) {
        return { discarded: false };
      }

      if (asText(batch.created_by) !== session.userId) {
        throw new Error("Not authorized");
      }

      const scopeType = asText(batch.scope_type).toUpperCase();
      const restaurantId = asText(batch.restaurant_id);
      const owner = isOwnerUser(session.user);

      if (scopeType === WRITE_SCOPE_TYPES.RESTAURANT && restaurantId && !owner) {
        const manager = await tx.restaurant_managers.findFirst({
          where: {
            user_id: session.userId,
            restaurant_id: restaurantId,
          },
        });
        if (!manager) {
          throw new Error("Not authorized");
        }
      }

      if (scopeType === WRITE_SCOPE_TYPES.ADMIN_GLOBAL && !owner) {
        throw new Error("Owner access required");
      }

      await tx.$executeRawUnsafe(
        `
        UPDATE ${RESTAURANT_WRITE_BATCH_TABLE}
        SET
          status = 'discarded',
          discarded_at = now(),
          updated_at = now()
        WHERE id = $1::uuid
      `,
        batchId,
      );

      return {
        discarded: true,
      };
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const message = asText(error?.message) || "Failed to discard write batch.";
    const status =
      message === "Missing authorization token"
        ? 401
        : message === "Invalid user session"
          ? 401
          : message === "Not authorized" || message === "Owner access required"
            ? 403
            : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

