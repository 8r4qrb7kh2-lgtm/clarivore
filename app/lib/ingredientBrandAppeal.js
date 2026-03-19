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

function parseSnapshotBoolean(value) {
  const normalized = asText(value).toLowerCase();
  if (normalized === "yes") return true;
  if (normalized === "no") return false;
  return undefined;
}

export function normalizeIngredientBrandAppeal(appeal) {
  const safe = appeal && typeof appeal === "object" ? appeal : {};
  const status = asText(safe.status || safe.reviewStatus || safe.review_status).toLowerCase();
  const managerMessage = normalizeInlineText(
    safe.managerMessage || safe.message || safe.manager_message,
  );
  const reviewNotes = normalizeInlineText(safe.reviewNotes || safe.review_notes);
  const rawPhotoUrl = asText(safe.photoUrl || safe.photo_url);
  const photoAttached =
    isTruthyFlag(
      safe.photoAttached || safe.photo_attached || safe.hasPhoto || safe.has_photo,
    ) || Boolean(rawPhotoUrl);
  const photoUrl = isInlineDataUrl(rawPhotoUrl) ? "" : rawPhotoUrl;
  const submittedAt = asText(safe.submittedAt || safe.submitted_at);
  const reviewedAt = asText(safe.reviewedAt || safe.reviewed_at);
  const reviewedBy = asText(safe.reviewedBy || safe.reviewed_by);
  const id = asText(safe.id);

  if (
    !id &&
    !status &&
    !managerMessage &&
    !reviewNotes &&
    !photoAttached &&
    !submittedAt &&
    !reviewedAt &&
    !reviewedBy
  ) {
    return null;
  }

  return {
    id,
    status: status || "pending",
    managerMessage,
    reviewNotes,
    photoUrl,
    photoAttached,
    submittedAt,
    reviewedAt,
    reviewedBy,
  };
}

export function formatIngredientBrandAppealSnapshot(appeal, emptyLabel = "Brand assignment appeal: none") {
  const normalizedAppeal = normalizeIngredientBrandAppeal(appeal);
  if (!normalizedAppeal) {
    return emptyLabel;
  }

  const lines = [`Brand assignment appeal: ${normalizedAppeal.status}`];
  if (normalizedAppeal.managerMessage) {
    lines.push(`Message: ${normalizedAppeal.managerMessage}`);
  }
  lines.push(`Photo attached: ${normalizedAppeal.photoAttached ? "yes" : "no"}`);
  if (normalizedAppeal.submittedAt) {
    lines.push(`Submitted at: ${normalizedAppeal.submittedAt}`);
  }
  if (normalizedAppeal.reviewedAt) {
    lines.push(`Reviewed at: ${normalizedAppeal.reviewedAt}`);
  }
  if (normalizedAppeal.reviewedBy) {
    lines.push(`Reviewed by: ${normalizedAppeal.reviewedBy}`);
  }
  if (normalizedAppeal.reviewNotes) {
    lines.push(`Review notes: ${normalizedAppeal.reviewNotes}`);
  }
  return lines.join("\n");
}

export function parseIngredientBrandAppealSnapshot(snapshot) {
  const safeSnapshot = asText(snapshot);
  if (!safeSnapshot) return null;
  if (safeSnapshot === "Brand assignment appeal: none") {
    return null;
  }

  const parsed = {};
  safeSnapshot.split(/\r?\n/).forEach((line, index) => {
    const safeLine = asText(line);
    if (!safeLine) return;

    if (index === 0 && safeLine.toLowerCase().startsWith("brand assignment appeal:")) {
      parsed.status = asText(safeLine.slice("Brand assignment appeal:".length));
      return;
    }
    if (safeLine.startsWith("Message:")) {
      parsed.managerMessage = asText(safeLine.slice("Message:".length));
      return;
    }
    if (safeLine.startsWith("Photo attached:")) {
      parsed.photoAttached = parseSnapshotBoolean(
        safeLine.slice("Photo attached:".length),
      );
      return;
    }
    if (safeLine.startsWith("Submitted at:")) {
      parsed.submittedAt = asText(safeLine.slice("Submitted at:".length));
      return;
    }
    if (safeLine.startsWith("Reviewed at:")) {
      parsed.reviewedAt = asText(safeLine.slice("Reviewed at:".length));
      return;
    }
    if (safeLine.startsWith("Reviewed by:")) {
      parsed.reviewedBy = asText(safeLine.slice("Reviewed by:".length));
      return;
    }
    if (safeLine.startsWith("Review notes:")) {
      parsed.reviewNotes = asText(safeLine.slice("Review notes:".length));
    }
  });

  return normalizeIngredientBrandAppeal(parsed);
}
