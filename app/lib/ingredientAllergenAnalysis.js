function asText(value) {
  return String(value ?? "").trim();
}

// Label transcript -> allergen/diet flags via Next.js Node runtime endpoint.
// Input: array of transcript lines.
// Output: { success, data: { flags: [...], debug: {...}|null, parsedIngredientsList: [...] } }.
export async function analyzeAllergensWithLabelCropper(
  transcriptLines,
  { debug = false } = {},
) {
  const lines = Array.isArray(transcriptLines)
    ? transcriptLines.filter(
        (line) => typeof line === "string" && line.trim().length > 0,
      )
    : [];

  if (!lines.length) {
    return {
      success: true,
      data: { flags: [], debug: null, parsedIngredientsList: [] },
    };
  }

  try {
    const response = await fetch("/api/ingredient-allergen-analysis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transcriptLines: lines,
        analysisOptions: {
          debug: debug === true,
          useAiCandidateExtraction: true,
        },
      }),
    });

    const bodyText = await response.text();
    let payload = null;
    try {
      payload = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new Error(
        asText(payload?.error) ||
          asText(payload?.message) ||
          "Ingredient allergen analysis request failed.",
      );
    }

    if (payload?.success === false) {
      return {
        success: false,
        error:
          asText(payload?.error) ||
          asText(payload?.message) ||
          "Ingredient allergen analysis request failed.",
        data: { flags: [], debug: null, parsedIngredientsList: [] },
      };
    }

    const flags = Array.isArray(payload?.flags) ? payload.flags : [];
    const parsedIngredientsList = Array.isArray(payload?.parsedIngredientsList)
      ? payload.parsedIngredientsList
      : [];
    const debugPayload =
      payload?.debug && typeof payload.debug === "object" && !Array.isArray(payload.debug)
        ? payload.debug
        : null;
    return {
      success: true,
      data: { flags, debug: debugPayload, parsedIngredientsList },
    };
  } catch (error) {
    console.error("Allergen label analysis failed:", error);
    return {
      success: false,
      error: asText(error?.message) || "Ingredient allergen analysis request failed.",
      data: { flags: [], debug: null, parsedIngredientsList: [] },
    };
  }
}
