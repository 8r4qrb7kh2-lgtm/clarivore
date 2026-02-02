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
    const { query, ingredientName } = await req.json()

    if (!ANTHROPIC_API_KEY) {
      // Return original query if no API key
      return new Response(
        JSON.stringify({ corrected: query }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          }
        }
      )
    }

    // Use Claude to correct spelling
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: `You are a spelling correction assistant for food product searches. The user is searching for products and typed: "${query}"

The ingredient being searched for is: "${ingredientName}"

IMPORTANT RULES:
1. Only correct OBVIOUS spelling mistakes
2. Return the COMPLETE search query (ingredient + brand), not just the brand name
3. If the text looks reasonable, return it EXACTLY as typed
4. Do NOT remove the ingredient name from the query
5. Do NOT replace valid brand names with alternatives

Examples:
- "italian seasoning chobaani" → "italian seasoning chobani" (fix typo in brand)
- "italian seasoning sysco" → "italian seasoning sysco" (valid, return as-is)
- "yogurt danon" → "yogurt dannon" (fix typo in brand)
- "ricotta cheese galbani" → "ricotta cheese galbani" (correct, return as-is)

Response (complete search query, no explanations):`
        }]
      }),
    })

    if (!claudeResponse.ok) {
      const error = await claudeResponse.text()
      console.error('Claude API error:', error)
      // Return original query on error
      return new Response(
        JSON.stringify({ corrected: query }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          }
        }
      )
    }

    const aiResult = await claudeResponse.json()
    const corrected = aiResult.content[0].text.trim()

    return new Response(
      JSON.stringify({ corrected: corrected || query }),
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
        corrected: req.body?.query || ''
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
