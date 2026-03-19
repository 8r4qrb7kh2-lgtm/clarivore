import { Pool } from "pg";

const globalForDatabase = globalThis;
const MISSING_DATABASE_URL_MESSAGE = "Database configuration missing: DATABASE_URL.";
const DEFAULT_POOL_MAX = 1;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 15_000;

const TABLE_METADATA = {
  accommodation_requests: { schema: "public" },
  users: { schema: "auth" },
  app_admins: { schema: "public" },
  allergens: { schema: "public" },
  change_logs: { schema: "public", jsonColumns: ["changes", "photos"] },
  diet_allergen_conflicts: { schema: "public" },
  diets: { schema: "public" },
  dish_ingredient_allergens: { schema: "public" },
  dish_ingredient_diets: { schema: "public" },
  dish_ingredient_rows: { schema: "public" },
  feedback_email_queue: { schema: "public" },
  help_kb: { schema: "public" },
  ingredient_catalog_entries: {
    schema: "public",
    jsonColumns: ["metadata"],
  },
  ingredient_scan_appeals: { schema: "public" },
  menu_snapshots: { schema: "public", jsonColumns: ["dishes_json"] },
  order_feedback: { schema: "public" },
  product_issue_reports: { schema: "public", jsonColumns: ["analysis_details"] },
  restaurant_direct_messages: { schema: "public" },
  restaurant_managers: { schema: "public" },
  restaurant_menu_dishes: {
    schema: "public",
    jsonColumns: [
      "details_json",
      "removable_json",
      "ingredients_blocking_diets_json",
      "payload_json",
    ],
  },
  restaurant_menu_ingredient_brand_items: {
    schema: "public",
    jsonColumns: ["brand_payload"],
  },
  restaurant_menu_ingredient_rows: {
    schema: "public",
    jsonColumns: ["ingredient_payload"],
  },
  restaurant_menu_pages: { schema: "public" },
  restaurant_write_batches: { schema: "public", jsonColumns: ["review_summary"] },
  restaurant_write_ops: { schema: "public", jsonColumns: ["operation_payload"] },
  restaurants: { schema: "public" },
  tablet_orders: { schema: "public", jsonColumns: ["payload"] },
};

function asText(value) {
  return String(value ?? "").trim();
}

function toSafeInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.floor(numeric));
}

function isDatabaseConfigured() {
  return asText(process.env.DATABASE_URL).length > 0 || asText(process.env.DIRECT_URL).length > 0;
}

function resolveConnectionString({ preferDirect = false } = {}) {
  const pooled = asText(process.env.DATABASE_URL);
  const direct = asText(process.env.DIRECT_URL);
  const connectionString = preferDirect ? direct || pooled : pooled || direct;
  if (!connectionString) {
    throw new Error(MISSING_DATABASE_URL_MESSAGE);
  }
  return connectionString;
}

function shouldUseSsl(connectionString) {
  try {
    const parsed = new URL(connectionString);
    const sslMode = parsed.searchParams.get("sslmode");
    const ssl = parsed.searchParams.get("ssl");
    return sslMode === "require" || ssl === "true" || parsed.hostname.includes("supabase.com");
  } catch {
    return false;
  }
}

function sanitizeConnectionStringForPool(connectionString, { useCustomSsl = false } = {}) {
  if (!useCustomSsl) return connectionString;

  try {
    const parsed = new URL(connectionString);
    [
      "ssl",
      "sslmode",
      "sslcert",
      "sslkey",
      "sslrootcert",
    ].forEach((key) => parsed.searchParams.delete(key));
    return parsed.toString();
  } catch {
    return connectionString;
  }
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, "\"\"")}"`;
}

function quoteQualifiedTable(tableName) {
  const table = TABLE_METADATA[tableName];
  if (!table) {
    throw new Error(`Unknown table metadata for ${tableName}.`);
  }
  return `${quoteIdentifier(table.schema)}.${quoteIdentifier(tableName)}`;
}

function getJsonColumns(tableName) {
  const table = TABLE_METADATA[tableName];
  return new Set(Array.isArray(table?.jsonColumns) ? table.jsonColumns : []);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function normalizeWhereInput(where) {
  if (!isPlainObject(where)) return where;
  const entries = Object.entries(where);
  if (entries.length !== 1) return where;
  const [key, value] = entries[0];
  if (key === "OR" || key === "AND") return where;
  if (!isPlainObject(value)) return where;
  if (
    Object.prototype.hasOwnProperty.call(value, "in") ||
    Object.prototype.hasOwnProperty.call(value, "not")
  ) {
    return where;
  }
  return value;
}

function normalizeSelect(select) {
  const fields = Object.entries(select || {})
    .filter(([, enabled]) => enabled === true)
    .map(([field]) => field);
  return fields.length ? fields : ["*"];
}

function normalizeOrderBy(orderBy) {
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
  return entries
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      return Object.entries(entry)
        .map(([field, direction]) => ({
          field,
          direction: asText(direction).toUpperCase() === "DESC" ? "DESC" : "ASC",
        }))
        .filter((normalizedEntry) => normalizedEntry.field);
    });
}

function serializeColumnValue(tableName, column, value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (getJsonColumns(tableName).has(column)) {
    return JSON.stringify(value);
  }
  return value;
}

function buildConditionSql({
  tableName,
  key,
  value,
  params,
}) {
  if (key === "OR" || key === "AND") {
    const operator = key;
    const parts = (Array.isArray(value) ? value : [])
      .map((entry) => buildWhereClause(tableName, entry, params))
      .filter(Boolean);
    if (!parts.length) return "";
    return `(${parts.join(` ${operator} `)})`;
  }

  const column = quoteIdentifier(key);
  if (value === null) {
    return `${column} IS NULL`;
  }

  if (isPlainObject(value)) {
    if (Object.prototype.hasOwnProperty.call(value, "in")) {
      const values = Array.isArray(value.in) ? value.in.filter((item) => item !== undefined) : [];
      if (!values.length) return "FALSE";
      const placeholders = values.map((item) => {
        params.push(serializeColumnValue(tableName, key, item));
        return `$${params.length}`;
      });
      return `${column} IN (${placeholders.join(", ")})`;
    }

    if (Object.prototype.hasOwnProperty.call(value, "not")) {
      if (value.not === null) {
        return `${column} IS NOT NULL`;
      }
      params.push(serializeColumnValue(tableName, key, value.not));
      return `${column} IS DISTINCT FROM $${params.length}`;
    }
  }

  params.push(serializeColumnValue(tableName, key, value));
  return `${column} = $${params.length}`;
}

function buildWhereClause(tableName, where, params) {
  const normalizedWhere = normalizeWhereInput(where);
  if (!normalizedWhere || typeof normalizedWhere !== "object" || Array.isArray(normalizedWhere)) {
    return "";
  }
  const parts = Object.entries(normalizedWhere)
    .map(([key, value]) => buildConditionSql({ tableName, key, value, params }))
    .filter(Boolean);
  return parts.length ? parts.join(" AND ") : "";
}

function buildInsertParts(tableName, data) {
  const entries = Object.entries(data || {}).filter(([, value]) => value !== undefined);
  if (!entries.length) {
    throw new Error(`Cannot insert into ${tableName} without data.`);
  }

  const params = [];
  const columns = entries.map(([column]) => quoteIdentifier(column));
  const placeholders = entries.map(([column, value]) => {
    params.push(serializeColumnValue(tableName, column, value));
    const jsonCast = getJsonColumns(tableName).has(column) ? "::jsonb" : "";
    return `$${params.length}${jsonCast}`;
  });

  return { columns, placeholders, params };
}

function buildInsertStatement(tableName, data, { returning = "*" } = {}) {
  const { columns, placeholders, params } = buildInsertParts(tableName, data);

  return {
    text: `
      INSERT INTO ${quoteQualifiedTable(tableName)} (${columns.join(", ")})
      VALUES (${placeholders.join(", ")})
      RETURNING ${returning}
    `,
    params,
  };
}

function buildUpdateStatement(tableName, where, data, { returning = "*" } = {}) {
  const params = [];
  const assignments = Object.entries(data || {})
    .filter(([, value]) => value !== undefined)
    .map(([column, value]) => {
      if (
        isPlainObject(value) &&
        Object.prototype.hasOwnProperty.call(value, "increment")
      ) {
        params.push(Number(value.increment) || 0);
        return `${quoteIdentifier(column)} = COALESCE(${quoteIdentifier(column)}, 0) + $${params.length}`;
      }

      params.push(serializeColumnValue(tableName, column, value));
      const jsonCast = getJsonColumns(tableName).has(column) ? "::jsonb" : "";
      return `${quoteIdentifier(column)} = $${params.length}${jsonCast}`;
    });

  if (!assignments.length) {
    throw new Error(`Cannot update ${tableName} without data.`);
  }

  const whereClause = buildWhereClause(tableName, where, params);
  if (!whereClause) {
    throw new Error(`Cannot update ${tableName} without a WHERE clause.`);
  }

  return {
    text: `
      UPDATE ${quoteQualifiedTable(tableName)}
      SET ${assignments.join(", ")}
      WHERE ${whereClause}
      RETURNING ${returning}
    `,
    params,
  };
}

function buildUpsertStatement(tableName, where, createData, updateData, { returning = "*" } = {}) {
  const normalizedWhere = normalizeWhereInput(where);
  if (!isPlainObject(normalizedWhere)) {
    throw new Error(`Cannot upsert ${tableName} without a unique WHERE clause.`);
  }

  const uniqueColumns = Object.entries(normalizedWhere)
    .filter(([, value]) => value !== undefined)
    .map(([column]) => column);
  if (!uniqueColumns.length) {
    throw new Error(`Cannot upsert ${tableName} without conflict columns.`);
  }

  const mergedCreateData = {
    ...(createData || {}),
    ...normalizedWhere,
  };
  const safeUpdateData = Object.entries(updateData || {}).reduce((acc, [column, value]) => {
    if (value !== undefined) {
      acc[column] = value;
    }
    return acc;
  }, {});

  if (!Object.keys(mergedCreateData).length) {
    throw new Error(`Cannot upsert ${tableName} without create data.`);
  }

  const insert = buildInsertParts(tableName, mergedCreateData);
  const params = [...insert.params];
  const updateAssignments = Object.entries(safeUpdateData).map(([column, value]) => {
    if (
      isPlainObject(value) &&
      Object.prototype.hasOwnProperty.call(value, "increment")
    ) {
      params.push(Number(value.increment) || 0);
      return `${quoteIdentifier(column)} = COALESCE(${quoteIdentifier(tableName)}.${quoteIdentifier(column)}, 0) + $${params.length}`;
    }

    params.push(serializeColumnValue(tableName, column, value));
    const jsonCast = getJsonColumns(tableName).has(column) ? "::jsonb" : "";
    return `${quoteIdentifier(column)} = $${params.length}${jsonCast}`;
  });

  const conflictTarget = uniqueColumns.map((column) => quoteIdentifier(column)).join(", ");
  const updateSql = updateAssignments.length
    ? `DO UPDATE SET ${updateAssignments.join(", ")}`
    : "DO NOTHING";

  return {
    text: `
      INSERT INTO ${quoteQualifiedTable(tableName)} (${insert.columns.join(", ")})
      VALUES (${insert.placeholders.join(", ")})
      ON CONFLICT (${conflictTarget})
      ${updateSql}
      RETURNING ${returning}
    `,
    params,
  };
}

function createTableClient({ tableName, executor }) {
  return {
    async findMany(options = {}) {
      const params = [];
      const select = normalizeSelect(options.select);
      const whereClause = buildWhereClause(tableName, options.where, params);
      const orderBy = normalizeOrderBy(options.orderBy);
      const limit =
        Number.isFinite(Number(options.take)) && Number(options.take) > 0
          ? ` LIMIT ${Math.floor(Number(options.take))}`
          : "";
      const offset =
        Number.isFinite(Number(options.skip)) && Number(options.skip) > 0
          ? ` OFFSET ${Math.floor(Number(options.skip))}`
          : "";
      const orderSql = orderBy.length
        ? ` ORDER BY ${orderBy.map((entry) => `${quoteIdentifier(entry.field)} ${entry.direction}`).join(", ")}`
        : "";
      const whereSql = whereClause ? ` WHERE ${whereClause}` : "";

      const result = await executor.query(
        `
          SELECT ${select[0] === "*" ? "*" : select.map((field) => quoteIdentifier(field)).join(", ")}
          FROM ${quoteQualifiedTable(tableName)}
          ${whereSql}
          ${orderSql}
          ${limit}
          ${offset}
        `,
        params,
      );
      return result.rows;
    },

    async findFirst(options = {}) {
      const rows = await this.findMany({ ...options, take: 1 });
      return rows[0] || null;
    },

    async findUnique(options = {}) {
      const rows = await this.findMany({ ...options, take: 1 });
      return rows[0] || null;
    },

    async upsert(options = {}) {
      const select = normalizeSelect(options.select);
      const { text, params } = buildUpsertStatement(
        tableName,
        options.where,
        options.create,
        options.update,
        {
          returning:
            select[0] === "*" ? "*" : select.map((field) => quoteIdentifier(field)).join(", "),
        },
      );
      const result = await executor.query(text, params);
      return result.rows[0] || null;
    },

    async create(options = {}) {
      const select = normalizeSelect(options.select);
      const { text, params } = buildInsertStatement(tableName, options.data, {
        returning:
          select[0] === "*" ? "*" : select.map((field) => quoteIdentifier(field)).join(", "),
      });
      const result = await executor.query(text, params);
      return result.rows[0] || null;
    },

    async createMany(options = {}) {
      const rows = Array.isArray(options.data) ? options.data : [];
      let count = 0;
      for (const row of rows) {
        const { text, params } = buildInsertStatement(tableName, row, { returning: "1" });
        const result = await executor.query(text, params);
        count += Number(result.rowCount || 0);
      }
      return { count };
    },

    async update(options = {}) {
      const select = normalizeSelect(options.select);
      const { text, params } = buildUpdateStatement(tableName, options.where, options.data, {
        returning:
          select[0] === "*" ? "*" : select.map((field) => quoteIdentifier(field)).join(", "),
      });
      const result = await executor.query(text, params);
      return result.rows[0] || null;
    },

    async deleteMany(options = {}) {
      const params = [];
      const whereClause = buildWhereClause(tableName, options.where || {}, params);
      const whereSql = whereClause ? ` WHERE ${whereClause}` : "";
      const result = await executor.query(
        `
          DELETE FROM ${quoteQualifiedTable(tableName)}
          ${whereSql}
        `,
        params,
      );
      return { count: Number(result.rowCount || 0) };
    },

    async delete(options = {}) {
      const params = [];
      const whereClause = buildWhereClause(tableName, options.where || {}, params);
      if (!whereClause) {
        throw new Error(`Cannot delete from ${tableName} without a WHERE clause.`);
      }
      const result = await executor.query(
        `
          DELETE FROM ${quoteQualifiedTable(tableName)}
          WHERE ${whereClause}
          RETURNING *
        `,
        params,
      );
      return result.rows[0] || null;
    },
  };
}

function createExecutor({ client = null, preferDirect = false } = {}) {
  return {
    async query(text, params = []) {
      if (client) {
        return await client.query(text, params);
      }
      const pool = getPool({ preferDirect });
      return await pool.query(text, params);
    },
    client,
    preferDirect,
  };
}

function createDatabaseFacade({ client = null, preferDirect = false } = {}) {
  const executor = createExecutor({ client, preferDirect });

  return new Proxy(
    {
      async $queryRawUnsafe(text, ...params) {
        const result = await executor.query(text, params);
        return result.rows;
      },

      async $executeRawUnsafe(text, ...params) {
        const result = await executor.query(text, params);
        return Number(result.rowCount || 0);
      },

      async $transaction(callback, options = {}) {
        if (client) {
          return await callback(createDatabaseFacade({ client, preferDirect }));
        }
        return await runInTransaction(callback, { ...options, preferDirect });
      },

      async $disconnect() {
        if (client) return;
        await closeAllDatabaseConnections();
      },
    },
    {
      get(target, property) {
        if (property in target) {
          return target[property];
        }

        if (typeof property === "string" && Object.prototype.hasOwnProperty.call(TABLE_METADATA, property)) {
          return createTableClient({ tableName: property, executor });
        }

        return undefined;
      },
    },
  );
}

function getPool({ preferDirect = false } = {}) {
  const rawConnectionString = resolveConnectionString({ preferDirect });
  const useCustomSsl = shouldUseSsl(rawConnectionString);
  const connectionString = sanitizeConnectionStringForPool(rawConnectionString, {
    useCustomSsl,
  });
  const max = toSafeInteger(process.env.DB_POOL_MAX, DEFAULT_POOL_MAX);
  const poolKey = `${preferDirect ? "direct" : "pooled"}:${connectionString}:${max}`;
  if (!globalForDatabase.__clarivoreDbPools) {
    globalForDatabase.__clarivoreDbPools = new Map();
  }
  const pools = globalForDatabase.__clarivoreDbPools;
  if (pools.has(poolKey)) {
    return pools.get(poolKey);
  }

  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: DEFAULT_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: DEFAULT_CONNECTION_TIMEOUT_MS,
    ssl: useCustomSsl ? { rejectUnauthorized: false } : undefined,
  });
  pools.set(poolKey, pool);
  return pool;
}

export async function queryRows(text, params = [], options = {}) {
  const executor = createExecutor(options);
  const result = await executor.query(text, params);
  return result.rows;
}

export async function execute(text, params = [], options = {}) {
  const executor = createExecutor(options);
  const result = await executor.query(text, params);
  return Number(result.rowCount || 0);
}

export async function runInTransaction(callback, options = {}) {
  const pool = getPool({ preferDirect: options.preferDirect });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (Number.isFinite(Number(options.timeout)) && Number(options.timeout) > 0) {
      await client.query("SELECT set_config('statement_timeout', $1, true)", [
        String(Math.floor(Number(options.timeout))),
      ]);
    }
    if (Number.isFinite(Number(options.lockTimeout)) && Number(options.lockTimeout) > 0) {
      await client.query("SELECT set_config('lock_timeout', $1, true)", [
        String(Math.floor(Number(options.lockTimeout))),
      ]);
    }

    const tx = createDatabaseFacade({ client, preferDirect: options.preferDirect });
    const result = await callback(tx);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failures; the original error is more useful.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closeAllDatabaseConnections() {
  const pools = globalForDatabase.__clarivoreDbPools;
  if (!pools || !(pools instanceof Map) || pools.size === 0) return;

  const closing = Array.from(pools.values()).map((pool) => pool.end().catch(() => {}));
  pools.clear();
  await Promise.all(closing);
}

export function getMissingDatabaseUrlMessage() {
  return MISSING_DATABASE_URL_MESSAGE;
}

export function createDatabaseClient(options = {}) {
  return createDatabaseFacade(options);
}

export const db = createDatabaseFacade();
export { isDatabaseConfigured };
