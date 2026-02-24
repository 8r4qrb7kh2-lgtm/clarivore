import { NextResponse } from "next/server";
import {
  asText,
  normalizeStringList,
  prisma,
} from "../../editor-pending-save/_shared/pendingSaveUtils";

export const runtime = "nodejs";

const MAX_FEEDBACK_LENGTH = 4000;
const MAX_ACCOMMODATION_DISHES = 40;

function asBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeFeedbackText(value) {
  return asText(value).slice(0, MAX_FEEDBACK_LENGTH);
}

function normalizeDishNames(values) {
  return normalizeStringList(values).slice(0, MAX_ACCOMMODATION_DISHES);
}

function invalidResponse(status = 200) {
  return NextResponse.json({ success: true, invalid: true }, { status });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, invalid: true, error: "Invalid JSON payload." },
      { status: 400 },
    );
  }

  const token = asText(body?.token);
  if (!token) {
    return invalidResponse(400);
  }

  const restaurantFeedback = normalizeFeedbackText(body?.restaurantFeedback);
  const websiteFeedback = normalizeFeedbackText(body?.websiteFeedback);
  const restaurantFeedbackIncludeEmail = asBoolean(
    body?.restaurantFeedbackIncludeEmail,
  );
  const websiteFeedbackIncludeEmail = asBoolean(body?.websiteFeedbackIncludeEmail);
  const selectedDishes = normalizeDishNames(body?.selectedDishes);
  const requestAllergens = normalizeStringList(body?.userAllergens);
  const requestDiets = normalizeStringList(body?.userDiets);

  if (!restaurantFeedback && !websiteFeedback && selectedDishes.length === 0) {
    return NextResponse.json(
      {
        success: false,
        invalid: false,
        error: "Feedback message or dish selections are required.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const queueEntry = await tx.feedback_email_queue.findFirst({
        where: { feedback_token: token },
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
        return { invalid: true, accommodationCount: 0 };
      }

      await tx.order_feedback.create({
        data: {
          order_id: queueEntry.order_id,
          restaurant_id: queueEntry.restaurant_id,
          user_id: queueEntry.user_id || null,
          restaurant_feedback: restaurantFeedback || null,
          website_feedback: websiteFeedback || null,
          restaurant_feedback_include_email: restaurantFeedbackIncludeEmail,
          website_feedback_include_email: websiteFeedbackIncludeEmail,
          user_email:
            restaurantFeedbackIncludeEmail || websiteFeedbackIncludeEmail
              ? queueEntry.user_email
              : null,
        },
        select: { id: true },
      });

      let accommodationCount = 0;
      const userId = asText(queueEntry.user_id);
      if (userId && selectedDishes.length > 0) {
        const userAllergens = requestAllergens.length
          ? requestAllergens
          : normalizeStringList(queueEntry.user_allergens);
        const userDiets = requestDiets.length
          ? requestDiets
          : normalizeStringList(queueEntry.user_diets);

        for (const dishName of selectedDishes) {
          await tx.accommodation_requests.upsert({
            where: {
              user_id_restaurant_id_dish_name: {
                user_id: userId,
                restaurant_id: queueEntry.restaurant_id,
                dish_name: dishName,
              },
            },
            update: {
              user_allergens: userAllergens,
              user_diets: userDiets,
              status: "pending",
              manager_response: null,
              updated_at: new Date(),
            },
            create: {
              user_id: userId,
              restaurant_id: queueEntry.restaurant_id,
              dish_name: dishName,
              user_allergens: userAllergens,
              user_diets: userDiets,
              requested_allergens: [],
              requested_diets: [],
              status: "pending",
            },
          });
          accommodationCount += 1;
        }
      }

      await tx.feedback_email_queue.update({
        where: { id: queueEntry.id },
        data: { sent_at: new Date() },
      });

      return { invalid: false, accommodationCount };
    });

    if (result.invalid) {
      return invalidResponse(200);
    }

    return NextResponse.json(
      {
        success: true,
        invalid: false,
        accommodationCount: result.accommodationCount,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        invalid: false,
        error: asText(error?.message) || "Failed to submit order feedback.",
      },
      { status: 500 },
    );
  }
}
