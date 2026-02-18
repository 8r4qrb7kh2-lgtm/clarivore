import { useMemo } from "react";
import { resolveManagerDisplayName } from "../../../../lib/userIdentity";

// Derives identity and access booleans from current user and restaurant list props.
export function useManagerIdentity({ user, isManagerOrOwner, managerRestaurants }) {
  const managerDisplayName = useMemo(() => resolveManagerDisplayName(user), [user]);

  const hasManagerAccess = Boolean(
    user && isManagerOrOwner && Array.isArray(managerRestaurants) && managerRestaurants.length > 0,
  );

  return {
    managerDisplayName,
    hasManagerAccess,
  };
}
