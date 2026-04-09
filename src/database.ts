import sql from "mssql";
import type { ConnectionConfig } from "./config.js";

let pool: sql.ConnectionPool | null = null;

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
      // NTLM auth with explicit domain credentials
      if (config.authentication.user && config.authentication.password) {
        base.domain = config.authentication.domain;
        base.user = config.authentication.user;
        base.password = config.authentication.password;
      } else {
        // Integrated security (SSPI) — use current Windows session
        // Requires msnodesqlv8 driver to be installed
        try {
          require("msnodesqlv8");
          const server = config.host;
          const db = config.database || "master";
          (base as any).connectionString =
            `Driver={ODBC Driver 17 for SQL Server};Server=${server};Database=${db};Trusted_Connection=yes;`;
          // Clear individual connection properties to avoid conflicts
          (base as any).server = undefined;
          (base as any).port = undefined;
          (base as any).database = undefined;
        } catch {
          throw new Error(
            "Windows Authentication without user/password requires the 'msnodesqlv8' package. " +
            "Install it with: npm install msnodesqlv8\n" +
            "Alternatively, provide user, password, and domain in the config for NTLM authentication."
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

export async function getPool(config: ConnectionConfig): Promise<sql.ConnectionPool> {
  if (pool?.connected) {
    return pool;
  }

  const sqlConfig = buildSqlConfig(config);
  pool = new sql.ConnectionPool(sqlConfig);

  pool.on("error", (err) => {
    console.error("[mssql-mcp] Pool error:", err.message);
    pool = null;
  });

  await pool.connect();
  return pool;
}

export async function executeQuery(
  config: ConnectionConfig,
  query: string,
  params?: Record<string, unknown>
): Promise<sql.IResult<any>> {
  const p = await getPool(config);
  const request = p.request();

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value);
    }
  }

  return request.query(query);
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}
