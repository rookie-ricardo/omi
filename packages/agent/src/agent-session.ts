import type {
  ProviderConfig,
  ResolvedSkill,
  ReviewRequest,
  Run,
  Session,
  SessionHistoryEntry,
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
  estimateRuntimeMessagesTokens,
  estimateTextTokens,
  generateCompactionSummary,
  isOverflowError,
  isRetryableError,
  extractRetryAfterDelay,
  type CompactionSummaryGenerator,
  type CompactionMode,
} from "@omi/memory";
import { createModelFromConfig } from "@omi/provider";
import {
  buildSessionRuntimeMessages,
  buildSessionRuntimeMessageEnvelopes,
  convertRuntimeMessagesToLlm,
  renderRuntimeMessagesForPrompt,
  type RuntimeMessage,
  type SessionCompactionSnapshot,
  type SessionRuntimeMessageEnvelope,
  sessionCompactionSnapshotSchema,
} from "@omi/memory";
import {
  PiAiProvider,
  type ProviderAdapter,
  type ProviderRunResult,
  type ProviderToolRequestedEvent,
} from "@omi/provider";
import type { ToolName } from "@omi/tools";

import type { ResourceLoader } from "./resource-loader";
import type { SessionRuntime } from "./session-manager";
import type { SettingsManager } from "@omi/settings";

export interface RunnerEventEnvelope {
  type: string;
  payload: Record<string, unknown>;
}

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
}

interface ExecuteRunInput {
  session: Session;
  task: Task | null;
  run: Run;
  prompt: string;
  images?: ImageContent[];
  providerConfig: ProviderConfig;
  historyEntryId: string | null;
  checkpointSummary: string | null;
  checkpointDetails: unknown | null;
}

interface PreparedRunContext {
  session: Session;
  run: Run;
  sessionId: string;
  runId: string;
  sessionStatus: Session["status"];
  branchLeafEntryId: string | null;
  currentHistoryMessages: RuntimeMessage[];
}

interface LoadedRunResources {
  resolvedSkill: ResolvedSkill | null;
  skillMatches: SkillMatch[];
  extensionRunner: ExtensionRunner;
}

interface ProviderExecutionCompleted {
  kind: "completed";
  result: ProviderRunResult;
}

interface ProviderExecutionCanceled {
  kind: "canceled";
}

type ProviderExecutionOutcome = ProviderExecutionCompleted | ProviderExecutionCanceled;

export class AgentSession {
  private readonly provider: ProviderAdapter;
  private processingQueue = false;

  constructor(private readonly options: AgentSessionOptions) {
    this.provider = options.provider ?? new PiAiProvider();
  }

  startRun(input: {
    prompt: string;
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
    });
    this.options.runtime.enqueueRun({
      runId: run.id,
      prompt: input.prompt,
      taskId: task?.id ?? null,
      providerConfigId: input.providerConfig.id,
      sourceRunId: null,
      mode: "start",
    });

    void this.processQueue();

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
    const task = input.taskId ? this.options.database.getTask(input.taskId) : null;
    const run = this.options.database.createRun({
      sessionId: session.id,
      taskId: task?.id ?? null,
      status: "queued",
      provider: input.providerConfig.type,
      prompt: input.prompt,
      sourceRunId: null,
      recoveryMode: "start",
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

    void this.processQueue();

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
    const nextRun = this.options.database.createRun({
      sessionId: session.id,
      taskId: task?.id ?? null,
      status: "queued",
      provider: providerConfig.type,
      prompt,
      sourceRunId: originalRun.id,
      recoveryMode: "retry",
    });

    this.options.runtime.enqueueRun({
      runId: nextRun.id,
      prompt,
      taskId: task?.id ?? null,
      providerConfigId: providerConfig.id,
      sourceRunId: originalRun.id,
      mode: "retry",
    });

    void this.processQueue();
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
    const resumedRun = this.options.database.createRun({
      sessionId: session.id,
      taskId: task?.id ?? null,
      status: "queued",
      provider: providerConfig.type,
      prompt,
      sourceRunId: originalRun.id,
      recoveryMode: "resume",
    });

    this.options.runtime.enqueueRun({
      runId: resumedRun.id,
      prompt,
      taskId: task?.id ?? null,
      providerConfigId: providerConfig.id,
      sourceRunId: originalRun.id,
      mode: "resume",
    });

    void this.processQueue();
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
    this.options.database.updateRun(runId, { status: "canceled" });
    this.options.runtime.cancelRun(runId);

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
    this.provider.approveTool(toolCallId);
    return { toolCallId, decision: "approved" };
  }

  rejectTool(toolCallId: string): { toolCallId: string; decision: "rejected" } {
    this.provider.rejectTool(toolCallId);
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
        const providerConfig = this.resolveQueuedProviderConfig(queuedRun.providerConfigId);

        await this.executeRun({
          session,
          task,
          run,
          prompt: queuedRun.prompt,
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
    const prepared = this.prepareRun(input);

    try {
      const resources = await this.loadRunResources(input, prepared);
      const executionInput = await this.buildExecutionInput(
        input,
        resources.resolvedSkill,
        resources.extensionRunner,
      );
      const outcome = await this.executeProviderWithRecovery({
        runInput: input,
        prepared,
        resolvedSkill: resources.resolvedSkill,
        extensionRunner: resources.extensionRunner,
        systemPrompt: executionInput.systemPrompt,
        effectivePrompt: executionInput.effectivePrompt,
      });

      if (outcome.kind === "canceled") {
        return;
      }

      await this.finalizeSuccessfulRun({
        runInput: input,
        result: outcome.result,
        extensionRunner: resources.extensionRunner,
      });
    } catch (error) {
      await this.handleFailedRun(input, error);
    }
  }

  private prepareRun(input: ExecuteRunInput): PreparedRunContext {
    this.options.database.updateRun(input.run.id, {
      status: "running",
      provider: input.providerConfig.type,
      prompt: input.prompt,
    });

    let branchLeafEntryId = input.historyEntryId ?? null;
    if (input.checkpointSummary !== null && input.checkpointSummary !== undefined) {
      if (!this.options.database.addSessionHistoryEntry) {
        throw new Error(`Session history storage is not available for session ${input.session.id}`);
      }

      const checkpoint = this.options.database.addSessionHistoryEntry({
        sessionId: input.session.id,
        parentId: branchLeafEntryId,
        kind: "branch_summary",
        messageId: null,
        summary: input.checkpointSummary,
        details: normalizeHistoryDetails(input.checkpointDetails),
      });
      branchLeafEntryId = checkpoint.id;
    }
    const currentHistoryMessages = this.buildHistoricalRuntimeMessages(
      input.session.id,
      branchLeafEntryId,
    );

    const sessionStatus = nextSessionStatus(input.session.status, "run_started");
    this.options.database.updateSession(input.session.id, {
      status: sessionStatus,
      latestUserMessage: input.prompt,
    });

    this.options.runtime.beginRun(input.run.id, input.prompt);

    this.emitAndPersist(input.run.id, input.session.id, {
      type: "run.started",
      payload: {
        runId: input.run.id,
        sessionId: input.session.id,
        taskId: input.task?.id ?? null,
      },
    });

    return {
      session: input.session,
      run: input.run,
      sessionId: input.session.id,
      runId: input.run.id,
      sessionStatus,
      branchLeafEntryId,
      currentHistoryMessages,
    };
  }

  private async loadRunResources(
    input: ExecuteRunInput,
    prepared: PreparedRunContext,
  ): Promise<LoadedRunResources> {
    await this.options.resources.reload();

    const resolvedSkill = await this.options.resources.resolveSkillForPrompt(input.prompt);
    const skillMatches = await this.options.resources.searchSkills(input.prompt);

    this.emitAndPersist(input.run.id, input.session.id, {
      type: "run.skills_resolved",
      payload: {
        runId: input.run.id,
        sessionId: input.session.id,
        selectedSkillId: resolvedSkill?.skill.id ?? null,
        matches: skillMatches.map((match) => ({
          id: match.id,
          name: match.name,
          score: match.score,
        })),
      },
    });

    const extensionRunner = new ExtensionRunner(this.options.workspaceRoot);
    const extensionCatalog = this.options.resources.getExtensions();
    await extensionRunner.load(extensionCatalog.items);

    this.emitAndPersist(input.run.id, input.session.id, {
      type: "run.extensions_loaded",
      payload: {
        runId: input.run.id,
        sessionId: input.session.id,
        extensions: extensionCatalog.items.map((extension) => extension.name),
        diagnostics: extensionCatalog.diagnostics,
      },
    });

    await extensionRunner.emit({
      type: "run.extensions_loaded",
      payload: {
        runId: input.run.id,
        sessionId: input.session.id,
        extensions: extensionCatalog.items.map((extension) => extension.name),
        diagnostics: extensionCatalog.diagnostics,
      },
    });
    await extensionRunner.emit({
      type: "run.started",
      payload: {
        runId: input.run.id,
        sessionId: input.session.id,
        taskId: input.task?.id ?? null,
      },
    });

    return {
      resolvedSkill,
      skillMatches,
      extensionRunner,
    };
  }

  private async buildExecutionInput(
    input: ExecuteRunInput,
    resolvedSkill: ResolvedSkill | null,
    extensionRunner: ExtensionRunner,
  ): Promise<{ systemPrompt: string; effectivePrompt: string }> {
    const baseSystemPrompt = this.options.resources.buildSystemPrompt(resolvedSkill);
    await extensionRunner.beforeRun({
      prompt: input.prompt,
      sessionId: input.session.id,
      workspaceRoot: this.options.workspaceRoot,
      systemPrompt: baseSystemPrompt,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: input.prompt }],
          timestamp: Date.now(),
        },
      ],
    });
    const systemPrompt = extensionRunner.buildSystemPrompt(baseSystemPrompt);
    const runtimePrompt = renderRuntimeMessagesForPrompt(extensionRunner.getRuntimeMessages());
    const effectivePrompt = runtimePrompt.trim().length > 0
      ? `${runtimePrompt}\n\n${input.prompt}`
      : input.prompt;

    const taskCandidate = deriveTaskCandidate({
      ...input.session,
      latestUserMessage: input.prompt,
    });
    if (
      taskCandidate &&
      !this.options.database.listTasks().some((task) => task.originSessionId === input.session.id)
    ) {
      this.options.database.createTask({
        title: taskCandidate.title,
        status: "inbox",
        originSessionId: input.session.id,
        candidateReason: taskCandidate.candidateReason,
        autoCreated: true,
      });
    }

    return {
      systemPrompt,
      effectivePrompt,
    };
  }

  private async executeProviderWithRecovery(input: {
    runInput: ExecuteRunInput;
    prepared: PreparedRunContext;
    resolvedSkill: ResolvedSkill | null;
    extensionRunner: ExtensionRunner;
    systemPrompt: string;
    effectivePrompt: string;
  }): Promise<ProviderExecutionOutcome> {
    let currentHistoryMessages = input.prepared.currentHistoryMessages;
    const thresholdCompacted = await this.compactHistoricalContext({
      session: input.runInput.session,
      providerConfig: input.runInput.providerConfig,
      mode: "threshold",
      prompt: input.runInput.prompt,
      historyEnvelopes: this.buildHistoricalRuntimeMessageEnvelopes(
        input.runInput.session.id,
        input.prepared.branchLeafEntryId,
      ),
    });
    if (thresholdCompacted) {
      currentHistoryMessages = this.buildHistoricalRuntimeMessages(
        input.runInput.session.id,
        input.prepared.branchLeafEntryId,
      );
    }

    // Get retry settings from SettingsManager
    const retrySettings = this.options.settingsManager?.getRetrySettings() ?? {
      enabled: true,
      maxRetries: 3,
      baseDelayMs: 2000,
      maxDelayMs: 60000,
    };

    // Track if we've done overflow recovery (only once per run to avoid infinite loops)
    let overflowRecovered = false;
    // Track retry attempts (excluding overflow recovery which is separate)
    let retryAttempt = 0;

    while (retryAttempt <= (retrySettings.enabled ? retrySettings.maxRetries : 0)) {
      try {
        const result = await this.provider.run({
          runId: input.runInput.run.id,
          sessionId: input.runInput.session.id,
          workspaceRoot: this.options.workspaceRoot,
          prompt: input.effectivePrompt,
          historyMessages: convertRuntimeMessagesToLlm(currentHistoryMessages),
          systemPrompt: input.systemPrompt,
          providerConfig: input.runInput.providerConfig,
          enabledTools: input.resolvedSkill?.enabledToolNames.length
            ? (input.resolvedSkill.enabledToolNames as ToolName[])
            : undefined,
          onTextDelta: (delta) => {
            this.emitAndPersist(input.runInput.run.id, input.runInput.session.id, {
              type: "run.delta",
              payload: {
                runId: input.runInput.run.id,
                sessionId: input.runInput.session.id,
                delta,
              },
            });
          },
          onToolRequested: async (event) => {
            await input.extensionRunner.emit({
              type: "run.tool_requested",
              payload: {
                runId: input.runInput.run.id,
                sessionId: input.runInput.session.id,
                toolName: event.toolName,
                input: event.input,
                requiresApproval: event.requiresApproval,
              },
            });
            return this.handleToolRequested(
              input.runInput.run.id,
              input.runInput.session.id,
              input.runInput.task?.id ?? null,
              event,
            );
          },
          onToolDecision: (toolCallId, decision) => {
            this.handleToolDecision(input.runInput.run.id, input.runInput.session.id, toolCallId, decision);
          },
          onToolStarted: (toolCallId, toolName) => {
            this.emitAndPersist(input.runInput.run.id, input.runInput.session.id, {
              type: "run.tool_started",
              payload: {
                runId: input.runInput.run.id,
                toolCallId,
                toolName,
              },
            });
            void input.extensionRunner.emit({
              type: "run.tool_started",
              payload: {
                runId: input.runInput.run.id,
                sessionId: input.runInput.session.id,
                toolCallId,
                toolName,
              },
            });
          },
          onToolFinished: (toolCallId, toolName, output, isError) => {
            this.options.database.updateToolCall(toolCallId, {
              output,
              error: isError ? JSON.stringify(output) : null,
            });
            this.emitAndPersist(input.runInput.run.id, input.runInput.session.id, {
              type: "run.tool_finished",
              payload: {
                runId: input.runInput.run.id,
                toolCallId,
                toolName,
                output,
              },
            });
            void input.extensionRunner.emit({
              type: "run.tool_finished",
              payload: {
                runId: input.runInput.run.id,
                sessionId: input.runInput.session.id,
                toolCallId,
                toolName,
                output,
                isError,
              },
            });
          },
        });

        if (!result) {
          throw new Error(`Run ${input.runInput.run.id} did not produce a result.`);
        }

        // Emit retry end event if we retried
        if (retryAttempt > 0 || overflowRecovered) {
          this.emitAndPersist(input.runInput.run.id, input.runInput.session.id, {
            type: "auto_retry_end",
            payload: {
              runId: input.runInput.run.id,
              sessionId: input.runInput.session.id,
              success: true,
              attempt: retryAttempt,
            },
          });
        }

        if (this.options.database.getRun(input.runInput.run.id)?.status === "canceled") {
          this.emitAndPersist(input.runInput.run.id, input.runInput.session.id, {
            type: "run.canceled",
            payload: {
              runId: input.runInput.run.id,
              sessionId: input.runInput.session.id,
            },
          });
          await input.extensionRunner.emit({
            type: "run.canceled",
            payload: {
              runId: input.runInput.run.id,
              sessionId: input.runInput.session.id,
            },
          });
          return {
            kind: "canceled",
          };
        }

        return {
          kind: "completed",
          result,
        };
      } catch (error) {
        // Check if this is a context overflow error
        if (isOverflowError(error)) {
          // Only perform overflow recovery once to avoid infinite loops
          if (overflowRecovered) {
            throw error;
          }
          overflowRecovered = true;

          // Remove error message from agent state (but keep in session file for history)
          // Note: We don't add error messages to agent state, so nothing to remove here

          let overflowHistoryEnvelopes = this.buildHistoricalRuntimeMessageEnvelopes(
            input.runInput.session.id,
            input.prepared.branchLeafEntryId,
          );
          if (overflowHistoryEnvelopes.length === 0) {
            const timestamp = Date.now();
            overflowHistoryEnvelopes = [
              {
                timestamp,
                order: 1,
                sourceHistoryEntryId: null,
                message: {
                  role: "user",
                  content: input.effectivePrompt,
                  timestamp,
                },
              },
            ];
          }
          const compacted = await this.compactHistoricalContext({
            session: input.runInput.session,
            providerConfig: input.runInput.providerConfig,
            mode: "overflow",
            prompt: input.runInput.prompt,
            historyEnvelopes: overflowHistoryEnvelopes,
          });
          if (!compacted) {
            throw error;
          }

          currentHistoryMessages = this.buildHistoricalRuntimeMessages(
            input.runInput.session.id,
            input.prepared.branchLeafEntryId,
          );
          // Retry immediately after compaction (don't increment retryAttempt since overflow is separate)
          continue;
        }

        // Check if this is a retryable error
        if (retrySettings.enabled && isRetryableError(error)) {
          // Check if run was canceled
          if (this.options.database.getRun(input.runInput.run.id)?.status === "canceled") {
            this.emitAndPersist(input.runInput.run.id, input.runInput.session.id, {
              type: "run.canceled",
              payload: {
                runId: input.runInput.run.id,
                sessionId: input.runInput.session.id,
              },
            });
            await input.extensionRunner.emit({
              type: "run.canceled",
              payload: {
                runId: input.runInput.run.id,
                sessionId: input.runInput.session.id,
              },
            });
            return {
              kind: "canceled",
            };
          }

          // Check if we've exhausted retries
          if (retryAttempt >= retrySettings.maxRetries) {
            // Emit retry end event with failure
            this.emitAndPersist(input.runInput.run.id, input.runInput.session.id, {
              type: "auto_retry_end",
              payload: {
                runId: input.runInput.run.id,
                sessionId: input.runInput.session.id,
                success: false,
                attempt: retryAttempt,
                error: error instanceof Error ? error.message : String(error),
              },
            });
            throw error;
          }

          // Calculate delay using exponential backoff
          const baseDelay = retrySettings.baseDelayMs;
          const exponentialDelay = baseDelay * Math.pow(2, retryAttempt);
          const serverDelay = extractRetryAfterDelay(error);
          const delay = Math.min(
            exponentialDelay,
            retrySettings.maxDelayMs,
            serverDelay ?? retrySettings.maxDelayMs,
          );

          // Emit retry start event
          this.emitAndPersist(input.runInput.run.id, input.runInput.session.id, {
            type: "auto_retry_start",
            payload: {
              runId: input.runInput.run.id,
              sessionId: input.runInput.session.id,
              attempt: retryAttempt + 1,
              delayMs: delay,
              error: error instanceof Error ? error.message : String(error),
            },
          });

          // Wait with abort signal support
          await this.delayWithAbort(delay, input.runInput.run.id);

          retryAttempt++;
          continue;
        }

        // Not retryable - throw immediately
        throw error;
      }
    }

    // Should not reach here, but just in case
    throw new Error(`Run ${input.runInput.run.id} did not produce a result.`);
  }

  /**
   * Delay with abort signal support - checks run status during delay
   * @param ms - Delay in milliseconds
   * @param runId - Run ID to check for cancellation
   */
  private async delayWithAbort(ms: number, runId: string): Promise<void> {
    const start = Date.now();
    const interval = 100; // Check every 100ms

    while (Date.now() - start < ms) {
      // Check if run was canceled
      if (this.options.database.getRun(runId)?.status === "canceled") {
        return; // Exit early, caller will detect cancellation
      }

      const remaining = ms - (Date.now() - start);
      if (remaining <= 0) break;

      await new Promise((resolve) => setTimeout(resolve, Math.min(interval, remaining)));
    }
  }

  private async finalizeSuccessfulRun(input: {
    runInput: ExecuteRunInput;
    result: ProviderRunResult;
    extensionRunner: ExtensionRunner;
  }): Promise<void> {
    const runId = input.runInput.run.id;
    const sessionId = input.runInput.session.id;
    const assistantText = input.result.assistantText.trim();

    this.options.database.updateRun(runId, { status: "completed" });
    this.options.database.updateSession(sessionId, {
      status: nextSessionStatus(input.runInput.session.status, "run_completed"),
      latestAssistantMessage: assistantText,
    });

    this.options.database.addMessage({
      sessionId,
      role: "user",
      content: input.runInput.prompt,
      parentHistoryEntryId: input.runInput.historyEntryId,
    });

    if (assistantText) {
      this.options.database.addMessage({
        sessionId,
        role: "assistant",
        content: assistantText,
      });
    }

    this.options.runtime.completeRun(runId, assistantText);
    this.persistRuntimeSnapshot(sessionId);

    this.emitAndPersist(runId, sessionId, {
      type: "run.completed",
      payload: {
        runId,
        sessionId,
        summary: assistantText,
      },
    });

    await input.extensionRunner.emit({
      type: "run.completed",
      payload: {
        runId,
        sessionId,
        summary: assistantText,
      },
    });

    if (input.runInput.task) {
      this.options.database.updateTask(input.runInput.task.id, {
        status: nextTaskStatus(input.runInput.task.status, "run_completed"),
      });
    }
  }

  private async handleFailedRun(input: ExecuteRunInput, error: unknown): Promise<void> {
    const runId = input.run.id;
    const sessionId = input.session.id;

    const canceled = this.options.database.getRun(runId)?.status === "canceled";
    const message = error instanceof Error ? error.message : String(error);

    this.options.database.updateRun(runId, {
      status: canceled ? "canceled" : "failed",
    });

    this.options.database.updateSession(sessionId, {
      status: nextSessionStatus(input.session.status, canceled ? "run_canceled" : "run_failed"),
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

  private async handleToolRequested(
    runId: string,
    sessionId: string,
    taskId: string | null,
    event: ProviderToolRequestedEvent,
  ): Promise<string> {
    const toolCallId = createId("tool");
    this.options.database.createToolCall({
      id: toolCallId,
      runId,
      sessionId,
      taskId,
      toolName: event.toolName,
      approvalState: event.requiresApproval ? "pending" : "not_required",
      input: event.input,
      output: null,
      error: null,
    });

    this.emitAndPersist(runId, sessionId, {
      type: "run.tool_requested",
      payload: {
        runId,
        sessionId,
        toolCallId,
        toolName: event.toolName,
        requiresApproval: event.requiresApproval,
        input: event.input,
      },
    });

    if (event.requiresApproval) {
      this.options.runtime.blockOnTool(runId, toolCallId);

      const session = this.requireSession();
      this.options.database.updateSession(sessionId, {
        status: nextSessionStatus(session.status, "tool_blocked"),
      });

      this.emitAndPersist(runId, sessionId, {
        type: "run.blocked",
        payload: {
          runId,
          toolCallId,
          reason: `Waiting for approval: ${event.toolName}`,
        },
      });
    }

    return toolCallId;
  }

  private handleToolDecision(
    runId: string,
    sessionId: string,
    toolCallId: string,
    decision: "approved" | "rejected",
  ): void {
    this.options.database.updateToolCall(toolCallId, {
      approvalState: decision,
    });

    if (decision === "approved") {
      this.options.runtime.approveTool(runId, toolCallId);

      const session = this.requireSession();
      this.options.database.updateSession(sessionId, {
        status: nextSessionStatus(session.status, "resume"),
      });
    } else {
      this.options.runtime.rejectTool(runId, toolCallId);
      this.options.database.updateRun(runId, { status: "canceled" });
      this.options.runtime.cancelRun(runId);

      const session = this.requireSession();
      this.options.database.updateSession(sessionId, {
        status: nextSessionStatus(session.status, "run_canceled"),
      });
    }

    this.emitAndPersist(runId, sessionId, {
      type: "run.tool_decided",
      payload: {
        runId,
        sessionId,
        toolCallId,
        decision,
      },
    });
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
        parentId: null,
        kind: "branch_summary",
        messageId: null,
        summary: snapshot.summary.goal,
        details: normalizeHistoryDetails(details),
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
    this.options.database.writeMemory({
      scope: "session",
      scopeId: sessionId,
      title: "Runtime Snapshot",
      content: JSON.stringify(this.options.runtime.snapshot()),
      tags: ["runtime"],
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
