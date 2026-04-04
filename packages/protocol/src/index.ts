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

export const webSearchParamsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(20).optional(),
});

export const webFetchParamsSchema = z.object({
  url: z.string().url(),
  maxChars: z.number().int().positive().optional(),
});

export const mcpResourceListParamsSchema = z.object({
  serverId: z.string().optional(),
  pattern: z.string().optional(),
});

export const mcpResourceReadParamsSchema = z.object({
  uri: z.string().min(1),
  maxLength: z.number().int().positive().optional(),
});

export const planApproveParamsSchema = z.object({
  sessionId: z.string(),
  stepIds: z.array(z.string()).optional(),
  reason: z.string().optional(),
});

export const planRejectParamsSchema = z.object({
  sessionId: z.string(),
  stepIds: z.array(z.string()).optional(),
  reason: z.string().optional(),
});

export const planStepsListParamsSchema = z.object({
  sessionId: z.string(),
  filter: z.enum(["all", "pending", "approved", "rejected"]).optional(),
});

export const agentListParamsSchema = z.object({
  ownerId: z.string().optional(),
  status: z.string().optional(),
});

export const agentGetParamsSchema = z.object({
  taskId: z.string(),
});

export const agentDelegateParamsSchema = z.object({
  ownerId: z.string(),
  prompt: z.string(),
  waitForCompletion: z.boolean().default(false),
  timeout: z.number().optional(),
  writeScope: z.enum(["shared", "isolated"]).default("shared"),
  deadline: z.number().optional(),
  tags: z.array(z.string()).optional(),
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
  checkpointDetails: z.record(z.unknown()).nullable().default(null),
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
      checkpointDetails: z.record(z.unknown()).nullable().default(null),
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
  "session.branch.create": z.object({
    sessionId: z.string(),
    branchName: z.string(),
    fromEntryId: z.string().optional(),
  }),
  "session.branch.list": z.object({ sessionId: z.string() }),
  "session.branch.switch": z.object({
    sessionId: z.string(),
    branchId: z.string(),
  }),
  "session.mode.enter": z.object({
    sessionId: z.string(),
    mode: z.enum(["plan", "auto"]),
    config: z.record(z.unknown()).optional(),
  }),
  "session.mode.exit": z.object({
    sessionId: z.string(),
    discard: z.boolean().default(false),
  }),
  "plan.approve": planApproveParamsSchema,
  "plan.reject": planRejectParamsSchema,
  "plan.steps.list": planStepsListParamsSchema,
  "skill.list": z.object({}).default({}),
  "skill.search": skillSearchParamsSchema,
  "skill.refresh": z.object({}).default({}),
  "task.list": z.object({}).default({}),
  "task.update": taskUpdateParamsSchema,
  "web.search": webSearchParamsSchema,
  "web.fetch": webFetchParamsSchema,
  "git.status": z.object({}).default({}),
  "git.diff": gitDiffParamsSchema,
  "run.start": runStartParamsSchema,
  "run.retry": runRetryParamsSchema,
  "run.resume": runResumeParamsSchema,
  "run.cancel": z.object({ runId: z.string() }),
  "run.state.get": z.object({ runId: z.string() }),
  "run.events.subscribe": z.object({
    runId: z.string(),
    events: z.array(z.string()),
  }),
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
  "permission.rule.list": z.object({
    sessionId: z.string(),
  }),
  "permission.rule.add": z.object({
    sessionId: z.string(),
    rule: z.object({
      id: z.string().optional(),
      name: z.string(),
      toolPattern: z.string(),
      action: z.enum(["allow", "deny", "require_approval"]),
      conditions: z.record(z.unknown()).optional(),
      priority: z.number().optional(),
    }),
  }),
  "permission.rule.delete": z.object({
    sessionId: z.string(),
    ruleId: z.string(),
  }),
  "mcp.server.list": z.object({}).default({}),
  "mcp.server.connect": z.object({
    serverId: z.string(),
  }),
  "mcp.server.disconnect": z.object({
    serverId: z.string(),
  }),
  "mcp.resource.list": mcpResourceListParamsSchema,
  "mcp.resource.read": mcpResourceReadParamsSchema,
  "agent.spawn": z.object({
    ownerId: z.string(),
    prompt: z.string(),
    writeScope: z.enum(["shared", "isolated"]).default("shared"),
    background: z.boolean().default(false),
    deadline: z.number().optional(),
    tags: z.array(z.string()).optional(),
  }),
  "agent.send": z.object({
    taskId: z.string(),
    message: z.string(),
  }),
  "agent.wait": z.object({
    taskId: z.string(),
    timeout: z.number().optional(),
  }),
  "agent.close": z.object({
    taskId: z.string(),
  }),
  "agent.list": agentListParamsSchema,
  "agent.get": agentGetParamsSchema,
  "agent.delegate": agentDelegateParamsSchema,
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
  get "session.branch.create"() {
    return sessionBranchCreateResultSchema;
  },
  get "session.branch.list"() {
    return sessionBranchListResultSchema;
  },
  get "session.branch.switch"() {
    return sessionBranchSwitchResultSchema;
  },
  get "session.mode.enter"() {
    return sessionModeEnterResultSchema;
  },
  get "session.mode.exit"() {
    return sessionModeExitResultSchema;
  },
  get "plan.approve"() {
    return planApproveResultSchema;
  },
  get "plan.reject"() {
    return planRejectResultSchema;
  },
  get "plan.steps.list"() {
    return planStepsListResultSchema;
  },
  get "permission.rule.list"() {
    return permissionRuleListResultSchema;
  },
  get "permission.rule.add"() {
    return permissionRuleAddResultSchema;
  },
  get "permission.rule.delete"() {
    return permissionRuleDeleteResultSchema;
  },
  get "mcp.server.list"() {
    return mcpServerListResultSchema;
  },
  get "mcp.server.connect"() {
    return mcpServerConnectResultSchema;
  },
  get "mcp.server.disconnect"() {
    return mcpServerDisconnectResultSchema;
  },
  get "mcp.resource.list"() {
    return mcpResourceListResultSchema;
  },
  get "mcp.resource.read"() {
    return mcpResourceReadResultSchema;
  },
  get "agent.spawn"() {
    return agentSpawnResultSchema;
  },
  get "agent.send"() {
    return agentSendResultSchema;
  },
  get "agent.wait"() {
    return agentWaitResultSchema;
  },
  get "agent.close"() {
    return agentCloseResultSchema;
  },
  get "agent.list"() {
    return agentListResultSchema;
  },
  get "agent.get"() {
    return agentGetResultSchema;
  },
  get "agent.delegate"() {
    return agentDelegateResultSchema;
  },
  get "web.search"() {
    return webSearchResultSchema;
  },
  get "web.fetch"() {
    return webFetchResultSchema;
  },
  get "run.state.get"() {
    return runStateGetResultSchema;
  },
  get "run.events.subscribe"() {
    return runEventsSubscribeResultSchema;
  },
  get "skill.refresh"() {
    return skillRefreshResultSchema;
  },
} as const;

// Branch schemas
export const sessionBranchSchema = z.object({
  id: z.string(),
  name: z.string(),
  sessionId: z.string(),
  parentEntryId: z.string().nullable(),
  createdAt: z.string(),
  isActive: z.boolean(),
});

export const sessionBranchListResultSchema = z.object({
  sessionId: z.string(),
  branches: z.array(sessionBranchSchema),
});

export const sessionBranchCreateResultSchema = z.object({
  sessionId: z.string(),
  branch: sessionBranchSchema,
});

export const sessionBranchSwitchResultSchema = z.object({
  sessionId: z.string(),
  branch: sessionBranchSchema,
  previousBranchId: z.string().nullable(),
});

// Mode schemas
export const sessionModeStateSchema = z.object({
  sessionId: z.string(),
  mode: z.enum(["plan", "auto", "none"]),
  status: z.enum(["inactive", "planning", "reviewing", "approved", "rejected"]).optional(),
  enteredAt: z.string().nullable(),
  summary: z.string().nullable(),
});

export const sessionModeEnterResultSchema = z.object({
  sessionId: z.string(),
  mode: sessionModeStateSchema,
});

export const sessionModeExitResultSchema = z.object({
  sessionId: z.string(),
  previousMode: sessionModeStateSchema,
  discarded: z.boolean(),
});

// Permission rules schemas
export const permissionRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  toolPattern: z.string(),
  action: z.enum(["allow", "deny", "require_approval"]),
  conditions: z.record(z.unknown()).optional(),
  priority: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const permissionRuleListResultSchema = z.object({
  sessionId: z.string(),
  rules: z.array(permissionRuleSchema),
});

export const permissionRuleAddResultSchema = z.object({
  sessionId: z.string(),
  rule: permissionRuleSchema,
});

export const permissionRuleDeleteResultSchema = z.object({
  sessionId: z.string(),
  ruleId: z.string(),
  deleted: z.boolean(),
});

// MCP server schemas
export const mcpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
  status: z.enum(["disconnected", "connecting", "connected", "error"]),
  error: z.string().nullable(),
  tools: z.array(z.string()).default([]),
  resources: z.array(z.object({
    uri: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
  })).default([]),
});

export const mcpServerListResultSchema = z.object({
  servers: z.array(mcpServerSchema),
});

export const mcpServerConnectResultSchema = z.object({
  server: mcpServerSchema,
});

export const mcpServerDisconnectResultSchema = z.object({
  serverId: z.string(),
  disconnected: z.boolean(),
});

// Agent subagent schemas
export const subagentTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  status: z.enum(["pending", "spawning", "running", "waiting", "completed", "failed", "canceled", "timeout"]),
  writeScope: z.enum(["shared", "isolated", "worktree"]),
  progress: z.number(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
});

export const agentSpawnResultSchema = z.object({
  task: subagentTaskSchema,
});

export const agentWaitResultSchema = z.object({
  task: subagentTaskSchema,
  timedOut: z.boolean().default(false),
});

// Run state schemas
export const runStateSchema = z.object({
  runId: z.string(),
  sessionId: z.string(),
  status: z.enum(["pending", "running", "waiting_approval", "blocked", "completed", "failed", "canceled"]),
  startedAt: z.string(),
  currentToolCallId: z.string().nullable(),
  pendingApprovalToolCallIds: z.array(z.string()),
  error: z.string().nullable(),
  checkpoints: z.array(z.object({
    id: z.string(),
    createdAt: z.string(),
    summary: z.string(),
  })).default([]),
});

export const runStateGetResultSchema = z.object({
  run: runStateSchema,
});

export const runEventsSubscribeResultSchema = z.object({
  runId: z.string(),
  subscriptionId: z.string(),
  events: z.array(z.string()),
});

export const agentSendResultSchema = z.object({
  subAgentId: z.string(),
  sent: z.boolean(),
});

export const agentCloseResultSchema = z.object({
  subAgentId: z.string(),
  closed: z.boolean(),
});

export const agentListResultSchema = z.object({
  tasks: z.array(subagentTaskSchema),
});

export const agentGetResultSchema = z.object({
  task: subagentTaskSchema.nullable(),
});

export const agentDelegateResultSchema = z.object({
  task: subagentTaskSchema,
  timedOut: z.boolean().default(false),
});

export const mcpResourceSchema = z.object({
  uri: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});

export const mcpResourceContentSchema = z.object({
  uri: z.string(),
  mimeType: z.string().optional(),
  text: z.string().optional(),
  blob: z.string().optional(),
});

export const mcpResourceListResultSchema = z.object({
  serverId: z.string().nullable().default(null),
  resources: z.array(mcpResourceSchema),
});

export const mcpResourceReadResultSchema = z.object({
  serverId: z.string(),
  uri: z.string(),
  content: mcpResourceContentSchema,
});

export const webSearchResultSchema = z.object({
  query: z.string(),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string().optional(),
    }),
  ),
});

export const webFetchResultSchema = z.object({
  url: z.string(),
  status: z.number().optional(),
  contentType: z.string().optional(),
  title: z.string().optional(),
  body: z.string(),
});

export const planStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: z.enum(["pending", "approved", "rejected", "completed"]),
  tool: z.string().optional(),
  reason: z.string().optional(),
});

export const planApproveResultSchema = z.object({
  sessionId: z.string(),
  status: z.enum(["planning", "reviewing", "approved", "rejected"]),
  steps: z.array(planStepSchema).default([]),
});

export const planRejectResultSchema = z.object({
  sessionId: z.string(),
  status: z.enum(["planning", "reviewing", "approved", "rejected"]),
  steps: z.array(planStepSchema).default([]),
});

export const planStepsListResultSchema = z.object({
  sessionId: z.string(),
  status: z.enum(["planning", "reviewing", "approved", "rejected", "inactive"]),
  steps: z.array(planStepSchema).default([]),
  totalSteps: z.number().int().nonnegative().default(0),
});

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
    input: z.record(z.unknown()),
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
    output: z.record(z.unknown()),
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
  "run.state_changed": z.object({
    runId: z.string(),
    sessionId: z.string(),
    previousStatus: z.string(),
    currentStatus: z.string(),
  }),
  "subagent.spawned": z.object({
    taskId: z.string(),
    ownerId: z.string(),
  }),
  "subagent.started": z.object({
    taskId: z.string(),
  }),
  "subagent.completed": z.object({
    taskId: z.string(),
    output: z.unknown(),
  }),
  "subagent.failed": z.object({
    taskId: z.string(),
    error: z.string(),
  }),
  "plan.mode_entered": z.object({
    sessionId: z.string(),
    mode: z.enum(["plan", "auto"]),
  }),
  "plan.mode_exited": z.object({
    sessionId: z.string(),
    status: z.enum(["approved", "rejected"]),
    discarded: z.boolean(),
  }),
  "plan.step_added": z.object({
    sessionId: z.string(),
    stepId: z.string(),
    description: z.string(),
  }),
  "mcp.server.connected": z.object({
    serverId: z.string(),
  }),
  "mcp.server.disconnected": z.object({
    serverId: z.string(),
  }),
  "mcp.server.error": z.object({
    serverId: z.string(),
    error: z.string(),
  }),
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
export type WebSearchParams = z.infer<typeof webSearchParamsSchema>;
export type WebFetchParams = z.infer<typeof webFetchParamsSchema>;
export type McpResourceListParams = z.infer<typeof mcpResourceListParamsSchema>;
export type McpResourceReadParams = z.infer<typeof mcpResourceReadParamsSchema>;
export type PlanApproveParams = z.infer<typeof planApproveParamsSchema>;
export type PlanRejectParams = z.infer<typeof planRejectParamsSchema>;
export type PlanStepsListParams = z.infer<typeof planStepsListParamsSchema>;
export type AgentListParams = z.infer<typeof agentListParamsSchema>;
export type AgentGetParams = z.infer<typeof agentGetParamsSchema>;
export type AgentDelegateParams = z.infer<typeof agentDelegateParamsSchema>;
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

// Branch types
export type SessionBranch = z.infer<typeof sessionBranchSchema>;
export type SessionBranchListResult = z.infer<typeof sessionBranchListResultSchema>;
export type SessionBranchCreateResult = z.infer<typeof sessionBranchCreateResultSchema>;
export type SessionBranchSwitchResult = z.infer<typeof sessionBranchSwitchResultSchema>;

// Mode types
export type SessionModeState = z.infer<typeof sessionModeStateSchema>;
export type SessionModeEnterResult = z.infer<typeof sessionModeEnterResultSchema>;
export type SessionModeExitResult = z.infer<typeof sessionModeExitResultSchema>;

// Permission rule types
export type PermissionRule = z.infer<typeof permissionRuleSchema>;
export type PermissionRuleListResult = z.infer<typeof permissionRuleListResultSchema>;
export type PermissionRuleAddResult = z.infer<typeof permissionRuleAddResultSchema>;
export type PermissionRuleDeleteResult = z.infer<typeof permissionRuleDeleteResultSchema>;

// MCP server types
export type McpServer = z.infer<typeof mcpServerSchema>;
export type McpServerListResult = z.infer<typeof mcpServerListResultSchema>;
export type McpServerConnectResult = z.infer<typeof mcpServerConnectResultSchema>;
export type McpServerDisconnectResult = z.infer<typeof mcpServerDisconnectResultSchema>;
export type McpResource = z.infer<typeof mcpResourceSchema>;
export type McpResourceContent = z.infer<typeof mcpResourceContentSchema>;
export type McpResourceListResult = z.infer<typeof mcpResourceListResultSchema>;
export type McpResourceReadResult = z.infer<typeof mcpResourceReadResultSchema>;

// Subagent types
export type SubagentTask = z.infer<typeof subagentTaskSchema>;
export type AgentSpawnResult = z.infer<typeof agentSpawnResultSchema>;
export type AgentSendResult = z.infer<typeof agentSendResultSchema>;
export type AgentWaitResult = z.infer<typeof agentWaitResultSchema>;
export type AgentCloseResult = z.infer<typeof agentCloseResultSchema>;
export type AgentListResult = z.infer<typeof agentListResultSchema>;
export type AgentGetResult = z.infer<typeof agentGetResultSchema>;
export type AgentDelegateResult = z.infer<typeof agentDelegateResultSchema>;

// Web and plan-control types
export type WebSearchResult = z.infer<typeof webSearchResultSchema>;
export type WebFetchResult = z.infer<typeof webFetchResultSchema>;
export type PlanStep = z.infer<typeof planStepSchema>;
export type PlanApproveResult = z.infer<typeof planApproveResultSchema>;
export type PlanRejectResult = z.infer<typeof planRejectResultSchema>;
export type PlanStepsListResult = z.infer<typeof planStepsListResultSchema>;

// Run state types
export type RunState = z.infer<typeof runStateSchema>;
export type RunStateGetResult = z.infer<typeof runStateGetResultSchema>;
export type RunEventsSubscribeResult = z.infer<typeof runEventsSubscribeResultSchema>;

export const skillRefreshResultSchema = z.object({
  refreshedAt: z.string(),
  skills: z.array(z.unknown()),
});
export type SkillRefreshResult = z.infer<typeof skillRefreshResultSchema>;

export type RunnerCommandName = keyof typeof commandMap;
export type RunnerEventName = keyof typeof eventSchemas;
export type RunnerResultName = keyof typeof resultSchemas;
export const RUNNER_PROTOCOL_VERSION = "1.0.0";

export const runEventDeliverySchema = z.object({
  runId: z.string(),
  subscriptionId: z.string(),
  event: z.string(),
  payload: z.record(z.unknown()),
  deliveredAt: z.string(),
});
export type RunEventDelivery = z.infer<typeof runEventDeliverySchema>;

export const RUN_EVENT_SUBSCRIPTION_CONVENTION = {
  version: RUNNER_PROTOCOL_VERSION,
  channel: "run.event",
  wildcardEventPattern: ["*", "namespace.*"],
  delivery: "at-least-once",
  schema: runEventDeliverySchema,
} as const;

const CORE_COMMAND_PREFIXES = ["session.", "task.", "run.", "tool.", "git.", "web."] as const;
const CONTROL_COMMAND_PREFIXES = [
  "session.mode.",
  "plan.",
  "permission.rule.",
  "mcp.",
  "agent.",
  "skill.",
  "provider.config.",
  "session.model.",
  "extension.",
  "model.",
] as const;

function hasPrefix(name: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => name.startsWith(prefix));
}

function buildSchemaSubset(
  source: Record<string, z.ZodTypeAny>,
  prefixes: readonly string[],
): Record<string, z.ZodTypeAny> {
  return Object.fromEntries(
    Object.entries(source).filter(([name]) => hasPrefix(name, prefixes)),
  );
}

export const coreCommandSchemas = buildSchemaSubset(
  commandMap as unknown as Record<string, z.ZodTypeAny>,
  CORE_COMMAND_PREFIXES,
);

export const controlCommandSchemas = buildSchemaSubset(
  commandMap as unknown as Record<string, z.ZodTypeAny>,
  CONTROL_COMMAND_PREFIXES,
);

export const coreResultSchemas = buildSchemaSubset(
  resultSchemas as unknown as Record<string, z.ZodTypeAny>,
  CORE_COMMAND_PREFIXES,
);

export const controlResultSchemas = buildSchemaSubset(
  resultSchemas as unknown as Record<string, z.ZodTypeAny>,
  CONTROL_COMMAND_PREFIXES,
);

export type RunnerCommandParamsByName = {
  [K in RunnerCommandName]: z.infer<(typeof commandMap)[K]>;
};

export type RunnerResultByName = {
  [K in RunnerResultName]: z.infer<(typeof resultSchemas)[K]>;
};

export type RunnerEventByName = {
  [K in RunnerEventName]: z.infer<(typeof eventSchemas)[K]>;
};

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
