import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getCorsHeaders } from "../_shared/cors.ts"

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { imageData } = await req.json()

    if (!ANTHROPIC_API_KEY) {
      throw new Error('Anthropic API key not configured')
    }

    if (!imageData) {
      throw new Error('No image data provided')
    }

    const systemPrompt = `You are a menu analysis assistant. Your job is to identify all dishes on a restaurant menu image.

Simply list all the menu items you can see. Don't worry about coordinates - just extract the dish names.

Return ONLY a JSON object in this exact format:
{
  "dishes": [
    {"name": "Dish Name 1"},
    {"name": "Dish Name 2"},
    {"name": "Dish Name 3"}
  ]
}

Rules:
- Include EVERY menu item you can see
- Use the exact name as it appears on the menu
- Don't include section headers (like "Appetizers", "Entrees")
- Don't include prices or descriptions, just the dish name
- Return ONLY the JSON, no other text`

    const userPrompt = `Analyze this restaurant menu image and list ALL menu items you can see. Return only a JSON object with a "dishes" array containing objects with "name" properties.`

    // Extract base64 data from data URL
    const base64Data = imageData.split(',')[1] || imageData
    const mediaType = imageData.includes('image/png') ? 'image/png' :
                     imageData.includes('image/jpeg') ? 'image/jpeg' :
                     imageData.includes('image/jpg') ? 'image/jpeg' :
                     imageData.includes('image/webp') ? 'image/webp' :
                     'image/jpeg'

    const content = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64Data
        }
      },
      {
        type: 'text',
        text: userPrompt
      }
    ]

    // Call Claude API with vision model
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
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
      console.error('Claude API error status:', claudeResponse.status)
      console.error('Claude API error body:', error)
      throw new Error(`Claude API error (${claudeResponse.status}): ${error.substring(0, 200)}`)
    }

    const aiResult = await claudeResponse.json()
    const responseText = aiResult.content[0].text

    console.log('AI Response:', responseText.substring(0, 500)) // Log first 500 chars

    // Parse JSON from response
    let parsed
    try {
      // Try to extract JSON from markdown code blocks if present
      let jsonText = responseText.trim()

      // Remove markdown code blocks
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?$/g, '')
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```\n?/g, '')
      }

      parsed = JSON.parse(jsonText)
      console.log('Parsed dishes count:', parsed.dishes?.length || 0)
    } catch (e) {
      console.error('Failed to parse JSON:', responseText.substring(0, 500))
      console.error('Parse error:', e)
      throw new Error(`Failed to parse AI response as JSON: ${e.message}`)
    }

    // Return the simple dish list
    const dishes = (parsed.dishes || []).map(dish => ({
      name: dish.name,
      mapped: false  // Will be set to true when user maps it
    }))

    return new Response(
      JSON.stringify({
        success: true,
        dishes: dishes
      }),
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
        success: false,
        error: error.message || 'Failed to process request',
        dishes: []
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
