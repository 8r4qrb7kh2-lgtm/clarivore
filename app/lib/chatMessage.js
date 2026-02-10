export function parseChatMessageTokens(rawMessage) {
  const raw = String(rawMessage || "");
  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const urlRegex = /((?:https?:|capacitor):\/\/[^\s<]+)/g;

  const tokens = [];
  let lastIndex = 0;
  let markdownMatch;

  const pushTextWithUrls = (text) => {
    if (!text) return;

    let cursor = 0;
    let urlMatch;
    while ((urlMatch = urlRegex.exec(text)) !== null) {
      if (urlMatch.index > cursor) {
        tokens.push({ type: "text", value: text.slice(cursor, urlMatch.index) });
      }

      tokens.push({ type: "link", href: urlMatch[1], label: urlMatch[1] });
      cursor = urlMatch.index + urlMatch[1].length;
    }

    if (cursor < text.length) {
      tokens.push({ type: "text", value: text.slice(cursor) });
    }

    urlRegex.lastIndex = 0;
  };

  while ((markdownMatch = markdownLinkRegex.exec(raw)) !== null) {
    const before = raw.slice(lastIndex, markdownMatch.index);
    pushTextWithUrls(before);

    tokens.push({
      type: "link",
      href: markdownMatch[2],
      label: markdownMatch[1],
    });

    lastIndex = markdownMatch.index + markdownMatch[0].length;
  }

  pushTextWithUrls(raw.slice(lastIndex));

  if (!tokens.length) {
    return [{ type: "text", value: raw }];
  }

  return tokens;
}

export function resolveChatLink(url, { internalHostSuffixes = [] } = {}) {
  if (!url) {
    return { href: "", external: true };
  }

  if (typeof window === "undefined") {
    return { href: url, external: true };
  }

  try {
    const parsed = new URL(url, window.location.origin);
    const isSameOrigin = parsed.origin === window.location.origin;
    const isAllowedHost = internalHostSuffixes.some((suffix) =>
      parsed.hostname.endsWith(suffix),
    );

    if (isSameOrigin || isAllowedHost) {
      return {
        href: `${parsed.pathname}${parsed.search}${parsed.hash}`,
        external: false,
      };
    }
  } catch {
    return { href: url, external: true };
  }

  return { href: url, external: true };
}
