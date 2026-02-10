import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const ENV_FILES = ['.env.local', '.env'];
for (const filename of ENV_FILES) {
  const envPath = path.join(ROOT, filename);
  if (!fs.existsSync(envPath)) continue;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const cleanLine = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separatorIndex = cleanLine.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = cleanLine.slice(0, separatorIndex).trim();
    let value = cleanLine.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
const PUBLIC_DIR = path.join(ROOT, 'public');
const SOURCE_ROOTS = [
  { dir: path.join(ROOT, 'public', 'js'), modes: ['customer', 'manager'], label: 'frontend' },
  { dir: path.join(ROOT, 'supabase', 'functions'), modes: ['customer', 'manager'], label: 'backend' },
  { dir: path.join(ROOT, 'api'), modes: ['customer', 'manager'], label: 'api' },
  { dir: path.join(ROOT, 'docs'), modes: ['customer', 'manager'], label: 'docs' }
];
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.md']);
const MAX_FILE_BYTES = 1000000;
const CODE_CHUNK_CHARS = 3200;
const REFERENCE_DOCS = [
  { path: path.join(ROOT, 'PUBLIC_CODE_REFERENCE.md'), modes: ['customer', 'manager'], label: 'code-reference' }
];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const KB_USE_CLAUDE = !['false', '0', 'no'].includes((process.env.KB_USE_CLAUDE || '').toLowerCase());
const KB_CLAUDE_TIMEOUT_MS = Number(process.env.KB_CLAUDE_TIMEOUT_MS) || 20000;

const MAX_BODY_CHARS = 6000;
const MAX_ITEMS = 32;
const UI_EVIDENCE_MAX_LINES = 120;
const UI_EVIDENCE_MAX_CHARS = 3600;
const UI_EVIDENCE_KEYWORDS = [
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
];

const managerOnlyPages = new Set([
  'manager-dashboard.html',
  'admin-dashboard.html',
  'admin-invites.html',
  'admin-restaurant-view.html',
  'admin.html',
  'server-tablet.html',
  'kitchen-tablet.html',
  'qr-generator.html',
]);

const urlOverrides = new Map([
  ['index.html', '/'],
  ['restaurant.html', '/restaurant?slug=RESTAURANT_SLUG'],
  ['manager-dashboard.html', '/manager-dashboard'],
  ['admin-dashboard.html', '/admin-dashboard'],
  ['home.html', '/home'],
  ['restaurants.html', '/restaurants'],
  ['dish-search.html', '/dish-search'],
  ['favorites.html', '/favorites'],
  ['my-dishes.html', '/my-dishes'],
  ['account.html', '/account'],
  ['help-contact.html', '/help-contact']
]);

function cleanText(value) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripScriptsAndStyles(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
}

function extractInlineScripts(html) {
  const regex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const scripts = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const text = (match[1] || '').trim();
    if (text) scripts.push(text);
  }
  return scripts;
}

function collectFiles(dir, extensions, results = []) {
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      collectFiles(fullPath, extensions, results);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.has(ext)) {
        const stats = fs.statSync(fullPath);
        if (stats.size <= MAX_FILE_BYTES) {
          results.push(fullPath);
        } else {
          console.warn(`Skipping large file: ${fullPath}`);
        }
      }
    }
  }
  return results;
}

function extractTopComment(content) {
  const blockMatch = content.match(/^\s*\/\*\*?([\s\S]*?)\*\//);
  if (blockMatch) {
    return cleanText(blockMatch[1] || '');
  }
  const lineMatch = content.match(/^(?:\s*\/\/.*\n)+/);
  if (lineMatch) {
    return cleanText(lineMatch[0].replace(/\/\//g, ' '));
  }
  return '';
}

function extractMdTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? cleanText(match[1]) : '';
}

function extractExports(content) {
  const names = new Set();
  const regexes = [
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
    /export\s+const\s+([A-Za-z0-9_]+)/g,
    /export\s+class\s+([A-Za-z0-9_]+)/g,
    /export\s+default\s+function\s+([A-Za-z0-9_]+)/g,
    /exports\.([A-Za-z0-9_]+)\s*=/g
  ];
  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      names.add(match[1]);
      if (names.size >= 20) break;
    }
  }
  const moduleMatch = content.match(/module\.exports\s*=\s*\{([^}]+)\}/);
  if (moduleMatch) {
    moduleMatch[1]
      .split(',')
      .map(part => part.trim().split(/\s*:\s*/)[0])
      .filter(Boolean)
      .forEach(name => names.add(name));
  }
  return [...names];
}

function extractFunctionNames(content) {
  const names = new Set();
  const regexes = [
    /function\s+([A-Za-z0-9_]+)/g,
    /const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/g,
    /async\s+function\s+([A-Za-z0-9_]+)/g
  ];
  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      names.add(match[1]);
      if (names.size >= 20) break;
    }
  }
  return [...names];
}

function extractPathTags(relativePath) {
  return relativePath
    .split(/[\/._-]+/g)
    .map(tag => tag.trim())
    .filter(tag => tag.length > 2)
    .slice(0, 12);
}

function cleanCodeText(value) {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTemplatePlaceholders(text) {
  return text.replace(/\$\{[^}]+\}/g, ' ');
}

function looksLikeUiText(text) {
  if (!text) return false;
  if (text.length < 4 || text.length > 180) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (!/[a-zA-Z]{3,}/.test(text)) return false;
  if (/^[^a-zA-Z0-9]+$/.test(text)) return false;
  if (/[\{\}]/.test(text)) return false;
  return true;
}

function extractUiStrings(content) {
  const regex = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  const results = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    const raw = stripTemplatePlaceholders(match[2] || '');
    const cleaned = cleanText(raw);
    if (!looksLikeUiText(cleaned)) continue;
    results.push(cleaned);
    if (results.length >= UI_EVIDENCE_MAX_LINES) break;
  }
  return [...new Set(results)];
}

function extractBehaviorComments(content) {
  const results = [];
  const lineComments = content.match(/\/\/[^\n]*/g) || [];
  lineComments.forEach((line) => {
    const cleaned = cleanText(line.replace(/^\/\//, ''));
    if (!cleaned) return;
    if (!UI_EVIDENCE_KEYWORDS.some((kw) => cleaned.toLowerCase().includes(kw))) return;
    results.push(cleaned);
  });

  const blockRegex = /\/\*([\s\S]*?)\*\//g;
  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    const block = match[1] || '';
    block.split('\n').forEach((line) => {
      const cleaned = cleanText(line.replace(/^\s*\*+/, ''));
      if (!cleaned) return;
      if (!UI_EVIDENCE_KEYWORDS.some((kw) => cleaned.toLowerCase().includes(kw))) return;
      results.push(cleaned);
    });
  }

  return [...new Set(results)].slice(0, UI_EVIDENCE_MAX_LINES);
}

function chunkTextByLines(text, maxChars) {
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let current = [];
  let length = 0;

  for (const line of lines) {
    const lineLength = line.length + 1;
    if (length + lineLength > maxChars && current.length) {
      chunks.push(current.join('\n'));
      current = [];
      length = 0;
    }
    current.push(line);
    length += lineLength;
  }

  if (current.length) {
    chunks.push(current.join('\n'));
  }

  return chunks;
}

function extractTagText(html, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const values = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const text = cleanText(match[1] || '');
    if (text) values.push(text);
  }
  return [...new Set(values)].slice(0, MAX_ITEMS);
}

function extractAttributeValues(html, attr) {
  const regex = new RegExp(`${attr}=["']([^"']+)["']`, 'gi');
  const values = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const text = cleanText(match[1] || '');
    if (text) values.push(text);
  }
  return [...new Set(values)].slice(0, MAX_ITEMS);
}

function extractLinks(html) {
  const regex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const links = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = (match[1] || '').trim();
    const text = cleanText(match[2] || '');
    if (href && text) {
      links.push({ href, text });
    }
  }
  return links.slice(0, MAX_ITEMS);
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanText(match[1]) : '';
}

function inferModes(fileName) {
  if (managerOnlyPages.has(fileName)) return ['manager'];
  return ['customer', 'manager'];
}

function inferUrl(fileName) {
  return urlOverrides.get(fileName) || fileName;
}

function hashRecord(record) {
  const raw = `${record.mode}|${record.url}|${record.title}|${record.content}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function buildFallbackEntry(meta, mode) {
  const title = meta.title || meta.file;
  const buttonText = meta.buttons.length ? meta.buttons.join(', ') : 'No primary buttons detected';
  const inputText = meta.inputs.length ? meta.inputs.join(', ') : 'No primary inputs detected';
  const linkText = meta.links.length
    ? meta.links.map((link) => `${link.text} (${link.href})`).join('; ')
    : 'No primary links detected';
  const detailSnippet = meta.paragraphs?.length
    ? meta.paragraphs.slice(0, 3).join(' ').slice(0, 360)
    : '';
  const location = meta.location ? ` (${meta.location})` : '';
  const sourceLabel = meta.sourceType ? `${meta.sourceType} source.` : '';

  const content = [
    `Page: ${title}${location}.`,
    sourceLabel,
    `Mode: ${mode}.`,
    `Key actions: ${buttonText}.`,
    `Inputs or fields: ${inputText}.`,
    `Helpful links: ${linkText}.`,
    meta.headings.length ? `Sections: ${meta.headings.join(', ')}.` : '',
    detailSnippet ? `Highlights: ${detailSnippet}.` : ''
  ].filter(Boolean).join(' ');

  const tags = [...new Set([
    ...meta.headings,
    ...meta.buttons,
    ...meta.labels
  ])]
    .map(tag => tag.toLowerCase())
    .filter(tag => tag.length > 2)
    .slice(0, 10);

  return { title, content, tags };
}

function buildPageEvidence(meta) {
  const headings = meta.headings.slice(0, 24).join(' | ');
  const buttons = meta.buttons.slice(0, 24).join(' | ');
  const labels = meta.labels.slice(0, 24).join(' | ');
  const inputs = meta.inputs.slice(0, 24).join(' | ');
  const links = meta.links.length
    ? meta.links.slice(0, 16).map((link) => `${link.text} (${link.href})`).join(' | ')
    : '';
  const paragraphs = meta.paragraphs.slice(0, 6).join(' ');
  const listItems = meta.listItems.slice(0, 12).join(' | ');

  const lines = [
    `Page file: ${meta.file}`,
    meta.url ? `URL: ${meta.url}` : '',
    headings ? `Headings: ${headings}` : '',
    buttons ? `Buttons: ${buttons}` : '',
    labels ? `Labels: ${labels}` : '',
    inputs ? `Inputs: ${inputs}` : '',
    links ? `Links: ${links}` : '',
    paragraphs ? `Paragraphs: ${paragraphs}` : '',
    listItems ? `List items: ${listItems}` : ''
  ].filter(Boolean);

  return lines.join('\n');
}

async function buildEntryWithClaude(meta, mode) {
  if (!ANTHROPIC_API_KEY || !KB_USE_CLAUDE) return null;

  const systemPrompt = `You are building Clarivore's help knowledge base.\n` +
    `Create clear, accurate help content for the requested mode using only the provided page info.\n` +
    `Return JSON only with keys: title, content, tags.\n` +
    `Content should be concise (120-220 words), include bullet steps when describing flows, and mention relevant links as relative URLs.`;

  const userPrompt = `Mode: ${mode}\n\n` +
    `Page metadata (JSON):\n${JSON.stringify(meta, null, 2)}\n\n` +
    `Visible text snippet:\n${meta.bodySnippet}\n\n` +
    `Return JSON only. Example:\n{\n  "title": "...",\n  "content": "...",\n  "tags": ["tag1", "tag2"]\n}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), KB_CLAUDE_TIMEOUT_MS);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 900,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude error ${response.status}: ${errorText.substring(0, 200)}`);
  }

  const result = await response.json();
  const text = result?.content?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.warn('Failed to parse Claude JSON, using fallback.');
    return null;
  }
}

async function buildHtmlEntries() {
  const htmlFiles = fs.readdirSync(PUBLIC_DIR).filter((file) => file.endsWith('.html'));
  const entries = [];

  for (const file of htmlFiles) {
    const filePath = path.join(PUBLIC_DIR, file);
    const html = fs.readFileSync(filePath, 'utf8');
    const inlineScripts = extractInlineScripts(html);
    const stripped = stripScriptsAndStyles(html);

    const meta = {
      file,
      url: inferUrl(file),
      location: inferUrl(file),
      sourceType: 'page',
      title: extractTitle(html),
      headings: [
        ...extractTagText(stripped, 'h1'),
        ...extractTagText(stripped, 'h2'),
        ...extractTagText(stripped, 'h3')
      ].slice(0, MAX_ITEMS),
      paragraphs: extractTagText(stripped, 'p'),
      listItems: extractTagText(stripped, 'li'),
      buttons: extractTagText(stripped, 'button'),
      labels: extractTagText(stripped, 'label'),
      inputs: [
        ...extractAttributeValues(stripped, 'placeholder'),
        ...extractAttributeValues(stripped, 'aria-label'),
        ...extractAttributeValues(stripped, 'title')
      ].slice(0, MAX_ITEMS),
      links: extractLinks(stripped),
      pathTags: extractPathTags(file),
      bodySnippet: cleanText([
        ...extractTagText(stripped, 'h1'),
        ...extractTagText(stripped, 'h2'),
        ...extractTagText(stripped, 'h3'),
        ...extractTagText(stripped, 'p'),
        ...extractTagText(stripped, 'li')
      ].join(' ')).slice(0, MAX_BODY_CHARS)
    };

    const modes = inferModes(file);

    for (const mode of modes) {
      let entry = null;
      try {
        entry = await buildEntryWithClaude(meta, mode);
      } catch (error) {
        console.warn(`Claude build failed for ${file} (${mode}): ${error.message}`);
      }

      if (!entry) {
        entry = buildFallbackEntry(meta, mode);
      }

      const content = (entry.content || '').trim();
      if (!content) continue;

      const summaryTags = Array.isArray(entry.tags)
        ? [...entry.tags, ...meta.pathTags, meta.sourceType, 'summary', 'page-summary']
        : [...meta.pathTags, meta.sourceType, 'summary', 'page-summary'];

      const record = {
        mode,
        title: (entry.title || meta.title || meta.file).trim(),
        content: content.length > 4000 ? content.slice(0, 4000) : content,
        url: meta.url,
        tags: summaryTags
          .map(tag => `${tag}`.trim())
          .filter(Boolean)
          .slice(0, 16),
        source_path: file,
        hash: ''
      };

      record.hash = hashRecord(record);
      entries.push(record);

      const evidenceContent = buildPageEvidence(meta).trim();
      if (evidenceContent) {
        const evidenceRecord = {
          mode,
          title: `Page evidence ${meta.title || meta.file}`,
          content: evidenceContent.length > 4000 ? evidenceContent.slice(0, 4000) : evidenceContent,
          url: meta.url,
          tags: [...meta.pathTags, meta.sourceType, 'evidence', 'page-text', 'source']
            .map(tag => `${tag}`.trim())
            .filter(Boolean)
            .slice(0, 16),
          source_path: file,
          hash: ''
        };

        evidenceRecord.hash = hashRecord(evidenceRecord);
        entries.push(evidenceRecord);
      }

      if (inlineScripts.length) {
        const scriptText = inlineScripts.join('\n\n');
        const scriptChunks = chunkTextByLines(scriptText, CODE_CHUNK_CHARS);
        const totalChunks = scriptChunks.length || 1;

        for (let index = 0; index < scriptChunks.length; index += 1) {
          const chunk = scriptChunks[index].trim();
          if (!chunk) continue;
          const chunkContent = [
            `Inline script source: ${file}`,
            `Chunk ${index + 1} of ${totalChunks}`,
            '',
            chunk
          ].join('\n').trim();

          const chunkRecord = {
            mode,
            title: `Inline script ${file} (Part ${index + 1}/${totalChunks})`,
            content: chunkContent.length > 4000 ? chunkContent.slice(0, 4000) : chunkContent,
            url: null,
            tags: [...meta.pathTags, 'page-script', 'code', 'source', 'evidence']
              .map(tag => `${tag}`.trim())
              .filter(Boolean)
              .slice(0, 16),
            source_path: file,
            hash: ''
          };

          chunkRecord.hash = hashRecord(chunkRecord);
          entries.push(chunkRecord);
        }
      }
    }
  }

  return entries;
}

async function buildSourceEntries() {
  const entries = [];

  for (const source of SOURCE_ROOTS) {
    const files = collectFiles(source.dir, TEXT_EXTENSIONS);
    for (const filePath of files) {
      const relativePath = path.relative(ROOT, filePath);
      if (relativePath === 'supabase/functions/help-assistant/index.ts') {
        continue;
      }
      const ext = path.extname(filePath).toLowerCase();
      const contentRaw = fs.readFileSync(filePath, 'utf8');
      const topComment = extractTopComment(contentRaw);
      const exportsList = extractExports(contentRaw);
      const functionList = extractFunctionNames(contentRaw);
      const codeChunks = chunkTextByLines(contentRaw, CODE_CHUNK_CHARS);
      const uiStrings = extractUiStrings(contentRaw);
      const behaviorNotes = extractBehaviorComments(contentRaw);

      const title = (ext === '.md' ? extractMdTitle(contentRaw) : topComment.split('\n')[0]) ||
        path.basename(filePath);

      const snippetParts = [];
      if (topComment) snippetParts.push(topComment);
      if (exportsList.length) snippetParts.push(`Exports: ${exportsList.join(', ')}`);
      if (functionList.length) snippetParts.push(`Functions: ${functionList.join(', ')}`);
      const rawSnippet = cleanCodeText(contentRaw.slice(0, MAX_BODY_CHARS));
      if (rawSnippet) snippetParts.push(rawSnippet);

      const meta = {
        file: relativePath,
        url: null,
        location: relativePath,
        sourceType: source.label,
        title: title,
        headings: [],
        paragraphs: [],
        listItems: [],
        buttons: [],
        labels: [],
        inputs: [],
        links: [],
        pathTags: extractPathTags(relativePath),
        bodySnippet: cleanText(snippetParts.join(' ')).slice(0, MAX_BODY_CHARS)
      };

      for (const mode of source.modes) {
        let entry = null;
        try {
          entry = await buildEntryWithClaude(meta, mode);
        } catch (error) {
          console.warn(`Claude build failed for ${relativePath} (${mode}): ${error.message}`);
        }

        if (!entry) {
          entry = buildFallbackEntry(meta, mode);
        }

        const content = (entry.content || '').trim();
        if (!content) continue;

        const summaryTags = Array.isArray(entry.tags)
          ? [...entry.tags, ...meta.pathTags, meta.sourceType, 'summary', 'source-summary']
          : [...meta.pathTags, meta.sourceType, 'summary', 'source-summary'];

        const record = {
          mode,
          title: (entry.title || meta.title || meta.file).trim(),
          content: content.length > 4000 ? content.slice(0, 4000) : content,
          url: meta.url,
          tags: summaryTags
            .map(tag => `${tag}`.trim())
            .filter(Boolean)
            .slice(0, 16),
          source_path: relativePath,
          hash: ''
        };

        record.hash = hashRecord(record);
        entries.push(record);

        const totalChunks = codeChunks.length || 1;
        for (let index = 0; index < codeChunks.length; index += 1) {
          const chunk = codeChunks[index].trim();
          if (!chunk) continue;
          const chunkContent = [
            `Source file: ${relativePath}`,
            `Chunk ${index + 1} of ${totalChunks}`,
            '',
            chunk
          ].join('\n').trim();

          const chunkRecord = {
            mode,
            title: `Source ${relativePath} (Part ${index + 1}/${totalChunks})`,
            content: chunkContent.length > 4000 ? chunkContent.slice(0, 4000) : chunkContent,
            url: null,
            tags: [...meta.pathTags, meta.sourceType, 'code', 'source', 'evidence']
              .map(tag => `${tag}`.trim())
              .filter(Boolean)
              .slice(0, 16),
            source_path: relativePath,
            hash: ''
          };

          chunkRecord.hash = hashRecord(chunkRecord);
          entries.push(chunkRecord);
        }

        if (uiStrings.length || behaviorNotes.length) {
          const uiLines = [
            `Source file: ${relativePath}`,
            uiStrings.length ? 'UI strings:' : '',
            ...uiStrings.map((text) => `UI: ${text}`),
            behaviorNotes.length ? 'Behavior notes:' : '',
            ...behaviorNotes.map((text) => `Behavior: ${text}`)
          ]
            .filter(Boolean);

          const uiChunks = chunkTextByLines(uiLines.join('\n'), UI_EVIDENCE_MAX_CHARS);
          const uiTotal = uiChunks.length || 1;

          for (let index = 0; index < uiChunks.length; index += 1) {
            const chunk = uiChunks[index].trim();
            if (!chunk) continue;
            const uiRecord = {
              mode,
              title: `UI evidence ${relativePath} (Part ${index + 1}/${uiTotal})`,
              content: chunk.length > 4000 ? chunk.slice(0, 4000) : chunk,
              url: null,
              tags: [...meta.pathTags, meta.sourceType, 'ui-evidence', 'evidence', 'source']
                .map(tag => `${tag}`.trim())
                .filter(Boolean)
                .slice(0, 16),
              source_path: relativePath,
              hash: ''
            };

            uiRecord.hash = hashRecord(uiRecord);
            entries.push(uiRecord);
          }
        }
      }
    }
  }

  return entries;
}

function buildReferenceEntries() {
  const entries = [];

  for (const doc of REFERENCE_DOCS) {
    if (!fs.existsSync(doc.path)) continue;
    const contentRaw = fs.readFileSync(doc.path, 'utf8');
    const chunks = chunkTextByLines(contentRaw, CODE_CHUNK_CHARS);
    const totalChunks = chunks.length || 1;
    const sourcePath = path.basename(doc.path);

    for (const mode of doc.modes) {
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index].trim();
        if (!chunk) continue;
        const chunkContent = [
          `Reference file: ${sourcePath}`,
          `Chunk ${index + 1} of ${totalChunks}`,
          '',
          chunk
        ].join('\n').trim();

        const record = {
          mode,
          title: `Public code reference (Part ${index + 1}/${totalChunks})`,
          content: chunkContent.length > 4000 ? chunkContent.slice(0, 4000) : chunkContent,
          url: null,
          tags: ['code-reference', 'reference', 'evidence', 'source'],
          source_path: sourcePath,
          hash: ''
        };

        record.hash = hashRecord(record);
        entries.push(record);
      }
    }
  }

  return entries;
}

async function buildKbEntries() {
  const entries = [];
  entries.push(...await buildHtmlEntries());
  entries.push(...await buildSourceEntries());
  entries.push(...buildReferenceEntries());
  return entries;
}

async function clearKnowledgeBase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Skipping KB cleanup.');
    return;
  }

  const modes = ['customer', 'manager'];
  for (const mode of modes) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/help_kb?mode=eq.${mode}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=minimal'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase KB cleanup failed (${response.status}): ${errorText.substring(0, 200)}`);
    }
  }
}

async function pushToSupabase(records) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Skipping KB upload.');
    return { uploaded: 0, skipped: records.length };
  }

  const batchSize = 25;
  let uploaded = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/help_kb?on_conflict=hash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(batch)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase upload failed (${response.status}): ${errorText.substring(0, 200)}`);
    }

    uploaded += batch.length;
  }

  return { uploaded, skipped: 0 };
}

async function run() {
  console.log('Building help knowledge base...');
  const records = await buildKbEntries();
  console.log(`Prepared ${records.length} KB entries.`);

  if (!ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not set. Using fallback summaries.');
  } else if (!KB_USE_CLAUDE) {
    console.warn('KB_USE_CLAUDE disabled. Using fallback summaries.');
  }

  await clearKnowledgeBase();
  const result = await pushToSupabase(records);
  console.log(`KB upload complete. Uploaded: ${result.uploaded}, Skipped: ${result.skipped}.`);
}

run().catch((error) => {
  console.error('KB build failed:', error);
  process.exitCode = 1;
});
