import {
  asText,
  isAppAdminUser,
  prisma,
  requireAuthenticatedSession,
} from "../../restaurant-write/_shared/writeGatewayUtils";
import { isAdminDashboardDevBypassEnabled } from "../../../admin-dashboard/services/adminDashboardAccess";
import { answerRuntimeSystemsQuestion } from "../_shared/runtimeSystemsExplorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUESTION_LENGTH = 1000;

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function trimQuestion(value) {
  return asText(value).slice(0, MAX_QUESTION_LENGTH);
}

function mapAuthError(error) {
  const message = asText(error?.message) || "Request failed";
  const status =
    message === "Missing authorization token" || message === "Invalid user session"
      ? 401
      : message === "Unauthorized"
        ? 403
        : 500;
  return { message, status };
}

async function requireAdminRequest(request) {
  if (isAdminDashboardDevBypassEnabled()) {
    return { userId: "dev-admin-bypass", bypass: true };
  }

  const session = await requireAuthenticatedSession(request);
  const isAdmin = await isAppAdminUser(prisma, session.userId);
  if (!isAdmin) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function POST(request) {
  try {
    await requireAdminRequest(request);
  } catch (error) {
    const { message, status } = mapAuthError(error);
    return json({ error: message }, status);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON payload." }, 400);
  }

  const nodeId = asText(body?.nodeId);
  const question = trimQuestion(body?.question);

  if (!question) {
    return json({ error: "question is required." }, 400);
  }

  try {
    const result = await answerRuntimeSystemsQuestion({ nodeId, question });
    return json({
      success: true,
      ...result,
    });
  } catch (error) {
    return json(
      {
        error: "Runtime systems assistant failed.",
        message: asText(error?.message) || "Unknown error",
      },
      500,
    );
  }
}
