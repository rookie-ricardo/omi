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
import { getGitDiffPreview, getGitRepoState } from "./vcs";
import { getLogger } from "./logger";
import { createDatabaseTaskToolRuntime } from "./task-runtime";

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
    this.mcpRegistry = new McpRegistryImpl();
    this.taskToolRuntime = createDatabaseTaskToolRuntime(database);
    this.toolRuntimeContext = {
      mcpRegistry: this.mcpRegistry,
      taskRuntime: this.taskToolRuntime,
    };
  }

  // =========================================================================
  // Session CRUD
  // =========================================================================

  createSession(title: string): Session {
    const session = this.database.createSession(title);
    this.sessionManager.getOrCreate(session.id);
    logger.info("Session created", { sessionId: session.id, title });
    return session;
  }

  listSessions(): Session[] {
    return this.database.listSessions();
  }

  getSessionDetail(sessionId: string): SessionDetail {
    const session = this.requireSession(sessionId);
    return {
      session,
      messages: this.database.listMessages(session.id),
      tasks: this.database.listTasks().filter((task) => task.originSessionId === session.id),
    };
  }

  updateSessionTitle(sessionId: string, title: string): { session: Session } {
    this.requireSession(sessionId);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      throw new Error("Session title cannot be empty");
    }
    return { session: this.database.updateSession(sessionId, { title: trimmedTitle }) };
  }

  getSessionRuntimeState(sessionId: string): SessionRuntimeState {
    this.requireSession(sessionId);
    return this.sessionManager.getOrCreate(sessionId).snapshot();
  }

  listSessionHistory(sessionId: string): SessionHistoryList {
    this.requireSession(sessionId);
    return {
      sessionId,
      historyEntries: this.database.listSessionHistoryEntries?.(sessionId) ?? [],
    };
  }

  listToolCalls(sessionId: string): SessionToolCalls {
    this.requireSession(sessionId);
    return { sessionId, toolCalls: this.database.listToolCallsBySession(sessionId) };
  }

  listPendingToolCalls(sessionId: string): PendingToolCalls {
    this.requireSession(sessionId);
    const runtime = this.sessionManager.getOrCreate(sessionId).snapshot();
    return {
      sessionId,
      runtime,
      pendingToolCalls: this.database.listToolCallsBySession(sessionId).filter(
        (toolCall) => toolCall.approvalState === "pending",
      ),
    };
  }

  // =========================================================================
  // Model / Provider Config
  // =========================================================================

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

  switchModel(sessionId: string, providerConfigId: string): { sessionId: string; runtime: SessionRuntimeState } {
    this.requireSession(sessionId);
    const providerConfig = this.database.getProviderConfig(providerConfigId);
    if (!providerConfig) {
      throw new Error(`Provider config ${providerConfigId} not found`);
    }
    const runtime = this.sessionManager.getOrCreate(sessionId);
    runtime.setSelectedProviderConfig(providerConfig.id);
    return { sessionId, runtime: runtime.snapshot() };
  }

  // =========================================================================
  // Task & Skill
  // =========================================================================

  listTasks(): Task[] {
    return this.database.listTasks();
  }

  updateTask(taskId: string, action: "start_now" | "keep_in_inbox" | "dismiss" | "mark_reviewed") {
    const task = this.database.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    return this.database.updateTask(task.id, { status: nextTaskStatus(task.status, action) });
  }

  listSkills(): Promise<SkillDescriptor[]> {
    return this.resources.listSkills();
  }

  searchSkills(query: string): Promise<SkillMatch[]> {
    return this.resources.searchSkills(query);
  }

  // =========================================================================
  // Git
  // =========================================================================

  getGitStatus(): Promise<GitRepoState> {
    return getGitRepoState(this.workspaceRoot);
  }

  getGitDiff(path: string): Promise<GitDiffPreview> {
    return getGitDiffPreview(this.workspaceRoot, path);
  }

  // =========================================================================
  // Run Dispatch
  // =========================================================================

  startRun(input: {
    sessionId: string;
    taskId: string | null;
    prompt: string;
    contextFiles?: string[];
  }): Run {
    this.requireSession(input.sessionId);
    const providerConfig = this.resolveProviderConfigForSession(input.sessionId);
    const run = this.getConfiguredAgentSession(input.sessionId).startRun({
      taskId: input.taskId,
      prompt: transformPlanPromptForRuntime(input.prompt, providerConfig.protocol),
      contextFiles: input.contextFiles,
      providerConfig,
    });
    logger.info("Run started", { runId: run.id, sessionId: input.sessionId });
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
    this.requireSession(input.sessionId);
    const providerConfig = this.resolveProviderConfigForSession(input.sessionId);
    return this.getConfiguredAgentSession(input.sessionId).continueFromHistoryEntry({
      taskId: input.taskId,
      prompt: transformPlanPromptForRuntime(input.prompt, providerConfig.protocol),
      historyEntryId: input.historyEntryId ?? null,
      checkpointSummary: input.checkpointSummary ?? null,
      checkpointDetails: input.checkpointDetails ?? null,
      providerConfig,
    });
  }

  retryRun(runId: string): Run {
    const run = this.requireRun(runId);
    return this.getConfiguredAgentSession(run.sessionId).retryRun(runId);
  }

  resumeRun(runId: string): Run {
    const run = this.requireRun(runId);
    return this.getConfiguredAgentSession(run.sessionId).resumeRun(runId);
  }

  cancelRun(runId: string): { runId: string; canceled: true } {
    const run = this.database.getRun(runId);
    if (!run) {
      return { runId, canceled: true };
    }
    return this.getAgentSession(run.sessionId).cancelRun(runId);
  }

  // =========================================================================
  // Tool Approval
  // =========================================================================

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

  // =========================================================================
  // Session Configuration
  // =========================================================================

  async compactSession(sessionId: string): Promise<SessionCompactionResult> {
    this.requireSession(sessionId);
    return this.getAgentSession(sessionId).compactSession();
  }

  setSessionPermissionMode(
    sessionId: string,
    mode: SessionPermissionMode,
  ): { sessionId: string; mode: SessionPermissionMode } {
    this.requireSession(sessionId);
    this.sessionPermissionModes.set(sessionId, mode);
    this.getAgentSession(sessionId).setPermissionMode(mode);
    return { sessionId, mode };
  }

  setSessionWorkspaceRoot(
    sessionId: string,
    workspaceRoot: string | null,
  ): SessionWorkspaceSetResult {
    this.requireSession(sessionId);
    const resolvedWorkspaceRoot = this.resolveWorkspaceRootInput(workspaceRoot);
    if (workspaceRoot === null) {
      this.sessionWorkspaceRoots.delete(sessionId);
    } else {
      this.sessionWorkspaceRoots.set(sessionId, resolvedWorkspaceRoot);
    }
    this.getAgentSession(sessionId).setWorkspaceRoot(resolvedWorkspaceRoot);
    return { sessionId, workspaceRoot: resolvedWorkspaceRoot };
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private requireSession(sessionId: string): Session {
    const session = this.database.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return session;
  }

  private requireRun(runId: string): Run {
    const run = this.database.getRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }
    return run;
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
    const resolved = resolvePath(workspaceRoot);
    if (!existsSync(resolved)) {
      throw new Error(`Workspace root does not exist: ${resolved}`);
    }
    if (!statSync(resolved).isDirectory()) {
      throw new Error(`Workspace root must be a directory: ${resolved}`);
    }
    return resolved;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

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
  if (action === "start_now") return "active";
  if (action === "keep_in_inbox") return "inbox";
  if (action === "dismiss") return "dismissed";
  if (action === "mark_reviewed") return "done";
  if (action === "run_completed") return current === "active" ? "review" : current;
  return current;
}
