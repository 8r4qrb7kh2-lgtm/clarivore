import supabaseClient from './supabase-client.js';

export async function notifyManagerChat({ messageId, client } = {}) {
  if (!messageId) return null;
  const supabase = client || supabaseClient;
  try {
    const { data, error } = await supabase.functions.invoke('notify-manager-chat', {
      body: { messageId }
    });
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Failed to send manager chat notifications:', err);
    return null;
  }
}
