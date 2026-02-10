function getSupabaseClient(options = {}) {
  if (options.supabaseClient) return options.supabaseClient;
  if (typeof window !== "undefined" && window.supabaseClient) {
    return window.supabaseClient;
  }
  return null;
}

// Label transcript -> Claude allergen/diet flagging via Supabase Edge Function
// Input: array of transcript line strings
// Output: { success, data: { flags: [{ ingredient, word_indices, allergens, diets, risk_type }] } }
export async function analyzeAllergensWithLabelCropper(
  transcriptLines,
  options = {},
) {
  const lines = Array.isArray(transcriptLines)
    ? transcriptLines.filter(
        (line) => typeof line === "string" && line.trim().length > 0,
      )
    : [];

  if (!lines.length) {
    return { success: true, data: { flags: [] } };
  }

  const client = getSupabaseClient(options);
  if (!client || !client.functions || typeof client.functions.invoke !== "function") {
    console.error("Supabase client not available for label analysis.");
    return { success: true, data: { flags: [] } };
  }

  try {
    const { data, error } = await client.functions.invoke(
      "analyze-brand-allergens",
      {
        body: {
          analysisMode: "list",
          transcriptLines: lines,
        },
      },
    );
    if (error) throw error;
    const flags = Array.isArray(data?.flags) ? data.flags : [];
    return { success: true, data: { flags } };
  } catch (err) {
    console.error("Allergen label analysis failed:", err);
    return { success: true, data: { flags: [] } };
  }
}
