import assert from "node:assert/strict";
import test from "node:test";

import { createDatabaseClient } from "./postgres.js";

function normalizeSql(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

test("findMany preserves multi-column orderBy arrays and skip offsets", async () => {
  const queries = [];
  const db = createDatabaseClient({
    client: {
      async query(text, params) {
        queries.push({
          text: normalizeSql(text),
          params,
        });
        return { rows: [], rowCount: 0 };
      },
    },
  });

  await db.change_logs.findMany({
    where: { restaurant_id: "restaurant-123" },
    orderBy: [
      { timestamp: "desc" },
      { id: "desc" },
    ],
    skip: 10,
    take: 5,
  });

  assert.equal(queries.length, 1);
  assert.match(
    queries[0].text,
    /ORDER BY "timestamp" DESC, "id" DESC LIMIT 5 OFFSET 10$/,
  );
  assert.deepEqual(queries[0].params, ["restaurant-123"]);
});
