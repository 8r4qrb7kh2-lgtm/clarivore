import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Deprecated endpoint: use POST /api/restaurant-write/stage for all manager/admin restaurant writes.",
    },
    { status: 410 },
  );
}
