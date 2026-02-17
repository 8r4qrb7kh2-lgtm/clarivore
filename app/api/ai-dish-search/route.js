import { corsJson, corsOptions } from "../_shared/cors";
import { asText, prisma } from "../editor-pending-save/_shared/pendingSaveUtils";

export const runtime = "nodejs";

function tokenize(text) {
  return asText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function simpleScore(text, terms) {
  const hay = asText(text).toLowerCase();
  let score = 0;
  terms.forEach((term) => {
    if (hay.includes(term)) score += 1;
  });
  return score;
}

function summarizeBasic(candidates) {
  const byRestaurant = new Map();
  for (const candidate of candidates) {
    const key = asText(candidate.restaurant_id);
    if (!key) continue;

    if (!byRestaurant.has(key)) {
      byRestaurant.set(key, {
        restaurant_id: candidate.restaurant_id,
        restaurant_name: candidate.restaurant_name,
        restaurant_slug: candidate.restaurant_slug,
        exact_count: 0,
        accommodated_count: 0,
        top_dishes: [],
      });
    }

    const group = byRestaurant.get(key);
    group.accommodated_count += 1;
    if (group.top_dishes.length < 5) {
      group.top_dishes.push({
        name: candidate.dish_name,
        description: candidate.dish_description,
        status: "can_accommodate",
      });
    }
  }

  return Array.from(byRestaurant.values());
}

function buildPrompt({ userQuery, userAllergens, userDiets, candidates }) {
  const guidance = `You are helping a diner find dishes across many restaurants.
User request: "${userQuery}"
User allergies (avoid): ${JSON.stringify(userAllergens || [])}
User diets (must satisfy): ${JSON.stringify(userDiets || [])}

Tasks:
1) Determine which candidate dishes are relevant to the request.
2) Label each relevant dish status as:
   - meets_all_requirements
   - can_accommodate
3) Group by restaurant.

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
        {"name": "", "description": "", "status": "meets_all_requirements|can_accommodate"}
      ]
    }
  ]
}
Only include restaurants that have at least one relevant dish. Limit top_dishes to 5 per restaurant.`;

  return `${guidance}\n\nCandidate dishes JSON:\n${JSON.stringify(candidates)}`;
}

export function OPTIONS() {
  return corsOptions();
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsJson({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const userQuery = asText(body?.userQuery);
  const userAllergens = Array.isArray(body?.userAllergens) ? body.userAllergens : [];
  const userDiets = Array.isArray(body?.userDiets) ? body.userDiets : [];

  if (!userQuery) {
    return corsJson({ error: "userQuery is required" }, { status: 400 });
  }

  try {
    const restaurants = await prisma.restaurants.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        last_confirmed: true,
        overlays: true,
      },
      orderBy: { name: "asc" },
    });

    const terms = tokenize(userQuery);
    const candidates = [];
    const maxCandidates = 400;

    for (const restaurant of Array.isArray(restaurants) ? restaurants : []) {
      const overlays = Array.isArray(restaurant.overlays) ? restaurant.overlays : [];
      for (const overlay of overlays) {
        const dishName = asText(overlay?.name || overlay?.id || overlay?.dishName);
        if (!dishName) continue;

        let description = asText(overlay?.description);
        if (!description && overlay?.details?.__ingredientsSummary) {
          description = asText(overlay.details.__ingredientsSummary);
        }
        if (!description && overlay?.ingredients) {
          description = asText(overlay.ingredients);
        }

        const prefilter = simpleScore(`${dishName} ${description}`, terms);
        const include = terms.length <= 1 ? true : prefilter > 0;
        if (!include) continue;

        candidates.push({
          restaurant_id: asText(restaurant.id),
          restaurant_name: asText(restaurant.name),
          restaurant_slug: asText(restaurant.slug) || null,
          dish_name: dishName,
          dish_description: description,
          last_confirmed: restaurant.last_confirmed,
        });

        if (candidates.length >= maxCandidates) break;
      }
      if (candidates.length >= maxCandidates) break;
    }

    if (!candidates.length) {
      return corsJson({ results: [], message: "No relevant dishes found" }, { status: 200 });
    }

    candidates.sort(
      (left, right) =>
        simpleScore(`${right.dish_name} ${right.dish_description}`, terms) -
        simpleScore(`${left.dish_name} ${left.dish_description}`, terms),
    );

    const clipped = candidates.slice(0, maxCandidates);
    const anthropicApiKey = asText(process.env.ANTHROPIC_API_KEY);

    if (!anthropicApiKey) {
      return corsJson(
        {
          results: summarizeBasic(clipped),
          provider: "basic",
        },
        { status: 200 },
      );
    }

    const prompt = buildPrompt({
      userQuery,
      userAllergens,
      userDiets,
      candidates: clipped.map((entry) => ({
        restaurant_id: entry.restaurant_id,
        restaurant_name: entry.restaurant_name,
        restaurant_slug: entry.restaurant_slug,
        name: entry.dish_name,
        description: asText(entry.dish_description).slice(0, 240),
      })),
    });

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiResponse.ok) {
      const fallback = summarizeBasic(clipped);
      return corsJson({ results: fallback, provider: "fallback", error: "AI request failed" }, { status: 200 });
    }

    const aiData = await aiResponse.json();
    const content = asText(aiData?.content?.[0]?.text);
    const jsonMatch = content.match(/\{[\s\S]*"restaurants"[\s\S]*\}/);

    if (!jsonMatch?.[0]) {
      const fallback = summarizeBasic(clipped);
      return corsJson(
        { results: fallback, provider: "fallback", error: "Could not parse AI output" },
        { status: 200 },
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const results = Array.isArray(parsed?.restaurants) ? parsed.restaurants : [];

    if (!results.length) {
      const fallback = summarizeBasic(clipped);
      return corsJson({ results: fallback, provider: "fallback-empty" }, { status: 200 });
    }

    const lastConfirmedByRestaurantId = new Map();
    clipped.forEach((candidate) => {
      if (!lastConfirmedByRestaurantId.has(candidate.restaurant_id)) {
        lastConfirmedByRestaurantId.set(candidate.restaurant_id, candidate.last_confirmed || null);
      }
    });

    results.forEach((entry) => {
      const key = asText(entry?.restaurant_id);
      entry.last_confirmed = lastConfirmedByRestaurantId.get(key) || null;
    });

    return corsJson({ results, provider: "claude" }, { status: 200 });
  } catch (error) {
    return corsJson(
      {
        error: asText(error?.message) || "Internal error",
      },
      { status: 500 },
    );
  }
}
