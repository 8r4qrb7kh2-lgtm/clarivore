import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      error:
        "Deprecated endpoint: use GET /api/restaurant-write/current for staged manager/admin restaurant writes.",
    },
    { status: 410 },
  );
}
