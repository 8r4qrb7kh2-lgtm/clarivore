import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getCorsHeaders } from "../_shared/cors.ts"
import { fetchAllergenDietConfig } from "../_shared/allergen-diet-config.ts"

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const buildCanonicalFacts = (allergens: string[], diets: string[]) => `Canonical selectable options (authoritative):
- Allergens: ${allergens.join(', ')}
- Diets: ${diets.join(', ')}
Only list these allergens/diets. If asked about any other diet or allergen, say it is not supported.`

const CUSTOMER_GUIDE = `You are Clarivore's Help assistant.
You can answer customer or manager questions; prefer customer context when it applies.
Use the product knowledge and the Knowledge Base. If information is uncertain, say so and suggest contacting support.

Key pages and actions:
- Landing: / shows a restaurant directory.
- Home: /home shows recently viewed restaurants.
- Restaurants: /restaurants lists all restaurants.
- Favorites: /favorites shows saved restaurants.
- Dish search: /dish-search lets users search for dishes.
- My dishes: /my-dishes shows liked dishes.
- Restaurant menu: /restaurant?slug=RESTAURANT_SLUG shows the menu image.
- Customers select allergens and diets, then press “I understand” to reveal the menu.
- Use pinch/zoom and tap dishes for details on the menu.
- Account settings: /account for sign-in and saved preferences.
- Help/contact: /help-contact for feedback and reporting issues.

Response style:
- Be concise, step-by-step when explaining a workflow.
- Use bullets for steps.
- Provide direct links using relative URLs when relevant.
- Never mention internal tools or implementation details outside of the Evidence section.
Evidence guidance:
- Evidence snippets may include code or page text. Use them when available.
- You may infer behavior from code when it is clear; if the inference is uncertain, say so.
- Include an Evidence section when you cite snippets; otherwise it is optional.
- Prefer exact UI labels when you have them, but you may answer without them if needed.
- Do not answer with only "I don't know" if there are relevant code snippets; infer the workflow and note uncertainty.
Linking guidance:
- Link pages or UI labels when you can match them exactly; otherwise describe the location plainly.`

const MANAGER_GUIDE = `You are Clarivore's Help assistant.
You can answer customer or manager questions; prefer editor context when it applies.
Use the product knowledge and the Knowledge Base. If information is uncertain, say so and suggest contacting support.

Key pages and actions:
- Manager dashboard: /manager-dashboard (analytics + direct messages).
- Webpage editor: /restaurant?slug=RESTAURANT_SLUG&edit=1.
- Editor actions: add overlay, edit menu images, view change log, restaurant settings, confirm info, save to site.
- Tablet pages: /server-tablet and /kitchen-tablet.
- Customer mode pages: /home, /restaurants, /dish-search, /favorites, /my-dishes.
- Account settings: /account.
- Help/contact: /help-contact for direct chat and issue reporting.

Response style:
- Be concise, step-by-step when explaining a workflow.
- Use bullets for steps.
- Provide direct links using relative URLs when relevant.
- Never mention internal tools or implementation details outside of the Evidence section.
Evidence guidance:
- Evidence snippets may include code or page text. Use them when available.
- You may infer behavior from code when it is clear; if the inference is uncertain, say so.
- Include an Evidence section when you cite snippets; otherwise it is optional.
- Prefer exact UI labels when you have them, but you may answer without them if needed.
- Do not answer with only "I don't know" if there are relevant code snippets; infer the workflow and note uncertainty.
Linking guidance:
- Link pages or UI labels when you can match them exactly; otherwise describe the location plainly.`

type HelpKbEntry = {
  title: string
  content: string
  url: string | null
  mode?: string | null
  tags?: string[] | null
  source_path?: string | null
}

type PageContext = {
  url?: string | null
  path?: string | null
  title?: string | null
  headings?: string[] | null
  buttons?: string[] | null
  labels?: string[] | null
  inputs?: string[] | null
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'when', 'then',
  'what', 'where', 'which', 'how', 'your', 'you', 'are', 'can', 'will',
  'about', 'into', 'into', 'have', 'has', 'had', 'not', 'but', 'its',
  'use', 'using', 'used', 'page', 'view', 'see', 'show', 'find', 'need'
])

const MANAGER_SIGNAL_TERMS = [
  'manager',
  'editor',
  'admin',
  'dashboard',
  'webpage editor',
  'restaurant settings',
  'change log',
  'confirm information',
  'add overlay',
  'menu images',
  'server tablet',
  'kitchen tablet',
  'tablet'
]

const CUSTOMER_SIGNAL_TERMS = [
  'customer',
  'diner',
  'guest',
  'restaurant menu',
  'dish search',
  'favorites',
  'my dishes'
]

const TOKEN_SYNONYMS: Record<string, string[]> = {
  allergy: ['allergen', 'allergens'],
  allergies: ['allergen', 'allergens'],
  allergen: ['allergy', 'allergies', 'ingredient', 'ingredients'],
  allergens: ['allergy', 'allergies', 'ingredient', 'ingredients'],
  diet: ['dietary', 'diets'],
  diets: ['dietary', 'diet'],
  dietary: ['diet', 'diets'],
  input: ['add', 'edit', 'update', 'save', 'confirm', 'upload', 'scan', 'capture', 'enter'],
  inputs: ['add', 'edit', 'update', 'save', 'confirm', 'upload', 'scan', 'capture', 'enter'],
  manager: ['editor', 'admin', 'dashboard'],
  managers: ['editor', 'admin', 'dashboard', 'manager'],
  dish: ['menu', 'item', 'overlay', 'ingredient'],
  dishes: ['menu', 'items', 'overlays', 'ingredients'],
  brand: ['ingredient', 'label', 'product', 'item', 'replace', 'swap'],
  brands: ['ingredient', 'label', 'product', 'item', 'replace', 'swap'],
  replace: ['swap', 'update', 'edit'],
  replacement: ['replace', 'swap', 'update'],
  data: ['info', 'information', 'verified', 'confirm', 'confirmed'],
  trust: ['verified', 'confirm', 'confirmed', 'accuracy'],
  safe: ['complies'],
  unsafe: ['cannot', 'noncompliant'],
  cross: ['contamination']
}

function hasAnyTerm(text: string, terms: string[]) {
  if (!text) return false
  const lower = text.toLowerCase()
  return terms.some((term) => lower.includes(term))
}

function inferKbModes(query: string, requestedMode: 'customer' | 'manager', context?: PageContext | null) {
  const contextText = buildContextText(context)
  const managerSignal = hasAnyTerm(query, MANAGER_SIGNAL_TERMS) || hasAnyTerm(contextText, MANAGER_SIGNAL_TERMS)
  const customerSignal = hasAnyTerm(query, CUSTOMER_SIGNAL_TERMS) || hasAnyTerm(contextText, CUSTOMER_SIGNAL_TERMS)
  if (managerSignal && customerSignal) return ['customer', 'manager']
  if (managerSignal) return ['manager', 'customer']
  if (customerSignal) return ['customer', 'manager']
  return [requestedMode]
}

function tokenize(query: string) {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
  const expanded = new Set(tokens)
  for (const token of tokens) {
    const synonyms = TOKEN_SYNONYMS[token] || []
    synonyms.forEach((syn) => expanded.add(syn))
    if (token.endsWith('ies') && token.length > 3) {
      expanded.add(`${token.slice(0, -3)}y`)
    }
    if (token.endsWith('y') && token.length > 3) {
      expanded.add(`${token.slice(0, -1)}en`)
    }
    if (token.endsWith('s') && token.length > 3) {
      expanded.add(token.slice(0, -1))
    }
  }
  return [...expanded]
}

function scoreEntry(entry: HelpKbEntry, tokens: string[]) {
  const haystack = `${entry.title} ${entry.content} ${(entry.tags || []).join(' ')} ${entry.source_path || ''}`.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1
  }
  const titleLower = (entry.title || '').toLowerCase()
  for (const token of tokens) {
    if (titleLower.includes(token)) score += 2
  }
  return score
}

function extractPageKey(value?: string | null) {
  if (!value) return ''
  try {
    const url = value.includes('://') ? new URL(value) : new URL(value, 'https://clarivore.org')
    return url.pathname.split('/').pop() || ''
  } catch (_) {
    const trimmed = value.split('?')[0]
    return trimmed.split('/').pop() || ''
  }
}

function buildContextText(context?: PageContext | null) {
  if (!context) return ''
  const parts = [
    context.title || '',
    context.url || '',
    context.path || '',
    ...(Array.isArray(context.headings) ? context.headings : []),
    ...(Array.isArray(context.buttons) ? context.buttons : []),
    ...(Array.isArray(context.labels) ? context.labels : []),
    ...(Array.isArray(context.inputs) ? context.inputs : [])
  ]
  return parts.filter(Boolean).join(' ')
}

function isEvidenceEntry(entry: HelpKbEntry) {
  return Array.isArray(entry.tags) && entry.tags.includes('evidence')
}

function shouldExposeUrl(url: string | null) {
  if (!url) return false
  const trimmed = url.trim()
  if (trimmed.startsWith('/')) return true
  try {
    const parsed = new URL(trimmed)
    return parsed.origin === 'https://clarivore.org' && parsed.pathname.startsWith('/')
  } catch (_) {
    return false
  }
}


function sanitizeAnswer(answer: string, canonicalDiets: string[]) {
  const lower = answer.toLowerCase()
  const disallowedDietTerms = [
    'keto',
    'low-carb',
    'low carb',
    'intermittent fasting',
    'paleo',
    'whole30',
    'fodmap',
    'halal',
    'kosher'
  ]
  if (disallowedDietTerms.some((term) => lower.includes(term))) {
    return `Clarivore currently supports these diets: ${canonicalDiets.join(', ')}.\n` +
      `Only these diets are selectable in the app.`
  }
  return answer
}

function extractEvidenceLabels(kbContext: string) {
  const labels = new Set<string>()
  const prefixes = ['buttons:', 'labels:', 'inputs:', 'headings:', 'links:', 'list items:']
  kbContext.split('\n').forEach((line) => {
    const trimmed = line.trim()
    const lower = trimmed.toLowerCase()
    const prefix = prefixes.find((item) => lower.startsWith(item))
    if (!prefix) return
    const raw = trimmed.slice(prefix.length).trim()
    raw.split('|').map((part) => part.trim()).forEach((part) => {
      if (!part) return
      const cleaned = part.replace(/\s+/g, ' ').trim()
      if (cleaned.length > 2) labels.add(cleaned.toLowerCase())
    })
  })
  return labels
}

function filterStepsByEvidence(answer: string, kbContext: string) {
  if (!kbContext) return answer
  const labels = extractEvidenceLabels(kbContext)
  if (!labels.size) return answer

  const lines = answer.split('\n')
  let inCodeBlock = false
  let hasNumberedSteps = false
  const stepLines: { index: number; text: string; kept: boolean }[] = []

  const stepRegex = /^\s*(\d+\.|[-*•])\s+(.+)$/

  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      return
    }
    if (inCodeBlock) return
    const match = line.match(stepRegex)
    if (!match) return
    if (/^\s*\d+\./.test(line)) hasNumberedSteps = true
    const text = match[2].trim()
    const lowerText = text.toLowerCase()
    const hasLabel = Array.from(labels).some((label) => label && lowerText.includes(label))
    stepLines.push({ index, text, kept: hasLabel })
  })

  if (!stepLines.length) return answer

  const keptSteps = stepLines.filter((step) => step.kept)
  if (!keptSteps.length) {
    return "I don't know based on the available evidence."
  }

  let stepCounter = 1
  const updatedLines = lines.map((line, index) => {
    const step = stepLines.find((item) => item.index === index)
    if (!step) return line
    if (!step.kept) return null
    if (hasNumberedSteps) {
      const nextLine = `${stepCounter}. ${step.text}`
      stepCounter += 1
      return nextLine
    }
    return `- ${step.text}`
  })

  return updatedLines.filter((line) => line !== null).join('\n')
}

const UI_EVIDENCE_PREFIXES = [
  'headings:',
  'buttons:',
  'labels:',
  'inputs:',
  'links:',
  'paragraphs:',
  'list items:',
  'ui:',
  'behavior:'
]

const BEHAVIOR_KEYWORDS = [
  'show',
  'hide',
  'display',
  'reveal',
  'filter',
  'sort',
  'update',
  'save',
  'confirm',
  'verify',
  'require',
  'block',
  'allow',
  'redirect',
  'navigate',
  'open',
  'close',
  'enable',
  'disable',
  'select',
  'add',
  'remove',
  'delete',
  'upload',
  'scan',
  'capture',
  'analyze',
  'process',
  'submit',
  'send',
  'report',
  'appeal'
]

function isUiEvidenceLine(line: string) {
  const lower = line.toLowerCase()
  return UI_EVIDENCE_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

function lineMatchesTokens(line: string, tokens: string[]) {
  if (!tokens.length) return true
  const lower = line.toLowerCase()
  return tokens.some((token) => token.length > 2 && lower.includes(token))
}

function isUiAssignmentLine(line: string) {
  const lower = line.toLowerCase()
  const uiHints = [
    'textcontent',
    'innertext',
    'innerhtml',
    'placeholder',
    'aria-label',
    'arialabel',
    'title',
    '.label',
    'setattribute',
    '<',
    'button'
  ]
  if (!uiHints.some((hint) => lower.includes(hint))) return false
  if (lower.includes('console.')) return false
  return true
}

function lineHasUserFacingString(line: string) {
  const matches = line.match(/(["'`])([^"'`]*?)\1/g)
  if (!matches) return false
  for (const raw of matches) {
    const cleaned = raw.slice(1, -1).trim()
    if (!/[a-zA-Z]{3,}/.test(cleaned)) continue
    if (/[a-z][A-Z]/.test(cleaned)) continue
    if (cleaned.startsWith('.') || cleaned.startsWith('#')) continue
    if (cleaned.includes('://')) continue
    return true
  }
  return false
}

function extractCommentText(line: string) {
  const trimmed = line.trim()
  if (trimmed.startsWith('//')) return trimmed.slice(2).trim()
  if (trimmed.startsWith('/*') && trimmed.endsWith('*/')) return trimmed.slice(2, -2).trim()
  if (trimmed.startsWith('*')) return trimmed.slice(1).trim()
  const inlineIndex = line.indexOf('//')
  if (inlineIndex >= 0) return line.slice(inlineIndex + 2).trim()
  const blockStart = line.indexOf('/*')
  if (blockStart >= 0) {
    const blockEnd = line.indexOf('*/', blockStart + 2)
    if (blockEnd > blockStart) {
      return line.slice(blockStart + 2, blockEnd).trim()
    }
  }
  return ''
}

function commentHasBehavior(comment: string, tokens: string[]) {
  const lower = comment.toLowerCase()
  if (!BEHAVIOR_KEYWORDS.some((keyword) => lower.includes(keyword))) return false
  return lineMatchesTokens(comment, tokens)
}

function extractConcreteEvidenceLines(entry: HelpKbEntry, tokens: string[]) {
  const lines = (entry.content || '').split('\n').map((line) => line.trim()).filter(Boolean)
  const matched: string[] = []
  const fallback: string[] = []

  for (const line of lines) {
    if (isUiEvidenceLine(line)) {
      if (lineMatchesTokens(line, tokens)) {
        matched.push(line)
      } else {
        fallback.push(line)
      }
      continue
    }
    if (lineHasUserFacingString(line) && isUiAssignmentLine(line)) {
      if (lineMatchesTokens(line, tokens)) {
        matched.push(line)
      } else {
        fallback.push(line)
      }
      continue
    }
    const commentText = extractCommentText(line)
    if (commentText) {
      if (commentHasBehavior(commentText, tokens)) {
        matched.push(commentText)
      } else if (BEHAVIOR_KEYWORDS.some((keyword) => commentText.toLowerCase().includes(keyword))) {
        fallback.push(commentText)
      }
    }
  }

  if (matched.length) return matched.slice(0, 8)
  return fallback.slice(0, 4)
}

async function fetchKnowledgeBase(
  query: string,
  modes: ('customer' | 'manager')[],
  context: PageContext | null | undefined,
  preferredMode: 'customer' | 'manager'
) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { context: '' }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await supabase
    .from('help_kb')
    .select('title, content, url, tags, source_path, mode')
    .in('mode', modes)

  if (error || !data) {
    console.warn('Help KB lookup failed:', error?.message || error)
    return { context: '' }
  }

  const contextText = buildContextText(context)
  const combinedText = [query, contextText].filter(Boolean).join(' ')
  const queryTokens = tokenize(query)
  const contextTokens = tokenize(contextText)
  const lowerCombined = combinedText.toLowerCase()
  if (lowerCombined.includes('replace item') || lowerCombined.includes('replacement') || lowerCombined.includes('replace brand')) {
    const extraTokens = ['capture', 'ingredient', 'photo', 'analyze', 'apply', 'product', 'front']
    extraTokens.forEach((token) => queryTokens.push(token))
  }
  const dedupedQueryTokens = [...new Set(queryTokens)]
  const dedupedContextTokens = [...new Set(contextTokens)]
  const combinedTokens = [...new Set([...dedupedQueryTokens, ...dedupedContextTokens])]
  if (!combinedTokens.length) return { context: '' }

  const pageKey = extractPageKey(context?.url || context?.path || '')
  const scored = (data as HelpKbEntry[])
    .filter((entry) => !(entry.source_path || '').includes('supabase/functions/help-assistant'))
    .filter((entry) => isEvidenceEntry(entry))
    .map((entry) => {
      const queryScore = scoreEntry(entry, dedupedQueryTokens)
      const contextScore = scoreEntry(entry, dedupedContextTokens)
      let score = queryScore * 3 + contextScore
      const tags = entry.tags || []
      if (tags.includes('code') || tags.includes('page-script')) score += 3
      if (tags.includes('ui-evidence')) score += 6
      if (tags.includes('page-text')) score += 4
      if (pageKey && queryScore > 0 && ((entry.source_path || '').includes(pageKey) || (entry.url || '').includes(pageKey))) {
        score += 4
      }
      const entryMode = (entry.mode || '').toString().toLowerCase()
      if (entryMode === preferredMode) score += 4
      else if (entryMode) score += 1
      return { entry, score, queryScore }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)

  const hasQueryMatches = scored.some((item) => item.queryScore > 0)
  const filtered = hasQueryMatches ? scored.filter((item) => item.queryScore > 0) : scored
  const preferred = filtered.filter((item) => {
    const tags = item.entry.tags || []
    return tags.includes('ui-evidence') || tags.includes('page-text')
  })
  const codeEntries = filtered.filter((item) => {
    const tags = item.entry.tags || []
    return tags.includes('code') || tags.includes('page-script')
  })
  const shortlist = preferred.length
    ? [...preferred.slice(0, 8), ...codeEntries.filter((item) => !preferred.includes(item)).slice(0, 6)]
    : filtered

  const unique: typeof shortlist = []
  const seen = new Set<string>()
  for (const item of shortlist.slice(0, 14)) {
    const key = `${item.entry.source_path || ''}::${item.entry.title}::${item.entry.content.slice(0, 80)}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }

  if (!unique.length) return { context: '' }

  const contextOutput = [
    ...unique.map(({ entry }, index) => {
      const tags = entry.tags || []
      if (tags.includes('code') || tags.includes('page-script')) {
        const url = shouldExposeUrl(entry.url) ? ` (${entry.url})` : ''
        const sourcePath = entry.source_path ? ` [${entry.source_path}]` : ''
        return `Snippet ${index + 1}: ${entry.title}${url}${sourcePath}\n${entry.content}`
      }
      const tokenFocus = dedupedQueryTokens.length ? dedupedQueryTokens : combinedTokens
      const filteredLines = extractConcreteEvidenceLines(entry, tokenFocus)
      if (!filteredLines.length) return ''
      const url = shouldExposeUrl(entry.url) ? ` (${entry.url})` : ''
      const sourcePath = entry.source_path ? ` [${entry.source_path}]` : ''
      return `Snippet ${index + 1}: ${entry.title}${url}${sourcePath}\n${filteredLines.join('\n')}`
    }),
  ]
    .filter(Boolean)
    .join('\n\n')

  return { context: contextOutput }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }

  try {
    const { query, mode, messages, pageContext } = await req.json()
    const trimmed = (query || '').toString().trim()

    if (!trimmed) {
      return new Response(JSON.stringify({ error: 'Query is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }

    if (!ANTHROPIC_API_KEY) {
      throw new Error('Anthropic API key not configured')
    }

    const isManager = (mode || '').toString().toLowerCase() === 'manager'
    const preferredMode = isManager ? 'manager' : 'customer'
    const kbModes = inferKbModes(trimmed, preferredMode, pageContext)
    const { context: kbContext } = await fetchKnowledgeBase(trimmed, kbModes, pageContext, preferredMode)
    const basePrompt = isManager ? MANAGER_GUIDE : CUSTOMER_GUIDE
    const evidenceBlock = kbContext ? `Evidence snippets:\n${kbContext}` : 'Evidence snippets: (none)'
    const config = await fetchAllergenDietConfig()
    const canonicalAllergens = (config.allergens || []).map((allergen) => allergen.label || allergen.key)
    const canonicalDiets = config.supportedDiets || []
    const canonicalFacts = buildCanonicalFacts(canonicalAllergens, canonicalDiets)

    const systemPrompt = `${basePrompt}\n\n${canonicalFacts}\n\n${evidenceBlock}\n\nUse the Evidence snippets and code to answer. When evidence is thin, make a best-effort inference and note uncertainty. Do not respond with only "not enough evidence" if snippets are available.`

    const history = Array.isArray(messages) ? messages : []
    const sanitizedHistory = history
      .filter((msg) => msg && typeof msg.content === 'string')
      .map((msg) => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content.toString().trim()
      }))
      .filter((msg) => msg.content.length > 0)
      .slice(-12)

    const finalMessages = sanitizedHistory.length ? sanitizedHistory.slice() : []
    const last = finalMessages[finalMessages.length - 1]
    if (!last || last.role !== 'user' || last.content !== trimmed) {
      finalMessages.push({ role: 'user', content: trimmed })
    }

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 900,
        temperature: 0.2,
        system: systemPrompt,
        messages: finalMessages
      })
    })

    if (!claudeResponse.ok) {
      const error = await claudeResponse.text()
      throw new Error(`Claude API error (${claudeResponse.status}): ${error.substring(0, 200)}`)
    }

    const aiResult = await claudeResponse.json()
    const rawAnswer = aiResult?.content?.[0]?.text || ''
    const answer = sanitizeAnswer(rawAnswer, canonicalDiets)

    return new Response(JSON.stringify({ answer }), {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    })
  } catch (error) {
    console.error('Help assistant error:', error)
    return new Response(JSON.stringify({
      error: 'Help assistant failed',
      message: error.message || 'Unknown error'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    })
  }
})
