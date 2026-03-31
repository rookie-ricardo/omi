import BetterSqlite3 from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import {
  type EventRecord,
  type MemoryRecord,
  type ProviderConfig,
  type ReviewRequest,
  type SessionHistoryEntry,
  type Run,
  type Session,
  type SessionMessage,
  type Task,
  type ToolCall,
  eventRecordSchema,
  memoryRecordSchema,
  providerConfigSchema,
  reviewRequestSchema,
  runSchema,
  sessionHistoryEntrySchema,
  sessionMessageSchema,
  sessionSchema,
  taskSchema,
  toolCallSchema,
} from "@omi/core";
import type { AppStore } from "./contracts";
import { createId, ensureDir, nowIso, parseJson } from "@omi/core";

import {
  eventsTable,
  memoriesTable,
  messagesTable,
  providerConfigsTable,
  reviewRequestsTable,
  sessionHistoryEntriesTable,
  runsTable,
  sessionsTable,
  tasksTable,
  toolCallsTable,
} from "./schema";
import { parseSessionHistoryEntry, serializeSessionHistoryEntry } from "./history";
import { sortChronologicalRows } from "./sort";

const PROVIDER_API_KEY_PREFIX = "enc:v1:";
const PROVIDER_API_KEY_WEAK_KEY = Buffer.from("omi", "utf8");
const MIGRATIONS_TABLE_NAME = "schema_migrations";

interface MigrationStatement {
  all: (...args: any[]) => unknown[];
  run: (...args: any[]) => unknown;
}

interface MigrationDatabase {
  exec: (sql: string) => void;
  prepare: (sql: string) => MigrationStatement;
  transaction: <TArgs extends unknown[]>(fn: (...args: TArgs) => void) => (...args: TArgs) => void;
}

export function createAppDatabase(databasePath = resolveDatabasePath()): AppStore {
  ensureDir(dirname(databasePath));
  const sqlite = new BetterSqlite3(databasePath);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      latest_user_message TEXT,
      latest_assistant_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      origin_session_id TEXT NOT NULL,
      candidate_reason TEXT NOT NULL,
      auto_created INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
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
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_history_entries (
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
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS review_requests (
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
    CREATE TABLE IF NOT EXISTS tool_calls (
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
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_runtime (
      session_id TEXT PRIMARY KEY,
      snapshot TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_configs (
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
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id, title, content, tags);
  `);
  applyMigrations(sqlite);

  function syncMemoryFts(memory: MemoryRecord) {
    sqlite
      .prepare("INSERT OR REPLACE INTO memories_fts (id, title, content, tags) VALUES (?, ?, ?, ?)")
      .run(memory.id, memory.title, memory.content, memory.tags.join(" "));
  }

  function listSessions(): Session[] {
    return db
      .select()
      .from(sessionsTable)
      .orderBy(desc(sessionsTable.updatedAt))
      .all()
      .map((session) => sessionSchema.parse(session));
  }

  function createSession(title: string): Session {
    const now = nowIso();
    const session = sessionSchema.parse({
      id: createId("session"),
      title,
      status: "idle",
      latestUserMessage: null,
      latestAssistantMessage: null,
      createdAt: now,
      updatedAt: now,
    });

    db.insert(sessionsTable).values(session).run();
    return session;
  }

  function getSession(sessionId: string): Session | null {
    const session = db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).get();
    return session ? sessionSchema.parse(session) : null;
  }

  function updateSession(sessionId: string, partial: Partial<Session>): Session {
    const current = getSession(sessionId);
    if (!current) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const next = sessionSchema.parse({
      ...current,
      ...partial,
      updatedAt: nowIso(),
    });

    db.update(sessionsTable).set(next).where(eq(sessionsTable.id, sessionId)).run();
    return next;
  }

  function listTasks(): Task[] {
    return db
      .select()
      .from(tasksTable)
      .orderBy(desc(tasksTable.updatedAt))
      .all()
      .map((task) => taskSchema.parse(task));
  }

  function createTask(input: Omit<Task, "id" | "createdAt" | "updatedAt">): Task {
    const now = nowIso();
    const task = taskSchema.parse({
      id: createId("task"),
      createdAt: now,
      updatedAt: now,
      ...input,
    });

    db.insert(tasksTable).values(task).run();
    return task;
  }

  function getTask(taskId: string): Task | null {
    const task = db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).get();
    return task ? taskSchema.parse(task) : null;
  }

  function updateTask(taskId: string, partial: Partial<Task>): Task {
    const current = getTask(taskId);
    if (!current) {
      throw new Error(`Task ${taskId} not found`);
    }

    const next = taskSchema.parse({ ...current, ...partial, updatedAt: nowIso() });
    db.update(tasksTable).set(next).where(eq(tasksTable.id, taskId)).run();
    return next;
  }

  function createRun(input: Omit<Run, "id" | "createdAt" | "updatedAt">): Run {
    const now = nowIso();
    const run = runSchema.parse({
      id: createId("run"),
      createdAt: now,
      updatedAt: now,
      ...input,
      prompt: input.prompt ?? null,
      sourceRunId: input.sourceRunId ?? null,
      recoveryMode: input.recoveryMode ?? "start",
    });
    db.insert(runsTable).values(run).run();
    return run;
  }

  function updateRun(runId: string, partial: Partial<Run>): Run {
    const current = db.select().from(runsTable).where(eq(runsTable.id, runId)).get();
    if (!current) {
      throw new Error(`Run ${runId} not found`);
    }

    const next = runSchema.parse({ ...current, ...partial, updatedAt: nowIso() });
    db.update(runsTable).set(next).where(eq(runsTable.id, runId)).run();
    return next;
  }

  function getRun(runId: string): Run | null {
    const run = db.select().from(runsTable).where(eq(runsTable.id, runId)).get();
    return run ? runSchema.parse(run) : null;
  }

  function listRuns(sessionId?: string): Run[] {
    const query = db.select().from(runsTable);
    const rows = sessionId
      ? query
          .where(eq(runsTable.sessionId, sessionId))
          .orderBy(asc(runsTable.createdAt), asc(runsTable.id))
          .all()
      : query.orderBy(asc(runsTable.createdAt), asc(runsTable.id)).all();

    return sortChronologicalRows(rows.map((run) => runSchema.parse(run)));
  }

  function addMessage(
    input: Omit<SessionMessage, "id" | "createdAt"> & { parentHistoryEntryId?: string | null },
  ): SessionMessage {
    const { parentHistoryEntryId, ...messageInput } = input;
    const message = sessionMessageSchema.parse({
      id: createId("msg"),
      createdAt: nowIso(),
      ...messageInput,
    });
    db.insert(messagesTable).values(message).run();
    addSessionHistoryEntry({
      sessionId: message.sessionId,
      parentId: parentHistoryEntryId ?? getLatestSessionHistoryEntry(message.sessionId)?.id ?? null,
      kind: "message",
      messageId: message.id,
      summary: null,
      details: null,
    });
    return message;
  }

  function listMessages(sessionId: string): SessionMessage[] {
    return sortChronologicalRows(
      db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.sessionId, sessionId))
        .orderBy(asc(messagesTable.createdAt), asc(messagesTable.id))
        .all()
        .map((message) => sessionMessageSchema.parse(message)),
    );
  }

  function addSessionHistoryEntry(
    input: Omit<SessionHistoryEntry, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): SessionHistoryEntry {
    const timestamp = nowIso();
    const entry = sessionHistoryEntrySchema.parse({
      id: input.id ?? createId("hist"),
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    db.insert(sessionHistoryEntriesTable)
      .values(serializeSessionHistoryEntry(entry))
      .run();

    return entry;
  }

  function listSessionHistoryEntries(sessionId: string): SessionHistoryEntry[] {
    return sortChronologicalRows(
      db
        .select()
        .from(sessionHistoryEntriesTable)
        .where(eq(sessionHistoryEntriesTable.sessionId, sessionId))
        .orderBy(asc(sessionHistoryEntriesTable.createdAt), asc(sessionHistoryEntriesTable.id))
        .all()
        .map((entry) => parseSessionHistoryEntry(entry)),
    );
  }

  function getLatestSessionHistoryEntry(sessionId: string): SessionHistoryEntry | null {
    const entries = listSessionHistoryEntries(sessionId);
    return entries.at(-1) ?? null;
  }

  function addEvent(input: Omit<EventRecord, "id" | "createdAt">): EventRecord {
    const event = eventRecordSchema.parse({
      id: createId("evt"),
      createdAt: nowIso(),
      ...input,
    });
    db.insert(eventsTable)
      .values({ ...event, payload: JSON.stringify(event.payload) })
      .run();
    return event;
  }

  function listEvents(runId: string): EventRecord[] {
    return db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.runId, runId))
      .all()
      .map((event) =>
        eventRecordSchema.parse({
          ...event,
          payload: parseJson(event.payload, {}),
        }),
      );
  }

  function createToolCall(
    input: Omit<ToolCall, "createdAt" | "updatedAt"> & { id?: string },
  ): ToolCall {
    const toolCall = toolCallSchema.parse({
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...input,
      id: input.id ?? createId("tool"),
    });

    db.insert(toolCallsTable)
      .values({
        ...toolCall,
        input: JSON.stringify(toolCall.input),
        output: toolCall.output ? JSON.stringify(toolCall.output) : null,
      })
      .run();

    return toolCall;
  }

  function updateToolCall(toolCallId: string, partial: Partial<ToolCall>): ToolCall {
    const current = db.select().from(toolCallsTable).where(eq(toolCallsTable.id, toolCallId)).get();
    if (!current) {
      throw new Error(`Tool call ${toolCallId} not found`);
    }

    const normalized = toolCallSchema.parse({
      ...current,
      input: parseJson(current.input, {}),
      output: parseJson(current.output, null),
      ...partial,
      updatedAt: nowIso(),
    });

    db.update(toolCallsTable)
      .set({
        ...normalized,
        input: JSON.stringify(normalized.input),
        output: normalized.output ? JSON.stringify(normalized.output) : null,
      })
      .where(eq(toolCallsTable.id, toolCallId))
      .run();

    return normalized;
  }

  function getToolCall(toolCallId: string): ToolCall | null {
    const toolCall = db
      .select()
      .from(toolCallsTable)
      .where(eq(toolCallsTable.id, toolCallId))
      .get();
    return toolCall
      ? toolCallSchema.parse({
          ...toolCall,
          input: parseJson(toolCall.input, {}),
          output: parseJson(toolCall.output, null),
        })
      : null;
  }

  function listToolCalls(runId: string): ToolCall[] {
    return sortChronologicalRows(
      db
        .select()
        .from(toolCallsTable)
        .where(eq(toolCallsTable.runId, runId))
        .orderBy(asc(toolCallsTable.createdAt), asc(toolCallsTable.id))
        .all()
        .map((toolCall) =>
          toolCallSchema.parse({
            ...toolCall,
            input: parseJson(toolCall.input, {}),
            output: parseJson(toolCall.output, null),
          }),
        ),
    );
  }

  function listToolCallsBySession(sessionId: string): ToolCall[] {
    return db
      .select()
      .from(toolCallsTable)
      .where(eq(toolCallsTable.sessionId, sessionId))
      .orderBy(desc(toolCallsTable.createdAt), desc(toolCallsTable.id))
      .all()
      .map((toolCall) =>
        toolCallSchema.parse({
          ...toolCall,
          input: parseJson(toolCall.input, {}),
          output: parseJson(toolCall.output, null),
        }),
      );
  }

  function createReviewRequest(
    input: Omit<ReviewRequest, "id" | "createdAt" | "updatedAt">,
  ): ReviewRequest {
    const review = reviewRequestSchema.parse({
      id: createId("review"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...input,
    });
    db.insert(reviewRequestsTable).values(review).run();
    return review;
  }

  function updateReviewRequest(reviewId: string, partial: Partial<ReviewRequest>): ReviewRequest {
    const current = db
      .select()
      .from(reviewRequestsTable)
      .where(eq(reviewRequestsTable.id, reviewId))
      .get();
    if (!current) {
      throw new Error(`Review request ${reviewId} not found`);
    }

    const next = reviewRequestSchema.parse({ ...current, ...partial, updatedAt: nowIso() });
    db.update(reviewRequestsTable).set(next).where(eq(reviewRequestsTable.id, reviewId)).run();
    return next;
  }

  function listReviewRequests(taskId?: string): ReviewRequest[] {
    const rows = taskId
      ? db.select().from(reviewRequestsTable).where(eq(reviewRequestsTable.taskId, taskId)).all()
      : db.select().from(reviewRequestsTable).all();

    return rows.map((review) => reviewRequestSchema.parse(review));
  }

  function writeMemory(input: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt">): MemoryRecord {
    const memory = memoryRecordSchema.parse({
      id: createId("memory"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...input,
    });

    db.insert(memoriesTable)
      .values({ ...memory, tags: JSON.stringify(memory.tags) })
      .run();
    syncMemoryFts(memory);
    return memory;
  }

  function searchMemories(query: string, scope?: string, scopeId?: string): MemoryRecord[] {
    const matchedIds = sqlite
      .prepare("SELECT id FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank")
      .all(query)
      .map((row: unknown) => (row as { id: string }).id);

    if (matchedIds.length === 0) {
      return [];
    }

    const rows = db.select().from(memoriesTable).all();
    return rows
      .filter((memory) => matchedIds.includes(memory.id))
      .filter((memory) => !scope || memory.scope === scope)
      .filter((memory) => !scopeId || memory.scopeId === scopeId)
      .map((memory) =>
        memoryRecordSchema.parse({
          ...memory,
          tags: parseJson(memory.tags, []),
        }),
      );
  }

  function listMemories(scope?: string, scopeId?: string): MemoryRecord[] {
    const filters = [];

    if (scope) {
      filters.push(eq(memoriesTable.scope, scope));
    }

    if (scopeId) {
      filters.push(eq(memoriesTable.scopeId, scopeId));
    }

    const query = db.select().from(memoriesTable);
    const rows =
      filters.length === 2
        ? query.where(and(filters[0], filters[1])).all()
        : filters.length === 1
          ? query.where(filters[0]).all()
          : query.all();

    return rows.map((memory) =>
      memoryRecordSchema.parse({
        ...memory,
        tags: parseJson(memory.tags, []),
      }),
    );
  }

  function listProviderConfigs(): ProviderConfig[] {
    return db
      .select()
      .from(providerConfigsTable)
      .orderBy(desc(providerConfigsTable.updatedAt))
      .all()
      .map((config) => parseStoredProviderConfig(config));
  }

  function upsertProviderConfig(
    input: Omit<ProviderConfig, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): ProviderConfig {
    const now = nowIso();
    const config = providerConfigSchema.parse({
      id: input.id ?? createId("provider"),
      createdAt: now,
      updatedAt: now,
      ...input,
    });
    const existing = db
      .select()
      .from(providerConfigsTable)
      .where(eq(providerConfigsTable.id, config.id))
      .get();

    if (existing) {
      db.update(providerConfigsTable)
        .set({
          ...serializeProviderConfig(config),
          enabled: true,
        })
        .where(eq(providerConfigsTable.id, config.id))
        .run();
    } else {
      db.insert(providerConfigsTable)
        .values({
          ...serializeProviderConfig(config),
          enabled: true,
        })
        .run();
    }

    return config;
  }

  function getProviderConfig(providerId?: string): ProviderConfig | null {
    const row = providerId
      ? db.select().from(providerConfigsTable).where(eq(providerConfigsTable.id, providerId)).get()
      : db
          .select()
          .from(providerConfigsTable)
          .orderBy(desc(providerConfigsTable.updatedAt))
          .limit(1)
          .get();
    return row ? parseStoredProviderConfig(row) : null;
  }

  function loadSessionRuntimeSnapshot(sessionId: string): {
    sessionId: string;
    snapshot: string;
    updatedAt: string;
  } | null {
    const statement = sqlite.prepare(
      "SELECT session_id as sessionId, snapshot, updated_at as updatedAt FROM session_runtime WHERE session_id = ?",
    ) as {
      get?: (sessionId: string) => { sessionId: string; snapshot: string; updatedAt: string } | undefined;
      all?: (sessionId: string) => Array<{ sessionId: string; snapshot: string; updatedAt: string }>;
    };

    const row =
      statement.get?.(sessionId) ??
      statement.all?.(sessionId)?.[0] ??
      null;

    return row ?? null;
  }

  function saveSessionRuntimeSnapshot(input: {
    sessionId: string;
    snapshot: string;
    updatedAt: string;
  }): void {
    sqlite
      .prepare(
        `INSERT INTO session_runtime (session_id, snapshot, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           snapshot = excluded.snapshot,
           updated_at = excluded.updated_at`,
      )
      .run(input.sessionId, input.snapshot, input.updatedAt);
  }

  return {
    listSessions,
    createSession,
    getSession,
    updateSession,
    listTasks,
    createTask,
    getTask,
    updateTask,
    createRun,
    updateRun,
    getRun,
    listRuns,
    addMessage,
    listMessages,
    addSessionHistoryEntry,
    listSessionHistoryEntries,
    addEvent,
    listEvents,
    createToolCall,
    updateToolCall,
    getToolCall,
    listToolCalls,
    listToolCallsBySession,
    createReviewRequest,
    updateReviewRequest,
    listReviewRequests,
    writeMemory,
    searchMemories,
    listMemories,
    listProviderConfigs,
    upsertProviderConfig,
    getProviderConfig,
    loadSessionRuntimeSnapshot,
    saveSessionRuntimeSnapshot,
  };
}

function resolveDatabasePath(): string {
  const workspaceRoot = process.env.OMI_WORKSPACE_ROOT ?? process.cwd();
  return resolve(workspaceRoot, "workspace-data", "app.db");
}

interface DatabaseMigration {
  id: string;
  apply: (sqlite: MigrationDatabase) => void;
}

const DATABASE_MIGRATIONS: DatabaseMigration[] = [
  {
    id: "20260331_runs_lineage_columns",
    apply(sqlite) {
      ensureColumnExists(sqlite, "runs", "prompt", "ALTER TABLE runs ADD COLUMN prompt TEXT");
      ensureColumnExists(sqlite, "runs", "source_run_id", "ALTER TABLE runs ADD COLUMN source_run_id TEXT");
      ensureColumnExists(sqlite, "runs", "recovery_mode", "ALTER TABLE runs ADD COLUMN recovery_mode TEXT");
    },
  },
  {
    id: "20260331_provider_configs_api_key",
    apply(sqlite) {
      ensureColumnExists(
        sqlite,
        "provider_configs",
        "api_key",
        "ALTER TABLE provider_configs ADD COLUMN api_key TEXT NOT NULL DEFAULT ''",
      );
    },
  },
];

export function applyMigrations(sqlite: MigrationDatabase): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE_NAME} (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `);

  const applied = new Set<string>(
    sqlite
      .prepare(`SELECT id FROM ${MIGRATIONS_TABLE_NAME} ORDER BY created_at ASC, id ASC`)
      .all()
      .map((row: unknown) => (row as { id: string }).id),
  );

  const markApplied = sqlite.prepare(
    `INSERT INTO ${MIGRATIONS_TABLE_NAME} (id, created_at) VALUES (?, ?)`,
  );

  const runMigration = sqlite.transaction((migration: DatabaseMigration) => {
    migration.apply(sqlite);
    markApplied.run(migration.id, nowIso());
  });

  for (const migration of DATABASE_MIGRATIONS) {
    if (applied.has(migration.id)) {
      continue;
    }
    runMigration(migration);
  }
}

function serializeProviderConfig(config: ProviderConfig): ProviderConfig {
  return {
    ...config,
    apiKey: weakEncryptProviderApiKey(config.apiKey),
  };
}

function parseStoredProviderConfig(row: unknown): ProviderConfig {
  const parsed = providerConfigSchema.parse(row);
  return {
    ...parsed,
    apiKey: weakDecryptStoredProviderApiKey(parsed.apiKey),
  };
}

export function weakEncryptProviderApiKey(apiKey: string): string {
  const input = Buffer.from(apiKey, "utf8");
  const encrypted = Buffer.allocUnsafe(input.length);

  for (let index = 0; index < input.length; index += 1) {
    encrypted[index] = input[index] ^ PROVIDER_API_KEY_WEAK_KEY[index % PROVIDER_API_KEY_WEAK_KEY.length];
  }

  return `${PROVIDER_API_KEY_PREFIX}${encrypted.toString("base64")}`;
}

export function weakDecryptStoredProviderApiKey(storedApiKey: string): string {
  if (!storedApiKey.startsWith(PROVIDER_API_KEY_PREFIX)) {
    throw new Error("Stored provider API key must use enc:v1 encryption.");
  }

  const encoded = storedApiKey.slice(PROVIDER_API_KEY_PREFIX.length);

  try {
    const input = Buffer.from(encoded, "base64");
    const decrypted = Buffer.allocUnsafe(input.length);

    for (let index = 0; index < input.length; index += 1) {
      decrypted[index] = input[index] ^ PROVIDER_API_KEY_WEAK_KEY[index % PROVIDER_API_KEY_WEAK_KEY.length];
    }

    return decrypted.toString("utf8");
  } catch {
    throw new Error("Stored provider API key is invalid.");
  }
}

function ensureColumnExists(
  sqlite: MigrationDatabase,
  tableName: string,
  columnName: string,
  alterStatement: string,
): void {
  const columns = new Set<string>(
    sqlite
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((row: unknown) => (row as { name: string }).name),
  );

  if (!columns.has(columnName)) {
    sqlite.exec(alterStatement);
  }
}
