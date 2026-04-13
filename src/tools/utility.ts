import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveServer, type AppConfig } from "../config.js";
import { executeQuery } from "../database.js";
import { isDatabaseAllowed, escapeIdentifier, ensureRowLimit, validateQuery } from "../utils/security.js";
import { formatResultSet, formatResultSetJson } from "../utils/formatter.js";

export function registerUtilityTools(server: McpServer, config: AppConfig): void {
  // ─── compare_schemas ───
  server.tool(
    "compare_schemas",
    "Compare schemas between two databases — shows tables, columns, and indexes that differ (useful for dev vs prod comparison)",
    {
      source_database: z.string().describe("Source database name (e.g. 'DevDB')"),
      target_database: z.string().describe("Target database name (e.g. 'ProdDB')"),
      schema: z.string().optional().describe("Schema filter (default: compare all schemas)"),
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ source_database, target_database, schema, server: srv }) => {
      const { connection, security, serverName } = resolveServer(config, srv);

      if (!isDatabaseAllowed(source_database, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${source_database}` }] };
      }
      if (!isDatabaseAllowed(target_database, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${target_database}` }] };
      }

      try {
        const eSrc = escapeIdentifier(source_database);
        const eTgt = escapeIdentifier(target_database);
        const schemaFilter = schema ? `AND s.name = @schema` : "";
        const params: Record<string, unknown> = schema ? { schema } : {};

        // 1. Tables only in source
        const onlyInSource = await executeQuery(
          connection,
          `SELECT s.name AS [schema], t.name AS [table]
           FROM ${eSrc}.sys.tables t
           JOIN ${eSrc}.sys.schemas s ON t.schema_id = s.schema_id
           WHERE NOT EXISTS (
             SELECT 1 FROM ${eTgt}.sys.tables t2
             JOIN ${eTgt}.sys.schemas s2 ON t2.schema_id = s2.schema_id
             WHERE t2.name = t.name AND s2.name = s.name
           ) ${schemaFilter}
           ORDER BY s.name, t.name`,
          params,
          serverName
        );

        // 2. Tables only in target
        const onlyInTarget = await executeQuery(
          connection,
          `SELECT s.name AS [schema], t.name AS [table]
           FROM ${eTgt}.sys.tables t
           JOIN ${eTgt}.sys.schemas s ON t.schema_id = s.schema_id
           WHERE NOT EXISTS (
             SELECT 1 FROM ${eSrc}.sys.tables t2
             JOIN ${eSrc}.sys.schemas s2 ON t2.schema_id = s2.schema_id
             WHERE t2.name = t.name AND s2.name = s.name
           ) ${schemaFilter}
           ORDER BY s.name, t.name`,
          params,
          serverName
        );

        // 3. Column differences in shared tables
        const columnDiffs = await executeQuery(
          connection,
          `SELECT
            s1.name AS [schema],
            t1.name AS [table],
            c1.name AS [column],
            tp1.name AS [source_type],
            c1.max_length AS [source_max_length],
            c1.is_nullable AS [source_nullable],
            tp2.name AS [target_type],
            c2.max_length AS [target_max_length],
            c2.is_nullable AS [target_nullable]
          FROM ${eSrc}.sys.columns c1
          JOIN ${eSrc}.sys.objects t1 ON c1.object_id = t1.object_id
          JOIN ${eSrc}.sys.schemas s1 ON t1.schema_id = s1.schema_id
          JOIN ${eSrc}.sys.types tp1 ON c1.user_type_id = tp1.user_type_id
          JOIN ${eTgt}.sys.objects t2 ON t2.name = t1.name AND t2.type = 'U'
          JOIN ${eTgt}.sys.schemas s2 ON t2.schema_id = s2.schema_id AND s2.name = s1.name
          JOIN ${eTgt}.sys.columns c2 ON t2.object_id = c2.object_id AND c2.name = c1.name
          JOIN ${eTgt}.sys.types tp2 ON c2.user_type_id = tp2.user_type_id
          WHERE t1.type = 'U'
            AND (tp1.name != tp2.name OR c1.max_length != c2.max_length OR c1.is_nullable != c2.is_nullable)
            ${schemaFilter.replace('s.name', 's1.name')}
          ORDER BY s1.name, t1.name, c1.name`,
          params,
          serverName
        );

        // 4. Columns only in source (for shared tables)
        const colsOnlyInSource = await executeQuery(
          connection,
          `SELECT s1.name AS [schema], t1.name AS [table], c1.name AS [column], tp1.name AS [type]
           FROM ${eSrc}.sys.columns c1
           JOIN ${eSrc}.sys.objects t1 ON c1.object_id = t1.object_id
           JOIN ${eSrc}.sys.schemas s1 ON t1.schema_id = s1.schema_id
           JOIN ${eSrc}.sys.types tp1 ON c1.user_type_id = tp1.user_type_id
           WHERE t1.type = 'U'
             AND EXISTS (
               SELECT 1 FROM ${eTgt}.sys.objects t2
               JOIN ${eTgt}.sys.schemas s2 ON t2.schema_id = s2.schema_id
               WHERE t2.name = t1.name AND s2.name = s1.name AND t2.type = 'U'
             )
             AND NOT EXISTS (
               SELECT 1 FROM ${eTgt}.sys.objects t2
               JOIN ${eTgt}.sys.schemas s2 ON t2.schema_id = s2.schema_id
               JOIN ${eTgt}.sys.columns c2 ON t2.object_id = c2.object_id
               WHERE t2.name = t1.name AND s2.name = s1.name AND c2.name = c1.name AND t2.type = 'U'
             )
             ${schemaFilter.replace('s.name', 's1.name')}
           ORDER BY s1.name, t1.name, c1.name`,
          params,
          serverName
        );

        // 5. Columns only in target (for shared tables)
        const colsOnlyInTarget = await executeQuery(
          connection,
          `SELECT s1.name AS [schema], t1.name AS [table], c1.name AS [column], tp1.name AS [type]
           FROM ${eTgt}.sys.columns c1
           JOIN ${eTgt}.sys.objects t1 ON c1.object_id = t1.object_id
           JOIN ${eTgt}.sys.schemas s1 ON t1.schema_id = s1.schema_id
           JOIN ${eTgt}.sys.types tp1 ON c1.user_type_id = tp1.user_type_id
           WHERE t1.type = 'U'
             AND EXISTS (
               SELECT 1 FROM ${eSrc}.sys.objects t2
               JOIN ${eSrc}.sys.schemas s2 ON t2.schema_id = s2.schema_id
               WHERE t2.name = t1.name AND s2.name = s1.name AND t2.type = 'U'
             )
             AND NOT EXISTS (
               SELECT 1 FROM ${eSrc}.sys.objects t2
               JOIN ${eSrc}.sys.schemas s2 ON t2.schema_id = s2.schema_id
               JOIN ${eSrc}.sys.columns c2 ON t2.object_id = c2.object_id
               WHERE t2.name = t1.name AND s2.name = s1.name AND c2.name = c1.name AND t2.type = 'U'
             )
             ${schemaFilter.replace('s.name', 's1.name')}
           ORDER BY s1.name, t1.name, c1.name`,
          params,
          serverName
        );

        // Build report
        const parts: string[] = [`## Schema Comparison: ${source_database} vs ${target_database}\n`];

        const srcOnly = onlyInSource.recordset;
        const tgtOnly = onlyInTarget.recordset;
        const colDiffs = columnDiffs.recordset;
        const srcCols = colsOnlyInSource.recordset;
        const tgtCols = colsOnlyInTarget.recordset;

        if (srcOnly.length === 0 && tgtOnly.length === 0 && colDiffs.length === 0 && srcCols.length === 0 && tgtCols.length === 0) {
          parts.push("Schemas are identical (no differences found).");
          return { content: [{ type: "text" as const, text: parts.join("\n") }] };
        }

        if (srcOnly.length > 0) {
          parts.push(`### Tables only in ${source_database}`);
          srcOnly.forEach((r: any) => parts.push(`- ${r.schema}.${r.table}`));
          parts.push("");
        }

        if (tgtOnly.length > 0) {
          parts.push(`### Tables only in ${target_database}`);
          tgtOnly.forEach((r: any) => parts.push(`- ${r.schema}.${r.table}`));
          parts.push("");
        }

        if (srcCols.length > 0) {
          parts.push(`### Columns only in ${source_database}`);
          srcCols.forEach((r: any) => parts.push(`- ${r.schema}.${r.table}.${r.column} (${r.type})`));
          parts.push("");
        }

        if (tgtCols.length > 0) {
          parts.push(`### Columns only in ${target_database}`);
          tgtCols.forEach((r: any) => parts.push(`- ${r.schema}.${r.table}.${r.column} (${r.type})`));
          parts.push("");
        }

        if (colDiffs.length > 0) {
          parts.push("### Column type differences");
          colDiffs.forEach((r: any) => {
            parts.push(`- ${r.schema}.${r.table}.${r.column}: ${r.source_type}(${r.source_max_length}) nullable=${r.source_nullable} → ${r.target_type}(${r.target_max_length}) nullable=${r.target_nullable}`);
          });
          parts.push("");
        }

        const total = srcOnly.length + tgtOnly.length + colDiffs.length + srcCols.length + tgtCols.length;
        parts.push(`**Total differences: ${total}**`);

        return { content: [{ type: "text" as const, text: parts.join("\n") }] };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── generate_code ───
  server.tool(
    "generate_code",
    "Generate TypeScript interface, C# class, or CREATE TABLE script from a table's schema",
    {
      table: z.string().describe("Table name"),
      schema: z.string().optional().describe("Schema name (default: dbo)"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      language: z
        .enum(["typescript", "csharp", "sql"])
        .describe("Output language: typescript, csharp, or sql (CREATE TABLE)"),
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ table, schema, database, language, server: srv }) => {
      const { connection, security, serverName } = resolveServer(config, srv);
      const db = database ?? connection.database;
      const sch = schema ?? "dbo";

      if (!isDatabaseAllowed(db, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      try {
        const eDb = escapeIdentifier(db);
        const result = await executeQuery(
          connection,
          `SELECT
            c.name AS [column],
            tp.name AS [type],
            c.max_length,
            c.precision,
            c.scale,
            c.is_nullable,
            c.is_identity,
            dc.definition AS [default_value]
          FROM ${eDb}.sys.columns c
          JOIN ${eDb}.sys.types tp ON c.user_type_id = tp.user_type_id
          JOIN ${eDb}.sys.objects o ON c.object_id = o.object_id
          JOIN ${eDb}.sys.schemas s ON o.schema_id = s.schema_id
          LEFT JOIN ${eDb}.sys.default_constraints dc ON c.default_object_id = dc.object_id
          WHERE o.name = @table AND s.name = @schema
          ORDER BY c.column_id`,
          { table, schema: sch },
          serverName
        );

        if (result.recordset.length === 0) {
          return { content: [{ type: "text" as const, text: `Table '${sch}.${table}' not found.` }] };
        }

        const cols = result.recordset;
        let code: string;

        if (language === "typescript") {
          code = generateTypeScript(table, cols);
        } else if (language === "csharp") {
          code = generateCSharp(table, cols);
        } else {
          code = generateCreateTable(sch, table, cols);
        }

        return { content: [{ type: "text" as const, text: code }] };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── generate_insert_scripts ───
  server.tool(
    "generate_insert_scripts",
    "Generate INSERT statements from existing table data (for migration/seeding)",
    {
      table: z.string().describe("Table name"),
      schema: z.string().optional().describe("Schema name (default: dbo)"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      top: z.number().optional().describe("Max rows to generate (default: 100)"),
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ table, schema, database, top, server: srv }) => {
      const { connection, security, serverName } = resolveServer(config, srv);
      const db = database ?? connection.database;
      const sch = schema ?? "dbo";
      const limit = Math.max(1, Math.floor(Math.min(top ?? 100, security.maxRowCount)));

      if (!isDatabaseAllowed(db, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      try {
        const eDb = escapeIdentifier(db);
        const eTable = `${escapeIdentifier(sch)}.${escapeIdentifier(table)}`;

        // Get column info (exclude identity/computed)
        const colResult = await executeQuery(
          connection,
          `SELECT c.name, tp.name AS type
           FROM ${eDb}.sys.columns c
           JOIN ${eDb}.sys.types tp ON c.user_type_id = tp.user_type_id
           JOIN ${eDb}.sys.objects o ON c.object_id = o.object_id
           JOIN ${eDb}.sys.schemas s ON o.schema_id = s.schema_id
           WHERE o.name = @table AND s.name = @schema
             AND c.is_identity = 0 AND c.is_computed = 0
           ORDER BY c.column_id`,
          { table, schema: sch },
          serverName
        );

        if (colResult.recordset.length === 0) {
          return { content: [{ type: "text" as const, text: `Table '${sch}.${table}' not found or has no insertable columns.` }] };
        }

        const columns = colResult.recordset.map((r: any) => r.name);
        const colTypes = colResult.recordset.map((r: any) => r.type);
        const colList = columns.map((c: string) => escapeIdentifier(c)).join(", ");

        // Get data
        const dataResult = await executeQuery(
          connection,
          `USE ${eDb}; SELECT TOP (${limit}) ${colList} FROM ${eTable}`,
          undefined,
          serverName
        );

        if (dataResult.recordset.length === 0) {
          return { content: [{ type: "text" as const, text: `Table '${sch}.${table}' is empty.` }] };
        }

        const lines = [`-- INSERT scripts for ${sch}.${table}`, `-- Generated: ${new Date().toISOString().slice(0, 19)}`, ""];

        for (const row of dataResult.recordset) {
          const values = columns.map((col: string, i: number) => {
            const val = row[col];
            if (val === null || val === undefined) return "NULL";
            if (val instanceof Date) return `'${val.toISOString().slice(0, 23)}'`;
            if (typeof val === "number" || typeof val === "boolean") return String(val);
            return `N'${String(val).replace(/'/g, "''")}'`;
          });
          lines.push(`INSERT INTO ${eTable} (${colList}) VALUES (${values.join(", ")});`);
        }

        lines.push("", `-- ${dataResult.recordset.length} row(s)`);
        return { content: [{ type: "text" as const, text: "```sql\n" + lines.join("\n") + "\n```" }] };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── generate_er_diagram ───
  server.tool(
    "generate_er_diagram",
    "Generate a Mermaid ER diagram from database foreign key relationships",
    {
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      schema: z.string().optional().describe("Schema filter (default: all schemas)"),
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ database, schema, server: srv }) => {
      const { connection, security, serverName } = resolveServer(config, srv);
      const db = database ?? connection.database;
      if (!isDatabaseAllowed(db, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      try {
        const eDb = escapeIdentifier(db);
        const schemaFilter = schema ? `AND ps.name = @schema` : "";
        const params: Record<string, unknown> = schema ? { schema } : {};

        // Get all tables and their columns
        const tablesResult = await executeQuery(
          connection,
          `SELECT
            s.name AS [schema], t.name AS [table],
            c.name AS [column], tp.name AS [type],
            c.is_nullable, c.is_identity
          FROM ${eDb}.sys.columns c
          JOIN ${eDb}.sys.types tp ON c.user_type_id = tp.user_type_id
          JOIN ${eDb}.sys.tables t ON c.object_id = t.object_id
          JOIN ${eDb}.sys.schemas s ON t.schema_id = s.schema_id
          WHERE 1=1 ${schemaFilter.replace('ps.name', 's.name')}
          ORDER BY s.name, t.name, c.column_id`,
          params,
          serverName
        );

        // Get foreign keys
        const fkResult = await executeQuery(
          connection,
          `SELECT
            ps.name AS [parent_schema], pt.name AS [parent_table], pc.name AS [parent_column],
            rs.name AS [ref_schema], rt.name AS [ref_table], rc.name AS [ref_column],
            fk.delete_referential_action_desc AS [on_delete]
          FROM ${eDb}.sys.foreign_keys fk
          JOIN ${eDb}.sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
          JOIN ${eDb}.sys.tables pt ON fkc.parent_object_id = pt.object_id
          JOIN ${eDb}.sys.schemas ps ON pt.schema_id = ps.schema_id
          JOIN ${eDb}.sys.columns pc ON fkc.parent_object_id = pc.object_id AND fkc.parent_column_id = pc.column_id
          JOIN ${eDb}.sys.tables rt ON fkc.referenced_object_id = rt.object_id
          JOIN ${eDb}.sys.schemas rs ON rt.schema_id = rs.schema_id
          JOIN ${eDb}.sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
          WHERE 1=1 ${schemaFilter}
          ORDER BY pt.name, fk.name`,
          params,
          serverName
        );

        // Build Mermaid diagram
        const lines: string[] = ["```mermaid", "erDiagram"];

        // Group columns by table
        const tableMap = new Map<string, any[]>();
        for (const row of tablesResult.recordset) {
          const key = `${row.schema}_${row.table}`;
          if (!tableMap.has(key)) tableMap.set(key, []);
          tableMap.get(key)!.push(row);
        }

        // Emit table entities
        for (const [key, cols] of tableMap) {
          const tableName = key.replace(/[^a-zA-Z0-9_]/g, "_");
          lines.push(`  ${tableName} {`);
          for (const col of cols) {
            const pk = col.is_identity ? "PK" : "";
            lines.push(`    ${col.type} ${col.column} ${pk}`);
          }
          lines.push("  }");
        }

        // Emit relationships
        for (const fk of fkResult.recordset) {
          const parent = `${fk.parent_schema}_${fk.parent_table}`.replace(/[^a-zA-Z0-9_]/g, "_");
          const ref = `${fk.ref_schema}_${fk.ref_table}`.replace(/[^a-zA-Z0-9_]/g, "_");
          const cardinality = fk.on_delete === "CASCADE" ? "}|--||" : "}o--||";
          lines.push(`  ${parent} ${cardinality} ${ref} : "${fk.parent_column}"`);
        }

        lines.push("```");

        if (tablesResult.recordset.length === 0) {
          return { content: [{ type: "text" as const, text: "No tables found." }] };
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── sample_table ───
  server.tool(
    "sample_table",
    "Get a random sample of rows from a table (useful for understanding data patterns)",
    {
      table: z.string().describe("Table name"),
      schema: z.string().optional().describe("Schema name (default: dbo)"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      count: z.number().optional().describe("Number of sample rows (default: 10, max: 100)"),
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ table, schema, database, count, server: srv }) => {
      const { connection, security, serverName } = resolveServer(config, srv);
      const db = database ?? connection.database;
      const sch = schema ?? "dbo";
      const n = Math.max(1, Math.floor(Math.min(count ?? 10, 100, security.maxRowCount)));

      if (!isDatabaseAllowed(db, security)) {
        return { content: [{ type: "text" as const, text: `Access denied to database: ${db}` }] };
      }

      try {
        const eDb = escapeIdentifier(db);
        const eTable = `${eDb}.${escapeIdentifier(sch)}.${escapeIdentifier(table)}`;
        const result = await executeQuery(
          connection,
          `SELECT TOP (${n}) * FROM ${eTable} ORDER BY NEWID()`,
          undefined,
          serverName
        );

        if (result.recordset.length === 0) {
          return { content: [{ type: "text" as const, text: `Table '${sch}.${table}' is empty or not found.` }] };
        }

        return { content: [{ type: "text" as const, text: formatResultSet(result) }] };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── export_query ───
  server.tool(
    "export_query",
    "Execute a SELECT query and return results as CSV or JSON format",
    {
      sql: z.string().describe("The SQL SELECT query"),
      format: z.enum(["csv", "json"]).describe("Output format: csv or json"),
      database: z
        .string()
        .optional()
        .describe("Database name (uses connection default if omitted)"),
      server: z.string().optional().describe("Target server name (uses default if omitted)"),
    },
    async ({ sql: sqlQuery, format, database, server: srv }) => {
      try {
        const { connection, security, serverName } = resolveServer(config, srv);

        if (database && !isDatabaseAllowed(database, security)) {
          return { content: [{ type: "text" as const, text: `Access denied to database: ${database}` }] };
        }

        const trimmed = sqlQuery.trim();
        if (!/^\s*(SELECT|WITH)\s/i.test(trimmed)) {
          return {
            content: [{ type: "text" as const, text: "Error: Only SELECT/WITH queries are supported." }],
            isError: true,
          };
        }

        validateQuery(sqlQuery, security);
        const limited = ensureRowLimit(sqlQuery, security.maxRowCount);

        const query = database
          ? `USE ${escapeIdentifier(database)};\n${limited}`
          : limited;

        const result = await executeQuery(connection, query, undefined, serverName);

        if (!result.recordset || result.recordset.length === 0) {
          return { content: [{ type: "text" as const, text: "No results." }] };
        }

        if (format === "json") {
          return {
            content: [{ type: "text" as const, text: "```json\n" + JSON.stringify(formatResultSetJson(result), null, 2) + "\n```" }],
          };
        }

        // CSV
        const columns = Object.keys(result.recordset[0]);
        const csvLines = [columns.join(",")];
        for (const row of result.recordset) {
          const vals = columns.map((col) => {
            const v = row[col];
            if (v === null || v === undefined) return "";
            if (v instanceof Date) return v.toISOString();
            const s = String(v);
            return s.includes(",") || s.includes('"') || s.includes("\n")
              ? `"${s.replace(/"/g, '""')}"`
              : s;
          });
          csvLines.push(vals.join(","));
        }

        return { content: [{ type: "text" as const, text: "```csv\n" + csvLines.join("\n") + "\n```" }] };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );
}

// ─── Code generation helpers ───

function sqlTypeToTs(sqlType: string, isNullable: boolean): string {
  const base = (() => {
    switch (sqlType.toLowerCase()) {
      case "bit": return "boolean";
      case "int": case "smallint": case "tinyint": case "bigint":
      case "decimal": case "numeric": case "float": case "real":
      case "money": case "smallmoney": return "number";
      case "date": case "datetime": case "datetime2": case "datetimeoffset":
      case "smalldatetime": case "time": return "Date";
      case "uniqueidentifier": return "string";
      case "binary": case "varbinary": case "image": return "Buffer";
      default: return "string";
    }
  })();
  return isNullable ? `${base} | null` : base;
}

function sqlTypeToCSharp(sqlType: string, isNullable: boolean): string {
  const base = (() => {
    switch (sqlType.toLowerCase()) {
      case "bit": return "bool";
      case "int": return "int";
      case "smallint": return "short";
      case "tinyint": return "byte";
      case "bigint": return "long";
      case "decimal": case "numeric": case "money": case "smallmoney": return "decimal";
      case "float": return "double";
      case "real": return "float";
      case "date": case "datetime": case "datetime2": case "smalldatetime": return "DateTime";
      case "datetimeoffset": return "DateTimeOffset";
      case "time": return "TimeSpan";
      case "uniqueidentifier": return "Guid";
      case "binary": case "varbinary": case "image": return "byte[]";
      default: return "string";
    }
  })();
  const isRefType = base === "string" || base === "byte[]";
  return isNullable && !isRefType ? `${base}?` : base;
}

function toPascalCase(name: string): string {
  return name.replace(/(^|[_\s-])([a-z])/g, (_, __, c) => c.toUpperCase())
    .replace(/[_\s-]/g, "");
}

function toCamelCase(name: string): string {
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function generateTypeScript(table: string, cols: any[]): string {
  const interfaceName = toPascalCase(table);
  const lines = [`export interface ${interfaceName} {`];
  for (const col of cols) {
    const tsType = sqlTypeToTs(col.type, col.is_nullable);
    lines.push(`  ${toCamelCase(col.column)}: ${tsType};`);
  }
  lines.push("}");
  return "```typescript\n" + lines.join("\n") + "\n```";
}

function generateCSharp(table: string, cols: any[]): string {
  const className = toPascalCase(table);
  const lines = [`public class ${className}`, "{"];
  for (const col of cols) {
    const csType = sqlTypeToCSharp(col.type, col.is_nullable);
    lines.push(`    public ${csType} ${toPascalCase(col.column)} { get; set; }`);
  }
  lines.push("}");
  return "```csharp\n" + lines.join("\n") + "\n```";
}

function generateCreateTable(schema: string, table: string, cols: any[]): string {
  const lines = [`CREATE TABLE ${escapeIdentifier(schema)}.${escapeIdentifier(table)} (`];
  const colDefs = cols.map((col) => {
    let def = `  ${escapeIdentifier(col.column)} ${col.type}`;
    if (["varchar", "nvarchar", "char", "nchar", "binary", "varbinary"].includes(col.type.toLowerCase())) {
      def += col.max_length === -1 ? "(MAX)" : `(${col.type.toLowerCase().startsWith("n") ? col.max_length / 2 : col.max_length})`;
    } else if (["decimal", "numeric"].includes(col.type.toLowerCase())) {
      def += `(${col.precision}, ${col.scale})`;
    }
    if (col.is_identity) def += " IDENTITY(1,1)";
    def += col.is_nullable ? " NULL" : " NOT NULL";
    if (col.default_value) def += ` DEFAULT ${col.default_value}`;
    return def;
  });
  lines.push(colDefs.join(",\n"));
  lines.push(");");
  return "```sql\n" + lines.join("\n") + "\n```";
}
