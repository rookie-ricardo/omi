import BetterSqlite3 from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import {
  type EventRecord,
  type MemoryRecord,
  type ProviderConfig,
  type ReviewRequest,
  type Run,
  type RunCheckpoint,
  type Session,
  type SessionBranch,
  type SessionHistoryEntry,
  type SessionMessage,
  type Task,
  type ToolCall,
  eventRecordSchema,
  memoryRecordSchema,
  providerConfigSchema,
  reviewRequestSchema,
  runCheckpointSchema,
  runSchema,
  sessionBranchSchema,
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
  runCheckpointsTable,
  sessionBranchesTable,
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
      protocol TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      model TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id, title, content, tags);
    CREATE TABLE IF NOT EXISTS session_branches (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      head_entry_id TEXT,
      title TEXT NOT NULL DEFAULT 'main',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS run_checkpoints (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_branches_session_created
      ON session_branches (session_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_run_checkpoints_run_created
      ON run_checkpoints (run_id, created_at, id);
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

    // Create the default "main" branch for the new session.
    const mainBranch = sessionBranchSchema.parse({
      id: createId("branch"),
      sessionId: session.id,
      headEntryId: null,
      title: "main",
      createdAt: now,
      updatedAt: now,
    });
    db.insert(sessionBranchesTable).values(mainBranch).run();

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
      originRunId: input.originRunId ?? null,
      resumeFromCheckpoint: input.resumeFromCheckpoint ?? null,
      terminalReason: input.terminalReason ?? null,
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
    input: Omit<SessionMessage, "id" | "createdAt"> & {
      parentHistoryEntryId?: string | null;
      branchId?: string | null;
      originRunId?: string | null;
    },
  ): SessionMessage {
    const { parentHistoryEntryId, branchId, originRunId, ...messageInput } = input;
    const message = sessionMessageSchema.parse({
      id: createId("msg"),
      createdAt: nowIso(),
      ...messageInput,
    });
    db.insert(messagesTable).values(message).run();

    const activeBranchId = branchId ?? getActiveBranchId(message.sessionId) ?? null;
    const resolvedParentId =
      parentHistoryEntryId ?? resolveDefaultParentHistoryEntryId(message.sessionId, activeBranchId);

    addSessionHistoryEntry({
      sessionId: message.sessionId,
      parentId: resolvedParentId,
      kind: "message",
      messageId: message.id,
      summary: null,
      details: null,
      branchId: activeBranchId,
      lineageDepth: computeLineageDepth(resolvedParentId),
      originRunId: originRunId ?? null,
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
    const resolvedParentId =
      input.parentId ?? resolveDefaultParentHistoryEntryId(input.sessionId, input.branchId ?? null);
    const entry = sessionHistoryEntrySchema.parse({
      id: input.id ?? createId("hist"),
      ...input,
      parentId: resolvedParentId,
      lineageDepth: computeLineageDepth(resolvedParentId),
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

  function deleteProviderConfig(id: string): void {
    db.delete(providerConfigsTable).where(eq(providerConfigsTable.id, id)).run();
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

  // --- Session Branch ---

  function createBranch(input: Omit<SessionBranch, "createdAt" | "updatedAt">): SessionBranch {
    const now = nowIso();
    const branch = sessionBranchSchema.parse({
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    db.insert(sessionBranchesTable).values(branch).run();
    return branch;
  }

  function getBranch(branchId: string): SessionBranch | null {
    const row = db.select().from(sessionBranchesTable).where(eq(sessionBranchesTable.id, branchId)).get();
    return row ? sessionBranchSchema.parse(row) : null;
  }

  function listBranches(sessionId: string): SessionBranch[] {
    return db
      .select()
      .from(sessionBranchesTable)
      .where(eq(sessionBranchesTable.sessionId, sessionId))
      .orderBy(asc(sessionBranchesTable.createdAt))
      .all()
      .map((row) => sessionBranchSchema.parse(row));
  }

  function updateBranch(branchId: string, partial: Partial<SessionBranch>): SessionBranch {
    const current = getBranch(branchId);
    if (!current) {
      throw new Error(`Branch ${branchId} not found`);
    }
    const next = sessionBranchSchema.parse({ ...current, ...partial, updatedAt: nowIso() });
    db.update(sessionBranchesTable).set(next).where(eq(sessionBranchesTable.id, branchId)).run();
    return next;
  }

  // --- Run Checkpoint ---

  function createCheckpoint(input: Omit<RunCheckpoint, "createdAt">): RunCheckpoint {
    const checkpoint = runCheckpointSchema.parse({
      ...input,
      createdAt: nowIso(),
    });
    db.insert(runCheckpointsTable)
      .values({
        ...checkpoint,
        payload: JSON.stringify(checkpoint.payload),
      })
      .run();
    return checkpoint;
  }

  function listCheckpoints(runId: string): RunCheckpoint[] {
    return db
      .select()
      .from(runCheckpointsTable)
      .where(eq(runCheckpointsTable.runId, runId))
      .orderBy(asc(runCheckpointsTable.createdAt))
      .all()
      .map((row) =>
        runCheckpointSchema.parse({
          ...row,
          payload: parseJson(row.payload as string, {}),
        }),
      );
  }

  function getLatestCheckpoint(runId: string): RunCheckpoint | null {
    const checkpoints = listCheckpoints(runId);
    return checkpoints.at(-1) ?? null;
  }

  // --- Branch-aware History ---

  function getHistoryEntry(entryId: string): SessionHistoryEntry | null {
    const row = db
      .select()
      .from(sessionHistoryEntriesTable)
      .where(eq(sessionHistoryEntriesTable.id, entryId))
      .get();
    return row ? parseSessionHistoryEntry(row) : null;
  }

  function getBranchHistory(sessionId: string, branchId: string): SessionHistoryEntry[] {
    return sortChronologicalRows(
      db
        .select()
        .from(sessionHistoryEntriesTable)
        .where(
          and(
            eq(sessionHistoryEntriesTable.sessionId, sessionId),
            eq(sessionHistoryEntriesTable.branchId, branchId),
          ),
        )
        .orderBy(asc(sessionHistoryEntriesTable.createdAt), asc(sessionHistoryEntriesTable.id))
        .all()
        .map((entry) => parseSessionHistoryEntry(entry)),
    );
  }

  function computeLineageDepth(parentId: string | null): number {
    if (!parentId) return 0;
    const parent = getHistoryEntry(parentId);
    if (!parent) return 0;
    return parent.lineageDepth + 1;
  }

  function resolveDefaultParentHistoryEntryId(
    sessionId: string,
    branchId: string | null,
  ): string | null {
    if (branchId) {
      return getBranchHistory(sessionId, branchId).at(-1)?.id ?? null;
    }
    return getLatestSessionHistoryEntry(sessionId)?.id ?? null;
  }

  function getActiveBranchId(sessionId: string): string | null {
    const snapshotRow = loadSessionRuntimeSnapshot(sessionId);
    if (!snapshotRow) return null;
    try {
      const parsed = JSON.parse(snapshotRow.snapshot) as Record<string, unknown>;
      return (parsed.activeBranchId as string) ?? null;
    } catch {
      return null;
    }
  }

  function setActiveBranchId(sessionId: string, branchId: string): void {
    const snapshotRow = loadSessionRuntimeSnapshot(sessionId);
    let parsed: Record<string, unknown> = {};
    if (snapshotRow) {
      try {
        parsed = JSON.parse(snapshotRow.snapshot) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
    }
    parsed.activeBranchId = branchId;
    saveSessionRuntimeSnapshot({
      sessionId,
      snapshot: JSON.stringify(parsed),
      updatedAt: nowIso(),
    });
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
    deleteProviderConfig,
    loadSessionRuntimeSnapshot,
    saveSessionRuntimeSnapshot,
    createBranch,
    getBranch,
    listBranches,
    updateBranch,
    createCheckpoint,
    listCheckpoints,
    getLatestCheckpoint: getLatestCheckpoint,
    getHistoryEntry,
    getBranchHistory,
    getActiveBranchId,
    setActiveBranchId,
  };
}

function resolveDatabasePath(): string {
  const workspaceRoot = process.env.OMI_WORKSPACE_ROOT ?? process.cwd();
  return resolve(workspaceRoot, "workspace-data", "app.db");
}

interface DatabaseMigration {
  id: string;
  apply: (sqlite: MigrationDatabase) => void;
  revert?: (sqlite: MigrationDatabase) => void;
  validate?: (sqlite: MigrationDatabase) => string[];
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
        "protocol",
        "ALTER TABLE provider_configs ADD COLUMN protocol TEXT NOT NULL DEFAULT ''",
      );
      ensureColumnExists(
        sqlite,
        "provider_configs",
        "api_key",
        "ALTER TABLE provider_configs ADD COLUMN api_key TEXT NOT NULL DEFAULT ''",
      );
    },
  },
  {
    id: "20260402_session_kernel_branches",
    apply(sqlite) {
      ensureColumnExists(sqlite, "runs", "origin_run_id", "ALTER TABLE runs ADD COLUMN origin_run_id TEXT");
      ensureColumnExists(sqlite, "runs", "resume_from_checkpoint", "ALTER TABLE runs ADD COLUMN resume_from_checkpoint TEXT");
      ensureColumnExists(sqlite, "runs", "terminal_reason", "ALTER TABLE runs ADD COLUMN terminal_reason TEXT");

      const historyTableExists = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_history_entries'")
        .all().length > 0;
      if (historyTableExists) {
        ensureColumnExists(sqlite, "session_history_entries", "branch_id", "ALTER TABLE session_history_entries ADD COLUMN branch_id TEXT");
        ensureColumnExists(sqlite, "session_history_entries", "lineage_depth", "ALTER TABLE session_history_entries ADD COLUMN lineage_depth INTEGER NOT NULL DEFAULT 0");
        ensureColumnExists(sqlite, "session_history_entries", "origin_run_id", "ALTER TABLE session_history_entries ADD COLUMN origin_run_id TEXT");
      }

      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS session_branches (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          head_entry_id TEXT,
          title TEXT NOT NULL DEFAULT 'main',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS run_checkpoints (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          phase TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      ensureIndexExists(
        sqlite,
        "idx_session_branches_session_created",
        "CREATE INDEX idx_session_branches_session_created ON session_branches (session_id, created_at, id)",
      );
      ensureIndexExists(
        sqlite,
        "idx_run_checkpoints_run_created",
        "CREATE INDEX idx_run_checkpoints_run_created ON run_checkpoints (run_id, created_at, id)",
      );
      const historyTableExistsAfterMigration = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_history_entries'")
        .all().length > 0;
      if (historyTableExistsAfterMigration) {
        ensureIndexExists(
          sqlite,
          "idx_session_history_entries_session_branch_created",
          "CREATE INDEX idx_session_history_entries_session_branch_created ON session_history_entries (session_id, branch_id, created_at, id)",
        );
      }
    },
    revert(sqlite) {
      sqlite.exec(`DROP TABLE IF EXISTS run_checkpoints`);
      sqlite.exec(`DROP TABLE IF EXISTS session_branches`);
      // Partial rollback semantics: table additions are reversible, additive columns are not.
      // SQLite does not support DROP COLUMN in the general case, so added columns remain.
      // Non-reversible additive columns:
      // - runs: origin_run_id, resume_from_checkpoint, terminal_reason
      // - session_history_entries: branch_id, lineage_depth, origin_run_id
    },
    validate(sqlite) {
      const errors: string[] = [];

      // Check that session_branches rows reference valid sessions
      const orphanBranches = sqlite
        .prepare(
          `SELECT sb.id, sb.session_id FROM session_branches sb
           WHERE NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = sb.session_id)`,
        )
        .all() as Array<{ id: string; session_id: string }>;
      for (const row of orphanBranches) {
        errors.push(`Branch ${row.id} references non-existent session ${row.session_id}`);
      }

      // Check that run_checkpoints rows reference valid runs
      const orphanCheckpoints = sqlite
        .prepare(
          `SELECT rc.id, rc.run_id FROM run_checkpoints rc
           WHERE NOT EXISTS (SELECT 1 FROM runs r WHERE r.id = rc.run_id)`,
        )
        .all() as Array<{ id: string; run_id: string }>;
      for (const row of orphanCheckpoints) {
        errors.push(`Checkpoint ${row.id} references non-existent run ${row.run_id}`);
      }

      // Check that history entries with branch_id reference valid branches
      const historyTableExists = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_history_entries'")
        .all().length > 0;
      if (historyTableExists) {
        const columnExists = sqlite
          .prepare("PRAGMA table_info(session_history_entries)")
          .all()
          .some((row: unknown) => (row as { name: string }).name === "branch_id");
        if (columnExists) {
          const orphanEntries = sqlite
            .prepare(
              `SELECT she.id, she.branch_id FROM session_history_entries she
               WHERE she.branch_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM session_branches sb WHERE sb.id = she.branch_id)`,
            )
            .all() as Array<{ id: string; branch_id: string }>;
          for (const row of orphanEntries) {
            errors.push(`History entry ${row.id} references non-existent branch ${row.branch_id}`);
          }
        }
      }

      // Check that runs with resume_from_checkpoint reference valid checkpoints
      const runsColumnExists = sqlite
        .prepare("PRAGMA table_info(runs)")
        .all()
        .some((row: unknown) => (row as { name: string }).name === "resume_from_checkpoint");
      if (runsColumnExists) {
        const orphanResumes = sqlite
          .prepare(
            `SELECT r.id, r.resume_from_checkpoint FROM runs r
             WHERE r.resume_from_checkpoint IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM run_checkpoints rc WHERE rc.id = r.resume_from_checkpoint)`,
          )
          .all() as Array<{ id: string; resume_from_checkpoint: string }>;
        for (const row of orphanResumes) {
          errors.push(`Run ${row.id} references non-existent checkpoint ${row.resume_from_checkpoint}`);
        }
      }

      return errors;
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

/**
 * Revert the most recent migration that has a revert function.
 * Returns the reverted migration id, or null if nothing to revert.
 */
export function revertLastMigration(sqlite: MigrationDatabase): string | null {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE_NAME} (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `);

  const applied = sqlite
    .prepare(`SELECT id FROM ${MIGRATIONS_TABLE_NAME} ORDER BY created_at DESC, id DESC`)
    .all()
    .map((row: unknown) => (row as { id: string }).id);

  for (const migrationId of applied) {
    const migration = DATABASE_MIGRATIONS.find((m) => m.id === migrationId);
    if (migration?.revert) {
      const runRevert = sqlite.transaction(() => {
        migration.revert!(sqlite);
        sqlite.prepare(`DELETE FROM ${MIGRATIONS_TABLE_NAME} WHERE id = ?`).run(migrationId);
      });
      runRevert();
      return migrationId;
    }
  }

  return null;
}

/**
 * Validate data consistency after schema migrations.
 * Returns an array of error strings; empty array means consistent.
 */
export function validateSchemaConsistency(sqlite: MigrationDatabase): string[] {
  const allErrors: string[] = [];
  for (const migration of DATABASE_MIGRATIONS) {
    if (migration.validate) {
      const errors = migration.validate(sqlite);
      allErrors.push(...errors);
    }
  }
  return allErrors;
}

function serializeProviderConfig(config: ProviderConfig): ProviderConfig {
  if (!config.protocol || config.protocol.trim().length === 0) {
    throw new Error(
      "providerConfig.protocol is required and must be one of anthropic-messages | openai-responses | openai-chat",
    );
  }
  return {
    ...config,
    protocol: config.protocol,
    apiKey: weakEncryptProviderApiKey(config.apiKey),
  };
}

function parseStoredProviderConfig(row: unknown): ProviderConfig {
  const parsed = providerConfigSchema.parse(row);
  if (!parsed.protocol || parsed.protocol.trim().length === 0) {
    throw new Error(
      "Stored providerConfig.protocol is required and must be one of anthropic-messages | openai-responses | openai-chat",
    );
  }
  return {
    ...parsed,
    protocol: parsed.protocol,
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

function ensureIndexExists(
  sqlite: MigrationDatabase,
  indexName: string,
  createStatement: string,
): void {
  const existing = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name = ?")
    .all(indexName);
  if (existing.length === 0) {
    sqlite.exec(createStatement);
  }
}
