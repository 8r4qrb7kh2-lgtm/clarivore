import { NextResponse } from "next/server";
import {
  asText,
  buildReviewSummary,
  ensureRestaurantWriteInfrastructure,
  loadPendingBatchForScope,
  mapBatchForResponse,
  mapOperationsForResponse,
  prisma,
  requireAdminSession,
  requireRestaurantAccessSession,
  WRITE_SCOPE_TYPES,
} from "../_shared/writeGatewayUtils";

export const runtime = "nodejs";

function normalizeScopeType(value) {
  const token = asText(value).toUpperCase();
  if (token === WRITE_SCOPE_TYPES.RESTAURANT) return WRITE_SCOPE_TYPES.RESTAURANT;
  if (token === WRITE_SCOPE_TYPES.ADMIN_GLOBAL) return WRITE_SCOPE_TYPES.ADMIN_GLOBAL;
  return "";
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const scopeType = normalizeScopeType(searchParams.get("scopeType"));
  const restaurantId = asText(searchParams.get("restaurantId"));

  if (!scopeType) {
    return NextResponse.json({ error: "scopeType is required" }, { status: 400 });
  }

  if (scopeType === WRITE_SCOPE_TYPES.RESTAURANT && !restaurantId) {
    return NextResponse.json({ error: "restaurantId is required" }, { status: 400 });
  }

  const scopeKey =
    scopeType === WRITE_SCOPE_TYPES.RESTAURANT ? restaurantId : "admin-global";

  try {
    const session =
      scopeType === WRITE_SCOPE_TYPES.RESTAURANT
        ? await requireRestaurantAccessSession(request, restaurantId)
        : await requireAdminSession(request);

    await ensureRestaurantWriteInfrastructure(prisma);

    const { batch, operations } = await loadPendingBatchForScope({
      client: prisma,
      scopeType,
      scopeKey,
      userId: session.userId,
    });

    if (!batch) {
      return NextResponse.json({
        success: true,
        batch: null,
        operations: [],
        reviewSummary: {},
      });
    }

    const mappedBatch = mapBatchForResponse(batch);
    const mappedOperations = mapOperationsForResponse(operations);
    const reviewSummary =
      mappedBatch?.reviewSummary && typeof mappedBatch.reviewSummary === "object"
        ? {
            ...mappedBatch.reviewSummary,
            ...(buildReviewSummary(batch, operations) || {}),
          }
        : buildReviewSummary(batch, operations);

    return NextResponse.json({
      success: true,
      batch: mappedBatch,
      operations: mappedOperations,
      reviewSummary,
    });
  } catch (error) {
    const message = asText(error?.message) || "Failed to load staged write.";
    const status =
      message === "Missing authorization token"
        ? 401
        : message === "Invalid user session"
          ? 401
          : message === "Not authorized" || message === "Admin access required"
            ? 403
          : message === "Restaurant not found"
            ? 404
              : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
