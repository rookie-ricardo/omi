import BetterSqlite3 from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import type {
  MemoryRecord,
  ProviderConfig,
  Run,
  Session,
  SessionMessage,
  Task,
  ToolCall,
} from "@omi/core";
import {
  createId,
  ensureDir,
  memoryRecordSchema,
  nowIso,
  parseJson,
  providerConfigSchema,
  runSchema,
  sessionMessageSchema,
  sessionSchema,
  taskSchema,
  toolCallSchema,
} from "@omi/core";

import type { AppStore } from "./contracts";
import {
  memoriesTable,
  messagesTable,
  providerConfigsTable,
  runLogsTable,
  sessionsTable,
  tasksTable,
  toolCallsTable,
} from "./schema";
import { sortChronologicalRows } from "./sort";

const PROVIDER_API_KEY_PREFIX = "enc:v1:";
const PROVIDER_API_KEY_WEAK_KEY = Buffer.from("omi", "utf8");

export function createAppDatabase(databasePath = resolveDatabasePath()): AppStore {
  ensureDir(dirname(databasePath));
  const sqlite = new BetterSqlite3(databasePath);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      provider_config_id TEXT,
      model TEXT,
      permission_mode TEXT NOT NULL,
      think_level TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS run_logs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      task_id TEXT,
      status TEXT NOT NULL,
      provider_config_id TEXT,
      model TEXT,
      prompt TEXT,
      source_run_log_id TEXT,
      recovery_mode TEXT,
      origin_run_log_id TEXT,
      terminal_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      task_id TEXT,
      parent_message_id TEXT,
      role TEXT NOT NULL,
      message_type TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      compressed_from_message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS provider_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      model TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id, title, content, tags);
    CREATE INDEX IF NOT EXISTS idx_messages_session_created
      ON messages (session_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_messages_parent_created
      ON messages (parent_message_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session_created
      ON tool_calls (session_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_message_created
      ON tool_calls (message_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_run_logs_session_created
      ON run_logs (session_id, created_at, id);
  `);

  function syncMemoryFts(memory: MemoryRecord): void {
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
      providerConfigId: null,
      model: null,
      permissionMode: "default",
      thinkLevel: "medium",
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

    const next = sessionSchema.parse({ ...current, ...partial, updatedAt: nowIso() });
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
      providerConfigId: input.providerConfigId ?? null,
      model: input.model ?? null,
      prompt: input.prompt ?? null,
      sourceRunId: input.sourceRunId ?? null,
      recoveryMode: input.recoveryMode ?? "start",
      originRunId: input.originRunId ?? null,
      terminalReason: input.terminalReason ?? null,
    });
    db.insert(runLogsTable).values(run).run();
    return run;
  }

  function updateRun(runId: string, partial: Partial<Run>): Run {
    const current = getRun(runId);
    if (!current) {
      throw new Error(`Run ${runId} not found`);
    }

    const next = runSchema.parse({ ...current, ...partial, updatedAt: nowIso() });
    db.update(runLogsTable).set(next).where(eq(runLogsTable.id, runId)).run();
    return next;
  }

  function getRun(runId: string): Run | null {
    const run = db.select().from(runLogsTable).where(eq(runLogsTable.id, runId)).get();
    return run ? runSchema.parse(run) : null;
  }

  function listRuns(sessionId?: string): Run[] {
    const rows = sessionId
      ? db
          .select()
          .from(runLogsTable)
          .where(eq(runLogsTable.sessionId, sessionId))
          .orderBy(asc(runLogsTable.createdAt), asc(runLogsTable.id))
          .all()
      : db
          .select()
          .from(runLogsTable)
          .orderBy(asc(runLogsTable.createdAt), asc(runLogsTable.id))
          .all();
    return sortChronologicalRows(rows.map((run) => runSchema.parse(run)));
  }

  function addMessage(
    input: Omit<SessionMessage, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): SessionMessage {
    const now = nowIso();
    const normalizedTokens = Number.isFinite(input.tokens) ? input.tokens : estimateTextTokens(input.content);
    const message = sessionMessageSchema.parse({
      ...input,
      id: input.id ?? createId("msg"),
      createdAt: now,
      updatedAt: now,
      tokens: normalizedTokens,
      totalTokens: input.totalTokens ?? normalizedTokens,
      model: input.model ?? null,
      taskId: input.taskId ?? null,
      parentMessageId: input.parentMessageId ?? null,
      compressedFromMessageId: input.compressedFromMessageId ?? null,
    });
    db.insert(messagesTable).values(message).run();
    return message;
  }

  function getMessage(messageId: string): SessionMessage | null {
    const message = db.select().from(messagesTable).where(eq(messagesTable.id, messageId)).get();
    return message ? sessionMessageSchema.parse(message) : null;
  }

  function updateMessage(messageId: string, partial: Partial<SessionMessage>): SessionMessage {
    const current = getMessage(messageId);
    if (!current) {
      throw new Error(`Message ${messageId} not found`);
    }

    const next = sessionMessageSchema.parse({
      ...current,
      ...partial,
      totalTokens: partial.totalTokens ?? current.totalTokens,
      tokens: partial.tokens ?? current.tokens,
      updatedAt: nowIso(),
    });
    db.update(messagesTable).set(next).where(eq(messagesTable.id, messageId)).run();
    return next;
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

  function listChildMessages(parentMessageId: string): SessionMessage[] {
    return sortChronologicalRows(
      db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.parentMessageId, parentMessageId))
        .orderBy(asc(messagesTable.createdAt), asc(messagesTable.id))
        .all()
        .map((message) => sessionMessageSchema.parse(message)),
    );
  }

  function createToolCall(
    input: Omit<ToolCall, "createdAt" | "updatedAt"> & { id?: string },
  ): ToolCall {
    const now = nowIso();
    const { id: _inputId, ...inputRest } = input;
    const toolCall = toolCallSchema.parse({
      id: input.id ?? createId("tool"),
      createdAt: now,
      updatedAt: now,
      ...inputRest,
      output: input.output ?? null,
      error: input.error ?? null,
    });
    db.insert(toolCallsTable)
      .values({
        id: toolCall.id,
        messageId: toolCall.messageId,
        sessionId: toolCall.sessionId,
        toolName: toolCall.toolName,
        approvalState: toolCall.approvalState,
        input: JSON.stringify(toolCall.input),
        output: toolCall.output ? JSON.stringify(toolCall.output) : null,
        error: toolCall.error,
        createdAt: toolCall.createdAt,
        updatedAt: toolCall.updatedAt,
      })
      .run();
    return toolCall;
  }

  function updateToolCall(toolCallId: string, partial: Partial<ToolCall>): ToolCall {
    const current = getToolCall(toolCallId);
    if (!current) {
      throw new Error(`Tool call ${toolCallId} not found`);
    }

    const next = toolCallSchema.parse({
      ...current,
      ...partial,
      updatedAt: nowIso(),
    });
    db.update(toolCallsTable)
      .set({
        ...next,
        input: JSON.stringify(next.input),
        output: next.output ? JSON.stringify(next.output) : null,
      })
      .where(eq(toolCallsTable.id, toolCallId))
      .run();
    return next;
  }

  function getToolCall(toolCallId: string): ToolCall | null {
    const row = db.select().from(toolCallsTable).where(eq(toolCallsTable.id, toolCallId)).get();
    return row
      ? toolCallSchema.parse({
          ...row,
          input: parseJson(row.input, {}),
          output: parseJson(row.output, null),
        })
      : null;
  }

  function listToolCallsBySession(sessionId: string): ToolCall[] {
    return sortChronologicalRows(
      db
        .select()
        .from(toolCallsTable)
        .where(eq(toolCallsTable.sessionId, sessionId))
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

  function listToolCallsByMessage(messageId: string): ToolCall[] {
    return sortChronologicalRows(
      db
        .select()
        .from(toolCallsTable)
        .where(eq(toolCallsTable.messageId, messageId))
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

  function writeMemory(input: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt">): MemoryRecord {
    const memory = memoryRecordSchema.parse({
      id: createId("memory"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...input,
    });
    db.insert(memoriesTable).values({ ...memory, tags: JSON.stringify(memory.tags) }).run();
    syncMemoryFts(memory);
    return memory;
  }

  function searchMemories(query: string, scope?: string, scopeId?: string): MemoryRecord[] {
    const matchedIds = sqlite
      .prepare("SELECT id FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank")
      .all(query)
      .map((row) => (row as { id: string }).id);
    const rows = db.select().from(memoriesTable).all();
    return rows
      .filter((row) => matchedIds.includes(row.id))
      .map((row) =>
        memoryRecordSchema.parse({
          ...row,
          tags: parseJson(row.tags, []),
        }),
      )
      .filter((row) => (scope ? row.scope === scope : true))
      .filter((row) => (scopeId ? row.scopeId === scopeId : true));
  }

  function listMemories(scope?: string, scopeId?: string): MemoryRecord[] {
    return db
      .select()
      .from(memoriesTable)
      .orderBy(desc(memoriesTable.updatedAt))
      .all()
      .map((row) =>
        memoryRecordSchema.parse({
          ...row,
          tags: parseJson(row.tags, []),
        }),
      )
      .filter((row) => (scope ? row.scope === scope : true))
      .filter((row) => (scopeId ? row.scopeId === scopeId : true));
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
    const resolvedId = input.id ?? createId("provider");
    const existing = db
      .select()
      .from(providerConfigsTable)
      .where(eq(providerConfigsTable.id, resolvedId))
      .get();
    const currentApiKey = existing ? weakDecryptStoredProviderApiKey(existing.apiKey) : "";
    const config = providerConfigSchema.parse({
      id: resolvedId,
      name: input.name,
      protocol: input.protocol,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey || currentApiKey,
      model: input.model,
      url: input.url ?? "",
      enabled: input.enabled ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    const row = serializeProviderConfig(config);
    if (existing) {
      db.update(providerConfigsTable).set(row).where(eq(providerConfigsTable.id, resolvedId)).run();
    } else {
      db.insert(providerConfigsTable).values(row).run();
    }
    return config;
  }

  function getProviderConfig(providerId?: string): ProviderConfig | null {
    const row = providerId
      ? db.select().from(providerConfigsTable).where(eq(providerConfigsTable.id, providerId)).get()
      : db
          .select()
          .from(providerConfigsTable)
          .where(eq(providerConfigsTable.enabled, true))
          .orderBy(desc(providerConfigsTable.updatedAt))
          .limit(1)
          .get();
    return row ? parseStoredProviderConfig(row) : null;
  }

  function deleteProviderConfig(id: string): void {
    db.delete(providerConfigsTable).where(eq(providerConfigsTable.id, id)).run();
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
    getMessage,
    updateMessage,
    listMessages,
    listChildMessages,
    createToolCall,
    updateToolCall,
    getToolCall,
    listToolCallsBySession,
    listToolCallsByMessage,
    writeMemory,
    searchMemories,
    listMemories,
    listProviderConfigs,
    upsertProviderConfig,
    getProviderConfig,
    deleteProviderConfig,
  };
}

function resolveDatabasePath(): string {
  const workspaceRoot = process.env.OMI_WORKSPACE_ROOT ?? process.cwd();
  return resolve(workspaceRoot, "workspace-data", "app.db");
}

type MigrationDatabase = BetterSqlite3.Database;

export function applyMigrations(_sqlite: MigrationDatabase): void {}

export function revertLastMigration(_sqlite: MigrationDatabase): string | null {
  return null;
}

export function validateSchemaConsistency(_sqlite: MigrationDatabase): string[] {
  return [];
}

function estimateTextTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

type StoredProviderConfigRow = {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  url: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

function serializeProviderConfig(config: ProviderConfig): StoredProviderConfigRow {
  return {
    id: config.id,
    name: config.name,
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    apiKey: weakEncryptProviderApiKey(config.apiKey),
    model: config.model,
    url: config.url,
    enabled: config.enabled ?? true,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

function parseStoredProviderConfig(row: StoredProviderConfigRow): ProviderConfig {
  return providerConfigSchema.parse({
    ...row,
    enabled: Boolean(row.enabled),
    apiKey: weakDecryptStoredProviderApiKey(row.apiKey),
  });
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
    return storedApiKey;
  }

  const encoded = storedApiKey.slice(PROVIDER_API_KEY_PREFIX.length);
  const input = Buffer.from(encoded, "base64");
  const decrypted = Buffer.allocUnsafe(input.length);
  for (let index = 0; index < input.length; index += 1) {
    decrypted[index] = input[index] ^ PROVIDER_API_KEY_WEAK_KEY[index % PROVIDER_API_KEY_WEAK_KEY.length];
  }
  return decrypted.toString("utf8");
}
