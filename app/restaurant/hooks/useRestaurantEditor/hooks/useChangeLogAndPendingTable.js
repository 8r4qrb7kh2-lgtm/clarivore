import { useCallback, useEffect } from "react";

import { parseChangeLogPayload } from "../utils/settingsAndChangelog";

// Handles lazy loading for historical logs and pending-save review rows.
// These actions are isolated because they share modal-open trigger behavior.

function toChangeLogKey(log, index) {
  const id = String(log?.id || "").trim();
  if (id) return id;
  const timestamp = String(log?.timestamp || "").trim();
  const type = String(log?.type || "").trim();
  return `${timestamp}-${type}-${index}`;
}

function appendUniqueChangeLogs(existing, incoming) {
  const base = Array.isArray(existing) ? existing : [];
  const next = Array.isArray(incoming) ? incoming : [];
  if (!base.length) return [...next];
  if (!next.length) return base;

  const seen = new Set(base.map((entry, index) => toChangeLogKey(entry, index)));
  const output = [...base];
  next.forEach((entry, index) => {
    const key = toChangeLogKey(entry, index);
    if (seen.has(key)) return;
    seen.add(key);
    output.push(entry);
  });
  return output;
}

export function useChangeLogAndPendingTable({
  callbacks,
  restaurant,
  changeLogOpen,
  pendingTableOpen,

  changeLogs,
  changeLogPageSize,
  changeLogLoadedForOpenRef,
  changeLogLoadPromiseRef,
  pendingTableLoadedForOpenRef,
  pendingTableLoadPromiseRef,

  setLoadingChangeLogs,
  setLoadingMoreChangeLogs,
  setChangeLogHasMore,
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
  const loadChangeLogs = useCallback(async ({ append = false } = {}) => {
    const onLoadChangeLogs = callbacks?.onLoadChangeLogs;
    if (!onLoadChangeLogs || !restaurant?.id) return;
    if (changeLogLoadPromiseRef.current) {
      return changeLogLoadPromiseRef.current;
    }

    const safePageSize = Number.isFinite(Number(changeLogPageSize))
      ? Math.max(1, Math.floor(Number(changeLogPageSize)))
      : 10;
    const offset = append ? changeLogs.length : 0;

    if (append) {
      setLoadingMoreChangeLogs(true);
    } else {
      setLoadingChangeLogs(true);
      setLoadingMoreChangeLogs(false);
    }
    setChangeLogError("");

    const request = (async () => {
      try {
        const logs = await onLoadChangeLogs(restaurant.id, {
          limit: safePageSize + 1,
          offset,
        });
        const safeLogs = (Array.isArray(logs) ? logs : []).slice(0, safePageSize);
        setChangeLogs((current) =>
          append ? appendUniqueChangeLogs(current, safeLogs) : safeLogs,
        );
        setChangeLogHasMore((Array.isArray(logs) ? logs : []).length > safePageSize);
      } catch (error) {
        setChangeLogError(error?.message || "Failed to load change log.");
      } finally {
        setLoadingChangeLogs(false);
        setLoadingMoreChangeLogs(false);
        changeLogLoadPromiseRef.current = null;
      }
    })();

    changeLogLoadPromiseRef.current = request;
    return request;
  }, [
    callbacks?.onLoadChangeLogs,
    changeLogLoadPromiseRef,
    changeLogPageSize,
    changeLogs.length,
    restaurant?.id,
    setChangeLogError,
    setChangeLogHasMore,
    setChangeLogs,
    setLoadingChangeLogs,
    setLoadingMoreChangeLogs,
  ]);

  const loadMoreChangeLogs = useCallback(async () => {
    return await loadChangeLogs({ append: true });
  }, [loadChangeLogs]);

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
      changeLogLoadPromiseRef.current = null;
      setLoadingChangeLogs(false);
      setLoadingMoreChangeLogs(false);
      return;
    }
    if (!restaurant?.id) return;
    if (changeLogLoadedForOpenRef.current) return;
    changeLogLoadedForOpenRef.current = true;
    loadChangeLogs({ append: false });
  }, [
    changeLogLoadedForOpenRef,
    changeLogLoadPromiseRef,
    changeLogOpen,
    loadChangeLogs,
    restaurant?.id,
    setLoadingChangeLogs,
    setLoadingMoreChangeLogs,
  ]);

  // Lazily load pending table only when the pending modal first opens.
  useEffect(() => {
    if (!pendingTableOpen) {
      pendingTableLoadedForOpenRef.current = false;
      return;
    }
    if (!restaurant?.id) return;
    if (pendingTableLoadedForOpenRef.current) return;
    pendingTableLoadedForOpenRef.current = true;
    loadPendingTable();
  }, [loadPendingTable, pendingTableLoadedForOpenRef, pendingTableOpen, restaurant?.id]);

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
    loadMoreChangeLogs,
    loadPendingTable,
    restoreFromChangeLog,
  };
}
