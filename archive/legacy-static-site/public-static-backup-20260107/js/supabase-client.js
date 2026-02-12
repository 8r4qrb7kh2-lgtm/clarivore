// Export the shared Supabase client from window to avoid creating multiple instances
// This prevents "Multiple GoTrueClient instances" warnings

// Wait for the client to be available if it hasn't been initialized yet
const waitForSupabaseClient = () => {
  return new Promise((resolve) => {
    if (window.supabaseClient) {
      resolve(window.supabaseClient);
    } else {
      const check = setInterval(() => {
        if (window.supabaseClient) {
          clearInterval(check);
          resolve(window.supabaseClient);
        }
      }, 50);

      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(check);
        console.error('Supabase client not initialized after 10 seconds');
        resolve(null);
      }, 10000);
    }
  });
};

// Export the client - it will be available after the promise resolves
const supabaseClient = window.supabaseClient || await waitForSupabaseClient();

export default supabaseClient;