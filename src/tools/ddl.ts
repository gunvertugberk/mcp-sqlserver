import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveServer, type AppConfig } from "../config.js";
import { executeQuery } from "../database.js";
import { validateQuery, escapeIdentifier, isDatabaseAllowed } from "../utils/security.js";

export function registerDDLTools(server: McpServer, config: AppConfig): void {
  // ─── execute_ddl ───
  server.tool(
    "execute_ddl",
    "Execute a DDL statement (CREATE, ALTER, DROP, TRUNCATE). Requires admin security mode or allowDDL: true.",
    {
      sql: z.string().describe("The DDL statement to execute"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ sql: sqlQuery, database, server: srv }) => {
      try {
        const { connection, security, serverName } = resolveServer(config, srv);

        // Verify it's DDL
        const trimmed = sqlQuery.trim();
        if (!/^\s*(CREATE|ALTER|DROP|TRUNCATE)\s/i.test(trimmed)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: execute_ddl only accepts CREATE/ALTER/DROP/TRUNCATE statements.",
              },
            ],
            isError: true,
          };
        }

        if (database && !isDatabaseAllowed(database, security)) {
          return { content: [{ type: "text" as const, text: `Access denied to database: ${database}` }] };
        }

        validateQuery(sqlQuery, security);

        const query = database
          ? `USE ${escapeIdentifier(database)};\n${sqlQuery}`
          : sqlQuery;

        await executeQuery(connection, query, undefined, serverName);

        return {
          content: [
            {
              type: "text" as const,
              text: `DDL executed successfully: ${trimmed.split(/\s+/).slice(0, 3).join(" ")}...`,
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
