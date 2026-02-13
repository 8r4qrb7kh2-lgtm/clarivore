import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getCorsHeaders } from "../_shared/cors.ts"
import { fetchAllergenDietConfig } from "../_shared/allergen-diet-config.ts"

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
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

    console.log('Analyzing brand product:', {
      productName: productName || 'unknown',
      ingredientTextLength: ingredientText ? ingredientText.length : 0,
      labelsCount: labels ? labels.length : 0,
      categoriesCount: categories ? categories.length : 0
    })

    if (!ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY is not set!')
      throw new Error('Anthropic API key not configured')
    }

    const config = await fetchAllergenDietConfig()
    const allergenKeys = (config.allergens || []).map((allergen) => allergen.key)
    const supportedDietLabels = Array.isArray(config.supportedDiets)
      ? config.supportedDiets
      : []
    const aiDietLabels = Array.isArray(config.aiDiets) ? config.aiDiets : []
    const configuredDietLabels = Array.isArray(config.diets)
      ? config.diets
          .map((diet) => (typeof diet?.label === 'string' ? diet.label : ''))
          .filter(Boolean)
      : []
    const dietLabels = Array.from(
      new Set([...supportedDietLabels, ...aiDietLabels, ...configuredDietLabels]),
    )
    const allergenListText = allergenKeys.join(', ')
    const dietListText = dietLabels.join(', ')
    const dietLabelMap: Record<string, string> = {}
    ;(config.diets || []).forEach((diet) => {
      if (diet?.key && diet?.label) {
        dietLabelMap[diet.key] = diet.label
      }
    })
    const pickDietLabel = (candidates: Array<string | null | undefined>) => {
      const labelMap = new Map(
        dietLabels.map((label) => [label.toLowerCase(), label]),
      )
      for (const candidate of candidates) {
        if (!candidate) continue
        if (dietLabels.includes(candidate)) return candidate
        const lower = labelMap.get(candidate.toLowerCase())
        if (lower) return lower
      }
      return null
    }
    const veganLabel = pickDietLabel([dietLabelMap.vegan, 'Vegan'])
    const vegetarianLabel = pickDietLabel([
      dietLabelMap.vegetarian,
      'Vegetarian',
    ])
    const pescatarianLabel = pickDietLabel([
      dietLabelMap.pescatarian,
      'Pescatarian',
    ])
    const glutenFreeLabel = pickDietLabel([
      dietLabelMap['gluten_free'],
      dietLabelMap['gluten-free'],
      'Gluten-free',
      'Gluten Free',
    ])
    const allDietExample = JSON.stringify(
      [veganLabel, vegetarianLabel, pescatarianLabel, glutenFreeLabel].filter(Boolean),
    )
    const vegetarianDietExample = JSON.stringify(
      [vegetarianLabel, pescatarianLabel].filter(Boolean),
    )
    const vegetarianGlutenFreeDietExample = JSON.stringify(
      [vegetarianLabel, pescatarianLabel, glutenFreeLabel].filter(Boolean),
    )
    const pescatarianGlutenFreeDietExample = JSON.stringify(
      [pescatarianLabel, glutenFreeLabel].filter(Boolean),
    )
    const glutenFreeExample = glutenFreeLabel
      ? JSON.stringify([glutenFreeLabel])
      : '[]'

    const buildListSystemPrompt = (outputMode: 'summary' | 'flags') => `You are an allergen and dietary preference analyzer for a restaurant allergen awareness system.
Think carefully and step-by-step before answering, but only output the JSON.

CRITICAL: You MUST respond with ONLY valid JSON. No explanations, no markdown, no text outside the JSON structure.

TASK:
Analyze the ingredient list and determine which allergens and dietary preferences apply.
Use ONLY these exact names in your JSON output:
- Allergens: ${allergenListText}
- Diets: ${dietListText}

CRITICAL ALLERGEN RULES:
- ONLY flag allergens from the top 9 list above
- Do NOT flag "gluten" as a separate allergen - wheat covers gluten-containing grains
- Oats by themselves are NOT wheat and should NOT be flagged (unless ingredients explicitly mention wheat)
- Only flag wheat if wheat/wheat flour/wheat-based ingredients are explicitly present

IMPORTANT RULES FOR ALLERGEN DETECTION:
- "almond milk", "oat milk", "soy milk", "coconut milk", etc. are NOT milk allergens - they are plant-based alternatives
- Only mark milk if there's actual milk, cream, butter, cheese, whey, casein, or lactose from animals
- "almond milk" DOES contain tree nuts (almonds)
- Treat coconut as a tree nut for allergen purposes
- Be context-aware: "milk powder" after animal ingredients = milk, but "almond milk" = tree nut only

DIETARY PREFERENCE RULES:
- Vegan: NO animal products at all (no meat, fish, milk, eggs, honey, gelatin, or animal-derived additives)
- Vegetarian: No meat or fish, but MAY contain milk and/or eggs
- Pescatarian: May contain fish/seafood, milk, and eggs, but NO other meat (chicken, beef, pork, etc.)
- Gluten-free: include this when ingredients and allergen statements show no gluten-containing grains or derivatives (wheat, barley, rye, malt, brewer's yeast, triticale)

IMPORTANT:
- A vegetarian product (with milk/eggs) is ALSO pescatarian-compatible
- If product is vegan, it's also vegetarian AND pescatarian
- If product is vegetarian (no meat/fish), it's also pescatarian
- Evaluate gluten-free independently from vegan/vegetarian/pescatarian and include it whenever supported by the ingredients

EXAMPLES:
1. "almond milk (water, almonds), oats, dates" → allergens: ["tree nut"], diets: ${allDietExample}
2. "yogurt (milk), oats, honey" → allergens: ["milk"], diets: ${vegetarianGlutenFreeDietExample}
3. "chicken, salt, pepper" → allergens: [], diets: []
4. "tuna, water, salt" → allergens: ["fish"], diets: ${pescatarianGlutenFreeDietExample}
5. "egg, milk, flour" → allergens: ["egg", "milk", "wheat"], diets: ${vegetarianDietExample}
${outputMode === 'flags' ? `
IMPORTANT: Look for TWO types of allergen declarations:
1. Allergens in the ingredient list itself (e.g., "wheat flour", "milk", "soybean oil")
2. Allergen statements at the end like "CONTAINS: WHEAT, SOY" or "MAY CONTAIN: MILK" or "PRODUCED IN THE SAME FACILITY", and other similar text.

For "CONTAINS:" statements, flag each allergen individually:
- "CONTAINS: WHEAT, SOY, AND SESAME" should produce 3 separate flags for WHEAT, SOY, and SESAME

For each allergen/diet violation found, report:
- The ingredient name as it appears
- The exact word indices from the numbered list provided
- Whether it's exactly "contained" or exactly "cross-contamination" (use "cross-contamination" for cross-contamination/facility warnings)

Return ONLY valid JSON:
{
  "flags": [
    {
      "ingredient": "WHEAT",
      "word_indices": [45],
      "allergens": ["wheat"],
      "diets": ${glutenFreeExample},
      "risk_type": "contained"
    },
    {
      "ingredient": "SOY",
      "word_indices": [46],
      "allergens": ["soy"],
      "diets": [],
      "risk_type": "contained"
    }
  ]
}` : `
Return a JSON object with this exact structure:
{
  "allergens": ["allergen1", "allergen2"],
  "diets": ${allDietExample},
  "reasoning": "Brief explanation of your analysis"
}`}`

    const nameSystemPrompt = `You are an allergen and dietary preference analyzer for a restaurant allergen awareness system.
Think carefully and step-by-step before answering, but only output the JSON.

CRITICAL: You MUST respond with ONLY valid JSON. No explanations, no markdown, no text outside the JSON structure.

TASK:
Analyze a SINGLE ingredient or product name (not a full ingredient list) and infer:
1. Which allergens are present from this list ONLY: ${allergenListText}
2. Which dietary preferences this item is compatible with: ${dietListText}
Use ONLY these exact names in your JSON output:
- Allergens: ${allergenListText}
- Diets: ${dietListText}

CRITICAL RULES:
- ONLY flag allergens from the top 9 list above
- Do NOT flag "gluten" as a separate allergen - wheat covers gluten-containing grains
- Oats by themselves are NOT wheat and should NOT be flagged (unless explicitly wheat)
- Treat coconut as a tree nut for allergen purposes
- Evaluate gluten-free independently and include it when no gluten-containing grains/derivatives are indicated by the ingredient name

Return a JSON object with this exact structure:
{
  "allergens": ["allergen1", "allergen2"],
  "diets": ${allDietExample},
  "reasoning": "Brief explanation of your analysis"
}`

    const listUserPromptBase = `Product Name: ${productName || 'Unknown Product'}

Ingredient List: ${ingredientText}

${labels && labels.length > 0 ? `\nProduct Labels: ${labels.join(', ')}` : ''}
${categories && categories.length > 0 ? `\nProduct Categories: ${categories.join(', ')}` : ''}

Please analyze these ingredients and determine allergens and dietary compatibility.`

    const nameUserPrompt = `Ingredient name: ${ingredientText}

Infer allergens and dietary compatibility based on typical formulation.`


    const mode = (analysisMode || '').toString().toLowerCase()
    const hasTranscript = Array.isArray(transcriptLines)
      ? transcriptLines.length > 0
      : Array.isArray(labelTranscriptLines)
        ? labelTranscriptLines.length > 0
        : false
    useFlagsOutput = hasTranscript
    const useListPrompt = useFlagsOutput || mode === 'list'

    const transcriptPayload = Array.isArray(transcriptLines)
      ? transcriptLines
      : Array.isArray(labelTranscriptLines)
        ? labelTranscriptLines
        : null

    if (useFlagsOutput) {
      if (!transcriptPayload || transcriptPayload.length === 0) {
        throw new Error('transcriptLines is required for transcript analysis')
      }
    } else if (!ingredientText || ingredientText.trim().length === 0) {
      throw new Error('ingredientText is required')
    }

    const wordList: string[] = []
    if (useFlagsOutput && transcriptPayload) {
      transcriptPayload.forEach((line) => {
        const words = String(line || '').split(/\s+/)
        words.forEach((word) => {
          if (word) wordList.push(word)
        })
      })
    }
    const indexedWordList = wordList
      .map((word, idx) => `${idx}: "${word}"`)
      .join('\n')
    const labelUserPrompt = `Here is the transcript with each word numbered (0-based index):
${indexedWordList}

Use the numbered list above for word_indices. Do not compute your own indices.`

    const listUserPrompt = useFlagsOutput ? labelUserPrompt : listUserPromptBase

    const systemPrompt = useListPrompt
      ? buildListSystemPrompt(useFlagsOutput ? 'flags' : 'summary')
      : nameSystemPrompt
    const userPrompt = useListPrompt ? listUserPrompt : nameUserPrompt

    console.log(
      'Using prompt type:',
      useFlagsOutput
        ? 'ingredient-list (flags)'
        : useListPrompt
          ? 'ingredient-list'
          : 'ingredient-name',
      'mode:',
      mode || 'name',
    )

    console.log('Calling Claude API (Sonnet 4.5)...')

    // Call Claude API with Sonnet 4.5
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',  // Claude Sonnet 4
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: userPrompt
        }]
      }),
    })

    if (!claudeResponse.ok) {
      const error = await claudeResponse.text()
      console.error('Claude API error:', error)
      console.error('Claude API status:', claudeResponse.status)
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

    console.log('Claude response received, length:', responseText.length)

    // Parse JSON from response
    let parsed
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) ||
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       responseText.match(/\{[\s\S]*\}/)

      const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : responseText
      parsed = JSON.parse(jsonText)

      console.log('Successfully parsed:', {
        allergens: parsed.allergens,
        diets: parsed.diets,
        flags: parsed.flags,
      })
    } catch (e) {
      console.error('Failed to parse JSON from Claude response')
      console.error('Response text:', responseText)
      console.error('Parse error:', e.message)

      // Return empty results rather than crashing
      const emptyPayload = useFlagsOutput
        ? { error: 'AI returned invalid format', flags: [] }
        : { error: 'AI returned invalid format', allergens: [], diets: [] }

      return new Response(
        JSON.stringify({
          ...emptyPayload,
          raw_response: responseText.substring(0, 200),
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        },
      )
    }

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
      const flags = Array.isArray(parsed.flags) ? parsed.flags : []
      return new Response(
        JSON.stringify({ flags }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        },
      )
    }

    // Ensure allergens and diets are arrays
    if (!Array.isArray(parsed.allergens)) {
      parsed.allergens = []
    }
    if (!Array.isArray(parsed.diets)) {
      parsed.diets = []
    }
    parsed.diets = expandDietHierarchy(parsed.diets)

    return new Response(
      JSON.stringify({
        allergens: parsed.allergens,
        diets: parsed.diets,
        reasoning: parsed.reasoning || '',
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      },
    )

  } catch (error) {
    console.error('Error in analyze-brand-allergens:', error)
    console.error('Error stack:', error.stack)
    console.error('Error name:', error.name)
    console.error('Error message:', error.message)

    const fallbackPayload = useFlagsOutput
      ? { error: error.message || 'Failed to process request', flags: [] }
      : {
          error: error.message || 'Failed to process request',
          allergens: [],
          diets: [],
        }

    return new Response(
      JSON.stringify({
        ...fallbackPayload,
        errorName: error.name,
        debug: {
          message: error.message,
          stack: error.stack?.substring(0, 500),
        },
      }),
      {
        status: 200, // Changed to 200 to avoid 500 errors on client side
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      },
    )
  }
})
