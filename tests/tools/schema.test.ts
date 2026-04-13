import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerSchemaTools } from "../../src/tools/schema.js";
import { makeTestConfig, makeQueryResult, captureToolHandlers } from "./_helpers.js";

vi.mock("../../src/database.js", () => ({
  executeQuery: vi.fn(),
}));

import { executeQuery } from "../../src/database.js";
const mockExecute = executeQuery as ReturnType<typeof vi.fn>;

function getHandlers(configOverrides = {}) {
  const config = makeTestConfig(configOverrides);
  return captureToolHandlers(registerSchemaTools, config);
}

// ─── list_databases ───

describe("list_databases", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns all databases", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { name: "master", database_id: 1 },
      { name: "AppDB", database_id: 5 },
    ]));
    const handlers = getHandlers();
    const result = await handlers.list_databases({ server: undefined });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("master");
    expect(result.content[0].text).toContain("AppDB");
  });

  it("filters databases through isDatabaseAllowed", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { name: "master", database_id: 1 },
      { name: "AppDB", database_id: 5 },
    ]));
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.list_databases({ server: undefined });
    expect(result.content[0].text).toContain("AppDB");
    expect(result.content[0].text).not.toContain("master");
  });

  it("returns error on failure", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Connection refused"));
    const handlers = getHandlers();
    const result = await handlers.list_databases({ server: undefined });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Connection refused");
  });
});

// ─── list_schemas ───

describe("list_schemas", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns schemas for given database", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { schema_name: "dbo", schema_id: 1, owner: "dbo" },
      { schema_name: "app", schema_id: 5, owner: "dbo" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.list_schemas({ database: undefined, server: undefined });
    expect(result.content[0].text).toContain("dbo");
    expect(result.content[0].text).toContain("app");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.list_schemas({ database: "OtherDB", server: undefined });
    expect(result.content[0].text).toContain("Access denied to database");
  });

  it("filters schemas through isSchemaAllowed", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { schema_name: "dbo", schema_id: 1, owner: "dbo" },
      { schema_name: "internal", schema_id: 5, owner: "dbo" },
    ]));
    const handlers = getHandlers({ security: { allowedSchemas: ["dbo"] } });
    const result = await handlers.list_schemas({ database: undefined, server: undefined });
    expect(result.content[0].text).toContain("dbo");
    expect(result.content[0].text).not.toContain("internal");
  });

  it("returns error on failure", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Timeout"));
    const handlers = getHandlers();
    const result = await handlers.list_schemas({ database: undefined, server: undefined });
    expect(result.isError).toBe(true);
  });
});

// ─── list_tables ───

describe("list_tables", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns tables", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { schema: "dbo", table: "users", row_count: 100, size_mb: 1.5 },
    ]));
    const handlers = getHandlers();
    const result = await handlers.list_tables({ database: undefined, schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("users");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.list_tables({ database: "OtherDB", schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("Access denied");
  });

  it("filters schemas", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { schema: "dbo", table: "users", row_count: 10, size_mb: 1 },
      { schema: "internal", table: "logs", row_count: 5, size_mb: 0.5 },
    ]));
    const handlers = getHandlers({ security: { blockedSchemas: ["internal"] } });
    const result = await handlers.list_tables({ database: undefined, schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("users");
    expect(result.content[0].text).not.toContain("logs");
  });
});

// ─── list_views ───

describe("list_views", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns views", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { schema: "dbo", view: "active_users" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.list_views({ database: undefined, schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("active_users");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.list_views({ database: "OtherDB", schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("Access denied");
  });
});

// ─── describe_table ───

describe("describe_table", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns column details", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { column: "id", type: "int", max_length: 4, is_nullable: false, is_identity: true },
      { column: "name", type: "nvarchar", max_length: 100, is_nullable: true, is_identity: false },
    ]));
    const handlers = getHandlers();
    const result = await handlers.describe_table({ table: "users", schema: undefined, database: undefined, server: undefined });
    expect(result.content[0].text).toContain("id");
    expect(result.content[0].text).toContain("name");
  });

  it("returns not found message for empty recordset", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.describe_table({ table: "nonexistent", schema: undefined, database: undefined, server: undefined });
    expect(result.content[0].text).toContain("not found");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.describe_table({ table: "users", database: "OtherDB", schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("Access denied to database");
  });

  it("blocks denied schema", async () => {
    const handlers = getHandlers({ security: { blockedSchemas: ["internal"] } });
    const result = await handlers.describe_table({ table: "users", schema: "internal", database: undefined, server: undefined });
    expect(result.content[0].text).toContain("Access denied to schema");
  });
});

// ─── get_foreign_keys ───

describe("get_foreign_keys", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns foreign keys", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { fk_name: "FK_orders_users", parent_table: "orders", referenced_table: "users" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_foreign_keys({ table: "orders", schema: undefined, database: undefined, server: undefined });
    expect(result.content[0].text).toContain("FK_orders_users");
  });

  it("returns no foreign keys message", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.get_foreign_keys({ table: "users", schema: undefined, database: undefined, server: undefined });
    expect(result.content[0].text).toContain("No foreign keys");
  });

  it("blocks denied schema", async () => {
    const handlers = getHandlers({ security: { blockedSchemas: ["internal"] } });
    const result = await handlers.get_foreign_keys({ table: "t", schema: "internal", database: undefined, server: undefined });
    expect(result.content[0].text).toContain("Access denied to schema");
  });
});

// ─── get_indexes ───

describe("get_indexes", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns indexes", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { index_name: "PK_users", type: "CLUSTERED", is_primary_key: true },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_indexes({ table: "users", schema: undefined, database: undefined, server: undefined });
    expect(result.content[0].text).toContain("PK_users");
  });

  it("returns no indexes message", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.get_indexes({ table: "t", schema: undefined, database: undefined, server: undefined });
    expect(result.content[0].text).toContain("No indexes");
  });

  it("blocks denied database", async () => {
    const handlers = getHandlers({ security: { allowedDatabases: ["AppDB"] } });
    const result = await handlers.get_indexes({ table: "t", database: "OtherDB", schema: undefined, server: undefined });
    expect(result.content[0].text).toContain("Access denied");
  });
});

// ─── get_constraints ───

describe("get_constraints", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns constraints", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { constraint_name: "PK_id", type: "PRIMARY_KEY_CONSTRAINT" },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_constraints({ table: "users", schema: undefined, database: undefined, server: undefined });
    expect(result.content[0].text).toContain("PK_id");
  });

  it("returns no constraints message", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.get_constraints({ table: "t", schema: undefined, database: undefined, server: undefined });
    expect(result.content[0].text).toContain("No constraints");
  });
});

// ─── get_triggers ───

describe("get_triggers", () => {
  beforeEach(() => mockExecute.mockReset());

  it("returns triggers", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([
      { trigger_name: "trg_audit", is_disabled: false },
    ]));
    const handlers = getHandlers();
    const result = await handlers.get_triggers({ table: "users", schema: undefined, database: undefined, server: undefined });
    expect(result.content[0].text).toContain("trg_audit");
  });

  it("returns no triggers message", async () => {
    mockExecute.mockResolvedValue(makeQueryResult([]));
    const handlers = getHandlers();
    const result = await handlers.get_triggers({ table: "t", schema: undefined, database: undefined, server: undefined });
    expect(result.content[0].text).toContain("No triggers");
  });

  it("blocks denied schema", async () => {
    const handlers = getHandlers({ security: { blockedSchemas: ["internal"] } });
    const result = await handlers.get_triggers({ table: "t", schema: "internal", database: undefined, server: undefined });
    expect(result.content[0].text).toContain("Access denied to schema");
  });
});
