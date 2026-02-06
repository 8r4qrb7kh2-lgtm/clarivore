export const OWNER_EMAIL = "matt.29.ds@gmail.com";

export async function fetchManagerRestaurants(supabase, user) {
  if (!supabase || !user?.id) return [];

  const isOwner = user.email === OWNER_EMAIL;

  if (isOwner) {
    const { data, error } = await supabase
      .from("restaurants")
      .select("id, name, slug")
      .order("name");
    if (error) {
      console.error("[manager-restaurants] failed to load owner restaurants", error);
      return [];
    }
    return (data || [])
      .filter((row) => row && row.id && row.slug)
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name || "Restaurant",
      }));
  }

  const { data: assignments, error } = await supabase
    .from("restaurant_managers")
    .select("restaurant_id")
    .eq("user_id", user.id);

  if (error) {
    console.error("[manager-restaurants] failed to load assignments", error);
    return [];
  }

  const restaurantIds = (assignments || [])
    .map((row) => row.restaurant_id)
    .filter(Boolean);

  if (!restaurantIds.length) return [];

  const { data: restaurants, error: restaurantError } = await supabase
    .from("restaurants")
    .select("id, name, slug")
    .in("id", restaurantIds)
    .order("name");

  if (restaurantError) {
    console.error(
      "[manager-restaurants] failed to load manager restaurants",
      restaurantError,
    );
    return [];
  }

  return (restaurants || [])
    .filter((row) => row && row.id && row.slug)
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name || "Restaurant",
    }));
}
