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
const AXON_QUERY_MAX_LENGTH = 200;
const AXON_MAX_RESULTS = 8;
const AXON_DEFAULT_TIMEOUT_MS = 3500;
const AXON_SYMBOL_CONTEXT_MAX_CHARS = 1800;
const AXON_RESULT_TEXT_MAX_CHARS = 360;

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

function normalizeAxonBaseUrl(value) {
  const raw = asText(value).replace(/\/+$/g, "");
  if (!raw) return "";
  if (/\/api\/v1$/i.test(raw)) return raw;
  return `${raw}/api/v1`;
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveAxonConfig() {
  const disabled = asText(process.env.AXON_ENABLED).toLowerCase() === "false";
  if (disabled) {
    return { enabled: false, reason: "disabled_by_env" };
  }

  const explicitBaseUrl = normalizeAxonBaseUrl(
    process.env.AXON_API_BASE_URL || process.env.AXON_BASE_URL,
  );
  const localPort = asText(process.env.AXON_API_PORT || "58080");
  const runningOnVercel = Boolean(asText(process.env.VERCEL));

  const baseUrl =
    explicitBaseUrl ||
    (runningOnVercel || !localPort
      ? ""
      : normalizeAxonBaseUrl(`http://127.0.0.1:${localPort}`));

  if (!baseUrl) {
    return { enabled: false, reason: "missing_base_url" };
  }

  const repositoryId = Number.parseInt(asText(process.env.AXON_REPOSITORY_ID || "2"), 10);
  const timeoutMsRaw = Number.parseInt(asText(process.env.AXON_TIMEOUT_MS || ""), 10);
  const timeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw >= 500 && timeoutMsRaw <= 20000
      ? timeoutMsRaw
      : AXON_DEFAULT_TIMEOUT_MS;

  return {
    enabled: true,
    baseUrl,
    repositoryId: Number.isFinite(repositoryId) && repositoryId > 0 ? repositoryId : null,
    apiKey: asText(
      process.env.AXON_API_KEY || process.env.AXON_X_API_KEY || process.env.AXON_ADMIN_API_KEY,
    ),
    timeoutMs,
  };
}

function buildAxonHeaders(apiKey, includeJson = false) {
  const headers = {
    Accept: "application/json",
  };
  if (includeJson) {
    headers["Content-Type"] = "application/json";
  }
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  return headers;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = AXON_DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const rawText = await response.text();
    let payload = null;
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const detail = asText(payload?.detail || payload?.error || payload?.message || rawText);
      throw new Error(
        `HTTP ${response.status}${detail ? `: ${detail.slice(0, AXON_RESULT_TEXT_MAX_CHARS)}` : ""}`,
      );
    }

    return payload;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function buildAxonSearchQuery(question, clickContext) {
  const parts = [asText(question), asText(clickContext?.targetText)].filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, AXON_QUERY_MAX_LENGTH);
}

function normalizeAxonSearchResults(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.results)
        ? payload.results
        : [];

  return rows
    .slice(0, AXON_MAX_RESULTS)
    .map((row) => ({
      symbolId: toFiniteNumber(row?.symbol_id || row?.id),
      filePath: asText(row?.file_path || row?.path || row?.source_path),
      name: asText(row?.name || row?.symbol_name || row?.title),
      kind: asText(row?.kind || row?.symbol_kind),
      repositoryName: asText(row?.repository_name),
      score: toFiniteNumber(row?.score || row?.rank || row?.relevance_score),
      startLine: toFiniteNumber(row?.start_line || row?.line || row?.line_number),
      endLine: toFiniteNumber(row?.end_line || row?.line_end),
      signature: asText(row?.signature).slice(0, AXON_RESULT_TEXT_MAX_CHARS),
      documentation: asText(row?.documentation).slice(0, AXON_RESULT_TEXT_MAX_CHARS),
      codeSnippet: asText(row?.code_snippet || row?.snippet || row?.content).slice(
        0,
        AXON_RESULT_TEXT_MAX_CHARS,
      ),
    }))
    .filter((row) => row.symbolId || row.filePath || row.name);
}

function normalizeMcpContent(payload) {
  const items = Array.isArray(payload?.content) ? payload.content : [];
  return items
    .map((item) => asText(item?.text))
    .filter(Boolean)
    .join("\n")
    .slice(0, AXON_SYMBOL_CONTEXT_MAX_CHARS);
}

function formatAxonScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "?";
  return numeric.toFixed(3);
}

async function queryAxonEvidence({ question, clickContext }) {
  const config = resolveAxonConfig();
  const query = buildAxonSearchQuery(question, clickContext);

  if (!query || query.length < 2) {
    return {
      status: "skipped",
      message: "Query too short for Axon search.",
      query,
      repositoryId: null,
      results: [],
      symbolContext: "",
    };
  }

  if (!config.enabled) {
    return {
      status: "unavailable",
      message: config.reason,
      query,
      repositoryId: null,
      results: [],
      symbolContext: "",
    };
  }

  try {
    const params = new URLSearchParams({
      query,
      limit: String(AXON_MAX_RESULTS),
      hybrid: "true",
    });
    if (config.repositoryId) {
      params.set("repository_id", String(config.repositoryId));
    }

    const searchUrl = `${config.baseUrl}/search?${params.toString()}`;
    const searchPayload = await fetchJsonWithTimeout(
      searchUrl,
      {
        method: "GET",
        headers: buildAxonHeaders(config.apiKey, false),
      },
      config.timeoutMs,
    );

    const results = normalizeAxonSearchResults(searchPayload);
    let symbolContext = "";
    if (results.length && results[0]?.symbolId) {
      try {
        const mcpPayload = await fetchJsonWithTimeout(
          `${config.baseUrl}/mcp/tools/get_symbol_context`,
          {
            method: "POST",
            headers: buildAxonHeaders(config.apiKey, true),
            body: JSON.stringify({
              symbol_id: results[0].symbolId,
              include_relationships: true,
            }),
          },
          config.timeoutMs,
        );
        symbolContext = normalizeMcpContent(mcpPayload);
      } catch {
        symbolContext = "";
      }
    }

    return {
      status: "ok",
      message: "",
      query,
      repositoryId: config.repositoryId,
      results,
      symbolContext,
    };
  } catch (error) {
    return {
      status: "error",
      message: asText(error?.message) || "Axon request failed.",
      query,
      repositoryId: config.repositoryId,
      results: [],
      symbolContext: "",
    };
  }
}

function buildAxonContextBlock(axonEvidence) {
  const evidence = axonEvidence && typeof axonEvidence === "object" ? axonEvidence : {};
  const lines = [];
  lines.push("Axon evidence:");
  lines.push(`Axon status: ${asText(evidence.status) || "unknown"}`);
  if (asText(evidence.query)) {
    lines.push(`Axon query: ${asText(evidence.query)}`);
  }
  if (evidence.repositoryId) {
    lines.push(`Axon repository_id: ${evidence.repositoryId}`);
  }
  if (asText(evidence.message)) {
    lines.push(`Axon message: ${asText(evidence.message)}`);
  }

  const results = Array.isArray(evidence.results) ? evidence.results : [];
  if (!results.length) {
    lines.push("Axon matches: none");
  } else {
    lines.push("Axon matches:");
    results.forEach((row, index) => {
      const pathPart = asText(row.filePath)
        ? `${asText(row.filePath)}${
            row.startLine && Number.isFinite(row.startLine) ? `:${Math.trunc(row.startLine)}` : ""
          }`
        : "path:unknown";
      const symbolPart = asText(row.name) || asText(row.kind) || "unknown symbol";
      lines.push(
        `${index + 1}. ${symbolPart} | ${pathPart} | kind=${asText(row.kind) || "?"} | score=${formatAxonScore(row.score)}`,
      );
      if (asText(row.signature)) {
        lines.push(`   signature: ${asText(row.signature)}`);
      }
      if (asText(row.codeSnippet)) {
        lines.push(`   snippet: ${asText(row.codeSnippet)}`);
      } else if (asText(row.documentation)) {
        lines.push(`   docs: ${asText(row.documentation)}`);
      }
    });
  }

  if (asText(evidence.symbolContext)) {
    lines.push("Axon top symbol context:");
    lines.push(asText(evidence.symbolContext));
  }

  return lines.join("\n");
}

function buildSystemPrompt() {
  return [
    "You are Clarivore's admin diagram assistant.",
    "Your job is to answer questions about Clarivore data-flow visuals in plain language.",
    "Use only the provided diagram metadata, Mermaid source, click context, and Axon evidence.",
    "Axon evidence should be treated as fresh code-index context for each user question.",
    "When relevant, explicitly mention allowed user types and page/surface routes.",
    "When relevant, mention function/file locations from either the Mermaid map or Axon matches.",
    "If Axon status is unavailable/error, say that briefly and continue with the diagram context.",
    "If the answer cannot be inferred from the provided context, say that directly.",
    "Keep answers concise and practical for an admin operator.",
  ].join(" ");
}

function buildDiagramContextBlock({ entry, sourceText, clickContext, axonEvidence }) {
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
  lines.push("");
  lines.push(buildAxonContextBlock(axonEvidence));
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
    const axonEvidence = await queryAxonEvidence({ question, clickContext });
    const diagramContext = buildDiagramContextBlock({
      entry,
      sourceText: asText(sourceText),
      clickContext,
      axonEvidence,
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

    return json(
      {
        success: true,
        answer,
        axon: {
          status: asText(axonEvidence?.status),
          query: asText(axonEvidence?.query),
          resultCount: Array.isArray(axonEvidence?.results) ? axonEvidence.results.length : 0,
          message: asText(axonEvidence?.message),
        },
      },
      200,
    );
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
