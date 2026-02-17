import { corsJson, corsOptions } from "../_shared/cors";

export const runtime = "nodejs";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeDimension(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return clamp(Math.round(parsed), 128, 6000);
}

function buildFallbackCorners(width, height) {
  const margin = Math.max(20, Math.round(Math.min(width, height) * 0.06));
  return {
    topLeft: { x: margin, y: margin },
    topRight: { x: width - margin, y: margin },
    bottomRight: { x: width - margin, y: height - margin },
    bottomLeft: { x: margin, y: height - margin },
  };
}

function parseAnthropicJson(text) {
  const trimmed = asText(text);
  if (!trimmed) return null;

  const codeFenceMatch =
    trimmed.match(/```json\s*([\s\S]*?)\s*```/i) ||
    trimmed.match(/```\s*([\s\S]*?)\s*```/i);
  const candidate = codeFenceMatch?.[1] || trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // continue
  }

  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  if (!objectMatch) return null;

  try {
    return JSON.parse(objectMatch[0]);
  } catch {
    return null;
  }
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function readPoint(input, fallback) {
  if (!input || typeof input !== "object") {
    return { ...fallback };
  }

  return {
    x: toFiniteNumber(input.x, fallback.x),
    y: toFiniteNumber(input.y, fallback.y),
  };
}

function pointArea(corners) {
  const polygon = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum / 2);
}

function normalizeCorners(raw, width, height) {
  const fallback = buildFallbackCorners(width, height);
  if (!raw || typeof raw !== "object") {
    return { valid: false, corners: fallback };
  }

  const object = raw.corners && typeof raw.corners === "object" ? raw.corners : raw;

  const corners = {
    topLeft: readPoint(object.topLeft, fallback.topLeft),
    topRight: readPoint(object.topRight, fallback.topRight),
    bottomRight: readPoint(object.bottomRight, fallback.bottomRight),
    bottomLeft: readPoint(object.bottomLeft, fallback.bottomLeft),
  };

  corners.topLeft.x = clamp(corners.topLeft.x, 0, width);
  corners.topLeft.y = clamp(corners.topLeft.y, 0, height);
  corners.topRight.x = clamp(corners.topRight.x, 0, width);
  corners.topRight.y = clamp(corners.topRight.y, 0, height);
  corners.bottomRight.x = clamp(corners.bottomRight.x, 0, width);
  corners.bottomRight.y = clamp(corners.bottomRight.y, 0, height);
  corners.bottomLeft.x = clamp(corners.bottomLeft.x, 0, width);
  corners.bottomLeft.y = clamp(corners.bottomLeft.y, 0, height);

  const area = pointArea(corners);
  const minArea = width * height * 0.12;
  const isValid =
    area >= minArea &&
    corners.topLeft.x < corners.topRight.x &&
    corners.bottomLeft.x < corners.bottomRight.x &&
    corners.topLeft.y < corners.bottomLeft.y &&
    corners.topRight.y < corners.bottomRight.y;

  if (!isValid) {
    return { valid: false, corners: fallback };
  }

  return { valid: true, corners };
}

function extractBase64ImageData(image) {
  const value = asText(image);
  if (value.startsWith("data:")) {
    const commaIndex = value.indexOf(",");
    const header = commaIndex >= 0 ? value.slice(0, commaIndex) : "";
    const data = commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
    const mediaMatch = header.match(/^data:([^;]+);base64$/i);
    return {
      base64Data: data,
      mediaType: mediaMatch?.[1] || "image/jpeg",
    };
  }

  return {
    base64Data: value,
    mediaType: "image/jpeg",
  };
}

export function OPTIONS() {
  return corsOptions();
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const image = asText(body?.image || body?.imageData);
  const width = normalizeDimension(body?.width, 1000);
  const height = normalizeDimension(body?.height, 1000);
  const fallbackCorners = buildFallbackCorners(width, height);

  if (!image) {
    return corsJson(
      {
        success: false,
        error: "No image data provided.",
        corners: fallbackCorners,
      },
      { status: 400 },
    );
  }

  const anthropicApiKey = asText(process.env.ANTHROPIC_API_KEY);
  if (!anthropicApiKey) {
    return corsJson(
      {
        success: false,
        error: "Anthropic API key not configured.",
        corners: fallbackCorners,
      },
      { status: 500 },
    );
  }

  try {
    const { base64Data, mediaType } = extractBase64ImageData(image);

    const systemPrompt = `You detect the exact four corners of a single menu page in an image.
Respond ONLY with valid JSON, no markdown.
Coordinates must be in image pixel space:
- x from 0 to ${width}
- y from 0 to ${height}
Return this exact shape:
{
  "corners": {
    "topLeft": {"x": 0, "y": 0},
    "topRight": {"x": ${width}, "y": 0},
    "bottomRight": {"x": ${width}, "y": ${height}},
    "bottomLeft": {"x": 0, "y": ${height}}
  },
  "description": "short note"
}`;

    const userPrompt =
      "Detect the four page corners for perspective correction. Prefer the physical sheet/page boundaries, not text blocks.";

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 600,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64Data,
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

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      throw new Error(
        `Corner detection model request failed (${claudeResponse.status}): ${errorText.slice(0, 240)}`,
      );
    }

    const aiResult = await claudeResponse.json();
    const responseText = asText(aiResult?.content?.[0]?.text);
    const parsed = parseAnthropicJson(responseText);
    const normalized = normalizeCorners(parsed, width, height);

    return corsJson(
      {
        success: true,
        corners: normalized.corners,
        description: asText(parsed?.description),
        usedFallback: !normalized.valid,
      },
      { status: 200 },
    );
  } catch (error) {
    return corsJson(
      {
        success: false,
        error: asText(error?.message) || "Failed to detect corners.",
        corners: fallbackCorners,
      },
      { status: 200 },
    );
  }
}
