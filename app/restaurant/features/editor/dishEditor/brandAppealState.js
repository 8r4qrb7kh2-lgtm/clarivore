function asText(value) {
  return String(value ?? "").trim();
}

function normalizeInlineText(value) {
  return asText(value).replace(/\s+/g, " ");
}

function isTruthyFlag(value) {
  if (value === true) return true;
  const normalized = asText(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isInlineDataUrl(value) {
  return asText(value).startsWith("data:");
}

export function normalizeIngredientBrandAppeal(appeal) {
  const safe = appeal && typeof appeal === "object" ? appeal : {};
  const status = asText(safe.status || safe.reviewStatus).toLowerCase();
  const managerMessage = normalizeInlineText(
    safe.managerMessage || safe.message || safe.manager_message,
  );
  const rawPhotoUrl = asText(safe.photoUrl || safe.photo_url);
  const photoAttached =
    isTruthyFlag(safe.photoAttached || safe.hasPhoto) || Boolean(rawPhotoUrl);
  const photoUrl = isInlineDataUrl(rawPhotoUrl) ? "" : rawPhotoUrl;
  const submittedAt = asText(safe.submittedAt || safe.submitted_at);
  const id = asText(safe.id);

  if (!id && !status && !managerMessage && !photoAttached && !submittedAt) {
    return null;
  }

  return {
    id,
    status: status || "pending",
    managerMessage,
    photoUrl,
    photoAttached,
    submittedAt,
  };
}

export function applyIngredientBrandAppeal(ingredient, appeal) {
  const next = ingredient && typeof ingredient === "object" ? { ...ingredient } : {};
  const normalizedAppeal = normalizeIngredientBrandAppeal(appeal);
  if (!normalizedAppeal) {
    delete next.brandAppeal;
    return next;
  }

  next.brandAppeal = normalizedAppeal;
  return next;
}

export function clearIngredientBrandAppeal(ingredient) {
  const next = ingredient && typeof ingredient === "object" ? { ...ingredient } : {};
  delete next.brandAppeal;
  return next;
}

export function isIngredientBrandAppealPending(ingredient) {
  const normalizedAppeal = normalizeIngredientBrandAppeal(ingredient?.brandAppeal);
  return normalizedAppeal?.status === "pending";
}
