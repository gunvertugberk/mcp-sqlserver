import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config.js";
import { executeQuery } from "../database.js";
import { isDatabaseAllowed } from "../utils/security.js";
import { formatResultSet } from "../utils/formatter.js";

export function registerPerformanceTools(server: McpServer, config: AppConfig): void {
  // ─── get_query_plan ───
  server.tool(
    "get_query_plan",
    "Get the estimated execution plan for a SQL query (without executing it)",
    {
      sql: z.string().describe("The SQL query to analyze"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
    },
    async ({ sql: sqlQuery, database }) => {
      try {
        const db = database ?? config.connection.database;

        // Switch database context first (separate batch)
        if (database) {
          await executeQuery(
            config.connection,
            `USE [${db.replace(/]/g, "]]")}]`
          );
        }

        // SET SHOWPLAN_TEXT must be the only statement in its batch
        await executeQuery(config.connection, "SET SHOWPLAN_TEXT ON");

        try {
          const result = await executeQuery(config.connection, sqlQuery);

          // Turn off SHOWPLAN before returning
          await executeQuery(config.connection, "SET SHOWPLAN_TEXT OFF");

          if (result.recordset && result.recordset.length > 0) {
            const planText = result.recordset
              .map((r: any) => r["StmtText"] ?? Object.values(r)[0])
              .join("\n");

            return {
              content: [
                {
                  type: "text" as const,
                  text: `## Execution Plan\n\`\`\`\n${planText}\n\`\`\``,
                },
              ],
            };
          }

          return {
            content: [
              { type: "text" as const, text: "No execution plan returned." },
            ],
          };
        } catch (err: any) {
          // Ensure SHOWPLAN is turned off even on error
          await executeQuery(config.connection, "SET SHOWPLAN_TEXT OFF").catch(() => {});
          throw err;
        }
      } catch (err: any) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── get_active_queries ───
  server.tool(
    "get_active_queries",
    "Show currently running queries on the server (from sys.dm_exec_requests)",
    {},
    async () => {
      try {
        const result = await executeQuery(
          config.connection,
          `SELECT
            r.session_id,
            r.status,
            r.command,
            r.cpu_time,
            r.total_elapsed_time AS elapsed_ms,
            r.reads,
            r.writes,
            r.logical_reads,
            r.wait_type,
            r.blocking_session_id,
            DB_NAME(r.database_id) AS [database],
            SUBSTRING(t.text,
              (r.statement_start_offset / 2) + 1,
              CASE WHEN r.statement_end_offset = -1
                THEN LEN(t.text)
                ELSE (r.statement_end_offset - r.statement_start_offset) / 2 + 1
              END
            ) AS [current_statement]
          FROM sys.dm_exec_requests r
          CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
          WHERE r.session_id != @@SPID
            AND r.session_id > 50
          ORDER BY r.total_elapsed_time DESC`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: result.recordset.length === 0
                ? "No active queries found."
                : formatResultSet(result),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── get_table_stats ───
  server.tool(
    "get_table_stats",
    "Get table statistics: row count, total size, index size, and fragmentation",
    {
      table: z.string().describe("Table name"),
      schema: z.string().optional().describe("Schema name (default: dbo)"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
    },
    async ({ table, schema, database }) => {
      const db = database ?? config.connection.database;
      const sch = schema ?? "dbo";

      if (!isDatabaseAllowed(db, config.security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      try {
        const result = await executeQuery(
          config.connection,
          `USE [${db.replace(/]/g, "]]")}];
          SELECT
            s.name AS [schema],
            t.name AS [table],
            p.rows AS [row_count],
            CAST(ROUND(SUM(a.total_pages) * 8.0 / 1024, 2) AS DECIMAL(18,2)) AS [total_size_mb],
            CAST(ROUND(SUM(a.used_pages) * 8.0 / 1024, 2) AS DECIMAL(18,2)) AS [used_size_mb],
            CAST(ROUND((SUM(a.total_pages) - SUM(a.used_pages)) * 8.0 / 1024, 2) AS DECIMAL(18,2)) AS [unused_size_mb],
            (SELECT TOP 1 avg_fragmentation_in_percent
             FROM sys.dm_db_index_physical_stats(DB_ID(), t.object_id, NULL, NULL, 'LIMITED')
             WHERE index_id <= 1) AS [fragmentation_pct]
          FROM sys.tables t
          JOIN sys.schemas s ON t.schema_id = s.schema_id
          JOIN sys.indexes i ON t.object_id = i.object_id
          JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
          JOIN sys.allocation_units a ON p.partition_id = a.container_id
          WHERE t.name = '${table.replace(/'/g, "''")}'
            AND s.name = '${sch.replace(/'/g, "''")}'
            AND i.index_id <= 1
          GROUP BY s.name, t.name, p.rows, t.object_id`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: result.recordset.length === 0
                ? `Table '${sch}.${table}' not found.`
                : formatResultSet(result),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── get_index_usage ───
  server.tool(
    "get_index_usage",
    "Get index usage statistics: seeks, scans, lookups, and updates (from sys.dm_db_index_usage_stats)",
    {
      table: z.string().describe("Table name"),
      schema: z.string().optional().describe("Schema name (default: dbo)"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
    },
    async ({ table, schema, database }) => {
      const db = database ?? config.connection.database;
      const sch = schema ?? "dbo";

      if (!isDatabaseAllowed(db, config.security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      try {
        const result = await executeQuery(
          config.connection,
          `USE [${db.replace(/]/g, "]]")}];
          SELECT
            i.name AS [index_name],
            i.type_desc AS [type],
            ius.user_seeks,
            ius.user_scans,
            ius.user_lookups,
            ius.user_updates,
            ius.last_user_seek,
            ius.last_user_scan,
            CAST(ROUND(
              (SELECT SUM(a.total_pages) * 8.0 / 1024
               FROM sys.partitions p
               JOIN sys.allocation_units a ON p.partition_id = a.container_id
               WHERE p.object_id = i.object_id AND p.index_id = i.index_id
              ), 2) AS DECIMAL(18,2)) AS [size_mb]
          FROM sys.indexes i
          JOIN sys.tables t ON i.object_id = t.object_id
          JOIN sys.schemas s ON t.schema_id = s.schema_id
          LEFT JOIN sys.dm_db_index_usage_stats ius
            ON i.object_id = ius.object_id AND i.index_id = ius.index_id AND ius.database_id = DB_ID()
          WHERE t.name = '${table.replace(/'/g, "''")}'
            AND s.name = '${sch.replace(/'/g, "''")}'
            AND i.name IS NOT NULL
          ORDER BY ISNULL(ius.user_seeks, 0) + ISNULL(ius.user_scans, 0) DESC`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: result.recordset.length === 0
                ? `No indexes found for '${sch}.${table}'.`
                : formatResultSet(result),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── get_missing_indexes ───
  server.tool(
    "get_missing_indexes",
    "Get missing index suggestions from SQL Server DMVs (sys.dm_db_missing_index_details)",
    {
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
    },
    async ({ database }) => {
      const db = database ?? config.connection.database;
      if (!isDatabaseAllowed(db, config.security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      try {
        const result = await executeQuery(
          config.connection,
          `SELECT TOP 20
            DB_NAME(mid.database_id) AS [database],
            OBJECT_SCHEMA_NAME(mid.object_id, mid.database_id) AS [schema],
            OBJECT_NAME(mid.object_id, mid.database_id) AS [table],
            mid.equality_columns,
            mid.inequality_columns,
            mid.included_columns,
            migs.user_seeks,
            migs.user_scans,
            CAST(migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans) AS DECIMAL(18,2)) AS [improvement_measure],
            'CREATE NONCLUSTERED INDEX [IX_' +
              OBJECT_NAME(mid.object_id, mid.database_id) + '_' +
              REPLACE(REPLACE(REPLACE(ISNULL(mid.equality_columns, ''), ', ', '_'), '[', ''), ']', '') +
            '] ON ' + mid.statement +
            ' (' + ISNULL(mid.equality_columns, '') +
              CASE WHEN mid.equality_columns IS NOT NULL AND mid.inequality_columns IS NOT NULL THEN ', ' ELSE '' END +
              ISNULL(mid.inequality_columns, '') +
            ')' +
            CASE WHEN mid.included_columns IS NOT NULL
              THEN ' INCLUDE (' + mid.included_columns + ')'
              ELSE '' END AS [suggested_index_ddl]
          FROM sys.dm_db_missing_index_details mid
          JOIN sys.dm_db_missing_index_groups mig ON mid.index_handle = mig.index_handle
          JOIN sys.dm_db_missing_index_group_stats migs ON mig.index_group_handle = migs.group_handle
          WHERE mid.database_id = DB_ID('${db.replace(/'/g, "''")}')
          ORDER BY improvement_measure DESC`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: result.recordset.length === 0
                ? "No missing index suggestions found."
                : formatResultSet(result),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── get_server_info ───
  server.tool(
    "get_server_info",
    "Get SQL Server instance information: version, edition, OS, memory, CPU",
    {},
    async () => {
      try {
        const result = await executeQuery(
          config.connection,
          `SELECT
            SERVERPROPERTY('ProductVersion') AS [version],
            SERVERPROPERTY('ProductLevel') AS [level],
            SERVERPROPERTY('Edition') AS [edition],
            SERVERPROPERTY('EngineEdition') AS [engine_edition],
            SERVERPROPERTY('MachineName') AS [machine],
            SERVERPROPERTY('ServerName') AS [server_name],
            SERVERPROPERTY('Collation') AS [collation],
            SERVERPROPERTY('IsIntegratedSecurityOnly') AS [windows_auth_only],
            (SELECT COUNT(*) FROM sys.databases) AS [database_count],
            (SELECT cpu_count FROM sys.dm_os_sys_info) AS [cpu_count],
            (SELECT CAST(physical_memory_kb / 1024.0 AS DECIMAL(18,0)) FROM sys.dm_os_sys_info) AS [physical_memory_mb],
            (SELECT sqlserver_start_time FROM sys.dm_os_sys_info) AS [start_time]`
        );

        return {
          content: [{ type: "text" as const, text: formatResultSet(result) }],
        };
      } catch (err: any) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── get_database_info ───
  server.tool(
    "get_database_info",
    "Get detailed database information: size, files, status, recovery model",
    {
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
    },
    async ({ database }) => {
      const db = database ?? config.connection.database;
      if (!isDatabaseAllowed(db, config.security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      try {
        const result = await executeQuery(
          config.connection,
          `SELECT
            d.name AS [database],
            d.state_desc AS [status],
            d.recovery_model_desc AS [recovery_model],
            d.compatibility_level,
            d.collation_name,
            d.create_date,
            (SELECT CAST(SUM(size * 8.0 / 1024) AS DECIMAL(18,2))
             FROM [${db.replace(/]/g, "]]")}].sys.database_files
             WHERE type = 0) AS [data_size_mb],
            (SELECT CAST(SUM(size * 8.0 / 1024) AS DECIMAL(18,2))
             FROM [${db.replace(/]/g, "]]")}].sys.database_files
             WHERE type = 1) AS [log_size_mb],
            (SELECT COUNT(*) FROM [${db.replace(/]/g, "]]")}].sys.tables) AS [table_count],
            (SELECT COUNT(*) FROM [${db.replace(/]/g, "]]")}].sys.views) AS [view_count],
            (SELECT COUNT(*) FROM [${db.replace(/]/g, "]]")}].sys.procedures) AS [procedure_count]
          FROM sys.databases d
          WHERE d.name = '${db.replace(/'/g, "''")}'`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: result.recordset.length === 0
                ? `Database '${db}' not found.`
                : formatResultSet(result),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );
}
