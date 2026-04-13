import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "./config.js";
import { registerSchemaTools } from "./tools/schema.js";
import { registerQueryTools } from "./tools/query.js";
import { registerDDLTools } from "./tools/ddl.js";
import { registerProcedureTools } from "./tools/procedure.js";
import { registerPerformanceTools } from "./tools/performance.js";
import { registerUtilityTools } from "./tools/utility.js";
import { registerDBATools } from "./tools/dba.js";

export function createServer(config: AppConfig): McpServer {
  const server = new McpServer({
    name: "mssql-mcp-server",
    version: "1.3.1",
  });

  // ─── list_servers ───
  server.tool(
    "list_servers",
    "List all configured SQL Server connections and their details (host, database, auth type, security mode)",
    {},
    async () => {
      const lines: string[] = ["## Configured Servers\n"];

      for (const [name, entry] of Object.entries(config.servers)) {
        const isDefault = name === config.defaultServer;
        const c = entry.connection;
        const s = entry.security;
        lines.push(`### ${name}${isDefault ? " (default)" : ""}`);
        lines.push(`- **Host**: ${c.host}:${c.port}`);
        lines.push(`- **Database**: ${c.database}`);
        lines.push(`- **Auth**: ${c.authentication.type}`);
        lines.push(`- **Security Mode**: ${s.mode}`);
        lines.push(`- **Max Rows**: ${s.maxRowCount}`);
        lines.push("");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // Always register schema discovery (safe, read-only)
  registerSchemaTools(server, config);

  // Always register read queries
  registerQueryTools(server, config);

  // Register DDL tools if ANY server allows DDL (per-server check inside handler)
  const anyDDL = Object.values(config.servers).some(
    (s) => s.security.allowDDL || s.security.mode === "admin"
  );
  if (anyDDL) {
    registerDDLTools(server, config);
  }

  // Register stored procedure tools
  registerProcedureTools(server, config);

  // Register performance/DBA tools (read-only DMVs)
  registerPerformanceTools(server, config);

  // Register utility tools (schema diff, code gen, ER diagram, sampling, export)
  registerUtilityTools(server, config);

  // Register DBA tools (wait stats, deadlocks, blocking, backup, query store, test data, health check)
  registerDBATools(server, config);

  return server;
}
