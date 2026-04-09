import type sql from "mssql";

/**
 * Formats a value for display. Dates are converted to ISO format.
 */
function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (val instanceof Date) {
    // If time is midnight, show date only; otherwise show date + time
    const h = val.getHours(), m = val.getMinutes(), s = val.getSeconds(), ms = val.getMilliseconds();
    if (h === 0 && m === 0 && s === 0 && ms === 0) {
      return val.toISOString().slice(0, 10); // 2026-01-27
    }
    return val.toISOString().slice(0, 19).replace("T", " "); // 2026-01-27 14:30:00
  }
  return String(val);
}

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

  // Calculate column widths (using formatted values)
  const widths = columns.map((col) => {
    const maxVal = Math.max(
      col.length,
      ...rows.map((row) => formatValue(row[col]).length)
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
          const str = formatValue(row[col]);
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
