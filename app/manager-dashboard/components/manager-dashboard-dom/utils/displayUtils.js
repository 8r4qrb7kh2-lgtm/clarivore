// Display helpers keep formatting logic and color-scale math out of JSX.

import { resolveChatLink } from "../../../../lib/chatMessage";

export function getHeatmapColor(value) {
  // Two-phase gradient:
  // 0.0 -> 0.5 transitions red to yellow, 0.5 -> 1.0 transitions yellow to green.
  let red;
  let green;
  let blue;

  if (value < 0.5) {
    const t = value * 2;
    red = 239;
    green = Math.round(68 + (204 - 68) * t);
    blue = Math.round(68 + (21 - 68) * t);
  } else {
    const t = (value - 0.5) * 2;
    red = Math.round(250 + (34 - 250) * t);
    green = Math.round(204 + (197 - 204) * t);
    blue = Math.round(21 + (94 - 21) * t);
  }

  return `rgba(${red}, ${green}, ${blue}, 0.5)`;
}

export function toRequestDateLabel(value) {
  // Request dates can be missing or invalid; use explicit fallback text.
  if (!value) return "Unknown date";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown date";

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function resolveManagerChatLink(url) {
  // Internal links should stay in-app for known hosts.
  return resolveChatLink(url, { internalHostSuffixes: ["clarivore.org"] });
}
