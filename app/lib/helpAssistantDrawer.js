import { getSupabaseClient as getRuntimeSupabaseClient } from './restaurantRuntime/runtimeSessionState.js';

const HELP_ASSISTANT_MODE_KEY = 'helpAssistantMode';
const HELP_ASSISTANT_CONVO_PREFIX = 'helpAssistantConversation';
const HELP_ASSISTANT_OPEN_KEY = 'helpAssistantDrawerOpen';
const HELP_ASSISTANT_HEIGHT_KEY = 'helpAssistantDrawerHeight';
const HELP_ASSISTANT_PENDING_KEY = 'helpAssistantPendingAction';
const HELP_ASSISTANT_RESTAURANT_KEY = 'helpAssistantRestaurantSlug';

const MAX_HISTORY = 16;
const DEFAULT_DRAWER_HEIGHT = 260;

function getModeKey(mode) {
  return `${HELP_ASSISTANT_CONVO_PREFIX}:${mode}`;
}

export function setHelpAssistantMode(mode) {
  if (!mode) return;
  localStorage.setItem(HELP_ASSISTANT_MODE_KEY, mode);
}

export function getHelpAssistantMode() {
  const stored = localStorage.getItem(HELP_ASSISTANT_MODE_KEY);
  if (stored === 'manager' || stored === 'customer') return stored;
  const fallback = localStorage.getItem('clarivoreManagerMode');
  return fallback === 'editor' ? 'manager' : 'customer';
}

export function loadConversation(mode) {
  const key = getModeKey(mode);
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(msg => msg && msg.role && msg.content);
  } catch (_) {
    return [];
  }
}

export function saveConversation(mode, messages) {
  const key = getModeKey(mode);
  const trimmed = (messages || []).slice(-MAX_HISTORY);
  localStorage.setItem(key, JSON.stringify(trimmed));
}

export function clearConversation(mode) {
  localStorage.removeItem(getModeKey(mode));
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function autoGrowInput(textArea) {
  if (!textArea) return;
  textArea.style.height = '0px';
  textArea.style.height = `${textArea.scrollHeight}px`;
}

function normalizePageText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function uniqueLimited(values, limit) {
  const deduped = [];
  const seen = new Set();
  for (const value of values) {
    const text = normalizePageText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    deduped.push(text);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

function collectPageContext() {
  const headings = uniqueLimited(
    Array.from(document.querySelectorAll('h1, h2, h3')).map((el) => el.textContent || ''),
    12
  );
  const buttons = uniqueLimited(
    Array.from(document.querySelectorAll('button')).map((el) => el.textContent || ''),
    12
  );
  const labels = uniqueLimited(
    Array.from(document.querySelectorAll('label')).map((el) => el.textContent || ''),
    12
  );
  const inputs = uniqueLimited(
    Array.from(document.querySelectorAll('input, textarea, select'))
      .map((el) => el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '')
      .filter(Boolean),
    12
  );

  return {
    url: window.location.href,
    path: `${window.location.pathname}${window.location.search}`,
    title: document.title || '',
    headings,
    buttons,
    labels,
    inputs
  };
}

function extractHeadingLine(line, nextLine) {
  const trimmed = (line || '').trim();
  if (!trimmed) return null;

  const boldMatch = trimmed.match(/^\*\*([^*]+?)\*\*:?\s*$/);
  if (boldMatch) {
    const suffix = trimmed.endsWith(':') ? ':' : '';
    return `${boldMatch[1].trim()}${suffix}`;
  }

  const hashMatch = trimmed.match(/^#{2,6}\s+(.+?)\s*$/);
  if (hashMatch) {
    return hashMatch[1].trim();
  }

  const isListItem = /^\s*(?:[-*]|\d+\.)\s+/.test(trimmed);
  if (!isListItem && trimmed.endsWith(':')) {
    const isShort = trimmed.length <= 90;
    const nextTrimmed = (nextLine || '').trim();
    const nextIsList = /^\s*(?:[-*]|\d+\.)\s+/.test(nextTrimmed);
    if (isShort && (nextIsList || !nextTrimmed)) {
      return trimmed;
    }
  }

  return null;
}

export function formatAssistantAnswer(answerText) {
  const escaped = escapeHtml(answerText || '');
  const lines = escaped.split(/\n/);
  const linkify = (value) => value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
      const safeUrl = url.trim();
      const normalizedUrl = safeUrl.startsWith('clarivore://')
        ? safeUrl.replace(/&amp;/g, '&')
        : safeUrl;
      if (normalizedUrl.startsWith('clarivore://')) {
        const label = encodeURIComponent(text);
        return `<a href="#" class="help-action-link" data-help-link="${encodeURIComponent(normalizedUrl)}" data-help-link-label="${label}">${text}</a>`;
      }
      return `<a href="${normalizedUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    })
    .replace(/(^|[^\w"'=/>])(clarivore:\/\/[^\s<]+)/g, (_match, prefix, url) => {
      const normalizedUrl = url.replace(/&amp;/g, '&');
      const label = encodeURIComponent(url);
      return `${prefix}<a href="#" class="help-action-link" data-help-link="${encodeURIComponent(normalizedUrl)}" data-help-link-label="${label}">${url}</a>`;
    })
    .replace(/(^|[^\w"'=/>])(https?:\/\/[^\s<]+)/g, (_match, prefix, url) => {
      return `${prefix}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });

  const renderedLines = [];
  let inCodeBlock = false;
  let codeBuffer = [];

  const flushCodeBlock = () => {
    const codeText = codeBuffer.join('\n');
    renderedLines.push(`<pre class="help-code"><code>${codeText}</code></pre>`);
    codeBuffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    const headingText = extractHeadingLine(line, lines[index + 1]);
    if (headingText) {
      renderedLines.push(`<div class="help-heading">${linkify(headingText)}</div>`);
      continue;
    }
    if (!line.trim()) {
      renderedLines.push('<div class="help-line spacer"></div>');
      continue;
    }
    renderedLines.push(`<div class="help-line">${linkify(line)}</div>`);
  }

  if (inCodeBlock) {
    flushCodeBlock();
  }

  return renderedLines.join('');
}

function normalizeText(value) {
  return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isElementVisible(el) {
  if (!(el instanceof HTMLElement)) return true;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  if (el.offsetParent === null && style.position !== 'fixed') return false;
  return true;
}

function findTargetByLabel(label) {
  const targetLabel = normalizeText(label);
  if (!targetLabel) return null;

  const selectors = [
    'button',
    'a',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '[role="tab"]',
    '[role="option"]',
    'label',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6'
  ];
  const nodes = Array.from(document.querySelectorAll(selectors.join(',')));

  const matches = nodes.map((el) => {
    const text = normalizeText(el.textContent || '');
    const placeholder = normalizeText(el.placeholder || '');
    const aria = normalizeText(el.getAttribute?.('aria-label') || '');
    const title = normalizeText(el.getAttribute?.('title') || '');
    const value = normalizeText(el.value || '');
    return {
      el,
      visible: isElementVisible(el),
      values: [text, placeholder, aria, title, value]
    };
  });

  const exactVisible = matches.find((match) => match.visible && match.values.some((val) => val === targetLabel));
  if (exactVisible) return exactVisible.el;

  const exactHidden = matches.find((match) => match.values.some((val) => val === targetLabel));
  if (exactHidden) return exactHidden.el;

  const partialVisible = matches.find((match) => match.visible && match.values.some((val) => val.includes(targetLabel)));
  if (partialVisible) return partialVisible.el;

  const partialHidden = matches.find((match) => match.values.some((val) => val.includes(targetLabel)));
  return partialHidden ? partialHidden.el : null;
}

function highlightElement(target) {
  if (!target) return false;
  target.classList.add('help-target-highlight');
  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  setTimeout(() => target.classList.remove('help-target-highlight'), 2800);
  return true;
}

function parseHelpLink(url) {
  if (!url || !url.startsWith('clarivore://')) return null;
  try {
    const parsed = new URL(url);
    const type = parsed.hostname;
    const label = parsed.searchParams.get('label') || '';
    const selector = parsed.searchParams.get('selector') || '';
    const role = parsed.searchParams.get('role') || '';
    const reserved = new Set(['label', 'selector', 'role', 'url']);
    const extraParams = [];
    parsed.searchParams.forEach((value, key) => {
      if (!reserved.has(key)) extraParams.push([key, value]);
    });
    const rawUrl = parsed.searchParams.get('url');
    let urlValue = '';
    if (rawUrl) {
      urlValue = rawUrl;
      if (extraParams.length) {
        const tail = new URLSearchParams(extraParams).toString();
        urlValue += rawUrl.includes('?') ? `&${tail}` : `?${tail}`;
      }
    } else {
      const base = parsed.pathname.replace(/^\/+/, '');
      const tail = extraParams.length ? `?${new URLSearchParams(extraParams).toString()}` : '';
      urlValue = `${base}${tail}`;
    }
    return { type, label, selector, role, url: urlValue };
  } catch (_) {
    return null;
  }
}

function resolveRestaurantSlug() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug');
  if (slug) return slug;

  const stored = localStorage.getItem(HELP_ASSISTANT_RESTAURANT_KEY);
  if (stored) return stored;

  try {
    const recent = JSON.parse(localStorage.getItem('recentlyViewedRestaurants') || '[]');
    if (Array.isArray(recent) && recent.length) return recent[0];
  } catch (_) {
    // ignore
  }

  return null;
}

function resolveRestaurantUrl(url) {
  if (!url) return url;
  if (!url.includes('RESTAURANT_SLUG')) return url;
  const slug = resolveRestaurantSlug();
  if (!slug) return url;
  return url.replace(/RESTAURANT_SLUG/g, encodeURIComponent(slug));
}

function ensureRestaurantMenuUrl(url) {
  if (!url) return url;
  let parsed;
  try {
    parsed = new URL(url, window.location.origin);
  } catch (_) {
    return url;
  }
  const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
  const isRestaurantPath = normalizedPath === '/restaurant';
  if (!isRestaurantPath) {
    return `${parsed.pathname}${parsed.search}`;
  }
  const slugParam = parsed.searchParams.get('slug');
  const idParam = parsed.searchParams.get('id');
  if ((slugParam && slugParam.trim()) || (idParam && idParam.trim())) {
    const nextParams = parsed.searchParams.toString();
    return nextParams ? `/restaurant?${nextParams}` : '/restaurant';
  }
  const slug = resolveRestaurantSlug();
  if (slug) {
    parsed.searchParams.set('slug', slug);
    const nextParams = parsed.searchParams.toString();
    return nextParams ? `/restaurant?${nextParams}` : '/restaurant';
  }
  return '/restaurants';
}

function resolveDashboardUrl(url, label) {
  if (!url) return url;
  const mode = localStorage.getItem(HELP_ASSISTANT_MODE_KEY) || '';
  if (mode !== 'manager') return url;
  const normalizedLabel = normalizeText(label || '');
  if (!normalizedLabel.includes('dashboard')) return url;

  try {
    const parsed = new URL(url, window.location.origin);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
    const isHomeRoute = normalizedPath === '/home';
    if (isHomeRoute) {
      parsed.pathname = '/manager-dashboard';
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch (_) {
    return url;
  }

  return url;
}

function normalizePageUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url, window.location.origin);
    const path = parsed.pathname.replace(/^\/+/, '');
    return `${path}${parsed.search}`;
  } catch (_) {
    return url.replace(/^\/+/, '');
  }
}

function isSamePageUrl(url) {
  if (!url) return false;
  const target = normalizePageUrl(url);
  const current = normalizePageUrl(`${window.location.pathname}${window.location.search}`);
  if (!target) return false;
  if (target === current) return true;
  if (!target.includes('?') && current.startsWith(`${target}?`)) return true;
  return false;
}

function persistPendingAction(action) {
  if (!action) return;
  localStorage.setItem(HELP_ASSISTANT_PENDING_KEY, JSON.stringify(action));
}

function clearPendingAction() {
  localStorage.removeItem(HELP_ASSISTANT_PENDING_KEY);
}

function applyPendingAction(retries = 8) {
  const raw = localStorage.getItem(HELP_ASSISTANT_PENDING_KEY);
  if (!raw) return;
  let action = null;
  try {
    action = JSON.parse(raw);
  } catch (_) {
    clearPendingAction();
    return;
  }
  if (!action || action.type !== 'focus') {
    clearPendingAction();
    return;
  }
  let target = null;
  if (action.selector) {
    try {
      target = document.querySelector(action.selector);
    } catch (_) {
      target = null;
    }
  }
  if (!target) {
    target = findTargetByLabel(action.label || '');
  }
  if (target) {
    highlightElement(target);
    clearPendingAction();
    return;
  }

  if (retries > 0) {
    setTimeout(() => applyPendingAction(retries - 1), 600);
  }
}

export function handleHelpLink(url) {
  return handleHelpLinkWithLabel(url, '');
}

export function handleHelpLinkWithLabel(url, label) {
  const action = parseHelpLink(url);
  if (!action) return;

  const effectiveLabel = action.label || label || '';
  localStorage.setItem(HELP_ASSISTANT_OPEN_KEY, '1');
  openHelpAssistantDrawer();

  if (action.type === 'page') {
    if (action.url) {
      const nextUrl = ensureRestaurantMenuUrl(resolveDashboardUrl(resolveRestaurantUrl(action.url), effectiveLabel));
      window.location.href = nextUrl;
    }
    return;
  }

  if (action.type === 'focus') {
    if (action.url) {
      const nextUrl = ensureRestaurantMenuUrl(resolveDashboardUrl(resolveRestaurantUrl(action.url), effectiveLabel));
      if (isSamePageUrl(nextUrl)) {
        let target = null;
        if (action.selector) {
          try {
            target = document.querySelector(action.selector);
          } catch (_) {
            target = null;
          }
        }
        if (!target) {
          target = findTargetByLabel(effectiveLabel);
        }
        highlightElement(target);
        return;
      }
      persistPendingAction({ ...action, label: effectiveLabel, url: nextUrl });
      window.location.href = nextUrl;
      return;
    }
    let target = null;
    if (action.selector) {
      try {
        target = document.querySelector(action.selector);
      } catch (_) {
        target = null;
      }
    }
    if (!target) {
      target = findTargetByLabel(effectiveLabel);
    }
    highlightElement(target);
  }
}

export function attachHelpLinkHandlers(container) {
  if (!container || container.__helpLinksBound) return;
  container.__helpLinksBound = true;
  container.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const link = target?.closest?.('.help-action-link');
    if (!link) return;
    event.preventDefault();
    const encoded = link.getAttribute('data-help-link') || '';
    const decoded = decodeURIComponent(encoded);
    const encodedLabel = link.getAttribute('data-help-link-label') || '';
    const label = encodedLabel ? decodeURIComponent(encodedLabel) : '';
    handleHelpLinkWithLabel(decoded, label);
  });
}

export async function requestHelpAssistant({ query, mode, messages }) {
  const payload = { query, mode, messages, pageContext: collectPageContext() };
  let data = null;
  const client = getRuntimeSupabaseClient() || window.supabaseClient || null;
  if (client?.functions?.invoke) {
    try {
      const invokeRes = await client.functions.invoke('help-assistant', { body: payload });
      if (!invokeRes.error) {
        data = invokeRes.data;
      }
    } catch (_) {
      // ignore and try proxy fallback
    }
  }

  if (!data) {
    try {
      const res = await fetch('/api/ai-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ functionName: 'help-assistant', payload })
      });
      if (res.ok) {
        data = await res.json();
      }
    } catch (err) {
      console.error('Help assistant proxy failed:', err);
    }
  }

  return data;
}

function renderConversation(container, messages) {
  if (!container) return;
  if (!messages.length) {
    container.innerHTML = '<div class="help-message empty">Ask Clarivore a question to get started.</div>';
    return;
  }
  container.innerHTML = messages.map((msg) => {
    const content = msg.role === 'assistant'
      ? formatAssistantAnswer(msg.content)
      : escapeHtml(msg.content);
    return `
      <div class="help-message ${msg.role === 'assistant' ? 'assistant' : 'user'}">
        ${content}
      </div>
    `;
  }).join('');
}

function buildMessageList(mode, messages, query) {
  const history = Array.isArray(messages) ? messages.slice() : [];
  if (query) {
    history.push({ role: 'user', content: query, timestamp: new Date().toISOString() });
  }
  return history.slice(-MAX_HISTORY);
}

export function initHelpAssistantPanel({ mode, input, sendBtn, newBtn, statusEl, conversationEl }) {
  if (!input || !sendBtn || !conversationEl) return;
  const currentMode = mode || getHelpAssistantMode();
  let messages = loadConversation(currentMode);
  renderConversation(conversationEl, messages);
  attachHelpLinkHandlers(conversationEl);

  autoGrowInput(input);
  input.addEventListener('input', () => autoGrowInput(input));

  if (newBtn) {
    newBtn.addEventListener('click', () => {
      messages = [];
      clearConversation(currentMode);
      renderConversation(conversationEl, messages);
      if (statusEl) statusEl.textContent = '';
    });
  }

  const send = async () => {
    const query = (input.value || '').trim();
    if (!query) {
      if (statusEl) {
        statusEl.textContent = 'Type a question to get help.';
        statusEl.style.color = '#ef4444';
      }
      input.focus();
      return;
    }
    if (statusEl) {
      statusEl.textContent = 'Asking Clarivore assistant...';
      statusEl.style.color = 'var(--muted)';
    }
    sendBtn.disabled = true;
    input.disabled = true;

    messages = buildMessageList(currentMode, messages, query);
    renderConversation(conversationEl, messages);
    attachHelpLinkHandlers(conversationEl);
    saveConversation(currentMode, messages);

    const result = await requestHelpAssistant({ query, mode: currentMode, messages });
    const answer = (result && (result.answer || result.response)) || '';

    if (answer) {
      messages = buildMessageList(currentMode, messages, null);
      messages.push({ role: 'assistant', content: answer, timestamp: new Date().toISOString() });
      saveConversation(currentMode, messages);
      renderConversation(conversationEl, messages);
      attachHelpLinkHandlers(conversationEl);
      if (statusEl) statusEl.textContent = '';
    } else if (statusEl) {
      statusEl.textContent = 'Help assistant is unavailable right now.';
      statusEl.style.color = '#ef4444';
    }

    sendBtn.disabled = false;
    input.disabled = false;
    input.value = '';
    input.focus();
  };

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
}

export function initHelpAssistantDrawer() {
  if (document.getElementById('helpAssistantDrawer')) {
    const existingDrawer = document.getElementById('helpAssistantDrawer');
    const reopenBtn = document.getElementById('helpAssistantReopen');
    if (existingDrawer && reopenBtn) {
      reopenBtn.style.display = existingDrawer.classList.contains('open') ? 'none' : 'inline-flex';
    }
    applyPendingAction();
    return;
  }

  const drawer = document.createElement('div');
  drawer.id = 'helpAssistantDrawer';
  drawer.className = 'help-assistant-drawer';
  drawer.innerHTML = `
    <div class="help-assistant-handle" id="helpAssistantHandle"></div>
    <div class="help-assistant-header">
      <div>
        <strong>Clarivore assistant</strong>
        <span class="help-assistant-subtitle">Continue the conversation</span>
      </div>
      <div class="help-assistant-actions">
        <button class="btn btnGhost" id="helpAssistantNew">New</button>
        <button class="btn btnGhost" id="helpAssistantClose">Close</button>
      </div>
    </div>
    <div class="help-assistant-conversation" id="helpAssistantConversation"></div>
    <div class="help-assistant-input-row">
      <textarea id="helpAssistantInput" rows="1" placeholder="Ask Clarivore..."></textarea>
      <button class="btn btnPrimary" id="helpAssistantSend">Send</button>
    </div>
    <div class="help-assistant-status" id="helpAssistantStatus"></div>
  `;
  document.body.appendChild(drawer);

  const reopenBtn = document.createElement('button');
  reopenBtn.id = 'helpAssistantReopen';
  reopenBtn.type = 'button';
  reopenBtn.className = 'help-assistant-reopen btn btnPrimary';
  reopenBtn.textContent = 'Help';
  document.body.appendChild(reopenBtn);

  const open = localStorage.getItem(HELP_ASSISTANT_OPEN_KEY) === '1';
  const heightValue = Number(localStorage.getItem(HELP_ASSISTANT_HEIGHT_KEY)) || DEFAULT_DRAWER_HEIGHT;
  drawer.style.height = `${Math.min(Math.max(heightValue, 200), window.innerHeight * 0.75)}px`;
  drawer.classList.toggle('open', open);
  reopenBtn.style.display = open ? 'none' : 'inline-flex';

  const mode = getHelpAssistantMode();
  const conversationEl = drawer.querySelector('#helpAssistantConversation');
  const input = drawer.querySelector('#helpAssistantInput');
  const sendBtn = drawer.querySelector('#helpAssistantSend');
  const newBtn = drawer.querySelector('#helpAssistantNew');
  const statusEl = drawer.querySelector('#helpAssistantStatus');
  const closeBtn = drawer.querySelector('#helpAssistantClose');

  initHelpAssistantPanel({
    mode,
    input,
    sendBtn,
    newBtn,
    statusEl,
    conversationEl
  });

  closeBtn.addEventListener('click', () => {
    drawer.classList.remove('open');
    localStorage.removeItem(HELP_ASSISTANT_OPEN_KEY);
    reopenBtn.style.display = 'inline-flex';
  });

  const handle = drawer.querySelector('#helpAssistantHandle');
  let startY = 0;
  let startHeight = 0;
  const onPointerMove = (event) => {
    const delta = startY - event.clientY;
    const nextHeight = Math.min(Math.max(startHeight + delta, 200), window.innerHeight * 0.85);
    drawer.style.height = `${nextHeight}px`;
  };
  const onPointerUp = () => {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    const finalHeight = parseFloat(drawer.style.height) || DEFAULT_DRAWER_HEIGHT;
    localStorage.setItem(HELP_ASSISTANT_HEIGHT_KEY, String(Math.round(finalHeight)));
  };
  handle.addEventListener('pointerdown', (event) => {
    startY = event.clientY;
    startHeight = drawer.getBoundingClientRect().height;
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  });

  reopenBtn.addEventListener('click', () => {
    openHelpAssistantDrawer();
  });

  applyPendingAction();
}

export function openHelpAssistantDrawer() {
  localStorage.setItem(HELP_ASSISTANT_OPEN_KEY, '1');
  const drawer = document.getElementById('helpAssistantDrawer');
  const reopenBtn = document.getElementById('helpAssistantReopen');
  if (drawer) {
    drawer.classList.add('open');
  }
  if (reopenBtn) {
    reopenBtn.style.display = 'none';
  }
}
