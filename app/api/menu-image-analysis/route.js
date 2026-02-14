import { corsJson, corsOptions } from "../_shared/cors";

export const runtime = "nodejs";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseImageData(imageData) {
  const value = asText(imageData);
  if (!value) return null;

  if (value.startsWith("data:") && value.includes(",")) {
    const [header, base64Data] = value.split(",", 2);
    const mediaType = asText(header.split(";")[0]?.replace("data:", "")) || "image/jpeg";
    if (!base64Data) return null;
    return { mediaType, base64Data };
  }

  return {
    mediaType: "image/jpeg",
    base64Data: value,
  };
}

function parseClaudeJson(responseText) {
  const value = asText(responseText);
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        // Continue to fallback extraction.
      }
    }

    const objectMatch = value.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        // Continue to fallback extraction.
      }
    }
  }

  return null;
}

function sanitizeDetectedDish(entry) {
  const name = asText(entry?.name || entry?.dishName || entry?.item);
  if (!name) return null;

  const rawX = Number(entry?.x ?? entry?.left);
  const rawY = Number(entry?.y ?? entry?.top);
  const rawW = Number(entry?.w ?? entry?.width);
  const rawH = Number(entry?.h ?? entry?.height);

  if (
    !Number.isFinite(rawX) ||
    !Number.isFinite(rawY) ||
    !Number.isFinite(rawW) ||
    !Number.isFinite(rawH)
  ) {
    return null;
  }

  let x = clamp(rawX, 0, 100);
  let y = clamp(rawY, 0, 100);
  let w = clamp(rawW, 0.5, 100);
  let h = clamp(rawH, 0.5, 100);

  if (x > 99.5) x = 99.5;
  if (y > 99.5) y = 99.5;

  w = clamp(w, 0.5, 100 - x);
  h = clamp(h, 0.5, 100 - y);

  return {
    name,
    x: Number(x.toFixed(3)),
    y: Number(y.toFixed(3)),
    w: Number(w.toFixed(3)),
    h: Number(h.toFixed(3)),
  };
}

function dedupeDishes(dishes) {
  const seen = new Set();
  return (Array.isArray(dishes) ? dishes : []).filter((dish) => {
    const token = normalizeToken(dish?.name);
    if (!token || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

function extractTextContent(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const text = blocks
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

  return text || asText(payload?.content);
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
      { success: false, error: "Invalid JSON payload.", dishes: [] },
      { status: 400 },
    );
  }

  const imageData = asText(body?.imageData);
  if (!imageData) {
    return corsJson(
      { success: false, error: "imageData is required.", dishes: [] },
      { status: 400 },
    );
  }

  const anthropicApiKey = asText(process.env.ANTHROPIC_API_KEY);
  if (!anthropicApiKey) {
    return corsJson(
      { success: false, error: "ANTHROPIC_API_KEY is not configured.", dishes: [] },
      { status: 500 },
    );
  }

  const parsedImage = parseImageData(imageData);
  if (!parsedImage) {
    return corsJson(
      { success: false, error: "Unable to parse menu image payload.", dishes: [] },
      { status: 400 },
    );
  }

  try {
    const model = asText(process.env.ANTHROPIC_MODEL) || DEFAULT_ANTHROPIC_MODEL;

    const systemPrompt = `You are a restaurant menu OCR + localization assistant.
Return ONLY valid JSON.

You must detect visible dish/menu item names and output a tight bounding box for each item.
Coordinates must be percentages of the full image:
- x: left position (0-100)
- y: top position (0-100)
- w: width (0-100)
- h: height (0-100)

Required output schema:
{
  "dishes": [
    { "name": "Dish name", "x": 0, "y": 0, "w": 0, "h": 0 }
  ]
}

Rules:
- Include only real menu dishes/items.
- Exclude section headers, category labels, prices-only rows, and decorative text.
- Keep one entry per dish name.
- If uncertain, omit the item.
- No markdown, no commentary, no extra keys.`;

    const userPrompt =
      "Analyze this menu image and return dish names with tight bounding boxes.";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: parsedImage.mediaType,
                  data: parsedImage.base64Data,
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

    const payloadText = await response.text();
    let payload = null;
    try {
      payload = payloadText ? JSON.parse(payloadText) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message =
        asText(payload?.error?.message) ||
        asText(payload?.error) ||
        asText(payloadText) ||
        "Menu image analysis request failed.";
      throw new Error(message);
    }

    const parsedResult = parseClaudeJson(extractTextContent(payload));
    const rawDishes = Array.isArray(parsedResult?.dishes)
      ? parsedResult.dishes
      : Array.isArray(parsedResult?.items)
        ? parsedResult.items
        : [];

    const dishes = dedupeDishes(rawDishes.map((entry) => sanitizeDetectedDish(entry)).filter(Boolean));

    return corsJson(
      {
        success: true,
        dishes,
      },
      { status: 200 },
    );
  } catch (error) {
    return corsJson(
      {
        success: false,
        error: asText(error?.message) || "Failed to analyze menu image.",
        dishes: [],
      },
      { status: 500 },
    );
  }
}
