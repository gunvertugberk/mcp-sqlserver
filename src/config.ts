import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { resolve } from "path";

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

export interface AppConfig {
  connection: ConnectionConfig;
  security: SecurityConfig;
}

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

  let fileConfig: Partial<AppConfig> = {};

  for (const p of paths) {
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf-8");
      fileConfig = parseYaml(raw) ?? {};
      break;
    }
  }

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
  if (security.mode === "readwrite") {
    if (fileConfig.security?.allowMutations === undefined) {
      security.allowMutations = true;
    }
  } else if (security.mode === "admin") {
    if (fileConfig.security?.allowMutations === undefined) {
      security.allowMutations = true;
    }
    if (fileConfig.security?.allowDDL === undefined) {
      security.allowDDL = true;
    }
  }

  return { connection, security };
}
