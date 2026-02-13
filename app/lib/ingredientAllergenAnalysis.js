function asText(value) {
  return String(value ?? "").trim();
}

// Label transcript -> allergen/diet flags via Next.js Node runtime endpoint.
// Input: array of transcript lines.
// Output: { success, data: { flags: [...] } }.
export async function analyzeAllergensWithLabelCropper(transcriptLines) {
  const lines = Array.isArray(transcriptLines)
    ? transcriptLines.filter(
        (line) => typeof line === "string" && line.trim().length > 0,
      )
    : [];

  if (!lines.length) {
    return { success: true, data: { flags: [] } };
  }

  try {
    const response = await fetch("/api/ingredient-allergen-analysis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transcriptLines: lines,
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

    const flags = Array.isArray(payload?.flags) ? payload.flags : [];
    return { success: true, data: { flags } };
  } catch (error) {
    console.error("Allergen label analysis failed:", error);
    return { success: true, data: { flags: [] } };
  }
}
