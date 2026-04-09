import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config.js";
import { executeQuery } from "../database.js";
import { isDatabaseAllowed, escapeIdentifier } from "../utils/security.js";
import { formatResultSet } from "../utils/formatter.js";

export function registerDBATools(server: McpServer, config: AppConfig): void {
  // ─── get_wait_stats ───
  server.tool(
    "get_wait_stats",
    "Get top server wait statistics — identifies performance bottlenecks (CPU, I/O, locks, etc.)",
    {
      top: z.number().optional().describe("Number of top wait types to return (default: 20)"),
    },
    async ({ top }) => {
      const n = top ?? 20;
      try {
        const result = await executeQuery(
          config.connection,
          `SELECT TOP (${n})
            wait_type,
            waiting_tasks_count,
            wait_time_ms,
            max_wait_time_ms,
            signal_wait_time_ms,
            wait_time_ms - signal_wait_time_ms AS resource_wait_time_ms,
            CAST(100.0 * wait_time_ms / NULLIF(SUM(wait_time_ms) OVER(), 0) AS DECIMAL(5,2)) AS [pct]
          FROM sys.dm_os_wait_stats
          WHERE wait_type NOT IN (
            'CLR_SEMAPHORE','LAZYWRITER_SLEEP','RESOURCE_QUEUE','SQLTRACE_BUFFER_FLUSH',
            'SLEEP_TASK','SLEEP_SYSTEMTASK','WAITFOR','HADR_FILESTREAM_IOMGR_IOCOMPLETION',
            'CHECKPOINT_QUEUE','REQUEST_FOR_DEADLOCK_SEARCH','XE_TIMER_EVENT','XE_DISPATCH_WAIT',
            'BROKER_TO_FLUSH','BROKER_TASK_STOP','CLR_MANUAL_EVENT','CLR_AUTO_EVENT',
            'DISPATCHER_QUEUE_SEMAPHORE','FT_IFTS_SCHEDULER_IDLE_WAIT','LOGMGR_QUEUE',
            'ONDEMAND_TASK_QUEUE','SLEEP_BPOOL_FLUSH','DIRTY_PAGE_POLL','SQLTRACE_INCREMENTAL_FLUSH_SLEEP',
            'SP_SERVER_DIAGNOSTICS_SLEEP','QDS_PERSIST_TASK_MAIN_LOOP_SLEEP','QDS_CLEANUP_STALE_QUERIES_TASK_MAIN_LOOP_SLEEP',
            'WAIT_XTP_OFFLINE_CKPT_NEW_LOG','BROKER_EVENTHANDLER','PREEMPTIVE_OS_GETPROCADDRESS'
          )
            AND waiting_tasks_count > 0
          ORDER BY wait_time_ms DESC`
        );

        return {
          content: [{
            type: "text" as const,
            text: result.recordset.length === 0
              ? "No significant wait statistics found."
              : formatResultSet(result),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ─── get_deadlocks ───
  server.tool(
    "get_deadlocks",
    "Get recent deadlock events from the system_health Extended Events session",
    {},
    async () => {
      try {
        const result = await executeQuery(
          config.connection,
          `SELECT TOP 10
            xed.value('(@timestamp)[1]', 'datetime2') AS [deadlock_time],
            xed.query('.') AS [deadlock_graph]
          FROM (
            SELECT CAST(target_data AS XML) AS target_data
            FROM sys.dm_xe_session_targets st
            JOIN sys.dm_xe_sessions s ON s.address = st.event_session_address
            WHERE s.name = 'system_health'
              AND st.target_name = 'ring_buffer'
          ) AS data
          CROSS APPLY target_data.nodes('RingBufferTarget/event[@name="xml_deadlock_report"]') AS xed(xed)
          ORDER BY xed.value('(@timestamp)[1]', 'datetime2') DESC`
        );

        if (result.recordset.length === 0) {
          return { content: [{ type: "text" as const, text: "No recent deadlocks found." }] };
        }

        const parts = result.recordset.map((r: any, i: number) =>
          `### Deadlock ${i + 1} — ${r.deadlock_time}\n\`\`\`xml\n${r.deadlock_graph}\n\`\`\``
        );

        return { content: [{ type: "text" as const, text: parts.join("\n\n") }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ─── get_blocking_chains ───
  server.tool(
    "get_blocking_chains",
    "Show current blocking chains — which sessions are blocking others",
    {},
    async () => {
      try {
        const result = await executeQuery(
          config.connection,
          `SELECT
            r.session_id AS [blocked_session],
            r.blocking_session_id AS [blocking_session],
            r.wait_type,
            r.wait_time AS [wait_time_ms],
            DB_NAME(r.database_id) AS [database],
            SUBSTRING(t.text,
              (r.statement_start_offset / 2) + 1,
              CASE WHEN r.statement_end_offset = -1
                THEN LEN(t.text)
                ELSE (r.statement_end_offset - r.statement_start_offset) / 2 + 1
              END
            ) AS [blocked_query],
            (SELECT SUBSTRING(t2.text, 1, 200)
             FROM sys.dm_exec_connections c
             CROSS APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) t2
             WHERE c.session_id = r.blocking_session_id
            ) AS [blocking_query],
            r.status,
            r.command
          FROM sys.dm_exec_requests r
          CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
          WHERE r.blocking_session_id > 0
          ORDER BY r.wait_time DESC`
        );

        return {
          content: [{
            type: "text" as const,
            text: result.recordset.length === 0
              ? "No blocking chains detected."
              : formatResultSet(result),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ─── get_long_transactions ───
  server.tool(
    "get_long_transactions",
    "Show long-running open transactions that may be holding locks",
    {},
    async () => {
      try {
        const result = await executeQuery(
          config.connection,
          `SELECT
            s.session_id,
            s.login_name,
            s.host_name,
            s.program_name,
            DB_NAME(s.database_id) AS [database],
            t.transaction_id,
            t.name AS [transaction_name],
            DATEDIFF(SECOND, at.transaction_begin_time, GETDATE()) AS [duration_seconds],
            at.transaction_begin_time,
            CASE at.transaction_type
              WHEN 1 THEN 'Read/Write'
              WHEN 2 THEN 'Read-Only'
              WHEN 3 THEN 'System'
              WHEN 4 THEN 'Distributed'
            END AS [transaction_type],
            CASE at.transaction_state
              WHEN 0 THEN 'Not initialized'
              WHEN 1 THEN 'Initialized'
              WHEN 2 THEN 'Active'
              WHEN 3 THEN 'Ended'
              WHEN 4 THEN 'Commit initiated'
              WHEN 5 THEN 'Prepared'
              WHEN 6 THEN 'Committed'
              WHEN 7 THEN 'Rolling back'
              WHEN 8 THEN 'Rolled back'
            END AS [state]
          FROM sys.dm_tran_active_transactions at
          JOIN sys.dm_tran_session_transactions t ON at.transaction_id = t.transaction_id
          JOIN sys.dm_exec_sessions s ON t.session_id = s.session_id
          WHERE at.transaction_begin_time < DATEADD(SECOND, -5, GETDATE())
            AND s.session_id != @@SPID
          ORDER BY at.transaction_begin_time ASC`
        );

        return {
          content: [{
            type: "text" as const,
            text: result.recordset.length === 0
              ? "No long-running transactions found."
              : formatResultSet(result),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ─── get_space_usage ───
  server.tool(
    "get_space_usage",
    "Get detailed disk space usage by table in a database",
    {
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      top: z.number().optional().describe("Number of top tables to return (default: 20)"),
    },
    async ({ database, top }) => {
      const db = database ?? config.connection.database;
      const n = top ?? 20;

      if (!isDatabaseAllowed(db, config.security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      try {
        const result = await executeQuery(
          config.connection,
          `USE ${escapeIdentifier(db)};
          SELECT TOP (${n})
            s.name AS [schema],
            t.name AS [table],
            p.rows AS [row_count],
            CAST(ROUND(SUM(a.total_pages) * 8.0 / 1024, 2) AS DECIMAL(18,2)) AS [total_mb],
            CAST(ROUND(SUM(a.used_pages) * 8.0 / 1024, 2) AS DECIMAL(18,2)) AS [used_mb],
            CAST(ROUND(SUM(CASE WHEN i.index_id > 1 THEN a.total_pages ELSE 0 END) * 8.0 / 1024, 2) AS DECIMAL(18,2)) AS [index_mb],
            CAST(ROUND((SUM(a.total_pages) - SUM(a.used_pages)) * 8.0 / 1024, 2) AS DECIMAL(18,2)) AS [unused_mb]
          FROM sys.tables t
          JOIN sys.schemas s ON t.schema_id = s.schema_id
          JOIN sys.indexes i ON t.object_id = i.object_id
          JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
          JOIN sys.allocation_units a ON p.partition_id = a.container_id
          GROUP BY s.name, t.name, p.rows
          ORDER BY SUM(a.total_pages) DESC`
        );

        return {
          content: [{
            type: "text" as const,
            text: result.recordset.length === 0
              ? "No tables found."
              : formatResultSet(result),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ─── rebuild_index ───
  server.tool(
    "rebuild_index",
    "Rebuild or reorganize a fragmented index. Requires admin security mode.",
    {
      table: z.string().describe("Table name"),
      index: z.string().describe("Index name"),
      schema: z.string().optional().describe("Schema name (default: dbo)"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      mode: z
        .enum(["rebuild", "reorganize"])
        .optional()
        .describe("Operation mode (default: rebuild)"),
    },
    async ({ table, index, schema, database, mode }) => {
      if (!config.security.allowDDL) {
        return {
          content: [{ type: "text" as const, text: "Error: Index rebuild/reorganize requires admin security mode." }],
          isError: true,
        };
      }

      const db = database ?? config.connection.database;
      const sch = schema ?? "dbo";
      const op = mode ?? "rebuild";

      if (!isDatabaseAllowed(db, config.security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      try {
        const eTable = `${escapeIdentifier(sch)}.${escapeIdentifier(table)}`;
        const eIndex = escapeIdentifier(index);
        const stmt = op === "rebuild"
          ? `USE ${escapeIdentifier(db)}; ALTER INDEX ${eIndex} ON ${eTable} REBUILD`
          : `USE ${escapeIdentifier(db)}; ALTER INDEX ${eIndex} ON ${eTable} REORGANIZE`;

        await executeQuery(config.connection, stmt);

        return {
          content: [{
            type: "text" as const,
            text: `Index ${index} on ${sch}.${table} ${op === "rebuild" ? "rebuilt" : "reorganized"} successfully.`,
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ─── get_backup_history ───
  server.tool(
    "get_backup_history",
    "Get recent backup history for a database from msdb",
    {
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      top: z.number().optional().describe("Number of recent backups to show (default: 10)"),
    },
    async ({ database, top }) => {
      const db = database ?? config.connection.database;
      const n = top ?? 10;

      try {
        const result = await executeQuery(
          config.connection,
          `SELECT TOP (${n})
            bs.database_name AS [database],
            CASE bs.type
              WHEN 'D' THEN 'Full'
              WHEN 'I' THEN 'Differential'
              WHEN 'L' THEN 'Log'
              WHEN 'F' THEN 'File/Filegroup'
            END AS [backup_type],
            bs.backup_start_date,
            bs.backup_finish_date,
            DATEDIFF(SECOND, bs.backup_start_date, bs.backup_finish_date) AS [duration_seconds],
            CAST(bs.backup_size / 1024.0 / 1024.0 AS DECIMAL(18,2)) AS [size_mb],
            CAST(bs.compressed_backup_size / 1024.0 / 1024.0 AS DECIMAL(18,2)) AS [compressed_mb],
            bmf.physical_device_name AS [device],
            bs.recovery_model,
            bs.server_name
          FROM msdb.dbo.backupset bs
          JOIN msdb.dbo.backupmediafamily bmf ON bs.media_set_id = bmf.media_set_id
          WHERE bs.database_name = @database
          ORDER BY bs.backup_finish_date DESC`,
          { database: db }
        );

        return {
          content: [{
            type: "text" as const,
            text: result.recordset.length === 0
              ? `No backup history found for database '${db}'.`
              : formatResultSet(result),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ─── get_query_store_stats ───
  server.tool(
    "get_query_store_stats",
    "Get top resource-consuming queries from Query Store (SQL Server 2016+). Query Store must be enabled on the database.",
    {
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      sort_by: z
        .enum(["cpu", "duration", "reads", "writes", "executions"])
        .optional()
        .describe("Sort metric (default: cpu)"),
      top: z.number().optional().describe("Number of top queries (default: 10)"),
    },
    async ({ database, sort_by, top }) => {
      const db = database ?? config.connection.database;
      const n = top ?? 10;
      const metric = sort_by ?? "cpu";

      if (!isDatabaseAllowed(db, config.security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      const orderCol = {
        cpu: "rs.avg_cpu_time",
        duration: "rs.avg_duration",
        reads: "rs.avg_logical_io_reads",
        writes: "rs.avg_logical_io_writes",
        executions: "rs.count_executions",
      }[metric];

      try {
        const result = await executeQuery(
          config.connection,
          `USE ${escapeIdentifier(db)};
          SELECT TOP (${n})
            q.query_id,
            qt.query_sql_text,
            rs.count_executions,
            CAST(rs.avg_cpu_time / 1000.0 AS DECIMAL(18,2)) AS [avg_cpu_ms],
            CAST(rs.avg_duration / 1000.0 AS DECIMAL(18,2)) AS [avg_duration_ms],
            rs.avg_logical_io_reads,
            rs.avg_logical_io_writes,
            rs.avg_rowcount,
            rs.last_execution_time,
            p.plan_id,
            TRY_CAST(p.query_plan AS XML).value('declare namespace qp="http://schemas.microsoft.com/sqlserver/2004/07/showplan"; (//qp:StmtSimple/@StatementEstRows)[1]', 'float') AS [estimated_rows]
          FROM sys.query_store_query q
          JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
          JOIN sys.query_store_plan p ON q.query_id = p.query_id
          JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
          JOIN sys.query_store_runtime_stats_interval rsi ON rs.runtime_stats_interval_id = rsi.runtime_stats_interval_id
          WHERE rsi.start_time > DATEADD(DAY, -7, GETUTCDATE())
          ORDER BY ${orderCol} DESC`
        );

        if (result.recordset.length === 0) {
          return { content: [{ type: "text" as const, text: "No Query Store data found. Make sure Query Store is enabled on this database." }] };
        }

        return { content: [{ type: "text" as const, text: formatResultSet(result) }] };
      } catch (err: any) {
        const msg = err.message?.includes("query_store")
          ? `Query Store is not enabled on database '${db}'. Enable it with: ALTER DATABASE ${escapeIdentifier(db)} SET QUERY_STORE = ON`
          : err.message;
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ─── generate_test_data ───
  server.tool(
    "generate_test_data",
    "Generate INSERT statements with realistic fake/test data based on table schema",
    {
      table: z.string().describe("Table name"),
      schema: z.string().optional().describe("Schema name (default: dbo)"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      count: z.number().optional().describe("Number of rows to generate (default: 10, max: 100)"),
    },
    async ({ table, schema, database, count }) => {
      const db = database ?? config.connection.database;
      const sch = schema ?? "dbo";
      const n = Math.min(count ?? 10, 100);

      if (!isDatabaseAllowed(db, config.security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      try {
        const eDb = escapeIdentifier(db);
        const colResult = await executeQuery(
          config.connection,
          `SELECT c.name, tp.name AS type, c.max_length, c.precision, c.scale,
                  c.is_nullable, c.is_identity, c.is_computed
           FROM ${eDb}.sys.columns c
           JOIN ${eDb}.sys.types tp ON c.user_type_id = tp.user_type_id
           JOIN ${eDb}.sys.objects o ON c.object_id = o.object_id
           JOIN ${eDb}.sys.schemas s ON o.schema_id = s.schema_id
           WHERE o.name = @table AND s.name = @schema
             AND c.is_identity = 0 AND c.is_computed = 0
           ORDER BY c.column_id`,
          { table, schema: sch }
        );

        if (colResult.recordset.length === 0) {
          return { content: [{ type: "text" as const, text: `Table '${sch}.${table}' not found or has no insertable columns.` }] };
        }

        const cols = colResult.recordset;
        const eTable = `${escapeIdentifier(sch)}.${escapeIdentifier(table)}`;
        const colList = cols.map((c: any) => escapeIdentifier(c.name)).join(", ");

        const lines = [
          `-- Test data for ${sch}.${table}`,
          `-- Generated: ${new Date().toISOString().slice(0, 19)}`,
          "",
        ];

        for (let i = 0; i < n; i++) {
          const values = cols.map((col: any) => generateFakeValue(col, i));
          lines.push(`INSERT INTO ${eTable} (${colList}) VALUES (${values.join(", ")});`);
        }

        lines.push("", `-- ${n} row(s)`);
        return { content: [{ type: "text" as const, text: "```sql\n" + lines.join("\n") + "\n```" }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ─── health_check ───
  server.tool(
    "health_check",
    "Check SQL Server connection health and basic responsiveness",
    {},
    async () => {
      try {
        const start = Date.now();
        const result = await executeQuery(
          config.connection,
          `SELECT
            @@VERSION AS [version],
            GETDATE() AS [server_time],
            DB_NAME() AS [current_database],
            SUSER_NAME() AS [login],
            (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1) AS [active_sessions],
            (SELECT cntr_value FROM sys.dm_os_performance_counters
             WHERE counter_name = 'Batch Requests/sec') AS [batch_requests_sec]`
        );
        const latency = Date.now() - start;

        const row = result.recordset[0];
        const lines = [
          "## Health Check",
          `- **Status**: OK`,
          `- **Latency**: ${latency}ms`,
          `- **Server Time**: ${row.server_time}`,
          `- **Database**: ${row.current_database}`,
          `- **Login**: ${row.login}`,
          `- **Active Sessions**: ${row.active_sessions}`,
          `- **Batch Requests/sec**: ${row.batch_requests_sec ?? "N/A"}`,
          `- **Version**: ${String(row.version).split("\n")[0]}`,
        ];

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err: any) {
        return {
          content: [{
            type: "text" as const,
            text: `## Health Check\n- **Status**: FAILED\n- **Error**: ${err.message}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ─── Test data generation helpers ───

function generateFakeValue(col: any, rowIndex: number): string {
  if (col.is_nullable && rowIndex % 7 === 0) return "NULL";

  const name = col.name.toLowerCase();
  const type = col.type.toLowerCase();
  const i = rowIndex + 1;

  // Smart column name heuristics
  if (name.includes("email")) return `N'user${i}@example.com'`;
  if (name.includes("phone")) return `N'+1-555-${String(1000 + i).slice(1)}-${String(1000 + i * 3).slice(1)}'`;
  if (name.includes("first_name") || name === "firstname") {
    const names = ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Henry", "Ivy", "Jack"];
    return `N'${names[i % names.length]}'`;
  }
  if (name.includes("last_name") || name === "lastname" || name === "surname") {
    const names = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Wilson", "Taylor"];
    return `N'${names[i % names.length]}'`;
  }
  if (name === "name" || name.includes("_name")) return `N'TestName_${i}'`;
  if (name.includes("address") || name.includes("street")) return `N'${100 + i} Test Street'`;
  if (name.includes("city")) {
    const cities = ["New York", "London", "Tokyo", "Paris", "Berlin", "Sydney", "Toronto", "Istanbul", "Mumbai", "Seoul"];
    return `N'${cities[i % cities.length]}'`;
  }
  if (name.includes("country")) return `N'Country_${i}'`;
  if (name.includes("zip") || name.includes("postal")) return `N'${String(10000 + i)}'`;
  if (name.includes("url") || name.includes("website")) return `N'https://example.com/${i}'`;
  if (name.includes("description") || name.includes("notes") || name.includes("comment")) return `N'Sample text for row ${i}'`;
  if (name.includes("price") || name.includes("amount") || name.includes("cost")) return `${(i * 9.99).toFixed(2)}`;
  if (name.includes("quantity") || name.includes("count") || name.includes("qty")) return `${i * 5}`;
  if (name.includes("active") || name.includes("enabled") || name.includes("is_")) return `${i % 2}`;

  // Type-based fallbacks
  switch (type) {
    case "bit": return `${i % 2}`;
    case "int": case "smallint": case "tinyint": return `${i}`;
    case "bigint": return `${i * 1000}`;
    case "decimal": case "numeric": case "money": case "smallmoney":
    case "float": case "real": return `${(i * 1.5).toFixed(2)}`;
    case "date": return `'2025-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}'`;
    case "datetime": case "datetime2": case "smalldatetime":
      return `'2025-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")} ${String(i % 24).padStart(2, "0")}:00:00'`;
    case "time": return `'${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00'`;
    case "uniqueidentifier": return `NEWID()`;
    case "varchar": case "nvarchar": case "char": case "nchar": case "text": case "ntext":
      return `N'Test_${col.name}_${i}'`;
    case "binary": case "varbinary": case "image":
      return `0x${i.toString(16).padStart(4, "0")}`;
    default: return `N'${i}'`;
  }
}
