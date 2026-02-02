const OWNER_EMAIL = 'matt.29.ds@gmail.com';

export async function fetchManagerRestaurants(supabaseClient, userId) {
  if (!supabaseClient || !userId) return [];
  try {
    // Check if user is owner - if so, fetch ALL restaurants
    const { data: { user } } = await supabaseClient.auth.getUser();
    const isOwner = user?.email === OWNER_EMAIL;

    if (isOwner) {
      // Owner gets all restaurants
      const { data: restaurants, error } = await supabaseClient
        .from('restaurants')
        .select('id, name, slug')
        .order('name');

      if (error) {
        console.error('[manager-context] failed to load all restaurants for owner', error);
        return [];
      }

      return (restaurants || [])
        .filter((row) => row && row.id && row.slug)
        .map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name || 'Restaurant'
        }));
    }

    // Regular managers - check restaurant_managers table
    const { data: assignments, error } = await supabaseClient
      .from('restaurant_managers')
      .select('restaurant_id')
      .eq('user_id', userId);

    if (error) {
      console.error('[manager-context] failed to load assignments', error);
      return [];
    }

    const restaurantIds = (assignments || [])
      .map((row) => row.restaurant_id)
      .filter(Boolean);

    if (!restaurantIds.length) return [];

    const { data: restaurants, error: restaurantError } = await supabaseClient
      .from('restaurants')
      .select('id, name, slug')
      .in('id', restaurantIds);

    if (restaurantError) {
      console.error('[manager-context] failed to load restaurant details', restaurantError);
      return [];
    }

    return (restaurants || [])
      .filter((row) => row && row.id && row.slug)
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name || 'Restaurant'
      }));
  } catch (error) {
    console.error('[manager-context] unexpected error', error);
    return [];
  }
}


