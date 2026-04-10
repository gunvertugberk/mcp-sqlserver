import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveServer, type AppConfig } from "../config.js";
import { executeQuery } from "../database.js";
import { isDatabaseAllowed, isSchemaAllowed, escapeIdentifier } from "../utils/security.js";
import { formatResultSet } from "../utils/formatter.js";

export function registerSchemaTools(server: McpServer, config: AppConfig): void {
  // ─── list_databases ───
  server.tool(
    "list_databases",
    "List all accessible databases on the SQL Server instance",
    {
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ server: srv }) => {
      const { connection, security, serverName } = resolveServer(config, srv);
      const result = await executeQuery(
        connection,
        `SELECT name, database_id, state_desc, recovery_model_desc, compatibility_level
         FROM sys.databases
         ORDER BY name`,
        undefined,
        serverName
      );

      const filtered = result.recordset.filter((r: any) =>
        isDatabaseAllowed(r.name, security)
      );

      return {
        content: [
          {
            type: "text" as const,
            text: formatResultSet({ ...result, recordset: filtered } as any),
          },
        ],
      };
    }
  );

  // ─── list_schemas ───
  server.tool(
    "list_schemas",
    "List all schemas in the current database",
    {
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ database, server: srv }) => {
      const { connection, security, serverName } = resolveServer(config, srv);
      const db = database ?? connection.database;
      if (!isDatabaseAllowed(db, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      const eDb = escapeIdentifier(db);
      const result = await executeQuery(
        connection,
        `SELECT s.name AS schema_name, s.schema_id, p.name AS owner
         FROM ${eDb}.sys.schemas s
         JOIN ${eDb}.sys.database_principals p ON s.principal_id = p.principal_id
         ORDER BY s.name`,
        undefined,
        serverName
      );

      const filtered = result.recordset.filter((r: any) =>
        isSchemaAllowed(r.schema_name, security)
      );

      return {
        content: [
          {
            type: "text" as const,
            text: formatResultSet({ ...result, recordset: filtered } as any),
          },
        ],
      };
    }
  );

  // ─── list_tables ───
  server.tool(
    "list_tables",
    "List all tables in a database, optionally filtered by schema",
    {
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      schema: z.string().optional().describe("Schema name filter (e.g. 'dbo')"),
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ database, schema, server: srv }) => {
      const { connection, security, serverName } = resolveServer(config, srv);
      const db = database ?? connection.database;
      if (!isDatabaseAllowed(db, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      const eDb = escapeIdentifier(db);
      let query = `
        SELECT
          s.name AS [schema],
          t.name AS [table],
          p.rows AS [row_count],
          CAST(ROUND(SUM(a.total_pages) * 8.0 / 1024, 2) AS DECIMAL(18,2)) AS [size_mb]
        FROM ${eDb}.sys.tables t
        JOIN ${eDb}.sys.schemas s ON t.schema_id = s.schema_id
        JOIN ${eDb}.sys.indexes i ON t.object_id = i.object_id
        JOIN ${eDb}.sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
        JOIN ${eDb}.sys.allocation_units a ON p.partition_id = a.container_id
        WHERE i.index_id <= 1`;

      const params: Record<string, unknown> = {};
      if (schema) {
        query += ` AND s.name = @schema`;
        params.schema = schema;
      }

      query += `
        GROUP BY s.name, t.name, p.rows
        ORDER BY s.name, t.name`;

      const result = await executeQuery(connection, query, params, serverName);

      const filtered = result.recordset.filter((r: any) =>
        isSchemaAllowed(r.schema, security)
      );

      return {
        content: [
          {
            type: "text" as const,
            text: formatResultSet({ ...result, recordset: filtered } as any),
          },
        ],
      };
    }
  );

  // ─── list_views ───
  server.tool(
    "list_views",
    "List all views in a database, optionally filtered by schema",
    {
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      schema: z.string().optional().describe("Schema name filter"),
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ database, schema, server: srv }) => {
      const { connection, security, serverName } = resolveServer(config, srv);
      const db = database ?? connection.database;
      if (!isDatabaseAllowed(db, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      const eDb = escapeIdentifier(db);
      let query = `
        SELECT
          s.name AS [schema],
          v.name AS [view],
          v.create_date,
          v.modify_date
        FROM ${eDb}.sys.views v
        JOIN ${eDb}.sys.schemas s ON v.schema_id = s.schema_id
        WHERE 1=1`;

      const params: Record<string, unknown> = {};
      if (schema) {
        query += ` AND s.name = @schema`;
        params.schema = schema;
      }

      query += ` ORDER BY s.name, v.name`;

      const result = await executeQuery(connection, query, params, serverName);

      const filtered = result.recordset.filter((r: any) =>
        isSchemaAllowed(r.schema, security)
      );

      return {
        content: [
          {
            type: "text" as const,
            text: formatResultSet({ ...result, recordset: filtered } as any),
          },
        ],
      };
    }
  );

  // ─── describe_table ───
  server.tool(
    "describe_table",
    "Get detailed column information for a table or view (columns, types, defaults, nullability, identity, computed)",
    {
      table: z.string().describe("Table or view name"),
      schema: z.string().optional().describe("Schema name (default: dbo)"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ table, schema, database, server: srv }) => {
      const { connection, security, serverName } = resolveServer(config, srv);
      const db = database ?? connection.database;
      const sch = schema ?? "dbo";

      if (!isDatabaseAllowed(db, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }
      if (!isSchemaAllowed(sch, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to schema: ${sch}` }] };
      }

      const eDb = escapeIdentifier(db);
      const result = await executeQuery(
        connection,
        `SELECT
          c.name AS [column],
          tp.name AS [type],
          c.max_length,
          c.precision,
          c.scale,
          c.is_nullable,
          c.is_identity,
          c.is_computed,
          dc.definition AS [default],
          cc.definition AS [computed_definition]
        FROM ${eDb}.sys.columns c
        JOIN ${eDb}.sys.types tp ON c.user_type_id = tp.user_type_id
        JOIN ${eDb}.sys.objects o ON c.object_id = o.object_id
        JOIN ${eDb}.sys.schemas s ON o.schema_id = s.schema_id
        LEFT JOIN ${eDb}.sys.default_constraints dc ON c.default_object_id = dc.object_id
        LEFT JOIN ${eDb}.sys.computed_columns cc ON c.object_id = cc.object_id AND c.column_id = cc.column_id
        WHERE o.name = @table
          AND s.name = @schema
        ORDER BY c.column_id`,
        { table, schema: sch },
        serverName
      );

      if (result.recordset.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Table or view '${sch}.${table}' not found in database '${db}'.`,
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: formatResultSet(result) }],
      };
    }
  );

  // ─── get_foreign_keys ───
  server.tool(
    "get_foreign_keys",
    "Get foreign key relationships for a table",
    {
      table: z.string().describe("Table name"),
      schema: z.string().optional().describe("Schema name (default: dbo)"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ table, schema, database, server: srv }) => {
      const { connection, security, serverName } = resolveServer(config, srv);
      const db = database ?? connection.database;
      const sch = schema ?? "dbo";

      if (!isDatabaseAllowed(db, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      const eDb = escapeIdentifier(db);
      const result = await executeQuery(
        connection,
        `SELECT
          fk.name AS [fk_name],
          ps.name AS [parent_schema],
          pt.name AS [parent_table],
          pc.name AS [parent_column],
          rs.name AS [referenced_schema],
          rt.name AS [referenced_table],
          rc.name AS [referenced_column],
          fk.delete_referential_action_desc AS [on_delete],
          fk.update_referential_action_desc AS [on_update]
        FROM ${eDb}.sys.foreign_keys fk
        JOIN ${eDb}.sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        JOIN ${eDb}.sys.tables pt ON fkc.parent_object_id = pt.object_id
        JOIN ${eDb}.sys.schemas ps ON pt.schema_id = ps.schema_id
        JOIN ${eDb}.sys.columns pc ON fkc.parent_object_id = pc.object_id AND fkc.parent_column_id = pc.column_id
        JOIN ${eDb}.sys.tables rt ON fkc.referenced_object_id = rt.object_id
        JOIN ${eDb}.sys.schemas rs ON rt.schema_id = rs.schema_id
        JOIN ${eDb}.sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
        WHERE pt.name = @table
          AND ps.name = @schema
        ORDER BY fk.name, fkc.constraint_column_id`,
        { table, schema: sch },
        serverName
      );

      return {
        content: [
          {
            type: "text" as const,
            text: result.recordset.length === 0
              ? `No foreign keys found for '${sch}.${table}'.`
              : formatResultSet(result),
          },
        ],
      };
    }
  );

  // ─── get_indexes ───
  server.tool(
    "get_indexes",
    "Get index information for a table",
    {
      table: z.string().describe("Table name"),
      schema: z.string().optional().describe("Schema name (default: dbo)"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ table, schema, database, server: srv }) => {
      const { connection, security, serverName } = resolveServer(config, srv);
      const db = database ?? connection.database;
      const sch = schema ?? "dbo";

      if (!isDatabaseAllowed(db, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      const eDb = escapeIdentifier(db);
      const result = await executeQuery(
        connection,
        `SELECT
          i.name AS [index_name],
          i.type_desc AS [type],
          i.is_unique,
          i.is_primary_key,
          STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS [columns],
          STRING_AGG(CASE WHEN ic.is_included_column = 1 THEN c.name END, ', ') AS [included_columns]
        FROM ${eDb}.sys.indexes i
        JOIN ${eDb}.sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        JOIN ${eDb}.sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        JOIN ${eDb}.sys.tables t ON i.object_id = t.object_id
        JOIN ${eDb}.sys.schemas s ON t.schema_id = s.schema_id
        WHERE t.name = @table
          AND s.name = @schema
          AND i.name IS NOT NULL
        GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key
        ORDER BY i.is_primary_key DESC, i.name`,
        { table, schema: sch },
        serverName
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
    }
  );

  // ─── get_constraints ───
  server.tool(
    "get_constraints",
    "Get constraints (PK, unique, check, default) for a table",
    {
      table: z.string().describe("Table name"),
      schema: z.string().optional().describe("Schema name (default: dbo)"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ table, schema, database, server: srv }) => {
      const { connection, security, serverName } = resolveServer(config, srv);
      const db = database ?? connection.database;
      const sch = schema ?? "dbo";

      if (!isDatabaseAllowed(db, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      const eDb = escapeIdentifier(db);
      const result = await executeQuery(
        connection,
        `SELECT
          con.name AS [constraint_name],
          con.type_desc AS [type],
          col.name AS [column],
          chk.definition AS [check_definition],
          dc.definition AS [default_definition]
        FROM ${eDb}.sys.objects con
        JOIN ${eDb}.sys.objects t ON con.parent_object_id = t.object_id
        JOIN ${eDb}.sys.schemas s ON t.schema_id = s.schema_id
        LEFT JOIN ${eDb}.sys.check_constraints chk ON con.object_id = chk.object_id
        LEFT JOIN ${eDb}.sys.default_constraints dc ON con.object_id = dc.object_id
        LEFT JOIN ${eDb}.sys.columns col ON COALESCE(dc.parent_column_id, chk.parent_column_id) = col.column_id
          AND t.object_id = col.object_id
        WHERE t.name = @table
          AND s.name = @schema
          AND con.type IN ('PK', 'UQ', 'C', 'D', 'F')
        ORDER BY con.type_desc, con.name`,
        { table, schema: sch },
        serverName
      );

      return {
        content: [
          {
            type: "text" as const,
            text: result.recordset.length === 0
              ? `No constraints found for '${sch}.${table}'.`
              : formatResultSet(result),
          },
        ],
      };
    }
  );

  // ─── get_triggers ───
  server.tool(
    "get_triggers",
    "Get triggers defined on a table",
    {
      table: z.string().describe("Table name"),
      schema: z.string().optional().describe("Schema name (default: dbo)"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ table, schema, database, server: srv }) => {
      const { connection, security, serverName } = resolveServer(config, srv);
      const db = database ?? connection.database;
      const sch = schema ?? "dbo";

      if (!isDatabaseAllowed(db, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      const eDb = escapeIdentifier(db);
      const result = await executeQuery(
        connection,
        `SELECT
          tr.name AS [trigger_name],
          tr.is_disabled,
          tr.is_instead_of_trigger,
          te.type_desc AS [event_type],
          OBJECT_DEFINITION(tr.object_id) AS [definition]
        FROM ${eDb}.sys.triggers tr
        JOIN ${eDb}.sys.trigger_events te ON tr.object_id = te.object_id
        JOIN ${eDb}.sys.tables t ON tr.parent_id = t.object_id
        JOIN ${eDb}.sys.schemas s ON t.schema_id = s.schema_id
        WHERE t.name = @table
          AND s.name = @schema
        ORDER BY tr.name`,
        { table, schema: sch },
        serverName
      );

      return {
        content: [
          {
            type: "text" as const,
            text: result.recordset.length === 0
              ? `No triggers found for '${sch}.${table}'.`
              : formatResultSet(result),
          },
        ],
      };
    }
  );
}
