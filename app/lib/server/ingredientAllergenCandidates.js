import { isSafeIngredientCatalogEntry } from "./ingredientCatalog.js";

function asText(value) {
  return String(value ?? "").trim();
}

function canonicalToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dedupeStrings(values) {
  const out = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = asText(value);
    if (!text) return;
    const token = canonicalToken(text);
    if (!token || seen.has(token)) return;
    seen.add(token);
    out.push(text);
  });
  return out;
}

export function buildCandidateListText(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => {
      const id = asText(candidate?.id);
      const kind = asText(candidate?.kind);
      const declarationType = asText(candidate?.declarationType);
      const riskType = asText(candidate?.riskType);
      const text = asText(candidate?.text);
      const meta = [kind, declarationType].filter(Boolean).join("/");
      return `${id} | ${meta || "candidate"} | risk=${riskType || "contained"} | text="${text}"`;
    })
    .join("\n");
}

export function partitionCandidatesByCatalogSafety({
  directCandidates,
  declarationCandidates,
  entriesByIngredient,
}) {
  const catalogSafeDirectCandidates = [];
  const aiCandidates = [];

  (Array.isArray(directCandidates) ? directCandidates : []).forEach((candidate) => {
    const entry = entriesByIngredient.get(asText(candidate?.text));
    if (isSafeIngredientCatalogEntry(entry)) {
      catalogSafeDirectCandidates.push(candidate);
      return;
    }
    aiCandidates.push(candidate);
  });

  (Array.isArray(declarationCandidates) ? declarationCandidates : []).forEach((candidate) => {
    aiCandidates.push(candidate);
  });

  return {
    catalogSafeDirectCandidates,
    aiCandidates,
  };
}

export function mapCandidateFlagsToPublicFlags(candidateFlags, candidateById) {
  const mergedByCandidate = new Map();

  (Array.isArray(candidateFlags) ? candidateFlags : []).forEach((flag) => {
    const candidateId = asText(flag?.candidate_id);
    const candidate = candidateById.get(candidateId);
    if (!candidate) return;

    const existing = mergedByCandidate.get(candidateId) || {
      ingredient: asText(candidate?.text),
      word_indices: Array.isArray(candidate?.wordIndices)
        ? candidate.wordIndices.map((value) => Number(value)).filter(Number.isFinite)
        : [],
      allergens: [],
      diets: [],
      risk_type: asText(candidate?.riskType) || "contained",
    };

    existing.allergens = dedupeStrings([
      ...existing.allergens,
      ...(Array.isArray(flag?.allergens) ? flag.allergens : []),
    ]);
    existing.diets = dedupeStrings([
      ...existing.diets,
      ...(Array.isArray(flag?.diets) ? flag.diets : []),
    ]);
    mergedByCandidate.set(candidateId, existing);
  });

  return Array.from(mergedByCandidate.values()).filter(
    (flag) => flag.allergens.length || flag.diets.length,
  );
}
