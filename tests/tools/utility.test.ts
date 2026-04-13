import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerUtilityTools } from "../../src/tools/utility.js";
import { makeTestConfig, makeQueryResult, captureToolHandlers } from "./_helpers.js";

vi.mock("../../src/database.js", () => ({
  executeQuery: vi.fn(),
}));

import { executeQuery } from "../../src/database.js";
const mockExecute = executeQuery as ReturnType<typeof vi.fn>;

function getHandlers(configOverrides = {}) {
  const config = makeTestConfig(configOverrides);
  return captureToolHandlers(registerUtilityTools, config);
}

// ─── compare_schemas ───

describe("compare_schemas", () => {
  beforeEach(() => mockExecute.mockReset());

  it("reports identical schemas", async () => {
    // 5 queries, all return empty
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.compare_schemas({
      source_database: "DevDB",
      target_database: "ProdDB",
      schema: undefined,
      server: undefined,
    });
    expect(result.content[0].text).toContain("identical");
  });

  it("reports tables only in source", async () => {
    mockExecute
      .mockResolvedValueOnce(makeQueryResult([{ schema: "dbo", table: "new_table" }]))  // only in source
      .mockResolvedValueOnce(makeQueryResult([]))  // only in target
      .mockResolvedValueOnce(makeQueryResult([]))  // column diffs
      .mockResolvedValueOnce(makeQueryResult([]))  // cols only in source
      .mockResolvedValueOnce(makeQueryResult([])); // cols only in target
    const handlers = getHandlers();
    const result = await handlers.compare_schemas({
      source_database: "DevDB",
      target_database: "ProdDB",
      schema: undefined,
      server: undefined,
    });
    expect(result.content[0].text).toContain("new_table");
    expect(result.content[0].text).toContain("only in DevDB");
  });

  it("blocks denied source database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["ProdDB"] } });
    const result = await handlers.compare_schemas({
      source_database: "DevDB",
      target_database: "ProdDB",
      schema: undefined,
      server: undefined,
    });
    expect(result.content[0].text).toContain("Access denied to database: DevDB");
  });

  it("blocks denied target database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["DevDB"] } });
    const result = await handlers.compare_schemas({
      source_database: "DevDB",
      target_database: "ProdDB",
      schema: undefined,
      server: undefined,
    });
    expect(result.content[0].text).toContain("Access denied to database: ProdDB");
  });
});

// ─── generate_code ───

describe("generate_code", () => {
  beforeEach(() => mockExecute.mockReset());

  it("generates TypeScript interface", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { column: "id", type: "int", max_length: 4, precision: 10, scale: 0, is_nullable: false, is_identity: true, default_value: null },
      { column: "name", type: "nvarchar", max_length: 100, precision: 0, scale: 0, is_nullable: true, is_identity: false, default_value: null },
    ]));
    const handlers = getHandlers();
    const result = await handlers.generate_code({
      table: "users", schema: undefined, database: undefined, language: "typescript", server: undefined,
    });
    expect(result.content[0].text).toContain("interface");
    expect(result.content[0].text).toContain("number");
    expect(result.content[0].text).toContain("string | null");
  });

  it("generates C# class", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { column: "id", type: "int", max_length: 4, precision: 10, scale: 0, is_nullable: false, is_identity: true, default_value: null },
    ]));
    const handlers = getHandlers();
    const result = await handlers.generate_code({
      table: "users", schema: undefined, database: undefined, language: "csharp", server: undefined,
    });
    expect(result.content[0].text).toContain("class");
    expect(result.content[0].text).toContain("int");
  });

  it("generates CREATE TABLE SQL", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { column: "id", type: "int", max_length: 4, precision: 10, scale: 0, is_nullable: false, is_identity: true, default_value: null },
    ]));
    const handlers = getHandlers();
    const result = await handlers.generate_code({
      table: "users", schema: undefined, database: undefined, language: "sql", server: undefined,
    });
    expect(result.content[0].text).toContain("CREATE TABLE");
    expect(result.content[0].text).toContain("IDENTITY");
  });

  it("returns not found for empty result", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.generate_code({
      table: "nonexistent", schema: undefined, database: undefined, language: "typescript", server: undefined,
    });
    expect(result.content[0].text).toContain("not found");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.generate_code({
      table: "users", database: "OtherDB", schema: undefined, language: "typescript", server: undefined,
    });
    expect(result.content[0].text).toContain("Access denied");
  });
});

// ─── generate_insert_scripts ───

describe("generate_insert_scripts", () => {
  beforeEach(() => mockExecute.mockReset());

  it("generates insert scripts from data", async () => {
    // First call: column info
    mockExecute.mockResolvedValueOnce(makeQueryResult([
      { name: "id", type: "int" },
      { name: "name", type: "nvarchar" },
    ]));
    // Second call: actual data
    mockExecute.mockResolvedValueOnce(makeQueryResult([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.generate_insert_scripts({
      table: "users", schema: undefined, database: undefined, top: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("INSERT INTO");
    expect(result.content[0].text).toContain("Alice");
    expect(result.content[0].text).toContain("2 row(s)");
  });

  it("returns not found when no columns", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.generate_insert_scripts({
      table: "nonexistent", schema: undefined, database: undefined, top: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("not found");
  });

  it("returns empty table message", async () => {
    mockExecute.mockResolvedValueOnce(makeQueryResult([{ name: "id", type: "int" }]));
    mockExecute.mockResolvedValueOnce(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.generate_insert_scripts({
      table: "empty_table", schema: undefined, database: undefined, top: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("empty");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.generate_insert_scripts({
      table: "t", database: "OtherDB", schema: undefined, top: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("Access denied");
  });

  it("sanitizes top parameter", async () => {
    mockExecute.mockResolvedValueOnce(makeQueryResult([{ name: "id", type: "int" }]));
    mockExecute.mockResolvedValueOnce(makeQueryResult([{ id: 1 }]));
    const handlers = getHandlers();
    await handlers.generate_insert_scripts({
      table: "t", schema: undefined, database: undefined, top: 5.9, server: undefined,
    });
    // The data query should use TOP (5)
    const dataQuery = mockExecute.mock.calls[1][1] as string;
    expect(dataQuery).toContain("TOP (5)");
  });
});

// ─── generate_er_diagram ───

describe("generate_er_diagram", () => {
  beforeEach(() => mockExecute.mockReset());

  it("generates mermaid ER diagram", async () => {
    // First call: tables/columns
    mockExecute.mockResolvedValueOnce(makeQueryResult([
      { schema: "dbo", table: "users", column: "id", type: "int", is_nullable: false, is_identity: true },
      { schema: "dbo", table: "users", column: "name", type: "nvarchar", is_nullable: true, is_identity: false },
    ]));
    // Second call: foreign keys
    mockExecute.mockResolvedValueOnce(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.generate_er_diagram({ database: undefined, schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("erDiagram");
    expect(result.content[0].text).toContain("dbo_users");
  });

  it("returns no tables message", async () => {
    mockExecute.mockResolvedValueOnce(makeQueryResult([]));
    mockExecute.mockResolvedValueOnce(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.generate_er_diagram({ database: undefined, schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("No tables");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.generate_er_diagram({ database: "OtherDB", schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("Access denied");
  });
});

// ─── sample_table ───

describe("sample_table", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns sample rows", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { id: 42, name: "Alice" },
      { id: 7, name: "Bob" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.sample_table({
      table: "users", schema: undefined, database: undefined, count: 2, server: undefined,
    });
    expect(result.content[0].text).toContain("Alice");
  });

  it("returns empty message", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.sample_table({
      table: "empty_table", schema: undefined, database: undefined, count: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("empty or not found");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.sample_table({
      table: "t", database: "OtherDB", schema: undefined, count: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("Access denied");
  });

  it("clamps count to max 100", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([{ id: 1 }]));
    const handlers = getHandlers();
    await handlers.sample_table({
      table: "t", schema: undefined, database: undefined, count: 500, server: undefined,
    });
    const sqlArg = mockExecute.mock.calls[0][1] as string;
    expect(sqlArg).toContain("TOP (100)");
  });
});

// ─── export_query ───

describe("export_query", () => {
  beforeEach(() => mockExecute.mockReset());

  it("exports as JSON", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { id: 1, name: "Alice" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.export_query({
      sql: "SELECT * FROM users", format: "json", database: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("json");
    expect(result.content[0].text).toContain("Alice");
  });

  it("exports as CSV", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.export_query({
      sql: "SELECT * FROM users", format: "csv", database: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("csv");
    expect(result.content[0].text).toContain("id,name");
    expect(result.content[0].text).toContain("Alice");
  });

  it("rejects non-SELECT queries", async () => {
    const handlers = getHandlers();
    const result = await handlers.export_query({
      sql: "INSERT INTO t VALUES (1)", format: "json", database: undefined, server: undefined,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Only SELECT/WITH");
  });

  it("blocks queries with blocked keywords", async () => {
    const handlers = getHandlers();
    const result = await handlers.export_query({
      sql: "SELECT * FROM xp_cmdshell", format: "json", database: undefined, server: undefined,
    });
    expect(result.isError).toBe(true);
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.export_query({
      sql: "SELECT 1", format: "json", database: "OtherDB", server: undefined,
    });
    expect(result.content[0].text).toContain("Access denied");
  });

  it("returns no results message for empty recordset", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.export_query({
      sql: "SELECT * FROM empty_table", format: "json", database: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("No results");
  });

  it("handles CSV values with commas", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { name: "Smith, John", city: "New York" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.export_query({
      sql: "SELECT * FROM users", format: "csv", database: undefined, server: undefined,
    });
    // Value with comma should be quoted
    expect(result.content[0].text).toContain('"Smith, John"');
  });
});
