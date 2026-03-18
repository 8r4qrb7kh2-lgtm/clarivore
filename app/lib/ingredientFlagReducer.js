function asText(value) {
  return String(value ?? "").trim();
}

function canonicalToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dedupeStrings(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => asText(value))
    .filter(Boolean)
    .filter((value) => {
      const token = canonicalToken(value);
      if (!token || seen.has(token)) return false;
      seen.add(token);
      return true;
    });
}

export function pruneCrossSelections(containsValues, crossValues) {
  const containsTokens = new Set(
    dedupeStrings(containsValues).map((value) => canonicalToken(value)).filter(Boolean),
  );

  return dedupeStrings(crossValues).filter(
    (value) => !containsTokens.has(canonicalToken(value)),
  );
}

export function reduceIngredientFlagSelections(flags) {
  const containedAllergens = new Set();
  const crossAllergens = new Set();
  const violatedDiets = new Set();
  const crossDiets = new Set();

  (Array.isArray(flags) ? flags : []).forEach((flag) => {
    const isContains = asText(flag?.risk_type).toLowerCase().includes("cross")
      ? false
      : true;

    (Array.isArray(flag?.allergens) ? flag.allergens : []).forEach((allergen) => {
      const name = asText(allergen);
      if (!name) return;
      if (isContains) {
        containedAllergens.add(name);
        return;
      }
      crossAllergens.add(name);
    });

    (Array.isArray(flag?.diets) ? flag.diets : []).forEach((diet) => {
      const name = asText(diet);
      if (!name) return;
      if (isContains) {
        violatedDiets.add(name);
        return;
      }
      crossDiets.add(name);
    });
  });

  const containedAllergenList = dedupeStrings(Array.from(containedAllergens));
  const violatedDietList = dedupeStrings(Array.from(violatedDiets));

  return {
    containedAllergens: containedAllergenList,
    crossContaminationAllergens: pruneCrossSelections(
      containedAllergenList,
      Array.from(crossAllergens),
    ),
    violatedDiets: violatedDietList,
    crossContaminationDiets: pruneCrossSelections(
      violatedDietList,
      Array.from(crossDiets),
    ),
  };
}
