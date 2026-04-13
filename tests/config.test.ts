import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveServer, loadConfig, type AppConfig, type SecurityConfig, type ConnectionConfig } from "../src/config.js";

// ─── Helper ───

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    servers: {
      default: {
        connection: {
          host: "localhost",
          port: 1433,
          database: "master",
          authentication: { type: "sql", user: "sa", password: "pass" },
          encrypt: false,
          trustServerCertificate: true,
          connectionTimeout: 15000,
          requestTimeout: 30000,
          pool: { min: 0, max: 10, idleTimeout: 30000 },
        },
        security: {
          mode: "readonly",
          allowedDatabases: [],
          blockedDatabases: [],
          allowedSchemas: [],
          blockedSchemas: [],
          maxRowCount: 1000,
          queryTimeout: 30000,
          allowDDL: false,
          allowMutations: false,
          blockedKeywords: ["xp_cmdshell"],
          maskColumns: [],
        },
      },
    },
    defaultServer: "default",
    ...overrides,
  };
}

// ─── resolveServer ───

describe("resolveServer", () => {
  it("returns default server when no name specified", () => {
    const config = makeConfig();
    const result = resolveServer(config);
    expect(result.serverName).toBe("default");
    expect(result.connection.host).toBe("localhost");
    expect(result.security.mode).toBe("readonly");
  });

  it("returns named server when specified", () => {
    const config = makeConfig({
      servers: {
        default: makeConfig().servers.default,
        prod: {
          connection: {
            ...makeConfig().servers.default.connection,
            host: "prod-server",
          },
          security: {
            ...makeConfig().servers.default.security,
            mode: "admin",
          },
        },
      },
    });
    const result = resolveServer(config, "prod");
    expect(result.serverName).toBe("prod");
    expect(result.connection.host).toBe("prod-server");
    expect(result.security.mode).toBe("admin");
  });

  it("throws for unknown server name", () => {
    const config = makeConfig();
    expect(() => resolveServer(config, "nonexistent")).toThrow("Unknown server: 'nonexistent'");
  });

  it("includes available server names in error message", () => {
    const config = makeConfig({
      servers: {
        dev: makeConfig().servers.default,
        staging: makeConfig().servers.default,
      },
      defaultServer: "dev",
    });
    expect(() => resolveServer(config, "prod")).toThrow("dev, staging");
  });

  it("returns a new object (not a reference to config.servers entry)", () => {
    const config = makeConfig();
    const result = resolveServer(config);
    expect(result).not.toBe(config.servers.default);
  });
});

// ─── loadConfig ───

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear MSSQL env vars
    delete process.env.MSSQL_HOST;
    delete process.env.MSSQL_PORT;
    delete process.env.MSSQL_DATABASE;
    delete process.env.MSSQL_USER;
    delete process.env.MSSQL_PASSWORD;
    delete process.env.MSSQL_MCP_CONFIG;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it("loads defaults when no config file exists", () => {
    const config = loadConfig("/nonexistent/path.yaml");
    expect(config.defaultServer).toBe("default");
    expect(config.servers.default).toBeDefined();
    expect(config.servers.default.connection.host).toBe("localhost");
    expect(config.servers.default.connection.port).toBe(1433);
    expect(config.servers.default.security.mode).toBe("readonly");
  });

  it("applies env var overrides to default server", () => {
    process.env.MSSQL_HOST = "env-host";
    process.env.MSSQL_PORT = "2433";
    process.env.MSSQL_DATABASE = "envdb";

    const config = loadConfig("/nonexistent/path.yaml");
    expect(config.servers.default.connection.host).toBe("env-host");
    expect(config.servers.default.connection.port).toBe(2433);
    expect(config.servers.default.connection.database).toBe("envdb");
  });

  it("applies MSSQL_USER env var", () => {
    process.env.MSSQL_USER = "admin";
    const config = loadConfig("/nonexistent/path.yaml");
    expect(config.servers.default.connection.authentication.user).toBe("admin");
  });

  it("applies MSSQL_PASSWORD env var", () => {
    process.env.MSSQL_PASSWORD = "supersecret";
    const config = loadConfig("/nonexistent/path.yaml");
    expect(config.servers.default.connection.authentication.password).toBe("supersecret");
  });

  it("defaults security mode to readonly", () => {
    const config = loadConfig("/nonexistent/path.yaml");
    expect(config.servers.default.security.allowDDL).toBe(false);
    expect(config.servers.default.security.allowMutations).toBe(false);
  });

  it("loads single-server YAML config", () => {
    const config = loadConfig("config.example.yaml");
    expect(config.defaultServer).toBe("default");
    expect(config.servers.default).toBeDefined();
  });
});
