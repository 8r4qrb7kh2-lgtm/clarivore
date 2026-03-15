import { readFile } from "node:fs/promises";
import {
  asText,
  isAppAdminUser,
  prisma,
  requireAuthenticatedSession,
} from "../../restaurant-write/_shared/writeGatewayUtils";
import {
  getRuntimeFlowDiagramById,
  listRuntimeFlowDiagramSummaries,
} from "../_shared/runtimeFlowMap";

export const runtime = "nodejs";

const MAX_CODE_SNIPPET_LINES = 80;

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

function toSafePositiveInt(value, fallback = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.floor(numeric));
}

async function hydrateCodeRef(codeRef) {
  const filePath = asText(codeRef?.filePath);
  const startLine = toSafePositiveInt(codeRef?.startLine);
  const endLine = toSafePositiveInt(codeRef?.endLine);

  if (!filePath || !startLine || !endLine || endLine < startLine) {
    return {
      filePath,
      startLine,
      endLine,
      snippet: "",
      error: "Invalid code reference range.",
    };
  }

  try {
    const absolutePath = `${process.cwd()}/${filePath}`;
    const sourceText = await readFile(absolutePath, "utf8");
    const allLines = sourceText.split(/\r?\n/);
    const boundedEnd = Math.min(endLine, startLine + MAX_CODE_SNIPPET_LINES - 1);
    const snippet = allLines.slice(startLine - 1, boundedEnd).join("\n");

    return {
      filePath,
      startLine,
      endLine: boundedEnd,
      snippet,
      error: "",
    };
  } catch (error) {
    return {
      filePath,
      startLine,
      endLine,
      snippet: "",
      error: asText(error?.message) || "Failed to load code reference.",
    };
  }
}

async function hydrateDiagram(diagram) {
  const blocks = Array.isArray(diagram?.blocks) ? diagram.blocks : [];
  const hydratedBlocks = await Promise.all(
    blocks.map(async (block) => {
      const codeRefs = Array.isArray(block?.codeRefs) ? block.codeRefs : [];
      const hydratedCodeRefs = await Promise.all(codeRefs.map(hydrateCodeRef));
      return {
        ...block,
        codeRefs: hydratedCodeRefs,
      };
    }),
  );

  return {
    ...diagram,
    blocks: hydratedBlocks,
    connections: Array.isArray(diagram?.connections) ? diagram.connections : [],
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
      rootDiagramId: "runtime-root",
      diagrams: listRuntimeFlowDiagramSummaries(),
    });
  }

  const diagram = getRuntimeFlowDiagramById(diagramId);
  if (!diagram) {
    return json({ error: "Unknown runtime diagram id." }, 404);
  }

  const hydratedDiagram = await hydrateDiagram(diagram);
  return json({ success: true, diagram: hydratedDiagram });
}
