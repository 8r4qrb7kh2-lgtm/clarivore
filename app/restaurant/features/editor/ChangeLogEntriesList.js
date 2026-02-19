"use client";

import { useMemo, useState } from "react";
import {
  asText,
  parseChangePayload,
  collectRenderedChangeSummaryTokens,
  formatChangeText,
  renderChangeLine,
  formatLogTimestamp,
  ReviewRowGroupedList,
} from "./editorUtils";

function hasReviewRowMenuImageRefs(row) {
  const pageList = Array.isArray(row?.menuImagePages)
    ? row.menuImagePages
    : row?.menuImagePage != null
      ? [row.menuImagePage]
      : [];
  return pageList.some((value) => Number.isFinite(Number(value)) && Number(value) >= 0);
}

// Shared renderer so dashboard preview and editor modal show the same change-log entries.
export default function ChangeLogEntriesList({
  logs = [],
  menuImages = [],
  limit = 0,
  className = "space-y-3",
  showReviewRows = true,
}) {
  const [expandedRowsByLog, setExpandedRowsByLog] = useState({});

  const visibleLogs = useMemo(() => {
    const safeLogs = Array.isArray(logs) ? logs : [];
    const maxRows = Number(limit);
    if (!Number.isFinite(maxRows) || maxRows <= 0) return safeLogs;
    return safeLogs.slice(0, maxRows);
  }, [limit, logs]);

  return (
    <div className={className}>
      {visibleLogs.map((log, logIndex) => {
        // Parse both legacy and structured payloads so old entries still render correctly.
        const parsed = parseChangePayload(log);
        const items = parsed?.items && typeof parsed.items === "object" ? parsed.items : {};
        const general = Array.isArray(parsed?.general)
          ? parsed.general
          : parsed?.general != null
            ? [parsed.general]
            : [];
        const renderedSummaryTokens = collectRenderedChangeSummaryTokens(general, items);
        const seenReviewTokens = new Set();
        const reviewRows = (Array.isArray(parsed?.reviewRows) ? parsed.reviewRows : [])
          .filter((row) => row && typeof row === "object")
          .filter((row) => {
            if (hasReviewRowMenuImageRefs(row)) {
              return true;
            }
            const summary = asText(row?.summary);
            if (!summary) return false;
            const token = String(summary || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            if (!token) return true;
            if (renderedSummaryTokens.has(token) || seenReviewTokens.has(token)) {
              return false;
            }
            seenReviewTokens.add(token);
            return true;
          });
        const author = formatChangeText(parsed?.author || log.description || "Manager");
        const photos = Array.isArray(log?.photos)
          ? log.photos
              .map((photo) => (typeof photo === "string" ? photo.trim() : ""))
              .filter(Boolean)
          : [];
        const logId = asText(log?.id || `${log?.timestamp || ""}-${log?.type || "entry"}-${logIndex}`);

        return (
          <div
            key={logId}
            className="rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.75)] p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-[#e9eefc]">
                {author || "Manager"}
              </span>
              <span className="text-xs text-[#a7b2d1]">{formatLogTimestamp(log.timestamp)}</span>
            </div>

            {general.length ? (
              <ul className="mt-2 mb-0 list-disc pl-5 text-sm text-[#cfd8f7]">
                {general.map((line, index) => renderChangeLine(line, `${logId}-general-${index}`))}
              </ul>
            ) : null}

            {Object.entries(items).map(([dishName, changes]) => (
              <div key={`${logId}-${dishName}`} className="mt-2">
                <div className="text-sm font-medium text-[#dbe3ff]">{dishName}</div>
                <ul className="mb-0 mt-1 list-disc pl-5 text-sm text-[#c7d2f4]">
                  {(Array.isArray(changes) ? changes : [changes])
                    .filter((line) => line != null)
                    .map((line, index) => renderChangeLine(line, `${logId}-${dishName}-${index}`))}
                </ul>
              </div>
            ))}

            {showReviewRows && reviewRows.length ? (
              <div className="mt-2">
                <div className="text-sm font-medium text-[#dbe3ff]">Review rows</div>
                <div className="mt-1">
                  <ReviewRowGroupedList
                    rows={reviewRows}
                    menuImages={menuImages}
                    expandedRows={expandedRowsByLog}
                    rowKeyPrefix={`log-${logId}-`}
                    onToggleRow={(rowKey) =>
                      setExpandedRowsByLog((current) => ({
                        ...current,
                        [rowKey]: !current[rowKey],
                      }))
                    }
                  />
                </div>
              </div>
            ) : null}

            {photos.length ? (
              // Evidence photos are kept as raw links, then rendered as compact thumbnails.
              <div className="mt-2 flex flex-wrap gap-2">
                {photos.map((photo, index) => (
                  <a
                    key={`${logId}-photo-${index}`}
                    href={photo}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src={photo}
                      alt={`Change log photo ${index + 1}`}
                      className="h-[64px] w-[96px] rounded border border-[#2a3261] object-cover"
                    />
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
