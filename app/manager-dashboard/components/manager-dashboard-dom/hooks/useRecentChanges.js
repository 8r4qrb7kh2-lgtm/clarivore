import { useCallback, useMemo } from "react";
import { parseChangeLogEntry } from "../utils/changeLogUtils";

// Prepares change-log data for rendering and exposes navigation to full log screen.
export function useRecentChanges({ currentRestaurantData, recentChangeLogs, isLoadingDashboard, dashboardError }) {
  const onViewFullLog = useCallback(() => {
    const slug = currentRestaurantData?.slug;
    if (!slug) return;
    window.location.href = `/restaurant?slug=${encodeURIComponent(slug)}&edit=1&openLog=1`;
  }, [currentRestaurantData]);

  const parsedChangeLogs = useMemo(
    () => recentChangeLogs.map(parseChangeLogEntry),
    [recentChangeLogs],
  );

  const recentChangesLoading = isLoadingDashboard && !recentChangeLogs.length && !dashboardError;

  return {
    onViewFullLog,
    parsedChangeLogs,
    recentChangesLoading,
  };
}
