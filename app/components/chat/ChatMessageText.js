"use client";

import { useMemo } from "react";
import { parseChatMessageTokens } from "../../lib/chatMessage";

export default function ChatMessageText({ text, resolveLink }) {
  const tokens = useMemo(() => parseChatMessageTokens(text), [text]);

  return (
    <>
      {tokens.map((token, index) => {
        if (token.type !== "link") {
          return <span key={`${token.value}-${index}`}>{token.value}</span>;
        }

        const link = typeof resolveLink === "function"
          ? resolveLink(token.href)
          : { href: token.href, external: true };

        const href = link?.href || token.href;
        const external = Boolean(link?.external);

        return (
          <a
            key={`${token.href}-${index}`}
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
          >
            {token.label}
          </a>
        );
      })}
    </>
  );
}
