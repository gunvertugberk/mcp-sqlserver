import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerProcedureTools } from "../../src/tools/procedure.js";
import { makeTestConfig, makeQueryResult, captureToolHandlers } from "./_helpers.js";

vi.mock("../../src/database.js", () => ({
  executeQuery: vi.fn(),
}));

import { executeQuery } from "../../src/database.js";
const mockExecute = executeQuery as ReturnType<typeof vi.fn>;

function getHandlers(configOverrides = {}) {
  const config = makeTestConfig(configOverrides);
  return captureToolHandlers(registerProcedureTools, config);
}

// ─── list_procedures ───

describe("list_procedures", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns procedures", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { schema: "dbo", procedure: "usp_GetUsers" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.list_procedures({ database: undefined, schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("usp_GetUsers");
  });

  it("returns no procedures message when empty", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.list_procedures({ database: undefined, schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("No stored procedures");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.list_procedures({ database: "OtherDB", schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("Access denied to database");
  });

  it("filters by isSchemaAllowed", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { schema: "dbo", procedure: "usp_GetUsers" },
      { schema: "internal", procedure: "usp_InternalSync" },
    ]));
    const handlers = getHandlers({ security: { blockedSchemas: ["internal"] } });
    const result = await handlers.list_procedures({ database: undefined, schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("usp_GetUsers");
    expect(result.content[0].text).not.toContain("usp_InternalSync");
  });

  it("returns error on failure", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Connection lost"));
    const handlers = getHandlers();
    const result = await handlers.list_procedures({ database: undefined, schema: undefined, server: undefined });
    expect(result.isError).toBe(true);
  });
});

// ─── describe_procedure ───

describe("describe_procedure", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns parameters and source", async () => {
    mockExecute.mockResolvedValueOnce(makeQueryResult([
      { parameter: "@userId", type: "int", is_output: false },
    ]));
    mockExecute.mockResolvedValueOnce(makeQueryResult([
      { definition: "CREATE PROCEDURE dbo.usp_GetUser @userId INT AS SELECT * FROM users WHERE id = @userId" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.describe_procedure({ procedure: "usp_GetUser", schema: undefined, database: undefined, server: undefined });
    expect(result.content[0].text).toContain("Parameters");
    expect(result.content[0].text).toContain("Source Code");
  });

  it("shows no parameters when none exist", async () => {
    mockExecute.mockResolvedValueOnce(makeQueryResult([]));
    mockExecute.mockResolvedValueOnce(makeQueryResult([{ definition: "CREATE PROC..." }]));
    const handlers = getHandlers();
    const result = await handlers.describe_procedure({ procedure: "usp_Simple", schema: undefined, database: undefined, server: undefined });
    expect(result.content[0].text).toContain("No parameters");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.describe_procedure({ procedure: "usp_Test", database: "OtherDB", schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("Access denied to database");
  });

  it("blocks denied schema", async () => {
    const handlers = getHandlers({ security: { blockedSchemas: ["internal"] } });
    const result = await handlers.describe_procedure({ procedure: "usp_Test", schema: "internal", database: undefined, server: undefined });
    expect(result.content[0].text).toContain("Access denied to schema");
  });

  it("returns error on failure", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Query timeout"));
    const handlers = getHandlers();
    const result = await handlers.describe_procedure({ procedure: "usp_Test", schema: undefined, database: undefined, server: undefined });
    expect(result.isError).toBe(true);
  });
});

// ─── execute_procedure ───

describe("execute_procedure", () => {
  beforeEach(() => mockExecute.mockReset());

  it("executes procedure and returns result set", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([{ id: 1, name: "Alice" }], [0]));
    const handlers = getHandlers({ security: { allowMutations: true } });
    const result = await handlers.execute_procedure({
      procedure: "usp_GetUsers",
      schema: undefined,
      parameters: undefined,
      database: undefined,
      server: undefined,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("id");
  });

  it("executes procedure with parameters", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([{ id: 1 }], [0]));
    const handlers = getHandlers({ security: { allowMutations: true } });
    await handlers.execute_procedure({
      procedure: "usp_GetUser",
      schema: undefined,
      parameters: { userId: 42 },
      database: undefined,
      server: undefined,
    });
    const sqlArg = mockExecute.mock.calls[0][1] as string;
    expect(sqlArg).toContain("@userId = @userId");
  });

  it("returns rows affected when no result set", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([], [5]));
    const handlers = getHandlers({ security: { allowMutations: true } });
    const result = await handlers.execute_procedure({
      procedure: "usp_UpdateAll",
      schema: undefined,
      parameters: undefined,
      database: undefined,
      server: undefined,
    });
    expect(result.content[0].text).toContain("Rows affected: 5");
  });

  it("blocks execution in readonly mode", async () => {
    const handlers = getHandlers({ security: { allowMutations: false } });
    const result = await handlers.execute_procedure({
      procedure: "usp_Test",
      schema: undefined,
      parameters: undefined,
      database: undefined,
      server: undefined,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("readwrite or admin");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowMutations: true, allowedDatabases: ["AppDB"] } });
    const result = await handlers.execute_procedure({
      procedure: "usp_Test",
      schema: undefined,
      parameters: undefined,
      database: "OtherDB",
      server: undefined,
    });
    expect(result.content[0].text).toContain("Access denied to database");
  });

  it("blocks denied schema", async () => {
    const handlers = getHandlers({ security: { allowMutations: true, blockedSchemas: ["internal"] } });
    const result = await handlers.execute_procedure({
      procedure: "usp_Test",
      schema: "internal",
      parameters: undefined,
      database: undefined,
      server: undefined,
    });
    expect(result.content[0].text).toContain("Access denied to schema");
  });

  it("prepends USE when database specified", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([], [0]));
    const handlers = getHandlers({ security: { allowMutations: true } });
    await handlers.execute_procedure({
      procedure: "usp_Test",
      schema: undefined,
      parameters: undefined,
      database: "mydb",
      server: undefined,
    });
    const sqlArg = mockExecute.mock.calls[0][1] as string;
    expect(sqlArg).toContain("USE [mydb]");
  });

  it("uses schema in EXEC statement", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([], [0]));
    const handlers = getHandlers({ security: { allowMutations: true } });
    await handlers.execute_procedure({
      procedure: "usp_Test",
      schema: "app",
      parameters: undefined,
      database: undefined,
      server: undefined,
    });
    const sqlArg = mockExecute.mock.calls[0][1] as string;
    expect(sqlArg).toContain("[app].[usp_Test]");
  });

  it("returns error on failure", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Procedure not found"));
    const handlers = getHandlers({ security: { allowMutations: true } });
    const result = await handlers.execute_procedure({
      procedure: "usp_NonExistent",
      schema: undefined,
      parameters: undefined,
      database: undefined,
      server: undefined,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Procedure not found");
  });
});
