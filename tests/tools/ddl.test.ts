import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerDDLTools } from "../../src/tools/ddl.js";
import { makeTestConfig, captureToolHandlers } from "./_helpers.js";

vi.mock("../../src/database.js", () => ({
  executeQuery: vi.fn(),
}));

import { executeQuery } from "../../src/database.js";
const mockExecute = executeQuery as ReturnType<typeof vi.fn>;

function getHandlers(configOverrides = {}) {
  const config = makeTestConfig(configOverrides);
  return captureToolHandlers(registerDDLTools, config);
}

describe("execute_ddl", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("executes CREATE TABLE successfully", async () => {
    mockExecute.mockResolvedValue({ recordset: [], rowsAffected: [0] });
    const handlers = getHandlers({ security: { allowDDL: true } });
    const result = await handlers.execute_ddl({ sql: "CREATE TABLE t (id INT)", server: undefined, database: undefined });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DDL executed successfully");
    expect(result.content[0].text).toContain("CREATE TABLE t");
  });

  it("executes ALTER TABLE", async () => {
    mockExecute.mockResolvedValue({ recordset: [], rowsAffected: [0] });
    const handlers = getHandlers({ security: { allowDDL: true } });
    const result = await handlers.execute_ddl({ sql: "ALTER TABLE t ADD col INT", server: undefined, database: undefined });
    expect(result.content[0].text).toContain("ALTER TABLE t");
  });

  it("executes DROP TABLE", async () => {
    mockExecute.mockResolvedValue({ recordset: [], rowsAffected: [0] });
    const handlers = getHandlers({ security: { allowDDL: true, blockedKeywords: [] } });
    const result = await handlers.execute_ddl({ sql: "DROP TABLE t", server: undefined, database: undefined });
    expect(result.content[0].text).toContain("DROP TABLE t");
  });

  it("executes TRUNCATE TABLE", async () => {
    mockExecute.mockResolvedValue({ recordset: [], rowsAffected: [0] });
    const handlers = getHandlers({ security: { allowDDL: true } });
    const result = await handlers.execute_ddl({ sql: "TRUNCATE TABLE t", server: undefined, database: undefined });
    expect(result.content[0].text).toContain("TRUNCATE TABLE t");
  });

  it("rejects SELECT queries", async () => {
    const handlers = getHandlers({ security: { allowDDL: true } });
    const result = await handlers.execute_ddl({ sql: "SELECT * FROM t", server: undefined, database: undefined });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("execute_ddl only accepts CREATE/ALTER/DROP/TRUNCATE");
  });

  it("rejects INSERT queries", async () => {
    const handlers = getHandlers({ security: { allowDDL: true } });
    const result = await handlers.execute_ddl({ sql: "INSERT INTO t VALUES (1)", server: undefined, database: undefined });
    expect(result.isError).toBe(true);
  });

  it("blocks DDL when allowDDL is false", async () => {
    const handlers = getHandlers({ security: { allowDDL: false } });
    const result = await handlers.execute_ddl({ sql: "CREATE TABLE t (id INT)", server: undefined, database: undefined });
    expect(result.isError).toBe(true);
  });

  it("blocks access to denied database", async () => {
    const handlers = getHandlers({ security: { allowDDL: true, allowedDatabases: ["AppDB"] } });
    const result = await handlers.execute_ddl({ sql: "CREATE TABLE t (id INT)", database: "OtherDB", server: undefined });
    expect(result.content[0].text).toContain("Access denied to database");
  });

  it("prepends USE when database is specified", async () => {
    mockExecute.mockResolvedValue({ recordset: [], rowsAffected: [0] });
    const handlers = getHandlers({ security: { allowDDL: true } });
    await handlers.execute_ddl({ sql: "CREATE TABLE t (id INT)", database: "mydb", server: undefined });
    const sqlArg = mockExecute.mock.calls[0][1] as string;
    expect(sqlArg).toContain("USE [mydb]");
  });

  it("blocks queries with blocked keywords", async () => {
    const handlers = getHandlers({ security: { allowDDL: true } });
    const result = await handlers.execute_ddl({ sql: "DROP DATABASE mydb", server: undefined, database: undefined });
    expect(result.isError).toBe(true);
  });

  it("returns error on executeQuery failure", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Permission denied"));
    const handlers = getHandlers({ security: { allowDDL: true } });
    const result = await handlers.execute_ddl({ sql: "CREATE TABLE t (id INT)", server: undefined, database: undefined });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Permission denied");
  });

  it("resolves named server", async () => {
    mockExecute.mockResolvedValue({ recordset: [], rowsAffected: [0] });
    const handlers = captureToolHandlers(registerDDLTools, makeTestConfig({
      servers: {
        admin: { security: { allowDDL: true } },
      },
    }));
    const result = await handlers.execute_ddl({ sql: "CREATE TABLE t (id INT)", server: "admin", database: undefined });
    expect(result.isError).toBeUndefined();
  });
});
