import { readFile } from "node:fs/promises";
import {
  asText,
  isAppAdminUser,
  prisma,
  requireAuthenticatedSession,
} from "../../restaurant-write/_shared/writeGatewayUtils";
import {
  getDataFlowSourcePath,
  getDataFlowVisualById,
} from "../_shared/dataFlowVisuals";

export const runtime = "nodejs";

const MAX_QUESTION_LENGTH = 1000;
const MAX_HISTORY_MESSAGES = 10;

function json(payload, status = 200) {
  return Response.json(payload, { status });
}

function trimQuestion(value) {
  return asText(value).slice(0, MAX_QUESTION_LENGTH);
}

function normalizeClickContext(value) {
  if (!value || typeof value !== "object") return null;
  const xPercent = Number(value.xPercent);
  const yPercent = Number(value.yPercent);
  return {
    xPercent: Number.isFinite(xPercent) ? Math.max(Math.min(xPercent, 100), 0) : null,
    yPercent: Number.isFinite(yPercent) ? Math.max(Math.min(yPercent, 100), 0) : null,
    targetTag: asText(value.targetTag),
    targetText: asText(value.targetText).slice(0, 240),
    clickedAt: asText(value.clickedAt),
  };
}

function sanitizeConversation(messages) {
  const safeMessages = (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: asText(message?.content),
    }))
    .filter((message) => message.content)
    .slice(-MAX_HISTORY_MESSAGES);
  return safeMessages;
}

function buildSystemPrompt() {
  return [
    "You are Clarivore's admin diagram assistant.",
    "Your job is to answer questions about Clarivore data-flow visuals in plain language.",
    "Use only the provided diagram metadata, Mermaid source, and click context.",
    "When relevant, explicitly mention allowed user types and page/surface routes.",
    "If the answer cannot be inferred from the provided context, say that directly.",
    "Keep answers concise and practical for an admin operator.",
  ].join(" ");
}

function buildDiagramContextBlock({ entry, sourceText, clickContext }) {
  const lines = [];
  lines.push(`Diagram ID: ${entry.id}`);
  lines.push(`Diagram title: ${entry.title}`);
  lines.push(`Diagram description: ${entry.description}`);
  if (clickContext) {
    lines.push(
      `Click context: x=${clickContext.xPercent ?? "?"}% y=${clickContext.yPercent ?? "?"}%`,
    );
    if (clickContext.targetTag) {
      lines.push(`Clicked SVG tag: ${clickContext.targetTag}`);
    }
    if (clickContext.targetText) {
      lines.push(`Clicked text: ${clickContext.targetText}`);
    }
  }
  lines.push("Mermaid source:");
  lines.push("```mermaid");
  lines.push(sourceText);
  lines.push("```");
  return lines.join("\n");
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
  const question = trimQuestion(body?.question);
  const clickContext = normalizeClickContext(body?.clickContext);
  const history = sanitizeConversation(body?.messages);

  if (!diagramId) {
    return json({ error: "diagramId is required." }, 400);
  }
  if (!question) {
    return json({ error: "question is required." }, 400);
  }

  const entry = getDataFlowVisualById(diagramId);
  if (!entry) {
    return json({ error: "Unknown diagram id." }, 404);
  }

  const anthropicApiKey = asText(process.env.ANTHROPIC_API_KEY);
  if (!anthropicApiKey) {
    return json({ error: "Anthropic API key not configured." }, 500);
  }

  try {
    const sourcePath = getDataFlowSourcePath(entry);
    const sourceText = await readFile(sourcePath, "utf8");
    const diagramContext = buildDiagramContextBlock({
      entry,
      sourceText: asText(sourceText),
      clickContext,
    });

    const messages = [
      ...history,
      {
        role: "user",
        content: `${diagramContext}\n\nUser question:\n${question}`,
      },
    ];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 900,
        temperature: 0.2,
        system: buildSystemPrompt(),
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Claude API error (${response.status}): ${errorText.slice(0, 260)}`,
      );
    }

    const payload = await response.json();
    const answer = asText(payload?.content?.[0]?.text);

    return json({ success: true, answer }, 200);
  } catch (error) {
    return json(
      {
        error: "Diagram assistant failed",
        message: asText(error?.message) || "Unknown error",
      },
      500,
    );
  }
}

