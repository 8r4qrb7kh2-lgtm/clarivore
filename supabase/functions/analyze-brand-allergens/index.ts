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

function buildPromptCodebookLines(entries: Array<{ code: number; value: string }>) {
  return entries.map((entry) => `${entry.code} = ${entry.value}`).join("\n")
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

  let useFlagsOutput = false

  try {
    const {
      ingredientText,
      productName,
      labels,
      categories,
      analysisMode,
      transcriptLines,
      labelTranscriptLines,
    } = await req.json()

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
        if (dietCodebook.entries.some((entry) => entry.value === candidate)) return candidate
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

    const pescatarianGlutenFreeCodesExample = JSON.stringify(
      [pescatarianLabel, glutenFreeLabel]
        .filter(Boolean)
        .map((label) =>
          dietCodebook.entries.find((entry) => entry.value === label)?.code || null,
        )
        .filter((code) => Number.isFinite(Number(code))),
    )

    const glutenFreeCodesExample = JSON.stringify(
      [glutenFreeLabel]
        .filter(Boolean)
        .map((label) =>
          dietCodebook.entries.find((entry) => entry.value === label)?.code || null,
        )
        .filter((code) => Number.isFinite(Number(code))),
    )

    const allergenCodebookText = buildPromptCodebookLines(allergenCodebook.entries)
    const dietCodebookText = buildPromptCodebookLines(dietCodebook.entries)

    const buildListSystemPrompt = (outputMode: "summary" | "flags") => `You are an allergen and dietary preference analyzer for a restaurant allergen awareness system.
Think carefully and step-by-step before answering, but only output the JSON.

CRITICAL: You MUST respond with ONLY valid JSON. No explanations, no markdown, no text outside the JSON structure.

TASK:
Analyze the ingredient list and determine which allergens and dietary preferences apply.
Use ONLY numeric codes from the following codebooks in your output.

Allergen codebook:
${allergenCodebookText}

Diet codebook:
${dietCodebookText}

CRITICAL ALLERGEN RULES:
- ONLY flag allergens from the codebook list.
- Do NOT flag "gluten" as a separate allergen - wheat covers gluten-containing grains.
- Oats by themselves are NOT wheat and should NOT be flagged (unless ingredients explicitly mention wheat).
- Only flag wheat if wheat/wheat flour/wheat-based ingredients are explicitly present.

DIETARY PREFERENCE RULES:
- Vegan: no animal products.
- Vegetarian: no meat/fish, milk and eggs allowed.
- Pescatarian: fish/seafood allowed, no other meat.
- Gluten-free: include gluten-free diet code ONLY when no gluten-containing grains/derivatives are indicated (wheat, barley, rye, malt, brewer's yeast, triticale).

IMPORTANT:
- If product is vegan, it is also vegetarian and pescatarian.
- If product is vegetarian, it is also pescatarian.
- Evaluate gluten-free independently from vegan/vegetarian/pescatarian and include it whenever supported.

EXAMPLES (codes only):
1. "almond milk (water, almonds), oats, dates" -> allergen_codes: [${allergenCodebook.entries.find((entry) => entry.value === "tree nut")?.code || 0}], diet_codes: ${allDietCodesExample}
2. "yogurt (milk), oats, honey" -> allergen_codes: [${allergenCodebook.entries.find((entry) => entry.value === "milk")?.code || 0}], diet_codes: ${vegetarianGlutenFreeCodesExample}
3. "chicken, salt, pepper" -> allergen_codes: [], diet_codes: []
4. "tuna, water, salt" -> allergen_codes: [${allergenCodebook.entries.find((entry) => entry.value === "fish")?.code || 0}], diet_codes: ${pescatarianGlutenFreeCodesExample}
5. "egg, milk, flour" -> allergen_codes: [${allergenCodebook.entries.find((entry) => entry.value === "egg")?.code || 0}, ${allergenCodebook.entries.find((entry) => entry.value === "milk")?.code || 0}, ${allergenCodebook.entries.find((entry) => entry.value === "wheat")?.code || 0}], diet_codes: ${vegetarianDietCodesExample}
${outputMode === "flags"
  ? `
IMPORTANT: Look for BOTH ingredient-list allergens and explicit allergen statements (CONTAINS / MAY CONTAIN / facility cross-contact).
Return ONLY valid JSON:
{
  "flags": [
    {
      "ingredient": "WHEAT",
      "word_indices": [45],
      "allergen_codes": [${allergenCodebook.entries.find((entry) => entry.value === "wheat")?.code || 0}],
      "diet_codes": ${glutenFreeCodesExample},
      "risk_type": "contained"
    }
  ]
}`
  : `
Return a JSON object with this exact structure:
{
  "allergen_codes": [1, 2],
  "diet_codes": ${allDietCodesExample},
  "reasoning": "Brief explanation of your analysis"
}`}
`

    const nameSystemPrompt = `You are an allergen and dietary preference analyzer for a restaurant allergen awareness system.
Think carefully and step-by-step before answering, but only output the JSON.

CRITICAL: You MUST respond with ONLY valid JSON. No explanations, no markdown, no text outside the JSON structure.

TASK:
Analyze a SINGLE ingredient or product name (not a full ingredient list).
Use ONLY numeric codes from these codebooks.

Allergen codebook:
${allergenCodebookText}

Diet codebook:
${dietCodebookText}

CRITICAL RULES:
- ONLY use allergens from the codebook.
- Do NOT flag "gluten" as a separate allergen (use wheat when applicable).
- Oats alone are not wheat unless explicitly marked wheat.
- Treat coconut as tree nut for allergen purposes.
- You MUST explicitly evaluate gluten-free and include its diet code when no gluten grains/derivatives are indicated.

Return a JSON object with this exact structure:
{
  "allergen_codes": [1, 2],
  "diet_codes": ${allDietCodesExample},
  "reasoning": "Brief explanation of your analysis"
}`

    const listUserPromptBase = `Product Name: ${productName || "Unknown Product"}

Ingredient List: ${ingredientText}

${labels && labels.length > 0 ? `\nProduct Labels: ${labels.join(", ")}` : ""}
${categories && categories.length > 0 ? `\nProduct Categories: ${categories.join(", ")}` : ""}

Please analyze these ingredients and determine allergen and diet codes.`

    const nameUserPrompt = `Ingredient name: ${ingredientText}

Infer allergen and dietary compatibility codes based on typical formulation.`

    const mode = (analysisMode || "").toString().toLowerCase()
    const hasTranscript = Array.isArray(transcriptLines)
      ? transcriptLines.length > 0
      : Array.isArray(labelTranscriptLines)
      ? labelTranscriptLines.length > 0
      : false
    useFlagsOutput = hasTranscript
    const useListPrompt = useFlagsOutput || mode === "list"

    const transcriptPayload = Array.isArray(transcriptLines)
      ? transcriptLines
      : Array.isArray(labelTranscriptLines)
      ? labelTranscriptLines
      : null

    if (useFlagsOutput) {
      if (!transcriptPayload || transcriptPayload.length === 0) {
        throw new Error("transcriptLines is required for transcript analysis")
      }
    } else if (!ingredientText || ingredientText.trim().length === 0) {
      throw new Error("ingredientText is required")
    }

    const wordList: string[] = []
    if (useFlagsOutput && transcriptPayload) {
      transcriptPayload.forEach((line) => {
        const words = String(line || "").split(/\s+/)
        words.forEach((word) => {
          if (word) wordList.push(word)
        })
      })
    }

    const indexedWordList = wordList.map((word, idx) => `${idx}: "${word}"`).join("\n")
    const labelUserPrompt = `Here is the transcript with each word numbered (0-based index):
${indexedWordList}

Use the numbered list above for word_indices. Do not compute your own indices.`

    const listUserPrompt = useFlagsOutput ? labelUserPrompt : listUserPromptBase
    const systemPrompt = useListPrompt
      ? buildListSystemPrompt(useFlagsOutput ? "flags" : "summary")
      : nameSystemPrompt
    const userPrompt = useListPrompt ? listUserPrompt : nameUserPrompt

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: userPrompt,
        }],
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
    } catch (_e) {
      const emptyPayload = useFlagsOutput
        ? { error: "AI returned invalid format", flags: [] }
        : { error: "AI returned invalid format", allergens: [], diets: [] }
      return new Response(
        JSON.stringify({
          ...emptyPayload,
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

    if (useFlagsOutput) {
      const flags = (Array.isArray(parsed?.flags) ? parsed.flags : [])
        .map((flag: any) => {
          const riskRaw = asText(flag?.risk_type).toLowerCase()
          const risk_type = riskRaw.includes("cross") ? "cross-contamination" : "contained"
          const word_indices = (Array.isArray(flag?.word_indices) ? flag.word_indices : [])
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value >= 0)
            .map((value) => Math.trunc(value))
          return {
            ingredient: asText(flag?.ingredient),
            word_indices,
            allergens: mapAllergens(flag),
            diets: expandDietHierarchy(mapDiets(flag)),
            risk_type,
          }
        })
        .filter((flag: any) =>
          flag.ingredient || flag.word_indices.length || flag.allergens.length || flag.diets.length,
        )

      return new Response(
        JSON.stringify({ flags }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      )
    }

    const allergens = mapAllergens(parsed)
    const diets = expandDietHierarchy(mapDiets(parsed))

    return new Response(
      JSON.stringify({
        allergens,
        diets,
        reasoning: asText(parsed?.reasoning),
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    )
  } catch (error) {
    const fallbackPayload = useFlagsOutput
      ? { error: (error as Error).message || "Failed to process request", flags: [] }
      : {
          error: (error as Error).message || "Failed to process request",
          allergens: [],
          diets: [],
        }

    return new Response(
      JSON.stringify({
        ...fallbackPayload,
        errorName: (error as Error)?.name,
        debug: {
          message: (error as Error)?.message,
          stack: (error as Error)?.stack?.substring(0, 500),
        },
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
