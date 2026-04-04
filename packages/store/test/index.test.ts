import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  applyMigrations,
  revertLastMigration,
  validateSchemaConsistency,
  weakDecryptStoredProviderApiKey,
  weakEncryptProviderApiKey,
} from "../src/index";

describe("provider config storage", () => {
  it("stores api keys using reversible weak encryption", () => {
    const encrypted = weakEncryptProviderApiKey("sk-test-secret");

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toBe("sk-test-secret");
    expect(weakDecryptStoredProviderApiKey(encrypted)).toBe("sk-test-secret");
  });

  it("rejects plaintext api keys", () => {
    expect(() => weakDecryptStoredProviderApiKey("legacy-plain-text-key")).toThrow(
      "Stored provider API key must use enc:v1 encryption.",
    );
  });
});

describe("database migrations", () => {
  it("records migrations for a fresh database", () => {
    const sqlite = createMemoryDatabase();
    createFreshSchema(sqlite);

    applyMigrations(sqlite);

    expect(migrationIds(sqlite)).toEqual(
      expect.arrayContaining([
        "20260331_runs_lineage_columns",
        "20260331_provider_configs_api_key",
        "20260402_session_kernel_branches",
      ]),
    );
    expect(migrationIds(sqlite)).toHaveLength(3);
  });

  it("upgrades legacy databases with missing columns", () => {
    const sqlite = createMemoryDatabase();
    createLegacySchema(sqlite);

    applyMigrations(sqlite);

    expect(tableColumns(sqlite, "runs")).toEqual(
      expect.arrayContaining(["prompt", "source_run_id", "recovery_mode"]),
    );
    expect(tableColumns(sqlite, "provider_configs")).toEqual(
      expect.arrayContaining(["protocol", "api_key"]),
    );
    expect(migrationIds(sqlite)).toEqual(
      expect.arrayContaining([
        "20260331_runs_lineage_columns",
        "20260331_provider_configs_api_key",
      ]),
    );
    // The session_kernel_branches migration requires session_history_entries
    // which doesn't exist in legacy schemas, so it may not be applied
    expect(migrationIds(sqlite)).toHaveLength(3);
  });

  it("reverts the session kernel migration and drops WS-01 tables", () => {
    const sqlite = createMemoryDatabase();
    createFreshSchema(sqlite);

    applyMigrations(sqlite);
    expect(migrationIds(sqlite)).toContain("20260402_session_kernel_branches");

    const reverted = revertLastMigration(sqlite);

    expect(reverted).toBe("20260402_session_kernel_branches");
    expect(tableExists(sqlite, "session_branches")).toBe(false);
    expect(tableExists(sqlite, "run_checkpoints")).toBe(false);
    expect(tableColumns(sqlite, "runs")).toEqual(
      expect.arrayContaining(["origin_run_id", "resume_from_checkpoint", "terminal_reason"]),
    );
    expect(tableColumns(sqlite, "session_history_entries")).toEqual(
      expect.arrayContaining(["branch_id", "lineage_depth", "origin_run_id"]),
    );
  });

  it("creates indexes for branch and checkpoint query paths", () => {
    const sqlite = createMemoryDatabase();
    createFreshSchema(sqlite);

    applyMigrations(sqlite);

    expect(indexExists(sqlite, "idx_session_branches_session_created")).toBe(true);
    expect(indexExists(sqlite, "idx_run_checkpoints_run_created")).toBe(true);
    expect(indexExists(sqlite, "idx_session_history_entries_session_branch_created")).toBe(true);
  });

  it("reports orphan branch and checkpoint rows in the consistency check", () => {
    const sqlite = createMemoryDatabase();
    createFreshSchema(sqlite);

    applyMigrations(sqlite);

    sqlite
      .prepare(
        "INSERT INTO session_branches (id, session_id, head_entry_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("branch_orphan", "session_missing", null, "main", "2026-04-02T00:00:00.000Z", "2026-04-02T00:00:00.000Z");
    sqlite
      .prepare(
        "INSERT INTO run_checkpoints (id, run_id, session_id, phase, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "checkpoint_orphan",
        "run_missing",
        "session_missing",
        "before_model_call",
        "{}",
        "2026-04-02T00:00:00.000Z",
      );

    const errors = validateSchemaConsistency(sqlite);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Branch branch_orphan references non-existent session session_missing"),
        expect.stringContaining("Checkpoint checkpoint_orphan references non-existent run run_missing"),
      ]),
    );
  });
});

function createMemoryDatabase(): BetterSqlite3.Database {
  return new BetterSqlite3(":memory:");
}

function createFreshSchema(sqlite: BetterSqlite3.Database): void {
  sqlite.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      latest_user_message TEXT,
      latest_assistant_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      origin_session_id TEXT NOT NULL,
      candidate_reason TEXT NOT NULL,
      auto_created INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      task_id TEXT,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      prompt TEXT,
      source_run_id TEXT,
      recovery_mode TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE session_history_entries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      parent_id TEXT,
      kind TEXT NOT NULL,
      message_id TEXT,
      summary TEXT,
      details TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE review_requests (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      task_id TEXT,
      tool_call_id TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tool_calls (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      task_id TEXT,
      tool_name TEXT NOT NULL,
      approval_state TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE session_runtime (
      session_id TEXT PRIMARY KEY,
      snapshot TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE provider_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      protocol TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      model TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function createLegacySchema(sqlite: BetterSqlite3.Database): void {
  sqlite.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      task_id TEXT,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE provider_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function migrationIds(sqlite: BetterSqlite3.Database): string[] {
  return sqlite
    .prepare("SELECT id FROM schema_migrations ORDER BY created_at ASC, id ASC")
    .all()
    .map((row) => (row as { id: string }).id);
}

function tableColumns(sqlite: BetterSqlite3.Database, tableName: string): string[] {
  return sqlite
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .map((row) => (row as { name: string }).name);
}

function tableExists(sqlite: BetterSqlite3.Database, tableName: string): boolean {
  return (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) !== undefined
  );
}

function indexExists(sqlite: BetterSqlite3.Database, indexName: string): boolean {
  return (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(indexName) !== undefined
  );
}
