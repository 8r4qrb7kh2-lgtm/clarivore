import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Deprecated endpoint: use POST /api/restaurant-write/commit for all manager/admin restaurant writes.",
    },
    { status: 410 },
  );
}
