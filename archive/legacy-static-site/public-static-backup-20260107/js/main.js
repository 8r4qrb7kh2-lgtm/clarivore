import supabaseClient from './supabase-client.js';

console.log('Clarivore loaded!');
console.log('Supabase connected:', supabaseClient ? 'Yes' : 'No');

// Check if user is logged in
async function checkAuth() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  console.log('Current user:', user?.email || 'Not logged in');
}

checkAuth();