import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

type Dish = { name: string; description?: string };

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

    // Fetch all restaurants (including overlays which contain dishes)
    // Only use overlays since they contain confirmed allergen and dietary data from restaurant managers
    const { data: restaurants, error: restaurantsError } = await supabase
      .from("restaurants")
      .select("id, name, slug, last_confirmed, overlays")
      .order("name");
    if (restaurantsError) throw restaurantsError;

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

    const candidates: Candidate[] = [];
    for (const r of restaurants || []) {
      const rid = String(r.id);
      // Only use overlays - they contain confirmed allergen and dietary data from restaurant managers
      if ((r as any).overlays && Array.isArray((r as any).overlays)) {
        const overlayDishes = ((r as any).overlays as any[]).map((ov: any) => {
          // Extract description from various possible fields
          let description = "";
          if (ov.description) {
            description = ov.description;
          } else if (ov.details && ov.details.__ingredientsSummary) {
            description = ov.details.__ingredientsSummary;
          } else if (ov.aiIngredientSummary) {
            try {
              // aiIngredientSummary is stored as a JSON string array
              const summaryArray = JSON.parse(ov.aiIngredientSummary);
              if (Array.isArray(summaryArray)) {
                description = summaryArray.join(", ");
              }
            } catch (e) {
              // If parsing fails, use as-is
              description = ov.aiIngredientSummary;
            }
          } else if (ov.ingredients) {
            description = ov.ingredients;
          }
          
          return {
            name: ov.name || ov.id || "",
            description: description,
          };
        }).filter((d: Dish) => d.name);
        
        for (const d of overlayDishes) {
          const name = (d?.name || "").toString();
          const desc = (d?.description || "").toString();
          if (!name) continue;
          const prefilterScore = simpleScore(`${name} ${desc}`, normalizedQueryTerms);
          // For single-word queries, include all dishes; for longer queries, require at least one term match
          const shouldInclude = normalizedQueryTerms.length === 1 ? true : prefilterScore > 0;
          if (shouldInclude) {
            candidates.push({
              restaurant_id: rid,
              restaurant_name: r.name,
              restaurant_slug: (r as any).slug || null,
              dish_name: name,
              dish_description: desc,
            });
          }
        }
      }
    }
    
    // If no keyword matches but we have dishes, include all dishes for AI to evaluate
    if (candidates.length === 0 && normalizedQueryTerms.length > 1) {
      for (const r of restaurants || []) {
        const rid = String(r.id);
        // Only use overlays
        if ((r as any).overlays && Array.isArray((r as any).overlays)) {
          const overlayDishes = ((r as any).overlays as any[]).map((ov: any) => {
            // Extract description from various possible fields
            let description = "";
            if (ov.description) {
              description = ov.description;
            } else if (ov.details && ov.details.__ingredientsSummary) {
              description = ov.details.__ingredientsSummary;
            } else if (ov.aiIngredientSummary) {
              try {
                // aiIngredientSummary is stored as a JSON string array
                const summaryArray = JSON.parse(ov.aiIngredientSummary);
                if (Array.isArray(summaryArray)) {
                  description = summaryArray.join(", ");
                }
              } catch (e) {
                // If parsing fails, use as-is
                description = ov.aiIngredientSummary;
              }
            } else if (ov.ingredients) {
              description = ov.ingredients;
            }
            
            return {
              name: ov.name || ov.id || "",
              description: description,
            };
          }).filter((d: Dish) => d.name);
          
          for (const d of overlayDishes) {
            const name = (d?.name || "").toString();
            const desc = (d?.description || "").toString();
            if (!name) continue;
            candidates.push({
              restaurant_id: rid,
              restaurant_name: r.name,
              restaurant_slug: (r as any).slug || null,
              dish_name: name,
              dish_description: desc,
            });
          }
        }
      }
      // Cap fallback to prevent too many candidates
      if (candidates.length > MAX_CANDIDATES) {
        candidates.splice(MAX_CANDIDATES);
      }
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
