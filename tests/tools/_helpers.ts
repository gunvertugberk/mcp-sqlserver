import { vi } from "vitest";
import type { AppConfig, SecurityConfig, ConnectionConfig } from "../../src/config.js";

/**
 * Build a minimal AppConfig for tool handler tests.
 */
export function makeTestConfig(overrides: {
  security?: Partial<SecurityConfig>;
  connection?: Partial<ConnectionConfig>;
  servers?: Record<string, { connection?: Partial<ConnectionConfig>; security?: Partial<SecurityConfig> }>;
  defaultServer?: string;
} = {}): AppConfig {
  const baseSecurity: SecurityConfig = {
    mode: "readonly",
    allowedDatabases: [],
    blockedDatabases: [],
    allowedSchemas: [],
    blockedSchemas: [],
    maxRowCount: 1000,
    queryTimeout: 30000,
    allowDDL: false,
    allowMutations: false,
    blockedKeywords: ["xp_cmdshell", "SHUTDOWN", "DROP DATABASE", "RECONFIGURE", "sp_configure"],
    maskColumns: [],
    ...overrides.security,
  };

  const baseConnection: ConnectionConfig = {
    host: "localhost",
    port: 1433,
    database: "testdb",
    authentication: { type: "sql", user: "sa", password: "pass" },
    encrypt: false,
    trustServerCertificate: true,
    connectionTimeout: 15000,
    requestTimeout: 30000,
    pool: { min: 0, max: 10, idleTimeout: 30000 },
    ...overrides.connection,
  };

  if (overrides.servers) {
    const servers: Record<string, any> = {};
    for (const [name, entry] of Object.entries(overrides.servers)) {
      servers[name] = {
        connection: { ...baseConnection, ...entry.connection },
        security: { ...baseSecurity, ...entry.security },
      };
    }
    return { servers, defaultServer: overrides.defaultServer ?? Object.keys(servers)[0] };
  }

  return {
    servers: { default: { connection: baseConnection, security: baseSecurity } },
    defaultServer: "default",
  };
}

/**
 * Build a mock mssql IResult.
 */
export function makeQueryResult(recordset: any[] = [], rowsAffected: number[] = [0]) {
  return { recordset, rowsAffected };
}

/**
 * Extract the handler function from a McpServer tool registration.
 * Returns a map of tool_name → handler.
 */
export function captureToolHandlers(registerFn: (server: any, config: AppConfig) => void, config: AppConfig) {
  const handlers: Record<string, Function> = {};
  const mockServer = {
    tool: (name: string, _desc: string, _schema: any, handler: Function) => {
      handlers[name] = handler;
    },
  };
  registerFn(mockServer as any, config);
  return handlers;
}
