import { corsJson, corsOptions } from "../_shared/cors";

export const runtime = "nodejs";

function asText(value) {
  return String(value ?? "").trim();
}

function parseImageData(value) {
  const imageData = asText(value);
  if (!imageData) return null;

  if (imageData.startsWith("data:") && imageData.includes(",")) {
    const [header, base64Data] = imageData.split(",", 2);
    const mediaType = asText(header.split(";")[0]?.replace("data:", "")) || "image/jpeg";
    if (!base64Data) return null;
    return {
      base64Data,
      mediaType,
    };
  }

  return {
    base64Data: imageData,
    mediaType: "image/jpeg",
  };
}

function parseClaudeJson(value) {
  const text = asText(value);
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        // continue
      }
    }

    const objectMatch = text.match(/\{[\s\S]*\}/);
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

export function OPTIONS() {
  return corsOptions();
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsJson(
      {
        success: false,
        error: "Invalid JSON payload.",
        dishes: [],
      },
      { status: 400 },
    );
  }

  const imageData = parseImageData(body?.imageData);
  if (!imageData) {
    return corsJson(
      {
        success: false,
        error: "No image data provided.",
        dishes: [],
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
        dishes: [],
      },
      { status: 500 },
    );
  }

  try {
    const systemPrompt = `You are a menu analysis assistant. Your job is to identify all dishes on a restaurant menu image.

Simply list all the menu items you can see. Don't worry about coordinates - just extract the dish names.

Return ONLY a JSON object in this exact format:
{
  "dishes": [
    {"name": "Dish Name 1"},
    {"name": "Dish Name 2"},
    {"name": "Dish Name 3"}
  ]
}

Rules:
- Include EVERY menu item you can see
- Use the exact name as it appears on the menu
- Don't include section headers (like "Appetizers", "Entrees")
- Don't include prices or descriptions, just the dish name
- Return ONLY the JSON, no other text`;

    const userPrompt =
      "Analyze this restaurant menu image and list ALL menu items you can see. Return only a JSON object with a dishes array containing objects with name properties.";

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
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
                  media_type: imageData.mediaType,
                  data: imageData.base64Data,
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
      throw new Error(`Claude API error (${claudeResponse.status}): ${errorText.slice(0, 240)}`);
    }

    const aiResult = await claudeResponse.json();
    const responseText = asText(aiResult?.content?.[0]?.text);
    const parsed = parseClaudeJson(responseText);
    const dishes = (Array.isArray(parsed?.dishes) ? parsed.dishes : [])
      .map((dish) => ({
        name: asText(dish?.name),
        mapped: false,
      }))
      .filter((dish) => dish.name);

    return corsJson({ success: true, dishes }, { status: 200 });
  } catch (error) {
    return corsJson(
      {
        success: false,
        error: asText(error?.message) || "Failed to process request.",
        dishes: [],
      },
      { status: 500 },
    );
  }
}
