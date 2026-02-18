import { useCallback, useEffect } from "react";

import { parseChangeLogPayload } from "../utils/settingsAndChangelog";

// Handles lazy loading for historical logs and pending-save review rows.
// These actions are isolated because they share modal-open trigger behavior.

export function useChangeLogAndPendingTable({
  callbacks,
  restaurant,
  changeLogOpen,
  pendingTableOpen,

  changeLogLoadedForOpenRef,
  pendingTableLoadedForOpenRef,
  pendingTableLoadPromiseRef,

  setLoadingChangeLogs,
  setChangeLogError,
  setChangeLogs,
  setLoadingPendingTable,
  setPendingTableError,
  setPendingTableBatch,
  setPendingTableRows,

  restoreHistorySnapshot,
  appendPendingChange,
  pushHistory,
}) {
  // Load change-log history rows for the current restaurant.
  const loadChangeLogs = useCallback(async () => {
    const onLoadChangeLogs = callbacks?.onLoadChangeLogs;
    if (!onLoadChangeLogs || !restaurant?.id) return;
    setLoadingChangeLogs(true);
    setChangeLogError("");

    try {
      const logs = await onLoadChangeLogs(restaurant.id);
      setChangeLogs(Array.isArray(logs) ? logs : []);
    } catch (error) {
      setChangeLogError(error?.message || "Failed to load change log.");
    } finally {
      setLoadingChangeLogs(false);
    }
  }, [callbacks?.onLoadChangeLogs, restaurant?.id, setChangeLogError, setChangeLogs, setLoadingChangeLogs]);

  // Load staged pending-save table (batch metadata + row previews).
  // Promise memoization avoids duplicate requests while one is already in flight.
  const loadPendingTable = useCallback(async () => {
    const onLoadPendingSaveTable = callbacks?.onLoadPendingSaveTable;
    if (!onLoadPendingSaveTable || !restaurant?.id) return;
    if (pendingTableLoadPromiseRef.current) {
      return pendingTableLoadPromiseRef.current;
    }

    setLoadingPendingTable(true);
    setPendingTableError("");

    const request = (async () => {
      try {
        const result = await onLoadPendingSaveTable(restaurant.id);
        setPendingTableBatch(
          result?.batch && typeof result.batch === "object" ? result.batch : null,
        );
        setPendingTableRows(Array.isArray(result?.rows) ? result.rows : []);
      } catch (error) {
        setPendingTableError(error?.message || "Failed to load pending table.");
        setPendingTableBatch(null);
        setPendingTableRows([]);
      } finally {
        setLoadingPendingTable(false);
        pendingTableLoadPromiseRef.current = null;
      }
    })();

    pendingTableLoadPromiseRef.current = request;
    return request;
  }, [callbacks?.onLoadPendingSaveTable, pendingTableLoadPromiseRef, restaurant?.id, setLoadingPendingTable, setPendingTableBatch, setPendingTableError, setPendingTableRows]);

  // Lazily load logs only when the log modal first opens.
  useEffect(() => {
    if (!changeLogOpen) {
      changeLogLoadedForOpenRef.current = false;
      return;
    }
    if (changeLogLoadedForOpenRef.current) return;
    changeLogLoadedForOpenRef.current = true;
    loadChangeLogs();
  }, [changeLogLoadedForOpenRef, changeLogOpen, loadChangeLogs]);

  // Lazily load pending table only when the pending modal first opens.
  useEffect(() => {
    if (!pendingTableOpen) {
      pendingTableLoadedForOpenRef.current = false;
      return;
    }
    if (pendingTableLoadedForOpenRef.current) return;
    pendingTableLoadedForOpenRef.current = true;
    loadPendingTable();
  }, [loadPendingTable, pendingTableLoadedForOpenRef, pendingTableOpen]);

  // Restore overlays/menu snapshot from one historical change-log entry.
  const restoreFromChangeLog = useCallback((log) => {
    const parsed = parseChangeLogPayload(log);
    const snapshot =
      parsed?.snapshot ||
      parsed?.__editorSnapshot ||
      (parsed?.meta && typeof parsed.meta === "object" ? parsed.meta.snapshot : null);

    const nextSnapshot = snapshot && typeof snapshot === "object"
      ? {
          overlays: Array.isArray(snapshot.overlays) ? snapshot.overlays : [],
          menuImages: Array.isArray(snapshot.menuImages) ? snapshot.menuImages : [],
          pendingChanges: ["Restored overlays from previous version"],
        }
      : null;

    if (!nextSnapshot) return { success: false };

    restoreHistorySnapshot(nextSnapshot);
    appendPendingChange("Restored overlays from previous version");
    queueMicrotask(() => pushHistory());
    return { success: true };
  }, [appendPendingChange, pushHistory, restoreHistorySnapshot]);

  return {
    loadChangeLogs,
    loadPendingTable,
    restoreFromChangeLog,
  };
}
