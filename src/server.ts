import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "./config.js";
import { registerSchemaTools } from "./tools/schema.js";
import { registerQueryTools } from "./tools/query.js";
import { registerDDLTools } from "./tools/ddl.js";
import { registerProcedureTools } from "./tools/procedure.js";
import { registerPerformanceTools } from "./tools/performance.js";

export function createServer(config: AppConfig): McpServer {
  const server = new McpServer({
    name: "mssql-mcp-server",
    version: "1.0.0",
  });

  // Always register schema discovery (safe, read-only)
  registerSchemaTools(server, config);

  // Always register read queries
  registerQueryTools(server, config);

  // Register DDL tools only if allowed
  if (config.security.allowDDL || config.security.mode === "admin") {
    registerDDLTools(server, config);
  }

  // Register stored procedure tools
  registerProcedureTools(server, config);

  // Register performance/DBA tools (read-only DMVs)
  registerPerformanceTools(server, config);

  return server;
}
