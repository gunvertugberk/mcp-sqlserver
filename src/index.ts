#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { closePool } from "./database.js";

async function main(): Promise<void> {
  // Parse CLI args
  const args = process.argv.slice(2);
  let configPath: string | undefined;
  let httpPort: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" || args[i] === "-c") {
      configPath = args[++i];
    }
    if (args[i] === "--http") {
      httpPort = parseInt(args[++i] || "3000", 10);
    }
    if (args[i] === "--help" || args[i] === "-h") {
      console.error(`
mssql-mcp-server — MCP server for SQL Server

Usage:
  mssql-mcp-server [options]

Options:
  -c, --config <path>   Path to YAML config file (default: ./mssql-mcp.yaml)
  --http <port>         Start in HTTP/SSE mode on the given port (default: 3000)
  -h, --help            Show this help message

Environment Variables:
  MSSQL_HOST            SQL Server hostname
  MSSQL_PORT            SQL Server port
  MSSQL_DATABASE        Default database
  MSSQL_USER            SQL authentication username
  MSSQL_PASSWORD        SQL authentication password
  MSSQL_MCP_CONFIG      Path to config file

Config File Search Order:
  1. --config flag
  2. MSSQL_MCP_CONFIG env var
  3. ./mssql-mcp.yaml in current directory
  4. ./mssql-mcp.yml in current directory
  5. Defaults (localhost:1433, readonly mode)

Security Modes:
  readonly    — SELECT queries only (default)
  readwrite   — SELECT + INSERT/UPDATE/DELETE + stored procedures
  admin       — All of the above + DDL (CREATE/ALTER/DROP)

Transport Modes:
  (default)   — stdio transport (for MCP clients like Claude Desktop, VS Code, etc.)
  --http      — Streamable HTTP transport (for remote hosting / web integrations)
`);
      process.exit(0);
    }
  }

  const config = loadConfig(configPath);

  console.error(`[mssql-mcp-server] Starting...`);
  console.error(`[mssql-mcp-server] Host: ${config.connection.host}:${config.connection.port}`);
  console.error(`[mssql-mcp-server] Database: ${config.connection.database}`);
  console.error(`[mssql-mcp-server] Auth: ${config.connection.authentication.type}`);
  console.error(`[mssql-mcp-server] Security mode: ${config.security.mode}`);

  const server = createServer(config);

  // Graceful shutdown
  const shutdown = async () => {
    console.error("[mssql-mcp-server] Shutting down...");
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (httpPort) {
    // Streamable HTTP transport
    const { StreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/streamableHttp.js"
    );
    const http = await import("http");

    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${httpPort}`);

      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (url.pathname === "/mcp") {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } else if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", mode: config.security.mode }));
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    httpServer.listen(httpPort, () => {
      console.error(`[mssql-mcp-server] HTTP transport listening on http://localhost:${httpPort}/mcp`);
      console.error(`[mssql-mcp-server] Health check: http://localhost:${httpPort}/health`);
    });
  } else {
    // Default: stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[mssql-mcp-server] Connected and ready (stdio).");
  }
}

main().catch((err) => {
  console.error("[mssql-mcp-server] Fatal error:", err);
  process.exit(1);
});
