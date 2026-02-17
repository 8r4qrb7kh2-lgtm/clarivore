import { supabaseClient as defaultSupabaseClient } from "./supabase";

export async function notifyManagerChat({ messageId, client } = {}) {
  if (!messageId) return null;
  const supabase =
    client ||
    defaultSupabaseClient ||
    (typeof window !== "undefined" ? window.supabaseClient || null : null);
  if (!supabase) return null;

  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;

    const accessToken = String(session?.access_token || "").trim();
    if (!accessToken) {
      throw new Error("Missing access token");
    }

    const response = await fetch("/api/notifications/manager-chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ messageId }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error || "Failed to notify manager chat.");
    }

    return data;
  } catch (error) {
    console.error("Failed to send manager chat notifications:", error);
    return null;
  }
}
