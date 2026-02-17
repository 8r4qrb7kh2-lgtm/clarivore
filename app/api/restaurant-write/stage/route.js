import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  asText,
  buildReviewSummary,
  ensureRestaurantWriteInfrastructure,
  getWriteMaintenanceMessage,
  getRestaurantWriteVersion,
  isWriteMaintenanceModeEnabled,
  loadPendingBatchForScope,
  mapBatchForResponse,
  mapOperationsForResponse,
  prisma,
  RESTAURANT_WRITE_BATCH_TABLE,
  RESTAURANT_WRITE_OP_TABLE,
  RESTAURANT_WRITE_OPERATION_TYPES,
  validateWriteStageRequest,
  WRITE_SCOPE_TYPES,
  authorizeWriteStage,
} from "../_shared/writeGatewayUtils";

export const runtime = "nodejs";

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

  let parsed;
  try {
    parsed = validateWriteStageRequest(body);
  } catch (error) {
    return NextResponse.json(
      { error: asText(error?.message) || "Invalid stage request." },
      { status: 400 },
    );
  }

  const {
    scopeType,
    scopeKey,
    restaurantId,
    operationType,
    operationPayload,
    summary,
    sortOrder,
    expectedWriteVersion,
  } = parsed;

  try {
    const session = await authorizeWriteStage({
      request,
      operationType,
      restaurantId,
    });
    await ensureRestaurantWriteInfrastructure(prisma);

    const result = await prisma.$transaction(async (tx) => {
      const existing = await loadPendingBatchForScope({
        client: tx,
        scopeType,
        scopeKey,
        userId: session.userId,
      });

      let baseWriteVersion = null;
      let currentWriteVersion = null;
      if (scopeType === WRITE_SCOPE_TYPES.RESTAURANT && restaurantId) {
        const version = await getRestaurantWriteVersion(tx, restaurantId);
        currentWriteVersion = Number(version.writeVersion) || 0;
        const existingBase = existing.batch
          ? Number(existing.batch.base_write_version ?? currentWriteVersion)
          : currentWriteVersion;

        if (
          Number.isFinite(Number(expectedWriteVersion)) &&
          Number(expectedWriteVersion) !== currentWriteVersion
        ) {
          throw new Error("Write scope is stale. Reload before staging changes.");
        }

        if (existing.batch && existingBase !== currentWriteVersion) {
          throw new Error("Write scope is stale. Reload before staging changes.");
        }

        if (
          existing.batch &&
          Number.isFinite(Number(expectedWriteVersion)) &&
          Number(expectedWriteVersion) !== existingBase
        ) {
          throw new Error("Write scope is stale. Reload before staging changes.");
        }

        baseWriteVersion = existing.batch
          ? existingBase
          : Number.isFinite(Number(expectedWriteVersion))
            ? Number(expectedWriteVersion)
            : currentWriteVersion;
      }

      let batchId = asText(existing.batch?.id);
      if (batchId) {
        await tx.$executeRawUnsafe(
          `
          UPDATE ${RESTAURANT_WRITE_BATCH_TABLE}
          SET
            author = $1,
            base_write_version = $2,
            review_summary = '{}'::jsonb,
            updated_at = now()
          WHERE id = $3::uuid
        `,
          asText(body?.author) || null,
          Number.isFinite(Number(baseWriteVersion)) ? Number(baseWriteVersion) : null,
          batchId,
        );
      } else {
        batchId = randomUUID();
        await tx.$executeRawUnsafe(
          `
          INSERT INTO ${RESTAURANT_WRITE_BATCH_TABLE}
            (id, scope_type, scope_key, restaurant_id, created_by, author, status, base_write_version, review_summary)
          VALUES
            (
              $1::uuid,
              $2,
              $3,
              $4::uuid,
              $5::uuid,
              $6,
              'pending',
              $7,
              '{}'::jsonb
            )
        `,
          batchId,
          scopeType,
          scopeKey,
          restaurantId || null,
          session.userId,
          asText(body?.author) || null,
          Number.isFinite(Number(baseWriteVersion)) ? Number(baseWriteVersion) : null,
        );
      }

      await tx.$executeRawUnsafe(
        `
        INSERT INTO ${RESTAURANT_WRITE_OP_TABLE}
          (id, batch_id, sort_order, operation_type, operation_payload, summary)
        VALUES
          ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6)
        ON CONFLICT (batch_id, operation_type)
        DO UPDATE
          SET
            sort_order = EXCLUDED.sort_order,
            operation_payload = EXCLUDED.operation_payload,
            summary = EXCLUDED.summary,
            updated_at = now()
      `,
        randomUUID(),
        batchId,
        Number(sortOrder) || 0,
        operationType,
        JSON.stringify(operationPayload || {}),
        summary || operationType,
      );

      const latest = await loadPendingBatchForScope({
        client: tx,
        scopeType,
        scopeKey,
        userId: session.userId,
      });

      const reviewSummary = buildReviewSummary(latest.batch, latest.operations);
      await tx.$executeRawUnsafe(
        `
        UPDATE ${RESTAURANT_WRITE_BATCH_TABLE}
        SET review_summary = $1::jsonb, updated_at = now()
        WHERE id = $2::uuid
      `,
        JSON.stringify(reviewSummary),
        batchId,
      );

      return {
        batch: latest.batch,
        operations: latest.operations,
        reviewSummary,
        currentWriteVersion,
      };
    });

    const mappedBatch = mapBatchForResponse(result.batch);
    const mappedOperations = mapOperationsForResponse(result.operations);
    const reviewSummary = result.reviewSummary || {};

    const menuPayload =
      operationType === RESTAURANT_WRITE_OPERATION_TYPES.MENU_STATE_REPLACE
        ? operationPayload
        : null;

    return NextResponse.json({
      success: true,
      batch: mappedBatch,
      operations: mappedOperations,
      reviewSummary,
      batchId: mappedBatch?.id || "",
      baseWriteVersion: mappedBatch?.baseWriteVersion ?? null,
      currentWriteVersion:
        Number.isFinite(Number(result.currentWriteVersion))
          ? Number(result.currentWriteVersion)
          : null,
      stateHash: asText(menuPayload?.stateHash),
      rows: Array.isArray(menuPayload?.rows) ? menuPayload.rows : [],
    });
  } catch (error) {
    const message = asText(error?.message) || "Failed to stage write.";
    const status =
      message === "Missing authorization token"
        ? 401
        : message === "Invalid user session"
          ? 401
          : message === "Not authorized" || message === "Admin access required"
            ? 403
          : message === "Restaurant not found"
            ? 404
          : message === "Write scope is stale. Reload before staging changes."
            ? 409
            : message === getWriteMaintenanceMessage()
              ? 503
                : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
