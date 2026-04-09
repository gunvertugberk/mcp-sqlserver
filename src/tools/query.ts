import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config.js";
import { executeQuery } from "../database.js";
import {
  validateQuery,
  ensureRowLimit,
  applyMasking,
  escapeIdentifier,
} from "../utils/security.js";
import { formatResultSet } from "../utils/formatter.js";

export function registerQueryTools(server: McpServer, config: AppConfig): void {
  // ─── execute_query ───
  server.tool(
    "execute_query",
    "Execute a read-only SQL query (SELECT). Automatically applies row limits from configuration.",
    {
      sql: z.string().describe("The SQL SELECT query to execute"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
    },
    async ({ sql: sqlQuery, database }) => {
      try {
        // Validate it's a SELECT
        const trimmed = sqlQuery.trim();
        if (!/^\s*(SELECT|WITH)\s/i.test(trimmed)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: execute_query only accepts SELECT/WITH queries. Use execute_mutation for INSERT/UPDATE/DELETE.",
              },
            ],
            isError: true,
          };
        }

        validateQuery(sqlQuery, config.security);

        // Apply row limit
        const limited = ensureRowLimit(sqlQuery, config.security.maxRowCount);

        // Optionally switch database context
        const query = database
          ? `USE ${escapeIdentifier(database)};\n${limited}`
          : limited;

        const result = await executeQuery(config.connection, query);

        // Apply masking
        if (config.security.maskColumns.length > 0 && result.recordset) {
          result.recordset = applyMasking(
            result.recordset,
            "",
            config.security.maskColumns
          ) as any;
        }

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

  // ─── execute_mutation ───
  server.tool(
    "execute_mutation",
    "Execute a data modification query (INSERT, UPDATE, DELETE, MERGE). Requires readwrite or admin security mode.",
    {
      sql: z.string().describe("The SQL mutation query to execute"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
    },
    async ({ sql: sqlQuery, database }) => {
      try {
        validateQuery(sqlQuery, config.security);

        // Verify it's actually a mutation
        const trimmed = sqlQuery.trim();
        if (!/^\s*(INSERT|UPDATE|DELETE|MERGE)\s/i.test(trimmed)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: execute_mutation only accepts INSERT/UPDATE/DELETE/MERGE. Use execute_query for SELECT, or execute_ddl for CREATE/ALTER/DROP.",
              },
            ],
            isError: true,
          };
        }

        const query = database
          ? `USE ${escapeIdentifier(database)};\n${sqlQuery}`
          : sqlQuery;

        const result = await executeQuery(config.connection, query);

        return {
          content: [
            {
              type: "text" as const,
              text: `Mutation executed successfully. Rows affected: ${result.rowsAffected?.[0] ?? 0}`,
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
