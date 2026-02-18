import { useEffect, useMemo, useState } from "react";

// Handles which restaurant is currently active in the dashboard.
// It keeps the selection valid when manager restaurant access changes.
export function useSelectedRestaurant({ managerRestaurants }) {
  const [selectedRestaurantId, setSelectedRestaurantId] = useState("");

  useEffect(() => {
    if (!managerRestaurants.length) {
      setSelectedRestaurantId("");
      return;
    }

    // Keep existing selection when still valid; otherwise default to first restaurant.
    setSelectedRestaurantId((current) => {
      if (current && managerRestaurants.some((restaurant) => restaurant.id === current)) {
        return current;
      }
      return managerRestaurants[0].id;
    });
  }, [managerRestaurants]);

  const selectedRestaurant = useMemo(
    () =>
      managerRestaurants.find((restaurant) => restaurant.id === selectedRestaurantId) || null,
    [managerRestaurants, selectedRestaurantId],
  );

  return {
    selectedRestaurantId,
    setSelectedRestaurantId,
    selectedRestaurant,
  };
}
