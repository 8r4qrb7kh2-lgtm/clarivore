import { corsJson, corsOptions } from "../_shared/cors";
import { buildDetectMenuDishesPrompts } from "../../lib/claudePrompts";
import {
  callAnthropicApi,
  callOpenAiApi,
  createImageMessage,
  createTextMessage,
  runWithProviderSelection,
} from "../../lib/server/ai/providerRuntime";
import { detectMenuDishesSchema } from "../../lib/server/ai/responseSchemas";

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

  try {
    const { systemPrompt, userPrompt } = buildDetectMenuDishesPrompts();
    const result = await runWithProviderSelection({
      routeId: "detect-menu-dishes",
      promptClass: "detectMenuDishes",
      requestSummary: {
        mediaType: imageData.mediaType,
      },
      invokeProvider: async (provider) => {
        const response =
          provider === "openai"
            ? await callOpenAiApi({
                promptClass: "detectMenuDishes",
                systemPrompt,
                messages: [
                  {
                    role: "user",
                    content: [
                      createImageMessage(imageData),
                      createTextMessage(userPrompt),
                    ],
                  },
                ],
                maxTokens: 4000,
                jsonSchema: detectMenuDishesSchema,
              })
            : await callAnthropicApi({
                promptClass: "detectMenuDishes",
                systemPrompt,
                messages: [
                  {
                    role: "user",
                    content: [
                      createImageMessage(imageData),
                      createTextMessage(userPrompt),
                    ],
                  },
                ],
                maxTokens: 4000,
              });

        const parsed = parseClaudeJson(response.text);
        return {
          ...response,
          normalizedOutput: (Array.isArray(parsed?.dishes) ? parsed.dishes : [])
            .map((dish) => ({
              name: asText(dish?.name),
              mapped: false,
            }))
            .filter((dish) => dish.name),
        };
      },
    });

    return corsJson({ success: true, dishes: result.normalizedOutput }, { status: 200 });
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
