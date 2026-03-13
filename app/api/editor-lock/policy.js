export function buildEditorLockConflictWhereClause({
  tableName,
  allowSameUserTakeover = false,
}) {
  const clauses = [
    `${tableName}.session_key = EXCLUDED.session_key`,
    `${tableName}.expires_at <= now()`,
    `${tableName}.last_heartbeat_at <= now() - make_interval(secs => $8::int)`,
  ];

  if (allowSameUserTakeover) {
    clauses.push(`${tableName}.user_id = EXCLUDED.user_id`);
  }

  return clauses
    .map((clause, index) => `${index === 0 ? "" : "OR "}${clause}`)
    .join("\n      ");
}
