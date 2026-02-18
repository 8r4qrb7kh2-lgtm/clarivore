import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  const json = (body: unknown, status = 200): Response => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  };
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { userQuery, userAllergens = [], userDiets = [] } = await req.json();

    if (!userQuery || typeof userQuery !== "string") {
      return json({ error: "userQuery is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Load restaurants, then load table-backed dish rows from normalized menu tables.
    const { data: restaurants, error: restaurantsError } = await supabase
      .from("restaurants")
      .select("id, name, slug, last_confirmed")
      .order("name");
    if (restaurantsError) throw restaurantsError;

    const restaurantIds = (restaurants || [])
      .map((restaurant: any) => String(restaurant?.id || "").trim())
      .filter(Boolean);

    const { data: menuDishes, error: menuDishesError } = restaurantIds.length
      ? await supabase
          .from("restaurant_menu_dishes")
          .select("restaurant_id,dish_name,description,details_json,payload_json")
          .in("restaurant_id", restaurantIds)
      : { data: [], error: null };

    if (menuDishesError) throw menuDishesError;

    const dishesByRestaurant = new Map<string, any[]>();
    (menuDishes || []).forEach((row: any) => {
      const restaurantId = String(row?.restaurant_id || "").trim();
      if (!restaurantId) return;
      if (!dishesByRestaurant.has(restaurantId)) dishesByRestaurant.set(restaurantId, []);
      dishesByRestaurant.get(restaurantId)!.push(row);
    });

    // Build candidate list for AI; apply quick keyword prefilter to reduce tokens
    const normalizedQueryTerms = tokenize(userQuery);
    const MAX_CANDIDATES = 400;

    type Candidate = {
      restaurant_id: string;
      restaurant_name: string;
      restaurant_slug: string | null;
      dish_name: string;
      dish_description: string;
    };

    const allCandidates: Candidate[] = [];
    for (const restaurant of restaurants || []) {
      const restaurantId = String((restaurant as any)?.id || "");
      const restaurantName = String((restaurant as any)?.name || "");
      const restaurantSlug = (restaurant as any)?.slug || null;
      const dishRows = dishesByRestaurant.get(restaurantId) || [];

      dishRows.forEach((dishRow: any) => {
        const dishName = String(dishRow?.dish_name || "").trim();
        if (!dishName) return;

        let dishDescription = String(dishRow?.description || "").trim();
        if (!dishDescription) {
          const details = dishRow?.details_json && typeof dishRow.details_json === "object"
            ? dishRow.details_json
            : {};
          dishDescription = String(details?.__ingredientsSummary || "").trim();
        }
        if (!dishDescription) {
          const payload = dishRow?.payload_json && typeof dishRow.payload_json === "object"
            ? dishRow.payload_json
            : {};
          const aiSummary = payload?.aiIngredientSummary;
          if (Array.isArray(aiSummary)) {
            dishDescription = aiSummary.map((value: any) => String(value || "").trim()).filter(Boolean).join(", ");
          } else if (typeof aiSummary === "string") {
            try {
              const parsed = JSON.parse(aiSummary);
              if (Array.isArray(parsed)) {
                dishDescription = parsed.map((value: any) => String(value || "").trim()).filter(Boolean).join(", ");
              } else {
                dishDescription = aiSummary;
              }
            } catch {
              dishDescription = aiSummary;
            }
          } else if (Array.isArray(payload?.ingredients)) {
            dishDescription = payload.ingredients
              .map((ingredient: any) => String(ingredient?.name || ingredient || "").trim())
              .filter(Boolean)
              .join(", ");
          }
        }

        allCandidates.push({
          restaurant_id: restaurantId,
          restaurant_name: restaurantName,
          restaurant_slug: restaurantSlug,
          dish_name: dishName,
          dish_description: dishDescription,
        });
      });
    }

    let candidates = allCandidates.filter((candidate) => {
      if (normalizedQueryTerms.length === 1) return true;
      return simpleScore(
        `${candidate.dish_name} ${candidate.dish_description}`,
        normalizedQueryTerms,
      ) > 0;
    });

    // If no keyword matches but we have dishes, include all dishes for AI to evaluate.
    if (!candidates.length && normalizedQueryTerms.length > 1) {
      candidates = [...allCandidates];
    }

    // Cap to reasonable size to fit into Claude context
    candidates.sort((a, b) =>
      simpleScore(`${b.dish_name} ${b.dish_description}`, normalizedQueryTerms) -
      simpleScore(`${a.dish_name} ${a.dish_description}`, normalizedQueryTerms)
    );
    const clipped = candidates.slice(0, MAX_CANDIDATES);

    // If no candidates, return empty results quickly
    if (clipped.length === 0) {
      return json({ results: [], message: "No relevant dishes found" });
    }

    if (!ANTHROPIC_API_KEY) {
      // Fallback: return basic keyword matches grouped by restaurant
      const grouped = summarizeBasic(clipped, userAllergens, userDiets);
      return json({ results: grouped, provider: "basic" });
    }

    const aiPrompt = buildPrompt(userQuery, userAllergens, userDiets, clipped);

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        temperature: 0,
        messages: [
          { role: "user", content: aiPrompt }
        ],
      }),
    });

    if (!aiRes.ok) {
      const text = await aiRes.text();
      console.error("Anthropic error:", text);
      const grouped = summarizeBasic(clipped, userAllergens, userDiets);
      return json({ results: grouped, provider: "fallback", error: "AI request failed" });
    }

    const aiData = await aiRes.json();
    const content = aiData?.content?.[0]?.text || "";

    // Expect JSON block in the response
    const jsonMatch = content.match(/\{[\s\S]*"restaurants"[\s\S]*\}/);
    if (!jsonMatch) {
      const grouped = summarizeBasic(clipped, userAllergens, userDiets);
      return json({ results: grouped, provider: "fallback", error: "Could not parse AI output" });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const results = Array.isArray(parsed.restaurants) ? parsed.restaurants : [];

    // If Claude returned no results but we had keyword-matching candidates, use basic fallback
    if (results.length === 0 && clipped.length > 0) {
      const keywordMatches = clipped.filter(c => {
        const hay = `${c.dish_name} ${c.dish_description}`.toLowerCase();
        return normalizedQueryTerms.some(term => hay.includes(term));
      });
      if (keywordMatches.length > 0) {
        const grouped = summarizeBasic(keywordMatches, userAllergens, userDiets);
        return json({ results: grouped, provider: "fallback-keyword" });
      }
    }

    // Enrich with last_confirmed from restaurants table
    const lastConfirmedById = new Map<string, string | null>();
    for (const r of restaurants || []) lastConfirmedById.set(String(r.id), (r as any).last_confirmed || null);
    for (const r of results) {
      r.last_confirmed = lastConfirmedById.get(String(r.restaurant_id)) || null;
    }

    return json({ results, provider: "claude" });
  } catch (err: any) {
    console.error("ai-dish-search error", err);
    return json({ error: err?.message || "Internal error" }, 500);
  }
});

function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function simpleScore(text: string, terms: string[]): number {
  const hay = (text || "").toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (hay.includes(t)) score += 1;
  }
  return score;
}

function summarizeBasic(candidates: any[], userAllergens: string[], userDiets: string[]) {
  const byRestaurant = new Map<string, any>();
  for (const c of candidates) {
    const key = c.restaurant_id;
    if (!byRestaurant.has(key)) {
      byRestaurant.set(key, {
        restaurant_id: c.restaurant_id,
        restaurant_name: c.restaurant_name,
        restaurant_slug: c.restaurant_slug,
        exact_count: 0,
        accommodated_count: 0,
        top_dishes: [] as any[],
      });
    }
    const group = byRestaurant.get(key);
    // Naive: treat everything as potentially accommodatable
    group.accommodated_count += 1;
    if (group.top_dishes.length < 5) {
      group.top_dishes.push({
        name: c.dish_name,
        description: c.dish_description,
        status: "can_accommodate",
      });
    }
  }
  return Array.from(byRestaurant.values());
}

function buildPrompt(
  userQuery: string,
  userAllergens: string[],
  userDiets: string[],
  candidates: { restaurant_id: string; restaurant_name: string; restaurant_slug: string | null; dish_name: string; dish_description: string }[],
) {
  const guidance = `You are helping a diner find dishes across many restaurants.
User's natural-language request: "${userQuery}"
User allergies (avoid completely): ${JSON.stringify(userAllergens || [])}
User dietary preferences (must comply): ${JSON.stringify(userDiets || [])}

Tasks:
1) Evaluate each dish for RELEVANCE to the user's request.
   - If the dish name or description contains keywords from the user's query (case-insensitive), it IS relevant.
   - For example, if user asks for "lasagna", include dishes named "Lasagna" or containing "lasagna" in the description.
   - Use semantic matching: "pasta" matches "spaghetti", "noodles", etc.
   - Handle spelling variations: "mousaka" matches "moussaka", "moukaa", and similar phonetic variations.
   - If the dish name sounds similar to the query (even with different spelling), include it.
2) Determine COMPATIBILITY:
   - "meets_all_requirements": dish appears to satisfy diets and avoids allergens.
   - "can_accommodate": dish could work with a simple, common modification (e.g., "no cheese").
   - Only exclude dishes that are clearly unsafe (contains user's allergens) or completely unrelated to the query.

Return JSON only in this exact shape:
{
  "restaurants": [
    {
      "restaurant_id": "",
      "restaurant_name": "",
      "restaurant_slug": "",
      "exact_count": 0,
      "accommodated_count": 0,
      "top_dishes": [
        { "name": "", "description": "", "status": "meets_all_requirements|can_accommodate" }
      ]
    }
  ]
}
Only include restaurants that have at least one relevant dish. Limit top_dishes to 5 per restaurant.`;

  const items = candidates.map(c => ({
    restaurant_id: c.restaurant_id,
    restaurant_name: c.restaurant_name,
    restaurant_slug: c.restaurant_slug,
    name: c.dish_name,
    description: (c.dish_description || "").slice(0, 240),
  }));

  return `${guidance}\n\nCandidate dishes (JSON array):\n${JSON.stringify(items)}`;
}
