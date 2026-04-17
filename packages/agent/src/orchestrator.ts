import { existsSync, statSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type {
  GitDiffPreview,
  GitRepoState,
  ProviderConfig,
  Run,
  Session,
  SessionHistoryEntry,
  SkillDescriptor,
  SkillMatch,
  Task,
  ToolCall,
} from "@omi/core";
import type { AppStore } from "@omi/store";
import type { McpRegistry } from "@omi/provider";
import {
  type SubAgentManagerClient,
  type SubAgentToolState,
  type TaskToolRecord,
  type TaskToolRuntime,
  type ToolRuntimeContext,
} from "@omi/tools";

import {
  AgentSession,
  type AgentSessionOptions,
  type RunnerEventEnvelope,
} from "./agent-session";
import { listBuiltInModels, listBuiltInProviders, McpRegistry as McpRegistryImpl } from "@omi/provider";
import type { SettingsManager } from "@omi/settings";
import { DefaultResourceLoader, type ResourceLoader } from "./resource-loader";
import type { SessionCompactionSnapshot } from "@omi/memory";
import {
  SessionManager,
  createDatabaseSessionRuntimeStore,
  type SessionRuntimeState,
} from "./session-manager";
import {
  SubAgentManager,
  type SubAgentSpawnRequest,
  type SubAgentState,
  type SubAgentStatus,
} from "./subagent-manager";
import { getGitDiffPreview, getGitRepoState } from "./vcs";
import { getLogger } from "./logger";
import { nowIso } from "@omi/core";

const logger = getLogger("orchestrator");

export interface SessionDetail {
  session: Session;
  messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
  tasks: Task[];
}

export interface SessionHistoryList {
  sessionId: string;
  historyEntries: SessionHistoryEntry[];
}

export interface SessionToolCalls {
  sessionId: string;
  toolCalls: ToolCall[];
}

export interface PendingToolCalls {
  sessionId: string;
  runtime: SessionRuntimeState;
  pendingToolCalls: ToolCall[];
}

export interface ModelCatalog {
  providerConfigs: ProviderConfig[];
  builtInProviders: Array<{
    provider: string;
    models: Array<{
      id: string;
      name: string;
      provider: string;
      api: string;
      baseUrl: string;
      reasoning: boolean;
      input: string[];
      contextWindow: number;
      maxTokens: number;
    }>;
  }>;
}

export interface SessionCompactionResult {
  sessionId: string;
  runtime: SessionRuntimeState;
  summary: SessionCompactionSnapshot["summary"];
  compactedAt: string;
}

type SessionPermissionMode = "default" | "full-access";
type SessionWorkspaceSetResult = {
  sessionId: string;
  workspaceRoot: string;
};

export class AppOrchestrator {
  private readonly resources: ResourceLoader;
  private readonly sessionManager: SessionManager;
  private readonly agentSessions = new Map<string, AgentSession>();
  private readonly settingsManager?: SettingsManager;
  private readonly subAgentManager: SubAgentManager;
  private readonly mcpRegistry: McpRegistry;
  private readonly taskToolRuntime: TaskToolRuntime;
  private readonly toolRuntimeContext: ToolRuntimeContext;
  private readonly sessionPermissionModes = new Map<string, SessionPermissionMode>();
  private readonly sessionWorkspaceRoots = new Map<string, string>();

  constructor(
    private readonly database: AppStore,
    private readonly workspaceRoot: string,
    private readonly emit: (event: RunnerEventEnvelope) => void,
    resourceLoader?: ResourceLoader,
    sessionManager?: SessionManager,
    settingsManager?: SettingsManager,
    private readonly createAgentSession: (options: AgentSessionOptions) => AgentSession = (
      options,
    ) => new AgentSession(options),
  ) {
    this.resources = resourceLoader ?? new DefaultResourceLoader(workspaceRoot);
    this.sessionManager =
      sessionManager ?? new SessionManager(createDatabaseSessionRuntimeStore(database));
    this.settingsManager = settingsManager;
    this.subAgentManager = new SubAgentManager(workspaceRoot);
    this.mcpRegistry = new McpRegistryImpl();
    this.taskToolRuntime = createDatabaseTaskToolRuntime(database);
    this.toolRuntimeContext = {
      mcpRegistry: this.mcpRegistry,
      subAgentClient: createSubAgentRuntimeClient(this.subAgentManager),
      taskRuntime: this.taskToolRuntime,
    };
  }

  createSession(title: string): Session {
    const session = this.database.createSession(title);
    this.sessionManager.getOrCreate(session.id);
    logger.info("Session created", { sessionId: session.id, title });
    return session;
  }

  listSessions(): Session[] {
    const sessions = this.database.listSessions();
    logger.debug("Sessions listed", { count: sessions.length });
    return sessions;
  }

  getSessionDetail(sessionId: string): SessionDetail {
    const session = this.database.getSession(sessionId);
    if (!session) {
      logger.error("Session not found", { sessionId });
      throw new Error(`Session ${sessionId} not found`);
    }

    return {
      session,
      messages: this.database.listMessages(session.id),
      tasks: this.database.listTasks().filter((task) => task.originSessionId === session.id),
    };
  }

  updateSessionTitle(sessionId: string, title: string): { session: Session } {
    const session = this.database.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      throw new Error("Session title cannot be empty");
    }

    return {
      session: this.database.updateSession(sessionId, {
        title: trimmedTitle,
      }),
    };
  }

  getSessionRuntimeState(sessionId: string): SessionRuntimeState {
    const session = this.database.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return this.sessionManager.getOrCreate(sessionId).snapshot();
  }

  listSessionHistory(sessionId: string): SessionHistoryList {
    const session = this.database.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return {
      sessionId,
      historyEntries: this.database.listSessionHistoryEntries?.(sessionId) ?? [],
    };
  }

  listToolCalls(sessionId: string): SessionToolCalls {
    const session = this.database.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return {
      sessionId,
      toolCalls: this.listToolCallsBySession(sessionId),
    };
  }

  listPendingToolCalls(sessionId: string): PendingToolCalls {
    const session = this.database.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const runtime = this.sessionManager.getOrCreate(sessionId).snapshot();
    return {
      sessionId,
      runtime,
      pendingToolCalls: this.listToolCallsBySession(sessionId).filter(
        (toolCall) => toolCall.approvalState === "pending",
      ),
    };
  }

  listModels(): ModelCatalog {
    return {
      providerConfigs: this.database.listProviderConfigs(),
      builtInProviders: listBuiltInProviders().map((provider) => ({
        provider,
        models: listBuiltInModels(provider).map((model) => ({
          id: model.id,
          name: model.name,
          provider: model.provider,
          api: model.api,
          baseUrl: model.baseUrl,
          reasoning: model.reasoning,
          input: [...model.input],
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
        })),
      })),
    };
  }

  saveProviderConfig(input: {
    id?: string;
    name: string;
    protocol: "anthropic-messages" | "openai-chat" | "openai-responses";
    baseUrl: string;
    model: string;
    apiKey: string;
    url?: string;
  }): ProviderConfig {
    return this.database.upsertProviderConfig({
      id: input.id,
      name: input.name,
      protocol: input.protocol,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey,
      url: input.url ?? "",
    });
  }

  deleteProviderConfig(id: string): { deleted: boolean } {
    this.database.deleteProviderConfig(id);
    return { deleted: true };
  }

  listTasks(): Task[] {
    return this.database.listTasks();
  }

  updateTask(
    taskId: string,
    action: "start_now" | "keep_in_inbox" | "dismiss" | "mark_reviewed",
  ) {
    const task = this.database.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    return this.database.updateTask(task.id, {
      status: nextTaskStatus(task.status, action),
    });
  }

  listSkills(): Promise<SkillDescriptor[]> {
    return this.resources.listSkills();
  }

  searchSkills(query: string): Promise<SkillMatch[]> {
    return this.resources.searchSkills(query);
  }

  getGitStatus(): Promise<GitRepoState> {
    return getGitRepoState(this.workspaceRoot);
  }

  getGitDiff(path: string): Promise<GitDiffPreview> {
    return getGitDiffPreview(this.workspaceRoot, path);
  }

  startRun(input: {
    sessionId: string;
    taskId: string | null;
    prompt: string;
    contextFiles?: string[];
  }): Run {
    const startTime = Date.now();
    const session = this.database.getSession(input.sessionId);
    if (!session) {
      logger.error("Run start failed: Session not found", { sessionId: input.sessionId });
      throw new Error(`Session ${input.sessionId} not found`);
    }

    const providerConfig = this.resolveProviderConfigForSession(session.id);
    const run = this.getConfiguredAgentSession(session.id).startRun({
      taskId: input.taskId,
      prompt: transformPlanPromptForRuntime(input.prompt, providerConfig.protocol),
      contextFiles: input.contextFiles,
      providerConfig,
    });

    logger.info("Run started", {
      runId: run.id,
      sessionId: input.sessionId,
      taskId: input.taskId,
      promptLength: input.prompt.length,
      durationMs: Date.now() - startTime,
    });

    return run;
  }

  continueFromHistoryEntry(input: {
    sessionId: string;
    historyEntryId?: string | null;
    taskId: string | null;
    prompt: string;
    checkpointSummary?: string | null;
    checkpointDetails?: unknown | null;
  }): Run {
    const session = this.database.getSession(input.sessionId);
    if (!session) {
      throw new Error(`Session ${input.sessionId} not found`);
    }

    const providerConfig = this.resolveProviderConfigForSession(session.id);
    return this.getConfiguredAgentSession(session.id).continueFromHistoryEntry({
      taskId: input.taskId,
      prompt: transformPlanPromptForRuntime(input.prompt, providerConfig.protocol),
      historyEntryId: input.historyEntryId ?? null,
      checkpointSummary: input.checkpointSummary ?? null,
      checkpointDetails: input.checkpointDetails ?? null,
      providerConfig,
    });
  }

  retryRun(runId: string): Run {
    const startTime = Date.now();
    const run = this.database.getRun(runId);
    if (!run) {
      logger.error("Run retry failed: Run not found", { runId });
      throw new Error(`Run ${runId} not found`);
    }

    const newRun = this.getConfiguredAgentSession(run.sessionId).retryRun(runId);
    logger.info("Run retried", {
      originalRunId: runId,
      newRunId: newRun.id,
      sessionId: run.sessionId,
      durationMs: Date.now() - startTime,
    });

    return newRun;
  }

  resumeRun(runId: string): Run {
    const startTime = Date.now();
    const run = this.database.getRun(runId);
    if (!run) {
      logger.error("Run resume failed: Run not found", { runId });
      throw new Error(`Run ${runId} not found`);
    }

    const resumedRun = this.getConfiguredAgentSession(run.sessionId).resumeRun(runId);
    logger.info("Run resumed", {
      runId,
      sessionId: run.sessionId,
      durationMs: Date.now() - startTime,
    });

    return resumedRun;
  }

  async compactSession(sessionId: string): Promise<SessionCompactionResult> {
    const startTime = Date.now();
    const session = this.database.getSession(sessionId);
    if (!session) {
      logger.error("Session compaction failed: Session not found", { sessionId });
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      const result = await this.getAgentSession(sessionId).compactSession();
      logger.info("Session compacted", {
        sessionId,
        durationMs: Date.now() - startTime,
      });
      return result;
    } catch (error) {
      logger.errorWithError("Session compaction failed", error, { sessionId });
      throw error;
    }
  }

  switchModel(sessionId: string, providerConfigId: string): { sessionId: string; runtime: SessionRuntimeState } {
    const session = this.database.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const providerConfig = this.database.getProviderConfig(providerConfigId);
    if (!providerConfig) {
      throw new Error(`Provider config ${providerConfigId} not found`);
    }

    const runtime = this.sessionManager.getOrCreate(sessionId);
    runtime.setSelectedProviderConfig(providerConfig.id);

    return {
      sessionId,
      runtime: runtime.snapshot(),
    };
  }

  cancelRun(runId: string): { runId: string; canceled: true } {
    const run = this.database.getRun(runId);
    if (!run) {
      logger.warn("Run cancel: Run not found", { runId });
      return { runId, canceled: true };
    }

    const result = this.getAgentSession(run.sessionId).cancelRun(runId);
    logger.info("Run cancelled", { runId, sessionId: run.sessionId });
    return result;
  }

  approveTool(toolCallId: string): { toolCallId: string; decision: "approved" } {
    const toolCall = this.database.getToolCall(toolCallId);
    if (!toolCall) {
      return { toolCallId, decision: "approved" };
    }

    return this.getAgentSession(toolCall.sessionId).approveTool(toolCallId);
  }

  rejectTool(toolCallId: string): { toolCallId: string; decision: "rejected" } {
    const toolCall = this.database.getToolCall(toolCallId);
    if (!toolCall) {
      return { toolCallId, decision: "rejected" };
    }

    return this.getAgentSession(toolCall.sessionId).rejectTool(toolCallId);
  }

  setSessionPermissionMode(
    sessionId: string,
    mode: SessionPermissionMode,
  ): { sessionId: string; mode: SessionPermissionMode } {
    const session = this.database.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    this.sessionPermissionModes.set(sessionId, mode);
    this.getAgentSession(sessionId).setPermissionMode(mode);
    return { sessionId, mode };
  }

  setSessionWorkspaceRoot(
    sessionId: string,
    workspaceRoot: string | null,
  ): SessionWorkspaceSetResult {
    const session = this.database.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const resolvedWorkspaceRoot = this.resolveWorkspaceRootInput(workspaceRoot);
    if (workspaceRoot === null) {
      this.sessionWorkspaceRoots.delete(sessionId);
    } else {
      this.sessionWorkspaceRoots.set(sessionId, resolvedWorkspaceRoot);
    }
    this.getAgentSession(sessionId).setWorkspaceRoot(resolvedWorkspaceRoot);

    return {
      sessionId,
      workspaceRoot: resolvedWorkspaceRoot,
    };
  }

  private requireProviderConfig(): ProviderConfig {
    const config = this.database.getProviderConfig();
    if (!config) {
      throw new Error("No provider config found. Configure a model in Settings before starting a run.");
    }
    return config;
  }

  private resolveProviderConfigForSession(sessionId: string): ProviderConfig {
    const runtime = this.sessionManager.getOrCreate(sessionId).snapshot();
    if (runtime.selectedProviderConfigId) {
      const selected = this.database.getProviderConfig(runtime.selectedProviderConfigId);
      if (selected) {
        return selected;
      }
    }

    return this.requireProviderConfig();
  }

  private getAgentSession(sessionId: string): AgentSession {
    const current = this.agentSessions.get(sessionId);
    if (current) {
      return current;
    }

    const startTime = Date.now();
    const agentSession = this.createAgentSession({
      database: this.database,
      sessionId,
      emit: this.emit,
      resources: this.resources,
      runtime: this.sessionManager.getOrCreate(sessionId),
      settingsManager: this.settingsManager,
      toolRuntimeContext: this.toolRuntimeContext,
      workspaceRoot: this.getSessionWorkspaceRoot(sessionId),
      permissionMode: this.sessionPermissionModes.get(sessionId) ?? "default",
    });
    this.agentSessions.set(sessionId, agentSession);
    logger.debug("AgentSession created", { sessionId, durationMs: Date.now() - startTime });
    return agentSession;
  }

  private getConfiguredAgentSession(sessionId: string): AgentSession {
    const session = this.getAgentSession(sessionId);
    session.setWorkspaceRoot(this.getSessionWorkspaceRoot(sessionId));
    session.setPermissionMode(this.sessionPermissionModes.get(sessionId) ?? "default");
    return session;
  }

  private getSessionWorkspaceRoot(sessionId: string): string {
    return this.sessionWorkspaceRoots.get(sessionId) ?? this.workspaceRoot;
  }

  private resolveWorkspaceRootInput(workspaceRoot: string | null): string {
    if (workspaceRoot === null) {
      return this.workspaceRoot;
    }

    const resolvedWorkspaceRoot = resolvePath(workspaceRoot);
    if (!existsSync(resolvedWorkspaceRoot)) {
      throw new Error(`Workspace root does not exist: ${resolvedWorkspaceRoot}`);
    }
    if (!statSync(resolvedWorkspaceRoot).isDirectory()) {
      throw new Error(`Workspace root must be a directory: ${resolvedWorkspaceRoot}`);
    }

    return resolvedWorkspaceRoot;
  }

  private listToolCallsBySession(sessionId: string): ToolCall[] {
    return this.database.listToolCallsBySession(sessionId);
  }
}

function transformPlanPromptForRuntime(
  prompt: string,
  protocol: ProviderConfig["protocol"],
): string {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith("/plan")) {
    return prompt;
  }

  if (protocol === "anthropic-messages") {
    return prompt;
  }

  const body = trimmed.slice("/plan".length).trim();
  const target = body.length > 0 ? body : "Analyze the current task and provide an implementation plan.";

  return [
    "Plan-only mode.",
    "Generate a concrete implementation plan and do not propose executing actions.",
    "Do not write code, do not run commands, and do not claim work is completed.",
    "Output sections exactly as:",
    "1) Goal",
    "2) Scope",
    "3) Step-by-step Plan",
    "4) Risks",
    "",
    `User request: ${target}`,
  ].join("\\n");
}

function nextTaskStatus(
  current: Task["status"],
  action: "start_now" | "keep_in_inbox" | "dismiss" | "mark_reviewed" | "run_completed",
): Task["status"] {
  if (action === "start_now") {
    return "active";
  }
  if (action === "keep_in_inbox") {
    return "inbox";
  }
  if (action === "dismiss") {
    return "dismissed";
  }
  if (action === "mark_reviewed") {
    return "done";
  }
  if (action === "run_completed") {
    return current === "active" ? "review" : current;
  }
  return current;
}

class DatabaseTaskToolRuntime implements TaskToolRuntime {
  private readonly meta = new Map<string, { output?: string; stoppedAt?: string }>();

  constructor(private readonly database: AppStore) {}

  createTask(input: {
    title: string;
    originSessionId: string;
    candidateReason: string;
    autoCreated?: boolean;
    status?: Task["status"];
  }): TaskToolRecord {
    const task = this.database.createTask({
      title: input.title,
      originSessionId: input.originSessionId,
      candidateReason: input.candidateReason,
      autoCreated: input.autoCreated ?? true,
      status: input.status ?? "inbox",
    });
    return this.toRecord(task);
  }

  updateTask(taskId: string, input: {
    title?: string;
    status?: Task["status"];
    candidateReason?: string;
    autoCreated?: boolean;
  }): TaskToolRecord | null {
    const current = this.database.getTask(taskId);
    if (!current) {
      return null;
    }

    const updated = this.database.updateTask(taskId, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.candidateReason !== undefined ? { candidateReason: input.candidateReason } : {}),
      ...(input.autoCreated !== undefined ? { autoCreated: input.autoCreated } : {}),
    });
    return this.toRecord(updated);
  }

  getTask(taskId: string): TaskToolRecord | null {
    const task = this.database.getTask(taskId);
    if (!task) {
      return null;
    }
    return this.toRecord(task);
  }

  listTasks(input?: { status?: Task["status"]; originSessionId?: string }): TaskToolRecord[] {
    return this.database
      .listTasks()
      .filter((task) => {
        if (input?.status && task.status !== input.status) return false;
        if (input?.originSessionId && task.originSessionId !== input.originSessionId) return false;
        return true;
      })
      .map((task) => this.toRecord(task));
  }

  stopTask(taskId: string): TaskToolRecord | null {
    const task = this.database.getTask(taskId);
    if (!task) {
      return null;
    }

    const stoppedAt = nowIso();
    const updated = this.database.updateTask(taskId, {
      status: "dismissed",
    });
    this.meta.set(taskId, {
      ...this.meta.get(taskId),
      stoppedAt,
    });
    return this.toRecord(updated);
  }

  setTaskOutput(taskId: string, output: string): TaskToolRecord | null {
    const task = this.database.getTask(taskId);
    if (!task) {
      return null;
    }

    this.meta.set(taskId, {
      ...this.meta.get(taskId),
      output,
    });
    return this.toRecord(task);
  }

  private toRecord(task: Task): TaskToolRecord {
    const details = this.meta.get(task.id);
    return {
      task,
      output: details?.output,
      stoppedAt: details?.stoppedAt,
    };
  }
}

function createDatabaseTaskToolRuntime(database: AppStore): TaskToolRuntime {
  return new DatabaseTaskToolRuntime(database);
}

function createSubAgentRuntimeClient(manager: SubAgentManager): SubAgentManagerClient {
  return {
    async spawn(input) {
      const typedInput = (input ?? {}) as SubAgentSpawnRequest;
      const subAgentId = manager.spawn({
        ...typedInput,
        ownerId: "main",
      });
      const state = manager.getState(subAgentId);
      return {
        subAgentId,
        name: state?.name ?? subAgentId,
      };
    },
    async send(input) {
      const typedInput = input as { subAgentId: string; message: string; topic?: string };
      const message = manager.send(
        typedInput.subAgentId,
        typedInput.message,
        typedInput.topic,
      );
      return {
        success: message !== null,
        messageId: message?.id,
      };
    },
    async wait(input) {
      const typedInput = input as { subAgentId: string; timeout?: number };
      const result = await manager.wait(typedInput.subAgentId, typedInput.timeout);
      return {
        status: result.status,
        result: result.result ?? result.output ?? result.text,
        error: result.error,
        timedOut: result.status === "timeout",
      };
    },
    async close(input) {
      const typedInput = input as { subAgentId: string; force?: boolean };
      return {
        success: manager.close(typedInput.subAgentId, typedInput.force ?? false),
      };
    },
    async list(input) {
      const typedInput = (input ?? {}) as { status?: string; parentId?: string };
      const status = normalizeSubAgentStatus(typedInput.status);
      const subAgents = manager.list({
        status,
        parentId: typedInput.parentId,
      }).map((subAgent) => toSubAgentToolState(subAgent.state));
      return { subAgents };
    },
    async get(input) {
      const typedInput = input as { subAgentId: string };
      const state = manager.getState(typedInput.subAgentId);
      return {
        subAgent: state ? toSubAgentToolState(state) : undefined,
      };
    },
  };
}

function normalizeSubAgentStatus(status: string | undefined): SubAgentStatus | undefined {
  switch (status) {
    case "pending":
    case "initializing":
    case "running":
    case "waiting":
    case "completed":
    case "failed":
    case "canceled":
    case "closed":
      return status;
    default:
      return undefined;
  }
}

function toSubAgentToolState(state: SubAgentState): SubAgentToolState {
  return {
    id: state.id,
    name: state.name,
    status: state.status === "canceled" ? "closed" : state.status,
    task: state.task,
    workspaceRoot: state.workspaceRoot,
    parentId: state.parentId,
    createdAt: state.createdAt,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    result: state.result,
    error: state.error,
    progress: state.progress,
    messages: state.messages,
    toolCalls: state.toolCalls,
  };
}
