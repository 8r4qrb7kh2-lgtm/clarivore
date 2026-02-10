import { getSupabaseClient as getRuntimeSupabaseClient } from "./restaurantRuntime/runtimeSessionState.js";

function resolveSupabaseClient(options = {}) {
  if (options.supabaseClient) return options.supabaseClient;
  const runtimeClient = getRuntimeSupabaseClient();
  if (runtimeClient) return runtimeClient;
  if (typeof window !== "undefined" && window.supabaseClient) {
    return window.supabaseClient;
  }
  return null;
}

// Label transcript -> allergen/diet flags via Supabase Edge Function.
// Input: array of transcript lines.
// Output: { success, data: { flags: [...] } }.
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

  const client = resolveSupabaseClient(options);
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
  } catch (error) {
    console.error("Allergen label analysis failed:", error);
    return { success: true, data: { flags: [] } };
  }
}
