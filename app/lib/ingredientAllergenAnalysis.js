function asText(value) {
  return String(value ?? "").trim();
}

async function invokeViaAiProxy(functionName, payload) {
  const response = await fetch("/api/ai-proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      functionName,
      payload: payload || {},
    }),
  });

  const bodyText = await response.text();
  let parsed = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new Error(
      asText(parsed?.error) ||
        asText(parsed?.message) ||
        "AI proxy request failed.",
    );
  }

  return parsed || {};
}

// Label transcript -> allergen/diet flags via Next.js proxy to Supabase Edge Function.
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
    const data = await invokeViaAiProxy("analyze-brand-allergens", {
      analysisMode: "list",
      transcriptLines: lines,
    });
    const flags = Array.isArray(data?.flags) ? data.flags : [];
    return { success: true, data: { flags } };
  } catch (error) {
    console.error("Allergen label analysis failed:", error);
    return { success: true, data: { flags: [] } };
  }
}

