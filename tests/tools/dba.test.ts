import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerDBATools } from "../../src/tools/dba.js";
import { makeTestConfig, makeQueryResult, captureToolHandlers } from "./_helpers.js";

vi.mock("../../src/database.js", () => ({
  executeQuery: vi.fn(),
}));

import { executeQuery } from "../../src/database.js";
const mockExecute = executeQuery as ReturnType<typeof vi.fn>;

function getHandlers(configOverrides = {}) {
  const config = makeTestConfig(configOverrides);
  return captureToolHandlers(registerDBATools, config);
}

// ─── get_wait_stats ───

describe("get_wait_stats", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns wait statistics", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { wait_type: "CXPACKET", wait_time_ms: 50000 },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_wait_stats({ top: undefined, server: undefined });
    expect(result.content[0].text).toContain("CXPACKET");
  });

  it("returns no wait stats message", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.get_wait_stats({ top: undefined, server: undefined });
    expect(result.content[0].text).toContain("No significant wait");
  });

  it("sanitizes top parameter (clamps to integer)", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    await handlers.get_wait_stats({ top: 5.7, server: undefined });
    const sqlArg = mockExecute.mock.calls[0][1] as string;
    expect(sqlArg).toContain("TOP (5)");
  });

  it("clamps top to minimum 1", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    await handlers.get_wait_stats({ top: -5, server: undefined });
    const sqlArg = mockExecute.mock.calls[0][1] as string;
    expect(sqlArg).toContain("TOP (1)");
  });

  it("clamps top to maximum 1000", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    await handlers.get_wait_stats({ top: 9999, server: undefined });
    const sqlArg = mockExecute.mock.calls[0][1] as string;
    expect(sqlArg).toContain("TOP (1000)");
  });
});

// ─── get_deadlocks ───

describe("get_deadlocks", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns deadlock events", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { deadlock_time: "2026-04-13 10:30:00", deadlock_graph: "<xml>deadlock data</xml>" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_deadlocks({ server: undefined });
    expect(result.content[0].text).toContain("Deadlock 1");
    expect(result.content[0].text).toContain("deadlock data");
  });

  it("returns no deadlocks message", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.get_deadlocks({ server: undefined });
    expect(result.content[0].text).toContain("No recent deadlocks");
  });
});

// ─── get_blocking_chains ───

describe("get_blocking_chains", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns blocking chains", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { blocked_session: 55, blocking_session: 52, wait_type: "LCK_M_X" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_blocking_chains({ server: undefined });
    expect(result.content[0].text).toContain("LCK_M_X");
  });

  it("returns no blocking message", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.get_blocking_chains({ server: undefined });
    expect(result.content[0].text).toContain("No blocking chains");
  });
});

// ─── get_long_transactions ───

describe("get_long_transactions", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns long transactions", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { session_id: 55, duration_seconds: 120, transaction_name: "user_transaction" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_long_transactions({ server: undefined });
    expect(result.content[0].text).toContain("user_transaction");
  });

  it("returns no long transactions message", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.get_long_transactions({ server: undefined });
    expect(result.content[0].text).toContain("No long-running");
  });
});

// ─── get_space_usage ───

describe("get_space_usage", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns space usage", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { schema: "dbo", table: "users", row_count: 1000, total_mb: 5.0 },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_space_usage({ database: undefined, top: undefined, server: undefined });
    expect(result.content[0].text).toContain("users");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.get_space_usage({ database: "OtherDB", top: undefined, server: undefined });
    expect(result.content[0].text).toContain("Access denied");
  });

  it("sanitizes top parameter", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    await handlers.get_space_usage({ database: undefined, top: 3.9, server: undefined });
    const sqlArg = mockExecute.mock.calls[0][1] as string;
    expect(sqlArg).toContain("TOP (3)");
  });
});

// ─── rebuild_index ───

describe("rebuild_index", () => {
  beforeEach(() => mockExecute.mockReset());

  it("rebuilds index successfully", async () => {
    mockExecute.mockResolvedValue(makeQueryResult());
    const handlers = getHandlers({ security: { allowDDL: true } });
    const result = await handlers.rebuild_index({
      table: "users", index: "IX_users_email", schema: undefined,
      database: undefined, mode: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("rebuilt successfully");
  });

  it("reorganizes index when mode is reorganize", async () => {
    mockExecute.mockResolvedValue(makeQueryResult());
    const handlers = getHandlers({ security: { allowDDL: true } });
    const result = await handlers.rebuild_index({
      table: "users", index: "IX_users_email", schema: undefined,
      database: undefined, mode: "reorganize", server: undefined,
    });
    expect(result.content[0].text).toContain("reorganized successfully");
    const sqlArg = mockExecute.mock.calls[0][1] as string;
    expect(sqlArg).toContain("REORGANIZE");
  });

  it("blocks when allowDDL is false", async () => {
    const handlers = getHandlers({ security: { allowDDL: false } });
    const result = await handlers.rebuild_index({
      table: "users", index: "IX_users_email", schema: undefined,
      database: undefined, mode: undefined, server: undefined,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("admin security mode");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowDDL: true, allowedDatabases: ["AppDB"] } });
    const result = await handlers.rebuild_index({
      table: "users", index: "IX_test", schema: undefined,
      database: "OtherDB", mode: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("Access denied");
  });

  it("uses escapeIdentifier for table and index names", async () => {
    mockExecute.mockResolvedValue(makeQueryResult());
    const handlers = getHandlers({ security: { allowDDL: true } });
    await handlers.rebuild_index({
      table: "my table", index: "my index", schema: "my schema",
      database: undefined, mode: undefined, server: undefined,
    });
    const sqlArg = mockExecute.mock.calls[0][1] as string;
    expect(sqlArg).toContain("[my schema].[my table]");
    expect(sqlArg).toContain("[my index]");
  });
});

// ─── get_backup_history ───

describe("get_backup_history", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns backup history", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { database: "AppDB", backup_type: "Full", size_mb: 500.0 },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_backup_history({ database: undefined, top: undefined, server: undefined });
    expect(result.content[0].text).toContain("Full");
  });

  it("returns no backup history message", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.get_backup_history({ database: undefined, top: undefined, server: undefined });
    expect(result.content[0].text).toContain("No backup history");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.get_backup_history({ database: "OtherDB", top: undefined, server: undefined });
    expect(result.content[0].text).toContain("Access denied");
  });

  it("sanitizes top parameter", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    await handlers.get_backup_history({ database: undefined, top: 2.5, server: undefined });
    const sqlArg = mockExecute.mock.calls[0][1] as string;
    expect(sqlArg).toContain("TOP (2)");
  });
});

// ─── get_query_store_stats ───

describe("get_query_store_stats", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns query store stats", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { query_id: 1, query_sql_text: "SELECT * FROM users", avg_cpu_ms: 5.2 },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_query_store_stats({
      database: undefined, sort_by: undefined, top: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("SELECT * FROM users");
  });

  it("returns no data message", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.get_query_store_stats({
      database: undefined, sort_by: undefined, top: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("No Query Store data");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.get_query_store_stats({
      database: "OtherDB", sort_by: undefined, top: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("Access denied");
  });

  it("handles query_store not enabled error", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Invalid object name 'sys.query_store_query'"));
    const handlers = getHandlers();
    const result = await handlers.get_query_store_stats({
      database: undefined, sort_by: undefined, top: undefined, server: undefined,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Query Store is not enabled");
  });
});

// ─── generate_test_data ───

describe("generate_test_data", () => {
  beforeEach(() => mockExecute.mockReset());

  it("generates insert statements", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { name: "id", type: "int", max_length: 4, is_nullable: false, is_identity: false, is_computed: false },
      { name: "email", type: "nvarchar", max_length: 200, is_nullable: false, is_identity: false, is_computed: false },
    ]));
    const handlers = getHandlers();
    const result = await handlers.generate_test_data({
      table: "users", schema: undefined, database: undefined, count: 3, server: undefined,
    });
    expect(result.content[0].text).toContain("INSERT INTO");
    expect(result.content[0].text).toContain("@example.com");
    expect(result.content[0].text).toContain("3 row(s)");
  });

  it("returns not found when table has no columns", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.generate_test_data({
      table: "nonexistent", schema: undefined, database: undefined, count: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("not found");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.generate_test_data({
      table: "t", schema: undefined, database: "OtherDB", count: undefined, server: undefined,
    });
    expect(result.content[0].text).toContain("Access denied");
  });

  it("clamps count to max 100", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { name: "id", type: "int", max_length: 4, is_nullable: false, is_identity: false, is_computed: false },
    ]));
    const handlers = getHandlers();
    const result = await handlers.generate_test_data({
      table: "t", schema: undefined, database: undefined, count: 500, server: undefined,
    });
    expect(result.content[0].text).toContain("100 row(s)");
  });

  it("clamps count to min 1", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { name: "id", type: "int", max_length: 4, is_nullable: false, is_identity: false, is_computed: false },
    ]));
    const handlers = getHandlers();
    const result = await handlers.generate_test_data({
      table: "t", schema: undefined, database: undefined, count: -5, server: undefined,
    });
    expect(result.content[0].text).toContain("1 row(s)");
  });
});

// ─── health_check ───

describe("health_check", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns health check info", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([{
      version: "Microsoft SQL Server 2022",
      server_time: new Date("2026-04-13T12:00:00Z"),
      current_database: "master",
      login: "sa",
      active_sessions: 5,
      batch_requests_sec: 1200,
    }]));
    const handlers = getHandlers();
    const result = await handlers.health_check({ server: undefined });
    expect(result.content[0].text).toContain("Health Check");
    expect(result.content[0].text).toContain("OK");
    expect(result.content[0].text).toContain("master");
  });

  it("returns failed health check on error", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Connection timeout"));
    const handlers = getHandlers();
    const result = await handlers.health_check({ server: undefined });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("FAILED");
    expect(result.content[0].text).toContain("Connection timeout");
  });
});
