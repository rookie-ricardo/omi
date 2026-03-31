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

import {
  AgentSession,
  type AgentSessionOptions,
  type RunnerEventEnvelope,
} from "./agent-session";
import { listBuiltInModels, listBuiltInProviders } from "@omi/provider";
import { getProviderDefaults } from "@omi/settings";
import { DefaultResourceLoader, type ResourceLoader } from "./resource-loader";
import type { SessionCompactionSnapshot } from "@omi/memory";
import {
  SessionManager,
  createDatabaseSessionRuntimeStore,
  type SessionRuntimeState,
} from "./session-manager";
import { getGitDiffPreview, getGitRepoState } from "./vcs";

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

export interface ExtensionCapability {
  name: string;
  hasSetup: boolean;
  hasBeforeRun: boolean;
  hasOnEvent: boolean;
}

export interface ExtensionCatalog {
  workspaceRoot: string;
  diagnostics: string[];
  extensions: ExtensionCapability[];
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

export class AppOrchestrator {
  private readonly resources: ResourceLoader;
  private readonly sessionManager: SessionManager;
  private readonly agentSessions = new Map<string, AgentSession>();

  constructor(
    private readonly database: AppStore,
    private readonly workspaceRoot: string,
    private readonly emit: (event: RunnerEventEnvelope) => void,
    resourceLoader?: ResourceLoader,
    sessionManager?: SessionManager,
    private readonly createAgentSession: (options: AgentSessionOptions) => AgentSession = (
      options,
    ) => new AgentSession(options),
  ) {
    this.resources = resourceLoader ?? new DefaultResourceLoader(workspaceRoot);
    this.sessionManager =
      sessionManager ?? new SessionManager(createDatabaseSessionRuntimeStore(database));
  }

  createSession(title: string): Session {
    const session = this.database.createSession(title);
    this.sessionManager.getOrCreate(session.id);
    return session;
  }

  listSessions(): Session[] {
    return this.database.listSessions();
  }

  getSessionDetail(sessionId: string): SessionDetail {
    const session = this.database.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return {
      session,
      messages: this.database.listMessages(session.id),
      tasks: this.database.listTasks().filter((task) => task.originSessionId === session.id),
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

  async listExtensions(): Promise<ExtensionCatalog> {
    await this.resources.reload();
    const extensionCatalog = this.resources.getExtensions();

    return {
      workspaceRoot: this.workspaceRoot,
      diagnostics: [...extensionCatalog.diagnostics],
      extensions: extensionCatalog.items.map((extension) => ({
        name: extension.name,
        hasSetup: typeof extension.setup === "function",
        hasBeforeRun: typeof extension.beforeRun === "function",
        hasOnEvent: typeof extension.onEvent === "function",
      })),
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
    type: string;
    baseUrl: string;
    model: string;
    apiKey: string;
  }): ProviderConfig {
    const defaults = getProviderDefaults(input.type);
    return this.database.upsertProviderConfig({
      id: input.id,
      name: defaults.name,
      type: input.type,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey,
    });
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

  startRun(input: { sessionId: string; taskId: string | null; prompt: string }): Run {
    const session = this.database.getSession(input.sessionId);
    if (!session) {
      throw new Error(`Session ${input.sessionId} not found`);
    }

    return this.getAgentSession(session.id).startRun({
      taskId: input.taskId,
      prompt: input.prompt,
      providerConfig: this.resolveProviderConfigForSession(session.id),
    });
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

    return this.getAgentSession(session.id).continueFromHistoryEntry({
      taskId: input.taskId,
      prompt: input.prompt,
      historyEntryId: input.historyEntryId ?? null,
      checkpointSummary: input.checkpointSummary ?? null,
      checkpointDetails: input.checkpointDetails ?? null,
      providerConfig: this.resolveProviderConfigForSession(session.id),
    });
  }

  retryRun(runId: string): Run {
    const run = this.database.getRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    return this.getAgentSession(run.sessionId).retryRun(runId);
  }

  resumeRun(runId: string): Run {
    const run = this.database.getRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    return this.getAgentSession(run.sessionId).resumeRun(runId);
  }

  async compactSession(sessionId: string): Promise<SessionCompactionResult> {
    const session = this.database.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return this.getAgentSession(sessionId).compactSession();
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
      return { runId, canceled: true };
    }

    return this.getAgentSession(run.sessionId).cancelRun(runId);
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
      workspaceRoot: this.workspaceRoot,
      emit: this.emit,
      resources: this.resources,
      runtime: this.sessionManager.getOrCreate(sessionId),
    });
    this.agentSessions.set(sessionId, agentSession);
    return agentSession;
  }

  private listToolCallsBySession(sessionId: string): ToolCall[] {
    return this.database.listToolCallsBySession(sessionId);
  }
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
