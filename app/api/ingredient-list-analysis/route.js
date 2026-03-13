import { corsJson, corsOptions } from "../_shared/cors.js";
import { buildIngredientListSeparationPrompts } from "../../lib/claudePrompts.js";
import {
  callOpenAiApi,
  createTextMessage,
  runWithProviderSelection,
} from "../../lib/server/ai/providerRuntime.js";
import { ingredientListSeparationSchema } from "../../lib/server/ai/responseSchemas.js";

export const runtime = "nodejs";

function asText(value) {
  return String(value ?? "").trim();
}

function parseJsonObject(value) {
  const text = asText(value);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      try {
        return JSON.parse(fencedMatch[1]);
      } catch {
        return null;
      }
    }
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }
}

function normalizeLines(value) {
  return (Array.isArray(value) ? value : [])
    .map((line) => asText(line))
    .filter(Boolean);
}

function normalizeStringList(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((entry) => asText(entry))
    .filter(Boolean)
    .filter((entry) => {
      const token = entry.toLowerCase();
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });
}

function buildFailurePayload(message) {
  return {
    success: false,
    parsedIngredientsList: [],
    error: asText(message) || "Ingredient list analysis failed.",
  };
}

export function OPTIONS() {
  return corsOptions();
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsJson(buildFailurePayload("Invalid JSON payload."), { status: 400 });
  }

  const transcriptLines = normalizeLines(body?.transcriptLines);
  if (!transcriptLines.length) {
    return corsJson(
      {
        success: true,
        parsedIngredientsList: [],
      },
      { status: 200 },
    );
  }

  try {
    const { systemPrompt, userPrompt } = buildIngredientListSeparationPrompts({
      transcriptLines,
    });

    const openAiEnv = {
      ...process.env,
      AI_PROVIDER: "openai",
    };

    const result = await runWithProviderSelection({
      routeId: "ingredient-list-analysis",
      promptClass: "ingredientListSeparation",
      requestSummary: {
        transcriptLineCount: transcriptLines.length,
      },
      env: openAiEnv,
      invokeProvider: async (provider) => {
        if (provider !== "openai") {
          throw new Error("Ingredient list analysis is pinned to OpenAI for this route.");
        }

        const response = await callOpenAiApi({
          promptClass: "ingredientListSeparation",
          systemPrompt,
          messages: [{ role: "user", content: [createTextMessage(userPrompt)] }],
          maxTokens: 800,
          jsonSchema: ingredientListSeparationSchema,
          reasoningEffort: "medium",
          env: openAiEnv,
          metadata: {
            route_id: "ingredient-list-analysis",
          },
        });

        const parsed = parseJsonObject(response.text);
        const parsedIngredientsList = normalizeStringList(parsed?.parsed_ingredients);
        if (!parsedIngredientsList.length) {
          throw new Error(
            "Ingredient list analysis returned no parsed ingredients for a non-empty transcript.",
          );
        }
        return {
          ...response,
          normalizedOutput: {
            parsedIngredientsList,
          },
        };
      },
    });

    return corsJson(
      {
        success: true,
        parsedIngredientsList: result.normalizedOutput.parsedIngredientsList,
      },
      { status: 200 },
    );
  } catch (error) {
    return corsJson(buildFailurePayload(error?.message), { status: 200 });
  }
}
