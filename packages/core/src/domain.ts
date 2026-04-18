import { z } from "zod";

export const taskStatusSchema = z.enum(["inbox", "active", "review", "done", "dismissed"]);
export const sessionPermissionModeSchema = z.enum(["default", "yolo"]);
export const thinkLevelSchema = z.enum(["minimal", "low", "medium", "high"]);
export const messageTypeSchema = z.enum(["text", "tool_call", "tool_result", "summary"]);

export const memoryScopeSchema = z.enum(["session", "task", "workspace"]);
export const runStatusSchema = z.enum([
  "queued",
  "running",
  "blocked",
  "completed",
  "failed",
  "canceled",
]);

export const runRecoveryModeSchema = z.enum(["start", "retry", "resume"]);

export const approvalDecisionSchema = z.enum(["approved", "rejected", "deferred"]);

export const sessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  providerConfigId: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  permissionMode: sessionPermissionModeSchema.default("default"),
  thinkLevel: thinkLevelSchema.default("medium"),
  createdAt: z.string(),
  updatedAt: z.string(),
  latestUserMessage: z.string().nullable().default(null),
  latestAssistantMessage: z.string().nullable().default(null),
});

export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  originSessionId: z.string(),
  candidateReason: z.string(),
  autoCreated: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const runSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  taskId: z.string().nullable(),
  status: runStatusSchema,
  provider: z.string().nullable().optional(),
  providerConfigId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  prompt: z.string().nullable().optional(),
  sourceRunId: z.string().nullable().optional(),
  recoveryMode: runRecoveryModeSchema.nullable().optional(),
  originRunId: z.string().nullable().optional(),
  resumeFromCheckpoint: z.string().nullable().optional(),
  terminalReason: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const memoryRecordSchema = z.object({
  id: z.string(),
  scope: memoryScopeSchema,
  scopeId: z.string(),
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const toolCallSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  sessionId: z.string(),
  toolName: z.string(),
  approvalState: z.enum(["pending", "approved", "rejected", "not_required"]),
  input: z.record(z.string(), z.any()),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const providerProtocolSchema = z.enum([
  "anthropic-messages",
  "openai-chat",
  "openai-responses",
]);

export const providerConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  protocol: providerProtocolSchema,
  baseUrl: z.string().default(""),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  url: z.string().default(""),
  enabled: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const sessionMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  taskId: z.string().nullable().optional().default(null),
  parentMessageId: z.string().nullable().optional().default(null),
  role: z.enum(["system", "user", "assistant", "tool"]),
  messageType: messageTypeSchema.optional().default("text"),
  content: z.string(),
  model: z.string().nullable().optional().default(null),
  tokens: z.number().int().nonnegative().optional().default(0),
  totalTokens: z.number().int().nonnegative().optional().default(0),
  compressedFromMessageId: z.string().nullable().optional().default(null),
  createdAt: z.string(),
  updatedAt: z.string().optional().default(""),
});

export const skillSourceSchema = z.object({
  scope: z.enum(["workspace", "user", "bundled"]),
  client: z.enum(["agent", "claude"]),
  basePath: z.string(),
  skillPath: z.string(),
});

export const skillDescriptorSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  license: z.string().nullable().default(null),
  compatibility: z.string().nullable().default(null),
  metadata: z.record(z.string(), z.string()).default({}),
  allowedTools: z.array(z.string()).default([]),
  body: z.string(),
  source: skillSourceSchema,
  references: z.array(z.string()).default([]),
  assets: z.array(z.string()).default([]),
  scripts: z.array(z.string()).default([]),
  disableModelInvocation: z.boolean().default(false),
});

export const skillMatchSchema = skillDescriptorSchema.extend({
  score: z.number(),
});

export const resolvedSkillSchema = z.object({
  skill: skillDescriptorSchema,
  score: z.number(),
  injectedPrompt: z.string(),
  enabledToolNames: z.array(z.string()).default([]),
  referencedFiles: z.array(z.string()).default([]),
  diagnostics: z.array(z.string()).default([]),
});

export const gitChangedFileSchema = z.object({
  path: z.string(),
  status: z.enum(["modified", "added", "deleted", "untracked", "renamed"]),
  staged: z.boolean(),
  unstaged: z.boolean(),
  originalPath: z.string().nullable().default(null),
});

export const gitRepoStateSchema = z.object({
  hasRepository: z.boolean(),
  root: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  branches: z.array(z.string()).default([]),
  files: z.array(gitChangedFileSchema).default([]),
});

export const gitDiffRowSchema = z.object({
  kind: z.enum(["context", "added", "removed"]),
  leftLineNumber: z.number().nullable(),
  rightLineNumber: z.number().nullable(),
  leftText: z.string(),
  rightText: z.string(),
});

export const gitDiffPreviewSchema = z.object({
  path: z.string(),
  status: gitChangedFileSchema.shape.status,
  leftTitle: z.string(),
  rightTitle: z.string(),
  rows: z.array(gitDiffRowSchema),
});

export const sessionRuntimeSnapshotSchema = z.object({
  version: z.number().default(1),
  sessionId: z.string(),
  activeRunId: z.string().nullable(),
  pendingRunIds: z.array(z.string()).default([]),
  queuedRuns: z.array(z.any()).default([]),
  blockedRunId: z.string().nullable(),
  blockedToolCallId: z.string().nullable(),
  pendingApprovalToolCallIds: z.array(z.string()).default([]),
  interruptedRunIds: z.array(z.string()).default([]),
  lastUserPrompt: z.string().nullable(),
  lastAssistantResponse: z.string().nullable(),
  lastActivityAt: z.string(),
  compaction: z.any(),
});

// ============================================================================
// Type Exports
// ============================================================================

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type SessionPermissionMode = z.infer<typeof sessionPermissionModeSchema>;
export type ThinkLevel = z.infer<typeof thinkLevelSchema>;
export type MessageType = z.infer<typeof messageTypeSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunRecoveryMode = z.infer<typeof runRecoveryModeSchema>;
export type MemoryScope = z.infer<typeof memoryScopeSchema>;
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Run = z.infer<typeof runSchema>;
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type SessionMessage = z.infer<typeof sessionMessageSchema>;
export type SkillSource = z.infer<typeof skillSourceSchema>;
export type SkillDescriptor = z.infer<typeof skillDescriptorSchema>;
export type SkillMatch = z.infer<typeof skillMatchSchema>;
export type ResolvedSkill = z.infer<typeof resolvedSkillSchema>;
export type GitChangedFile = z.infer<typeof gitChangedFileSchema>;
export type GitRepoState = z.infer<typeof gitRepoStateSchema>;
export type GitDiffRow = z.infer<typeof gitDiffRowSchema>;
export type GitDiffPreview = z.infer<typeof gitDiffPreviewSchema>;
export type SessionRuntimeSnapshotV1 = z.infer<typeof sessionRuntimeSnapshotSchema>;
