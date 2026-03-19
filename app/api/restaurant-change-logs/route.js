import { NextResponse } from "next/server";
import { sanitizeChangeLogEntry } from "../../lib/changeLogs.js";
import {
  asText,
  db,
  requireRestaurantAccessSession,
} from "../restaurant-write/_shared/writeGatewayUtils";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function toSafeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(parsed, 0);
}

function isTruthyFlag(value) {
  const normalized = asText(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const restaurantId = asText(searchParams.get("restaurantId"));
  const limit = Math.min(
    Math.max(toSafeInteger(searchParams.get("limit"), DEFAULT_LIMIT), 1),
    MAX_LIMIT,
  );
  const offset = toSafeInteger(searchParams.get("offset"), 0);
  const includeSnapshots = isTruthyFlag(searchParams.get("includeSnapshots"));

  if (!restaurantId) {
    return NextResponse.json(
      { error: "restaurantId is required" },
      { status: 400 },
    );
  }

  try {
    await requireRestaurantAccessSession(request, restaurantId);

    const logs = await db.change_logs.findMany({
      where: {
        restaurant_id: restaurantId,
      },
      orderBy: [
        { timestamp: "desc" },
        { id: "desc" },
      ],
      skip: offset,
      take: limit,
    });

    return NextResponse.json({
      success: true,
      logs: logs.map((log) => sanitizeChangeLogEntry(log, { includeSnapshots })),
    });
  } catch (error) {
    const message = asText(error?.message) || "Failed to load change log.";
    const status =
      message === "Missing authorization token"
        ? 401
        : message === "Invalid user session"
          ? 401
          : message === "Not authorized" || message === "Admin access required"
            ? 403
            : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
