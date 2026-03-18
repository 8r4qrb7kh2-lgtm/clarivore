function asText(value) {
  return String(value || "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dedupeTokenList(values) {
  const output = [];
  const seen = new Set();

  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = asText(value);
    if (!text) return;
    const token = normalizeToken(text);
    if (!token || seen.has(token)) return;
    seen.add(token);
    output.push(text);
  });

  return output;
}

function formatTokenStateLabel(state) {
  if (state === "contains") return "contains";
  if (state === "cross") return "cross-contamination";
  return "none";
}

export function buildDietAllergenConflictMessages({
  selectedAllergenEntries,
  selectedDietEntries,
  getDietAllergenConflicts,
  formatAllergenLabel,
  formatDietLabel,
}) {
  if (typeof getDietAllergenConflicts !== "function") return [];

  const allergenStateByToken = new Map();
  (Array.isArray(selectedAllergenEntries) ? selectedAllergenEntries : []).forEach((entry) => {
    const token = normalizeToken(entry?.token);
    const state = asText(entry?.state);
    if (!token || !state || state === "none") return;
    allergenStateByToken.set(token, state);
  });

  const messages = [];

  (Array.isArray(selectedDietEntries) ? selectedDietEntries : []).forEach((entry) => {
    const diet = asText(entry?.token);
    const dietState = asText(entry?.state);
    if (!diet || !dietState || dietState === "none") return;

    const conflicts = dedupeTokenList(getDietAllergenConflicts(diet));
    conflicts.forEach((allergen) => {
      const allergenState = allergenStateByToken.get(normalizeToken(allergen)) || "none";
      if (allergenState === "none") return;

      if (dietState === "cross" && allergenState === "cross") {
        return;
      }

      const formattedDiet =
        typeof formatDietLabel === "function" ? formatDietLabel(diet) : diet;
      const formattedAllergen =
        typeof formatAllergenLabel === "function"
          ? formatAllergenLabel(allergen)
          : allergen;

      if (dietState === "contains" && allergenState === "contains") {
        messages.push(
          `Conflict warning: ${formattedDiet} conflicts with ${formattedAllergen} because both are marked as contains.`,
        );
        return;
      }

      messages.push(
        `Selection warning: ${formattedDiet} conflicts with ${formattedAllergen} (${formattedDiet} is marked as ${formatTokenStateLabel(dietState)}; ${formattedAllergen} is marked as ${formatTokenStateLabel(allergenState)}).`,
      );
    });
  });

  return dedupeTokenList(messages);
}
