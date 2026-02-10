import { getSupabaseClient as getRuntimeSupabaseClient } from "./restaurantRuntime/runtimeSessionState.js";

export async function notifyManagerChat({ messageId, client } = {}) {
  if (!messageId) return null;
  const runtimeClient = getRuntimeSupabaseClient();
  const supabase = client || runtimeClient || window.supabaseClient || null;
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.functions.invoke(
      "notify-manager-chat",
      {
        body: { messageId },
      },
    );
    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Failed to send manager chat notifications:", error);
    return null;
  }
}
