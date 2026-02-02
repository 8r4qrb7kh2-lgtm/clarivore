import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getCorsHeaders } from "../_shared/cors.ts"

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const { ingredientName, dishName } = await req.json()

    if (!ANTHROPIC_API_KEY) {
      throw new Error("Anthropic API key not configured")
    }

    if (!ingredientName || ingredientName.trim().length === 0) {
      throw new Error("ingredientName is required")
    }

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
- If ambiguous, lean true.`

    const userPrompt = `Dish: ${dishName || "Unknown"}
Ingredient: ${ingredientName}

Does this ingredient likely contain multiple ingredients?`

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        temperature: 0.2,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    })

    if (!claudeResponse.ok) {
      const error = await claudeResponse.text()
      throw new Error(
        `Claude API error (${claudeResponse.status}): ${error.substring(0, 500)}`,
      )
    }

    const aiResult = await claudeResponse.json()
    const contentBlocks = Array.isArray(aiResult?.content) ? aiResult.content : []
    const textBlocks = contentBlocks.filter(
      (block) =>
        block &&
        typeof block === "object" &&
        typeof block.text === "string" &&
        (block.type === "text" || block.type === "output_text" || !block.type),
    )
    const responseText =
      textBlocks.map((block) => block.text).join("\n").trim() ||
      (typeof aiResult?.content === "string" ? aiResult.content : "")

    let parsed: { needsScan?: boolean; reasoning?: string } | null = null
    try {
      const jsonMatch =
        responseText.match(/```json\n([\s\S]*?)\n```/) ||
        responseText.match(/```\n([\s\S]*?)\n```/) ||
        responseText.match(/\{[\s\S]*\}/)

      const jsonText = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText
      parsed = JSON.parse(jsonText)
    } catch (error) {
      parsed = null
    }

    const needsScan =
      parsed && typeof parsed.needsScan === "boolean"
        ? parsed.needsScan
        : null

    return new Response(
      JSON.stringify({
        needsScan,
        reasoning: parsed?.reasoning || "",
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message || "Failed to process request",
        needsScan: null,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    )
  }
})
