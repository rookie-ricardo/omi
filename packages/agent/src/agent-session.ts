import type {
  ProviderConfig,
  ResolvedSkill,
  Run,
  Session,
  SkillMatch,
  Task,
  ToolCall,
} from "@omi/core";
import type { AppStore } from "@omi/store";
import type { ImageContent } from "@mariozechner/pi-ai";

import { createId, nowIso } from "@omi/core";
import { ExtensionRunner } from "@omi/extensions";
import {
  buildCompactionPlan,
  generateCompactionSummary,
  type CompactionSummaryGenerator,
  type CompactionMode,
} from "@omi/memory";
import { createModelFromConfig } from "@omi/provider";
import {
  buildSessionRuntimeMessages,
  buildSessionRuntimeMessageEnvelopes,
  renderRuntimeMessagesForPrompt,
  type RuntimeMessage,
  type SessionCompactionSnapshot,
  type SessionRuntimeMessageEnvelope,
  sessionCompactionSnapshotSchema,
} from "@omi/memory";
import {
  createProviderAdapter,
  type ProviderAdapter,
  type ProviderRunResult,
} from "@omi/provider";
import {
  runWithToolRuntimeContext,
  type ToolRuntimeContext,
} from "@omi/tools";

import type { ResourceLoader } from "./resource-loader";
import type { SessionRuntime } from "./session-manager";
import type { SettingsManager } from "@omi/settings";
import {
  type PermissionEvaluator,
  MemoryDenialTracker,
  createPermissionEvaluator,
} from "./permissions";

// Import QueryEngine for state machine-based execution
import {
  QueryEngine,
  type QueryEngineEvent,
  type QueryEngineRunInput,
  type QueryEngineResult,
  nextSessionStatus as queryNextSessionStatus,
  nextTaskStatus as queryNextTaskStatus,
} from "./query-engine";
import {
  createResumeLineage,
  createRetryLineage,
} from "./recovery";

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
  compactionSummarizer?: CompactionSummaryGenerator;
  settingsManager?: SettingsManager;
  /** Permission evaluator for rule-based access control. */
  evaluator?: PermissionEvaluator;
  permissionMode?: SessionPermissionMode;
  /** Optional per-run tool runtime context (MCP/SubAgent/Task). */
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

function normalizeRunnerPayload(event: QueryEngineEvent): Record<string, unknown> {
  if ("payload" in event && typeof event.payload === "object" && event.payload !== null) {
    return event.payload as Record<string, unknown>;
  }
  const { type: _type, ...rest } = event as unknown as Record<string, unknown>;
  return rest;
}

export class AgentSession {
  private readonly provider: ProviderAdapter;
  private processingQueue = false;
  private readonly evaluatorOverride: PermissionEvaluator | null;
  private readonly denialTracker = new MemoryDenialTracker();
  private activeQueryEngine: QueryEngine | null = null;
  private permissionMode: SessionPermissionMode;
  private workspaceRoot: string;

  constructor(private readonly options: AgentSessionOptions) {
    this.provider = options.provider ?? createProviderAdapter();
    this.evaluatorOverride = options.evaluator ?? null;
    this.permissionMode = options.permissionMode ?? "default";
    this.workspaceRoot = options.workspaceRoot;
  }

  setPermissionMode(mode: SessionPermissionMode): void {
    this.permissionMode = mode;
  }

  setWorkspaceRoot(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
  }

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
      provider: input.providerConfig.type,
      prompt: input.prompt,
      sourceRunId: null,
      recoveryMode: "start",
      originRunId: null,
      resumeFromCheckpoint: null,
      terminalReason: null,
    });
    const contextFiles = Array.isArray(input.contextFiles)
      ? [...new Set(input.contextFiles.map((entry) => entry.trim()).filter((entry) => entry.length > 0))]
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
        const message = error instanceof Error ? error.message : String(error);
        this.options.emit({
            type: "run.failed",
            payload: { runId: "", sessionId: this.options.sessionId, error: `Queue processing failed: ${message}` },
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
    if (input.historyEntryId && !historyEntries.some((entry) => entry.id === input.historyEntryId)) {
      throw new Error(`History entry ${input.historyEntryId} not found for session ${session.id}`);
    }
    if (input.checkpointSummary !== null && input.checkpointSummary !== undefined && !this.options.database.addSessionHistoryEntry) {
      throw new Error(`Session history storage is not available for session ${session.id}`);
    }

    // When continuing from a history entry, create a new branch to avoid
    // polluting the original branch's history.
    let branchId: string | null = null;
    if (input.historyEntryId) {
      const targetEntry = historyEntries.find((e) => e.id === input.historyEntryId);
      const parentBranch = targetEntry?.branchId
        ? this.options.database.getBranch(targetEntry.branchId)
        : null;

      branchId = createId("branch");
      this.options.database.createBranch({
        id: branchId,
        sessionId: session.id,
        headEntryId: input.historyEntryId,
        title: `continue-from-${input.historyEntryId.slice(0, 8)}`,
      });

      // Update the active branch in runtime snapshot so future messages
      // are associated with the new branch.
      this.options.runtime.setActiveBranchId(branchId);
      this.options.database.setActiveBranchId(session.id, branchId);
    }

    const task = input.taskId ? this.options.database.getTask(input.taskId) : null;
    const run = this.options.database.createRun({
      sessionId: session.id,
      taskId: task?.id ?? null,
      status: "queued",
      provider: input.providerConfig.type,
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
        const message = error instanceof Error ? error.message : String(error);
        this.options.emit({
            type: "run.failed",
            payload: { runId: "", sessionId: this.options.sessionId, error: `Queue processing failed: ${message}` },
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
    const retryLineage = createRetryLineage(
      originalRun,
      this.options.database.getLatestCheckpoint(originalRun.id)?.id ?? null,
    );
    const nextRun = this.options.database.createRun({
      sessionId: session.id,
      taskId: task?.id ?? null,
      status: "queued",
      provider: providerConfig.type,
      prompt,
      sourceRunId: originalRun.id,
      recoveryMode: "retry",
      originRunId: retryLineage.originRunId,
      resumeFromCheckpoint: retryLineage.resumeFromCheckpoint,
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
        const message = error instanceof Error ? error.message : String(error);
        this.options.emit({
            type: "run.failed",
            payload: { runId: "", sessionId: this.options.sessionId, error: `Queue processing failed: ${message}` },
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
    const resumeLineage = createResumeLineage(
      originalRun,
      this.options.database.getLatestCheckpoint(originalRun.id)?.id ?? null,
    );
    const resumedRun = this.options.database.createRun({
      sessionId: session.id,
      taskId: task?.id ?? null,
      status: "queued",
      provider: providerConfig.type,
      prompt,
      sourceRunId: originalRun.id,
      recoveryMode: "resume",
      originRunId: resumeLineage.originRunId,
      resumeFromCheckpoint: resumeLineage.resumeFromCheckpoint,
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
        const message = error instanceof Error ? error.message : String(error);
        this.options.emit({
            type: "run.failed",
            payload: { runId: "", sessionId: this.options.sessionId, error: `Queue processing failed: ${message}` },
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
    const session = this.requireSession();
    const providerConfig = this.resolveProviderConfig();

    this.options.runtime.requestCompaction("manual");

    try {
      const compacted = await this.compactHistoricalContext({
        session,
        providerConfig,
        mode: "manual",
        prompt: null,
        historyEnvelopes: this.buildHistoricalRuntimeMessageEnvelopes(session.id),
      });

      if (!compacted) {
        throw new Error("No history available to compact.");
      }

      this.options.runtime.completeCompaction({
        summary: compacted.summary,
        compactedAt: compacted.compactedAt,
      });

      return {
        sessionId: session.id,
        runtime: this.options.runtime.snapshot(),
        summary: compacted.summary,
        compactedAt: compacted.compactedAt,
      };
    } catch (error) {
      this.options.runtime.failCompaction(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  cancelRun(runId: string): { runId: string; canceled: true } {
    const run = this.options.database.getRun(runId);
    if (!run) {
      return { runId, canceled: true };
    }

    this.provider.cancel(runId);
    this.activeQueryEngine?.cancel();
    this.options.database.updateRun(runId, { status: "canceled", terminalReason: "canceled" });
    this.options.runtime.cancelRun(runId);
    this.persistPartialAssistantMessageFromEvents({
      sessionId: run.sessionId,
      runId,
    });

    this.emitAndPersist(runId, run.sessionId, {
      type: "run.canceled",
      payload: {
        runId,
        sessionId: run.sessionId,
      },
    });

    return { runId, canceled: true };
  }

  approveTool(toolCallId: string): { toolCallId: string; decision: "approved" } {
    this.activeQueryEngine?.approveTool(toolCallId);
    return { toolCallId, decision: "approved" };
  }

  rejectTool(toolCallId: string): { toolCallId: string; decision: "rejected" } {
    this.activeQueryEngine?.rejectTool(toolCallId);
    return { toolCallId, decision: "rejected" };
  }

  private async processQueue(): Promise<void> {
    if (this.processingQueue) {
      return;
    }

    this.processingQueue = true;
    try {
      while (true) {
        const queuedRun = this.options.runtime.peekQueuedRun();
        if (!queuedRun) {
          return;
        }
        this.options.runtime.dequeueRun(queuedRun.runId);

        const run = this.options.database.getRun(queuedRun.runId);
        if (!run) {
          continue;
        }

        if (run.status === "canceled") {
          continue;
        }

        const session = this.requireSession();
        const task = run.taskId ? this.options.database.getTask(run.taskId) : null;
        let providerConfig: ProviderConfig;
        try {
          providerConfig = this.resolveQueuedProviderConfig(queuedRun.providerConfigId);
        } catch (error) {
          await this.handleFailedRun(
            {
              session,
              task,
              run,
              prompt: queuedRun.prompt,
              historyEntryId: queuedRun.historyEntryId ?? null,
            },
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

  private requireSession(): Session {
    const session = this.options.database.getSession(this.options.sessionId);
    if (!session) {
      throw new Error(`Session ${this.options.sessionId} not found`);
    }
    return session;
  }

  private requireRun(runId: string): Run {
    const run = this.options.database.getRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }
    return run;
  }

  private resolveProviderConfig(): ProviderConfig {
    const providerConfig = this.options.database.getProviderConfig();
    if (!providerConfig) {
      throw new Error("No provider config available for this session");
    }

    return providerConfig;
  }

  private resolveQueuedProviderConfig(providerConfigId: string | null): ProviderConfig {
    if (providerConfigId) {
      const selected = this.options.database.getProviderConfig(providerConfigId);
      if (selected) {
        return selected;
      }
    }

    return this.resolveProviderConfig();
  }

  private async executeRun(input: ExecuteRunInput): Promise<void> {
    // Create QueryEngine with all dependencies
    const queryEngine = new QueryEngine({
      database: this.options.database,
      sessionId: this.options.sessionId,
      workspaceRoot: this.workspaceRoot,
      emit: (event) =>
        this.emitAndPersist(input.run.id, input.session.id, {
          type: event.type,
          payload: normalizeRunnerPayload(event),
        }),
      resources: this.options.resources,
      runtime: this.options.runtime,
      provider: this.provider,
      compactionSummarizer: this.options.compactionSummarizer,
      settingsManager: this.options.settingsManager,
      evaluator:
        this.evaluatorOverride ??
        createPermissionEvaluator().withDenialTracker(this.denialTracker).build(),
      denialTracker: this.denialTracker,
      permissionMode: this.permissionMode,
    });

    this.activeQueryEngine = queryEngine;

    try {
      const executeLoop = () =>
        queryEngine.execute({
          session: input.session,
          task: input.task,
          run: input.run,
          prompt: input.prompt,
          contextFiles: input.contextFiles,
          images: input.images,
          providerConfig: input.providerConfig,
          historyEntryId: input.historyEntryId,
          checkpointSummary: input.checkpointSummary,
          checkpointDetails: input.checkpointDetails,
        });

      const result = this.options.toolRuntimeContext
        ? await runWithToolRuntimeContext(this.options.toolRuntimeContext, executeLoop)
        : await executeLoop();

      // Handle non-terminal-success cases
      if (result.terminalReason !== "completed") {
        await this.handleFailedRun(input, new Error(result.error ?? result.terminalReason));
      }
    } catch (error) {
      await this.handleFailedRun(input, error);
    } finally {
      this.activeQueryEngine = null;
    }
  }

  private async handleFailedRun(input: FailedRunInput, error: unknown): Promise<void> {
    const runId = input.run.id;
    const sessionId = input.session.id;

    const canceled = this.options.database.getRun(runId)?.status === "canceled";
    const message = error instanceof Error ? error.message : String(error);

    this.options.database.updateRun(runId, {
      status: canceled ? "canceled" : "failed",
      terminalReason: canceled ? "canceled" : message,
    });

    this.options.database.updateSession(sessionId, {
      status: nextSessionStatus(input.session.status, canceled ? "run_canceled" : "run_failed"),
    });
    this.ensureUserPromptPersisted({
      sessionId,
      runId,
      prompt: input.prompt,
      historyEntryId: input.historyEntryId,
    });
    this.persistPartialAssistantMessageFromEvents({
      sessionId,
      runId,
    });

    this.options.runtime.failRun(runId);

    this.emitAndPersist(runId, sessionId, {
      type: canceled ? "run.canceled" : "run.failed",
      payload: canceled
        ? {
            runId,
            sessionId,
          }
        : {
            runId,
            sessionId,
            error: message,
          },
    });

    if (!canceled) {
      this.options.database.createReviewRequest({
        runId,
        taskId: input.task?.id ?? null,
        toolCallId: null,
        kind: "final_review",
        status: "pending",
        title: "Run failed",
        detail: message,
      });
    }
  }

  private ensureUserPromptPersisted(input: {
    sessionId: string;
    runId: string;
    prompt: string;
    historyEntryId: string | null;
  }): void {
    if (this.hasRunMessage(input.sessionId, input.runId, "user", input.prompt)) {
      return;
    }

    const branchId =
      this.options.database.getActiveBranchId(input.sessionId) ??
      this.options.database.listBranches(input.sessionId).at(-1)?.id ??
      null;
    this.options.database.addMessage({
      sessionId: input.sessionId,
      role: "user",
      content: input.prompt,
      parentHistoryEntryId: input.historyEntryId,
      branchId,
      originRunId: input.runId,
    });
  }

  private persistPartialAssistantMessageFromEvents(input: {
    sessionId: string;
    runId: string;
  }): void {
    if (this.hasRunMessage(input.sessionId, input.runId, "assistant")) {
      return;
    }

    const partialAssistantText = this.collectRunDeltaText(input.runId);
    if (!partialAssistantText.trim()) {
      return;
    }

    const branchId =
      this.options.database.getActiveBranchId(input.sessionId) ??
      this.options.database.listBranches(input.sessionId).at(-1)?.id ??
      null;
    this.options.database.addMessage({
      sessionId: input.sessionId,
      role: "assistant",
      content: partialAssistantText,
      branchId,
      originRunId: input.runId,
    });
    this.options.database.updateSession(input.sessionId, {
      latestAssistantMessage: partialAssistantText,
    });
  }

  private hasRunMessage(
    sessionId: string,
    runId: string,
    role: "user" | "assistant" | "system" | "tool",
    expectedContent?: string,
  ): boolean {
    const runMessageIds = this.listRunMessageIds(sessionId, runId);
    if (runMessageIds.size === 0) {
      return false;
    }

    const messages = this.options.database.listMessages(sessionId);
    return messages.some((message) => {
      if (!runMessageIds.has(message.id) || message.role !== role) {
        return false;
      }
      if (typeof expectedContent === "string") {
        return message.content === expectedContent;
      }
      return true;
    });
  }

  private listRunMessageIds(sessionId: string, runId: string): Set<string> {
    const historyEntries = this.options.database.listSessionHistoryEntries?.(sessionId) ?? [];
    return new Set(
      historyEntries
        .filter(
          (entry) =>
            entry.kind === "message" &&
            entry.originRunId === runId &&
            Boolean(entry.messageId),
        )
        .map((entry) => entry.messageId as string),
    );
  }

  private collectRunDeltaText(runId: string): string {
    const orderedEvents = [...this.options.database.listEvents(runId)].sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
    return orderedEvents
      .filter((event) => event.type === "run.delta")
      .map((event) => (typeof event.payload.delta === "string" ? event.payload.delta : ""))
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

  private buildHistoricalRuntimeMessages(
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

  private buildHistoricalRuntimeMessageEnvelopes(
    sessionId: string,
    branchLeafEntryId: string | null = null,
  ): SessionRuntimeMessageEnvelope[] {
    const historyEntries = this.options.database.listSessionHistoryEntries?.(sessionId) ?? [];
    return buildSessionRuntimeMessageEnvelopes({
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

  private async compactHistoricalContext(input: {
    session: Session;
    providerConfig: ProviderConfig;
    mode: CompactionMode;
    prompt: string | null;
    historyEnvelopes: SessionRuntimeMessageEnvelope[];
  }): Promise<SessionCompactionSnapshot | null> {
    const model = createModelFromConfig(input.providerConfig);
    const plan = buildCompactionPlan(input.historyEnvelopes, model.contextWindow, input.mode);

    if (!plan) {
      return null;
    }

    const summary = await generateCompactionSummary(
      {
        sessionId: input.session.id,
        providerConfig: input.providerConfig,
        mode: input.mode,
        tokensBefore: plan.tokensBefore,
        tokensKept: plan.tokensKept,
        keepRecentTokens: plan.keepRecentTokens,
        summaryMessages: plan.summaryMessages,
        keptMessages: plan.keptMessages,
      },
      this.options.compactionSummarizer,
    );

    const snapshot = sessionCompactionSnapshotSchema.parse({
      version: 1,
      summary,
      compactedAt: nowIso(),
      firstKeptHistoryEntryId: plan.firstKeptHistoryEntryId,
      firstKeptTimestamp: plan.firstKeptTimestamp,
      tokensBefore: plan.tokensBefore,
      tokensKept: plan.tokensKept,
    });

    this.options.runtime.completeCompaction({
      summary: snapshot.summary,
      compactedAt: snapshot.compactedAt,
    });

    if (this.options.database.addSessionHistoryEntry) {
      const branchId =
        this.options.database.getActiveBranchId(input.session.id) ??
        this.options.database.listBranches(input.session.id).at(-1)?.id ??
        null;
      const parentHistoryEntry =
        branchId
          ? this.options.database.getBranchHistory(input.session.id, branchId).at(-1) ?? null
          : this.options.database.listSessionHistoryEntries?.(input.session.id).at(-1) ?? null;
      const details = {
        mode: input.mode,
        prompt: input.prompt,
        cutoffIndex: plan.cutoffIndex,
        tokensBefore: plan.tokensBefore,
        tokensKept: plan.tokensKept,
        keepRecentTokens: plan.keepRecentTokens,
      };

      this.options.database.addSessionHistoryEntry({
        sessionId: input.session.id,
        parentId: parentHistoryEntry?.id ?? null,
        kind: "branch_summary",
        messageId: null,
        summary: snapshot.summary.goal,
        details: normalizeHistoryDetails(details),
        branchId,
        lineageDepth: parentHistoryEntry ? parentHistoryEntry.lineageDepth + 1 : 0,
        originRunId: null,
      });
    }

    return snapshot;
  }

  private buildRuntimeCompactionSnapshot(): SessionCompactionSnapshot | null {
    const compaction = this.options.runtime.snapshot().compaction;
    const summary = compaction.lastSummary;
    if (!summary) {
      return null;
    }

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

  // =========================================================================
  // Session Control Methods
  // =========================================================================

  /**
   * Abort the current active run and wait for the agent to become idle.
   */
  async abort(): Promise<void> {
    const runtime = this.options.runtime.snapshot();
    if (runtime.activeRunId) {
      this.cancelRun(runtime.activeRunId);
    }
    // Wait for any pending runs to complete
    while (this.options.runtime.snapshot().activeRunId) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Dispose of the session and clean up resources.
   * Call this when completely done with the session.
   */
  dispose(): void {
    // Cancel any active run
    const runtime = this.options.runtime.snapshot();
    if (runtime.activeRunId) {
      this.cancelRun(runtime.activeRunId);
    }
    this.processingQueue = false;
  }

  // =========================================================================
  // Model Management
  // =========================================================================

  /**
   * Set the model for future runs.
   * Updates the provider configuration.
   */
  setModel(modelId: string): void {
    const currentConfig = this.options.database.getProviderConfig();
    if (!currentConfig) {
      throw new Error("No provider config available");
    }

    this.options.database.upsertProviderConfig({
      id: currentConfig.id,
      name: currentConfig.name,
      type: currentConfig.type,
      protocol: currentConfig.protocol,
      baseUrl: currentConfig.baseUrl,
      apiKey: currentConfig.apiKey,
      model: modelId,
    });

    this.options.runtime.setSelectedProviderConfig(currentConfig.id);
  }

  /**
   * Cycle to the next available model.
   * Returns the new model info, or undefined if only one model available.
   */
  cycleModel(): { modelId: string; provider: string } | undefined {
    // This would typically cycle through configured models
    // For now, return undefined as model cycling requires provider support
    return undefined;
  }

  // =========================================================================
  // Session Statistics
  // =========================================================================

  /**
   * Get statistics about the current session.
   */
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

  // =========================================================================
  // Bash Execution Control
  // =========================================================================

  /**
   * Abort the currently running bash command.
   */
  abortBash(): void {
    // In the omi architecture, bash execution is handled via the provider
    // This is a placeholder - actual bash abortion would need provider support
    const runtime = this.options.runtime.snapshot();
    if (runtime.activeRunId) {
      this.cancelRun(runtime.activeRunId);
    }
  }

  // =========================================================================
  // Prompting Methods
  // =========================================================================

  /**
   * Send a prompt to the agent and wait for completion.
   * This is the main entry point for user interaction.
   */
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

    return this.startRun({
      prompt: text,
      providerConfig,
      taskId: options?.taskId,
    });
  }

  /**
   * Send a user message to the agent.
   * Always triggers a new run.
   */
  async sendUserMessage(
    content: string,
    options?: { taskId?: string | null },
  ): Promise<Run> {
    return this.prompt(content, options);
  }

  /**
   * Send a custom message to the session.
   * Custom messages are stored but don't trigger a run unless triggerRun is true.
   */
  async sendCustomMessage(
    message: {
      customType: string;
      content: unknown;
      display?: string;
      details?: Record<string, unknown>;
    },
    options?: { triggerRun?: boolean },
  ): Promise<void> {
    // In omi architecture, custom messages are stored as part of the session
    // For now, if triggerRun is true, we treat it as a regular prompt
    if (options?.triggerRun) {
      const contentStr = typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
      await this.prompt(contentStr);
    }
    // Otherwise, the custom message would be persisted via the database
  }

  // =========================================================================
  // Steering and Follow-up Methods
  // =========================================================================

  /**
   * Send a steering message during the current run.
   * The message is delivered after the current assistant turn finishes
   * executing its tool calls, before the next LLM call.
   */
  async steer(text: string): Promise<void> {
    if (text.startsWith("/")) {
      const commandName = text.slice(1).split(" ")[0];
      const command = this.options.resources.resolveSkillForPrompt?.(commandName);
      // Extension commands cannot be queued - reject them
      if (!command && text.startsWith("/")) {
        throw new Error(`Slash command "${commandName}" cannot be used with steer(). Use prompt() instead.`);
      }
    }

    // In the queue-based architecture, steering enqueues a new run
    // that will be processed after the current tool calls finish
    this.startRun({
      prompt: text,
      providerConfig: this.resolveProviderConfig(),
    });
  }

  /**
   * Queue a follow-up message to be processed after the current run completes.
   * Follow-up is delivered only when the agent has no more tool calls or steering messages.
   */
  async followUp(text: string): Promise<void> {
    if (text.startsWith("/")) {
      const commandName = text.slice(1).split(" ")[0];
      throw new Error(`Slash command "${commandName}" cannot be used with followUp(). Use prompt() instead.`);
    }

    // Follow-up enqueues a new run that will execute after the current run completes
    this.startRun({
      prompt: text,
      providerConfig: this.resolveProviderConfig(),
    });
  }

  // =========================================================================
  // Session Forking
  // =========================================================================

  /**
   * Fork the session at a specific history entry.
   * Creates a new branch from that point.
   */
  async fork(historyEntryId: string): Promise<{ newSessionId: string; selectedText: string }> {
    const session = this.requireSession();
    const historyEntries = this.options.database.listSessionHistoryEntries?.(session.id) ?? [];

    const entry = historyEntries.find((e) => e.id === historyEntryId);
    if (!entry) {
      throw new Error(`History entry ${historyEntryId} not found`);
    }

    // Create a new session forked from the current one
    const newSession = this.options.database.createSession(`Fork of ${session.title}`);
    const newSessionId = newSession.id;

    // The fork implementation would copy relevant entries to the new session
    // For now, return the new session ID and empty selected text
    return {
      newSessionId,
      selectedText: entry.summary ?? "",
    };
  }
}

function deriveTaskCandidate(session: Session): {
  title: string;
  candidateReason: string;
} | null {
  const latest = session.latestUserMessage?.trim();
  if (!latest) {
    return null;
  }

  if (latest.length < 8) {
    return null;
  }

  return {
    title: latest.slice(0, 80),
    candidateReason: "Derived from latest user prompt",
  };
}

function resolveRunPrompt(
  run: Run,
  runtime: ReturnType<SessionRuntime["snapshot"]>,
  session: Session,
): string | null {
  const candidate = run.prompt ?? runtime.lastUserPrompt ?? session.latestUserMessage;
  if (!candidate) {
    return null;
  }

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

function normalizeHistoryDetails(details: unknown): Record<string, unknown> | null {
  if (details === null || details === undefined) {
    return null;
  }

  if (typeof details === "object" && !Array.isArray(details)) {
    return details as Record<string, unknown>;
  }

  return {
    value: details,
  };
}
