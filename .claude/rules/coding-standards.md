# Coding Standards

TypeScript, ESM, naming, error handling, and the style invariants that keep the codebase consistent.

## TypeScript configuration

```json
{
  "target": "ES2022",
  "module": "Node16",
  "moduleResolution": "Node16",
  "strict": true,
  "esModuleInterop": true
}
```

- **`strict: true` is non-negotiable.** Don't weaken it for convenience. Narrow types or use `z.infer` from Zod schemas instead of `any`.
- **Node16 module resolution** means imports behave like Node's ESM runtime.

## Import extensions — the ESM trap

Because of Node16 ESM, **every relative import must use the `.js` extension**, even when importing a `.ts` file:

```ts
// ✅ CORRECT
import { loadConfig } from "./config.js";
import { executeQuery } from "./database.js";
import { escapeIdentifier } from "../utils/security.js";
import { registerSchemaTools } from "./tools/schema.js";

// ❌ WRONG — will fail at runtime
import { loadConfig } from "./config";
import { loadConfig } from "./config.ts";
```

Package imports don't need the extension: `import { z } from "zod"` is fine.

TypeScript is configured to resolve `.js` → `.ts` at compile time, so this works with `tsc` without any tricks. If you see an `ERR_MODULE_NOT_FOUND` after build, the first thing to check is missing `.js` extensions.

## Naming

- **Files**: `kebab-case` or single word lowercase. Follow the existing files: `config.ts`, `database.ts`, `schema.ts`, `formatter.ts`.
- **Tool names** (MCP registration): `snake_case`. `list_tables`, `get_query_plan`, `compare_schemas`. Matches the tool tables in README.
- **Function names**: `camelCase`. Exports from tool files are always `register<Category>Tools`, e.g., `registerSchemaTools`.
- **Types and interfaces**: `PascalCase`. `AppConfig`, `ServerEntry`, `SecurityConfig`, `SecurityMode`.
- **Destructuring a param called `server`**: rename to `srv` to avoid shadowing the `server: McpServer` argument in the enclosing function.

## Error handling

### Tool handlers return errors, never throw

```ts
// ✅ CORRECT
try {
  // ... logic ...
  return { content: [{ type: "text" as const, text: formatResultSet(result) }] };
} catch (err: any) {
  return {
    content: [{ type: "text" as const, text: `Error: ${err.message}` }],
    isError: true,
  };
}
```

The MCP SDK forwards `isError: true` to the client as a proper tool error. Throwing bypasses that and surfaces as an unhelpful protocol error.

### Custom error types

- `SecurityError` (from `utils/security.ts`) — used when validation fails. It's still caught by the tool's `try/catch` and turned into an error response.
- For anything else, `Error` is fine. Don't proliferate custom error classes.

### Where to `throw`

Library-layer functions (`resolveServer`, `escapeIdentifier`, `validateQuery`, `buildSqlConfig`, `getPool`) throw. They don't know about MCP response shapes. The boundary is the tool handler — that's where throws become response errors.

## Return shapes

Every tool handler returns one of:

```ts
// Success
{ content: [{ type: "text" as const, text: "..." }] }

// Error
{ content: [{ type: "text" as const, text: "Error: ..." }], isError: true }

// Denied (soft error — not always set to isError: true, matches existing pattern)
{ content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] }
```

**`type: "text" as const`** is mandatory — the MCP SDK types require a literal `"text"`, and without `as const` TypeScript widens to `string` and the call won't compile.

Multi-content returns (e.g., returning multiple text blocks) are allowed but rarely needed. The existing code always uses a single text block with newlines.

## Zod schemas

```ts
{
  table: z.string().describe("Table name"),
  schema: z.string().optional().describe("Schema name (default: dbo)"),
  database: z.string().optional().describe("Database name (uses connection default if omitted)"),
  server: z.string().optional().describe("Target server name (uses default if omitted)"),
}
```

- Every field has a `.describe(...)`. The AI client uses these strings to decide what to send.
- No defaults in the schema — handle defaults in the handler (e.g., `const sch = schema ?? "dbo"`).
- Use `z.record(z.unknown())` for parameter bags like `execute_procedure`. Don't try to type inner values — they're passed through to `mssql.Request.input` opaquely.

## Output formatting

Prefer `formatResultSet(result)` for tabular output — it handles column widths, ISO dates, and row counts consistently. Use custom markdown only when the tool genuinely needs a non-table format (code gen, ER diagrams, procedure source).

Dates must be ISO. This is handled automatically inside `formatResultSet` → `formatValue`. Don't roll your own `toISOString()` in a tool.

## Comments

- Top of file: no banner comment needed.
- Between tool registrations: use a divider to make `Ctrl+F` work. Example:
  ```ts
  // ─── list_tables ───
  server.tool(...)
  ```
- Inside handlers: comment the *why*, not the *what*. "SET SHOWPLAN_TEXT must be the only statement in its batch" is a good comment. "// run query" is not.

## No commented-out code

Deleted code is `git log`'s job. Commented-out blocks rot silently and confuse future readers.

## What the codebase does NOT use

- No Prettier config, no ESLint config. The project relies on `tsc --strict` plus convention. Match the surrounding code when editing.
- No test framework (Jest, Vitest, etc.). There is no CI coverage gate.
- No barrel exports (`index.ts` in `utils/` or `tools/`). Import directly from the specific file.
- No path aliases (`@/utils/...`). Relative imports only.

## Don't do this

- ❌ `import { x } from "./module"` — missing `.js` extension.
- ❌ `throw new Error(...)` from inside a tool handler.
- ❌ `type: "text"` without `as const`.
- ❌ `any` as a parameter type when Zod can express it.
- ❌ `console.log` — use `console.error` for anything that shouldn't appear on stdout. **stdout is reserved for the MCP transport**; anything you write there corrupts the protocol stream.
