import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { resolve } from "path";

// ─── Types ───

export type AuthType = "sql" | "windows" | "azure-ad";
export type SecurityMode = "readonly" | "readwrite" | "admin";

export interface MaskRule {
  pattern: string; // e.g. "*.password", "dbo.users.ssn"
  mask: string;    // e.g. "***", "XXX-XX-XXXX"
}

export interface ConnectionConfig {
  host: string;
  port: number;
  database: string;
  authentication: {
    type: AuthType;
    user?: string;
    password?: string;
    domain?: string;         // for windows auth
    clientId?: string;       // for azure-ad
    clientSecret?: string;   // for azure-ad
    tenantId?: string;       // for azure-ad
  };
  encrypt: boolean;
  trustServerCertificate: boolean;
  connectionTimeout: number;
  requestTimeout: number;
  pool: {
    min: number;
    max: number;
    idleTimeout: number;
  };
}

export interface SecurityConfig {
  mode: SecurityMode;
  allowedDatabases: string[];
  blockedDatabases: string[];
  allowedSchemas: string[];
  blockedSchemas: string[];
  maxRowCount: number;
  queryTimeout: number;
  allowDDL: boolean;
  allowMutations: boolean;
  blockedKeywords: string[];
  maskColumns: MaskRule[];
}

export interface ServerEntry {
  connection: ConnectionConfig;
  security: SecurityConfig;
}

export interface AppConfig {
  servers: Record<string, ServerEntry>;
  defaultServer: string;
}

// ─── Defaults ───

const DEFAULT_CONNECTION: ConnectionConfig = {
  host: "localhost",
  port: 1433,
  database: "master",
  authentication: {
    type: "sql",
    user: "sa",
    password: "",
  },
  encrypt: false,
  trustServerCertificate: true,
  connectionTimeout: 15000,
  requestTimeout: 30000,
  pool: {
    min: 0,
    max: 10,
    idleTimeout: 30000,
  },
};

const DEFAULT_SECURITY: SecurityConfig = {
  mode: "readonly",
  allowedDatabases: [],
  blockedDatabases: [],
  allowedSchemas: [],
  blockedSchemas: [],
  maxRowCount: 1000,
  queryTimeout: 30000,
  allowDDL: false,
  allowMutations: false,
  blockedKeywords: [
    "xp_cmdshell",
    "SHUTDOWN",
    "DROP DATABASE",
    "RECONFIGURE",
    "sp_configure",
  ],
  maskColumns: [],
};

// ─── Helpers ───

function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const val = source[key];
    if (val !== undefined && val !== null) {
      if (Array.isArray(val)) {
        (result as any)[key] = val;
      } else if (typeof val === "object" && !Array.isArray(val)) {
        (result as any)[key] = deepMerge(
          (result[key] as Record<string, any>) ?? {},
          val as Record<string, any>
        );
      } else {
        (result as any)[key] = val;
      }
    }
  }
  return result;
}

function applyModeDefaults(security: SecurityConfig, rawOverrides?: any): void {
  if (security.mode === "readwrite") {
    if (rawOverrides?.allowMutations === undefined) {
      security.allowMutations = true;
    }
  } else if (security.mode === "admin") {
    if (rawOverrides?.allowMutations === undefined) {
      security.allowMutations = true;
    }
    if (rawOverrides?.allowDDL === undefined) {
      security.allowDDL = true;
    }
  }
}

/**
 * Resolve a server entry by name.
 * Returns connection + security config for the named server.
 * Throws if the server name is not found in config.
 */
export function resolveServer(
  config: AppConfig,
  serverName?: string
): ServerEntry & { serverName: string } {
  const name = serverName ?? config.defaultServer;
  const entry = config.servers[name];
  if (!entry) {
    const available = Object.keys(config.servers).join(", ");
    throw new Error(`Unknown server: '${name}'. Available servers: ${available}`);
  }
  return { ...entry, serverName: name };
}

// ─── Config Loading ───

export function loadConfig(configPath?: string): AppConfig {
  // 1. Try explicit path
  // 2. Try env var MSSQL_MCP_CONFIG
  // 3. Try ./mssql-mcp.yaml in cwd
  // 4. Fall back to defaults + env vars

  const paths = [
    configPath,
    process.env.MSSQL_MCP_CONFIG,
    resolve(process.cwd(), "mssql-mcp.yaml"),
    resolve(process.cwd(), "mssql-mcp.yml"),
  ].filter(Boolean) as string[];

  let fileConfig: any = {};

  for (const p of paths) {
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf-8");
      fileConfig = parseYaml(raw) ?? {};
      break;
    }
  }

  // Detect multi-server format: "connections" (plural) key
  if (fileConfig.connections && typeof fileConfig.connections === "object") {
    return loadMultiServer(fileConfig);
  }

  // Single-server format (backward compatible): "connection" (singular)
  return loadSingleServer(fileConfig);
}

// ─── Single-server loading (backward compatible) ───

function loadSingleServer(fileConfig: any): AppConfig {
  // Environment variable overrides
  const envOverrides: Partial<ConnectionConfig> = {};
  if (process.env.MSSQL_HOST) envOverrides.host = process.env.MSSQL_HOST;
  if (process.env.MSSQL_PORT) envOverrides.port = parseInt(process.env.MSSQL_PORT, 10);
  if (process.env.MSSQL_DATABASE) envOverrides.database = process.env.MSSQL_DATABASE;
  if (process.env.MSSQL_USER) {
    envOverrides.authentication = {
      ...DEFAULT_CONNECTION.authentication,
      ...(fileConfig.connection?.authentication ?? {}),
      user: process.env.MSSQL_USER,
    };
  }
  if (process.env.MSSQL_PASSWORD) {
    envOverrides.authentication = {
      ...DEFAULT_CONNECTION.authentication,
      ...(fileConfig.connection?.authentication ?? {}),
      ...envOverrides.authentication,
      password: process.env.MSSQL_PASSWORD,
    };
  }

  let connection = deepMerge(
    deepMerge(DEFAULT_CONNECTION, (fileConfig.connection ?? {}) as Partial<ConnectionConfig>),
    envOverrides
  );

  // Windows auth: clear default SQL credentials (sa/"") unless explicitly provided
  if (connection.authentication.type === "windows") {
    const authCfg = fileConfig.connection?.authentication;
    if (!authCfg?.user) connection.authentication.user = undefined;
    if (!authCfg?.password) connection.authentication.password = undefined;
  }

  const security = deepMerge(
    DEFAULT_SECURITY,
    (fileConfig.security ?? {}) as Partial<SecurityConfig>
  );

  // Apply mode-based defaults
  applyModeDefaults(security, fileConfig.security);

  return {
    servers: { default: { connection, security } },
    defaultServer: "default",
  };
}

// ─── Multi-server loading ───

function loadMultiServer(fileConfig: any): AppConfig {
  // Global security defaults (applied to all servers, then overridden per-server)
  const globalSecurity = deepMerge(
    DEFAULT_SECURITY,
    (fileConfig.security ?? {}) as Partial<SecurityConfig>
  );

  const servers: Record<string, ServerEntry> = {};
  const rawConnections = fileConfig.connections as Record<string, any>;

  for (const [name, rawEntry] of Object.entries(rawConnections)) {
    if (!rawEntry || typeof rawEntry !== "object") continue;

    // Separate per-server security override from connection fields
    const { security: perServerSecurity, ...connectionFields } = rawEntry as any;

    // Build connection config: defaults + per-server fields
    const connection = deepMerge(
      DEFAULT_CONNECTION,
      connectionFields as Partial<ConnectionConfig>
    );

    // Windows auth cleanup
    if (connection.authentication.type === "windows") {
      const authCfg = connectionFields.authentication;
      if (!authCfg?.user) connection.authentication.user = undefined;
      if (!authCfg?.password) connection.authentication.password = undefined;
    }

    // Build security: global defaults + per-server overrides
    const security = perServerSecurity
      ? deepMerge({ ...globalSecurity }, perServerSecurity as Partial<SecurityConfig>)
      : { ...globalSecurity };

    // Apply mode-based defaults
    applyModeDefaults(security, perServerSecurity);

    servers[name] = { connection, security };
  }

  const defaultServer =
    fileConfig.defaultServer ?? Object.keys(servers)[0] ?? "default";

  // Apply env var overrides to the default server only
  if (servers[defaultServer]) {
    const conn = servers[defaultServer].connection;
    if (process.env.MSSQL_HOST) conn.host = process.env.MSSQL_HOST;
    if (process.env.MSSQL_PORT) conn.port = parseInt(process.env.MSSQL_PORT, 10);
    if (process.env.MSSQL_DATABASE) conn.database = process.env.MSSQL_DATABASE;
    if (process.env.MSSQL_USER) conn.authentication.user = process.env.MSSQL_USER;
    if (process.env.MSSQL_PASSWORD) conn.authentication.password = process.env.MSSQL_PASSWORD;
  }

  return { servers, defaultServer };
}
