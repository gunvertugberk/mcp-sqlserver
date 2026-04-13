import { describe, it, expect } from "vitest";
import { formatResultSet, formatResultSetJson } from "../../src/utils/formatter.js";

// ─── Helper to build mssql-like IResult ───

function makeResult(recordset: any[], rowsAffected?: number[]) {
  return { recordset, rowsAffected } as any;
}

// ─── formatResultSet ───

describe("formatResultSet", () => {
  it("formats a simple result as markdown table", () => {
    const result = makeResult([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
    const output = formatResultSet(result);
    expect(output).toContain("id");
    expect(output).toContain("name");
    expect(output).toContain("Alice");
    expect(output).toContain("Bob");
    expect(output).toContain("(2 rows)");
  });

  it("shows singular 'row' for single result", () => {
    const result = makeResult([{ id: 1 }]);
    const output = formatResultSet(result);
    expect(output).toContain("(1 row)");
  });

  it("returns rows affected message for empty recordset with rowsAffected", () => {
    const result = makeResult([], [5]);
    const output = formatResultSet(result);
    expect(output).toContain("Rows affected: 5");
  });

  it("returns generic success message for empty recordset without rowsAffected", () => {
    const result = { recordset: [], rowsAffected: undefined } as any;
    const output = formatResultSet(result);
    expect(output).toContain("No results returned");
  });

  it("returns success message for null recordset", () => {
    const result = { recordset: null, rowsAffected: [3] } as any;
    const output = formatResultSet(result);
    expect(output).toContain("Rows affected: 3");
  });

  it("formats dates as ISO date only when midnight local time", () => {
    // Use local midnight (not UTC) since formatValue uses getHours() not getUTCHours()
    const midnight = new Date(2026, 0, 15, 0, 0, 0, 0);
    const result = makeResult([{ created: midnight }]);
    const output = formatResultSet(result);
    // toISOString() returns UTC, so the date portion comes from UTC representation
    const expectedDate = midnight.toISOString().slice(0, 10);
    expect(output).toContain(expectedDate);
    expect(output).not.toContain("00:00:00");
  });

  it("formats dates as ISO datetime when not midnight", () => {
    const result = makeResult([{ created: new Date("2026-01-15T14:30:00.000Z") }]);
    const output = formatResultSet(result);
    expect(output).toContain("2026-01-15 14:30:00");
  });

  it("formats NULL values", () => {
    const result = makeResult([{ value: null }]);
    const output = formatResultSet(result);
    expect(output).toContain("NULL");
  });

  it("truncates long values to 50 chars", () => {
    const longStr = "A".repeat(100);
    const result = makeResult([{ data: longStr }]);
    const output = formatResultSet(result);
    expect(output).toContain("...");
    expect(output).not.toContain("A".repeat(100));
  });

  it("includes header separator line", () => {
    const result = makeResult([{ id: 1 }]);
    const output = formatResultSet(result);
    const lines = output.split("\n");
    // Second line should be dashes
    expect(lines[1]).toMatch(/^-+/);
  });
});

// ─── formatResultSetJson ───

describe("formatResultSetJson", () => {
  it("returns structured object with rows and rowCount", () => {
    const result = makeResult([{ id: 1 }, { id: 2 }], [0]);
    const output = formatResultSetJson(result) as any;
    expect(output.rows).toHaveLength(2);
    expect(output.rowCount).toBe(2);
    expect(output.rowsAffected).toEqual([0]);
  });

  it("handles empty recordset", () => {
    const result = makeResult([], [0]);
    const output = formatResultSetJson(result) as any;
    expect(output.rows).toHaveLength(0);
    expect(output.rowCount).toBe(0);
  });

  it("handles null recordset", () => {
    const result = { recordset: null, rowsAffected: [0] } as any;
    const output = formatResultSetJson(result) as any;
    expect(output.rows).toEqual([]);
    expect(output.rowCount).toBe(0);
  });

  it("extracts column metadata when available", () => {
    const recordset: any = [{ id: 1 }];
    recordset.columns = {
      id: { type: { declaration: "int" }, nullable: false },
    };
    const result = { recordset, rowsAffected: [0] } as any;
    const output = formatResultSetJson(result) as any;
    expect(output.columns).toHaveLength(1);
    expect(output.columns[0].name).toBe("id");
    expect(output.columns[0].type).toBe("int");
    expect(output.columns[0].nullable).toBe(false);
  });
});
