import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerQueryTools } from "../../src/tools/query.js";
import { makeTestConfig, makeQueryResult, captureToolHandlers } from "./_helpers.js";

// ─── Mock database module ───

vi.mock("../../src/database.js", () => ({
  executeQuery: vi.fn(),
}));

import { executeQuery } from "../../src/database.js";
const mockExecute = executeQuery as ReturnType<typeof vi.fn>;

// ─── Helpers ───

function getHandlers(configOverrides = {}) {
  const config = makeTestConfig(configOverrides);
  return captureToolHandlers(registerQueryTools, config);
}

// ─── execute_query ───

describe("execute_query", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("executes a simple SELECT and returns formatted result", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([{ id: 1, name: "Alice" }]));
    const handlers = getHandlers();
    const result = await handlers.execute_query({ sql: "SELECT * FROM users", server: undefined, database: undefined });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("id");
  });

  it("rejects non-SELECT queries", async () => {
    const handlers = getHandlers();
    const result = await handlers.execute_query({ sql: "INSERT INTO t VALUES (1)", server: undefined, database: undefined });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("execute_query only accepts SELECT");
  });

  it("rejects DELETE query", async () => {
    const handlers = getHandlers();
    const result = await handlers.execute_query({ sql: "DELETE FROM t", server: undefined, database: undefined });
    expect(result.isError).toBe(true);
  });

  it("allows WITH (CTE) queries", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([{ id: 1 }]));
    const handlers = getHandlers();
    const result = await handlers.execute_query({ sql: "WITH cte AS (SELECT 1 AS id) SELECT * FROM cte", server: undefined, database: undefined });
    expect(result.isError).toBeUndefined();
  });

  it("blocks queries with blocked keywords", async () => {
    const handlers = getHandlers();
    const result = await handlers.execute_query({ sql: "SELECT * FROM xp_cmdshell", server: undefined, database: undefined });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error");
  });

  it("blocks access to denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.execute_query({ sql: "SELECT 1", database: "OtherDB", server: undefined });
    expect(result.content[0].text).toContain("Access denied to database");
  });

  it("allows access to permitted database", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([{ x: 1 }]));
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.execute_query({ sql: "SELECT 1", database: "AppDB", server: undefined });
    expect(result.isError).toBeUndefined();
  });

  it("prepends USE when database is specified", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([{ x: 1 }]));
    const handlers = getHandlers();
    await handlers.execute_query({ sql: "SELECT 1", database: "mydb", server: undefined });
    const sqlArg = mockExecute.mock.calls[0][1] as string;
    expect(sqlArg).toContain("USE [mydb]");
  });

  it("applies masking when maskColumns configured", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([{ password: "secret", name: "Alice" }]));
    const handlers = getHandlers({ security: { maskColumns: [{ pattern: "password", mask: "***" }] } });
    const result = await handlers.execute_query({ sql: "SELECT * FROM users", server: undefined, database: undefined });
    expect(result.content[0].text).toContain("***");
    expect(result.content[0].text).not.toContain("secret");
  });

  it("returns error on executeQuery failure", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Connection failed"));
    const handlers = getHandlers();
    const result = await handlers.execute_query({ sql: "SELECT 1", server: undefined, database: undefined });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Connection failed");
  });

  it("resolves named server", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([{ x: 1 }]));
    const handlers = captureToolHandlers(registerQueryTools, makeTestConfig({
      servers: {
        dev: { connection: { host: "dev-host" } },
        prod: { connection: { host: "prod-host" } },
      },
    }));
    const result = await handlers.execute_query({ sql: "SELECT 1", server: "prod", database: undefined });
    expect(result.isError).toBeUndefined();
  });

  it("throws for unknown server", async () => {
    const handlers = getHandlers();
    const result = await handlers.execute_query({ sql: "SELECT 1", server: "nonexistent", database: undefined });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown server");
  });
});

// ─── execute_mutation ───

describe("execute_mutation", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("executes INSERT and returns rows affected", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([], [1]));
    const handlers = getHandlers({ security: { allowMutations: true } });
    const result = await handlers.execute_mutation({ sql: "INSERT INTO t VALUES (1)", server: undefined, database: undefined });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Rows affected: 1");
  });

  it("executes UPDATE", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([], [3]));
    const handlers = getHandlers({ security: { allowMutations: true } });
    const result = await handlers.execute_mutation({ sql: "UPDATE t SET x = 1", server: undefined, database: undefined });
    expect(result.content[0].text).toContain("Rows affected: 3");
  });

  it("executes DELETE", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([], [2]));
    const handlers = getHandlers({ security: { allowMutations: true } });
    const result = await handlers.execute_mutation({ sql: "DELETE FROM t WHERE id = 1", server: undefined, database: undefined });
    expect(result.content[0].text).toContain("Rows affected: 2");
  });

  it("rejects SELECT queries", async () => {
    const handlers = getHandlers({ security: { allowMutations: true } });
    const result = await handlers.execute_mutation({ sql: "SELECT * FROM t", server: undefined, database: undefined });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("execute_mutation only accepts INSERT/UPDATE/DELETE/MERGE");
  });

  it("rejects DDL queries", async () => {
    const handlers = getHandlers({ security: { allowMutations: true } });
    const result = await handlers.execute_mutation({ sql: "CREATE TABLE t (id INT)", server: undefined, database: undefined });
    expect(result.isError).toBe(true);
  });

  it("blocks mutations in readonly mode", async () => {
    const handlers = getHandlers({ security: { allowMutations: false } });
    const result = await handlers.execute_mutation({ sql: "INSERT INTO t VALUES (1)", server: undefined, database: undefined });
    expect(result.isError).toBe(true);
  });

  it("blocks access to denied database", async () => {
    const handlers = getHandlers({ security: { allowMutations: true, allowedDatabases: ["AppDB"] } });
    const result = await handlers.execute_mutation({ sql: "INSERT INTO t VALUES (1)", database: "OtherDB", server: undefined });
    expect(result.content[0].text).toContain("Access denied to database");
  });

  it("prepends USE when database is specified", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([], [1]));
    const handlers = getHandlers({ security: { allowMutations: true } });
    await handlers.execute_mutation({ sql: "INSERT INTO t VALUES (1)", database: "mydb", server: undefined });
    const sqlArg = mockExecute.mock.calls[0][1] as string;
    expect(sqlArg).toContain("USE [mydb]");
  });

  it("returns error on executeQuery failure", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Timeout"));
    const handlers = getHandlers({ security: { allowMutations: true } });
    const result = await handlers.execute_mutation({ sql: "INSERT INTO t VALUES (1)", server: undefined, database: undefined });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Timeout");
  });
});
