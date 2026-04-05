import type { SecurityConfig, MaskRule } from "../config.js";

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

/**
 * Validates a SQL query against security rules.
 * Throws SecurityError if the query violates any rule.
 */
export function validateQuery(query: string, security: SecurityConfig): void {
  const upper = query.toUpperCase().replace(/\s+/g, " ").trim();

  // Check blocked keywords
  for (const keyword of security.blockedKeywords) {
    if (upper.includes(keyword.toUpperCase())) {
      throw new SecurityError(`Blocked keyword detected: ${keyword}`);
    }
  }

  // Detect query type
  const isDDL = /^\s*(CREATE|ALTER|DROP|TRUNCATE)\s/i.test(query);
  const isMutation = /^\s*(INSERT|UPDATE|DELETE|MERGE)\s/i.test(query);

  if (isDDL && !security.allowDDL) {
    throw new SecurityError(
      `DDL operations are not allowed in '${security.mode}' mode. Set security.allowDDL: true or mode: admin.`
    );
  }

  if (isMutation && !security.allowMutations) {
    throw new SecurityError(
      `Mutation operations (INSERT/UPDATE/DELETE) are not allowed in '${security.mode}' mode. Set security.allowMutations: true or mode: readwrite/admin.`
    );
  }
}

/**
 * Check if a database name is allowed by security config.
 */
export function isDatabaseAllowed(database: string, security: SecurityConfig): boolean {
  const dbLower = database.toLowerCase();

  if (security.allowedDatabases.length > 0) {
    return security.allowedDatabases.some((d) => d.toLowerCase() === dbLower);
  }

  if (security.blockedDatabases.length > 0) {
    return !security.blockedDatabases.some((d) => d.toLowerCase() === dbLower);
  }

  return true;
}

/**
 * Check if a schema name is allowed by security config.
 */
export function isSchemaAllowed(schema: string, security: SecurityConfig): boolean {
  const schemaLower = schema.toLowerCase();

  if (security.allowedSchemas.length > 0) {
    return security.allowedSchemas.some((s) => s.toLowerCase() === schemaLower);
  }

  if (security.blockedSchemas.length > 0) {
    return !security.blockedSchemas.some((s) => s.toLowerCase() === schemaLower);
  }

  return true;
}

/**
 * Apply column masking rules to a result set.
 */
export function applyMasking(
  rows: Record<string, unknown>[],
  tableName: string,
  rules: MaskRule[]
): Record<string, unknown>[] {
  if (rules.length === 0) return rows;

  return rows.map((row) => {
    const masked = { ...row };
    for (const [col, val] of Object.entries(masked)) {
      if (val === null || val === undefined) continue;

      for (const rule of rules) {
        if (matchesMaskPattern(rule.pattern, tableName, col)) {
          masked[col] = rule.mask;
          break;
        }
      }
    }
    return masked;
  });
}

function matchesMaskPattern(pattern: string, table: string, column: string): boolean {
  // Supports: "*.password", "dbo.users.ssn", "*.ssn"
  const parts = pattern.split(".");

  if (parts.length === 1) {
    // Just column name
    return column.toLowerCase() === parts[0].toLowerCase();
  }

  if (parts.length === 2) {
    // table.column or *.column
    const [tPat, cPat] = parts;
    const colMatch = cPat === "*" || column.toLowerCase() === cPat.toLowerCase();
    const tableMatch = tPat === "*" || table.toLowerCase().includes(tPat.toLowerCase());
    return colMatch && tableMatch;
  }

  if (parts.length === 3) {
    // schema.table.column
    const [, tPat, cPat] = parts;
    const colMatch = cPat === "*" || column.toLowerCase() === cPat.toLowerCase();
    const tableMatch = tPat === "*" || table.toLowerCase().includes(tPat.toLowerCase());
    return colMatch && tableMatch;
  }

  return false;
}

/**
 * Ensure TOP clause exists on SELECT queries to limit row count.
 */
export function ensureRowLimit(query: string, maxRowCount: number): string {
  const trimmed = query.trim();
  if (!/^\s*SELECT\s/i.test(trimmed)) return query;

  // Skip if already has TOP or is a subquery/CTE
  if (/SELECT\s+(TOP\s+\(?\d+\)?|DISTINCT\s+TOP\s+\(?\d+\)?)/i.test(trimmed)) {
    return query;
  }

  // Don't add TOP to CTEs - add to the final SELECT
  if (/^\s*WITH\s/i.test(trimmed)) {
    return query;
  }

  return trimmed.replace(/^(SELECT\s+(DISTINCT\s+)?)/i, `$1TOP (${maxRowCount}) `);
}
