import { NextResponse } from "next/server";
import { asText, prisma } from "../../editor-pending-save/_shared/pendingSaveUtils";

export const runtime = "nodejs";

function invalidResponse(status = 200) {
  return NextResponse.json({ success: true, invalid: true }, { status });
}

export async function GET(request) {
  const url = new URL(request.url);
  const token = asText(url.searchParams.get("token"));
  if (!token) {
    return invalidResponse(400);
  }

  try {
    const queueEntry = await prisma.feedback_email_queue.findFirst({
      where: {
        feedback_token: token,
      },
      select: {
        id: true,
        order_id: true,
        restaurant_id: true,
        user_id: true,
        user_email: true,
        user_allergens: true,
        user_diets: true,
        sent_at: true,
      },
    });

    if (!queueEntry || queueEntry.sent_at) {
      return invalidResponse(200);
    }

    const restaurant = await prisma.restaurants.findUnique({
      where: { id: queueEntry.restaurant_id },
      select: { id: true, name: true, slug: true },
    });

    if (!restaurant) {
      return invalidResponse(200);
    }

    return NextResponse.json(
      {
        success: true,
        invalid: false,
        queueEntry: {
          id: asText(queueEntry.id),
          order_id: asText(queueEntry.order_id),
          restaurant_id: asText(queueEntry.restaurant_id),
          user_id: asText(queueEntry.user_id),
          user_email: asText(queueEntry.user_email),
          user_allergens: Array.isArray(queueEntry.user_allergens)
            ? queueEntry.user_allergens
            : [],
          user_diets: Array.isArray(queueEntry.user_diets) ? queueEntry.user_diets : [],
        },
        restaurant,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        invalid: true,
        error: asText(error?.message) || "Failed to load feedback bootstrap data.",
      },
      { status: 500 },
    );
  }
}
