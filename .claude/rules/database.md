# Database & Pooling

How `src/database.ts` manages connection pools and translates `ConnectionConfig` into the shape `mssql` wants. Read this before touching authentication or pool logic.

## One pool per server name

```ts
const pools = new Map<string, sql.ConnectionPool>();
```

- Keyed by `serverName` (not host, not database). Two servers pointing at the same host still get separate pools — intentional, because they may have different auth, db, or security contexts.
- Pools are **lazy**. `createServer` doesn't open anything; the first `executeQuery` call creates and connects the pool for that server.
- `getPool(config, serverName)` returns cached pool if `connected`, otherwise creates a new one, registers an error handler, and awaits `connect()`.
- On pool error, the handler deletes the entry so the next call builds a fresh one.

### Why not auto-reconnect in the handler

The `on('error')` handler logs and removes the pool. It does **not** attempt reconnection. Doing so from inside an error callback is risky (reentrancy, stacking retries). Let the next `getPool` call do the work naturally.

## `executeQuery(config, sql, params?, serverName?)`

The **only** SQL execution entry point. All tools go through it.

```ts
export async function executeQuery(
  config: ConnectionConfig,
  query: string,
  params?: Record<string, unknown>,
  serverName: string = "default"
): Promise<sql.IResult<any>>
```

- `config` is the per-server `ConnectionConfig` from `resolveServer`.
- `params` maps `@name` keys in the query to values. Values go through `request.input(key, value)` for safe parameterization. Don't prefix with `@` in the keys.
- `serverName` controls pool keying. **Pass it from `resolveServer`** — don't default to `"default"` unless you really mean single-server mode.

### Why no statement-level transactions yet
`mssql` supports transactions via `Transaction` objects, but no current tool needs them. If you add one (e.g., a multi-step DDL migration tool), create the transaction locally in the tool handler — don't add it to the shared `executeQuery` API. Keep `executeQuery` as a thin wrapper.

## Authentication paths (`buildSqlConfig`)

One function, four branches based on `config.authentication.type`:

### `sql`
```ts
base.user = config.authentication.user;
base.password = config.authentication.password;
```
Plain old SQL Server auth. The simplest case — works everywhere.

### `windows` with explicit credentials → NTLM
```ts
base.authentication = {
  type: "ntlm",
  options: { domain, userName, password },
};
```
Uses tedious's built-in NTLM. No extra packages. Works on Linux/macOS. The `domain` field defaults to `""` if omitted — some SQL servers accept that, some don't.

### `windows` without credentials → SSPI / Integrated Security
Requires the optional `msnodesqlv8` package. If it's missing:
```ts
throw new Error(
  "Windows Authentication (SSPI) without credentials requires 'msnodesqlv8'. ..."
);
```
When present, it switches to an ODBC-style `connectionString` and clears `server`/`port`/`database` on the base object — `msnodesqlv8` reads only from `connectionString`.

**SSPI quirk**: when running via `npx`, optional dependencies aren't always installed. For SSPI users, recommend a global install (`npm install -g @tugberkgunver/mcp-sqlserver msnodesqlv8`) or NTLM instead.

### `azure-ad`
```ts
base.authentication = {
  type: "azure-active-directory-service-principal-secret",
  options: { clientId, clientSecret, tenantId },
};
```
Service principal only — interactive browser login is not supported (MCP servers run headless).

## Connection options we always set

```ts
options: {
  encrypt: config.encrypt,                       // default: false
  trustServerCertificate: config.trustServerCertificate, // default: true
}
```

**Why `trustServerCertificate: true` by default**: local dev with self-signed certs on SQL Express is the overwhelming use case. Users targeting Azure SQL or production with proper certs should set it to `false` in their config.

## Cross-database query pattern

Tools often need to query metadata across databases without changing connection context. The pattern:

```ts
const eDb = escapeIdentifier(db);
await executeQuery(
  connection,
  `SELECT * FROM ${eDb}.sys.tables WHERE ...`,
  params,
  serverName
);
```

This beats `USE ${eDb}; SELECT ...` because:
- No batch boundary issues.
- No pool state mutation (leaving the connection pointed at an unexpected DB for the next caller).
- `mssql` reuses connections across `request()` calls — `USE` leaks.

**Only use `USE`** when you genuinely need database context (e.g., `SET SHOWPLAN_TEXT ON` in `get_query_plan`), and do it in a separate `executeQuery` call. See `get_query_plan` for the pattern.

## `closePool(serverName?)`

- With a name → close just that pool.
- Without → close **all** pools and clear the map.
- Called from `index.ts` on `SIGINT`/`SIGTERM`.
- Must be idempotent — calling it twice must not throw. Currently safe because `pool.close()` on an already-closed pool is a no-op in `mssql`.

## Don't do this

- ❌ Call `new sql.ConnectionPool(...)` from anywhere except `getPool`.
- ❌ Cache a pool in a module-level variable outside the `pools` map.
- ❌ Open a connection in `createServer` / `registerXTools`. Pools are lazy — keep them that way.
- ❌ Pass a `serverName` you made up instead of one from `resolveServer`. The key must match what `getPool` stored.
- ❌ Close a pool from inside a tool handler. Lifecycle is owned by `index.ts`.
