import { corsJson, corsOptions } from "../_shared/cors";
import { asText, prisma } from "../editor-pending-save/_shared/pendingSaveUtils";
import { Prisma } from "@prisma/client";
import { buildHelpAssistantSystemPrompt } from "../../lib/claudePrompts";

export const runtime = "nodejs";

function tokenize(value) {
  return asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function buildContextText(pageContext) {
  if (!pageContext || typeof pageContext !== "object") return "";
  const parts = [
    pageContext.title,
    pageContext.url,
    pageContext.path,
    ...(Array.isArray(pageContext.headings) ? pageContext.headings : []),
    ...(Array.isArray(pageContext.buttons) ? pageContext.buttons : []),
    ...(Array.isArray(pageContext.labels) ? pageContext.labels : []),
    ...(Array.isArray(pageContext.inputs) ? pageContext.inputs : []),
  ];
  return parts.map((item) => asText(item)).filter(Boolean).join(" ");
}

function scoreEntry(entry, tokens) {
  if (!tokens.length) return 0;
  const haystack = [
    entry.title,
    entry.content,
    entry.url,
    entry.source_path,
    ...(Array.isArray(entry.tags) ? entry.tags : []),
  ]
    .map((item) => asText(item).toLowerCase())
    .join(" ");

  let score = 0;
  tokens.forEach((token) => {
    if (!token) return;
    if (haystack.includes(token)) score += 1;
  });
  return score;
}

async function fetchKnowledgeBase({ query, mode, pageContext }) {
  const requestedMode = asText(mode).toLowerCase() === "manager" ? "manager" : "customer";
  const contextText = buildContextText(pageContext);
  const tokens = [...new Set([...tokenize(query), ...tokenize(contextText)])];

  if (!tokens.length) return { context: "", requestedMode };

  const requestedModes = requestedMode === "manager" ? ["manager", "customer"] : ["customer"];
  const searchText = tokens.join(" ");

  let kbRows = [];
  try {
    const modeValues = Prisma.join(requestedModes.map((value) => Prisma.sql`${value}`));
    const rows = await prisma.$queryRaw`
      SELECT
        title,
        content,
        url,
        source_path,
        tags,
        mode,
        ts_rank_cd(
          to_tsvector('english', title || ' ' || content),
          websearch_to_tsquery('english', ${searchText})
        ) AS rank
      FROM public.help_kb
      WHERE mode IN (${modeValues})
        AND to_tsvector('english', title || ' ' || content)
          @@ websearch_to_tsquery('english', ${searchText})
      ORDER BY rank DESC
      LIMIT 120
    `;
    kbRows = Array.isArray(rows) ? rows : [];
  } catch {
    kbRows = await prisma.help_kb.findMany({
      where: {
        mode: {
          in: requestedModes,
        },
      },
      select: {
        title: true,
        content: true,
        url: true,
        source_path: true,
        tags: true,
        mode: true,
      },
      take: 500,
    });
  }

  const ranked = (Array.isArray(kbRows) ? kbRows : [])
    .map((entry) => ({
      entry,
      score: scoreEntry(entry, tokens),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 10)
    .map(({ entry }, index) => {
      const source = asText(entry.source_path) || asText(entry.url) || "kb";
      const content = asText(entry.content).slice(0, 900);
      return `Snippet ${index + 1}: ${asText(entry.title)} [${source}]\n${content}`;
    })
    .join("\n\n");

  return {
    context: ranked,
    requestedMode,
  };
}

async function fetchCanonicalFacts() {
  const [allergens, diets] = await Promise.all([
    prisma.allergens.findMany({
      where: { is_active: true },
      select: { label: true, key: true, sort_order: true },
      orderBy: { sort_order: "asc" },
    }),
    prisma.diets.findMany({
      where: { is_active: true, is_supported: true },
      select: { label: true, key: true, sort_order: true },
      orderBy: { sort_order: "asc" },
    }),
  ]);

  const allergenLabels = (Array.isArray(allergens) ? allergens : [])
    .map((entry) => asText(entry.label || entry.key))
    .filter(Boolean);
  const dietLabels = (Array.isArray(diets) ? diets : [])
    .map((entry) => asText(entry.label || entry.key))
    .filter(Boolean);

  return `Canonical selectable options:\n- Allergens: ${allergenLabels.join(", ")}\n- Diets: ${dietLabels.join(", ")}`;
}

function sanitizeHistory(messages, query) {
  const history = Array.isArray(messages) ? messages : [];
  const sanitized = history
    .filter((msg) => msg && typeof msg.content === "string")
    .map((msg) => ({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: asText(msg.content),
    }))
    .filter((msg) => msg.content)
    .slice(-12);

  const trimmedQuery = asText(query);
  const last = sanitized[sanitized.length - 1];
  if (!last || last.role !== "user" || last.content !== trimmedQuery) {
    sanitized.push({ role: "user", content: trimmedQuery });
  }

  return sanitized;
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

  const query = asText(body?.query);
  if (!query) {
    return corsJson({ error: "Query is required." }, { status: 400 });
  }

  const anthropicApiKey = asText(process.env.ANTHROPIC_API_KEY);
  if (!anthropicApiKey) {
    return corsJson({ error: "Anthropic API key not configured." }, { status: 500 });
  }

  try {
    const { context, requestedMode } = await fetchKnowledgeBase({
      query,
      mode: body?.mode,
      pageContext: body?.pageContext,
    });

    const canonicalFacts = await fetchCanonicalFacts();
    const systemPrompt = buildHelpAssistantSystemPrompt({
      requestedMode,
      canonicalFacts,
      evidence: context,
    });
    const messages = sanitizeHistory(body?.messages, query);

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 900,
        temperature: 0.2,
        system: systemPrompt,
        messages,
      }),
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      throw new Error(`Claude API error (${claudeResponse.status}): ${errorText.slice(0, 240)}`);
    }

    const aiResult = await claudeResponse.json();
    const answer = asText(aiResult?.content?.[0]?.text);

    return corsJson({ answer }, { status: 200 });
  } catch (error) {
    return corsJson(
      {
        error: "Help assistant failed",
        message: asText(error?.message) || "Unknown error",
      },
      { status: 500 },
    );
  }
}
