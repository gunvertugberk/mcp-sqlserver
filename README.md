# mssql-mcp-server

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

### Security
- **Three security modes**: `readonly`, `readwrite`, `admin`
- Database and schema allow/block lists
- Automatic row count limits
- Blocked keyword detection (xp_cmdshell, SHUTDOWN, etc.)
- Column-level data masking (PII protection)
- Query type validation per mode

### Authentication
- SQL Server Authentication
- Windows Authentication
- Azure Active Directory

## Quick Start

### Install

```bash
npm install -g mssql-mcp-server
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
      "args": ["-y", "mssql-mcp-server"],
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
      "args": ["-y", "mssql-mcp-server", "--config", "/path/to/mssql-mcp.yaml"]
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
      "args": ["-y", "mssql-mcp-server"],
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
      "args": ["-y", "mssql-mcp-server"],
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
      "args": ["-y", "mssql-mcp-server"],
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
      "args": ["-y", "mssql-mcp-server"],
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
      "args": ["-y", "mssql-mcp-server"],
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
      "args": ["-y", "mssql-mcp-server"],
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

## Development

```bash
git clone https://github.com/gunvertugberk/mssql-mcp-server.git
cd mssql-mcp-server
npm install
npm run build
npm start -- --config ./mssql-mcp.yaml
```

## License

MIT
