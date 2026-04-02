import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  applyMigrations,
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
      expect.arrayContaining(["api_key"]),
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
