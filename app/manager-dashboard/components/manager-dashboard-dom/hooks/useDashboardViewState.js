import { useEffect, useState } from "react";

// UI-only state for dashboard widgets that does not belong to server data.
// Grouping these fields keeps the main component focused on composition.
export function useDashboardViewState({ selectedRestaurantId, onRestaurantChange }) {
  const [heatmapMetric, setHeatmapMetric] = useState("views");
  const [heatmapPage, setHeatmapPage] = useState(0);
  const [activeDishName, setActiveDishName] = useState("");
  const [activeTooltipId, setActiveTooltipId] = useState("");

  useEffect(() => {
    // Restaurant switch resets view-specific UI so stale state does not leak across restaurants.
    setHeatmapPage(0);
    setActiveDishName("");
    setActiveTooltipId("");

    if (typeof onRestaurantChange === "function") {
      onRestaurantChange();
    }
  }, [onRestaurantChange, selectedRestaurantId]);

  useEffect(() => {
    if (!activeTooltipId) return undefined;

    // Clicking outside tooltip containers closes any open explanatory tooltip.
    const closeTooltip = (event) => {
      if (event.target.closest(".info-tooltip-container")) return;
      setActiveTooltipId("");
    };

    document.addEventListener("click", closeTooltip);
    return () => document.removeEventListener("click", closeTooltip);
  }, [activeTooltipId]);

  return {
    heatmapMetric,
    setHeatmapMetric,
    heatmapPage,
    setHeatmapPage,
    activeDishName,
    setActiveDishName,
    activeTooltipId,
    setActiveTooltipId,
  };
}
