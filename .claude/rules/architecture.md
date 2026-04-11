# Architecture

How the MCP server is wired, top to bottom. Read this before refactoring any module.

## Layers

```
┌─────────────────────────────────────────┐
│  index.ts                               │  CLI entry
│  - Parses argv: --config, --http, -h    │
│  - Calls loadConfig()                    │
│  - Builds server via createServer()      │
│  - Wires transport (stdio or HTTP)       │
│  - Handles SIGINT/SIGTERM → closePool()  │
└─────────────────────┬───────────────────┘
                      ▼
┌─────────────────────────────────────────┐
│  server.ts :: createServer(config)       │  Tool registration
│  - Instantiates McpServer                │
│  - Registers list_servers inline         │
│  - Calls each tools/*.ts register fn     │
└─────────────────────┬───────────────────┘
                      ▼
┌─────────────────────────────────────────┐
│  tools/*.ts :: register*Tools()          │  Tool handlers
│  - Per tool: server.tool(name, desc,     │
│    zodSchema, handler)                    │
│  - Handler flow: resolveServer →         │
│    gate → executeQuery → format          │
└─────────────────────┬───────────────────┘
                      ▼
┌───────────────┬─────────────────────────┐
│  config.ts    │  database.ts            │  Services
│  - AppConfig  │  - Pool per serverName  │
│  - loadConfig │  - buildSqlConfig       │
│  - resolve    │  - executeQuery         │
│    Server     │  - closePool            │
└───────────────┴─────────┬───────────────┘
                          ▼
┌─────────────────────────────────────────┐
│  utils/security.ts  utils/formatter.ts  │  Cross-cutting
│  - escapeIdentifier  - formatResultSet  │
│  - validateQuery     - formatResultSetJson│
│  - isDatabaseAllowed - ISO date handling│
│  - isSchemaAllowed                       │
│  - applyMasking                          │
│  - ensureRowLimit                        │
│  - SecurityError                         │
└─────────────────────────────────────────┘
```

## Module responsibilities

### `src/index.ts`
- The **only** file that touches `process.argv`, `process.env` (outside config loading), and transport wiring.
- Knows nothing about tools.
- Handles both transports:
  - **stdio** (default) — for Claude Desktop, VS Code, Cursor, etc.
  - **Streamable HTTP** (`--http <port>`) — with CORS headers, `/mcp` and `/health` endpoints.
- Registers `SIGINT`/`SIGTERM` → `closePool()` → `process.exit(0)`.

### `src/server.ts`
- Exports **one function**: `createServer(config: AppConfig): McpServer`.
- Inlines the `list_servers` tool because it reads `config` directly (other tools flow through `resolveServer`).
- Calls each `tools/*.ts` register function in a fixed order:
  1. `registerSchemaTools` (always)
  2. `registerQueryTools` (always)
  3. `registerDDLTools` — **conditionally**, only if some server in config allows DDL (`allowDDL` or `mode: admin`). Inner handler still re-checks per-server.
  4. `registerProcedureTools` (always — handler checks `allowMutations`)
  5. `registerPerformanceTools` (always — read-only DMVs)
  6. `registerUtilityTools` (always)
  7. `registerDBATools` (always)

### `src/config.ts`
- Owns all configuration types and loading logic. See `config-and-servers.md` for details.
- Exports: `AppConfig`, `ServerEntry`, `ConnectionConfig`, `SecurityConfig`, `MaskRule`, `AuthType`, `SecurityMode`, `loadConfig`, `resolveServer`.
- No tool code should import `fs`, `yaml`, or `process.env` directly — always go through here.

### `src/database.ts`
- Owns connection pool lifecycle. One `mssql.ConnectionPool` per `serverName`, stored in a module-level `Map`.
- `getPool(config, serverName)` returns cached pool or creates + connects.
- `executeQuery(config, sql, params?, serverName?)` is the **only** place tools should run SQL.
- `closePool(serverName?)` — close one or all. Called on shutdown.

### `src/tools/*.ts`
- Each exports `register*Tools(server, config)`. No default exports.
- Files group tools by concern: schema discovery, query, DDL, procedures, performance, DBA, utilities.
- **All tool handlers are async.** They must resolve with `{ content: [...], isError? }` — never throw to the MCP transport.

### `src/utils/security.ts`
- Pure functions. No I/O. No imports from `tools/` or `database.ts`.
- This is the security perimeter — keep it dependency-free and easy to audit.

### `src/utils/formatter.ts`
- Pure formatting. Converts `mssql.IResult` to human-readable markdown tables or structured JSON.
- Dates → ISO format (`2025-01-27` or `2025-01-27 14:30:00`), never raw JS Date.

## Request lifecycle (what happens when a tool is called)

```
MCP client sends tool call
  └─► McpServer dispatches to handler
       └─► Handler:
            1. const { connection, security, serverName } = resolveServer(config, srv)
            2. Gate: isDatabaseAllowed / isSchemaAllowed (if applicable)
            3. Gate: validateQuery (for execute_query / execute_mutation / execute_ddl)
            4. Transform: ensureRowLimit (for SELECT)
            5. executeQuery(connection, sql, params, serverName)
            6. Transform: applyMasking (if maskColumns configured)
            7. Format: formatResultSet(result)
            8. Return: { content: [{ type: "text", text }], isError? }
```

If any step throws, the handler's `try/catch` converts it to an error response with `isError: true`.

## Why DDL registration is conditional

`registerDDLTools` is wrapped in a check (`anyDDL`) so that in a pure read-only deployment, the `execute_ddl` tool isn't even advertised to the MCP client. This reduces attack surface — the client literally cannot call a tool that doesn't exist in the registry. Inner per-server checks still fire, because a client could target a read-only server even when another server in the same config allows DDL.

## Don't break these invariants

- `createServer` must remain **synchronous in terms of config**. It doesn't open connections — pools are lazy via `getPool`.
- Tools must **not** capture `connection` or `security` at registration time. Always call `resolveServer` inside the handler, because the user may pass `server: "prod"` to target a different entry.
- `closePool` must be **idempotent** and must not throw on already-closed pools — it's called from shutdown signals.
