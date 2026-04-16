import { z } from "zod";

import {
  approvalDecisionSchema,
  gitDiffPreviewSchema,
  gitRepoStateSchema,
  providerConfigSchema,
  providerProtocolSchema,
  runCheckpointSchema,
  runSchema,
  sessionHistoryEntrySchema,
  sessionSchema,
  sessionRuntimeSnapshotSchema,
  taskSchema,
  toolCallSchema,
} from "@omi/core";

export const rpcRequestSchema = z.object({
  id: z.string(),
  method: z.string(),
  params: z.record(z.unknown()).default({}),
});

export const rpcSuccessSchema = z.object({
  id: z.string(),
  ok: z.literal(true),
  result: z.unknown(),
});

export const rpcErrorSchema = z.object({
  id: z.string(),
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type RpcRequest = z.infer<typeof rpcRequestSchema>;
export type RpcSuccess = z.infer<typeof rpcSuccessSchema>;
export type RpcError = z.infer<typeof rpcErrorSchema>;

export const sessionCreateParamsSchema = z.object({
  title: z.string().min(1),
});

export const sessionTitleUpdateParamsSchema = z.object({
  sessionId: z.string(),
  title: z.string().min(1),
});

export const runStartParamsSchema = z.object({
  sessionId: z.string(),
  taskId: z.string().nullable().default(null),
  prompt: z.string().min(1),
  contextFiles: z.array(z.string()).optional(),
});

export const toolApprovalParamsSchema = z.object({
  toolCallId: z.string(),
  decision: approvalDecisionSchema,
});

export const gitDiffParamsSchema = z.object({
  path: z.string().min(1),
});

export const runEventsUnsubscribeParamsSchema = z.object({
  runId: z.string(),
  subscriptionId: z.string(),
});

export const sessionModelSwitchParamsSchema = z.object({
  sessionId: z.string(),
  providerConfigId: z.string(),
});

export const providerConfigSaveParamsSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  protocol: providerProtocolSchema,
  baseUrl: z.string().default(""),
  model: z.string().min(1),
  apiKey: z.string().min(1),
  url: z.string().default(""),
});

export const providerConfigDeleteParamsSchema = z.object({
  id: z.string(),
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
  checkpointDetails: z.record(z.unknown()).nullable().default(null),
});

export const sessionPermissionModeSchema = z.enum(["default", "full-access"]);

export const sessionPermissionSetResultSchema = z.object({
  sessionId: z.string(),
  mode: sessionPermissionModeSchema,
});

export const sessionWorkspaceSetParamsSchema = z.object({
  sessionId: z.string(),
  workspaceRoot: z.string().nullable().default(null),
});

export const sessionWorkspaceSetResultSchema = z.object({
  sessionId: z.string(),
  workspaceRoot: z.string(),
});

export const sessionRuntimeStateSchema = sessionRuntimeSnapshotSchema;

export const sessionRuntimeGetResultSchema = z.object({
  sessionId: z.string(),
  runtime: sessionRuntimeStateSchema,
});

export const sessionModelSwitchResultSchema = z.object({
  sessionId: z.string(),
  runtime: sessionRuntimeStateSchema,
});

export const sessionTitleUpdateResultSchema = z.object({
  session: sessionSchema,
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

export const modelListResultSchema = z.object({
  providerConfigs: z.array(providerConfigSchema),
  builtInProviders: z.array(
    z.object({
      provider: z.string(),
      models: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          provider: z.string(),
          api: z.string(),
          baseUrl: z.string(),
          reasoning: z.boolean(),
          input: z.array(z.string()),
          contextWindow: z.number(),
          maxTokens: z.number(),
        }),
      ),
    }),
  ),
});

export const runStateGetResultSchema = z.object({
  run: runSchema,
  checkpoints: z.array(runCheckpointSchema),
});

export const runEventsSubscribeResultSchema = z.object({
  runId: z.string(),
  subscriptionId: z.string(),
});

export const runEventsUnsubscribeResultSchema = z.object({
  runId: z.string(),
  subscriptionId: z.string(),
  removed: z.boolean(),
});

export const commandMap = {
  "session.create": sessionCreateParamsSchema,
  "session.list": z.object({}).default({}),
  "session.get": z.object({ sessionId: z.string() }),
  "session.title.update": sessionTitleUpdateParamsSchema,
  "session.runtime.get": z.object({ sessionId: z.string() }),
  "session.history.list": sessionHistoryListParamsSchema,
  "session.history.continue": sessionHistoryContinueParamsSchema,
  "session.workspace.set": sessionWorkspaceSetParamsSchema,
  "session.permission.set": z.object({
    sessionId: z.string(),
    mode: sessionPermissionModeSchema,
  }),
  "session.model.switch": sessionModelSwitchParamsSchema,

  "run.start": runStartParamsSchema,
  "run.cancel": z.object({ runId: z.string() }),
  "run.state.get": z.object({ runId: z.string() }),
  "run.events.subscribe": z.object({
    runId: z.string(),
    events: z.array(z.string()),
  }),
  "run.events.unsubscribe": runEventsUnsubscribeParamsSchema,

  "tool.approve": toolApprovalParamsSchema,
  "tool.reject": z.object({ toolCallId: z.string() }),
  "tool.pending.list": z.object({ sessionId: z.string() }),
  "tool.list": z.object({ sessionId: z.string() }),

  "provider.config.save": providerConfigSaveParamsSchema,
  "provider.config.delete": providerConfigDeleteParamsSchema,

  "model.list": z.object({}).default({}),
  "git.status": z.object({}).default({}),
  "git.diff": gitDiffParamsSchema,
} as const;

export const resultSchemas = {
  "session.title.update": sessionTitleUpdateResultSchema,
  "session.runtime.get": sessionRuntimeGetResultSchema,
  "session.history.list": sessionHistoryListResultSchema,
  "session.history.continue": runSchema,
  "session.workspace.set": sessionWorkspaceSetResultSchema,
  "session.permission.set": sessionPermissionSetResultSchema,
  "session.model.switch": sessionModelSwitchResultSchema,

  "tool.pending.list": toolPendingListResultSchema,
  "tool.list": toolListResultSchema,

  "provider.config.save": providerConfigSchema,
  "provider.config.delete": z.object({ deleted: z.boolean() }),

  "model.list": modelListResultSchema,
  "git.status": gitRepoStateSchema,
  "git.diff": gitDiffPreviewSchema,

  "run.state.get": runStateGetResultSchema,
  "run.events.subscribe": runEventsSubscribeResultSchema,
  "run.events.unsubscribe": runEventsUnsubscribeResultSchema,
} as const;

export type RunnerCommandName = keyof typeof commandMap;
export type RunnerResultName = keyof typeof resultSchemas;

export type RunnerCommandParamsByName = {
  [K in RunnerCommandName]: z.infer<(typeof commandMap)[K]>;
};

export type RunnerResultByName = {
  [K in RunnerResultName]: z.infer<(typeof resultSchemas)[K]>;
};

export type SessionHistoryListResult = z.infer<typeof sessionHistoryListResultSchema>;
export type SessionRuntimeGetResult = z.infer<typeof sessionRuntimeGetResultSchema>;
export type ToolPendingListResult = z.infer<typeof toolPendingListResultSchema>;
export type ToolListResult = z.infer<typeof toolListResultSchema>;
export type ModelListResult = z.infer<typeof modelListResultSchema>;
export type RunState = z.infer<typeof runStateGetResultSchema>;

export function parseCommand<TName extends RunnerCommandName>(
  method: TName,
  params: unknown,
): RunnerCommandParamsByName[TName] {
  const schema = commandMap[method];
  if (!schema) {
    throw new Error(`Unsupported command: ${method}`);
  }
  return schema.parse(params) as RunnerCommandParamsByName[TName];
}

export function parseResult<TName extends RunnerResultName>(
  method: TName,
  result: unknown,
): RunnerResultByName[TName] {
  const schema = resultSchemas[method];
  if (!schema) {
    throw new Error(`Unsupported result method: ${method}`);
  }
  return schema.parse(result) as RunnerResultByName[TName];
}

export const runnerCommandSchema = z.enum(Object.keys(commandMap) as [RunnerCommandName, ...RunnerCommandName[]]);

export const runnerEnvelopeSchema = z.object({
  command: z.string(),
  payload: z.record(z.unknown()).default({}),
});

export const sessionDetailSchema = z.object({
  session: sessionSchema,
  messages: z.array(
    z.object({
      id: z.string(),
      sessionId: z.string(),
      role: z.enum(["system", "user", "assistant", "tool"]),
      content: z.string(),
      createdAt: z.string(),
    }),
  ),
  tasks: z.array(taskSchema),
});

export type SessionDetail = z.infer<typeof sessionDetailSchema>;
