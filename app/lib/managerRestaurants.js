export const OWNER_EMAIL = "matt.29.ds@gmail.com";

export function isOwnerUser(user) {
  return Boolean(user?.email && user.email === OWNER_EMAIL);
}

export function isManagerUser(user) {
  return (user?.user_metadata?.role || user?.role || null) === "manager";
}

export function isManagerOrOwnerUser(user) {
  return isOwnerUser(user) || isManagerUser(user);
}

export async function fetchManagerRestaurants(supabase, user) {
  if (!supabase || !user?.id) return [];

  const isOwner = isOwnerUser(user);

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

export async function resolveManagerRestaurantAccess(supabase, user) {
  const isOwner = isOwnerUser(user);
  const isManager = isManagerUser(user);
  const managerRestaurants = isManagerOrOwnerUser(user)
    ? await fetchManagerRestaurants(supabase, user)
    : [];

  return {
    isOwner,
    isManager,
    managerRestaurants,
    managedRestaurantIds: managerRestaurants
      .map((restaurant) => restaurant.id)
      .filter(Boolean),
    hasAccess: (isOwner || isManager) && (isOwner || managerRestaurants.length > 0),
  };
}
