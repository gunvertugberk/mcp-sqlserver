# mcp-sqlserver — Project Guide for Claude

This file tells Claude (and any AI assistant using Claude Code / MCP) how to work in this repo. Read it in full before making changes. For deeper rules, follow the links at the bottom — each file is a focused, bite-sized ruleset.

## What this project is

`@tugberkgunver/mcp-sqlserver` is a **Model Context Protocol (MCP) server for Microsoft SQL Server**. It exposes **38 tools** across 7 categories (schema discovery, query, DDL, stored procedures, performance, DBA diagnostics, developer utilities, server management) so AI assistants can talk to SQL Server with enterprise-grade security controls.

- **Package**: `@tugberkgunver/mcp-sqlserver` on npm
- **Repo**: `gunvertugberk/mcp-sqlserver` on GitHub
- **Current version**: see `package.json` (`version`) and `src/server.ts` (`McpServer` version string) — keep them in sync
- **License**: MIT

## Stack

- **Language**: TypeScript 5.8, `strict: true`
- **Runtime**: Node.js `>=18`
- **Module system**: Node16 ESM — **imports must use `.js` extension** even when importing `.ts` files (see `coding-standards.md`)
- **Target**: ES2022
- **Key deps**: `@modelcontextprotocol/sdk`, `mssql` (tedious), `yaml`, `zod`
- **Optional dep**: `msnodesqlv8` for Windows SSPI auth

## Commands

```bash
npm install          # install dependencies
npm run build        # tsc → dist/
npm run dev          # tsc --watch
npm start            # node dist/index.js (after build)
npm start -- --config ./mssql-mcp.yaml
npm start -- --http 3000
```

There is **no test framework** in this repo. Verification is manual — see `.claude/rules/workflow.md`.

## Directory map

```
src/
├── index.ts               # CLI entry: arg parsing, transport (stdio/http), graceful shutdown
├── server.ts              # createServer(config) — wires all tool groups, registers list_servers
├── config.ts              # AppConfig types, loadConfig(), resolveServer(), single+multi-server loading
├── database.ts            # Connection pool per serverName, buildSqlConfig() per auth type, executeQuery()
├── utils/
│   ├── security.ts        # escapeIdentifier, validateQuery, isDatabaseAllowed, isSchemaAllowed,
│   │                      # applyMasking, ensureRowLimit, SecurityError
│   └── formatter.ts       # formatResultSet (markdown), formatResultSetJson, ISO date handling
└── tools/
    ├── schema.ts          # 9 schema discovery tools
    ├── query.ts           # execute_query, execute_mutation
    ├── ddl.ts             # execute_ddl (admin / allowDDL only)
    ├── procedure.ts       # list_procedures, describe_procedure, execute_procedure
    ├── performance.ts     # query plans, active queries, table/index/server/db stats, missing indexes
    ├── dba.ts             # wait stats, deadlocks, blocking, backups, query store, rebuild index, health
    └── utility.ts         # compare_schemas, generate_code, ER diagram, sample/test data, export_query
```

## Golden rules — read these before editing any tool

1. **Never interpolate user input into SQL strings.** Use `@param` bindings (the 3rd arg of `executeQuery`) for values, and `escapeIdentifier()` for object names (database, schema, table, procedure, column). See `security.md`.
2. **Every tool must accept an optional `server` parameter** and resolve it via `resolveServer(config, srv)` — the multi-server contract in v1.3 depends on this. See `tool-authoring.md`.
3. **Gate every database/schema access** through `isDatabaseAllowed` / `isSchemaAllowed` before touching the DB. See `security.md`.
4. **Errors are returned, not thrown** from tool handlers: `{ content: [{ type: "text", text: "Error: ..." }], isError: true }`. See `coding-standards.md`.
5. **`git` default branch is `master`, not `main`.** Don't assume otherwise.
6. **Never commit `mssql-mcp.yaml` / `mssql-mcp.yml` / `.env`** — they contain credentials and are `.gitignore`d for a reason.

## Rule files (`.claude/rules/`)

Each file below is scoped to one concern and stays under ~200 lines. Open the relevant ones for the task you're doing — don't try to hold all of them in your head at once.

- **[architecture.md](.claude/rules/architecture.md)** — module responsibilities, tool registration flow, request lifecycle.
- **[tool-authoring.md](.claude/rules/tool-authoring.md)** — how to add/modify an MCP tool: boilerplate, checklist, where to register, README/CHANGELOG updates.
- **[security.md](.claude/rules/security.md)** — SQL injection protection, security modes, allow/block lists, data masking, row limits, parameterization rules.
- **[config-and-servers.md](.claude/rules/config-and-servers.md)** — `AppConfig` shape, config file search order, single vs multi-server format, env var overrides, mode defaults.
- **[database.md](.claude/rules/database.md)** — connection pool lifecycle, authentication types (SQL / NTLM / SSPI / Azure AD), cross-database query pattern, `executeQuery` usage.
- **[coding-standards.md](.claude/rules/coding-standards.md)** — Node16 ESM import rules, TypeScript conventions, error handling, Zod schemas, return shapes, comment style.
- **[workflow.md](.claude/rules/workflow.md)** — build / dev / start, versioning, CHANGELOG discipline, npm publish, manual verification, git branch.

## When the user asks you to do something

- **Adding a tool** → `tool-authoring.md` + `security.md` + the relevant `tools/*.ts` file. Prefer dispatching the `mcp-tool-creator` agent.
- **Changing auth / connection** → `database.md` + `config-and-servers.md`.
- **Changing security rules** → `security.md` + `config-and-servers.md`.
- **Refactoring module structure** → `architecture.md` first.
- **Release / version bump** → `workflow.md`.
- **Anything touching SQL** → `security.md` is non-negotiable.
- **Reviewing changes before commit** → run `mssql-security-reviewer` first, then `mssql-code-reviewer`.

## Project-specific agents (`.claude/agents/`)

- **`mcp-tool-creator`** — scaffolds a new MCP tool end-to-end (register block, security gates, README + CHANGELOG updates, build verify). Use when the user says "add a tool" or similar.
- **`mssql-security-reviewer`** — narrow, high-precision audit for SQL injection and security perimeter violations (missing `escapeIdentifier`, unparameterized values, skipped `validateQuery`, missing gates). Zero-false-positive bias. Does not modify files.
- **`mssql-code-reviewer`** — broad code review for logic, project conventions, missing README/CHANGELOG updates, dead code, naming. Explicitly defers security to `mssql-security-reviewer`. Does not modify files.

Pre-commit review flow: `mssql-security-reviewer` → `mssql-code-reviewer` → fix findings → commit.
