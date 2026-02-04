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

  try {
    const {
      ingredientText,
      productName,
      labels,
      categories,
      analysisMode,
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

    if (!ingredientText || ingredientText.trim().length === 0) {
      throw new Error('ingredientText is required')
    }

    const config = await fetchAllergenDietConfig()
    const allergenKeys = (config.allergens || []).map((allergen) => allergen.key)
    const dietLabels = (config.aiDiets && config.aiDiets.length > 0)
      ? config.aiDiets
      : (config.supportedDiets || [])
    const allergenListText = allergenKeys.join(', ')
    const dietListText = dietLabels.join(', ')
    const dietLabelMap: Record<string, string> = {}
    ;(config.diets || []).forEach((diet) => {
      if (diet?.key && diet?.label) {
        dietLabelMap[diet.key] = diet.label
      }
    })
    const veganLabel = dietLabelMap.vegan || 'Vegan'
    const vegetarianLabel = dietLabelMap.vegetarian || 'Vegetarian'
    const pescatarianLabel = dietLabelMap.pescatarian || 'Pescatarian'
    const allDietExample = JSON.stringify(
      [veganLabel, vegetarianLabel, pescatarianLabel].filter(Boolean),
    )
    const vegetarianDietExample = JSON.stringify(
      [vegetarianLabel, pescatarianLabel].filter(Boolean),
    )
    const pescatarianDietExample = JSON.stringify(
      pescatarianLabel ? [pescatarianLabel] : [],
    )

    const listSystemPrompt = `You are an allergen and dietary preference analyzer for a restaurant allergen awareness system.

CRITICAL: You MUST respond with ONLY valid JSON. No explanations, no markdown, no text outside the JSON structure.

TASK:
Analyze the ingredient list and determine:
1. Which allergens are present from this list ONLY: ${allergenListText}
2. Which dietary preferences this product is compatible with: ${dietListText}
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

IMPORTANT:
- A vegetarian product (with milk/eggs) is ALSO pescatarian-compatible
- If product is vegan, it's also vegetarian AND pescatarian
- If product is vegetarian (no meat/fish), it's also pescatarian

EXAMPLES:
1. "almond milk (water, almonds), oats, dates" → allergens: ["tree nut"], diets: ${allDietExample}
2. "yogurt (milk), oats, honey" → allergens: ["milk"], diets: ${vegetarianDietExample}
3. "chicken, salt, pepper" → allergens: [], diets: []
4. "tuna, water, salt" → allergens: ["fish"], diets: ${pescatarianDietExample}
5. "egg, milk, flour" → allergens: ["egg", "milk", "wheat"], diets: ${vegetarianDietExample}

Return a JSON object with this exact structure:
{
  "allergens": ["allergen1", "allergen2"],
  "diets": ${allDietExample},
  "reasoning": "Brief explanation of your analysis"
}`

    const nameSystemPrompt = `You are an allergen and dietary preference analyzer for a restaurant allergen awareness system.

CRITICAL: You MUST respond with ONLY valid JSON. No explanations, no markdown, no text outside the JSON structure.

TASK:
Analyze a SINGLE ingredient or product name (not a full ingredient list) and infer:
1. Which allergens are present from this list ONLY: ${allergenListText}
2. Which dietary preferences this item is compatible with: ${dietListText}
Use ONLY these exact names in your JSON output:
- Allergens: ${allergenListText}
- Diets: ${dietListText}

CRITICAL ALLERGEN RULES:
- ONLY flag allergens from the top 9 list above
- Do NOT flag "gluten" as a separate allergen - wheat covers gluten-containing grains
- Oats by themselves are NOT wheat and should NOT be flagged (unless explicitly wheat)
- Treat coconut as a tree nut for allergen purposes

INFERENCE RULES FOR SINGLE ITEMS (BE CONSERVATIVE):
- Only include allergens that are intrinsic to the named item itself.
- Do NOT assume common add-ins or recipes.
- For diets, ONLY include a diet if the name makes it unambiguously compliant.
- If unsure, return an empty diets list.
- If the name explicitly includes "vegan", "vegetarian", or "pescatarian", honor it.
- If clearly an animal product (beef, chicken, pork, lamb, fish, shrimp, milk, cheese, butter, egg, yogurt), set diets accordingly.
- If clearly a whole plant ingredient (fruit, vegetable, grain, legume, nut, seed, tofu, bean, plant oil), include Vegan + Vegetarian + Pescatarian.

Return a JSON object with this exact structure:
{
  "allergens": ["allergen1", "allergen2"],
  "diets": ${allDietExample},
  "reasoning": "Brief explanation of your analysis"
}`

    const listUserPrompt = `Product Name: ${productName || 'Unknown Product'}

Ingredient List: ${ingredientText}

${labels && labels.length > 0 ? `\nProduct Labels: ${labels.join(', ')}` : ''}
${categories && categories.length > 0 ? `\nProduct Categories: ${categories.join(', ')}` : ''}

Please analyze these ingredients and determine allergens and dietary compatibility.`

    const nameUserPrompt = `Ingredient name: ${ingredientText}

Infer allergens and dietary compatibility based on typical formulation.`

    const mode = (analysisMode || "name").toString().toLowerCase()
    const useListPrompt = mode === "list" || mode === "ingredient_list"
    const systemPrompt = useListPrompt ? listSystemPrompt : nameSystemPrompt
    const userPrompt = useListPrompt ? listUserPrompt : nameUserPrompt

    console.log(
      'Using prompt type:',
      useListPrompt ? 'ingredient-list' : 'ingredient-name',
      'mode:',
      mode,
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
        diets: parsed.diets
      })
    } catch (e) {
      console.error('Failed to parse JSON from Claude response')
      console.error('Response text:', responseText)
      console.error('Parse error:', e.message)

      // Return empty results rather than crashing
      return new Response(
        JSON.stringify({
          error: 'AI returned invalid format',
          allergens: [],
          diets: [],
          raw_response: responseText.substring(0, 200)
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          }
        }
      )
    }

    // Ensure allergens and diets are arrays
    if (!Array.isArray(parsed.allergens)) {
      parsed.allergens = []
    }
    if (!Array.isArray(parsed.diets)) {
      parsed.diets = []
    }

    return new Response(
      JSON.stringify({
        allergens: parsed.allergens,
        diets: parsed.diets,
        reasoning: parsed.reasoning || ''
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        }
      }
    )

  } catch (error) {
    console.error('Error in analyze-brand-allergens:', error)
    console.error('Error stack:', error.stack)
    console.error('Error name:', error.name)
    console.error('Error message:', error.message)

    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to process request',
        errorName: error.name,
        allergens: [],
        diets: [],
        debug: {
          message: error.message,
          stack: error.stack?.substring(0, 500)
        }
      }),
      {
        status: 200,  // Changed to 200 to avoid 500 errors on client side
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        }
      }
    )
  }
})
