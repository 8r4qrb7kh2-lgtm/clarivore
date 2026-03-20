import { corsJson, corsOptions } from "../_shared/cors";
import { buildConfirmInfoComparisonPrompts } from "../../lib/claudePrompts";
import {
  callAnthropicApi,
  callOpenAiApi,
  createImageMessage,
  createTextMessage,
  runWithProviderSelection,
} from "../../lib/server/ai/providerRuntime";
import { confirmInfoCompareSchema } from "../../lib/server/ai/responseSchemas";

export const runtime = "nodejs";

const ALLOWED_KINDS = new Set(["menu_page", "brand_item"]);

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeConfidence(value) {
  const token = asText(value).toLowerCase();
  if (token === "high" || token === "medium" || token === "low") {
    return token;
  }
  return "low";
}

function dedupeStrings(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => asText(value))
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

class RequestError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "RequestError";
    this.statusCode = statusCode;
  }
}

async function parseImageInput(value) {
  const raw = asText(value);
  if (!raw) {
    throw new RequestError("Image payload is required.", 400);
  }

  if (/^https?:\/\//i.test(raw)) {
    const response = await fetch(raw, { method: "GET", cache: "no-store" });
    if (!response.ok) {
      throw new RequestError(`Failed to load image URL (${response.status}).`, 400);
    }

    const contentType = asText(response.headers.get("content-type")).split(";")[0] || "image/jpeg";
    const bytes = await response.arrayBuffer();
    const base64Data = Buffer.from(bytes).toString("base64");
    if (!base64Data) {
      throw new RequestError("Failed to read image URL payload.", 400);
    }

    return {
      mediaType: contentType,
      base64Data,
    };
  }

  if (raw.startsWith("data:")) {
    const match = raw.match(/^data:(.*?);base64,([\s\S]+)$/i);
    if (!match) {
      throw new RequestError("Invalid data URL image payload.", 400);
    }

    const mediaType = asText(match[1]) || "image/jpeg";
    const base64Data = asText(match[2]).replace(/\s/g, "");
    if (!base64Data) {
      throw new RequestError("Image payload is empty.", 400);
    }

    return {
      mediaType,
      base64Data,
    };
  }

  const cleaned = raw.replace(/\s/g, "");
  if (!cleaned || !/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
    throw new RequestError("Unsupported image payload format.", 400);
  }

  return {
    mediaType: "image/jpeg",
    base64Data: cleaned,
  };
}

function parseClaudeJson(value) {
  const safe = asText(value);
  if (!safe) return null;

  try {
    return JSON.parse(safe);
  } catch {
    const fencedMatch = safe.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      try {
        return JSON.parse(fencedMatch[1]);
      } catch {
        // Continue to fallback parsing.
      }
    }

    const objectMatch = safe.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }
  }

  return null;
}

function buildComparisonPrompts(kind, label) {
  return buildConfirmInfoComparisonPrompts(kind, label);
}

function normalizeComparisonResult(modelText) {
  if (!modelText) {
    throw new RequestError("Comparison response was empty.", 502);
  }

  const parsed = parseClaudeJson(modelText);
  if (!parsed || typeof parsed !== "object") {
    throw new RequestError("Failed to parse comparison response JSON.", 502);
  }

  const confidence = normalizeConfidence(parsed.confidence);
  const differences = dedupeStrings(parsed.differences).slice(0, 10);
  const rawSummary = asText(parsed.summary);
  const explicitMatch = parsed.match === true;
  const inferredAmbiguous = typeof parsed.match !== "boolean";

  let match = explicitMatch;
  if (confidence === "low" || inferredAmbiguous) {
    match = false;
  }

  const summary = rawSummary
    ? rawSummary
    : match
      ? "Images were determined to match."
      : "Images were determined to not match.";

  return {
    success: true,
    match,
    confidence,
    summary,
    differences,
  };
}

async function compareWithProvider({
  provider,
  kind,
  label,
  baselineImage,
  candidateImage,
}) {
  const { systemPrompt, userPrompt } = buildComparisonPrompts(kind, label);
  const response =
    provider === "openai"
      ? await callOpenAiApi({
          promptClass: "confirmInfoCompare",
          systemPrompt,
          messages: [
            {
              role: "user",
              content: [
                createImageMessage(baselineImage),
                createImageMessage(candidateImage),
                createTextMessage(userPrompt),
              ],
            },
          ],
          maxTokens: 800,
          jsonSchema: confirmInfoCompareSchema,
        })
      : await callAnthropicApi({
          promptClass: "confirmInfoCompare",
          systemPrompt,
          messages: [
            {
              role: "user",
              content: [
                createImageMessage(baselineImage),
                createImageMessage(candidateImage),
                createTextMessage(userPrompt),
              ],
            },
          ],
          maxTokens: 800,
        });

  return {
    ...response,
    normalizedOutput: normalizeComparisonResult(response.text),
  };
}

export function OPTIONS() {
  return corsOptions();
}

export async function POST(request) {
  let body = null;
  try {
    body = await request.json();
  } catch {
    return corsJson(
      {
        success: false,
        error: "Invalid JSON payload.",
      },
      { status: 400 },
    );
  }

  try {
    const kind = asText(body?.kind);
    if (!ALLOWED_KINDS.has(kind)) {
      throw new RequestError("kind must be one of: menu_page, brand_item.", 400);
    }

    const baselineImageRaw = asText(body?.baselineImage);
    const candidateImageRaw = asText(body?.candidateImage);
    if (!baselineImageRaw || !candidateImageRaw) {
      throw new RequestError("baselineImage and candidateImage are required.", 400);
    }

    const baselineImage = await parseImageInput(baselineImageRaw);
    const candidateImage = await parseImageInput(candidateImageRaw);
    const label = asText(body?.label);
    const result = await runWithProviderSelection({
      routeId: "confirm-info-compare",
      promptClass: "confirmInfoCompare",
      requestSummary: {
        kind,
        label,
      },
      invokeProvider: (provider) =>
        compareWithProvider({
          provider,
          kind,
          label,
          baselineImage,
          candidateImage,
        }),
    });

    return corsJson(result.normalizedOutput, { status: 200 });
  } catch (error) {
    const statusCode = Number.isFinite(Number(error?.statusCode))
      ? Math.max(400, Math.min(599, Number(error.statusCode)))
      : 500;
    return corsJson(
      {
        success: false,
        error: asText(error?.message) || "Failed to compare images.",
      },
      { status: statusCode },
    );
  }
}
