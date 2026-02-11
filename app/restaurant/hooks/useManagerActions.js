"use client";

import { useMemo } from "react";

export function useManagerActions({ restaurantId, user, permissions }) {
  const canManage = Boolean(
    permissions?.canEdit ||
      permissions?.isOwner ||
      permissions?.isManager,
  );

  const managerRestaurant = useMemo(() => {
    const managerRestaurants = Array.isArray(user?.managerRestaurants)
      ? user.managerRestaurants
      : [];

    if (!managerRestaurants.length || !restaurantId) return null;

    return (
      managerRestaurants.find(
        (restaurant) => String(restaurant.id) === String(restaurantId),
      ) || null
    );
  }, [restaurantId, user?.managerRestaurants]);

  const managerDashboardHref = useMemo(() => {
    if (!canManage) return "";
    return "/manager-dashboard";
  }, [canManage]);

  const openEditorHref = useMemo(() => {
    if (!canManage) return "";
    if (managerRestaurant?.slug) {
      return `/restaurant?slug=${encodeURIComponent(managerRestaurant.slug)}&edit=1`;
    }
    return "";
  }, [canManage, managerRestaurant?.slug]);

  return {
    canManage,
    managerRestaurant,
    managerDashboardHref,
    openEditorHref,
  };
}

export default useManagerActions;
