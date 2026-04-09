import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config.js";
import { executeQuery } from "../database.js";
import { isDatabaseAllowed, isSchemaAllowed, escapeIdentifier } from "../utils/security.js";
import { formatResultSet } from "../utils/formatter.js";

export function registerProcedureTools(server: McpServer, config: AppConfig): void {
  // ─── list_procedures ───
  server.tool(
    "list_procedures",
    "List all stored procedures in a database, optionally filtered by schema",
    {
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      schema: z.string().optional().describe("Schema name filter"),
    },
    async ({ database, schema }) => {
      const db = database ?? config.connection.database;
      if (!isDatabaseAllowed(db, config.security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      const eDb = escapeIdentifier(db);
      let query = `
        SELECT
          s.name AS [schema],
          p.name AS [procedure],
          p.create_date,
          p.modify_date
        FROM ${eDb}.sys.procedures p
        JOIN ${eDb}.sys.schemas s ON p.schema_id = s.schema_id
        WHERE 1=1`;

      const params: Record<string, unknown> = {};
      if (schema) {
        query += ` AND s.name = @schema`;
        params.schema = schema;
      }

      query += ` ORDER BY s.name, p.name`;

      const result = await executeQuery(config.connection, query, params);

      const filtered = result.recordset.filter((r: any) =>
        isSchemaAllowed(r.schema, config.security)
      );

      return {
        content: [
          {
            type: "text" as const,
            text: filtered.length === 0
              ? "No stored procedures found."
              : formatResultSet({ ...result, recordset: filtered } as any),
          },
        ],
      };
    }
  );

  // ─── describe_procedure ───
  server.tool(
    "describe_procedure",
    "Get parameter information and source code for a stored procedure",
    {
      procedure: z.string().describe("Stored procedure name"),
      schema: z.string().optional().describe("Schema name (default: dbo)"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
    },
    async ({ procedure, schema, database }) => {
      const db = database ?? config.connection.database;
      const sch = schema ?? "dbo";

      if (!isDatabaseAllowed(db, config.security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      const eDb = escapeIdentifier(db);

      // Get parameters
      const paramQuery = `
        SELECT
          par.name AS [parameter],
          tp.name AS [type],
          par.max_length,
          par.precision,
          par.scale,
          par.is_output,
          par.has_default_value,
          par.default_value
        FROM ${eDb}.sys.parameters par
        JOIN ${eDb}.sys.procedures p ON par.object_id = p.object_id
        JOIN ${eDb}.sys.schemas s ON p.schema_id = s.schema_id
        JOIN ${eDb}.sys.types tp ON par.user_type_id = tp.user_type_id
        WHERE p.name = @procedure
          AND s.name = @schema
        ORDER BY par.parameter_id`;

      // Get source — use escaped identifiers for OBJECT_ID
      const qualifiedName = `${eDb}.${escapeIdentifier(sch)}.${escapeIdentifier(procedure)}`;
      const srcQuery = `SELECT OBJECT_DEFINITION(OBJECT_ID('${qualifiedName.replace(/'/g, "''")}')) AS [definition]`;

      const [paramResult, srcResult] = await Promise.all([
        executeQuery(config.connection, paramQuery, { procedure, schema: sch }),
        executeQuery(config.connection, srcQuery),
      ]);

      const parts: string[] = [];

      if (paramResult.recordset.length > 0) {
        parts.push("## Parameters\n" + formatResultSet(paramResult));
      } else {
        parts.push("## Parameters\nNo parameters.");
      }

      const definition = srcResult.recordset?.[0]?.definition;
      if (definition) {
        parts.push("\n## Source Code\n```sql\n" + definition + "\n```");
      }

      return {
        content: [{ type: "text" as const, text: parts.join("\n") }],
      };
    }
  );

  // ─── execute_procedure ───
  server.tool(
    "execute_procedure",
    "Execute a stored procedure with parameters. Requires readwrite or admin security mode.",
    {
      procedure: z.string().describe("Stored procedure name (e.g. 'dbo.MyProc')"),
      parameters: z
        .record(z.unknown())
        .optional()
        .describe("Key-value pairs of parameter names and values (without @ prefix)"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
    },
    async ({ procedure, parameters, database }) => {
      try {
        if (!config.security.allowMutations) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Stored procedure execution requires readwrite or admin security mode.",
              },
            ],
            isError: true,
          };
        }

        const db = database ?? config.connection.database;
        if (!isDatabaseAllowed(db, config.security)) {
          return {
            content: [{ type: "text" as const, text: `Access denied to database: ${db}` }],
            isError: true,
          };
        }

        // Build EXEC statement with parameters
        const paramEntries = parameters ? Object.entries(parameters) : [];
        const paramStr = paramEntries
          .map(([key]) => `@${key} = @${key}`)
          .join(", ");

        const eProcedure = escapeIdentifier(procedure);
        const execSql = database
          ? `USE ${escapeIdentifier(database)};\nEXEC ${eProcedure} ${paramStr}`
          : `EXEC ${eProcedure} ${paramStr}`;

        const result = await executeQuery(
          config.connection,
          execSql,
          parameters as Record<string, unknown> | undefined
        );

        if (result.recordset && result.recordset.length > 0) {
          return {
            content: [{ type: "text" as const, text: formatResultSet(result) }],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Procedure executed successfully. Rows affected: ${result.rowsAffected?.[0] ?? 0}`,
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
