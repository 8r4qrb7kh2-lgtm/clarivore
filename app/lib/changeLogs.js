function toSafeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(parsed, 0);
}

function toSortableTimestamp(log) {
  const rawTimestamp =
    log?.timestamp ?? log?.created_at ?? log?.createdAt ?? log?.updated_at ?? log?.updatedAt;
  const parsed = Date.parse(String(rawTimestamp || "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function compareLogIdsDescending(leftId, rightId) {
  const leftText = String(leftId || "").trim();
  const rightText = String(rightId || "").trim();
  if (!leftText && !rightText) return 0;
  if (!leftText) return 1;
  if (!rightText) return -1;

  const leftNumeric = Number(leftText);
  const rightNumeric = Number(rightText);
  if (Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric)) {
    if (leftNumeric !== rightNumeric) return rightNumeric - leftNumeric;
    return 0;
  }

  return rightText.localeCompare(leftText, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function stripSnapshotFromChanges(changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    return changes;
  }
  if (!Object.prototype.hasOwnProperty.call(changes, "snapshot")) {
    return changes;
  }

  const nextChanges = { ...changes };
  delete nextChanges.snapshot;
  return nextChanges;
}

export function sanitizeChangeLogEntry(log, options = {}) {
  const safeLog = log && typeof log === "object" ? { ...log } : log;
  if (!safeLog || typeof safeLog !== "object") {
    return safeLog;
  }

  if (options.includeSnapshots === true) {
    return safeLog;
  }

  if (safeLog.changes && typeof safeLog.changes === "object" && !Array.isArray(safeLog.changes)) {
    safeLog.changes = stripSnapshotFromChanges(safeLog.changes);
    return safeLog;
  }

  if (typeof safeLog.changes === "string") {
    try {
      safeLog.changes = stripSnapshotFromChanges(JSON.parse(safeLog.changes));
    } catch {
      // Leave malformed historical payloads unchanged instead of hiding the log entry.
    }
  }

  return safeLog;
}

export function sortChangeLogsNewestFirst(logs = []) {
  const safeLogs = Array.isArray(logs) ? logs : [];
  return safeLogs
    .map((log, index) => ({
      log,
      index,
      timestamp: toSortableTimestamp(log),
    }))
    .sort((left, right) => {
      if (left.timestamp != null || right.timestamp != null) {
        if (left.timestamp == null) return 1;
        if (right.timestamp == null) return -1;
        if (left.timestamp !== right.timestamp) {
          return right.timestamp - left.timestamp;
        }
      }

      const idComparison = compareLogIdsDescending(left.log?.id, right.log?.id);
      if (idComparison !== 0) return idComparison;

      return left.index - right.index;
    })
    .map(({ log }) => log);
}

async function getAccessToken(supabaseClient) {
  const { data: sessionData, error: sessionError } =
    await supabaseClient.auth.getSession();
  if (sessionError) throw sessionError;

  const accessToken = String(sessionData?.session?.access_token || "").trim();
  if (!accessToken) {
    throw new Error("You must be signed in.");
  }
  return accessToken;
}

async function readChangeLogResponse(response, options = {}) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(
      String(payload?.error || "").trim() || "Failed to load change log.",
    );
  }
  const logs = Array.isArray(payload?.logs) ? payload.logs : [];
  return sortChangeLogsNewestFirst(
    logs.map((log) => sanitizeChangeLogEntry(log, options)),
  );
}

// Shared change-log read helper so dashboard/editor stay in sync.
export async function fetchRestaurantChangeLogs(
  supabaseClient,
  restaurantId,
  options = {},
) {
  if (!supabaseClient) throw new Error("Supabase is not configured.");

  const safeRestaurantId = String(restaurantId || "").trim();
  if (!safeRestaurantId) return [];

  const limit = toSafeInteger(options.limit, 10) || 10;
  const offset = toSafeInteger(options.offset, 0);
  const includeSnapshots = options.includeSnapshots === true;
  const accessToken = await getAccessToken(supabaseClient);
  const params = new URLSearchParams();
  params.set("restaurantId", safeRestaurantId);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  params.set("includeSnapshots", includeSnapshots ? "1" : "0");

  const response = await fetch(`/api/restaurant-change-logs?${params.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  return await readChangeLogResponse(response, { includeSnapshots });
}
