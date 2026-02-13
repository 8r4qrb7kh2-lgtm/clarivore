import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getCorsHeaders } from "../_shared/cors.ts"
import { fetchAllergenDietConfig } from "../_shared/allergen-diet-config.ts"

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")

function asText(value: unknown) {
  return String(value ?? "").trim()
}

function canonicalToken(value: unknown) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "")
}

function dedupeStrings(values: string[]) {
  const out: string[] = []
  const seen = new Set<string>()
  values.forEach((value) => {
    const text = asText(value)
    if (!text) return
    const token = canonicalToken(text)
    if (!token || seen.has(token)) return
    seen.add(token)
    out.push(text)
  })
  return out
}

function buildCodebook(values: string[]) {
  const list = dedupeStrings(values)
  const entries = list.map((value, index) => ({
    code: index + 1,
    value,
  }))
  const codeToValue = new Map<number, string>()
  const tokenToValue = new Map<string, string>()
  entries.forEach((entry) => {
    codeToValue.set(entry.code, entry.value)
    tokenToValue.set(canonicalToken(entry.value), entry.value)
  })
  return {
    entries,
    codeToValue,
    tokenToValue,
  }
}

function buildPromptCodebookLines(entries: Array<{ code: number; value: string }>) {
  return entries.map((entry) => `${entry.code} = ${entry.value}`).join("\n")
}

function parseCodeList(input: unknown, codeToValue: Map<number, string>) {
  const out: string[] = []
  ;(Array.isArray(input) ? input : []).forEach((value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return
    const resolved = codeToValue.get(Math.trunc(numeric))
    if (resolved) out.push(resolved)
  })
  return out
}

function parseLegacyList(
  input: unknown,
  tokenToValue: Map<string, string>,
  aliasResolver?: (token: string) => string,
) {
  const out: string[] = []
  ;(Array.isArray(input) ? input : []).forEach((value) => {
    const token = canonicalToken(value)
    if (!token) return
    const strictMatch = tokenToValue.get(token)
    if (strictMatch) {
      out.push(strictMatch)
      return
    }
    if (typeof aliasResolver === "function") {
      const alias = asText(aliasResolver(token))
      if (alias) out.push(alias)
    }
  })
  return out
}

function parseClaudeJson(responseText: string) {
  const jsonMatch =
    responseText.match(/```json\n([\s\S]*?)\n```/) ||
    responseText.match(/```\n([\s\S]*?)\n```/) ||
    responseText.match(/\{[\s\S]*\}/)
  const jsonText = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText
  return JSON.parse(jsonText)
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const { text, dishName, imageData } = await req.json()

    if (!ANTHROPIC_API_KEY) {
      throw new Error("Anthropic API key not configured")
    }

    const config = await fetchAllergenDietConfig()
    const allergenKeys = (config.allergens || []).map((allergen) => allergen.key)
    const supportedDietLabels = Array.isArray(config.supportedDiets)
      ? config.supportedDiets
      : []
    const aiDietLabels = Array.isArray(config.aiDiets) ? config.aiDiets : []
    const configuredDietLabels = Array.isArray(config.diets)
      ? config.diets
          .map((diet) => (typeof diet?.label === "string" ? diet.label : ""))
          .filter(Boolean)
      : []
    const dietLabels = Array.from(
      new Set([...supportedDietLabels, ...aiDietLabels, ...configuredDietLabels]),
    )

    const allergenCodebook = buildCodebook(allergenKeys)
    const dietCodebook = buildCodebook(dietLabels)
    const allergenCodebookText = buildPromptCodebookLines(allergenCodebook.entries)
    const dietCodebookText = buildPromptCodebookLines(dietCodebook.entries)

    const dietLabelMap: Record<string, string> = {}
    ;(config.diets || []).forEach((diet) => {
      if (diet?.key && diet?.label) {
        dietLabelMap[diet.key] = diet.label
      }
    })

    const pickDietLabel = (candidates: Array<string | null | undefined>) => {
      const labelMap = new Map(
        dietCodebook.entries.map((entry) => [entry.value.toLowerCase(), entry.value]),
      )
      for (const candidate of candidates) {
        if (!candidate) continue
        const direct = dietCodebook.entries.find((entry) => entry.value === candidate)
        if (direct) return direct.value
        const lower = labelMap.get(candidate.toLowerCase())
        if (lower) return lower
      }
      return null
    }

    const veganLabel = pickDietLabel([dietLabelMap.vegan, "Vegan"])
    const vegetarianLabel = pickDietLabel([dietLabelMap.vegetarian, "Vegetarian"])
    const pescatarianLabel = pickDietLabel([dietLabelMap.pescatarian, "Pescatarian"])
    const glutenFreeLabel = pickDietLabel([
      dietLabelMap["gluten_free"],
      dietLabelMap["gluten-free"],
      "Gluten-free",
      "Gluten Free",
    ])

    const resolveDietAlias = (token: string) => {
      if (
        token === "gf" ||
        token.includes("glutenfree") ||
        token.includes("nogluten") ||
        token.includes("glutenless") ||
        token.includes("withoutgluten") ||
        token.includes("freefromgluten")
      ) {
        return glutenFreeLabel || ""
      }
      if (token === "pescetarian") {
        return pescatarianLabel || ""
      }
      return ""
    }

    const allDietCodesExample = JSON.stringify(
      [veganLabel, vegetarianLabel, pescatarianLabel, glutenFreeLabel]
        .filter(Boolean)
        .map((label) =>
          dietCodebook.entries.find((entry) => entry.value === label)?.code || null,
        )
        .filter((code) => Number.isFinite(Number(code))),
    )

    const vegetarianDietCodesExample = JSON.stringify(
      [vegetarianLabel, pescatarianLabel]
        .filter(Boolean)
        .map((label) =>
          dietCodebook.entries.find((entry) => entry.value === label)?.code || null,
        )
        .filter((code) => Number.isFinite(Number(code))),
    )

    const vegetarianGlutenFreeCodesExample = JSON.stringify(
      [vegetarianLabel, pescatarianLabel, glutenFreeLabel]
        .filter(Boolean)
        .map((label) =>
          dietCodebook.entries.find((entry) => entry.value === label)?.code || null,
        )
        .filter((code) => Number.isFinite(Number(code))),
    )

    const systemPrompt = imageData
      ? `You are an ingredient analysis assistant for a restaurant allergen awareness system.

CRITICAL: respond with ONLY valid JSON.

Use ONLY numeric codes in output.
Allergen codebook:
${allergenCodebookText}

Diet codebook:
${dietCodebookText}

INSTRUCTIONS:
1. Read all ingredient-related text from the image.
2. Create separate ingredient entries for distinct ingredients.
3. Include optional ingredients and garnishes.
4. For each ingredient, return allergen_codes and diet_codes using the codebooks.
5. Return dish-level dietary_option_codes.
6. You MUST explicitly evaluate gluten-free for each ingredient and the overall dish.
7. Gluten-free is allowed only when no gluten-containing grains/derivatives are indicated (wheat, barley, rye, malt, brewer's yeast, triticale).
8. Do NOT output a separate "gluten" allergen.

Return this exact JSON shape:
{
  "ingredients": [
    {
      "name": "ingredient name",
      "brand": "brand name or empty string",
      "allergen_codes": [1],
      "diet_codes": ${allDietCodesExample},
      "ingredientsList": ["sub-ingredient line"],
      "imageQuality": "good|poor|unreadable"
    }
  ],
  "dietary_option_codes": ${allDietCodesExample},
  "verifiedFromImage": true
}

EXAMPLES:
- "spinach" -> allergen_codes: [], diet_codes: ${allDietCodesExample}
- "cottage cheese" -> allergen_codes: [${allergenCodebook.entries.find((entry) => entry.value === "milk")?.code || 0}], diet_codes: ${vegetarianDietCodesExample}
- "egg" -> allergen_codes: [${allergenCodebook.entries.find((entry) => entry.value === "egg")?.code || 0}], diet_codes: ${vegetarianDietCodesExample}
- "wheat flour" -> allergen_codes: [${allergenCodebook.entries.find((entry) => entry.value === "wheat")?.code || 0}], diet_codes: []
- A dish with milk/egg but no gluten grains should include dietary_option_codes: ${vegetarianGlutenFreeCodesExample}
`
      : `You are an ingredient analysis assistant for a restaurant allergen awareness system.

CRITICAL: respond with ONLY valid JSON.

Use ONLY numeric codes in output.
Allergen codebook:
${allergenCodebookText}

Diet codebook:
${dietCodebookText}

Analyze the dish description and extract ingredients, with allergen_codes and diet_codes for each ingredient.
Return dish-level dietary_option_codes.
You MUST explicitly evaluate gluten-free at ingredient and dish level.

Return this exact JSON shape:
{
  "ingredients": [
    {
      "name": "ingredient name",
      "brand": "brand name or empty string",
      "allergen_codes": [1],
      "diet_codes": ${allDietCodesExample},
      "ingredientsList": ["sub-ingredient line"]
    }
  ],
  "dietary_option_codes": ${allDietCodesExample},
  "verifiedFromImage": false
}
`

    const userPrompt = imageData
      ? `${text ? `Context: ${text}` : ""}
${dishName ? `Dish Name: ${dishName}` : ""}

Analyze this ingredient image.`
      : `Dish Name: ${dishName || "Unknown"}
Description: ${text}

Analyze this dish description.`

    const content: any[] = []

    if (imageData) {
      const base64Data = imageData.split(",")[1] || imageData
      const mediaType = imageData.includes("image/png")
        ? "image/png"
        : imageData.includes("image/jpeg") || imageData.includes("image/jpg")
        ? "image/jpeg"
        : imageData.includes("image/webp")
        ? "image/webp"
        : "image/jpeg"

      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: base64Data,
        },
      })
    }

    content.push({
      type: "text",
      text: userPrompt,
    })

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
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
            content,
          },
        ],
      }),
    })

    if (!claudeResponse.ok) {
      const error = await claudeResponse.text()
      throw new Error(`Claude API error (${claudeResponse.status}): ${error.substring(0, 500)}`)
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

    let parsed: any
    try {
      parsed = parseClaudeJson(responseText)
    } catch (e) {
      return new Response(
        JSON.stringify({
          error: "AI returned invalid format. Please try again or describe ingredients in text.",
          ingredients: [],
          raw_response: responseText.substring(0, 200),
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

    const mapAllergens = (raw: any) =>
      dedupeStrings([
        ...parseCodeList(raw?.allergen_codes, allergenCodebook.codeToValue),
        ...parseLegacyList(raw?.allergens, allergenCodebook.tokenToValue),
      ])

    const mapDiets = (raw: any) =>
      dedupeStrings([
        ...parseCodeList(raw?.diet_codes, dietCodebook.codeToValue),
        ...parseLegacyList(raw?.diets, dietCodebook.tokenToValue, resolveDietAlias),
      ])

    const expandDietHierarchy = (diets: string[]) => {
      const out = new Set(
        (Array.isArray(diets) ? diets : []).filter((d) => typeof d === "string"),
      )
      if (veganLabel && out.has(veganLabel)) {
        if (vegetarianLabel) out.add(vegetarianLabel)
        if (pescatarianLabel) out.add(pescatarianLabel)
      }
      if (vegetarianLabel && out.has(vegetarianLabel)) {
        if (pescatarianLabel) out.add(pescatarianLabel)
      }
      return Array.from(out)
    }

    const ingredients = (Array.isArray(parsed?.ingredients) ? parsed.ingredients : [])
      .map((ingredient: any) => {
        const name = asText(ingredient?.name)
        if (!name) return null
        const allergens = mapAllergens(ingredient)
        const diets = expandDietHierarchy(mapDiets(ingredient))
        const ingredientsList = Array.isArray(ingredient?.ingredientsList)
          ? ingredient.ingredientsList.map((entry: unknown) => asText(entry)).filter(Boolean)
          : []
        return {
          name,
          brand: asText(ingredient?.brand),
          allergens,
          diets,
          ingredientsList,
          imageQuality: asText(ingredient?.imageQuality),
        }
      })
      .filter(Boolean)

    const dietaryOptions = expandDietHierarchy(
      dedupeStrings([
        ...parseCodeList(parsed?.dietary_option_codes, dietCodebook.codeToValue),
        ...parseLegacyList(parsed?.dietaryOptions, dietCodebook.tokenToValue, resolveDietAlias),
      ]),
    )

    return new Response(
      JSON.stringify({
        ingredients,
        dietaryOptions,
        verifiedFromImage: parsed?.verifiedFromImage !== undefined
          ? Boolean(parsed.verifiedFromImage)
          : Boolean(imageData),
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
        error: (error as Error).message || "Failed to process request",
        ingredients: [],
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    )
  }
})
