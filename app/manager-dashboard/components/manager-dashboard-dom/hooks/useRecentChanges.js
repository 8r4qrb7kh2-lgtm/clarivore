import { useCallback, useMemo } from "react";

// Prepares change-log data for rendering and exposes navigation to full log screen.
export function useRecentChanges({ currentRestaurantData, recentChangeLogs, isLoadingDashboard, dashboardError }) {
  const onViewFullLog = useCallback(() => {
    const slug = currentRestaurantData?.slug;
    if (!slug) return;
    window.location.href = `/restaurant?slug=${encodeURIComponent(slug)}&edit=1&openLog=1`;
  }, [currentRestaurantData]);

  const previewChangeLogs = useMemo(
    () => (Array.isArray(recentChangeLogs) ? recentChangeLogs.slice(0, 3) : []),
    [recentChangeLogs],
  );

  const recentChangesLoading = isLoadingDashboard && !recentChangeLogs.length && !dashboardError;

  return {
    onViewFullLog,
    previewChangeLogs,
    recentChangesLoading,
  };
}
