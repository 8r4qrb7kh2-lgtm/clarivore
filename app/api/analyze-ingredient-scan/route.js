import { corsJson, corsOptions } from "../_shared/cors";

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

  const anthropicApiKey = asText(process.env.ANTHROPIC_API_KEY);
  if (!anthropicApiKey) {
    return corsJson(
      {
        needsScan: null,
        reasoning: "",
        error: "Anthropic API key not configured",
      },
      { status: 500 },
    );
  }

  try {
    const systemPrompt = `You classify whether a menu ingredient name likely represents a multi-ingredient product that requires scanning the ingredient label.

CRITICAL: Respond with JSON only. Do not include markdown or extra text.

Return JSON with this structure:
{
  "needsScan": true,
  "reasoning": "Short reason"
}

Guidelines:
- needsScan = true for packaged or compound foods that usually contain multiple ingredients (bread, buns, wraps, tortillas, pasta, sauces, dressings, condiments, marinades, spice blends, seasoning mixes, sausages, deli meats, cheeses, yogurt, plant-based milks, packaged desserts, etc.).
- needsScan = false for single-ingredient raw items (whole fruits/vegetables, whole cuts of meat, fish, eggs, water, salt, pepper, olive oil, rice, plain beans, etc.).
- If ambiguous, lean true.`;

    const userPrompt = `Dish: ${dishName || "Unknown"}
Ingredient: ${ingredientName}

Does this ingredient likely contain multiple ingredients?`;

    const requestPayload = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      // Leave temperature unset to use Anthropic defaults across thinking/non-thinking modes.
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error (${response.status}): ${errorText.slice(0, 240)}`);
    }

    const aiResult = await response.json();
    const contentBlocks = Array.isArray(aiResult?.content) ? aiResult.content : [];
    const textBlocks = contentBlocks.filter(
      (block) =>
        block &&
        typeof block === "object" &&
        typeof block.text === "string" &&
        (block.type === "text" || block.type === "output_text" || !block.type),
    );
    const responseText =
      textBlocks.map((block) => block.text).join("\n").trim() ||
      (typeof aiResult?.content === "string" ? aiResult.content : "");

    const parsed = parseClaudeJson(responseText);
    const needsScan =
      parsed && typeof parsed.needsScan === "boolean" ? parsed.needsScan : null;

    return corsJson(
      {
        needsScan,
        reasoning: asText(parsed?.reasoning),
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
