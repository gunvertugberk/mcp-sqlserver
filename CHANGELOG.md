# Changelog

All notable changes to this project will be documented in this file.

See [GitHub Releases](https://github.com/gunvertugberk/mcp-sqlserver/releases) for full release notes.

## [1.2.2] - 2026-04-10

### Changed
- Comprehensive README rewrite with detailed tool documentation, usage examples, and collapsible MCP client configs

## [1.2.1] - 2026-04-10

### Fixed
- `get_long_transactions` — invalid column reference (`t.name` → `at.name`)

## [1.2.0] - 2026-04-10

### Added
- **16 new tools** (total: 37 tools)

**DBA & Performance (9):**
- `get_wait_stats` — Server wait statistics for bottleneck analysis
- `get_deadlocks` — Recent deadlock events from Extended Events
- `get_blocking_chains` — Current blocking chains between sessions
- `get_long_transactions` — Long-running open transactions
- `get_space_usage` — Disk space usage by table
- `get_backup_history` — Backup history from msdb
- `get_query_store_stats` — Top queries from Query Store (SQL Server 2016+)
- `rebuild_index` — Rebuild or reorganize fragmented indexes
- `health_check` — Connection health and server responsiveness

**Developer Utilities (6):**
- `compare_schemas` — Compare schemas between two databases
- `generate_code` — Generate TypeScript, C#, or CREATE TABLE from schema
- `generate_insert_scripts` — Generate INSERT statements from existing data
- `generate_er_diagram` — Generate Mermaid ER diagrams from FK relationships
- `generate_test_data` — Generate realistic fake test data
- `sample_table` — Random data sampling from tables

**Query (1):**
- `export_query` — Export results as CSV or JSON

### Changed
- **ISO date formatting** — Dates display as `2025-01-27` instead of raw JS Date strings
- **Streamable HTTP transport** — `--http <port>` flag for remote hosting
- Comprehensive README with tool tables, usage examples, and collapsible configs

### Security
- **SQL injection fix** — All queries now use parameterized inputs (`@param`) and `escapeIdentifier()` for object names. Previously used string interpolation with manual escaping.

## [1.1.1] - 2026-04-09

### Fixed
- `get_query_plan` — SET SHOWPLAN_TEXT must be in its own batch; split into separate `executeQuery` calls with try/finally cleanup

### Added
- Windows Authentication documentation in README (NTLM + SSPI)
- GitHub repository links in package.json (homepage, repository, bugs)

## [1.1.0] - 2026-04-09

### Added
- **Windows Authentication (NTLM)** — Domain credentials via tedious, no extra packages needed
- **Windows Authentication (SSPI)** — Passwordless via msnodesqlv8 (optional dependency)
- Dual-path Windows auth: auto-detects NTLM vs SSPI based on config

### Fixed
- Default `sa` credentials leaking into Windows auth path — cleared when `type: windows` is set without explicit user/password

## [1.0.1] - 2026-04-09

### Fixed
- Version bump for initial npm publish

## [1.0.0] - 2026-04-09

### Added
- Initial release with 21 tools
- **Schema Discovery**: list_databases, list_schemas, list_tables, list_views, describe_table, get_foreign_keys, get_indexes, get_constraints, get_triggers
- **Query Execution**: execute_query, execute_mutation
- **DDL**: execute_ddl
- **Stored Procedures**: list_procedures, describe_procedure, execute_procedure
- **Performance**: get_query_plan, get_active_queries, get_table_stats, get_index_usage, get_missing_indexes, get_server_info, get_database_info
- Three security modes: readonly, readwrite, admin
- Database/schema allow/block lists
- Column-level data masking
- Blocked keyword detection
- Automatic row limits
- YAML config + environment variable support

[1.2.2]: https://github.com/gunvertugberk/mcp-sqlserver/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/gunvertugberk/mcp-sqlserver/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/gunvertugberk/mcp-sqlserver/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/gunvertugberk/mcp-sqlserver/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/gunvertugberk/mcp-sqlserver/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/gunvertugberk/mcp-sqlserver/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/gunvertugberk/mcp-sqlserver/releases/tag/v1.0.0
