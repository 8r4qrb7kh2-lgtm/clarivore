import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeChangeLogEntry } from "./changeLogs.js";

test("sanitizeChangeLogEntry removes heavy snapshot data from list responses by default", () => {
  const log = {
    id: "log-1",
    changes: {
      author: "Manager",
      general: ["Updated menu"],
      snapshot: {
        overlays: [{ id: "Dish 1" }],
        menuImages: ["data:image/jpeg;base64,abc123"],
      },
    },
  };

  assert.deepEqual(sanitizeChangeLogEntry(log), {
    id: "log-1",
    changes: {
      author: "Manager",
      general: ["Updated menu"],
    },
  });
});

test("sanitizeChangeLogEntry preserves snapshots when explicitly requested", () => {
  const log = {
    id: "log-2",
    changes: {
      author: "Manager",
      snapshot: { overlays: [{ id: "Dish 1" }] },
    },
  };

  assert.deepEqual(
    sanitizeChangeLogEntry(log, { includeSnapshots: true }),
    log,
  );
});
