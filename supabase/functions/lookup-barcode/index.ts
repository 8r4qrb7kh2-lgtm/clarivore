import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

// Try Open Food Facts
async function fetchFromOpenFoodFacts(barcode: string) {
  try {
    console.log('Trying Open Food Facts...');
    const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    if (!response.ok) return null;

    const data = await response.json();
    if (data.status !== 1 || !data.product) return null;

    console.log('✓ Found in Open Food Facts');
    return { source: 'Open Food Facts', product: data.product };
  } catch (err) {
    console.log('✗ Open Food Facts failed:', err.message);
    return null;
  }
}

// Try UPCitemdb (server-side, no CORS issues)
async function fetchFromUPCitemdb(barcode: string) {
  try {
    console.log('Trying UPCitemdb...');
    const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`);
    if (!response.ok) {
      console.log(`UPCitemdb returned status: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data.items || data.items.length === 0) return null;

    const item = data.items[0];
    console.log('✓ Found in UPCitemdb');

    // Convert to Open Food Facts format
    return {
      source: 'UPCitemdb',
      product: {
        product_name: item.title,
        brands: item.brand,
        image_url: item.images && item.images.length > 0 ? item.images[0] : '',
        ingredients_text: item.description || '',
        barcode: barcode
      }
    };
  } catch (err) {
    console.log('✗ UPCitemdb failed:', err.message);
    return null;
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { barcode } = await req.json();

    if (!barcode) {
      return new Response(
        JSON.stringify({ error: 'Barcode is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`\n=== Looking up barcode: ${barcode} ===`);

    // Try databases in order
    const databases = [
      fetchFromOpenFoodFacts,
      fetchFromUPCitemdb
    ];

    for (const fetchFn of databases) {
      const result = await fetchFn(barcode);
      if (result) {
        console.log(`✓ SUCCESS: Found in ${result.source}`);
        return new Response(
          JSON.stringify({ found: true, ...result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log('✗ Product not found in any database');
    return new Response(
      JSON.stringify({ found: false, source: null, product: null }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Error in lookup-barcode:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
