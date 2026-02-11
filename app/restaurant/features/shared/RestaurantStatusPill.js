"use client";

import { Badge } from "../../../components/ui";

const TONE_BY_STATUS = {
  safe: "success",
  removable: "warn",
  unsafe: "danger",
  neutral: "neutral",
};

const LABEL_BY_STATUS = {
  safe: "Safe",
  removable: "Can Be Adjusted",
  unsafe: "Not Safe",
  neutral: "Unknown",
};

export function RestaurantStatusPill({ status }) {
  const normalized = String(status || "neutral");
  const tone = TONE_BY_STATUS[normalized] || "neutral";
  const label = LABEL_BY_STATUS[normalized] || normalized;
  return <Badge tone={tone}>{label}</Badge>;
}

export default RestaurantStatusPill;
