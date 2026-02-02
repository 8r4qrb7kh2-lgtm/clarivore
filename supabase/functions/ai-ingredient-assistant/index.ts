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
    const { text, dishName, imageData } = await req.json()

    console.log('Request received:', {
      hasImageData: !!imageData,
      imageDataLength: imageData ? imageData.length : 0,
      hasText: !!text,
      dishName: dishName || 'none'
    })

    if (!ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY is not set!')
      throw new Error('Anthropic API key not configured')
    }

    console.log('API key is configured, proceeding with Claude API call...')

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
        dietLabelMap[diet.key.toLowerCase()] = diet.label
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
    const vegetarianOnlyExample = JSON.stringify(
      vegetarianLabel ? [vegetarianLabel] : [],
    )

    // Build the prompt based on whether we have an image
    const systemPrompt = imageData
      ? `You are an ingredient analysis assistant for a restaurant allergen awareness system.

CRITICAL: You MUST respond with ONLY valid JSON. No explanations, no markdown, no text outside the JSON structure.

IMPORTANT INSTRUCTIONS:
1. Read ALL ingredients from the image - whether it's a product label, recipe card, or preparation instructions
2. If the image shows preparation instructions (like "arrange cheese, add salami, etc."), extract each mentioned food item as a separate ingredient
3. Create a SEPARATE entry for EACH distinct ingredient (e.g., "spinach", "ricotta", "egg", "parsley" should be 4 separate entries, NOT combined)
4. INCLUDE optional ingredients, garnishes, and toppings - they still need allergen awareness!
5. For each ingredient, identify allergens from this list: ${allergenListText}
6. Also determine which dietary options the overall dish meets from this list: ${dietListText}
7. Even if the image format is unexpected, extract food items mentioned and return valid JSON
8. If the image is unclear, indicate that in imageQuality but STILL return valid JSON

CRITICAL: You MUST respond with ONLY the JSON object below. No other text before or after.

Return a JSON object with this exact structure:
{
  "ingredients": [
    {
      "name": "single ingredient name (e.g., 'spinach', NOT 'spinach ricotta egg')",
      "brand": "brand name if visible in image, otherwise empty string",
      "allergens": ["allergen1", "allergen2"],
      "diets": ${allDietExample},
      "ingredientsList": ["raw sub-ingredients if this is a processed product, otherwise just the ingredient name"],
      "imageQuality": "good|poor|unreadable"
    }
  ],
  "dietaryOptions": ${allDietExample},
  "verifiedFromImage": true
}

DIETARY OPTIONS RULES (IMPORTANT - Be proactive in assigning these):
- Vegan: Include if ALL ingredients are plant-based (no meat, milk, eggs, honey, gelatin, or animal-derived additives)
- Vegetarian: Include if no meat or fish, even if milk/eggs are present
- Pescatarian: Include if contains fish/seafood but no other meat, may contain milk/eggs
IMPORTANT: Do NOT return "gluten" as a separate allergen; use "wheat" when applicable.

IMPORTANT: Include the "diets" field for EACH ingredient to show which dietary preferences that ingredient satisfies.

EXAMPLE 1: If you see "30 oz spinach, 15 oz cottage cheese, 1 egg, parsley":
- {"name": "spinach", "allergens": [], "diets": ${allDietExample}, ...}
- {"name": "cottage cheese", "allergens": ["milk"], "diets": ${vegetarianDietExample}, ...}
- {"name": "egg", "allergens": ["egg"], "diets": ${vegetarianDietExample}, ...}
- {"name": "parsley", "allergens": [], "diets": ${allDietExample}, ...}
dietaryOptions: ${vegetarianOnlyExample} (not vegan due to milk/egg)

EXAMPLE 2: If you see "radish, water, vinegar, salt":
- All plant-based ingredients with "diets": ${allDietExample}
dietaryOptions: ${allDietExample} (all apply since no animal products)

EXAMPLE 3: If you see "rapeseed oil, water, egg yolk, vinegar, salt":
- "egg yolk" has "diets": ${vegetarianDietExample}
- Other ingredients have "diets": ${allDietExample}
dietaryOptions: ${vegetarianOnlyExample} (contains egg, so not vegan)

Be VERY conservative with allergens but PROACTIVE with dietary options - if ingredients clearly meet the criteria, include them.`
      : `You are an ingredient analysis assistant for a restaurant allergen awareness system.

Analyze the dish description and extract:
1. Individual ingredients (INCLUDING optional ingredients, garnishes, and toppings)
2. Likely brands (if mentioned)
3. Potential allergens from this list: ${allergenListText}
4. Dietary options the dish meets from this list: ${dietListText}

IMPORTANT: Include ALL mentioned ingredients, even if they are:
- Optional ("optionally add paprika")
- Garnishes ("garnish with parsley")
- Toppings ("topped with sesame seeds")
- Alternative options ("serve with cilantro or parsley")
These still need to be flagged for allergen awareness!

Return a JSON object with this exact structure:
{
  "ingredients": [
    {
      "name": "ingredient name",
      "brand": "brand name if mentioned, otherwise empty string",
      "allergens": ["allergen1", "allergen2"],
      "diets": ${allDietExample},
      "ingredientsList": ["raw ingredient from label"]
    }
  ],
  "dietaryOptions": ${allDietExample},
  "verifiedFromImage": false
}

DIETARY OPTIONS RULES (IMPORTANT - Be proactive in assigning these):
- Vegan: Include if ALL ingredients are plant-based (no meat, milk, eggs, honey, gelatin, or animal-derived additives)
- Vegetarian: Include if no meat or fish, even if milk/eggs are present
- Pescatarian: Include if contains fish/seafood but no other meat, may contain milk/eggs
IMPORTANT: Do NOT return "gluten" as a separate allergen; use "wheat" when applicable.

IMPORTANT: Include the "diets" field for EACH ingredient to show which dietary preferences that ingredient satisfies.

EXAMPLES:
- "radish" → {"allergens": [], "diets": ${allDietExample}, ...}
- "olive oil" → {"allergens": [], "diets": ${allDietExample}, ...}
- "egg yolk" → {"allergens": ["egg"], "diets": ${vegetarianDietExample}, ...}
- "chicken" → {"allergens": [], "diets": [], ...}
- "hummus, optionally garnish with paprika" → Include both hummus AND paprika as separate ingredients

Be conservative with allergens but PROACTIVE with dietary options - if ingredients clearly meet the criteria, include them.`

    const userPrompt = imageData
      ? `${text ? `Context: ${text}` : ''}
${dishName ? `Dish Name: ${dishName}` : ''}

Please analyze the ingredient label image.`
      : `Dish Name: ${dishName || 'Unknown'}
Description: ${text}

Please analyze this dish.`

    // Build content array for Claude
    const content: any[] = []

    if (imageData) {
      // Extract base64 data from data URL
      const base64Data = imageData.split(',')[1] || imageData
      const mediaType = imageData.includes('image/png') ? 'image/png' :
                       imageData.includes('image/jpeg') ? 'image/jpeg' :
                       imageData.includes('image/jpg') ? 'image/jpeg' :
                       imageData.includes('image/webp') ? 'image/webp' :
                       'image/jpeg'

      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64Data
        }
      })
    }

    content.push({
      type: 'text',
      text: userPrompt
    })

    console.log('Calling Claude API with:', {
      model: 'claude-sonnet-4-20250514',
      contentItems: content.length,
      hasImage: content.some(c => c.type === 'image'),
      systemPromptLength: systemPrompt.length
    })

    // Call Claude API (using Sonnet 4.5 for better accuracy)
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: content
        }]
      }),
    })

    if (!claudeResponse.ok) {
      const error = await claudeResponse.text()
      console.error('Claude API error:', error)
      console.error('Claude API status:', claudeResponse.status)
      console.error('Claude API headers:', JSON.stringify(Object.fromEntries(claudeResponse.headers)))
      throw new Error(`Claude API error (${claudeResponse.status}): ${error.substring(0, 500)}`)
    }

    const aiResult = await claudeResponse.json()
    const responseText = aiResult.content[0].text

    // Parse JSON from response
    let parsed
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) ||
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       responseText.match(/\{[\s\S]*\}/)  // Try to find any JSON object

      const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : responseText
      console.log('Attempting to parse JSON, length:', jsonText.length)
      parsed = JSON.parse(jsonText)
    } catch (e) {
      console.error('Failed to parse JSON from Claude response')
      console.error('Response text (first 500 chars):', responseText.substring(0, 500))
      console.error('Parse error:', e.message)

      // Return a helpful error with empty ingredients rather than crashing
      return new Response(
        JSON.stringify({
          error: 'AI returned invalid format. Please try again or describe ingredients in text.',
          ingredients: [],
          raw_response: responseText.substring(0, 200)
        }),
        {
          status: 200,  // Return 200 so WordPress doesn't show generic error
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          }
        }
      )
    }

    return new Response(
      JSON.stringify(parsed),
      {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        }
      }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to process request',
        ingredients: []
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        }
      }
    )
  }
})
