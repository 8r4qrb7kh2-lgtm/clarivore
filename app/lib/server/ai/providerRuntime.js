import fsp from "node:fs/promises";
import path from "node:path";

import {
  estimateUsageCostUsd,
  getShadowProviderPair,
  resolveModelForPromptClass,
  resolveProviderMode,
} from "./modelCatalog.js";

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeHeadersMap(headers) {
  const out = {};
  if (!headers || typeof headers?.forEach !== "function") return out;
  headers.forEach((value, key) => {
    out[String(key)] = String(value);
  });
  return out;
}

function readRequestTimeoutMs(env, provider) {
  const providerKey = provider === "openai" ? "OPENAI_REQUEST_TIMEOUT_MS" : "ANTHROPIC_REQUEST_TIMEOUT_MS";
  const directValue = Number(env?.[providerKey]);
  if (Number.isFinite(directValue) && directValue > 0) {
    return Math.trunc(directValue);
  }

  const sharedValue = Number(env?.AI_PROVIDER_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(sharedValue) && sharedValue > 0) {
    return Math.trunc(sharedValue);
  }

  return 120_000;
}

async function fetchWithTimeout(url, options, provider, env) {
  const timeoutMs = readRequestTimeoutMs(env, provider);
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new Error(`${provider} API request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  }
}

function nowIsoCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function buildOutDir(runId) {
  return path.join(process.cwd(), "out", "ai-benchmarks", runId);
}

function safeSerialize(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

let cachedRunId = "";

function resolveRunId(env = process.env) {
  const envRunId = asText(env?.AI_BENCHMARK_RUN_ID);
  if (envRunId) return envRunId;
  if (!cachedRunId) cachedRunId = nowIsoCompact();
  return cachedRunId;
}

function loggingEnabled(env = process.env, providerMode = "") {
  const token = asText(env?.AI_BENCHMARK_LOGGING).toLowerCase();
  return providerMode === "shadow" || token === "1" || token === "true" || token === "yes";
}

async function appendShadowLog(entry, env = process.env) {
  const runId = resolveRunId(env);
  const outDir = buildOutDir(runId);
  await fsp.mkdir(outDir, { recursive: true });
  const logPath = path.join(outDir, "shadow-runs.jsonl");
  await fsp.appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function normalizeUsage(provider, payload) {
  if (provider === "anthropic") {
    return {
      input_tokens: Number(payload?.usage?.input_tokens || 0),
      output_tokens: Number(payload?.usage?.output_tokens || 0),
      total_tokens:
        Number(payload?.usage?.input_tokens || 0) + Number(payload?.usage?.output_tokens || 0),
    };
  }

  const inputTokens = Number(
    payload?.usage?.input_tokens ||
      payload?.usage?.prompt_tokens ||
      payload?.usage?.inputTokens ||
      0,
  );
  const outputTokens = Number(
    payload?.usage?.output_tokens ||
      payload?.usage?.completion_tokens ||
      payload?.usage?.outputTokens ||
      0,
  );
  const totalTokens = Number(
    payload?.usage?.total_tokens ||
      payload?.usage?.totalTokens ||
      inputTokens + outputTokens,
  );
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

function extractAnthropicText(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  return blocks
    .filter(
      (block) =>
        block &&
        typeof block === "object" &&
        typeof block.text === "string" &&
        (block.type === "text" || block.type === "output_text" || !block.type),
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function isGpt5Model(model) {
  return /^gpt-5/i.test(asText(model));
}

function supportsOpenAiTemperature(model) {
  return !isGpt5Model(model);
}

function supportsOpenAiReasoning(model) {
  return isGpt5Model(model);
}

function collectTextSegments(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const text = value
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (entry && typeof entry === "object" && typeof entry.text === "string") {
          return entry.text.trim();
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

function parseStructuredJsonValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractOpenAiText(payload) {
  const directOutputText = collectTextSegments(payload?.output_text);
  if (directOutputText) return directOutputText;
  if (payload?.output_parsed !== undefined && payload?.output_parsed !== null) {
    return JSON.stringify(payload.output_parsed);
  }
  if (typeof payload?.text === "string" && payload.text.trim()) {
    return payload.text.trim();
  }

  const stack = Array.isArray(payload?.output) ? [...payload.output] : [];
  while (stack.length) {
    const current = stack.shift();
    if (!current || typeof current !== "object") continue;

    const currentText = collectTextSegments(current.text);
    if (currentText) return currentText;
    const currentOutputText = collectTextSegments(current.output_text);
    if (currentOutputText) return currentOutputText;
    if (typeof current.json === "string" && current.json.trim()) return current.json.trim();
    if (current.json && typeof current.json === "object") {
      return JSON.stringify(current.json);
    }
    if (typeof current.arguments === "string" && current.arguments.trim()) {
      return current.arguments.trim();
    }
    if (current.arguments && typeof current.arguments === "object") {
      return JSON.stringify(current.arguments);
    }
    if (Array.isArray(current.content)) stack.push(...current.content);
  }

  return "";
}

function extractOpenAiParsed(payload) {
  const topLevelParsed = parseStructuredJsonValue(payload?.output_parsed);
  if (topLevelParsed !== null) return topLevelParsed;

  const stack = Array.isArray(payload?.output) ? [...payload.output] : [];
  while (stack.length) {
    const current = stack.shift();
    if (!current || typeof current !== "object") continue;

    const currentParsed =
      parseStructuredJsonValue(current.parsed) ||
      parseStructuredJsonValue(current.output_parsed) ||
      parseStructuredJsonValue(current.json) ||
      parseStructuredJsonValue(current.arguments);
    if (currentParsed !== null) {
      return currentParsed;
    }

    if (Array.isArray(current.content)) stack.push(...current.content);
  }

  return null;
}

function buildOpenAiJsonSchema(promptClass, jsonSchema) {
  if (!jsonSchema?.schema) return null;
  const baseName = asText(jsonSchema?.name) || `${promptClass}_response`;
  if (asText(jsonSchema?.schema?.type).toLowerCase() === "object") {
    return {
      unwrapValue: false,
      format: {
        type: "json_schema",
        name: baseName,
        schema: jsonSchema.schema,
        strict: jsonSchema?.strict !== false,
      },
    };
  }

  return {
    unwrapValue: true,
    format: {
      type: "json_schema",
      name: baseName,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: {
          value: jsonSchema.schema,
        },
      },
      strict: jsonSchema?.strict !== false,
    },
  };
}

function unwrapOpenAiStructuredText(text, schemaSpec) {
  if (!schemaSpec?.unwrapValue) return text;
  try {
    const parsed = JSON.parse(asText(text));
    if (parsed && typeof parsed === "object" && "value" in parsed) {
      return JSON.stringify(parsed.value);
    }
  } catch {
    return text;
  }
  return text;
}

function unwrapOpenAiStructuredValue(value, schemaSpec) {
  if (!schemaSpec?.unwrapValue) return value;
  if (value && typeof value === "object" && "value" in value) {
    return value.value;
  }
  return value;
}

function toAnthropicMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const role = asText(message?.role) === "assistant" ? "assistant" : "user";
    const rawContent = Array.isArray(message?.content)
      ? message.content
      : [{ type: "text", text: asText(message?.content) }];
    const content = rawContent
      .map((part) => {
        const type = asText(part?.type).toLowerCase();
        if (type === "image") {
          return {
            type: "image",
            source: {
              type: "base64",
              media_type: asText(part?.mediaType) || "image/jpeg",
              data: asText(part?.base64Data),
            },
          };
        }
        return {
          type: "text",
          text: asText(part?.text ?? part),
        };
      })
      .filter((part) => (part.type === "image" ? part.source.data : part.text));
    return { role, content };
  });
}

function toOpenAiInput(messages) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const role = asText(message?.role) === "assistant" ? "assistant" : "user";
    const rawContent = Array.isArray(message?.content)
      ? message.content
      : [{ type: "text", text: asText(message?.content) }];
    const content = rawContent
      .map((part) => {
        const type = asText(part?.type).toLowerCase();
        if (type === "image") {
          const mediaType = asText(part?.mediaType) || "image/jpeg";
          const base64Data = asText(part?.base64Data);
          if (!base64Data) return null;
          return {
            type: "input_image",
            image_url: `data:${mediaType};base64,${base64Data}`,
          };
        }

        const text = asText(part?.text ?? part);
        if (!text) return null;
        return {
          type: role === "assistant" ? "output_text" : "input_text",
          text,
        };
      })
      .filter(Boolean);
    return { role, content };
  });
}

async function parseJsonPayload(response) {
  const rawText = await response.text();
  let payload = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = null;
  }
  return { rawText, payload };
}

export async function callAnthropicApi({
  promptClass,
  systemPrompt,
  messages,
  maxTokens = 1024,
  temperature,
  thinkingBudgetTokens,
  metadata,
  env = process.env,
}) {
  const apiKey = asText(env?.ANTHROPIC_API_KEY);
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const model = resolveModelForPromptClass(promptClass, "anthropic", env);
  const requestedMaxTokens = Math.max(1, Number(maxTokens) || 0);
  const thinkingBudget = Number.isFinite(Number(thinkingBudgetTokens)) && Number(thinkingBudgetTokens) > 0
    ? Math.trunc(Number(thinkingBudgetTokens))
    : 0;
  const safeMaxTokens =
    thinkingBudget > 0 && requestedMaxTokens <= thinkingBudget
      ? thinkingBudget + Math.max(256, Math.min(requestedMaxTokens, 512))
      : requestedMaxTokens;
  const body = {
    model,
    max_tokens: safeMaxTokens,
    messages: toAnthropicMessages(messages),
  };
  if (asText(systemPrompt)) body.system = asText(systemPrompt);
  if (typeof temperature === "number") body.temperature = temperature;
  if (thinkingBudget > 0) {
    body.thinking = {
      type: "enabled",
      budget_tokens: thinkingBudget,
    };
  }
  if (metadata && typeof metadata === "object") {
    body.metadata = metadata;
  }

  const startedAt = Date.now();
  const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  }, "anthropic", env);
  const latencyMs = Date.now() - startedAt;
  const { rawText, payload } = await parseJsonPayload(response);
  if (!response.ok) {
    const message =
      asText(payload?.error?.message) ||
      asText(payload?.error) ||
      asText(rawText) ||
      "Anthropic API request failed.";
    throw new Error(message);
  }

  const text = extractAnthropicText(payload) || asText(payload?.content);
  const usage = normalizeUsage("anthropic", payload);
  return {
    provider: "anthropic",
    model,
    text,
    usage,
    latencyMs,
    rawResponse: payload,
    rawText,
    requestId:
      asText(response.headers.get("request-id")) ||
      asText(response.headers.get("x-request-id")),
    responseHeaders: normalizeHeadersMap(response.headers),
  };
}

export async function callOpenAiApi({
  promptClass,
  systemPrompt,
  messages,
  maxTokens = 1024,
  temperature,
  reasoningEffort,
  jsonSchema,
  metadata,
  env = process.env,
}) {
  const apiKey = asText(env?.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const model = resolveModelForPromptClass(promptClass, "openai", env);
  const openAiSchema = buildOpenAiJsonSchema(promptClass, jsonSchema);
  const body = {
    model,
    store: false,
    input: toOpenAiInput(messages),
    max_output_tokens: Math.max(1, Number(maxTokens) || 0),
  };
  if (asText(systemPrompt)) body.instructions = asText(systemPrompt);
  if (typeof temperature === "number" && supportsOpenAiTemperature(model)) {
    body.temperature = temperature;
  }
  if (asText(reasoningEffort) && supportsOpenAiReasoning(model)) {
    body.reasoning = { effort: asText(reasoningEffort).toLowerCase() };
  }
  if (openAiSchema?.format) {
    body.text = {
      format: openAiSchema.format,
    };
  }
  if (metadata && typeof metadata === "object") {
    body.metadata = metadata;
  }

  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  const org = asText(env?.OPENAI_ORG_ID);
  if (org) headers["OpenAI-Organization"] = org;
  const project = asText(env?.OPENAI_PROJECT_ID);
  if (project) headers["OpenAI-Project"] = project;

  const startedAt = Date.now();
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }, "openai", env);
  const latencyMs = Date.now() - startedAt;
  const { rawText, payload } = await parseJsonPayload(response);
  if (!response.ok) {
    const message =
      asText(payload?.error?.message) ||
      asText(payload?.error?.type) ||
      asText(payload?.error) ||
      asText(rawText) ||
      "OpenAI Responses API request failed.";
    throw new Error(message);
  }

  const parsed = unwrapOpenAiStructuredValue(extractOpenAiParsed(payload), openAiSchema);
  const extractedText = extractOpenAiText(payload);
  const textSource =
    extractedText || (parsed !== null && parsed !== undefined ? JSON.stringify(parsed) : "");
  const text = unwrapOpenAiStructuredText(textSource, openAiSchema);
  const usage = normalizeUsage("openai", payload);
  return {
    provider: "openai",
    model,
    text,
    parsed,
    usage,
    latencyMs,
    rawResponse: payload,
    rawText,
    requestId:
      asText(response.headers.get("x-request-id")) ||
      asText(response.headers.get("request-id")),
    responseHeaders: normalizeHeadersMap(response.headers),
  };
}

export async function runWithProviderSelection({
  routeId,
  promptClass,
  requestSummary = {},
  invokeProvider,
  env = process.env,
}) {
  const providerMode = resolveProviderMode(env);
  if (providerMode === "anthropic" || providerMode === "openai") {
    const result = await invokeProvider(providerMode);
    if (loggingEnabled(env, providerMode)) {
      await appendShadowLog(
        {
          at: new Date().toISOString(),
          routeId,
          promptClass,
          providerMode,
          requestSummary: safeSerialize(requestSummary, {}),
          primary: {
            provider: result?.provider,
            model: result?.model,
            latencyMs: result?.latencyMs,
            usage: result?.usage,
            estimatedCostUsd: estimateUsageCostUsd(result),
            normalizedOutput: safeSerialize(result?.normalizedOutput, null),
            rawText: asText(result?.rawText).slice(0, 100_000),
            requestId: result?.requestId || null,
          },
        },
        env,
      );
    }
    return result;
  }

  const { primary, secondary } = getShadowProviderPair(env);
  const [primarySettled, secondarySettled] = await Promise.allSettled([
    invokeProvider(primary),
    invokeProvider(secondary),
  ]);

  const primaryResult =
    primarySettled.status === "fulfilled" ? primarySettled.value : null;
  const secondaryResult =
    secondarySettled.status === "fulfilled" ? secondarySettled.value : null;

  await appendShadowLog(
    {
      at: new Date().toISOString(),
      routeId,
      promptClass,
      providerMode,
      requestSummary: safeSerialize(requestSummary, {}),
      primaryProvider: primary,
      secondaryProvider: secondary,
      primary:
        primarySettled.status === "fulfilled"
          ? {
              provider: primaryResult?.provider,
              model: primaryResult?.model,
              latencyMs: primaryResult?.latencyMs,
              usage: primaryResult?.usage,
              estimatedCostUsd: estimateUsageCostUsd(primaryResult),
              normalizedOutput: safeSerialize(primaryResult?.normalizedOutput, null),
              rawText: asText(primaryResult?.rawText).slice(0, 100_000),
              requestId: primaryResult?.requestId || null,
            }
          : {
              provider: primary,
              error: asText(primarySettled.reason?.message || primarySettled.reason),
            },
      secondary:
        secondarySettled.status === "fulfilled"
          ? {
              provider: secondaryResult?.provider,
              model: secondaryResult?.model,
              latencyMs: secondaryResult?.latencyMs,
              usage: secondaryResult?.usage,
              estimatedCostUsd: estimateUsageCostUsd(secondaryResult),
              normalizedOutput: safeSerialize(secondaryResult?.normalizedOutput, null),
              rawText: asText(secondaryResult?.rawText).slice(0, 100_000),
              requestId: secondaryResult?.requestId || null,
            }
          : {
              provider: secondary,
              error: asText(secondarySettled.reason?.message || secondarySettled.reason),
            },
    },
    env,
  );

  if (primarySettled.status !== "fulfilled") {
    throw primarySettled.reason;
  }

  return primaryResult;
}

export function createTextMessage(text) {
  return { type: "text", text: asText(text) };
}

export function createImageMessage({ mediaType, base64Data }) {
  return {
    type: "image",
    mediaType: asText(mediaType) || "image/jpeg",
    base64Data: asText(base64Data),
  };
}
