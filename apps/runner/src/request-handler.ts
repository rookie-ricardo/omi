import type { AppOrchestrator, SessionManager, SubAgentState } from "@omi/agent";
import { getLogger, SubAgentManager } from "@omi/agent";
import type {
  AgentCloseResult,
  AgentSendResult,
  AgentSpawnResult,
  AgentWaitResult,
  McpServer,
  PermissionRule,
  RunState,
  RpcRequest,
  RunnerCommandName,
  SessionBranch,
  SessionModeState,
} from "@omi/protocol";
import type { RunCheckpoint, SessionBranch as CoreSessionBranch } from "@omi/core";
import { createId, nowIso } from "@omi/core";

import { parseCommand } from "@omi/protocol";

const logger = getLogger("runner:request-handler");

type SubAgentTaskSnapshot = {
  id: string;
  name: string;
  ownerId: string;
  status: SubAgentState["status"] | "timeout";
  writeScope: SubAgentState["writeScope"];
  progress?: number;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  output?: unknown | null;
  error?: string | null;
  result?: string | null;
};

type RunnerRequestOrchestrator = Pick<
  AppOrchestrator,
  | "createSession"
  | "updateSessionTitle"
  | "listSessions"
  | "getSessionDetail"
  | "getSessionRuntimeState"
  | "listSessionHistory"
  | "listSkills"
  | "searchSkills"
  | "listTasks"
  | "updateTask"
  | "getGitStatus"
  | "getGitDiff"
  | "startRun"
  | "continueFromHistoryEntry"
  | "retryRun"
  | "resumeRun"
  | "compactSession"
  | "cancelRun"
  | "approveTool"
  | "rejectTool"
  | "listPendingToolCalls"
  | "listToolCalls"
  | "setSessionWorkspaceRoot"
  | "setSessionPermissionMode"
  | "switchModel"
  | "saveProviderConfig"
  | "deleteProviderConfig"
  | "listExtensions"
  | "listModels"
>;

type RunnerPrivateHost = {
  database: {
    getRun(runId: string): { id: string; sessionId: string; status: string; createdAt: string; terminalReason?: string | null } | null;
    listCheckpoints(runId: string): RunCheckpoint[];
  };
  sessionManager: Pick<SessionManager, "createBranch" | "listBranches" | "switchBranch" | "getActiveBranchId">;
  workspaceRoot: string;
};

const sessionModeStates = new Map<string, SessionModeState>();
const permissionRuleState = new Map<string, PermissionRule[]>();
const mcpServers = new Map<string, McpServer>();
const subAgentManagers = new WeakMap<object, SubAgentManager>();
type RunEventSubscription = {
  subscriptionId: string;
  events: string[];
  createdAt: string;
};

export interface RunEventDelivery {
  runId: string;
  subscriptionId: string;
  event: string;
  payload: Record<string, unknown>;
  deliveredAt: string;
}

const runEventSubscriptions = new Map<string, RunEventSubscription[]>();

export async function handleRunnerRequest(
  orchestrator: RunnerRequestOrchestrator,
  request: RpcRequest,
): Promise<unknown> {
  const startTime = Date.now();
  const { method, id } = request;

  logger.debug("Runner request received", { method, requestId: id });

  try {
    const params = parseCommand(request.method, request.params) as Record<string, unknown>;

    const result = await executeCommand(orchestrator, method as RunnerCommandName, params);

    const durationMs = Date.now() - startTime;
    logger.debug("Runner request completed", { method, requestId: id, durationMs });

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.errorWithError("Runner request failed", error, { method, requestId: id, durationMs });
    throw error;
  }
}

async function executeCommand(
  orchestrator: RunnerRequestOrchestrator,
  method: RunnerCommandName,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case "session.create":
      return orchestrator.createSession(String(params.title));
    case "session.list":
      return orchestrator.listSessions();
    case "session.get":
      return orchestrator.getSessionDetail(String(params.sessionId));
    case "session.title.update":
      return orchestrator.updateSessionTitle(
        String(params.sessionId),
        String(params.title),
      );
    case "session.runtime.get": {
      const sessionId = String(params.sessionId);
      return {
        sessionId,
        runtime: orchestrator.getSessionRuntimeState(sessionId),
      };
    }
    case "session.branch.create": {
      const host = getRunnerHost(orchestrator);
      const sessionId = String(params.sessionId);
      const branch = host.sessionManager.createBranch(
        sessionId,
        String(params.branchName),
        params.fromEntryId ? String(params.fromEntryId) : null,
      );
      return {
        sessionId,
        branch: toProtocolBranch(branch, host.sessionManager.getActiveBranchId(sessionId)),
      };
    }
    case "session.branch.list": {
      const host = getRunnerHost(orchestrator);
      const sessionId = String(params.sessionId);
      const activeBranchId = host.sessionManager.getActiveBranchId(sessionId);
      return {
        sessionId,
        branches: host.sessionManager.listBranches(sessionId).map((branch) =>
          toProtocolBranch(branch, activeBranchId),
        ),
      };
    }
    case "session.branch.switch": {
      const host = getRunnerHost(orchestrator);
      const sessionId = String(params.sessionId);
      const previousBranchId = host.sessionManager.getActiveBranchId(sessionId);
      const branch = host.sessionManager.switchBranch(sessionId, String(params.branchId));
      return {
        sessionId,
        branch: toProtocolBranch(branch, host.sessionManager.getActiveBranchId(sessionId)),
        previousBranchId,
      };
    }
    case "session.mode.enter": {
      return enterSessionMode(
        String(params.sessionId),
        String(params.mode) as "plan" | "auto",
        (params.config ?? null) as Record<string, unknown> | null,
      );
    }
    case "session.mode.exit":
      return exitSessionMode(String(params.sessionId), Boolean(params.discard));
    case "session.history.list":
      return orchestrator.listSessionHistory(String(params.sessionId));
    case "session.history.continue":
      return orchestrator.continueFromHistoryEntry({
        sessionId: String(params.sessionId),
        historyEntryId: params.historyEntryId ? String(params.historyEntryId) : null,
        taskId: params.taskId ? String(params.taskId) : null,
        prompt: String(params.prompt),
        checkpointSummary: params.checkpointSummary ? String(params.checkpointSummary) : null,
        checkpointDetails: params.checkpointDetails ?? null,
      });
    case "session.workspace.set":
      return orchestrator.setSessionWorkspaceRoot(
        String(params.sessionId),
        typeof params.workspaceRoot === "string" ? params.workspaceRoot : null,
      );
    case "session.permission.set":
      return orchestrator.setSessionPermissionMode(
        String(params.sessionId),
        String(params.mode) as "default" | "full-access",
      );
    case "skill.list":
      return orchestrator.listSkills();
    case "skill.search":
      return orchestrator.searchSkills(String(params.query));
    case "skill.refresh": {
      const skills = await orchestrator.listSkills();
      return {
        refreshedAt: nowIso(),
        skills,
      };
    }
    case "task.list":
      return orchestrator.listTasks();
    case "task.update":
      return orchestrator.updateTask(
        String(params.taskId),
        params.action as Parameters<AppOrchestrator["updateTask"]>[1],
      );
    case "git.status":
      return orchestrator.getGitStatus();
    case "git.diff":
      return orchestrator.getGitDiff(String(params.path));
    case "run.start":
      return orchestrator.startRun({
        sessionId: String(params.sessionId),
        taskId: params.taskId ? String(params.taskId) : null,
        prompt: String(params.prompt),
        contextFiles: Array.isArray(params.contextFiles)
          ? params.contextFiles.map((entry) => String(entry))
          : undefined,
      });
    case "run.retry":
      return orchestrator.retryRun(String(params.runId));
    case "run.resume":
      return orchestrator.resumeRun(String(params.runId));
    case "run.cancel":
      return orchestrator.cancelRun(String(params.runId));
    case "run.state.get":
      return getRunState(orchestrator, String(params.runId));
    case "run.events.subscribe":
      return subscribeRunEvents(
        String(params.runId),
        Array.isArray(params.events) ? params.events.map((eventName) => String(eventName)) : [],
      );
    case "run.events.unsubscribe":
      return unsubscribeRunEvents(
        String(params.runId),
        String(params.subscriptionId),
      );
    case "session.compact":
      return orchestrator.compactSession(String(params.sessionId));
    case "tool.approve":
      return orchestrator.approveTool(String(params.toolCallId));
    case "tool.reject":
      return orchestrator.rejectTool(String(params.toolCallId));
    case "tool.pending.list":
      return orchestrator.listPendingToolCalls(String(params.sessionId));
    case "tool.list":
      return orchestrator.listToolCalls(String(params.sessionId));
    case "session.model.switch":
      return orchestrator.switchModel(String(params.sessionId), String(params.providerConfigId));
    case "provider.config.save":
      return orchestrator.saveProviderConfig({
        id: params.id ? String(params.id) : undefined,
        name: String(params.name),
        protocol: String(params.protocol) as "anthropic-messages" | "openai-chat" | "openai-responses",
        baseUrl: String(params.baseUrl ?? ""),
        model: String(params.model),
        apiKey: String(params.apiKey),
        url: String(params.url ?? ""),
      });
    case "provider.config.delete":
      return orchestrator.deleteProviderConfig(String(params.id));
    case "permission.rule.list":
      return listPermissionRules(String(params.sessionId));
    case "permission.rule.add":
      return addPermissionRule(String(params.sessionId), params.rule as Record<string, unknown>);
    case "permission.rule.delete":
      return deletePermissionRule(String(params.sessionId), String(params.ruleId));
    case "mcp.server.list":
      return {
        servers: [...mcpServers.values()].map((server) => ({ ...server, tools: [...server.tools], resources: [...server.resources] })),
      };
    case "mcp.server.connect":
      return {
        server: connectMcpServer(String(params.serverId)),
      };
    case "mcp.server.disconnect":
      return disconnectMcpServer(String(params.serverId));
    case "agent.spawn":
      return spawnSubAgent(orchestrator, params);
    case "agent.send":
      return sendSubAgent(orchestrator, String(params.taskId), String(params.message));
    case "agent.wait":
      return waitSubAgent(orchestrator, String(params.taskId), params.timeout ? Number(params.timeout) : undefined);
    case "agent.close":
      return closeSubAgent(orchestrator, String(params.taskId));
    case "extension.list":
      return orchestrator.listExtensions();
    case "model.list":
      return orchestrator.listModels();
    default:
      throw new Error(`Unknown command: ${method}`);
  }
}

function getRunnerHost(orchestrator: RunnerRequestOrchestrator): RunnerPrivateHost {
  return orchestrator as unknown as RunnerPrivateHost;
}

function toProtocolBranch(
  branch: CoreSessionBranch,
  activeBranchId: string | null,
): SessionBranch {
  return {
    id: branch.id,
    name: branch.title,
    sessionId: branch.sessionId,
    parentEntryId: branch.headEntryId ?? null,
    createdAt: branch.createdAt,
    isActive: activeBranchId === branch.id,
  };
}

function getSessionModeState(sessionId: string): SessionModeState {
  return sessionModeStates.get(sessionId) ?? {
    sessionId,
    mode: "none",
    status: "inactive",
    enteredAt: null,
    summary: null,
  };
}

function enterSessionMode(
  sessionId: string,
  mode: "plan" | "auto",
  config: Record<string, unknown> | null,
): { sessionId: string; mode: SessionModeState } {
  const enteredAt = nowIso();
  const nextMode: SessionModeState = {
    sessionId,
    mode,
    status: mode === "plan" ? "planning" : "approved",
    enteredAt,
    summary: typeof config?.summary === "string" ? config.summary : null,
  };

  sessionModeStates.set(sessionId, nextMode);
  return {
    sessionId,
    mode: { ...nextMode },
  };
}

function exitSessionMode(
  sessionId: string,
  discarded: boolean,
): { sessionId: string; previousMode: SessionModeState; discarded: boolean } {
  const previousMode = getSessionModeState(sessionId);
  sessionModeStates.set(sessionId, {
    sessionId,
    mode: "none",
    status: "inactive",
    enteredAt: null,
    summary: null,
  });

  return {
    sessionId,
    previousMode: { ...previousMode },
    discarded,
  };
}

function listPermissionRules(sessionId: string): { sessionId: string; rules: PermissionRule[] } {
  return {
    sessionId,
    rules: clonePermissionRules(permissionRuleState.get(sessionId) ?? []),
  };
}

function addPermissionRule(
  sessionId: string,
  ruleInput: Record<string, unknown>,
): { sessionId: string; rule: PermissionRule } {
  const existingRules = permissionRuleState.get(sessionId) ?? [];
  const timestamp = nowIso();
  const ruleId = typeof ruleInput.id === "string" && ruleInput.id.trim() ? ruleInput.id : createId("rule");
  const nextRule: PermissionRule = {
    id: ruleId,
    name: String(ruleInput.name),
    toolPattern: String(ruleInput.toolPattern),
    action: ruleInput.action as PermissionRule["action"],
    conditions: ruleInput.conditions as Record<string, unknown> | undefined,
    priority: typeof ruleInput.priority === "number" ? ruleInput.priority : existingRules.length,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const nextRules = [...existingRules.filter((rule) => rule.id !== ruleId), nextRule];
  permissionRuleState.set(sessionId, nextRules);

  return {
    sessionId,
    rule: { ...nextRule },
  };
}

function deletePermissionRule(
  sessionId: string,
  ruleId: string,
): { sessionId: string; ruleId: string; deleted: boolean } {
  const existingRules = permissionRuleState.get(sessionId) ?? [];
  const nextRules = existingRules.filter((rule) => rule.id !== ruleId);
  const deleted = nextRules.length !== existingRules.length;
  permissionRuleState.set(sessionId, nextRules);

  return {
    sessionId,
    ruleId,
    deleted,
  };
}

function clonePermissionRules(rules: PermissionRule[]): PermissionRule[] {
  return rules.map((rule) => ({ ...rule, conditions: rule.conditions ? { ...rule.conditions } : undefined }));
}

function defaultMcpServer(serverId: string): McpServer {
  return {
    id: serverId,
    name: serverId,
    command: "",
    args: [],
    status: "disconnected",
    error: null,
    tools: [],
    resources: [],
  };
}

function connectMcpServer(serverId: string): McpServer {
  const existing = mcpServers.get(serverId) ?? defaultMcpServer(serverId);
  const connected: McpServer = {
    ...existing,
    status: "connected",
    error: null,
    tools: [...existing.tools],
    resources: existing.resources.map((resource) => ({ ...resource })),
  };

  mcpServers.set(serverId, connected);
  return { ...connected, tools: [...connected.tools], resources: connected.resources.map((resource) => ({ ...resource })) };
}

function disconnectMcpServer(serverId: string): { serverId: string; disconnected: boolean } {
  const existing = mcpServers.get(serverId) ?? defaultMcpServer(serverId);
  mcpServers.set(serverId, {
    ...existing,
    status: "disconnected",
    error: null,
  });

  return {
    serverId,
    disconnected: true,
  };
}

function getRunState(
  orchestrator: RunnerRequestOrchestrator,
  runId: string,
): { run: RunState } {
  const host = getRunnerHost(orchestrator);
  const run = host.database.getRun(runId);
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  const runtime = orchestrator.getSessionRuntimeState(run.sessionId);
  const checkpoints = host.database.listCheckpoints(runId).map((checkpoint) => ({
    id: checkpoint.id,
    createdAt: checkpoint.createdAt,
    phase: checkpoint.phase,
    payload: checkpoint.payload,
  }));

  return {
    run: {
      runId: run.id,
      sessionId: run.sessionId,
      status: mapRunStatus(run.status),
      startedAt: run.createdAt,
      currentToolCallId: runtime.blockedToolCallId,
      pendingApprovalToolCallIds: [...runtime.pendingApprovalToolCallIds],
      error: run.terminalReason ?? null,
      checkpoints,
    },
  };
}

function subscribeRunEvents(
  runId: string,
  events: string[],
): { runId: string; subscriptionId: string; events: string[] } {
  const subscriptionId = createId("sub");
  const normalizedEvents = [...new Set(events.map((eventName) => eventName.trim()).filter(Boolean))];
  if (normalizedEvents.length === 0) {
    normalizedEvents.push("*");
  }
  const subscriptions = runEventSubscriptions.get(runId) ?? [];
  subscriptions.push({
    subscriptionId,
    events: normalizedEvents,
    createdAt: nowIso(),
  });
  runEventSubscriptions.set(runId, subscriptions);

  return {
    runId,
    subscriptionId,
    events: normalizedEvents,
  };
}

function unsubscribeRunEvents(
  runId: string,
  subscriptionId: string,
): { runId: string; subscriptionId: string; unsubscribed: boolean } {
  const subscriptions = runEventSubscriptions.get(runId) ?? [];
  const nextSubscriptions = subscriptions.filter((subscription) => subscription.subscriptionId !== subscriptionId);
  const unsubscribed = nextSubscriptions.length !== subscriptions.length;

  if (nextSubscriptions.length === 0) {
    runEventSubscriptions.delete(runId);
  } else {
    runEventSubscriptions.set(runId, nextSubscriptions);
  }

  return {
    runId,
    subscriptionId,
    unsubscribed,
  };
}

function matchesSubscriptionEvent(eventPattern: string, eventName: string): boolean {
  if (eventPattern === "*" || eventPattern === eventName) {
    return true;
  }
  if (eventPattern.endsWith(".*")) {
    const prefix = eventPattern.slice(0, -1);
    return eventName.startsWith(prefix);
  }
  return false;
}

export function collectRunEventDeliveries(
  eventName: string,
  payload: Record<string, unknown>,
): RunEventDelivery[] {
  const runId = typeof payload.runId === "string" ? payload.runId : null;
  if (!runId) {
    return [];
  }

  const subscriptions = runEventSubscriptions.get(runId) ?? [];
  if (subscriptions.length === 0) {
    return [];
  }

  return subscriptions
    .filter((subscription) =>
      subscription.events.some((eventPattern) => matchesSubscriptionEvent(eventPattern, eventName)))
    .map((subscription) => ({
      runId,
      subscriptionId: subscription.subscriptionId,
      event: eventName,
      payload: { ...payload },
      deliveredAt: nowIso(),
    }));
}

export function resetRunEventSubscriptions(): void {
  runEventSubscriptions.clear();
}

function mapRunStatus(status: string): RunState["status"] {
  switch (status) {
    case "queued":
      return "pending";
    case "running":
      return "running";
    case "blocked":
      return "blocked";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default:
      return "pending";
  }
}

function getSubAgentManager(orchestrator: object, workspaceRoot: string): SubAgentManager {
  const existing = subAgentManagers.get(orchestrator);
  if (existing) {
    return existing;
  }

  const manager = new SubAgentManager(workspaceRoot);
  subAgentManagers.set(orchestrator, manager);
  return manager;
}

function spawnSubAgent(
  orchestrator: RunnerRequestOrchestrator,
  params: Record<string, unknown>,
): AgentSpawnResult {
  const host = getRunnerHost(orchestrator);
  const manager = getSubAgentManager(orchestrator, host.workspaceRoot);
  const subAgentId = manager.spawn({
    ownerId: typeof params.ownerId === "string" ? params.ownerId : undefined,
    task: String(params.prompt),
    writeScope: params.writeScope === "isolated" ? "isolated" : params.writeScope === "worktree" ? "worktree" : "shared",
    background: Boolean(params.background),
    deadline: typeof params.deadline === "number" ? params.deadline : undefined,
    skills: Array.isArray(params.tags) ? params.tags.map((tag) => String(tag)) : undefined,
    description: typeof params.prompt === "string" ? params.prompt : undefined,
  });

  const state = manager.getState(subAgentId);
  if (!state) {
    throw new Error(`Sub-agent ${subAgentId} not found after spawn`);
  }

  return {
    task: toSubAgentTask(state),
  };
}

function sendSubAgent(
  orchestrator: RunnerRequestOrchestrator,
  subAgentId: string,
  message: string,
): AgentSendResult {
  const host = getRunnerHost(orchestrator);
  const manager = getSubAgentManager(orchestrator, host.workspaceRoot);
  const sent = manager.send(subAgentId, message) !== null;
  return {
    subAgentId,
    sent,
  };
}

async function waitSubAgent(
  orchestrator: RunnerRequestOrchestrator,
  subAgentId: string,
  timeout?: number,
): Promise<AgentWaitResult> {
  const host = getRunnerHost(orchestrator);
  const manager = getSubAgentManager(orchestrator, host.workspaceRoot);
  const result = await manager.wait(subAgentId, timeout);
  const state = manager.getState(subAgentId);
  const fallbackState: SubAgentTaskSnapshot = {
    id: subAgentId,
    name: subAgentId,
    status:
      result.status === "completed"
        ? "completed"
        : result.status === "failed"
          ? "failed"
          : result.status === "timeout"
            ? "timeout"
            : "canceled",
    ownerId: "main",
    writeScope: "shared",
    createdAt: result.completedAt,
    startedAt: result.completedAt,
    completedAt: result.completedAt,
    output: result.output ?? result.result ?? null,
    error: result.error ?? null,
    result: result.result ?? result.output ?? null,
  };

  return {
    task: toSubAgentTask(
      state ?? fallbackState,
    ),
    timedOut: result.status === "timeout",
  };
}

function closeSubAgent(
  orchestrator: RunnerRequestOrchestrator,
  subAgentId: string,
): AgentCloseResult {
  const host = getRunnerHost(orchestrator);
  const manager = getSubAgentManager(orchestrator, host.workspaceRoot);
  return {
    subAgentId,
    closed: manager.close(subAgentId, false),
  };
}

function toSubAgentTask(state: SubAgentTaskSnapshot | SubAgentState): {
  id: string;
  name: string;
  ownerId: string;
  status: "pending" | "spawning" | "running" | "waiting" | "completed" | "failed" | "canceled" | "timeout";
  writeScope: "shared" | "isolated" | "worktree";
  progress: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  output: unknown | null;
  error: string | null;
} {
  const result = "result" in state ? state.result : undefined;
  return {
    id: state.id,
    name: state.name,
    ownerId: state.ownerId,
    status:
      state.status === "initializing"
        ? "spawning"
        : state.status === "closed"
          ? "canceled"
          : state.status === "timeout"
            ? "timeout"
          : state.status,
    writeScope: state.writeScope,
    progress:
      state.progress ?? (state.status === "completed" ? 100 : state.status === "failed" || state.status === "canceled" ? 0 : 0),
    createdAt: state.createdAt,
    startedAt: state.startedAt ?? null,
    completedAt: state.completedAt ?? null,
    output: state.output ?? result ?? null,
    error: state.error ?? null,
  };
}
