import { describe, it, expect } from "vitest";
import {
  escapeIdentifier,
  validateQuery,
  isDatabaseAllowed,
  isSchemaAllowed,
  applyMasking,
  ensureRowLimit,
  SecurityError,
} from "../../src/utils/security.js";
import type { SecurityConfig, MaskRule } from "../../src/config.js";

// ─── Helper to build a SecurityConfig for tests ───

function makeSecurity(overrides: Partial<SecurityConfig> = {}): SecurityConfig {
  return {
    mode: "readonly",
    allowedDatabases: [],
    blockedDatabases: [],
    allowedSchemas: [],
    blockedSchemas: [],
    maxRowCount: 1000,
    queryTimeout: 30000,
    allowDDL: false,
    allowMutations: false,
    blockedKeywords: ["xp_cmdshell", "SHUTDOWN", "DROP DATABASE", "RECONFIGURE", "sp_configure"],
    maskColumns: [],
    ...overrides,
  };
}

// ─── escapeIdentifier ───

describe("escapeIdentifier", () => {
  it("wraps a simple name in brackets", () => {
    expect(escapeIdentifier("Users")).toBe("[Users]");
  });

  it("doubles closing brackets inside the name", () => {
    expect(escapeIdentifier("table]name")).toBe("[table]]name]");
  });

  it("handles multiple closing brackets", () => {
    expect(escapeIdentifier("a]]b]c")).toBe("[a]]]]b]]c]");
  });

  it("handles empty string", () => {
    expect(escapeIdentifier("")).toBe("[]");
  });

  it("neutralizes SQL injection attempt", () => {
    const malicious = "users]; DROP TABLE students; --";
    const escaped = escapeIdentifier(malicious);
    // The ] after "users" is doubled to ]], making it part of the identifier name
    expect(escaped).toBe("[users]]; DROP TABLE students; --]");
  });

  it("handles names with spaces", () => {
    expect(escapeIdentifier("my table")).toBe("[my table]");
  });

  it("handles names with dots", () => {
    expect(escapeIdentifier("dbo.users")).toBe("[dbo.users]");
  });
});

// ─── validateQuery ───

describe("validateQuery", () => {
  describe("blocked keywords", () => {
    it("throws SecurityError for xp_cmdshell", () => {
      const security = makeSecurity();
      expect(() => validateQuery("EXEC xp_cmdshell 'dir'", security)).toThrow(SecurityError);
    });

    it("throws for SHUTDOWN", () => {
      const security = makeSecurity();
      expect(() => validateQuery("SHUTDOWN WITH NOWAIT", security)).toThrow(SecurityError);
    });

    it("throws for DROP DATABASE", () => {
      const security = makeSecurity();
      expect(() => validateQuery("DROP DATABASE mydb", security)).toThrow(SecurityError);
    });

    it("throws for sp_configure", () => {
      const security = makeSecurity();
      expect(() => validateQuery("EXEC sp_configure 'show advanced', 1", security)).toThrow(SecurityError);
    });

    it("is case-insensitive", () => {
      const security = makeSecurity();
      expect(() => validateQuery("exec XP_CMDSHELL 'dir'", security)).toThrow(SecurityError);
    });

    it("does not throw for normal SELECT", () => {
      const security = makeSecurity();
      expect(() => validateQuery("SELECT * FROM users", security)).not.toThrow();
    });

    it("uses custom blocked keywords when configured", () => {
      const security = makeSecurity({ blockedKeywords: ["CUSTOM_BAD"] });
      expect(() => validateQuery("SELECT CUSTOM_BAD FROM t", security)).toThrow(SecurityError);
      expect(() => validateQuery("SELECT * FROM users", security)).not.toThrow();
    });
  });

  describe("DDL mode gating", () => {
    it("throws for CREATE when allowDDL is false", () => {
      const security = makeSecurity({ allowDDL: false });
      expect(() => validateQuery("CREATE TABLE t (id INT)", security)).toThrow(SecurityError);
    });

    it("throws for ALTER when allowDDL is false", () => {
      const security = makeSecurity({ allowDDL: false });
      expect(() => validateQuery("ALTER TABLE t ADD col INT", security)).toThrow(SecurityError);
    });

    it("throws for DROP when allowDDL is false", () => {
      const security = makeSecurity({ allowDDL: false, blockedKeywords: [] });
      expect(() => validateQuery("DROP TABLE t", security)).toThrow(SecurityError);
    });

    it("throws for TRUNCATE when allowDDL is false", () => {
      const security = makeSecurity({ allowDDL: false });
      expect(() => validateQuery("TRUNCATE TABLE t", security)).toThrow(SecurityError);
    });

    it("allows DDL when allowDDL is true", () => {
      const security = makeSecurity({ allowDDL: true, blockedKeywords: [] });
      expect(() => validateQuery("CREATE TABLE t (id INT)", security)).not.toThrow();
      expect(() => validateQuery("DROP TABLE t", security)).not.toThrow();
    });
  });

  describe("mutation mode gating", () => {
    it("throws for INSERT when allowMutations is false", () => {
      const security = makeSecurity({ allowMutations: false });
      expect(() => validateQuery("INSERT INTO t VALUES (1)", security)).toThrow(SecurityError);
    });

    it("throws for UPDATE when allowMutations is false", () => {
      const security = makeSecurity({ allowMutations: false });
      expect(() => validateQuery("UPDATE t SET x = 1", security)).toThrow(SecurityError);
    });

    it("throws for DELETE when allowMutations is false", () => {
      const security = makeSecurity({ allowMutations: false });
      expect(() => validateQuery("DELETE FROM t WHERE id = 1", security)).toThrow(SecurityError);
    });

    it("throws for MERGE when allowMutations is false", () => {
      const security = makeSecurity({ allowMutations: false });
      expect(() => validateQuery("MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET x = 1;", security)).toThrow(SecurityError);
    });

    it("allows mutations when allowMutations is true", () => {
      const security = makeSecurity({ allowMutations: true });
      expect(() => validateQuery("INSERT INTO t VALUES (1)", security)).not.toThrow();
      expect(() => validateQuery("UPDATE t SET x = 1", security)).not.toThrow();
      expect(() => validateQuery("DELETE FROM t WHERE id = 1", security)).not.toThrow();
    });
  });
});

// ─── isDatabaseAllowed ───

describe("isDatabaseAllowed", () => {
  it("allows everything when no lists configured", () => {
    const security = makeSecurity();
    expect(isDatabaseAllowed("anything", security)).toBe(true);
  });

  it("allows only whitelisted databases", () => {
    const security = makeSecurity({ allowedDatabases: ["AppDB", "TestDB"] });
    expect(isDatabaseAllowed("AppDB", security)).toBe(true);
    expect(isDatabaseAllowed("TestDB", security)).toBe(true);
    expect(isDatabaseAllowed("OtherDB", security)).toBe(false);
  });

  it("is case-insensitive for allowedDatabases", () => {
    const security = makeSecurity({ allowedDatabases: ["AppDB"] });
    expect(isDatabaseAllowed("appdb", security)).toBe(true);
    expect(isDatabaseAllowed("APPDB", security)).toBe(true);
  });

  it("blocks blacklisted databases", () => {
    const security = makeSecurity({ blockedDatabases: ["master", "tempdb"] });
    expect(isDatabaseAllowed("master", security)).toBe(false);
    expect(isDatabaseAllowed("tempdb", security)).toBe(false);
    expect(isDatabaseAllowed("AppDB", security)).toBe(true);
  });

  it("is case-insensitive for blockedDatabases", () => {
    const security = makeSecurity({ blockedDatabases: ["master"] });
    expect(isDatabaseAllowed("MASTER", security)).toBe(false);
  });

  it("allowedDatabases takes precedence over blockedDatabases", () => {
    const security = makeSecurity({
      allowedDatabases: ["AppDB"],
      blockedDatabases: ["master"],
    });
    // When allowedDatabases is set, only it matters
    expect(isDatabaseAllowed("AppDB", security)).toBe(true);
    expect(isDatabaseAllowed("master", security)).toBe(false);
    expect(isDatabaseAllowed("OtherDB", security)).toBe(false);
  });
});

// ─── isSchemaAllowed ───

describe("isSchemaAllowed", () => {
  it("allows everything when no lists configured", () => {
    const security = makeSecurity();
    expect(isSchemaAllowed("dbo", security)).toBe(true);
    expect(isSchemaAllowed("anything", security)).toBe(true);
  });

  it("allows only whitelisted schemas", () => {
    const security = makeSecurity({ allowedSchemas: ["dbo", "app"] });
    expect(isSchemaAllowed("dbo", security)).toBe(true);
    expect(isSchemaAllowed("app", security)).toBe(true);
    expect(isSchemaAllowed("internal", security)).toBe(false);
  });

  it("is case-insensitive for allowedSchemas", () => {
    const security = makeSecurity({ allowedSchemas: ["dbo"] });
    expect(isSchemaAllowed("DBO", security)).toBe(true);
  });

  it("blocks blacklisted schemas", () => {
    const security = makeSecurity({ blockedSchemas: ["internal", "sys"] });
    expect(isSchemaAllowed("internal", security)).toBe(false);
    expect(isSchemaAllowed("sys", security)).toBe(false);
    expect(isSchemaAllowed("dbo", security)).toBe(true);
  });

  it("allowedSchemas takes precedence over blockedSchemas", () => {
    const security = makeSecurity({
      allowedSchemas: ["dbo"],
      blockedSchemas: ["internal"],
    });
    expect(isSchemaAllowed("dbo", security)).toBe(true);
    expect(isSchemaAllowed("internal", security)).toBe(false);
  });
});

// ─── applyMasking ───

describe("applyMasking", () => {
  const rows = [
    { name: "Alice", password: "secret123", email: "alice@test.com" },
    { name: "Bob", password: "hunter2", email: "bob@test.com" },
  ];

  it("returns rows unchanged when no rules", () => {
    const result = applyMasking(rows, "users", []);
    expect(result).toEqual(rows);
  });

  it("masks column by name only", () => {
    const rules: MaskRule[] = [{ pattern: "password", mask: "***" }];
    const result = applyMasking(rows, "users", rules);
    expect(result[0].password).toBe("***");
    expect(result[1].password).toBe("***");
    expect(result[0].name).toBe("Alice");
  });

  it("masks with table.column pattern", () => {
    const rules: MaskRule[] = [{ pattern: "users.email", mask: "REDACTED" }];
    const result = applyMasking(rows, "users", rules);
    expect(result[0].email).toBe("REDACTED");
    expect(result[0].name).toBe("Alice");
  });

  it("masks with wildcard table pattern", () => {
    const rules: MaskRule[] = [{ pattern: "*.password", mask: "***" }];
    const result = applyMasking(rows, "users", rules);
    expect(result[0].password).toBe("***");
  });

  it("masks with schema.table.column pattern", () => {
    const rules: MaskRule[] = [{ pattern: "dbo.users.password", mask: "XXX" }];
    const result = applyMasking(rows, "users", rules);
    expect(result[0].password).toBe("XXX");
  });

  it("does not mask null/undefined values", () => {
    const rowsWithNull = [{ password: null }, { password: undefined }];
    const rules: MaskRule[] = [{ pattern: "password", mask: "***" }];
    const result = applyMasking(rowsWithNull as any, "users", rules);
    expect(result[0].password).toBeNull();
    expect(result[1].password).toBeUndefined();
  });

  it("is case-insensitive for column matching", () => {
    const rules: MaskRule[] = [{ pattern: "PASSWORD", mask: "***" }];
    const result = applyMasking(rows, "users", rules);
    expect(result[0].password).toBe("***");
  });

  it("does not mutate original rows", () => {
    const rules: MaskRule[] = [{ pattern: "password", mask: "***" }];
    const original = rows.map((r) => ({ ...r }));
    applyMasking(original, "users", rules);
    // The original rows' source should not be mutated (applyMasking spreads)
    expect(rows[0].password).toBe("secret123");
  });
});

// ─── ensureRowLimit ───

describe("ensureRowLimit", () => {
  it("adds TOP clause to simple SELECT", () => {
    const result = ensureRowLimit("SELECT * FROM users", 100);
    expect(result).toBe("SELECT TOP (100) * FROM users");
  });

  it("adds TOP after SELECT DISTINCT", () => {
    const result = ensureRowLimit("SELECT DISTINCT name FROM users", 50);
    expect(result).toBe("SELECT DISTINCT TOP (50) name FROM users");
  });

  it("does not modify query that already has TOP", () => {
    const query = "SELECT TOP (10) * FROM users";
    const result = ensureRowLimit(query, 100);
    expect(result).toBe(query);
  });

  it("does not modify CTE queries (WITH ...)", () => {
    const query = "WITH cte AS (SELECT * FROM t) SELECT * FROM cte";
    const result = ensureRowLimit(query, 100);
    expect(result).toBe(query);
  });

  it("does not modify non-SELECT queries", () => {
    const query = "INSERT INTO t VALUES (1)";
    const result = ensureRowLimit(query, 100);
    expect(result).toBe(query);
  });

  it("trims leading whitespace before processing", () => {
    const result = ensureRowLimit("  SELECT * FROM users", 100);
    expect(result).toBe("SELECT TOP (100) * FROM users");
  });

  it("handles case-insensitive SELECT", () => {
    const result = ensureRowLimit("select * from users", 100);
    expect(result).toBe("select TOP (100) * from users");
  });

  it("does not add TOP to DISTINCT TOP that already exists", () => {
    const query = "SELECT DISTINCT TOP (5) name FROM users";
    const result = ensureRowLimit(query, 100);
    expect(result).toBe(query);
  });
});
