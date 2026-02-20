import { NextResponse } from "next/server";
import {
  applyWriteOperations,
  asText,
  buildReviewSummary,
  ensureRestaurantWriteInfrastructure,
  getWriteMaintenanceMessage,
  getRestaurantWriteVersion,
  isAppAdminUser,
  isWriteMaintenanceModeEnabled,
  mapBatchForResponse,
  mapOperationsForResponse,
  prisma,
  requireAuthenticatedSession,
  RESTAURANT_WRITE_BATCH_TABLE,
  RESTAURANT_WRITE_OPERATION_TYPES,
  RESTAURANT_WRITE_OP_TABLE,
  WRITE_SCOPE_TYPES,
} from "../_shared/writeGatewayUtils";

export const runtime = "nodejs";
const COMMIT_TRANSACTION_MAX_WAIT_MS = 10_000;
const COMMIT_TRANSACTION_TIMEOUT_MS = 30_000;

export async function POST(request) {
  if (isWriteMaintenanceModeEnabled()) {
    return NextResponse.json(
      { error: getWriteMaintenanceMessage() },
      { status: 503 },
    );
  }

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

    const result = await prisma.$transaction(
      async (tx) => {
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
          throw new Error("Pending write batch not found or already applied.");
        }

        if (asText(batch.created_by) !== session.userId) {
          throw new Error("Not authorized");
        }

        const scopeType = asText(batch.scope_type).toUpperCase();
        const restaurantId = asText(batch.restaurant_id);
        const isAdmin = await isAppAdminUser(tx, session.userId);

        const operations = await tx.$queryRawUnsafe(
          `
          SELECT *
          FROM ${RESTAURANT_WRITE_OP_TABLE}
          WHERE batch_id = $1::uuid
          ORDER BY sort_order ASC, created_at ASC
        `,
          batchId,
        );

        if (!Array.isArray(operations) || !operations.length) {
          throw new Error("No operations found for pending write batch.");
        }

        const ownerOnlyOpPresent = operations.some((operation) => {
          const operationType = asText(operation?.operation_type).toUpperCase();
          return (
            operationType === RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_CREATE ||
            operationType === RESTAURANT_WRITE_OPERATION_TYPES.RESTAURANT_DELETE
          );
        });

        if (ownerOnlyOpPresent && !isAdmin) {
          throw new Error("Admin access required");
        }

        if (scopeType === WRITE_SCOPE_TYPES.RESTAURANT) {
          if (!restaurantId) {
            throw new Error("Restaurant scope batch missing restaurant id.");
          }

          if (!isAdmin) {
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

          const version = await getRestaurantWriteVersion(tx, restaurantId, { lock: true });
          const baseWriteVersion = Number(batch.base_write_version ?? 0);
          if ((Number(version.writeVersion) || 0) !== (Number(baseWriteVersion) || 0)) {
            throw new Error("Write scope is stale. Reload and review staged changes.");
          }
        } else if (scopeType === WRITE_SCOPE_TYPES.ADMIN_GLOBAL) {
          if (!isAdmin) {
            throw new Error("Admin access required");
          }
        } else {
          throw new Error("Invalid write scope");
        }

        const applyResult = await applyWriteOperations({
          tx,
          batch,
          operations,
          userEmail: session.userEmail,
        });

        const reviewSummary = buildReviewSummary(batch, operations);
        await tx.$executeRawUnsafe(
          `
          UPDATE ${RESTAURANT_WRITE_BATCH_TABLE}
          SET
            status = 'applied',
            applied_at = now(),
            updated_at = now(),
            review_summary = $1::jsonb
          WHERE id = $2::uuid
        `,
          JSON.stringify(reviewSummary),
          batchId,
        );

        return {
          batch,
          operations,
          reviewSummary,
          ...applyResult,
        };
      },
      {
        maxWait: COMMIT_TRANSACTION_MAX_WAIT_MS,
        timeout: COMMIT_TRANSACTION_TIMEOUT_MS,
      },
    );

    return NextResponse.json({
      success: true,
      batch: mapBatchForResponse(result.batch),
      operations: mapOperationsForResponse(result.operations),
      reviewSummary: result.reviewSummary || {},
      operationResults: Array.isArray(result.operationResults)
        ? result.operationResults
        : [],
      nextWriteVersions: Array.isArray(result.nextWriteVersions)
        ? result.nextWriteVersions
        : [],
      createdRestaurants: Array.isArray(result.createdRestaurants)
        ? result.createdRestaurants
        : [],
    });
  } catch (error) {
    const message = asText(error?.message) || "Failed to commit write batch.";
    const status =
      message === "Missing authorization token"
        ? 401
        : message === "Invalid user session"
          ? 401
          : message === "Not authorized" || message === "Admin access required"
            ? 403
          : message === "Pending write batch not found or already applied."
            ? 409
          : message === "Write scope is stale. Reload and review staged changes."
            ? 409
            : message === getWriteMaintenanceMessage()
              ? 503
              : message === "Restaurant not found"
                  ? 404
                  : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
