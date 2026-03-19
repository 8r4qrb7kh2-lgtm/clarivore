import { corsJson, corsOptions } from "../_shared/cors";
import {
  asText,
  bumpRestaurantWriteVersion,
  db,
  requireAdminSession,
  setRestaurantWriteContext,
} from "../restaurant-write/_shared/writeGatewayUtils";
import {
  formatIngredientBrandAppealSnapshot,
  normalizeIngredientBrandAppeal,
} from "../../lib/ingredientBrandAppeal.js";
import { resetIngredientConfirmationIfChanged } from "../../lib/ingredientRowConfirmation.js";
import {
  listIngredientAppealsForAdmin,
  loadIngredientAppealRowsById,
} from "../../lib/server/ingredientAppeals.js";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsOptions();
}

function errorResponse(message, status) {
  return corsJson({ success: false, error: message }, { status });
}

function resolveAppealActorLabel(session, fallbackLabel) {
  const metadata = session?.user?.user_metadata;
  const fullName = asText(
    metadata?.full_name || metadata?.name || metadata?.display_name,
  );
  return fullName || asText(session?.userEmail) || fallbackLabel;
}

function normalizeAppealReviewStatus(value) {
  const normalized = asText(value).toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "rejected") return "rejected";
  return "";
}

function buildAppealChangePayload({
  actorLabel,
  dishName,
  summary,
  beforeAppeal,
  afterAppeal,
}) {
  const safeDishName = asText(dishName) || "General changes";
  return {
    author: actorLabel,
    general: [],
    items: {
      [safeDishName]: [
        {
          appealId: asText(afterAppeal?.id || beforeAppeal?.id),
          summary,
          before: formatIngredientBrandAppealSnapshot(beforeAppeal),
          after: formatIngredientBrandAppealSnapshot(afterAppeal),
        },
      ],
    },
  };
}

async function createAppealChangeLog(tx, {
  restaurantId,
  actorLabel,
  dishName,
  summary,
  beforeAppeal,
  afterAppeal,
  photos = [],
}) {
  await tx.change_logs.create({
    data: {
      restaurant_id: restaurantId,
      type: "update",
      description: actorLabel,
      changes: buildAppealChangePayload({
        actorLabel,
        dishName,
        summary,
        beforeAppeal,
        afterAppeal,
      }),
      user_email: null,
      photos: (Array.isArray(photos) ? photos : []).map((value) => asText(value)).filter(Boolean),
      timestamp: new Date(),
    },
  });
}

function buildReviewedAppealState({
  existingAppeal,
  reviewStatus,
  reviewNotes,
  reviewedAt,
  reviewedBy,
}) {
  return normalizeIngredientBrandAppeal({
    ...(existingAppeal && typeof existingAppeal === "object" ? existingAppeal : {}),
    reviewStatus,
    reviewNotes,
    reviewedAt,
    reviewedBy,
  });
}

async function syncIngredientRowsForAppealReview(tx, {
  appealId,
  reviewStatus,
  reviewNotes,
  reviewedAt,
  reviewedBy,
}) {
  const rows = await loadIngredientAppealRowsById(tx, appealId);
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("Appeal not found.");
  }

  const updatedRows = [];
  for (const row of rows) {
    const currentPayload =
      row?.ingredient_payload && typeof row.ingredient_payload === "object"
        ? { ...row.ingredient_payload }
        : {};
    const beforeAppeal = normalizeIngredientBrandAppeal(currentPayload.brandAppeal);
    if (!beforeAppeal) {
      continue;
    }

    const nextAppeal = buildReviewedAppealState({
      existingAppeal: currentPayload.brandAppeal,
      reviewStatus,
      reviewNotes,
      reviewedAt,
      reviewedBy,
    });

    const nextPayload = {
      ...currentPayload,
      brandRequired: reviewStatus !== "approved",
      brandAppeal: nextAppeal,
    };
    if (reviewStatus === "approved") {
      delete nextPayload.brandRequirementReason;
    }

    const nextPersistedPayload = resetIngredientConfirmationIfChanged(
      currentPayload,
      nextPayload,
    );

    await tx.restaurant_menu_ingredient_rows.update({
      where: { id: row.id },
      data: {
        row_text: asText(nextPersistedPayload.name) || asText(row.row_text) || null,
        ingredient_payload: nextPersistedPayload,
      },
    });

    updatedRows.push({
      id: row.id,
      restaurantId: asText(row.restaurant_id),
      dishName: asText(row.dish_name),
      ingredientName: asText(nextPersistedPayload.name || row.row_text),
      photoUrl: asText(beforeAppeal.photoUrl),
      beforeAppeal,
      afterAppeal: nextAppeal,
    });
  }

  if (!updatedRows.length) {
    throw new Error("Appeal not found.");
  }

  return updatedRows;
}

function getSessionErrorStatus(error) {
  const message = asText(error?.message);
  if (message === "Missing authorization token") return 401;
  if (message === "Invalid user session") return 401;
  if (message === "Supabase server credentials missing") return 500;
  if (message === "Admin access required") return 403;
  return 401;
}

export async function GET(request) {
  try {
    await requireAdminSession(request);

    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(Number(searchParams.get("limit")) || 200, 500));
    const appeals = await listIngredientAppealsForAdmin(db, { limit });

    return corsJson({
      success: true,
      appeals,
    });
  } catch (error) {
    return errorResponse(
      asText(error?.message) || "Failed to load appeals.",
      getSessionErrorStatus(error),
    );
  }
}

export async function POST() {
  return errorResponse(
    "Appeals are saved through menu edits. Submit the appeal in the editor, then use Save to Site.",
    405,
  );
}

export async function PATCH(request) {
  let session = null;
  try {
    session = await requireAdminSession(request);
  } catch (error) {
    return errorResponse(
      asText(error?.message) || "Admin access required.",
      getSessionErrorStatus(error),
    );
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON payload.", 400);
  }

  const appealId = asText(body?.appealId);
  const reviewStatus = normalizeAppealReviewStatus(body?.status);
  const reviewNotes = asText(body?.reviewNotes);

  if (!appealId || !reviewStatus) {
    return errorResponse("appealId and a valid status are required.", 400);
  }

  const reviewedAt = new Date();
  const reviewedBy = resolveAppealActorLabel(session, "Admin");
  let nextRestaurantWriteVersion = 0;

  try {
    const result = await db.$transaction(async (tx) => {
      await setRestaurantWriteContext(tx);

      const updatedRows = await syncIngredientRowsForAppealReview(tx, {
        appealId,
        reviewStatus,
        reviewNotes,
        reviewedAt: reviewedAt.toISOString(),
        reviewedBy,
      });
      const firstRow = updatedRows[0];

      await createAppealChangeLog(tx, {
        restaurantId: firstRow.restaurantId,
        actorLabel: reviewedBy,
        dishName: firstRow.dishName,
        summary:
          reviewStatus === "approved"
            ? `${firstRow.dishName}: Approved brand assignment appeal for ${firstRow.ingredientName}`
            : `${firstRow.dishName}: Rejected brand assignment appeal for ${firstRow.ingredientName}`,
        beforeAppeal: firstRow.beforeAppeal,
        afterAppeal: firstRow.afterAppeal,
        photos: firstRow.photoUrl ? [firstRow.photoUrl] : [],
      });

      nextRestaurantWriteVersion = await bumpRestaurantWriteVersion(tx, firstRow.restaurantId);

      return {
        appeal: {
          id: asText(firstRow.afterAppeal?.id || appealId),
          restaurantId: firstRow.restaurantId,
          dishName: firstRow.dishName,
          ingredientName: firstRow.ingredientName,
          reviewStatus,
          reviewNotes,
          reviewedAt: reviewedAt.toISOString(),
          reviewedBy,
        },
        matchedRowCount: updatedRows.length,
      };
    });

    return corsJson({
      success: true,
      appeal: result.appeal,
      matchedIngredientRows: result.matchedRowCount,
      restaurantWriteVersion: nextRestaurantWriteVersion,
    });
  } catch (error) {
    const message = asText(error?.message) || "Failed to review appeal.";
    const status = message === "Appeal not found." ? 404 : 500;
    return errorResponse(message, status);
  }
}
