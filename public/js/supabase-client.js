// Supabase client initialization
const SUPABASE_URL = 'https://fgoiyycctnwnghrvsilt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnb2l5eWNjdG53bmdocnZzaWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA0MzY1MjYsImV4cCI6MjA3NjAxMjUyNn0.xlSSXr0Gl7j-vsckrj-2anpPmp4BG2SUIdN-_dquSA8';
const CLARIVORE_PUSH_PUBLIC_KEY = 'BLwHDRRCZBQE_RHLUlRBgrKcKjHGKxIM4UaYWkRHzUMfQZIkNVBERTHL2cvJ1koMTUYlpgfEdslZjj0nh3DLSG0';

// Reuse pre-initialized client when available (Next runtime sets this),
// otherwise fall back to window.supabase from CDN.
let supabaseClient = window.supabaseClient || null;
if (!supabaseClient) {
  const createClient =
    window.supabase && typeof window.supabase.createClient === 'function'
      ? window.supabase.createClient
      : null;
  if (!createClient) {
    throw new Error(
      'Supabase client is not initialized. Missing window.supabaseClient and window.supabase.createClient.',
    );
  }
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
}

// Make available globally for non-module scripts
window.supabaseClient = supabaseClient;
window.CLARIVORE_PUSH_PUBLIC_KEY = CLARIVORE_PUSH_PUBLIC_KEY;

// Export for ES modules
export default supabaseClient;
export { CLARIVORE_PUSH_PUBLIC_KEY };
