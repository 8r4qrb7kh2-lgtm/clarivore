import { readFile } from "node:fs/promises";
import {
  asText,
  isAppAdminUser,
  prisma,
  requireAuthenticatedSession,
} from "../../restaurant-write/_shared/writeGatewayUtils";
import { getRuntimeFlowDiagramById } from "../_shared/runtimeFlowMap";
import {
  callAnthropicApi,
  callOpenAiApi,
  createTextMessage,
  runWithProviderSelection,
} from "../../../lib/server/ai/providerRuntime.js";

export const runtime = "nodejs";

const MAX_QUESTION_LENGTH = 1000;
const MAX_HISTORY_MESSAGES = 10;
const MAX_CODE_SNIPPET_LINES = 80;

function json(payload, status = 200) {
  return Response.json(payload, { status });
}

function trimQuestion(value) {
  return asText(value).slice(0, MAX_QUESTION_LENGTH);
}

function sanitizeConversation(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: asText(message?.content),
    }))
    .filter((message) => message.content)
    .slice(-MAX_HISTORY_MESSAGES);
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

async function buildDiagramEvidence(diagram, blockId) {
  const blocks = Array.isArray(diagram?.blocks) ? diagram.blocks : [];
  const selectedBlockId = asText(blockId);

  const scopedBlocks = selectedBlockId
    ? blocks.filter((block) => asText(block?.id) === selectedBlockId)
    : blocks;

  const targetBlocks = scopedBlocks.length ? scopedBlocks : blocks;

  const hydratedBlocks = await Promise.all(
    targetBlocks.map(async (block) => {
      const hydratedCodeRefs = await Promise.all(
        (Array.isArray(block?.codeRefs) ? block.codeRefs : []).map(hydrateCodeRef),
      );
      return {
        id: asText(block?.id),
        title: asText(block?.title),
        summary: asText(block?.summary),
        authorizedUserTypes: Array.isArray(block?.authorizedUserTypes)
          ? block.authorizedUserTypes.map((entry) => asText(entry)).filter(Boolean)
          : [],
        codeRefs: hydratedCodeRefs,
      };
    }),
  );

  const blockIds = new Set(hydratedBlocks.map((block) => block.id));
  const relevantConnections = (Array.isArray(diagram?.connections) ? diagram.connections : []).filter(
    (connection) => blockIds.has(asText(connection?.from)) || blockIds.has(asText(connection?.to)),
  );

  return {
    diagramId: asText(diagram?.id),
    title: asText(diagram?.title),
    description: asText(diagram?.description),
    blocks: hydratedBlocks,
    connections: relevantConnections,
  };
}

function buildSystemPrompt() {
  return [
    "You are Clarivore's runtime architecture assistant for administrators.",
    "Answer only from the runtime evidence provided in the prompt.",
    "When making claims, cite file paths and line ranges from the evidence.",
    "Explicitly include authorized user types and variable handoffs when relevant.",
    "If evidence is missing for a claim, say that clearly.",
    "Keep answers concise and operationally useful.",
  ].join(" ");
}

function buildEvidenceBlock(evidence) {
  const lines = [];
  lines.push(`Diagram ID: ${asText(evidence?.diagramId)}`);
  lines.push(`Diagram title: ${asText(evidence?.title)}`);
  lines.push(`Diagram description: ${asText(evidence?.description)}`);

  const blocks = Array.isArray(evidence?.blocks) ? evidence.blocks : [];
  blocks.forEach((block, index) => {
    lines.push("");
    lines.push(`Block ${index + 1}: ${asText(block.title)} (id=${asText(block.id)})`);
    lines.push(`Summary: ${asText(block.summary)}`);
    lines.push(
      `Authorized user types: ${block.authorizedUserTypes.length ? block.authorizedUserTypes.join(", ") : "unknown"}`,
    );

    const refs = Array.isArray(block.codeRefs) ? block.codeRefs : [];
    refs.forEach((ref, refIndex) => {
      lines.push(
        `Ref ${refIndex + 1}: ${asText(ref.filePath)}:${ref.startLine || "?"}-${ref.endLine || "?"}`,
      );
      if (asText(ref.error)) {
        lines.push(`Ref error: ${asText(ref.error)}`);
      }
      if (asText(ref.snippet)) {
        lines.push("```js");
        lines.push(asText(ref.snippet));
        lines.push("```");
      }
    });
  });

  const connections = Array.isArray(evidence?.connections) ? evidence.connections : [];
  if (connections.length) {
    lines.push("");
    lines.push("Variable handoffs:");
    connections.forEach((connection, index) => {
      const from = asText(connection?.from);
      const to = asText(connection?.to);
      lines.push(`${index + 1}. ${from} -> ${to}`);
      const variables = Array.isArray(connection?.variables) ? connection.variables : [];
      variables.forEach((variable) => {
        lines.push(
          `   - ${asText(variable?.name)} | what: ${asText(variable?.description)} | used for: ${asText(variable?.usedFor)}`,
        );
      });
    });
  }

  return lines.join("\n");
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

  const diagramId = asText(body?.diagramId);
  const blockId = asText(body?.blockId);
  const question = trimQuestion(body?.question);
  const history = sanitizeConversation(body?.messages);

  if (!diagramId) {
    return json({ error: "diagramId is required." }, 400);
  }
  if (!question) {
    return json({ error: "question is required." }, 400);
  }

  const diagram = getRuntimeFlowDiagramById(diagramId);
  if (!diagram) {
    return json({ error: "Unknown runtime diagram id." }, 404);
  }

  try {
    const evidence = await buildDiagramEvidence(diagram, blockId);
    const evidenceBlock = buildEvidenceBlock(evidence);
    const messages = [
      ...history,
      {
        role: "user",
        content: `${evidenceBlock}\n\nUser question:\n${question}`,
      },
    ];

    const result = await runWithProviderSelection({
      routeId: "admin-runtime-flow-ask",
      promptClass: "adminRuntimeFlowAsk",
      requestSummary: {
        diagramId,
        blockId,
        question,
        messageCount: messages.length,
      },
      invokeProvider: async (provider) => {
        const response =
          provider === "openai"
            ? await callOpenAiApi({
                promptClass: "adminRuntimeFlowAsk",
                systemPrompt: buildSystemPrompt(),
                messages: messages.map((message) => ({
                  role: message.role,
                  content: [createTextMessage(message.content)],
                })),
                maxTokens: 1000,
                temperature: 0.1,
              })
            : await callAnthropicApi({
                promptClass: "adminRuntimeFlowAsk",
                systemPrompt: buildSystemPrompt(),
                messages: messages.map((message) => ({
                  role: message.role,
                  content: [createTextMessage(message.content)],
                })),
                maxTokens: 1000,
                temperature: 0.1,
              });

        return {
          ...response,
          normalizedOutput: {
            answer: asText(response.text),
          },
        };
      },
    });

    return json({
      success: true,
      answer: result.normalizedOutput.answer,
    });
  } catch (error) {
    return json(
      {
        error: "Runtime flow assistant failed",
        message: asText(error?.message) || "Unknown error",
      },
      500,
    );
  }
}
