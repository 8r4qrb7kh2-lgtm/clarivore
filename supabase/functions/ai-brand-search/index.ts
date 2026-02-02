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
    const { ingredientName, brandQuery } = await req.json()

    console.log('AI Brand Search Request:', {
      ingredientName,
      brandQuery
    })

    if (!ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY is not set!')
      throw new Error('Anthropic API key not configured')
    }

    if (!ingredientName) {
      return new Response(
        JSON.stringify({ products: [], error: 'Ingredient name is required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          }
        }
      )
    }

    // Step 1: Search Open Food Facts directly with user's raw text
    const searchQuery = brandQuery ? `${ingredientName} ${brandQuery}` : ingredientName
    console.log('Searching Open Food Facts for:', searchQuery)

    const searchUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(searchQuery)}&search_simple=1&action=process&json=1&page_size=50`

    const searchRes = await fetch(searchUrl)
    if (!searchRes.ok) {
      throw new Error('Open Food Facts search failed')
    }

    const searchData = await searchRes.json()
    const allProducts = Array.isArray(searchData.products) ? searchData.products : []

    console.log(`Found ${allProducts.length} products from Open Food Facts`)

    if (allProducts.length === 0) {
      return new Response(
        JSON.stringify({
          products: [],
          message: 'No products found in Open Food Facts'
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

    // Step 2: Fetch detailed product info
    const detailedProducts = await Promise.all(
      allProducts.map(async (product) => {
        if (!product.code) return null

        try {
          const detailRes = await fetch(`https://world.openfoodfacts.org/api/v2/product/${product.code}.json`)
          if (detailRes.ok) {
            const detailData = await detailRes.json()
            if (detailData.product) {
              return { ...product, ...detailData.product }
            }
          }
        } catch (err) {
          console.warn('Failed to fetch product details for', product.code, err)
        }

        return product
      })
    )

    // Step 4: Filter for products with BOTH images
    const validProducts = detailedProducts.filter(product => {
      if (!product) return false

      const hasBrandImage = !!(
        product.image_front_url ||
        product.image_front_small_url ||
        product.image_url
      )

      let hasIngredientsImage = !!product.image_ingredients_url

      if (!hasIngredientsImage && product.selected_images?.ingredients) {
        const ingredImgs = product.selected_images.ingredients.display ||
                          product.selected_images.ingredients.small
        if (ingredImgs) {
          hasIngredientsImage = !!(
            ingredImgs.en ||
            ingredImgs.fr ||
            ingredImgs.es ||
            ingredImgs.de ||
            Object.values(ingredImgs)[0]
          )
        }
      }

      const isValid = hasBrandImage && hasIngredientsImage

      if (!isValid) {
        console.log(`Filtered out ${product.product_name}: brandImage=${hasBrandImage}, ingredientsImage=${hasIngredientsImage}`)
      }

      return isValid
    })

    console.log(`Filtered to ${validProducts.length} products with both required images`)

    // Step 5: Format products
    const formattedProducts = validProducts.map(product => {
      const allergens = []
      if (Array.isArray(product.allergens_tags)) {
        product.allergens_tags.forEach((tag: string) => {
          const key = tag.replace(/^en:/, '').replace(/-/g, ' ')
          allergens.push(key)
        })
      }

      const ingredientsText = product.ingredients_text_en ||
                             product.ingredients_text ||
                             product.ingredients_original ||
                             ''

      let ingredientsList = []
      if (ingredientsText) {
        ingredientsList = ingredientsText
          .split(/[,;\n]/)
          .map((part: string) => part.replace(/\(.+?\)/g, '').trim())
          .filter(Boolean)
      }

      let ingredientsImage = product.image_ingredients_url || ''
      if (!ingredientsImage && product.selected_images?.ingredients) {
        const ingredImgs = product.selected_images.ingredients.display ||
                          product.selected_images.ingredients.small
        if (ingredImgs) {
          ingredientsImage = ingredImgs.en ||
                            ingredImgs.fr ||
                            ingredImgs.es ||
                            ingredImgs.de ||
                            Object.values(ingredImgs)[0] ||
                            ''
        }
      }

      return {
        name: product.product_name || product.brands || '',
        brand: product.brands || '',
        image: product.image_front_small_url || product.image_front_url || product.image_url || '',
        ingredientsImage,
        ingredientsList,
        allergens,
        productUrl: product.url || `https://world.openfoodfacts.org/product/${product.code}`,
        code: product.code
      }
    }).filter(item => item.name && item.image && item.ingredientsImage)

    console.log(`Returning ${formattedProducts.length} formatted products`)

    return new Response(
      JSON.stringify({
        products: formattedProducts.slice(0, 15),
        searchQuery: searchQuery,
        totalFound: allProducts.length,
        withImages: formattedProducts.length
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        }
      }
    )

  } catch (error: any) {
    console.error('Error in AI brand search:', error)

    return new Response(
      JSON.stringify({
        error: error.message || 'AI brand search failed',
        products: []
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
})
