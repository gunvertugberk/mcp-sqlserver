# Tool Authoring

How to add or modify an MCP tool. Follow this exactly — inconsistency here leaks into every client that uses the server.

## Where tools live

| Category | File |
|---|---|
| Schema discovery (read-only metadata) | `src/tools/schema.ts` |
| SELECT / DML queries | `src/tools/query.ts` |
| DDL (CREATE / ALTER / DROP) | `src/tools/ddl.ts` |
| Stored procedures | `src/tools/procedure.ts` |
| Query plans, DMV-based perf | `src/tools/performance.ts` |
| Wait stats, deadlocks, backups, health | `src/tools/dba.ts` |
| Schema diff, code gen, sampling, export | `src/tools/utility.ts` |
| Meta (`list_servers`) | `src/server.ts` (inline) |

**Pick the right file by intent**, not by SQL shape. A tool that runs a SELECT but is really about *performance diagnostics* belongs in `performance.ts`, not `query.ts`.

## The canonical pattern

```ts
// Inside register*Tools(server, config)
server.tool(
  "tool_name",                                    // snake_case, matches README table
  "One-line description. No trailing period.",    // shown to the AI client
  {
    // Zod schema — keep params minimal and describe each
    table: z.string().describe("Table name"),
    schema: z.string().optional().describe("Schema name (default: dbo)"),
    database: z
      .string()
      .optional()
      .describe("Database name (uses connection default if omitted)"),
    server: z
      .string()
      .optional()
      .describe("Target server name (uses default if omitted)"),
  },
  async ({ table, schema, database, server: srv }) => {
    try {
      const { connection, security, serverName } = resolveServer(config, srv);
      const db = database ?? connection.database;
      const sch = schema ?? "dbo";

      // Security gates (only the ones that apply)
      if (!isDatabaseAllowed(db, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }
      if (!isSchemaAllowed(sch, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to schema: ${sch}` }] };
      }

      const eDb = escapeIdentifier(db);

      // Parameterize everything. Object names → escapeIdentifier. Values → @param.
      const result = await executeQuery(
        connection,
        `SELECT ... FROM ${eDb}.sys.tables WHERE name = @table`,
        { table },
        serverName
      );

      return { content: [{ type: "text" as const, text: formatResultSet(result) }] };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);
```

## Non-negotiable checklist

Before the tool is considered done, confirm **every** item:

- [ ] Name is `snake_case` and unique across the whole server.
- [ ] Description is a single clear sentence (no markdown, no trailing period).
- [ ] Zod schema is minimal. Every optional param has a `.describe(...)`.
- [ ] Tool accepts an optional `server` parameter (destructured as `server: srv`).
- [ ] Handler calls `resolveServer(config, srv)` as the first line of its `try` block.
- [ ] Any database/schema coming from user input is gated via `isDatabaseAllowed` / `isSchemaAllowed` **before** any `executeQuery`.
- [ ] Any SQL touching user-supplied identifiers uses `escapeIdentifier(...)`.
- [ ] Any SQL touching user-supplied values uses `@param` + the `params` arg of `executeQuery`.
- [ ] For mutations: `validateQuery` is called, and `allowMutations`/`allowDDL` is verified.
- [ ] For SELECT: `ensureRowLimit(sql, security.maxRowCount)` is applied.
- [ ] Handler is wrapped in `try/catch`; errors return `{ content: [...], isError: true }`.
- [ ] Output uses `formatResultSet(result)` unless the tool *intentionally* produces custom markdown (e.g., ER diagrams, code gen).
- [ ] The register function is called from `createServer` in `src/server.ts`.
- [ ] Comment header uses the `// ─── tool_name ───` divider style.
- [ ] Masking: if the tool returns table rows, pass them through `applyMasking(rows, tableName, security.maskColumns)` when relevant.
- [ ] README tool table is updated (right category section).
- [ ] CHANGELOG.md has a new entry under the upcoming version.

## Special cases

### Tools that target multiple databases in one call
`compare_schemas` is the archetype. The rule: gate **each** database through `isDatabaseAllowed` before the first query, not just one of them.

### Tools that need `USE <db>` context
Prefer prefixing the schema with an escaped db identifier (`${eDb}.sys.tables`) over `USE ${eDb}; ...`. When you must use `USE`, run it in a **separate** `executeQuery` call — batches that mix `USE` with other statements behave subtly. See `get_query_plan` for the precedent with `SET SHOWPLAN_TEXT`.

### Tools that return non-tabular output
Code gen, ER diagrams, procedure source: return a markdown string wrapped in a code fence with the correct language tag. Don't reach for `formatResultSet` just to be consistent — it produces tables.

### Tools that execute user-provided SQL
`execute_query`, `execute_mutation`, `execute_ddl`. These **must**:
1. Regex-check the query type matches the tool's intent.
2. Call `validateQuery(sql, security)` — this enforces blocked keywords and DDL/DML mode gates.
3. For SELECT: wrap with `ensureRowLimit`.
4. Never bypass the security perimeter "just to make it work".

### Tools that register conditionally
If a tool should only exist when a specific config flag is set (like DDL tools), do the check in `server.ts` around the `register*Tools` call, and also re-check inside the handler. Double-gate: advertised only when allowed, still refused per-server.

## Don't do this

- ❌ `WHERE name = '${userInput}'` — use `@name` + params.
- ❌ `FROM ${database}.sys.tables` without `escapeIdentifier(database)` first.
- ❌ Capturing `connection` from `config.servers.default` at registration time instead of calling `resolveServer` in the handler.
- ❌ `throw new Error(...)` inside a handler. Use `return { isError: true, ... }`.
- ❌ Mixing snake_case and camelCase tool names. Everything is snake_case.
- ❌ Adding a tool without updating README and CHANGELOG. Undocumented tools rot.

## After editing

Run `npm run build && npm test` before committing. See `workflow.md` for manual verification against a live instance.
