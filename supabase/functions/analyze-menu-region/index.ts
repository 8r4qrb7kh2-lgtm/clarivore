import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { fetchAllergenDietConfig } from '../_shared/allergen-diet-config.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { regionImage, dishName, tapX, tapY, regionX, regionY, regionWidth, regionHeight } = await req.json()

    console.log('Received request for dish:', dishName)
    console.log('Region params:', { tapX, tapY, regionX, regionY, regionWidth, regionHeight })

    if (!ANTHROPIC_API_KEY) {
      throw new Error('Anthropic API key not configured')
    }

    if (!regionImage) {
      return new Response(JSON.stringify({ error: 'No region image provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    // Extract base64 data
    const base64Data = regionImage.split(',')[1]
    console.log('Image data length:', base64Data?.length || 0)

    const config = await fetchAllergenDietConfig()
    const allergenKeys = (config.allergens || []).map((allergen) => allergen.key)
    const dietLabels = (config.aiDiets && config.aiDiets.length > 0)
      ? config.aiDiets
      : (config.supportedDiets || [])

    const prompt = `You are analyzing a cropped region of a restaurant menu. The user tapped on this region to indicate where the menu item "${dishName}" is located.

Your task:
1. Find the exact text "${dishName}" in this image
2. Determine the precise bounding box (x, y, width, height as PERCENTAGES OF THIS CROPPED REGION) that tightly encompasses just this menu item's NAME and PRICE
3. The coordinates should be relative to THIS CROPPED IMAGE you're seeing (0-100%)
4. Try to infer common allergens based on the dish name and any visible ingredients

Return ONLY a JSON object with this structure:
{
  "dishName": "exact dish name as it appears on menu",
  "relativeX": number (percentage from left of THIS cropped region, 0-100),
  "relativeY": number (percentage from top of THIS cropped region, 0-100),
  "relativeW": number (percentage width of THIS cropped region),
  "relativeH": number (percentage height of THIS cropped region),
  "allergens": ${JSON.stringify(allergenKeys)},
  "removable": [],
  "crossContamination": [],
  "diets": ${JSON.stringify(dietLabels)},
  "details": {}
}

IMPORTANT:
- Make the bounding box VERY TIGHT around just the dish name and price
- Coordinates are 0-100% relative to the cropped region you see
- Be generous with allergens if unsure - better safe than sorry
- Only include diets if you're confident (e.g., clear vegetarian dish)
- If the dish has toppings or modifiers listed, include those in details`

    // Call Claude API directly
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: base64Data,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      }),
    })

    if (!claudeResponse.ok) {
      const error = await claudeResponse.text()
      console.error('Claude API error status:', claudeResponse.status)
      console.error('Claude API error body:', error)
      throw new Error(`Claude API error (${claudeResponse.status}): ${error.substring(0, 200)}`)
    }

    const aiResult = await claudeResponse.json()
    const textContent = aiResult.content.find((block: any) => block.type === 'text')

    if (!textContent || !textContent.text) {
      throw new Error('No text response from Claude')
    }

    // Extract JSON from response
    let jsonText = textContent.text.trim()

    // Remove markdown code blocks if present
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '')
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/g, '')
    }

    const analysis = JSON.parse(jsonText)

    // Convert relative coordinates (within cropped region) to absolute coordinates (full menu)
    const absoluteX = regionX + (analysis.relativeX / 100) * regionWidth
    const absoluteY = regionY + (analysis.relativeY / 100) * regionHeight
    const absoluteW = (analysis.relativeW / 100) * regionWidth
    const absoluteH = (analysis.relativeH / 100) * regionHeight

    return new Response(JSON.stringify({
      success: true,
      dishName: analysis.dishName,
      x: absoluteX,
      y: absoluteY,
      w: absoluteW,
      h: absoluteH,
      allergens: analysis.allergens || [],
      removable: analysis.removable || [],
      crossContamination: analysis.crossContamination || [],
      diets: analysis.diets || [],
      details: analysis.details || {}
    }), {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    })

  } catch (error: any) {
    console.error('Error analyzing menu region:', error)
    console.error('Error stack:', error.stack)
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Failed to analyze menu region',
      details: error.stack || String(error)
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    })
  }
})
