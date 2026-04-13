import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerPerformanceTools } from "../../src/tools/performance.js";
import { makeTestConfig, makeQueryResult, captureToolHandlers } from "./_helpers.js";

vi.mock("../../src/database.js", () => ({
  executeQuery: vi.fn(),
}));

import { executeQuery } from "../../src/database.js";
const mockExecute = executeQuery as ReturnType<typeof vi.fn>;

function getHandlers(configOverrides = {}) {
  const config = makeTestConfig(configOverrides);
  return captureToolHandlers(registerPerformanceTools, config);
}

// ─── get_query_plan ───

describe("get_query_plan", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns execution plan", async () => {
    // 1st call: SET SHOWPLAN_TEXT ON
    // 2nd call: actual query → plan text
    // 3rd call: SET SHOWPLAN_TEXT OFF
    mockExecute
      .mockResolvedValueOnce(makeQueryResult())    // SHOWPLAN ON
      .mockResolvedValueOnce(makeQueryResult([      // query
        { StmtText: "  |--Clustered Index Scan" },
      ]))
      .mockResolvedValueOnce(makeQueryResult());     // SHOWPLAN OFF
    const handlers = getHandlers();
    const result = await handlers.get_query_plan({ sql: "SELECT * FROM users", database: undefined, server: undefined });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Execution Plan");
    expect(result.content[0].text).toContain("Clustered Index Scan");
  });

  it("blocks queries with blocked keywords", async () => {
    const handlers = getHandlers();
    const result = await handlers.get_query_plan({ sql: "EXEC xp_cmdshell 'dir'", database: undefined, server: undefined });
    expect(result.isError).toBe(true);
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.get_query_plan({ sql: "SELECT 1", database: "OtherDB", server: undefined });
    expect(result.content[0].text).toContain("Access denied to database");
  });

  it("switches database context when specified", async () => {
    mockExecute.mockResolvedValue(makeQueryResult());
    const handlers = getHandlers();
    await handlers.get_query_plan({ sql: "SELECT 1", database: "mydb", server: undefined });
    // First call should be USE [mydb]
    const firstCall = mockExecute.mock.calls[0][1] as string;
    expect(firstCall).toContain("USE [mydb]");
  });

  it("turns off SHOWPLAN on error", async () => {
    mockExecute
      .mockResolvedValueOnce(makeQueryResult())     // SHOWPLAN ON
      .mockRejectedValueOnce(new Error("Bad query")) // query fails
      .mockResolvedValueOnce(makeQueryResult());      // SHOWPLAN OFF
    const handlers = getHandlers();
    const result = await handlers.get_query_plan({ sql: "SELECT bad_syntax", database: undefined, server: undefined });
    expect(result.isError).toBe(true);
    // Verify SHOWPLAN OFF was called (3rd call)
    expect(mockExecute).toHaveBeenCalledTimes(3);
    expect(mockExecute.mock.calls[2][1]).toContain("SET SHOWPLAN_TEXT OFF");
  });

  it("returns no plan message for empty recordset", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.get_query_plan({ sql: "SELECT 1", database: undefined, server: undefined });
    expect(result.content[0].text).toContain("No execution plan");
  });
});

// ─── get_active_queries ───

describe("get_active_queries", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns active queries", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { session_id: 55, status: "running", command: "SELECT", current_statement: "SELECT * FROM big_table" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_active_queries({ server: undefined });
    expect(result.content[0].text).toContain("SELECT");
  });

  it("returns no active queries message", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.get_active_queries({ server: undefined });
    expect(result.content[0].text).toContain("No active queries");
  });
});

// ─── get_table_stats ───

describe("get_table_stats", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns table statistics", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { schema: "dbo", table: "users", row_count: 1000, total_size_mb: 5.5 },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_table_stats({ table: "users", schema: undefined, database: undefined, server: undefined });
    expect(result.content[0].text).toContain("users");
  });

  it("returns not found for empty result", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.get_table_stats({ table: "nonexistent", schema: undefined, database: undefined, server: undefined });
    expect(result.content[0].text).toContain("not found");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.get_table_stats({ table: "t", database: "OtherDB", schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("Access denied");
  });
});

// ─── get_index_usage ───

describe("get_index_usage", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns index usage stats", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { index_name: "PK_users", type: "CLUSTERED", user_seeks: 1000 },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_index_usage({ table: "users", schema: undefined, database: undefined, server: undefined });
    expect(result.content[0].text).toContain("PK_users");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.get_index_usage({ table: "t", database: "OtherDB", schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("Access denied");
  });
});

// ─── get_missing_indexes ───

describe("get_missing_indexes", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns missing index suggestions", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { table: "users", equality_columns: "[email]", improvement_measure: 500.00 },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_missing_indexes({ database: undefined, server: undefined });
    expect(result.content[0].text).toContain("email");
  });

  it("returns no suggestions message", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.get_missing_indexes({ database: undefined, server: undefined });
    expect(result.content[0].text).toContain("No missing index");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.get_missing_indexes({ database: "OtherDB", server: undefined });
    expect(result.content[0].text).toContain("Access denied");
  });
});

// ─── get_server_info ───

describe("get_server_info", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns server information", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { version: "15.0.4153.1", edition: "Developer Edition", machine: "SQLBOX" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_server_info({ server: undefined });
    expect(result.content[0].text).toContain("15.0.4153.1");
  });

  it("returns error on failure", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Cannot connect"));
    const handlers = getHandlers();
    const result = await handlers.get_server_info({ server: undefined });
    expect(result.isError).toBe(true);
  });
});

// ─── get_database_info ───

describe("get_database_info", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns database info", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { database: "AppDB", status: "ONLINE", recovery_model: "FULL", table_count: 25 },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_database_info({ database: undefined, server: undefined });
    expect(result.content[0].text).toContain("ONLINE");
  });

  it("returns not found message", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.get_database_info({ database: "nonexistent", server: undefined });
    expect(result.content[0].text).toContain("not found");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.get_database_info({ database: "OtherDB", server: undefined });
    expect(result.content[0].text).toContain("Access denied");
  });
});
