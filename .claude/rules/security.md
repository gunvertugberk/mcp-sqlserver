# Security Rules

This module is the project's main value proposition. Every rule here is load-bearing — SQL injection in an MCP server can compromise entire production databases.

## The two-rule SQL injection defense

Every SQL statement in this project has two kinds of interpolation and two corresponding defenses:

### 1. User-supplied values → `@param` bindings

```ts
// ✅ CORRECT
await executeQuery(
  connection,
  `SELECT * FROM sys.tables WHERE name = @table AND schema_id = @sid`,
  { table, sid: schemaId },
  serverName
);

// ❌ WRONG — never do this
await executeQuery(
  connection,
  `SELECT * FROM sys.tables WHERE name = '${table}'`,
  undefined,
  serverName
);
```

The `params` arg (3rd arg to `executeQuery`) forwards to `mssql.Request.input(name, value)`, which parameterizes the value safely through tedious. Types are inferred by the driver — don't worry about them.

### 2. User-supplied identifiers → `escapeIdentifier(name)`

Object names (database, schema, table, view, procedure, column, index) **cannot** be parameterized in T-SQL. For these, use `escapeIdentifier()` from `utils/security.ts`:

```ts
// ✅ CORRECT
const eDb = escapeIdentifier(db);
const eSch = escapeIdentifier(schema);
const eTable = escapeIdentifier(table);
await executeQuery(
  connection,
  `SELECT * FROM ${eDb}.${eSch}.${eTable}`,
  undefined,
  serverName
);

// ❌ WRONG
await executeQuery(connection, `SELECT * FROM [${db}].[${schema}].[${table}]`, ...);
// If table = "users]; DROP TABLE ..." this becomes "FROM [users]; DROP TABLE ...]".
```

`escapeIdentifier` wraps the name in `[...]` and doubles any `]` inside, which is SQL Server's documented escape for bracket-quoted identifiers. This is **not** generic string escaping — don't roll your own.

## Security modes

There are three modes. They cascade from most restrictive to least:

| Mode | SELECT | INSERT/UPDATE/DELETE | EXEC proc | DDL |
|---|---|---|---|---|
| `readonly`  | ✅ | ❌ | (list/describe only) | ❌ |
| `readwrite` | ✅ | ✅ | ✅ (execute) | ❌ |
| `admin`     | ✅ | ✅ | ✅ (execute) | ✅ |

The mode is enforced via two flags on `SecurityConfig`:

- `allowMutations` — controls DML (INSERT/UPDATE/DELETE/MERGE) and stored procedure execution.
- `allowDDL` — controls CREATE/ALTER/DROP/TRUNCATE.

`applyModeDefaults` sets these from `mode` unless the user explicitly overrode them in YAML. A user can say `mode: admin` + `allowDDL: false` and we respect it — **explicit overrides always win**.

## The security perimeter (`utils/security.ts`)

All enforcement is in one file so it can be audited in isolation. Don't spread these checks into tools — import from here.

### `validateQuery(sql, security)`
Throws `SecurityError` if:
- Any `blockedKeywords` entry (case-insensitive substring match) appears in the query.
- Query is DDL (`CREATE|ALTER|DROP|TRUNCATE`) and `allowDDL` is false.
- Query is DML (`INSERT|UPDATE|DELETE|MERGE`) and `allowMutations` is false.

Call it from every tool that executes user-provided SQL (`execute_query`, `execute_mutation`, `execute_ddl`).

**Known limitation**: substring matching. A comment like `-- SHUTDOWN` will false-positive. That's fine — we bias towards blocking over allowing.

### `isDatabaseAllowed(database, security)` / `isSchemaAllowed(schema, security)`
- If `allowedDatabases` is non-empty → the DB must be in it (whitelist wins).
- Else if `blockedDatabases` is non-empty → the DB must not be in it (blacklist).
- Else allow everything.

Same logic for schemas. **Whitelist beats blacklist** — if both are set, `allowedDatabases` is the only one that matters.

### `applyMasking(rows, tableName, rules)`
Runs after query execution, before formatting. Walks each row, matches each column against every rule's `pattern`, and replaces matched values with `rule.mask`.

Pattern syntax (see `matchesMaskPattern`):
- `column` — single component, column name only (exact, case-insensitive)
- `table.column` or `*.column` — 2 components, table (substring) + column (exact or `*`)
- `schema.table.column` — 3 components, same as 2-component but schema ignored in matching

Call it from any tool that returns table rows to the user. Don't call it from schema-discovery tools that return metadata.

### `ensureRowLimit(sql, maxRowCount)`
Inserts `TOP (n)` after the leading `SELECT` / `SELECT DISTINCT`. Skips the query if:
- It already has a `TOP` clause.
- It starts with `WITH` (CTE — adding TOP to the CTE body is wrong; user controls the final SELECT).
- It isn't a SELECT at all.

Not a hard limit — a sufficiently clever query can still return more. Combine with `queryTimeout` and DB-side row governor for belt-and-suspenders.

## Per-server security

In multi-server mode, every server in `config.connections` can override any field of `SecurityConfig`. The loader deep-merges `fileConfig.security` (global) with the per-server block. A prod server can run `readonly` + `maxRowCount: 500` while dev runs `admin` + `maxRowCount: 5000` in the same process.

When a tool calls `resolveServer(config, srv)`, the returned `security` is the resolved per-server config, not the global. **Always use the returned `security`, never `config.servers[name].security` directly.**

## Blocked keywords default list

```
xp_cmdshell, SHUTDOWN, DROP DATABASE, RECONFIGURE, sp_configure
```

Users can override via `security.blockedKeywords` in YAML. If you want to add a new default, do it in `DEFAULT_SECURITY` in `config.ts`, add a test-by-hand note in `workflow.md`, and call it out in CHANGELOG.

## Don't do this

- ❌ Validate input in the tool handler, then call `executeQuery` from two different places — centralize.
- ❌ Skip `validateQuery` "because I already check the query type with a regex". The regex is for *routing*; `validateQuery` is for *enforcement*.
- ❌ Accept a `sql` parameter in a new tool and pass it to `executeQuery` without going through `validateQuery` + `ensureRowLimit`.
- ❌ Log user-provided SQL values at `console.error`. Logs are not a secure sink — treat them as semi-public.
- ❌ Add a "trusted bypass" flag that lets specific tools skip the security perimeter. There is no such thing as a trusted caller here — the MCP client is the threat model.
