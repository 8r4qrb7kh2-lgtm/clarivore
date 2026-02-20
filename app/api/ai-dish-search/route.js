import { corsJson, corsOptions } from "../_shared/cors";
import { asText, prisma } from "../editor-pending-save/_shared/pendingSaveUtils";
import { fetchRestaurantMenuStateMapFromTablesWithPrisma } from "../../lib/server/restaurantMenuStateServer.js";

export const runtime = "nodejs";

const MAX_AI_CANDIDATES = 260;
const MAX_AI_MATCHES = 80;
const MAX_DISHES_PER_RESTAURANT = 5;

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

function limitedEditDistance(left, right, maxDistance) {
  const a = asText(left).toLowerCase();
  const b = asText(right).toLowerCase();
  if (!a || !b) return maxDistance + 1;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const previous = new Array(b.length + 1);
  const current = new Array(b.length + 1);

  for (let index = 0; index <= b.length; index += 1) {
    previous[index] = index;
  }

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost,
      );
      if (current[j] < rowMin) rowMin = current[j];
    }

    if (rowMin > maxDistance) return maxDistance + 1;

    for (let copyIndex = 0; copyIndex <= b.length; copyIndex += 1) {
      previous[copyIndex] = current[copyIndex];
    }
  }

  return previous[b.length];
}

function fuzzyTokenSimilarity(term, token) {
  if (!term || !token) return 0;
  if (term === token) return 1;
  if (token.includes(term) || term.includes(token)) return 0.85;

  const maxDistance = term.length >= 6 || token.length >= 6 ? 2 : 1;
  const distance = limitedEditDistance(term, token, maxDistance);
  if (distance > maxDistance) return 0;

  return Math.max(0, 1 - distance / Math.max(term.length, token.length));
}

function fuzzyScore(text, terms) {
  const tokens = tokenize(text);
  if (!tokens.length || !terms.length) return 0;

  let score = 0;
  terms.forEach((term) => {
    let best = 0;
    tokens.forEach((token) => {
      const similarity = fuzzyTokenSimilarity(term, token);
      if (similarity > best) best = similarity;
    });

    if (best >= 0.72) {
      score += best;
    }
  });

  return score;
}

function computeRetrievalScore(query, dishName, description, terms) {
  const text = `${asText(dishName)} ${asText(description)}`.trim();
  const normalizedQuery = asText(query).toLowerCase();
  const phraseHit =
    normalizedQuery && asText(text).toLowerCase().includes(normalizedQuery) ? 1 : 0;

  const exact = simpleScore(text, terms);
  const fuzzy = fuzzyScore(text, terms);

  return exact * 4 + fuzzy * 2 + phraseHit * 3;
}

function toCandidateId(restaurantId, overlayIndex, dishName) {
  const normalizedDishName = asText(dishName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${asText(restaurantId)}:${overlayIndex}:${normalizedDishName || "dish"}`;
}

function normalizeRelevanceScore(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.min(100, Math.round(numeric)));
  }

  const fallbackNumeric = Number(fallback);
  if (Number.isFinite(fallbackNumeric)) {
    return Math.max(0, Math.min(100, Math.round(fallbackNumeric)));
  }

  return 0;
}

function groupRankedCandidates(rankedCandidates) {
  const byRestaurant = new Map();

  rankedCandidates.forEach((candidate) => {
    const key = asText(candidate.restaurant_id);
    if (!key) return;

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
    if (group.top_dishes.length < MAX_DISHES_PER_RESTAURANT) {
      group.top_dishes.push({
        candidate_id: candidate.candidate_id,
        name: candidate.dish_name,
        description: candidate.dish_description,
        relevance_score: candidate.relevance_score,
      });
    }
  });

  const results = Array.from(byRestaurant.values()).filter(
    (group) => group.top_dishes.length > 0,
  );

  results.forEach((group) => {
    group.exact_count = group.top_dishes.length;
    group.accommodated_count = 0;
  });

  results.sort((left, right) => {
    const leftTop = left.top_dishes[0]?.relevance_score || 0;
    const rightTop = right.top_dishes[0]?.relevance_score || 0;
    if (rightTop !== leftTop) return rightTop - leftTop;
    return right.top_dishes.length - left.top_dishes.length;
  });

  return results;
}

function summarizeBasic(candidates) {
  const relevant = (Array.isArray(candidates) ? candidates : []).filter(
    (candidate) => Number(candidate?.retrieval_score) > 0,
  );

  if (!relevant.length) return [];

  const clipped = relevant.slice(0, MAX_AI_MATCHES);
  const maxScore = Math.max(
    ...clipped.map((candidate) => Number(candidate.retrieval_score) || 0),
    1,
  );

  const ranked = clipped.map((candidate) => ({
    ...candidate,
    relevance_score: normalizeRelevanceScore(
      (Number(candidate.retrieval_score) / maxScore) * 100,
      0,
    ),
  }));

  return groupRankedCandidates(ranked);
}

function buildPrompt({ userQuery, userAllergens, userDiets, candidates }) {
  const guidance = `You rank dish relevance for a restaurant search feature.
User query: "${userQuery}"
User allergies (context only): ${JSON.stringify(userAllergens || [])}
User diets (context only): ${JSON.stringify(userDiets || [])}

Tasks:
1) Infer the likely intended query, including misspellings/typos.
2) Select only candidate dishes relevant to that intended query.
3) Assign an integer relevance_score (0-100).
4) Sort by relevance_score descending.
5) Use only provided candidate_id values. Do not invent IDs.
6) Do not classify compatibility status or dietary safety.

Return JSON only in this exact shape:
{
  "matches": [
    {"candidate_id": "", "restaurant_id": "", "relevance_score": 0}
  ]
}
Limit to at most ${MAX_AI_MATCHES} matches total.`;

  return `${guidance}\n\nCandidate dishes JSON:\n${JSON.stringify(candidates)}`;
}

function mapAiMatchesToResults(matches, candidateById) {
  const deduped = new Map();

  (Array.isArray(matches) ? matches : []).forEach((match) => {
    const candidateId = asText(match?.candidate_id);
    if (!candidateId) return;

    const candidate = candidateById.get(candidateId);
    if (!candidate) return;

    const fallbackScore = Math.max(1, Math.min(99, Math.round(candidate.retrieval_score * 10)));
    const relevanceScore = normalizeRelevanceScore(match?.relevance_score, fallbackScore);
    if (relevanceScore <= 0) return;

    const existing = deduped.get(candidateId);
    if (!existing || relevanceScore > existing.relevance_score) {
      deduped.set(candidateId, {
        ...candidate,
        relevance_score: relevanceScore,
      });
    }
  });

  const ranked = Array.from(deduped.values()).sort(
    (left, right) => right.relevance_score - left.relevance_score,
  );

  return groupRankedCandidates(ranked);
}

function addLastConfirmed(results, candidates) {
  const lastConfirmedByRestaurantId = new Map();
  candidates.forEach((candidate) => {
    if (!lastConfirmedByRestaurantId.has(candidate.restaurant_id)) {
      lastConfirmedByRestaurantId.set(
        candidate.restaurant_id,
        candidate.last_confirmed || null,
      );
    }
  });

  results.forEach((entry) => {
    const key = asText(entry?.restaurant_id);
    entry.last_confirmed = lastConfirmedByRestaurantId.get(key) || null;
  });

  return results;
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
      },
      orderBy: { name: "asc" },
    });

    const restaurantMenuState = await fetchRestaurantMenuStateMapFromTablesWithPrisma(
      prisma,
      (Array.isArray(restaurants) ? restaurants : []).map((restaurant) => restaurant.id),
    );

    const terms = tokenize(userQuery);
    const candidates = [];

    for (const restaurant of Array.isArray(restaurants) ? restaurants : []) {
      const overlays = Array.isArray(
        restaurantMenuState.get(asText(restaurant.id))?.overlays,
      )
        ? restaurantMenuState.get(asText(restaurant.id)).overlays
        : [];

      overlays.forEach((overlay, overlayIndex) => {
        const dishName = asText(overlay?.name || overlay?.id || overlay?.dishName);
        if (!dishName) return;

        let description = asText(overlay?.description);
        if (!description && overlay?.details?.__ingredientsSummary) {
          description = asText(overlay.details.__ingredientsSummary);
        }
        if (!description && overlay?.ingredients) {
          description = asText(overlay.ingredients);
        }

        const retrievalScore = computeRetrievalScore(userQuery, dishName, description, terms);

        candidates.push({
          candidate_id: toCandidateId(restaurant.id, overlayIndex, dishName),
          restaurant_id: asText(restaurant.id),
          restaurant_name: asText(restaurant.name),
          restaurant_slug: asText(restaurant.slug) || null,
          dish_name: dishName,
          dish_description: description,
          retrieval_score: retrievalScore,
          last_confirmed: restaurant.last_confirmed,
        });
      });
    }

    if (!candidates.length) {
      return corsJson({ results: [], message: "No relevant dishes found" }, { status: 200 });
    }

    candidates.sort((left, right) => {
      if (right.retrieval_score !== left.retrieval_score) {
        return right.retrieval_score - left.retrieval_score;
      }
      return asText(left.dish_name).localeCompare(asText(right.dish_name));
    });

    const clipped = candidates.slice(0, MAX_AI_CANDIDATES);
    const candidateById = new Map(clipped.map((candidate) => [candidate.candidate_id, candidate]));

    const anthropicApiKey = asText(process.env.ANTHROPIC_API_KEY);
    if (!anthropicApiKey) {
      const fallback = addLastConfirmed(summarizeBasic(clipped), clipped);
      return corsJson({ results: fallback, provider: "basic" }, { status: 200 });
    }

    const prompt = buildPrompt({
      userQuery,
      userAllergens,
      userDiets,
      candidates: clipped.map((entry) => ({
        candidate_id: entry.candidate_id,
        restaurant_id: entry.restaurant_id,
        restaurant_name: entry.restaurant_name,
        restaurant_slug: entry.restaurant_slug,
        name: entry.dish_name,
        description: asText(entry.dish_description).slice(0, 280),
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
      const fallback = addLastConfirmed(summarizeBasic(clipped), clipped);
      return corsJson(
        { results: fallback, provider: "fallback", error: "AI request failed" },
        { status: 200 },
      );
    }

    const aiData = await aiResponse.json();
    const content = asText(aiData?.content?.[0]?.text);
    const jsonMatch = content.match(/\{[\s\S]*"matches"[\s\S]*\}/);

    if (!jsonMatch?.[0]) {
      const fallback = addLastConfirmed(summarizeBasic(clipped), clipped);
      return corsJson(
        {
          results: fallback,
          provider: "fallback",
          error: "Could not parse AI output",
        },
        { status: 200 },
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const matches = Array.isArray(parsed?.matches) ? parsed.matches : [];
    if (!matches.length) {
      return corsJson({ results: [], provider: "claude-empty" }, { status: 200 });
    }

    const results = addLastConfirmed(mapAiMatchesToResults(matches, candidateById), clipped);
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
