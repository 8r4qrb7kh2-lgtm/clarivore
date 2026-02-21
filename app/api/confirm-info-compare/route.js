import { corsJson, corsOptions } from "../_shared/cors";
import { buildConfirmInfoComparisonPrompts } from "../../lib/claudePrompts";

export const runtime = "nodejs";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
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

function extractTextFromAnthropicPayload(payload) {
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

function buildComparisonPrompts(kind, label) {
  return buildConfirmInfoComparisonPrompts(kind, label);
}

async function compareWithClaude({
  apiKey,
  model,
  kind,
  label,
  baselineImage,
  candidateImage,
}) {
  const { systemPrompt, userPrompt } = buildComparisonPrompts(kind, label);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: asText(model) || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 800,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: baselineImage.mediaType,
                data: baselineImage.base64Data,
              },
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: candidateImage.mediaType,
                data: candidateImage.base64Data,
              },
            },
            {
              type: "text",
              text: userPrompt,
            },
          ],
        },
      ],
    }),
  });

  const responseText = await response.text();
  let responsePayload = null;
  try {
    responsePayload = responseText ? JSON.parse(responseText) : null;
  } catch {
    responsePayload = null;
  }

  if (!response.ok) {
    const providerMessage =
      asText(responsePayload?.error?.message) ||
      asText(responsePayload?.error) ||
      asText(responseText) ||
      "Claude comparison request failed.";
    throw new RequestError(providerMessage, 502);
  }

  const modelText =
    extractTextFromAnthropicPayload(responsePayload) || asText(responsePayload?.content);
  if (!modelText) {
    throw new RequestError("Claude comparison response was empty.", 502);
  }

  const parsed = parseClaudeJson(modelText);
  if (!parsed || typeof parsed !== "object") {
    throw new RequestError("Failed to parse Claude comparison response JSON.", 502);
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

    const anthropicApiKey = asText(process.env.ANTHROPIC_API_KEY);
    if (!anthropicApiKey) {
      throw new RequestError("ANTHROPIC_API_KEY is not configured.", 500);
    }

    const baselineImage = await parseImageInput(baselineImageRaw);
    const candidateImage = await parseImageInput(candidateImageRaw);
    const label = asText(body?.label);
    const model = asText(process.env.ANTHROPIC_MODEL) || DEFAULT_ANTHROPIC_MODEL;

    const result = await compareWithClaude({
      apiKey: anthropicApiKey,
      model,
      kind,
      label,
      baselineImage,
      candidateImage,
    });

    return corsJson(result, { status: 200 });
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
