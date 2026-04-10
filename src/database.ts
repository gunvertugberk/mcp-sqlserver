import sql from "mssql";
import type { ConnectionConfig } from "./config.js";

const pools = new Map<string, sql.ConnectionPool>();

function buildSqlConfig(config: ConnectionConfig): sql.config {
  const base: sql.config = {
    server: config.host,
    port: config.port,
    database: config.database,
    connectionTimeout: config.connectionTimeout,
    requestTimeout: config.requestTimeout,
    pool: {
      min: config.pool.min,
      max: config.pool.max,
      idleTimeoutMillis: config.pool.idleTimeout,
    },
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
    },
  };

  switch (config.authentication.type) {
    case "sql":
      base.user = config.authentication.user;
      base.password = config.authentication.password;
      break;

    case "windows":
      if (config.authentication.user && config.authentication.password) {
        // NTLM — works with tedious, no extra packages needed
        base.authentication = {
          type: "ntlm",
          options: {
            domain: config.authentication.domain || "",
            userName: config.authentication.user,
            password: config.authentication.password,
          },
        };
      } else {
        // SSPI (Integrated Security) — requires msnodesqlv8
        try {
          require("msnodesqlv8");
          const server = config.host;
          const db = config.database || "master";
          (base as any).connectionString =
            `Driver={ODBC Driver 17 for SQL Server};Server=${server};Database=${db};Trusted_Connection=yes;`;
          (base as any).server = undefined;
          (base as any).port = undefined;
          (base as any).database = undefined;
        } catch {
          throw new Error(
            "Windows Authentication (SSPI) without credentials requires 'msnodesqlv8'.\n" +
            "Either:\n" +
            "  1. Provide user, password (and optionally domain) in config for NTLM auth\n" +
            "  2. Install msnodesqlv8: npm install msnodesqlv8"
          );
        }
      }
      break;

    case "azure-ad":
      base.authentication = {
        type: "azure-active-directory-service-principal-secret",
        options: {
          clientId: config.authentication.clientId!,
          clientSecret: config.authentication.clientSecret!,
          tenantId: config.authentication.tenantId!,
        },
      };
      break;
  }

  return base;
}

export async function getPool(
  config: ConnectionConfig,
  serverName: string = "default"
): Promise<sql.ConnectionPool> {
  const existing = pools.get(serverName);
  if (existing?.connected) {
    return existing;
  }

  const sqlConfig = buildSqlConfig(config);
  const newPool = new sql.ConnectionPool(sqlConfig);

  newPool.on("error", (err) => {
    console.error(`[mssql-mcp] Pool error (${serverName}):`, err.message);
    pools.delete(serverName);
  });

  pools.set(serverName, newPool);
  await newPool.connect();
  return newPool;
}

export async function executeQuery(
  config: ConnectionConfig,
  query: string,
  params?: Record<string, unknown>,
  serverName: string = "default"
): Promise<sql.IResult<any>> {
  const p = await getPool(config, serverName);
  const request = p.request();

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value);
    }
  }

  return request.query(query);
}

export async function closePool(serverName?: string): Promise<void> {
  if (serverName) {
    const pool = pools.get(serverName);
    if (pool) {
      await pool.close();
      pools.delete(serverName);
    }
  } else {
    // Close all pools
    for (const [, pool] of pools) {
      await pool.close();
    }
    pools.clear();
  }
}
