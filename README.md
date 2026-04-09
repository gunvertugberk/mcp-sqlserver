# mcp-sqlserver

A powerful [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for **Microsoft SQL Server**. Connects AI assistants (Claude, Gemini, Kiro, OpenAI, Copilot, Cursor) directly to your SQL Server databases with enterprise-grade security controls.

**37 tools** across 6 categories: schema discovery, query execution, DDL, stored procedures, performance/DBA diagnostics, and developer utilities.

[![npm version](https://img.shields.io/npm/v/@tugberkgunver/mcp-sqlserver)](https://www.npmjs.com/package/@tugberkgunver/mcp-sqlserver)
[![GitHub release](https://img.shields.io/github/v/release/gunvertugberk/mcp-sqlserver)](https://github.com/gunvertugberk/mcp-sqlserver/releases)

> **Changelog**: See [CHANGELOG.md](CHANGELOG.md) for version history or [GitHub Releases](https://github.com/gunvertugberk/mcp-sqlserver/releases) for detailed release notes.

## What's New in v1.2

- **16 new tools** — DBA diagnostics, code generation, ER diagrams, schema diff, data sampling, and more
- **SQL injection protection** — All queries now use parameterized inputs and escaped identifiers
- **ISO date formatting** — Dates display as `2025-01-27` instead of raw JavaScript Date strings
- **Streamable HTTP transport** — Host the MCP server remotely with `--http <port>`
- **Health check** — Verify connection status and server responsiveness

## Features

### Schema Discovery (9 tools)
| Tool | Description |
|------|-------------|
| `list_databases` | List all accessible databases on the instance |
| `list_schemas` | List schemas in a database |
| `list_tables` | List tables with row counts and sizes |
| `list_views` | List views in a database |
| `describe_table` | Detailed column info: types, defaults, nullability, identity, computed |
| `get_foreign_keys` | Foreign key relationships for a table |
| `get_indexes` | Index information with included columns |
| `get_constraints` | PK, unique, check, and default constraints |
| `get_triggers` | Trigger definitions on a table |

### Query Execution (3 tools)
| Tool | Description |
|------|-------------|
| `execute_query` | Run SELECT queries with automatic row limits |
| `execute_mutation` | Run INSERT/UPDATE/DELETE/MERGE (requires `readwrite` mode) |
| `export_query` | Export query results as **CSV** or **JSON** format |

### DDL Operations (1 tool)
| Tool | Description |
|------|-------------|
| `execute_ddl` | Run CREATE/ALTER/DROP statements (requires `admin` mode) |

### Stored Procedures (3 tools)
| Tool | Description |
|------|-------------|
| `list_procedures` | List stored procedures in a database |
| `describe_procedure` | View parameters and source code of a procedure |
| `execute_procedure` | Execute with named parameters (requires `readwrite` mode) |

### Performance & DBA (16 tools)
| Tool | Description |
|------|-------------|
| `get_query_plan` | Estimated execution plan for any query |
| `get_active_queries` | Currently running queries from `sys.dm_exec_requests` |
| `get_table_stats` | Row count, total/used/unused size, and fragmentation % |
| `get_index_usage` | Index seeks, scans, lookups, and update statistics |
| `get_missing_indexes` | Missing index suggestions with ready-to-use CREATE INDEX DDL |
| `get_server_info` | Server version, edition, CPU count, memory, uptime |
| `get_database_info` | Database size, file layout, status, recovery model, object counts |
| `get_wait_stats` | Top server wait statistics — identifies CPU, I/O, lock bottlenecks |
| `get_deadlocks` | Recent deadlock events from the `system_health` Extended Events session |
| `get_blocking_chains` | Current blocking chains — which sessions are blocking others |
| `get_long_transactions` | Long-running open transactions that may be holding locks |
| `get_space_usage` | Detailed disk space usage by table (data, index, unused) |
| `get_backup_history` | Recent backup history: type, size, duration, device path |
| `get_query_store_stats` | Top resource-consuming queries from Query Store (SQL Server 2016+) — sortable by CPU, duration, reads, writes, or executions |
| `rebuild_index` | Rebuild or reorganize a fragmented index (requires `admin` mode) |
| `health_check` | Connection health check with latency, version, active sessions |

### Developer Utilities (6 tools)

#### `compare_schemas` — Schema Diff
Compare two databases side-by-side. Shows tables, columns, and type differences — perfect for dev vs prod comparison.
```
compare_schemas(source_database: "DevDB", target_database: "ProdDB")
```
Output includes: tables only in source/target, columns only in source/target, and column type/nullability differences.

#### `generate_code` — Code Generation
Generate typed code from any table's schema:
- **TypeScript** — interfaces with proper types (`number`, `string`, `Date`, `Buffer | null`)
- **C#** — classes with nullable value types (`int?`, `DateTime?`, `decimal?`)
- **SQL** — `CREATE TABLE` scripts with full column definitions

```
generate_code(table: "Products", language: "typescript")
→ export interface Products {
    productId: number;
    productName: string;
    unitPrice: number | null;
    ...
  }
```

#### `generate_insert_scripts` — Data Export as INSERT
Generate INSERT statements from existing table data — useful for migration scripts, seed data, or backing up small reference tables.
```
generate_insert_scripts(table: "Categories", top: 10)
→ INSERT INTO [dbo].[Categories] ([CategoryName], [Description]) VALUES (N'Beverages', N'Soft drinks...');
```

#### `generate_er_diagram` — ER Diagram
Generate a [Mermaid](https://mermaid.js.org/) ER diagram from foreign key relationships. Paste the output into any Mermaid-compatible renderer (GitHub, Notion, VS Code, etc.).
```
generate_er_diagram(database: "Northwind")
→ erDiagram
    Products }o--|| Categories : "CategoryID"
    Products }o--|| Suppliers : "SupplierID"
    Orders }o--|| Customers : "CustomerID"
    ...
```

#### `generate_test_data` — Test Data Generation
Generate realistic INSERT statements with fake data based on column names and types. Smart heuristics for common patterns (email, phone, name, city, price, etc.).
```
generate_test_data(table: "Customers", count: 5)
→ INSERT INTO [dbo].[Customers] (...) VALUES (N'Alice', N'user1@example.com', N'New York', ...);
```

#### `sample_table` — Random Sampling
Get a random sample of rows from any table using `NEWID()` — useful for AI assistants to understand data patterns without scanning entire tables.
```
sample_table(table: "Orders", count: 5)
```

## Security

### Three Security Modes

| Mode | SELECT | INSERT/UPDATE/DELETE | DDL | Stored Procedures |
|------|--------|---------------------|-----|-------------------|
| `readonly` | Yes | No | No | Read-only (list/describe) |
| `readwrite` | Yes | Yes | No | Full (execute) |
| `admin` | Yes | Yes | Yes | Full (execute) |

### SQL Injection Protection
All user-provided values are passed as **parameterized query inputs** (`@param`). Object identifiers (database, schema, table names) are escaped using SQL Server bracket notation (`[name]` with `]` → `]]`).

### Additional Security Features
- Database and schema **allow/block lists**
- Automatic **row count limits** (configurable `maxRowCount`)
- **Blocked keyword** detection (xp_cmdshell, SHUTDOWN, DROP DATABASE, etc.)
- Column-level **data masking** for PII protection
- Query type validation per security mode

### Data Masking

Mask sensitive columns in query results:

```yaml
security:
  maskColumns:
    - pattern: "*.password"
      mask: "***"
    - pattern: "*.ssn"
      mask: "XXX-XX-XXXX"
    - pattern: "dbo.users.email"
      mask: "***@***.***"
```

Pattern format: `[schema.]table.column` (use `*` as wildcard)

## Authentication

| Method | Config `type` | Requirements |
|--------|---------------|-------------|
| SQL Server | `sql` | `user` + `password` |
| Windows (NTLM) | `windows` | `user` + `password` + optional `domain` |
| Windows (SSPI) | `windows` | No credentials needed; requires [`msnodesqlv8`](https://www.npmjs.com/package/msnodesqlv8) |
| Azure AD | `azure-ad` | `clientId` + `clientSecret` + `tenantId` |

### Windows Authentication

**NTLM** — Works out of the box, no extra packages:
```yaml
connection:
  host: YOUR_SERVER\SQLEXPRESS
  authentication:
    type: windows
    user: YourUsername
    password: YourPassword
    domain: YOUR_DOMAIN
  trustServerCertificate: true
```

**SSPI / Integrated Security** — Uses current Windows login session:
```bash
npm install msnodesqlv8
```
```yaml
connection:
  host: YOUR_SERVER\SQLEXPRESS
  authentication:
    type: windows
  trustServerCertificate: true
```

> **Note:** When using `npx`, optional dependencies like `msnodesqlv8` may not be installed automatically. For SSPI, consider installing globally (`npm install -g @tugberkgunver/mcp-sqlserver msnodesqlv8`) or use NTLM mode instead.

## Transport

### stdio (Default)
Standard input/output transport — used by MCP clients like Claude Desktop, VS Code, Cursor, etc.

### Streamable HTTP
For remote hosting or web integrations:
```bash
mcp-sqlserver --config mssql-mcp.yaml --http 3000
```

This starts:
- **MCP endpoint**: `http://localhost:3000/mcp`
- **Health check**: `http://localhost:3000/health` → `{"status":"ok","mode":"readonly"}`

Includes CORS support for browser-based clients.

## Quick Start

### Install

```bash
npm install -g @tugberkgunver/mcp-sqlserver
```

### Configure

Create `mssql-mcp.yaml` in your working directory:

```yaml
connection:
  host: localhost
  port: 1433
  database: MyDatabase
  authentication:
    type: sql
    user: sa
    password: YourPassword123
  trustServerCertificate: true

security:
  mode: readonly
  maxRowCount: 1000
  blockedDatabases:
    - master
    - msdb
    - tempdb
    - model
```

See [config.example.yaml](config.example.yaml) for all options.

### MCP Client Configuration

<details>
<summary><strong>Claude Desktop / Claude Code</strong></summary>

```json
{
  "mcpServers": {
    "mssql": {
      "command": "npx",
      "args": ["-y", "@tugberkgunver/mcp-sqlserver"],
      "env": {
        "MSSQL_HOST": "localhost",
        "MSSQL_DATABASE": "MyDatabase",
        "MSSQL_USER": "sa",
        "MSSQL_PASSWORD": "YourPassword123"
      }
    }
  }
}
```

With a config file:
```json
{
  "mcpServers": {
    "mssql": {
      "command": "npx",
      "args": ["-y", "@tugberkgunver/mcp-sqlserver", "--config", "/path/to/mssql-mcp.yaml"]
    }
  }
}
```
</details>

<details>
<summary><strong>VS Code (Copilot / Continue)</strong></summary>

Add to `.vscode/mcp.json`:
```json
{
  "servers": {
    "mssql": {
      "command": "npx",
      "args": ["-y", "@tugberkgunver/mcp-sqlserver"],
      "env": {
        "MSSQL_HOST": "localhost",
        "MSSQL_DATABASE": "MyDatabase",
        "MSSQL_USER": "sa",
        "MSSQL_PASSWORD": "YourPassword123"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "mssql": {
      "command": "npx",
      "args": ["-y", "@tugberkgunver/mcp-sqlserver"],
      "env": {
        "MSSQL_HOST": "localhost",
        "MSSQL_DATABASE": "MyDatabase",
        "MSSQL_USER": "sa",
        "MSSQL_PASSWORD": "YourPassword123"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Kiro</strong></summary>

Add to `.kiro/settings/mcp.json`:
```json
{
  "mcpServers": {
    "mssql": {
      "command": "npx",
      "args": ["-y", "@tugberkgunver/mcp-sqlserver"],
      "env": {
        "MSSQL_HOST": "localhost",
        "MSSQL_DATABASE": "MyDatabase",
        "MSSQL_USER": "sa",
        "MSSQL_PASSWORD": "YourPassword123"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

Add to `~/.gemini/settings.json`:
```json
{
  "mcpServers": {
    "mssql": {
      "command": "npx",
      "args": ["-y", "@tugberkgunver/mcp-sqlserver"],
      "env": {
        "MSSQL_HOST": "localhost",
        "MSSQL_DATABASE": "MyDatabase",
        "MSSQL_USER": "sa",
        "MSSQL_PASSWORD": "YourPassword123"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>OpenAI (ChatGPT Desktop)</strong></summary>

```json
{
  "mcpServers": {
    "mssql": {
      "command": "npx",
      "args": ["-y", "@tugberkgunver/mcp-sqlserver"],
      "env": {
        "MSSQL_HOST": "localhost",
        "MSSQL_DATABASE": "MyDatabase",
        "MSSQL_USER": "sa",
        "MSSQL_PASSWORD": "YourPassword123"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Windsurf</strong></summary>

Add to `~/.windsurf/mcp.json`:
```json
{
  "mcpServers": {
    "mssql": {
      "command": "npx",
      "args": ["-y", "@tugberkgunver/mcp-sqlserver"],
      "env": {
        "MSSQL_HOST": "localhost",
        "MSSQL_DATABASE": "MyDatabase",
        "MSSQL_USER": "sa",
        "MSSQL_PASSWORD": "YourPassword123"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Windows (all clients)</strong></summary>

On Windows, use `cmd` as the command wrapper:
```json
{
  "mcpServers": {
    "mssql": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@tugberkgunver/mcp-sqlserver", "--config", "path/to/config.yaml"]
    }
  }
}
```
</details>

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MSSQL_HOST` | SQL Server hostname |
| `MSSQL_PORT` | SQL Server port (default: 1433) |
| `MSSQL_DATABASE` | Default database |
| `MSSQL_USER` | SQL auth username |
| `MSSQL_PASSWORD` | SQL auth password |
| `MSSQL_MCP_CONFIG` | Path to YAML config file |

Environment variables override config file values.

## Development

```bash
git clone https://github.com/gunvertugberk/mcp-sqlserver.git
cd mcp-sqlserver
npm install
npm run build
npm start -- --config ./mssql-mcp.yaml
```

## License

MIT
