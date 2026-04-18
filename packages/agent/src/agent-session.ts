import type {
  ProviderConfig,
  ResolvedSkill,
  Run,
  Session,
  Task,
  ToolCall,
} from "@omi/core";
import type { AppStore } from "@omi/store";
import type { ImageContent } from "@mariozechner/pi-ai";

import { createId, nowIso } from "@omi/core";
import {
  buildSessionRuntimeMessages,
  buildSessionRuntimeMessageEnvelopes,
  convertRuntimeMessagesToLlm,
  type RuntimeMessage,
  type SessionCompactionSnapshot,
  type SessionRuntimeMessageEnvelope,
  type CompactionSummaryDocument,
} from "@omi/memory";
import {
  createProviderAdapter,
  type ProviderAdapter,
  type ProviderRunResult,
  type ProviderToolLifecycleControl,
  type ProviderToolLifecycleEvent,
} from "@omi/provider";
import {
  createAllTools,
  listBuiltInToolNames,
  SAFE_TOOL_NAMES,
  runWithToolRuntimeContext,
  type ToolRuntimeContext,
} from "@omi/tools";

import type { ResourceLoader } from "./resource-loader";
import type { SessionRuntime } from "./session-manager";
import type { SettingsManager } from "@omi/settings";
import {
  type PermissionEvaluator,
  type PermissionContext,
  MemoryDenialTracker,
  createPermissionEvaluator,
} from "./permissions";

// ============================================================================
// Types
// ============================================================================

export interface RunnerEventEnvelope {
  type: string;
  payload: Record<string, unknown>;
}

export type SessionPermissionMode = "default" | "full-access";

export interface AgentSessionOptions {
  database: AppStore;
  sessionId: string;
  workspaceRoot: string;
  emit: (event: RunnerEventEnvelope) => void;
  resources: ResourceLoader;
  runtime: SessionRuntime;
  provider?: ProviderAdapter;
  settingsManager?: SettingsManager;
  evaluator?: PermissionEvaluator;
  permissionMode?: SessionPermissionMode;
  toolRuntimeContext?: ToolRuntimeContext;
}

interface ExecuteRunInput {
  session: Session;
  task: Task | null;
  run: Run;
  prompt: string;
  contextFiles: string[];
  images?: ImageContent[];
  providerConfig: ProviderConfig;
  historyEntryId: string | null;
  checkpointSummary: string | null;
  checkpointDetails: unknown | null;
}

type FailedRunInput = Pick<
  ExecuteRunInput,
  "session" | "task" | "run" | "prompt" | "historyEntryId"
>;

// ============================================================================
// AgentSession
// ============================================================================

export class AgentSession {
  private readonly provider: ProviderAdapter;
  private processingQueue = false;
  private readonly evaluatorOverride: PermissionEvaluator | null;
  private readonly denialTracker = new MemoryDenialTracker();
  private permissionMode: SessionPermissionMode;
  private workspaceRoot: string;

  /** Active run's abort controller for cancellation. */
  private activeAbortController: AbortController | null = null;
  /** Pending tool approval resolvers. */
  private readonly pendingApprovals = new Map<string, (decision: "approved" | "rejected") => void>();
  /** Pre-decisions made before the approval promise was created (handles race conditions). */
  private readonly preDecisions = new Map<string, "approved" | "rejected">();

  constructor(private readonly options: AgentSessionOptions) {
    this.provider = options.provider ?? createProviderAdapter();
    this.evaluatorOverride = options.evaluator ?? null;
    this.permissionMode = options.permissionMode ?? "default";
    this.workspaceRoot = options.workspaceRoot;
  }

  // ==========================================================================
  // Public API — Session Configuration
  // ==========================================================================

  setPermissionMode(mode: SessionPermissionMode): void {
    this.permissionMode = mode;
  }

  setWorkspaceRoot(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
  }

  // ==========================================================================
  // Public API — Run Lifecycle
  // ==========================================================================

  startRun(input: {
    prompt: string;
    contextFiles?: string[];
    providerConfig: ProviderConfig;
    taskId?: string | null;
  }): Run {
    const session = this.requireSession();
    const task = input.taskId ? this.options.database.getTask(input.taskId) : null;
    const run = this.options.database.createRun({
      sessionId: session.id,
      taskId: task?.id ?? null,
      status: "queued",
      provider: input.providerConfig.name,
      prompt: input.prompt,
      sourceRunId: null,
      recoveryMode: "start",
      originRunId: null,
      resumeFromCheckpoint: null,
      terminalReason: null,
    });
    const contextFiles = Array.isArray(input.contextFiles)
      ? [...new Set(input.contextFiles.map((e) => e.trim()).filter((e) => e.length > 0))]
      : [];
    this.options.runtime.enqueueRun({
      runId: run.id,
      prompt: input.prompt,
      ...(contextFiles.length > 0 ? { contextFiles } : {}),
      taskId: task?.id ?? null,
      providerConfigId: input.providerConfig.id,
      sourceRunId: null,
      mode: "start",
    });

    this.processQueue().catch((error) => {
      this.options.emit({
        type: "run.failed",
        payload: {
          runId: "",
          sessionId: this.options.sessionId,
          error: `Queue processing failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    });

    return run;
  }

  continueFromHistoryEntry(input: {
    prompt: string;
    providerConfig: ProviderConfig;
    taskId?: string | null;
    historyEntryId?: string | null;
    checkpointSummary?: string | null;
    checkpointDetails?: unknown | null;
  }): Run {
    const session = this.requireSession();
    const historyEntries = this.options.database.listSessionHistoryEntries?.(session.id) ?? [];
    if (input.historyEntryId && !historyEntries.some((e) => e.id === input.historyEntryId)) {
      throw new Error(`History entry ${input.historyEntryId} not found for session ${session.id}`);
    }

    let branchId: string | null = null;
    if (input.historyEntryId) {
      branchId = createId("branch");
      this.options.database.createBranch({
        id: branchId,
        sessionId: session.id,
        title: `continue-from-${input.historyEntryId.slice(0, 8)}`,
      });
      this.options.runtime.setActiveBranchId(branchId);
      this.options.database.setActiveBranchId(session.id, branchId);
    }

    const task = input.taskId ? this.options.database.getTask(input.taskId) : null;
    const run = this.options.database.createRun({
      sessionId: session.id,
      taskId: task?.id ?? null,
      status: "queued",
      provider: input.providerConfig.name,
      prompt: input.prompt,
      sourceRunId: null,
      recoveryMode: "start",
      originRunId: null,
      resumeFromCheckpoint: null,
      terminalReason: null,
    });
    this.options.runtime.enqueueRun({
      runId: run.id,
      prompt: input.prompt,
      taskId: task?.id ?? null,
      providerConfigId: input.providerConfig.id,
      sourceRunId: null,
      mode: "start",
      historyEntryId: input.historyEntryId ?? null,
      checkpointSummary: input.checkpointSummary ?? null,
      checkpointDetails: input.checkpointDetails ?? null,
    });

    this.processQueue().catch((error) => {
      this.options.emit({
        type: "run.failed",
        payload: {
          runId: "",
          sessionId: this.options.sessionId,
          error: `Queue processing failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    });

    return run;
  }

  retryRun(runId: string): Run {
    const originalRun = this.requireRun(runId);
    if (originalRun.status !== "failed" && originalRun.status !== "canceled") {
      throw new Error(`Run ${runId} is not retryable`);
    }

    const runtime = this.options.runtime.snapshot();
    const session = this.requireSession();
    const prompt = resolveRunPrompt(originalRun, runtime, session);
    if (!prompt) {
      throw new Error(`Cannot retry run ${runId} without a prompt`);
    }

    const task = originalRun.taskId ? this.options.database.getTask(originalRun.taskId) : null;
    const providerConfig = this.resolveProviderConfig();
    const originRunId = originalRun.originRunId ?? originalRun.id;
    const nextRun = this.options.database.createRun({
      sessionId: session.id,
      taskId: task?.id ?? null,
      status: "queued",
      provider: providerConfig.name,
      prompt,
      sourceRunId: originalRun.id,
      recoveryMode: "retry",
      originRunId,
      resumeFromCheckpoint: null,
      terminalReason: null,
    });

    this.options.runtime.enqueueRun({
      runId: nextRun.id,
      prompt,
      taskId: task?.id ?? null,
      providerConfigId: providerConfig.id,
      sourceRunId: originalRun.id,
      mode: "retry",
    });

    this.processQueue().catch((error) => {
      this.options.emit({
        type: "run.failed",
        payload: {
          runId: "",
          sessionId: this.options.sessionId,
          error: `Queue processing failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    });
    return nextRun;
  }

  resumeRun(runId: string): Run {
    const originalRun = this.requireRun(runId);
    if (originalRun.status !== "running" && originalRun.status !== "blocked") {
      throw new Error(`Run ${runId} is not resumable`);
    }

    const runtime = this.options.runtime.snapshot();
    const session = this.requireSession();
    const prompt = resolveRunPrompt(originalRun, runtime, session);
    if (!prompt) {
      throw new Error(`Cannot resume run ${runId} without a prompt`);
    }

    const task = originalRun.taskId ? this.options.database.getTask(originalRun.taskId) : null;
    const providerConfig = this.resolveProviderConfig();
    const originRunId = originalRun.originRunId ?? originalRun.id;
    const resumedRun = this.options.database.createRun({
      sessionId: session.id,
      taskId: task?.id ?? null,
      status: "queued",
      provider: providerConfig.name,
      prompt,
      sourceRunId: originalRun.id,
      recoveryMode: "resume",
      originRunId,
      resumeFromCheckpoint: null,
      terminalReason: null,
    });

    this.options.runtime.enqueueRun({
      runId: resumedRun.id,
      prompt,
      taskId: task?.id ?? null,
      providerConfigId: providerConfig.id,
      sourceRunId: originalRun.id,
      mode: "resume",
    });

    this.processQueue().catch((error) => {
      this.options.emit({
        type: "run.failed",
        payload: {
          runId: "",
          sessionId: this.options.sessionId,
          error: `Queue processing failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    });
    return resumedRun;
  }

  async compactSession(): Promise<{
    sessionId: string;
    runtime: ReturnType<SessionRuntime["snapshot"]>;
    summary: SessionCompactionSnapshot["summary"];
    compactedAt: string;
  }> {
    // SDK handles compaction internally. Manual compaction creates a
    // lightweight snapshot from the current runtime state.
    const session = this.requireSession();
    const compactedAt = nowIso();
    const runtime = this.options.runtime.snapshot();
    const summary: CompactionSummaryDocument = runtime.compaction.lastSummary ?? {
      version: 1,
      goal: "Session compaction handled by SDK runtime.",
      constraints: [],
      progress: { done: [], inProgress: [], blocked: [] },
      keyDecisions: [],
      nextSteps: [],
      criticalContext: [],
    };
    this.options.runtime.completeCompaction({ summary, compactedAt });
    return {
      sessionId: session.id,
      runtime: this.options.runtime.snapshot(),
      summary,
      compactedAt,
    };
  }

  cancelRun(runId: string): { runId: string; canceled: true } {
    const run = this.options.database.getRun(runId);
    if (!run) {
      return { runId, canceled: true };
    }

    this.provider.cancel(runId);
    this.activeAbortController?.abort();
    this.options.database.updateRun(runId, { status: "canceled", terminalReason: "canceled" });
    this.options.runtime.cancelRun(runId);
    this.persistPartialAssistantMessageFromEvents({ sessionId: run.sessionId, runId });
    this.rejectAllPendingApprovals();

    this.emitAndPersist(runId, run.sessionId, {
      type: "run.canceled",
      payload: { runId, sessionId: run.sessionId },
    });

    return { runId, canceled: true };
  }

  approveTool(toolCallId: string): { toolCallId: string; decision: "approved" } {
    const resolver = this.pendingApprovals.get(toolCallId);
    if (resolver) {
      resolver("approved");
      this.pendingApprovals.delete(toolCallId);
    } else {
      this.preDecisions.set(toolCallId, "approved");
    }
    // Also update runtime state
    const runtime = this.options.runtime.snapshot();
    if (runtime.activeRunId) {
      this.options.runtime.approveTool(runtime.activeRunId, toolCallId);
    }
    return { toolCallId, decision: "approved" };
  }

  rejectTool(toolCallId: string): { toolCallId: string; decision: "rejected" } {
    const resolver = this.pendingApprovals.get(toolCallId);
    if (resolver) {
      resolver("rejected");
      this.pendingApprovals.delete(toolCallId);
    } else {
      this.preDecisions.set(toolCallId, "rejected");
    }
    const runtime = this.options.runtime.snapshot();
    if (runtime.activeRunId) {
      this.options.runtime.rejectTool(runtime.activeRunId, toolCallId);
      this.cancelRun(runtime.activeRunId);
    }
    return { toolCallId, decision: "rejected" };
  }

  // ==========================================================================
  // Session Control
  // ==========================================================================

  async abort(): Promise<void> {
    const runtime = this.options.runtime.snapshot();
    if (runtime.activeRunId) {
      this.cancelRun(runtime.activeRunId);
    }
    while (this.options.runtime.snapshot().activeRunId) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  dispose(): void {
    const runtime = this.options.runtime.snapshot();
    if (runtime.activeRunId) {
      this.cancelRun(runtime.activeRunId);
    }
    this.processingQueue = false;
  }

  // ==========================================================================
  // Model Management
  // ==========================================================================

  setModel(modelId: string): void {
    const currentConfig = this.options.database.getProviderConfig();
    if (!currentConfig) {
      throw new Error("No provider config available");
    }
    this.options.database.upsertProviderConfig({
      id: currentConfig.id,
      name: currentConfig.name,
      protocol: currentConfig.protocol,
      baseUrl: currentConfig.baseUrl,
      apiKey: currentConfig.apiKey,
      model: modelId,
      url: currentConfig.url,
    });
    this.options.runtime.setSelectedProviderConfig(currentConfig.id);
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  getSessionStats(): {
    sessionId: string;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    totalMessages: number;
    runs: number;
  } {
    const session = this.requireSession();
    const messages = this.options.database.listMessages(session.id);
    const runs = this.options.database.listRuns(session.id);
    const toolCalls = runs.flatMap((run) => this.options.database.listToolCalls(run.id));
    return {
      sessionId: session.id,
      userMessages: messages.filter((m) => m.role === "user").length,
      assistantMessages: messages.filter((m) => m.role === "assistant").length,
      toolCalls: toolCalls.length,
      totalMessages: messages.length,
      runs: runs.length,
    };
  }

  // ==========================================================================
  // Prompting
  // ==========================================================================

  async prompt(
    text: string,
    options?: {
      taskId?: string | null;
      historyEntryId?: string | null;
      images?: ImageContent[];
    },
  ): Promise<Run> {
    const providerConfig = this.options.database.getProviderConfig();
    if (!providerConfig) {
      throw new Error("No provider config available for this session");
    }
    if (options?.historyEntryId) {
      return this.continueFromHistoryEntry({
        prompt: text,
        providerConfig,
        taskId: options.taskId,
        historyEntryId: options.historyEntryId,
      });
    }
    return this.startRun({ prompt: text, providerConfig, taskId: options?.taskId });
  }

  async fork(historyEntryId: string): Promise<{ newSessionId: string; selectedText: string }> {
    const session = this.requireSession();
    const historyEntries = this.options.database.listSessionHistoryEntries?.(session.id) ?? [];
    const entry = historyEntries.find((e) => e.id === historyEntryId);
    if (!entry) {
      throw new Error(`History entry ${historyEntryId} not found`);
    }
    const newSession = this.options.database.createSession(`Fork of ${session.title}`);
    return { newSessionId: newSession.id, selectedText: entry.summary ?? "" };
  }

  // ==========================================================================
  // Private — Queue Processing
  // ==========================================================================

  private async processQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    try {
      while (true) {
        const queuedRun = this.options.runtime.peekQueuedRun();
        if (!queuedRun) return;
        this.options.runtime.dequeueRun(queuedRun.runId);

        const run = this.options.database.getRun(queuedRun.runId);
        if (!run || run.status === "canceled") continue;

        const session = this.requireSession();
        const task = run.taskId ? this.options.database.getTask(run.taskId) : null;

        let providerConfig: ProviderConfig;
        try {
          providerConfig = this.resolveQueuedProviderConfig(queuedRun.providerConfigId);
        } catch (error) {
          await this.handleFailedRun(
            { session, task, run, prompt: queuedRun.prompt, historyEntryId: queuedRun.historyEntryId ?? null },
            error,
          );
          continue;
        }

        await this.executeRun({
          session,
          task,
          run,
          prompt: queuedRun.prompt,
          contextFiles: queuedRun.contextFiles ?? [],
          providerConfig,
          historyEntryId: queuedRun.historyEntryId ?? null,
          checkpointSummary: queuedRun.checkpointSummary ?? null,
          checkpointDetails: queuedRun.checkpointDetails ?? null,
        });
      }
    } finally {
      this.processingQueue = false;
    }
  }

  // ==========================================================================
  // Private — Run Execution (SDK-first: single provider.run() call)
  // ==========================================================================

  private async executeRun(input: ExecuteRunInput): Promise<void> {
    const { session, task, run, prompt, contextFiles, providerConfig, historyEntryId } = input;
    const abortController = new AbortController();
    this.activeAbortController = abortController;

    try {
      // 1. Update statuses
      this.options.database.updateRun(run.id, { status: "running" });
      this.options.database.updateSession(session.id, {
        status: nextSessionStatus(session.status, "run_started"),
      });
      this.options.runtime.beginRun(run.id, prompt);

      // 2. Emit run.started
      this.emitAndPersist(run.id, session.id, {
        type: "run.started",
        payload: { runId: run.id, sessionId: session.id, prompt },
      });

      // 2b. Write branch checkpoint if continuing from a history entry (BEFORE building history)
      let effectiveHistoryLeafId = historyEntryId;
      if (input.historyEntryId && input.checkpointSummary) {
        const branchId = this.getActiveBranchId(session.id);
        const parentEntry = this.options.database.getHistoryEntry(input.historyEntryId);
        const checkpointEntry = this.options.database.addSessionHistoryEntry?.({
          sessionId: session.id,
          parentId: input.historyEntryId,
          kind: "branch_summary",
          messageId: null,
          summary: input.checkpointSummary,
          details: input.checkpointDetails ?? null,
          branchId,
          lineageDepth: (parentEntry?.lineageDepth ?? -1) + 1,
          originRunId: run.id,
        });
        // Use the checkpoint as the leaf so its summary appears in the lineage
        if (checkpointEntry) {
          effectiveHistoryLeafId = checkpointEntry.id;
        }
      }

      // 3. Load resources and build system prompt
      await this.options.resources.reload();
      const resolvedSkill = await this.options.resources.resolveSkillForPrompt(prompt);
      const systemPrompt = this.options.resources.buildSystemPrompt(resolvedSkill, this.workspaceRoot);

      // Emit skills resolved
      if (resolvedSkill) {
        this.emitAndPersist(run.id, session.id, {
          type: "run.skills_resolved",
          payload: {
            runId: run.id,
            sessionId: session.id,
            skillName: resolvedSkill.skill.name,
            enabledToolNames: resolvedSkill.enabledToolNames,
          },
        });
      }

      // 4. Build history messages BEFORE persisting current prompt
      // (ensures current run's prompt is not included in history)
      const runtimeMessages = this.buildProviderHistoryMessages(session.id, effectiveHistoryLeafId);
      const historyMessages = convertRuntimeMessagesToLlm(runtimeMessages);

      // 5. Persist user message and update session latestUserMessage
      this.ensureUserPromptPersisted({ sessionId: session.id, runId: run.id, prompt, historyEntryId });
      this.options.database.updateSession(session.id, { latestUserMessage: prompt });

      // 6. Build tools
      const tools = Object.values(createAllTools(this.workspaceRoot));
      const enabledTools = listBuiltInToolNames();

      // 7. Build effective prompt (with context files)
      const effectivePrompt = buildEffectivePrompt(prompt, contextFiles, resolvedSkill);

      // 8. Determine tool execution mode
      const toolExecutionMode = resolveToolExecutionMode(enabledTools);

      // 9. Call provider — SDK handles the entire agentic loop
      let assistantText = "";

      const doRun = async () =>
        this.provider.run({
          runId: run.id,
          sessionId: session.id,
          workspaceRoot: this.workspaceRoot,
          prompt: effectivePrompt,
          historyMessages,
          systemPrompt,
          providerConfig,
          tools,
          enabledTools,
          toolExecutionMode,
          signal: abortController.signal,
          onTextDelta: (delta) => {
            assistantText += delta;
            this.emitAndPersist(run.id, session.id, {
              type: "run.delta",
              payload: { runId: run.id, sessionId: session.id, delta },
            });
          },
          onToolLifecycle: (event) =>
            this.handleToolLifecycle(event, run, session, task),
          onSdkMessage: (message) => {
            this.emitAndPersist(run.id, session.id, {
              type: `sdk.${(message as Record<string, unknown>).type ?? "message"}`,
              payload: { runId: run.id, sessionId: session.id, message: message as Record<string, unknown> },
            });
          },
        });

      const result = this.options.toolRuntimeContext
        ? await runWithToolRuntimeContext(this.options.toolRuntimeContext, doRun)
        : await doRun();

      // 10. Resolve final assistant text (prefer streamed deltas, fall back to result)
      const finalAssistantText = assistantText.trim() ? assistantText : (result.assistantText ?? "");
      if (finalAssistantText.trim()) {
        const branchId = this.getActiveBranchId(session.id);
        this.options.database.addMessage({
          sessionId: session.id,
          role: "assistant",
          content: finalAssistantText,
          branchId,
          originRunId: run.id,
        });
        this.options.database.updateSession(session.id, { latestAssistantMessage: finalAssistantText });
      }

      // 11. Finalize run
      const isError = result.error !== null;
      this.options.database.updateRun(run.id, {
        status: isError ? "failed" : "completed",
        terminalReason: isError ? result.error : "completed",
      });
      this.options.database.updateSession(session.id, {
        status: nextSessionStatus(session.status, isError ? "run_failed" : "run_completed"),
      });
      this.options.runtime.completeRun(run.id, finalAssistantText);

      // Update task status on completion
      if (task && !isError) {
        this.options.database.updateTask(task.id, {
          status: nextTaskStatus(task.status, "run_completed"),
        });
      }

      // 12. Emit completion
      this.emitAndPersist(run.id, session.id, {
        type: isError ? "run.failed" : "run.completed",
        payload: {
          runId: run.id,
          sessionId: session.id,
          ...(isError ? { error: result.error } : {}),
          usage: result.usage,
          stopReason: result.stopReason,
        },
      });

      // 13. Persist runtime snapshot
      this.persistRuntimeSnapshot(session.id);

      if (isError) {
        await this.handleFailedRun(input, new Error(result.error!));
      }
    } catch (error) {
      await this.handleFailedRun(input, error);
    } finally {
      this.activeAbortController = null;
      this.pendingApprovals.clear();
      this.preDecisions.clear();
    }
  }

  // ==========================================================================
  // Private — Tool Lifecycle (Permission + Approval + Persistence)
  // ==========================================================================

  private async handleToolLifecycle(
    event: ProviderToolLifecycleEvent,
    run: Run,
    session: Session,
    task: Task | null,
  ): Promise<ProviderToolLifecycleControl> {
    if (event.stage === "requested") {
      return this.onToolRequested(event, run, session, task);
    }

    if (event.stage === "approval_requested") {
      return this.onToolApprovalRequested(event, run, session);
    }

    if (event.stage === "started") {
      this.emitAndPersist(run.id, session.id, {
        type: "run.tool_started",
        payload: { runId: run.id, sessionId: session.id, toolCallId: event.toolCallId, toolName: event.toolName },
      });
      return {};
    }

    if (event.stage === "progress") {
      this.emitAndPersist(run.id, session.id, {
        type: "run.tool_progress",
        payload: { runId: run.id, sessionId: session.id, toolCallId: event.toolCallId, toolName: event.toolName },
      });
      return {};
    }

    if (event.stage === "finished") {
      this.options.database.updateToolCall(event.toolCallId, {
        output: event.output ?? null,
        error: null,
      });
      this.emitAndPersist(run.id, session.id, {
        type: "run.tool_finished",
        payload: {
          runId: run.id,
          sessionId: session.id,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          output: event.output,
        },
      });
      return {};
    }

    if (event.stage === "failed") {
      this.options.database.updateToolCall(event.toolCallId, {
        output: null,
        error: event.error ?? "Unknown tool error",
      });
      this.emitAndPersist(run.id, session.id, {
        type: "run.tool_failed",
        payload: {
          runId: run.id,
          sessionId: session.id,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          error: event.error,
        },
      });
      return {};
    }

    return {};
  }

  private onToolRequested(
    event: ProviderToolLifecycleEvent,
    run: Run,
    session: Session,
    task: Task | null,
  ): ProviderToolLifecycleControl {
    // Full-access mode: allow everything
    if (this.permissionMode === "full-access") {
      this.persistToolCall(event, run, session, task, "not_required");
      this.emitAndPersist(run.id, session.id, {
        type: "run.tool_requested",
        payload: {
          runId: run.id, sessionId: session.id,
          toolCallId: event.toolCallId, toolName: event.toolName,
          input: event.input, requiresApproval: false,
        },
      });
      return { allowExecution: true, requiresApproval: false };
    }

    // Evaluate permissions
    const evaluator =
      this.evaluatorOverride ??
      createPermissionEvaluator().withDenialTracker(this.denialTracker).build();
    const context: PermissionContext = {
      toolName: event.toolName,
      input: event.input,
      planMode: false,
      sessionId: session.id,
    };
    const result = evaluator.preflightCheck(context);

    if (result.decision === "deny") {
      this.persistToolCall(event, run, session, task, "rejected");
      return {
        allowExecution: false,
        error: result.reason ?? `Tool '${event.toolName}' denied by permission policy.`,
      };
    }

    if (result.decision === "ask") {
      this.persistToolCall(event, run, session, task, "pending");
      this.emitAndPersist(run.id, session.id, {
        type: "run.tool_requested",
        payload: {
          runId: run.id, sessionId: session.id,
          toolCallId: event.toolCallId, toolName: event.toolName,
          input: event.input, requiresApproval: true,
        },
      });
      return { allowExecution: true, requiresApproval: true };
    }

    // allow
    this.persistToolCall(event, run, session, task, "not_required");
    this.emitAndPersist(run.id, session.id, {
      type: "run.tool_requested",
      payload: {
        runId: run.id, sessionId: session.id,
        toolCallId: event.toolCallId, toolName: event.toolName,
        input: event.input, requiresApproval: false,
      },
    });
    return { allowExecution: true, requiresApproval: false };
  }

  private async onToolApprovalRequested(
    event: ProviderToolLifecycleEvent,
    run: Run,
    session: Session,
  ): Promise<ProviderToolLifecycleControl> {
    // Block the run and wait for user decision
    this.options.runtime.blockOnTool(run.id, event.toolCallId);
    this.options.database.updateSession(session.id, {
      status: nextSessionStatus(session.status, "tool_blocked"),
    });

    this.emitAndPersist(run.id, session.id, {
      type: "run.blocked",
      payload: {
        runId: run.id,
        sessionId: session.id,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
      },
    });

    // Check for pre-decisions (approval/rejection that arrived before the promise was created)
    const preDecision = this.preDecisions.get(event.toolCallId);
    const decision = preDecision
      ? (this.preDecisions.delete(event.toolCallId), preDecision)
      : await new Promise<"approved" | "rejected">((resolve) => {
          this.pendingApprovals.set(event.toolCallId, resolve);
        });

    // Update DB and runtime
    this.options.database.updateToolCall(event.toolCallId, {
      approvalState: decision,
    });

    // Update runtime state (clears blockedToolCallId and pendingApprovalToolCallIds)
    if (decision === "approved") {
      this.options.runtime.approveTool(run.id, event.toolCallId);
    } else {
      this.options.runtime.rejectTool(run.id, event.toolCallId);
    }

    this.emitAndPersist(run.id, session.id, {
      type: "run.tool_decided",
      payload: {
        runId: run.id,
        sessionId: session.id,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        decision,
      },
    });

    if (decision === "approved") {
      this.options.database.updateSession(session.id, {
        status: nextSessionStatus(session.status, "resume"),
      });
    }

    return { decision };
  }

  private persistToolCall(
    event: ProviderToolLifecycleEvent,
    run: Run,
    session: Session,
    task: Task | null,
    approvalState: ToolCall["approvalState"],
  ): void {
    this.options.database.createToolCall({
      id: event.toolCallId,
      runId: run.id,
      sessionId: session.id,
      taskId: task?.id ?? null,
      toolName: event.toolName,
      approvalState,
      input: event.input,
      output: null,
      error: null,
    });
  }

  // ==========================================================================
  // Private — Failure Handling
  // ==========================================================================

  private async handleFailedRun(input: FailedRunInput, error: unknown): Promise<void> {
    const { run, session } = input;
    const canceled = this.options.database.getRun(run.id)?.status === "canceled";
    const message = error instanceof Error ? error.message : String(error);

    this.options.database.updateRun(run.id, {
      status: canceled ? "canceled" : "failed",
      terminalReason: canceled ? "canceled" : message,
    });
    this.options.database.updateSession(session.id, {
      status: nextSessionStatus(session.status, canceled ? "run_canceled" : "run_failed"),
    });

    this.ensureUserPromptPersisted({
      sessionId: session.id,
      runId: run.id,
      prompt: input.prompt,
      historyEntryId: input.historyEntryId,
    });
    this.persistPartialAssistantMessageFromEvents({ sessionId: session.id, runId: run.id });

    this.options.runtime.failRun(run.id);

    this.emitAndPersist(run.id, session.id, {
      type: canceled ? "run.canceled" : "run.failed",
      payload: canceled
        ? { runId: run.id, sessionId: session.id }
        : { runId: run.id, sessionId: session.id, error: message },
    });

    if (!canceled) {
      this.options.database.createReviewRequest({
        runId: run.id,
        taskId: input.task?.id ?? null,
        toolCallId: null,
        kind: "final_review",
        status: "pending",
        title: "Run failed",
        detail: message,
      });
    }
  }

  // ==========================================================================
  // Private — Helpers
  // ==========================================================================

  private requireSession(): Session {
    const session = this.options.database.getSession(this.options.sessionId);
    if (!session) throw new Error(`Session ${this.options.sessionId} not found`);
    return session;
  }

  private requireRun(runId: string): Run {
    const run = this.options.database.getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    return run;
  }

  private resolveProviderConfig(): ProviderConfig {
    const config = this.options.database.getProviderConfig();
    if (!config) throw new Error("No provider config available for this session");
    return config;
  }

  private resolveQueuedProviderConfig(providerConfigId: string | null): ProviderConfig {
    if (providerConfigId) {
      const selected = this.options.database.getProviderConfig(providerConfigId);
      if (selected) return selected;
    }
    return this.resolveProviderConfig();
  }

  private getActiveBranchId(sessionId: string): string | null {
    return (
      this.options.database.getActiveBranchId(sessionId) ??
      this.options.database.listBranches(sessionId).at(-1)?.id ??
      null
    );
  }

  private buildProviderHistoryMessages(
    sessionId: string,
    branchLeafEntryId: string | null = null,
  ): RuntimeMessage[] {
    const historyEntries = this.options.database.listSessionHistoryEntries?.(sessionId) ?? [];
    return buildSessionRuntimeMessages({
      messages: this.options.database.listMessages(sessionId),
      toolCalls: this.listSessionToolCalls(sessionId),
      compaction: this.buildRuntimeCompactionSnapshot(),
      historyEntries,
      branchLeafEntryId,
    });
  }

  private listSessionToolCalls(sessionId: string): ToolCall[] {
    const runs = this.options.database.listRuns(sessionId);
    return runs.flatMap((run) => this.options.database.listToolCalls(run.id));
  }

  private buildRuntimeCompactionSnapshot(): SessionCompactionSnapshot | null {
    const compaction = this.options.runtime.snapshot().compaction;
    const summary = compaction.lastSummary;
    if (!summary) return null;
    return {
      version: 1,
      summary,
      compactedAt: compaction.lastCompactedAt ?? nowIso(),
      firstKeptHistoryEntryId: null,
      firstKeptTimestamp: null,
      tokensBefore: 0,
      tokensKept: 0,
    };
  }

  private persistRuntimeSnapshot(sessionId: string): void {
    const state = this.options.runtime.snapshot();
    this.options.database.saveSessionRuntimeSnapshot({
      sessionId,
      snapshot: JSON.stringify(state),
      updatedAt: nowIso(),
    });
  }

  private ensureUserPromptPersisted(input: {
    sessionId: string;
    runId: string;
    prompt: string;
    historyEntryId: string | null;
  }): void {
    if (this.hasRunMessage(input.sessionId, input.runId, "user", input.prompt)) return;
    const branchId = this.getActiveBranchId(input.sessionId);
    this.options.database.addMessage({
      sessionId: input.sessionId,
      role: "user",
      content: input.prompt,
      parentHistoryEntryId: input.historyEntryId,
      branchId,
      originRunId: input.runId,
    });
  }

  private persistPartialAssistantMessageFromEvents(input: { sessionId: string; runId: string }): void {
    if (this.hasRunMessage(input.sessionId, input.runId, "assistant")) return;
    const partialText = this.collectRunDeltaText(input.runId);
    if (!partialText.trim()) return;
    const branchId = this.getActiveBranchId(input.sessionId);
    this.options.database.addMessage({
      sessionId: input.sessionId,
      role: "assistant",
      content: partialText,
      branchId,
      originRunId: input.runId,
    });
    this.options.database.updateSession(input.sessionId, { latestAssistantMessage: partialText });
  }

  private hasRunMessage(
    sessionId: string,
    runId: string,
    role: "user" | "assistant" | "system" | "tool",
    expectedContent?: string,
  ): boolean {
    const runMessageIds = this.listRunMessageIds(sessionId, runId);
    if (runMessageIds.size === 0) return false;
    const messages = this.options.database.listMessages(sessionId);
    return messages.some((msg) => {
      if (!runMessageIds.has(msg.id) || msg.role !== role) return false;
      if (typeof expectedContent === "string") return msg.content === expectedContent;
      return true;
    });
  }

  private listRunMessageIds(sessionId: string, runId: string): Set<string> {
    const historyEntries = this.options.database.listSessionHistoryEntries?.(sessionId) ?? [];
    return new Set(
      historyEntries
        .filter((e) => e.kind === "message" && e.originRunId === runId && Boolean(e.messageId))
        .map((e) => e.messageId as string),
    );
  }

  private collectRunDeltaText(runId: string): string {
    return [...this.options.database.listEvents(runId)]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .filter((e) => e.type === "run.delta")
      .map((e) => (typeof e.payload.delta === "string" ? e.payload.delta : ""))
      .join("");
  }

  private emitAndPersist(runId: string, sessionId: string, envelope: RunnerEventEnvelope): void {
    this.options.database.addEvent({
      runId,
      sessionId,
      type: envelope.type,
      payload: envelope.payload,
    });
    this.options.emit(envelope);
  }

  private rejectAllPendingApprovals(): void {
    for (const [, resolver] of this.pendingApprovals) {
      resolver("rejected");
    }
    this.pendingApprovals.clear();
  }
}

// ============================================================================
// Standalone Helpers
// ============================================================================

function resolveRunPrompt(
  run: Run,
  runtime: ReturnType<SessionRuntime["snapshot"]>,
  session: Session,
): string | null {
  const candidate = run.prompt ?? runtime.lastUserPrompt ?? session.latestUserMessage;
  if (!candidate) return null;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nextSessionStatus(
  current: Session["status"],
  event: "run_started" | "tool_blocked" | "run_completed" | "run_failed" | "run_canceled" | "resume",
): Session["status"] {
  switch (event) {
    case "run_started":
      return "running";
    case "tool_blocked":
      return "blocked";
    case "run_completed":
      return "completed";
    case "run_failed":
      return "failed";
    case "run_canceled":
      return "canceled";
    case "resume":
      return current === "blocked" ? "running" : current;
  }
}

function nextTaskStatus(current: Task["status"], event: "run_completed"): Task["status"] {
  if (event === "run_completed") {
    return current === "active" ? "review" : current;
  }
  return current;
}

function buildEffectivePrompt(
  prompt: string,
  contextFiles: string[],
  resolvedSkill: ResolvedSkill | null,
): string {
  const parts: string[] = [];

  if (resolvedSkill?.injectedPrompt) {
    parts.push(resolvedSkill.injectedPrompt);
  }

  parts.push(prompt);

  if (contextFiles.length > 0) {
    parts.push(
      "\n\nContext files:\n" + contextFiles.map((f) => `- ${f}`).join("\n"),
    );
  }

  return parts.join("\n\n");
}

function resolveToolExecutionMode(enabledTools: string[]): "sequential" | "parallel" {
  const allSafe = enabledTools.every((name) => SAFE_TOOL_NAMES.has(name));
  return allSafe ? "parallel" : "sequential";
}
