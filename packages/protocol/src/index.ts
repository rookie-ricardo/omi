import { z } from "zod";

import {
  approvalDecisionSchema,
  compactionSummaryDocumentSchema,
  providerConfigSchema,
  runSchema,
  sessionHistoryEntrySchema,
  toolCallSchema,
} from "@omi/core";

export const rpcRequestSchema = z.object({
  id: z.string(),
  method: z.string(),
  params: z.record(z.any()).default({}),
});

export const rpcSuccessSchema = z.object({
  id: z.string(),
  ok: z.literal(true),
  result: z.any(),
});

export const rpcErrorSchema = z.object({
  id: z.string(),
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const sessionCreateParamsSchema = z.object({
  title: z.string().min(1),
});

export const runStartParamsSchema = z.object({
  sessionId: z.string(),
  taskId: z.string().nullable().default(null),
  prompt: z.string().min(1),
});

export const taskUpdateParamsSchema = z.object({
  taskId: z.string(),
  action: z.enum(["start_now", "keep_in_inbox", "dismiss", "mark_reviewed"]),
});

export const toolApprovalParamsSchema = z.object({
  toolCallId: z.string(),
  decision: approvalDecisionSchema,
});

export const skillSearchParamsSchema = z.object({
  query: z.string().min(1),
});

export const gitDiffParamsSchema = z.object({
  path: z.string().min(1),
});

export const runRetryParamsSchema = z.object({
  runId: z.string(),
});

export const runResumeParamsSchema = z.object({
  runId: z.string(),
});

export const sessionModelSwitchParamsSchema = z.object({
  sessionId: z.string(),
  providerConfigId: z.string(),
});

export const providerConfigSaveParamsSchema = z.object({
  id: z.string().optional(),
  type: z.string().min(1),
  baseUrl: z.string().default(""),
  model: z.string().min(1),
  apiKey: z.string().min(1),
});

export const sessionCompactParamsSchema = z.object({
  sessionId: z.string(),
});

export const sessionHistoryListParamsSchema = z.object({
  sessionId: z.string(),
});

export const sessionHistoryContinueParamsSchema = z.object({
  sessionId: z.string(),
  historyEntryId: z.string().nullable().default(null),
  prompt: z.string().min(1),
  taskId: z.string().nullable().default(null),
  checkpointSummary: z.string().nullable().default(null),
  checkpointDetails: z.record(z.any()).nullable().default(null),
});

export const sessionRuntimeCompactionStateSchema = z.object({
  status: z.enum(["idle", "requested", "running", "completed", "failed"]),
  reason: z.string().nullable(),
  requestedAt: z.string().nullable(),
  updatedAt: z.string(),
  lastSummary: compactionSummaryDocumentSchema.nullable(),
  lastCompactedAt: z.string().nullable(),
  error: z.string().nullable(),
});

export const sessionRuntimeStateSchema = z.object({
  sessionId: z.string(),
  activeRunId: z.string().nullable(),
  pendingRunIds: z.array(z.string()),
  queuedRuns: z.array(
    z.object({
      runId: z.string(),
      prompt: z.string(),
      taskId: z.string().nullable(),
      providerConfigId: z.string().nullable(),
      sourceRunId: z.string().nullable(),
      mode: z.enum(["start", "retry", "resume"]),
      historyEntryId: z.string().nullable().default(null),
      checkpointSummary: z.string().nullable().default(null),
      checkpointDetails: z.record(z.any()).nullable().default(null),
    }),
  ),
  blockedRunId: z.string().nullable(),
  blockedToolCallId: z.string().nullable(),
  pendingApprovalToolCallIds: z.array(z.string()),
  interruptedRunIds: z.array(z.string()),
  selectedProviderConfigId: z.string().nullable(),
  lastUserPrompt: z.string().nullable(),
  lastAssistantResponse: z.string().nullable(),
  lastActivityAt: z.string(),
  compaction: sessionRuntimeCompactionStateSchema,
});

export const extensionCapabilitySchema = z.object({
  name: z.string(),
  hasSetup: z.boolean(),
  hasBeforeRun: z.boolean(),
  hasOnEvent: z.boolean(),
});

export const builtInModelSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  api: z.string(),
  baseUrl: z.string(),
  reasoning: z.boolean(),
  input: z.array(z.string()),
  contextWindow: z.number(),
  maxTokens: z.number(),
});

export const builtInProviderCatalogSchema = z.object({
  provider: z.string(),
  models: z.array(builtInModelSummarySchema),
});

export const sessionRuntimeGetResultSchema = z.object({
  sessionId: z.string(),
  runtime: sessionRuntimeStateSchema,
});

export const sessionModelSwitchResultSchema = z.object({
  sessionId: z.string(),
  runtime: sessionRuntimeStateSchema,
});

export const sessionCompactResultSchema = z.object({
  sessionId: z.string(),
  runtime: sessionRuntimeStateSchema,
  summary: compactionSummaryDocumentSchema,
  compactedAt: z.string(),
});

export const sessionHistoryListResultSchema = z.object({
  sessionId: z.string(),
  historyEntries: z.array(sessionHistoryEntrySchema),
});

export const toolPendingListResultSchema = z.object({
  sessionId: z.string(),
  runtime: sessionRuntimeStateSchema,
  pendingToolCalls: z.array(toolCallSchema),
});

export const toolListResultSchema = z.object({
  sessionId: z.string(),
  toolCalls: z.array(toolCallSchema),
});

export const extensionListResultSchema = z.object({
  workspaceRoot: z.string(),
  diagnostics: z.array(z.string()),
  extensions: z.array(extensionCapabilitySchema),
});

export const modelListResultSchema = z.object({
  providerConfigs: z.array(providerConfigSchema),
  builtInProviders: z.array(builtInProviderCatalogSchema),
});

export const providerConfigResultSchema = providerConfigSchema;

export const commandMap = {
  "session.create": sessionCreateParamsSchema,
  "session.list": z.object({}).default({}),
  "session.get": z.object({ sessionId: z.string() }),
  "session.runtime.get": z.object({ sessionId: z.string() }),
  "skill.list": z.object({}).default({}),
  "skill.search": skillSearchParamsSchema,
  "task.list": z.object({}).default({}),
  "task.update": taskUpdateParamsSchema,
  "git.status": z.object({}).default({}),
  "git.diff": gitDiffParamsSchema,
  "run.start": runStartParamsSchema,
  "run.retry": runRetryParamsSchema,
  "run.resume": runResumeParamsSchema,
  "run.cancel": z.object({ runId: z.string() }),
  "tool.approve": toolApprovalParamsSchema,
  "tool.reject": z.object({ toolCallId: z.string() }),
  "tool.pending.list": z.object({ sessionId: z.string() }),
  "tool.list": z.object({ sessionId: z.string() }),
  "session.history.list": sessionHistoryListParamsSchema,
  "session.history.continue": sessionHistoryContinueParamsSchema,
  "session.model.switch": sessionModelSwitchParamsSchema,
  "provider.config.save": providerConfigSaveParamsSchema,
  "session.compact": sessionCompactParamsSchema,
  "extension.list": z.object({}).default({}),
  "model.list": z.object({}).default({}),
} as const;

export const resultSchemas = {
  "session.runtime.get": sessionRuntimeGetResultSchema,
  "session.model.switch": sessionModelSwitchResultSchema,
  "provider.config.save": providerConfigResultSchema,
  "session.compact": sessionCompactResultSchema,
  "session.history.list": sessionHistoryListResultSchema,
  "session.history.continue": runSchema,
  "tool.pending.list": toolPendingListResultSchema,
  "tool.list": toolListResultSchema,
  "extension.list": extensionListResultSchema,
  "model.list": modelListResultSchema,
} as const;

export const eventSchemas = {
  "run.extensions_loaded": z.object({
    runId: z.string(),
    sessionId: z.string(),
    extensions: z.array(z.string()),
    diagnostics: z.array(z.string()),
  }),
  "run.started": z.object({
    runId: z.string(),
    sessionId: z.string(),
    taskId: z.string().nullable(),
  }),
  "run.skills_resolved": z.object({
    runId: z.string(),
    sessionId: z.string(),
    selectedSkillId: z.string().nullable(),
    matches: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        score: z.number(),
      }),
    ),
  }),
  "run.skills_loaded": z.object({
    runId: z.string(),
    sessionId: z.string(),
    skills: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        tools: z.array(z.string()),
        references: z.array(z.string()),
        diagnostics: z.array(z.string()).default([]),
      }),
    ),
  }),
  "run.delta": z.object({ runId: z.string(), sessionId: z.string(), delta: z.string() }),
  "run.tool_requested": z.object({
    runId: z.string(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    requiresApproval: z.boolean(),
    input: z.record(z.any()),
  }),
  "run.tool_started": z.object({ runId: z.string(), toolCallId: z.string(), toolName: z.string() }),
  "run.tool_decided": z.object({
    runId: z.string(),
    sessionId: z.string(),
    toolCallId: z.string(),
    decision: z.enum(["approved", "rejected"]),
  }),
  "run.tool_finished": z.object({
    runId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    output: z.record(z.any()),
  }),
  "run.blocked": z.object({ runId: z.string(), toolCallId: z.string(), reason: z.string() }),
  "run.review_required": z.object({
    runId: z.string(),
    taskId: z.string().nullable(),
    reviewId: z.string(),
  }),
  "run.canceled": z.object({ runId: z.string(), sessionId: z.string() }),
  "run.completed": z.object({ runId: z.string(), sessionId: z.string(), summary: z.string() }),
  "run.failed": z.object({ runId: z.string(), sessionId: z.string(), error: z.string() }),
} as const;

export type RpcRequest = z.infer<typeof rpcRequestSchema>;
export type RpcSuccess = z.infer<typeof rpcSuccessSchema>;
export type RpcError = z.infer<typeof rpcErrorSchema>;
export type SessionCreateParams = z.infer<typeof sessionCreateParamsSchema>;
export type RunStartParams = z.infer<typeof runStartParamsSchema>;
export type TaskUpdateParams = z.infer<typeof taskUpdateParamsSchema>;
export type ToolApprovalParams = z.infer<typeof toolApprovalParamsSchema>;
export type SkillSearchParams = z.infer<typeof skillSearchParamsSchema>;
export type GitDiffParams = z.infer<typeof gitDiffParamsSchema>;
export type RunRetryParams = z.infer<typeof runRetryParamsSchema>;
export type RunResumeParams = z.infer<typeof runResumeParamsSchema>;
export type SessionModelSwitchParams = z.infer<typeof sessionModelSwitchParamsSchema>;
export type ProviderConfigSaveParams = z.infer<typeof providerConfigSaveParamsSchema>;
export type SessionHistoryListParams = z.infer<typeof sessionHistoryListParamsSchema>;
export type SessionHistoryContinueParams = z.infer<typeof sessionHistoryContinueParamsSchema>;
export type SessionRuntimeGetResult = z.infer<typeof sessionRuntimeGetResultSchema>;
export type SessionModelSwitchResult = z.infer<typeof sessionModelSwitchResultSchema>;
export type ProviderConfigResult = z.infer<typeof providerConfigResultSchema>;
export type ToolPendingListResult = z.infer<typeof toolPendingListResultSchema>;
export type ToolListResult = z.infer<typeof toolListResultSchema>;
export type ExtensionListResult = z.infer<typeof extensionListResultSchema>;
export type ModelListResult = z.infer<typeof modelListResultSchema>;
export type SessionHistoryListResult = z.infer<typeof sessionHistoryListResultSchema>;

export type RunnerCommandName = keyof typeof commandMap;
export type RunnerEventName = keyof typeof eventSchemas;
export type RunnerResultName = keyof typeof resultSchemas;

export function parseCommand(method: string, params: unknown): unknown {
  const schema = commandMap[method as RunnerCommandName];
  if (!schema) {
    throw new Error(`Unsupported command: ${method}`);
  }

  return schema.parse(params);
}

export function parseEvent<TName extends RunnerEventName>(
  name: TName,
  payload: unknown,
): z.infer<(typeof eventSchemas)[TName]> {
  return eventSchemas[name].parse(payload);
}

export function parseResult<TName extends RunnerResultName>(
  name: TName,
  payload: unknown,
): z.infer<(typeof resultSchemas)[TName]> {
  return resultSchemas[name].parse(payload);
}
