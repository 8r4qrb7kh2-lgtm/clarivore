const CLARIVORE_PUSH_PUBLIC_KEY = window.CLARIVORE_PUSH_PUBLIC_KEY || "";

const supabaseClient = window.supabaseClient || null;
if (!supabaseClient) {
  throw new Error(
    "Supabase client is not initialized. Expected window.supabaseClient from Next runtime bootstrap.",
  );
}

window.supabaseClient = supabaseClient;
window.CLARIVORE_PUSH_PUBLIC_KEY = CLARIVORE_PUSH_PUBLIC_KEY;

export default supabaseClient;
export { CLARIVORE_PUSH_PUBLIC_KEY };
