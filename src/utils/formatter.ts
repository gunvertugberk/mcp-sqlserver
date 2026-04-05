import type sql from "mssql";

/**
 * Formats a SQL result set as a readable markdown table.
 */
export function formatResultSet(result: sql.IResult<any>): string {
  if (!result.recordset || result.recordset.length === 0) {
    return result.rowsAffected?.[0] !== undefined
      ? `Query executed successfully. Rows affected: ${result.rowsAffected[0]}`
      : "Query executed successfully. No results returned.";
  }

  const rows = result.recordset;
  const columns = Object.keys(rows[0]);

  // Calculate column widths
  const widths = columns.map((col) => {
    const maxVal = Math.max(
      col.length,
      ...rows.map((row) => String(row[col] ?? "NULL").length)
    );
    return Math.min(maxVal, 50); // cap at 50 chars
  });

  // Build table
  const header = columns.map((col, i) => col.padEnd(widths[i])).join(" | ");
  const separator = widths.map((w) => "-".repeat(w)).join("-|-");
  const body = rows
    .map((row) =>
      columns
        .map((col, i) => {
          const val = row[col];
          const str = val === null || val === undefined ? "NULL" : String(val);
          return str.length > 50 ? str.slice(0, 47) + "..." : str.padEnd(widths[i]);
        })
        .join(" | ")
    )
    .join("\n");

  const footer = `\n(${rows.length} row${rows.length === 1 ? "" : "s"})`;

  return `${header}\n${separator}\n${body}${footer}`;
}

/**
 * Formats a result set as JSON (for structured consumption by AI).
 */
export function formatResultSetJson(result: sql.IResult<any>): object {
  return {
    columns: result.recordset?.columns
      ? Object.entries(result.recordset.columns).map(([name, col]: [string, any]) => ({
          name,
          type: col.type?.declaration ?? "unknown",
          nullable: col.nullable,
        }))
      : [],
    rows: result.recordset ?? [],
    rowCount: result.recordset?.length ?? 0,
    rowsAffected: result.rowsAffected,
  };
}
