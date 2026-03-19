import {
  asText,
  isAppAdminUser,
  db,
  requireAuthenticatedSession,
} from "../../restaurant-write/_shared/writeGatewayUtils";
import { isAdminDashboardDevBypassEnabled } from "../../../admin-dashboard/services/adminDashboardAccess";
import {
  buildRuntimeSystemsView,
  getRuntimeSystemsVersion,
} from "../_shared/runtimeSystemsExplorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
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
  const isAdmin = await isAppAdminUser(db, session.userId);
  if (!isAdmin) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function GET(request) {
  try {
    await requireAdminRequest(request);
  } catch (error) {
    const { message, status } = mapAuthError(error);
    return json({ error: message }, status);
  }

  const url = new URL(request.url);
  const mode = asText(url.searchParams.get("mode"));
  const nodeId = asText(url.searchParams.get("nodeId"));

  try {
    if (mode === "version") {
      const version = await getRuntimeSystemsVersion();
      return json({
        success: true,
        ...version,
      });
    }

    const view = await buildRuntimeSystemsView(nodeId);
    return json({
      success: true,
      ...view,
    });
  } catch (error) {
    return json(
      {
        error: "Failed to build runtime systems view.",
        message: asText(error?.message) || "Unknown error",
      },
      500,
    );
  }
}
