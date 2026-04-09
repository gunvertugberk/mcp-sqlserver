# mcp-sqlserver

A powerful [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for **Microsoft SQL Server**. Connects AI assistants (Claude, Gemini, Kiro, OpenAI, Copilot, Cursor) directly to your SQL Server databases with enterprise-grade security controls.

## Features

### Schema Discovery
- `list_databases` — List all accessible databases
- `list_schemas` — List schemas in a database
- `list_tables` — List tables with row counts and sizes
- `list_views` — List views in a database
- `describe_table` — Detailed column info (types, defaults, nullability, identity, computed)
- `get_foreign_keys` — Foreign key relationships
- `get_indexes` — Index information with included columns
- `get_constraints` — PK, unique, check, default constraints
- `get_triggers` — Trigger definitions

### Query Execution
- `execute_query` — Run SELECT queries with automatic row limits
- `execute_mutation` — Run INSERT/UPDATE/DELETE/MERGE (requires readwrite mode)
- `export_query` — Export query results as CSV or JSON

### DDL Operations
- `execute_ddl` — Run CREATE/ALTER/DROP statements (requires admin mode)

### Stored Procedures
- `list_procedures` — List stored procedures
- `describe_procedure` — View parameters and source code
- `execute_procedure` — Execute with parameters (requires readwrite mode)

### Performance & DBA
- `get_query_plan` — Estimated execution plan for any query
- `get_active_queries` — Currently running queries (DMV)
- `get_table_stats` — Row count, size, fragmentation
- `get_index_usage` — Index seeks, scans, lookups statistics
- `get_missing_indexes` — Missing index suggestions with ready-to-use DDL
- `get_server_info` — Server version, edition, CPU, memory
- `get_database_info` — Database size, files, status, recovery model
- `get_wait_stats` — Server wait statistics (performance bottleneck analysis)
- `get_deadlocks` — Recent deadlock events from Extended Events
- `get_blocking_chains` — Current blocking chains between sessions
- `get_long_transactions` — Long-running open transactions
- `get_space_usage` — Detailed disk space usage by table
- `get_backup_history` — Recent backup history and status
- `get_query_store_stats` — Top resource-consuming queries from Query Store (SQL Server 2016+)
- `rebuild_index` — Rebuild or reorganize fragmented indexes (requires admin mode)
- `health_check` — Connection health and server responsiveness check

### Developer Utilities
- `compare_schemas` — Compare schemas between two databases (dev vs prod)
- `generate_code` — Generate TypeScript interfaces, C# classes, or CREATE TABLE scripts from table schema
- `generate_insert_scripts` — Generate INSERT statements from existing data (migration/seeding)
- `generate_er_diagram` — Generate Mermaid ER diagrams from foreign key relationships
- `generate_test_data` — Generate INSERT statements with realistic fake/test data
- `sample_table` — Random sample of rows from a table

### Security
- **Three security modes**: `readonly`, `readwrite`, `admin`
- **Parameterized queries** — All user inputs are parameterized to prevent SQL injection
- Database and schema allow/block lists
- Automatic row count limits
- Blocked keyword detection (xp_cmdshell, SHUTDOWN, etc.)
- Column-level data masking (PII protection)
- Query type validation per mode

### Authentication
- **SQL Server Authentication** — username/password
- **Windows Authentication (NTLM)** — domain credentials, no extra packages needed
- **Windows Authentication (SSPI)** — passwordless, uses current Windows session (requires `msnodesqlv8`)
- **Azure Active Directory** — service principal

### Transport
- **stdio** — Default, for MCP clients (Claude Desktop, VS Code, Cursor, etc.)
- **Streamable HTTP** — For remote hosting and web integrations (`--http <port>`)

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

### Use with Claude Desktop / Claude Code

Add to your MCP settings:

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

Or with a config file:

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

### Use with VS Code (Copilot / Continue)

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

### Use with Cursor

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

### Use with Kiro

Add to your Kiro MCP configuration (`.kiro/settings/mcp.json`):

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

### Use with Gemini CLI

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

### Use with OpenAI (ChatGPT Desktop)

Add to ChatGPT Desktop MCP settings:

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

### Use with Windsurf

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

### HTTP Transport (Remote Hosting)

For remote deployments or web integrations, use the HTTP transport:

```bash
mcp-sqlserver --config mssql-mcp.yaml --http 3000
```

This starts a Streamable HTTP server at `http://localhost:3000/mcp` with a health check endpoint at `/health`.

## Windows Authentication

Two modes are supported for Windows Authentication:

### NTLM (domain + username + password)

Works out of the box with no extra packages. Provide your Windows domain credentials in the config:

```yaml
connection:
  host: YOUR_SERVER\SQLEXPRESS
  authentication:
    type: windows
    user: YourUsername
    password: YourPassword
    domain: YOUR_DOMAIN    # optional, defaults to server's domain
  trustServerCertificate: true
```

### SSPI / Integrated Security (passwordless)

Uses your current Windows login session — no credentials needed. Requires the [`msnodesqlv8`](https://www.npmjs.com/package/msnodesqlv8) package:

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

> **Note:** When using `npx`, optional dependencies like `msnodesqlv8` may not be installed automatically. For SSPI, consider installing the package globally (`npm install -g @tugberkgunver/mcp-sqlserver msnodesqlv8`) or use NTLM mode instead.

### Windows — MCP Configuration

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

## Configuration Reference

See [config.example.yaml](config.example.yaml) for a full example.

### Security Modes

| Mode | SELECT | INSERT/UPDATE/DELETE | DDL | Stored Procedures |
|------|--------|---------------------|-----|-------------------|
| `readonly` | Yes | No | No | Read-only (list/describe) |
| `readwrite` | Yes | Yes | No | Full (execute) |
| `admin` | Yes | Yes | Yes | Full (execute) |

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

## Tool Reference

### Total: 37 tools

| Category | Tools | Count |
|----------|-------|-------|
| Schema Discovery | list_databases, list_schemas, list_tables, list_views, describe_table, get_foreign_keys, get_indexes, get_constraints, get_triggers | 9 |
| Query Execution | execute_query, execute_mutation, export_query | 3 |
| DDL | execute_ddl | 1 |
| Stored Procedures | list_procedures, describe_procedure, execute_procedure | 3 |
| Performance & DBA | get_query_plan, get_active_queries, get_table_stats, get_index_usage, get_missing_indexes, get_server_info, get_database_info, get_wait_stats, get_deadlocks, get_blocking_chains, get_long_transactions, get_space_usage, get_backup_history, get_query_store_stats, rebuild_index, health_check | 16 |
| Developer Utilities | compare_schemas, generate_code, generate_insert_scripts, generate_er_diagram, generate_test_data, sample_table | 6 |

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
