import { readFile, stat } from "node:fs/promises";
import {
  asText,
  isAppAdminUser,
  prisma,
  requireAuthenticatedSession,
} from "../../restaurant-write/_shared/writeGatewayUtils";
import {
  ADMIN_DATA_FLOW_VISUALS,
  getDataFlowSvgPath,
  getDataFlowVisualById,
} from "../_shared/dataFlowVisuals";

export const runtime = "nodejs";

function json(payload, status = 200) {
  return Response.json(payload, { status });
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
  const session = await requireAuthenticatedSession(request);
  const isAdmin = await isAppAdminUser(prisma, session.userId);
  if (!isAdmin) {
    throw new Error("Unauthorized");
  }
  return session;
}

function sanitizeSvg(svgText) {
  const safeSvg = asText(svgText).replace(/<script[\s\S]*?<\/script>/gi, "");
  return safeSvg;
}

function toClientEntry(entry) {
  return {
    id: entry.id,
    title: entry.title,
    description: entry.description,
  };
}

export async function GET(request) {
  try {
    await requireAdminRequest(request);
  } catch (error) {
    const { message, status } = mapAuthError(error);
    return json({ error: message }, status);
  }

  const url = new URL(request.url);
  const diagramId = asText(url.searchParams.get("diagramId"));
  if (!diagramId) {
    return json({
      success: true,
      diagrams: ADMIN_DATA_FLOW_VISUALS.map(toClientEntry),
    });
  }

  const entry = getDataFlowVisualById(diagramId);
  if (!entry) {
    return json({ error: "Unknown diagram id." }, 404);
  }

  try {
    const svgPath = getDataFlowSvgPath(entry);
    const [svgRaw, svgStats] = await Promise.all([
      readFile(svgPath, "utf8"),
      stat(svgPath),
    ]);

    return json({
      success: true,
      diagram: toClientEntry(entry),
      svg: sanitizeSvg(svgRaw),
      updatedAt: svgStats.mtime.toISOString(),
    });
  } catch (error) {
    return json(
      {
        error: "Failed to load diagram visual.",
        message: asText(error?.message) || "Unknown error",
      },
      500,
    );
  }
}

