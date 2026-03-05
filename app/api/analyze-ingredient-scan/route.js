import { corsJson, corsOptions } from "../_shared/cors";
import { buildAnalyzeIngredientScanPrompts } from "../../lib/claudePrompts";
import {
  callAnthropicApi,
  callOpenAiApi,
  createTextMessage,
  runWithProviderSelection,
} from "../../lib/server/ai/providerRuntime";
import { analyzeIngredientScanSchema } from "../../lib/server/ai/responseSchemas";

export const runtime = "nodejs";

function asText(value) {
  return String(value ?? "").trim();
}

function parseClaudeJson(value) {
  const text = asText(value);
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const match =
      text.match(/```json\n([\s\S]*?)\n```/) ||
      text.match(/```\n([\s\S]*?)\n```/) ||
      text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const candidate = match[1] || match[0];
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }
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
        needsScan: null,
        reasoning: "",
        error: "Invalid JSON payload.",
      },
      { status: 400 },
    );
  }

  const ingredientName = asText(body?.ingredientName);
  const dishName = asText(body?.dishName);
  if (!ingredientName) {
    return corsJson(
      {
        needsScan: null,
        reasoning: "",
        error: "ingredientName is required",
      },
      { status: 400 },
    );
  }

  try {
    const { systemPrompt, userPrompt } = buildAnalyzeIngredientScanPrompts({
      dishName,
      ingredientName,
    });
    const result = await runWithProviderSelection({
      routeId: "analyze-ingredient-scan",
      promptClass: "analyzeIngredientScan",
      requestSummary: {
        dishName,
        ingredientName,
      },
      invokeProvider: async (provider) => {
        const response =
          provider === "openai"
            ? await callOpenAiApi({
                promptClass: "analyzeIngredientScan",
                systemPrompt,
                messages: [{ role: "user", content: [createTextMessage(userPrompt)] }],
                maxTokens: 300,
                jsonSchema: analyzeIngredientScanSchema,
              })
            : await callAnthropicApi({
                promptClass: "analyzeIngredientScan",
                systemPrompt,
                messages: [{ role: "user", content: [createTextMessage(userPrompt)] }],
                maxTokens: 300,
              });

        const parsed = parseClaudeJson(response.text);
        return {
          ...response,
          normalizedOutput: {
            needsScan:
              parsed && typeof parsed.needsScan === "boolean" ? parsed.needsScan : null,
            reasoning: asText(parsed?.reasoning),
          },
        };
      },
    });

    return corsJson(
      {
        needsScan: result.normalizedOutput.needsScan,
        reasoning: result.normalizedOutput.reasoning,
      },
      { status: 200 },
    );
  } catch (error) {
    return corsJson(
      {
        needsScan: null,
        reasoning: "",
        error: asText(error?.message) || "Failed to process request.",
      },
      { status: 200 },
    );
  }
}
