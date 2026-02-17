import { NextResponse } from "next/server";
import {
  applyWriteOperations,
  asText,
  ensureRestaurantWriteInfrastructure,
  getWriteMaintenanceMessage,
  isWriteMaintenanceModeEnabled,
  prisma,
  RESTAURANT_WRITE_OPERATION_TYPES,
} from "../_shared/writeGatewayUtils";

export const runtime = "nodejs";

const SYSTEM_HEADER_NAME = "x-clarivore-system-key";

function requireSystemKey(request) {
  const expected = asText(process.env.CLARIVORE_SYSTEM_WRITE_KEY);
  if (!expected) {
    throw new Error("System write key is not configured.");
  }

  const provided = asText(request.headers.get(SYSTEM_HEADER_NAME));
  if (!provided || provided !== expected) {
    throw new Error("Invalid system write key.");
  }
}

function normalizeSystemOperations(rawOperations) {
  const input = Array.isArray(rawOperations) ? rawOperations : [];
  const output = [];

  for (const entry of input) {
    const operationType = asText(entry?.operationType || entry?.operation_type).toUpperCase();
    if (operationType !== RESTAURANT_WRITE_OPERATION_TYPES.MONITORING_STATS_UPDATE) {
      throw new Error(`Unsupported system operation type: ${operationType || "unknown"}`);
    }

    const payload =
      entry?.operationPayload && typeof entry.operationPayload === "object"
        ? { ...entry.operationPayload }
        : {};

    const restaurantId = asText(
      entry?.restaurantId || entry?.restaurant_id || payload.restaurantId,
    );
    if (!restaurantId) {
      throw new Error("System monitoring operation is missing restaurantId.");
    }

    output.push({
      operation_type: operationType,
      operation_payload: {
        ...payload,
        restaurantId,
      },
      summary: asText(entry?.summary) || "System monitoring stats update",
    });
  }

  if (!output.length) {
    throw new Error("At least one system operation is required.");
  }

  return output;
}

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

  try {
    requireSystemKey(request);

    const operations = normalizeSystemOperations(body?.operations);
    await ensureRestaurantWriteInfrastructure(prisma);

    const result = await prisma.$transaction(async (tx) => {
      return await applyWriteOperations({
        tx,
        batch: {
          author: "System",
          restaurant_id: null,
        },
        operations,
        userEmail: null,
      });
    });

    return NextResponse.json({
      success: true,
      operationCount: operations.length,
      operationResults: Array.isArray(result?.operationResults)
        ? result.operationResults
        : [],
      nextWriteVersions: Array.isArray(result?.nextWriteVersions)
        ? result.nextWriteVersions
        : [],
    });
  } catch (error) {
    const message = asText(error?.message) || "Failed to apply system restaurant writes.";
    const status =
      message === "Invalid system write key."
        ? 401
        : message === "At least one system operation is required."
          ? 400
          : message === "System monitoring operation is missing restaurantId."
            ? 400
            : message.startsWith("Unsupported system operation type")
              ? 400
              : message === "System write key is not configured."
                ? 500
                : message === getWriteMaintenanceMessage()
                  ? 503
                  : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
