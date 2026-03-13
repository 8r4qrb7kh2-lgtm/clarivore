import assert from "node:assert/strict";
import test from "node:test";

import { buildEditorLockConflictWhereClause } from "./policy.js";

const TABLE_NAME = "public.restaurant_editor_locks";

test("buildEditorLockConflictWhereClause allows same-user takeover for fresh acquires", () => {
  const clause = buildEditorLockConflictWhereClause({
    tableName: TABLE_NAME,
    allowSameUserTakeover: true,
  });

  assert.match(clause, /public\.restaurant_editor_locks\.user_id = EXCLUDED\.user_id/);
});

test("buildEditorLockConflictWhereClause keeps refresh heartbeats pinned to the active session", () => {
  const clause = buildEditorLockConflictWhereClause({
    tableName: TABLE_NAME,
    allowSameUserTakeover: false,
  });

  assert.doesNotMatch(clause, /user_id = EXCLUDED\.user_id/);
  assert.match(clause, /session_key = EXCLUDED\.session_key/);
});
