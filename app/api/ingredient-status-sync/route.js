import { corsJson, corsOptions } from "../_shared/cors";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsOptions();
}

export async function POST() {
  return corsJson(
    {
      error:
        "Deprecated endpoint: ingredient status writes are only applied through POST /api/restaurant-write/commit.",
    },
    { status: 410 },
  );
}
