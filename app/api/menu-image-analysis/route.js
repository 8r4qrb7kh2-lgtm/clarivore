import { corsJson, corsOptions } from "../_shared/cors";
import { ApiError, analyzeMenuImageWithLocalEngine } from "./localRepositionEngine.mjs";

export const runtime = "nodejs";

function asText(value) {
  return String(value ?? "").trim();
}

export function OPTIONS() {
  return corsOptions();
}

export async function POST(request) {
  let body = null;
  try {
    body = await request.json();
  } catch {
    return corsJson(
      {
        success: false,
        error: "Invalid JSON payload.",
        dishes: [],
        updatedOverlays: [],
        newOverlays: [],
        rawDishCount: 0,
        validDishCount: 0,
      },
      { status: 400 },
    );
  }

  try {
    const result = await analyzeMenuImageWithLocalEngine({
      body,
      env: process.env,
    });
    return corsJson(result, { status: 200 });
  } catch (error) {
    const statusCode =
      error instanceof ApiError && Number.isFinite(Number(error.statusCode))
        ? Number(error.statusCode)
        : 500;

    return corsJson(
      {
        success: false,
        error: asText(error?.message) || "Failed to analyze menu image.",
        dishes: [],
        updatedOverlays: [],
        newOverlays: [],
        rawDishCount: 0,
        validDishCount: 0,
      },
      { status: statusCode },
    );
  }
}
