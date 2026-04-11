# Configuration & Multi-Server

Everything about `loadConfig()`, `AppConfig`, env vars, and how the single-server / multi-server formats coexist.

## Types (from `src/config.ts`)

```ts
type AuthType = "sql" | "windows" | "azure-ad";
type SecurityMode = "readonly" | "readwrite" | "admin";

interface AppConfig {
  servers: Record<string, ServerEntry>;
  defaultServer: string;
}

interface ServerEntry {
  connection: ConnectionConfig;
  security: SecurityConfig;
}
```

At runtime, **there is only one shape**: multi-server. A single-server YAML file is normalized into `{ servers: { default: {...} }, defaultServer: "default" }` by `loadSingleServer`. Tools never need to know which format the user wrote.

## Config file search order

`loadConfig(configPath?)` tries paths in this order, stops at the first that exists:

1. Explicit `configPath` (from `--config` / `-c`)
2. `process.env.MSSQL_MCP_CONFIG`
3. `./mssql-mcp.yaml` (cwd)
4. `./mssql-mcp.yml` (cwd)

If none exist, `fileConfig` stays `{}` and the code falls through to pure-default + env-var loading. This is why running `mcp-sqlserver` with no config still boots — it uses `DEFAULT_CONNECTION` + `DEFAULT_SECURITY` + any `MSSQL_*` env vars.

## Single vs multi-server detection

`loadConfig` routes based on one signal:

```ts
if (fileConfig.connections && typeof fileConfig.connections === "object") {
  return loadMultiServer(fileConfig);
}
return loadSingleServer(fileConfig);
```

- **`connection`** (singular) → `loadSingleServer` → produces `{ default: {...} }`.
- **`connections`** (plural) → `loadMultiServer` → one entry per key.

Both formats coexist forever. The singular format is backward-compatible with v1.2.x and earlier.

## Single-server loading (`loadSingleServer`)

1. Deep-merge `DEFAULT_CONNECTION` with `fileConfig.connection`.
2. Apply env var overrides (see below).
3. If `authentication.type === "windows"` and neither `user` nor `password` was in the YAML, clear the default `sa`/`""` credentials (otherwise NTLM would try to auth as `sa` with an empty password).
4. Deep-merge `DEFAULT_SECURITY` with `fileConfig.security`.
5. Run `applyModeDefaults(security, fileConfig.security)`.
6. Return as `{ servers: { default: { connection, security } }, defaultServer: "default" }`.

## Multi-server loading (`loadMultiServer`)

1. Compute `globalSecurity` = `DEFAULT_SECURITY` deep-merged with top-level `fileConfig.security`.
2. For each entry in `fileConfig.connections`:
   - Split `security` (per-server override) from connection fields.
   - Deep-merge `DEFAULT_CONNECTION` with the remaining connection fields.
   - Windows auth cleanup: same as single-server.
   - Build per-server security: deep-merge `globalSecurity` with the per-server `security` block.
   - Run `applyModeDefaults(security, perServerSecurity)`.
3. `defaultServer` = `fileConfig.defaultServer` ?? first key in `connections` ?? `"default"`.
4. Env var overrides apply **only to the default server**.

### Global security is a template, not a constraint

The top-level `security:` block in multi-server YAML sets **defaults** for each server. Per-server blocks can override anything. A server with `security: { mode: admin }` overrides a global `mode: readonly`. There's no "max restrictive wins" logic — last writer wins. This is intentional: it lets a single config express "prod is read-only, dev is admin".

## `applyModeDefaults(security, rawOverrides?)`

Derives `allowMutations` and `allowDDL` from `mode`, but only if the user didn't explicitly set them:

```
mode: readwrite → allowMutations = true  (if not overridden)
mode: admin     → allowMutations = true  (if not overridden)
                → allowDDL       = true  (if not overridden)
mode: readonly  → defaults (both false)
```

Explicit overrides from YAML always win. Example: `mode: admin, allowDDL: false` → admin-level mutations but no DDL. Keep this invariant when touching the function.

## Environment variables

| Var | Target field | Notes |
|---|---|---|
| `MSSQL_HOST` | `connection.host` | |
| `MSSQL_PORT` | `connection.port` | parsed as int |
| `MSSQL_DATABASE` | `connection.database` | |
| `MSSQL_USER` | `connection.authentication.user` | |
| `MSSQL_PASSWORD` | `connection.authentication.password` | |
| `MSSQL_MCP_CONFIG` | config file path | |

**Env vars override file values, and they only apply to the default server.** This matches the expectation that env vars represent the "primary" connection in container deployments.

## `resolveServer(config, serverName?)`

The only way tool handlers should read connection/security state.

```ts
const { connection, security, serverName } = resolveServer(config, srv);
```

- If `serverName` is omitted, uses `config.defaultServer`.
- Throws `Error("Unknown server: '<name>'. Available servers: <list>")` on miss. The error message intentionally lists available names so the client can self-correct.
- Returns a new object with `serverName` spread in, so tools can pass it to `executeQuery` and `getPool` for correct pool keying.

**Do not cache this result across tool calls.** Always call it fresh inside each handler. Clients can switch servers mid-session.

## Defaults (`DEFAULT_CONNECTION`, `DEFAULT_SECURITY`)

- Defined at module top of `config.ts`.
- Deliberately conservative: `readonly` mode, empty allow/block lists, 1000 row cap.
- Pool: `min: 0, max: 10, idleTimeout: 30000`.
- Auth: `sql` with `sa` + empty password — only meaningful when env vars take over.

If you add a new field to `ConnectionConfig` or `SecurityConfig`, **also add it to the defaults**. The deep-merge logic depends on every key existing on the target side.

## Don't do this

- ❌ Read `process.env.MSSQL_*` from anywhere except `loadConfig`. Env vars have one entry point.
- ❌ Re-expose the raw `fileConfig` YAML to tool code. Parse → type → freeze at `loadConfig`.
- ❌ Mutate `config.servers[...]` at runtime. If a tool needs a modified view, build a local copy.
- ❌ Assume `config.defaultServer` is always `"default"`. It's `"default"` only in single-server mode.
