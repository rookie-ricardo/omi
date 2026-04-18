import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessionsTable = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  providerConfigId: text("provider_config_id"),
  model: text("model"),
  permissionMode: text("permission_mode").notNull(),
  thinkLevel: text("think_level").notNull(),
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

export const runLogsTable = sqliteTable("run_logs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  taskId: text("task_id"),
  status: text("status").notNull(),
  providerConfigId: text("provider_config_id"),
  model: text("model"),
  prompt: text("prompt"),
  sourceRunId: text("source_run_log_id"),
  recoveryMode: text("recovery_mode"),
  originRunId: text("origin_run_log_id"),
  terminalReason: text("terminal_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const messagesTable = sqliteTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  taskId: text("task_id"),
  parentMessageId: text("parent_message_id"),
  role: text("role").notNull(),
  messageType: text("message_type").notNull(),
  content: text("content").notNull(),
  model: text("model"),
  tokens: integer("tokens").notNull(),
  totalTokens: integer("total_tokens").notNull(),
  compressedFromMessageId: text("compressed_from_message_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const toolCallsTable = sqliteTable("tool_calls", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull(),
  sessionId: text("session_id").notNull(),
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

export const providerConfigsTable = sqliteTable("provider_configs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  protocol: text("protocol").notNull().default(""),
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key").notNull(),
  model: text("model").notNull(),
  url: text("url").notNull().default(""),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
