import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessionsTable = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  latestUserMessage: text("latest_user_message"),
  latestAssistantMessage: text("latest_assistant_message"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tasksTable = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  originSessionId: text("origin_session_id").notNull(),
  candidateReason: text("candidate_reason").notNull(),
  autoCreated: integer("auto_created", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const runsTable = sqliteTable("runs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  taskId: text("task_id"),
  status: text("status").notNull(),
  provider: text("provider").notNull(),
  prompt: text("prompt"),
  sourceRunId: text("source_run_id"),
  recoveryMode: text("recovery_mode"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const messagesTable = sqliteTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sessionHistoryEntriesTable = sqliteTable("session_history_entries", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  parentId: text("parent_id"),
  kind: text("kind").notNull(),
  messageId: text("message_id"),
  summary: text("summary"),
  details: text("details"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const eventsTable = sqliteTable("events", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  sessionId: text("session_id").notNull(),
  type: text("type").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
});

export const reviewRequestsTable = sqliteTable("review_requests", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  taskId: text("task_id"),
  toolCallId: text("tool_call_id"),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const toolCallsTable = sqliteTable("tool_calls", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  sessionId: text("session_id").notNull(),
  taskId: text("task_id"),
  toolName: text("tool_name").notNull(),
  approvalState: text("approval_state").notNull(),
  input: text("input").notNull(),
  output: text("output"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const memoriesTable = sqliteTable("memories", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  scopeId: text("scope_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: text("tags").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sessionRuntimeTable = sqliteTable("session_runtime", {
  sessionId: text("session_id").primaryKey(),
  snapshot: text("snapshot").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const providerConfigsTable = sqliteTable("provider_configs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key").notNull(),
  model: text("model").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
