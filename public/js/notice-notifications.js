import supabaseClient from './supabase-client.js';

export async function notifyDinerNotice({ orderId, client } = {}) {
  if (!orderId) return null;
  const supabase = client || supabaseClient;
  try {
    const { data, error } = await supabase.functions.invoke('notify-diner-notice', {
      body: { orderId }
    });
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Failed to send diner notice notifications:', err);
    return null;
  }
}
