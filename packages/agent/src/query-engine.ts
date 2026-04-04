import type { ProviderConfig, Run, Session, Task, ToolCall } from "@omi/core";
import { createId, nowIso } from "@omi/core";
import type {
  CompactionMode,
  CompactionSummaryGenerator,
  RuntimeMessage,
  SessionCompactionSnapshot,
  SessionRuntimeMessageEnvelope,
} from "@omi/memory";
import {
  buildCompactionPlan,
  buildSessionRuntimeMessageEnvelopes,
  buildSessionRuntimeMessages,
  convertRuntimeMessagesToLlm,
  renderRuntimeMessagesForPrompt,
  sessionCompactionSnapshotSchema,
  estimateContextTokens,
  type ContextUsageEstimate,
} from "@omi/memory";
import {
  createContextBudget,
  calculateTokenWarningState,
  needsContextAttention,
  type ContextBudget,
  type TokenWarningState,
} from "@omi/memory";
import {
  ContextPipeline,
  type ContextPipelineConfig,
  type ContextPipelineResult,
} from "@omi/memory";
import { createModelFromConfig, PiAiProvider } from "@omi/provider";
import type { ProviderAdapter, ProviderRunResult, ProviderToolRequestedEvent } from "@omi/provider";
import { SAFE_TOOL_NAMES, listBuiltInToolNames } from "@omi/tools";
import type { ToolName } from "@omi/tools";
import type { AppStore } from "@omi/store";
import type { ResourceLoader } from "./resource-loader";
import type { SessionRuntime } from "./session-manager";
import type { SettingsManager } from "@omi/settings";
import type { ResolvedSkill } from "@omi/core";
import type { ImageContent } from "@mariozechner/pi-ai";
import {
  type QueryLoopMutableState,
  type QueryLoopSnapshot,
  type QueryLoopState,
  type QueryLoopTerminalEvent,
  type QueryLoopTransitionEvent,
  type ToolExecutionMode,
  type TerminalReason,
  createInitialMutableState,
  isValidTransition,
} from "./query-state";
import {
  RecoveryEngine,
  DEFAULT_RECOVERY_SETTINGS,
  type RecoveryEngineEvent,
} from "./recovery";
import { getPlanStateManager } from "./modes/plan-mode";

// ============================================================================
// Types
// ============================================================================

export interface QueryEngineDeps {
  database: AppStore;
  sessionId: string;
  workspaceRoot: string;
  emit: (event: QueryEngineEvent) => void;
  resources: ResourceLoader;
  runtime: SessionRuntime;
  provider?: ProviderAdapter;
  compactionSummarizer?: CompactionSummaryGenerator;
  settingsManager?: SettingsManager;
  /** Permission evaluator for rule-based access control. */
  evaluator?: PermissionEvaluator;
  denialTracker?: DenialTracker;
  /** Context pipeline configuration */
  contextPipelineConfig?: Partial<ContextPipelineConfig>;
}

import {
  type PermissionEvaluator,
  type DenialTracker,
  MemoryDenialTracker,
  contextToDenialKey,
  createPermissionEvaluator,
} from "./permissions";

export type QueryEngineEvent =
  | QueryLoopTransitionEvent
  | QueryLoopTerminalEvent
  | QueryRunnerEventEnvelope
  | RecoveryEngineEvent;

export interface QueryRunnerEventEnvelope {
  type: string;
  payload: Record<string, unknown>;
}

export interface QueryEngineRunInput {
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

export interface QueryEngineResult {
  terminalReason: TerminalReason;
  turnCount: number;
  assistantText: string;
  error: string | null;
}

interface ProviderExecutionCompleted {
  kind: "completed";
  result: ProviderRunResult;
}

interface ProviderExecutionCanceled {
  kind: "canceled";
}

type ProviderExecutionOutcome = ProviderExecutionCompleted | ProviderExecutionCanceled;

interface PreparedRunContext {
  session: Session;
  run: Run;
  sessionId: string;
  runId: string;
  sessionStatus: Session["status"];
  branchLeafEntryId: string | null;
  currentHistoryMessages: RuntimeMessage[];
  resolvedSkill: ResolvedSkill | null;
}

// ============================================================================
// Retry Settings (delegated to RecoveryEngine)
// ============================================================================

interface RetrySettings {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_SETTINGS: RetrySettings = {
  enabled: true,
  maxRetries: DEFAULT_RECOVERY_SETTINGS.maxRetryAttempts,
  baseDelayMs: DEFAULT_RECOVERY_SETTINGS.baseDelayMs,
  maxDelayMs: DEFAULT_RECOVERY_SETTINGS.maxDelayMs,
};

export function resolveToolExecutionMode(
  enabledTools: ToolName[] | undefined,
): ToolExecutionMode {
  if (!enabledTools || enabledTools.length === 0) {
    return "sequential";
  }

  return enabledTools.every((toolName) => SAFE_TOOL_NAMES.has(toolName))
    ? "parallel"
    : "sequential";
}

// ============================================================================
// QueryEngine - State Machine Core
// ============================================================================

export class QueryEngine {
  private readonly provider: ProviderAdapter;
  private readonly evaluator: PermissionEvaluator;
  private readonly denialTracker: DenialTracker;
  private state: QueryLoopMutableState;
  private currentRunId: string | null = null;
  private canceled = false;
  private recoveryEngine: RecoveryEngine | null = null;
  private readonly planStateManager = getPlanStateManager();

  constructor(private readonly deps: QueryEngineDeps) {
    this.provider = deps.provider ?? new PiAiProvider();
    this.state = createInitialMutableState();
    // Initialize permission evaluator with denial tracker
    this.denialTracker = deps.denialTracker ?? new MemoryDenialTracker();
    this.evaluator = deps.evaluator ?? createPermissionEvaluator()
      .withDenialTracker(this.denialTracker)
      .build();
  }

  snapshot(): QueryLoopSnapshot {
    return {
      sessionId: this.deps.sessionId,
      runId: this.currentRunId ?? "",
      ...this.state,
    };
  }

  get currentState(): QueryLoopState {
    return this.state.currentState;
  }

  get terminalReason(): TerminalReason | null {
    return this.state.terminalReason;
  }

  /**
   * Cancel the running query loop.
   * The loop will detect cancellation and transition to terminal on next check.
   */
  cancel(): void {
    this.canceled = true;
  }

  // ==========================================================================
  // Main execution loop (state machine driver)
  // ==========================================================================

  async execute(input: QueryEngineRunInput): Promise<QueryEngineResult> {
    this.state = createInitialMutableState();
    this.currentRunId = input.run.id;
    this.canceled = false;

    // Initialize recovery engine for this run
    this.recoveryEngine = new RecoveryEngine({
      store: this.deps.database,
      runId: input.run.id,
      sessionId: input.session.id,
      emit: (event) => this.emitEvent(event),
    });

    try {
      // init -> preprocess_context
      this.transition("preprocess_context", "run_starting");

      const prepared = this.prepareRun(input);
      const extensionRunner = await this.loadRunResources(input, prepared);
      const executionInput = await this.buildExecutionInput(
        input,
        prepared,
        extensionRunner,
      );
      this.state.messages = prepared.currentHistoryMessages;
      this.state.compactTracking.lastContextTokens = estimateContextTokens(
        prepared.currentHistoryMessages,
      ).tokens;

      // preprocess_context -> calling_model
      this.transition("calling_model", "context_prepared");

      let currentHistoryMessages = prepared.currentHistoryMessages;

      // Run context pipeline before first model call (includes threshold compaction)
      const pipelineResult = await this.runContextPipeline(
        input.session,
        input.providerConfig,
        currentHistoryMessages,
        input.run.id,
      );
      if (pipelineResult.didCompact) {
        currentHistoryMessages = pipelineResult.messages;
        this.state.messages = currentHistoryMessages;
      }

      const retrySettings =
        this.deps.settingsManager?.getRetrySettings?.() ?? DEFAULT_RETRY_SETTINGS;

      // Outer retry loop for transient errors
      while (this.state.recoveryCount <= (retrySettings.enabled ? retrySettings.maxRetries : 0)) {
        if (this.state.budget.maxTurns > 0 && this.state.turnCount >= this.state.budget.maxTurns) {
          return this.terminate("max_turns", null);
        }
        if (this.canceled) {
          return this.terminate("canceled", null);
        }

        // Gate model calls when context health indicates the run is unsafe.
        const contextHealth = this.checkContextHealth(currentHistoryMessages, input.providerConfig);
        if (contextHealth.needsAttention) {
          this.emitEvent({
            type: "run.context_health",
            payload: {
              runId: input.run.id,
              sessionId: input.session.id,
              usageTokens: contextHealth.usageTokens,
              warningState: contextHealth.warningState,
            },
          });
          const shouldGate =
            contextHealth.warningState.isAtBlockingLimit ||
            contextHealth.warningState.isAboveErrorThreshold;
          if (shouldGate) {
            this.transition("recovering", "context_health_gate");

            const mode: CompactionMode = contextHealth.warningState.isAtBlockingLimit
              ? "overflow"
              : "threshold";
            const compacted = await this.compactHistoricalContext({
              session: input.session,
              providerConfig: input.providerConfig,
              mode,
              prompt: input.prompt,
              runId: input.run.id,
              historyEnvelopes: this.buildHistoricalRuntimeMessageEnvelopes(
                input.session.id,
                prepared.branchLeafEntryId,
              ),
            });

            if (compacted) {
              currentHistoryMessages = this.buildHistoricalRuntimeMessages(
                input.session.id,
                prepared.branchLeafEntryId,
              );
              this.state.messages = currentHistoryMessages;
            }

            const postGateHealth = this.checkContextHealth(currentHistoryMessages, input.providerConfig);
            if (postGateHealth.warningState.isAtBlockingLimit) {
              return this.terminate(
                "budget_exceeded",
                "Context health gate blocked model call after compaction",
              );
            }

            this.transition("calling_model", "context_health_recovered");
          }
        }

        // Checkpoint: before_model_call
        this.recoveryEngine.saveCheckpoint("before_model_call", {
          turnCount: this.state.turnCount,
          recoveryCount: this.state.recoveryCount,
          compactTracking: this.state.compactTracking,
          partialAssistantText: "",
        });

        // calling_model -> streaming_response
        this.transition("streaming_response", "calling_model");

        let outcome: ProviderExecutionOutcome | null = null;
        try {
          outcome = await this.callProvider({
            input,
            prepared,
            extensionRunner,
            systemPrompt: executionInput.systemPrompt,
            effectivePrompt: executionInput.effectivePrompt,
            historyMessages: currentHistoryMessages,
            resolvedSkill: prepared.resolvedSkill,
            providerConfig: input.providerConfig,
          });
        } catch (error) {
          // Error classification and recovery via RecoveryEngine
          const { action } = this.recoveryEngine.classifyAndDecide(error, {
            recoveryCount: this.state.recoveryCount,
            compactTracking: this.state.compactTracking,
          });

          if (action.kind === "retry") {
            this.transition("recovering", action.reason);
            this.emitEvent({
              type: "auto_retry_start",
              payload: {
                runId: input.run.id,
                sessionId: input.session.id,
                attempt: this.state.recoveryCount + 1,
                delayMs: action.delayMs,
                error: error instanceof Error ? error.message : String(error),
              },
            });
            await this.delayWithAbort(action.delayMs, input.run.id);
            this.state.recoveryCount++;
            this.transition("calling_model", "retry");
            continue;
          }
          if (action.kind === "overflow_compact") {
            this.transition("recovering", "overflow_recovery");
            const compacted = await this.compactHistoricalContext({
              session: input.session,
              providerConfig: input.providerConfig,
              mode: "overflow",
              prompt: input.prompt,
              runId: input.run.id,
              historyEnvelopes: this.buildHistoricalRuntimeMessageEnvelopes(
                input.session.id,
                prepared.branchLeafEntryId,
              ),
            });
            if (compacted) {
              currentHistoryMessages = this.buildHistoricalRuntimeMessages(
                input.session.id,
                prepared.branchLeafEntryId,
              );
              this.state.compactTracking.overflowRecovered = true;
              this.state.messages = currentHistoryMessages;
              this.transition("calling_model", "overflow_retry");
              continue;
            }
            // Compaction failed, fall through to terminal
            return this.terminate(
              "budget_exceeded",
              error instanceof Error ? error.message : String(error),
            );
          }
          if (action.kind === "max_output_recovery") {
            this.transition("recovering", "max_output_recovery");
            this.state.compactTracking.maxOutputRecoveryCount++;
            currentHistoryMessages = [
              ...currentHistoryMessages,
              this.createMaxOutputContinuationMessage(),
            ];
            this.state.messages = currentHistoryMessages;
            this.transition("calling_model", "max_output_retry");
            continue;
          }
          // action.kind === "fail"
          if (action.kind === "fail") {
            return this.terminate(action.terminalReason, error instanceof Error ? error.message : String(error));
          }

          // Unreachable: all action kinds are handled above
          continue;
        }

        // Handle cancellation during streaming
        if (!outcome || outcome.kind === "canceled") {
          return this.terminate("canceled", null);
        }

        // Check for cancellation after streaming
        if (this.canceled) {
          return this.terminate("canceled", null);
        }

        const result = outcome.result;

        // Checkpoint: after_model_stream
        this.recoveryEngine.saveCheckpoint("after_model_stream", {
          turnCount: this.state.turnCount,
          recoveryCount: this.state.recoveryCount,
          compactTracking: this.state.compactTracking,
          partialAssistantText: result.assistantText,
        });

        // Emit retry-end event if we retried
        if (this.state.recoveryCount > 0 || this.state.compactTracking.overflowRecovered) {
          this.emitEvent({
            type: "auto_retry_end",
            payload: {
              runId: input.run.id,
              sessionId: input.session.id,
              success: true,
              attempt: this.state.recoveryCount,
            },
          });
        }

        // streaming_response -> executing_tools or post_tool_merge
        const resultAny = result as unknown as Record<string, unknown>;
        const hasToolCalls = Array.isArray(resultAny.toolCalls) && resultAny.toolCalls.length > 0;
        if (hasToolCalls) {
          this.transition("executing_tools", "tool_calls_present");
        }

        // Checkpoint: after_tool_batch (before post_tool_merge)
        this.recoveryEngine.saveCheckpoint("after_tool_batch", {
          turnCount: this.state.turnCount,
          recoveryCount: this.state.recoveryCount,
          compactTracking: this.state.compactTracking,
          partialAssistantText: result.assistantText,
        });

        this.transition("post_tool_merge", "model_response_complete");
        this.state.turnCount++;

        // Checkpoint: before_terminal_commit
        this.recoveryEngine.saveCheckpoint("before_terminal_commit", {
          turnCount: this.state.turnCount,
          recoveryCount: this.state.recoveryCount,
          compactTracking: this.state.compactTracking,
          partialAssistantText: result.assistantText,
        });

        // Finalize the run
        await this.finalizeRun(input, result, extensionRunner);

        return this.terminate("completed", null, result.assistantText);
      }

      // Exhausted retries
      return this.terminate("error", "Max retries exhausted");
    } catch (error) {
      return this.terminate(
        "error",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // ==========================================================================
  // State transitions
  // ==========================================================================

  private transition(to: QueryLoopState, reason: string): void {
    const from = this.state.currentState;
    if (!isValidTransition(from, to)) {
      throw new Error(
        `Invalid state transition: ${from} -> ${to} (reason: ${reason})`,
      );
    }

    this.state.currentState = to;
    this.state.lastTransitionAt = nowIso();

    this.emitEvent({
      type: "query_loop.transition",
      runId: this.currentRunId ?? "",
      sessionId: this.deps.sessionId,
      from,
      to,
      reason,
      timestamp: this.state.lastTransitionAt,
      turnCount: this.state.turnCount,
    });
  }

  private terminate(
    reason: TerminalReason,
    error: string | null,
    assistantText = "",
  ): QueryEngineResult {
    // Force transition to terminal from any state
    this.state.currentState = "terminal";
    this.state.terminalReason = reason;
    this.state.terminalError = error;
    this.state.lastTransitionAt = nowIso();

    this.emitEvent({
      type: "query_loop.terminal",
      runId: this.currentRunId ?? "",
      sessionId: this.deps.sessionId,
      reason,
      error,
      turnCount: this.state.turnCount,
      timestamp: this.state.lastTransitionAt,
    });

    return {
      terminalReason: reason,
      turnCount: this.state.turnCount,
      assistantText,
      error,
    };
  }

  // ==========================================================================
  // Provider call
  // ==========================================================================

  private async callProvider(params: {
    input: QueryEngineRunInput;
    prepared: PreparedRunContext;
    extensionRunner: import("@omi/extensions").ExtensionRunner;
    systemPrompt: string;
    effectivePrompt: string;
    historyMessages: RuntimeMessage[];
    resolvedSkill: ResolvedSkill | null;
    providerConfig: ProviderConfig;
  }): Promise<ProviderExecutionOutcome> {
    const { input, extensionRunner, systemPrompt, effectivePrompt, historyMessages, resolvedSkill, providerConfig } = params;

    try {
      const result = await this.provider.run({
        runId: input.run.id,
        sessionId: input.session.id,
        workspaceRoot: this.deps.workspaceRoot,
        prompt: effectivePrompt,
        historyMessages: convertRuntimeMessagesToLlm(historyMessages),
        systemPrompt,
        providerConfig,
        enabledTools: resolvedSkill?.enabledToolNames.length
          ? this.filterVisibleTools(resolvedSkill.enabledToolNames as ToolName[], input.session.id)
          : this.filterVisibleTools(listBuiltInToolNames(), input.session.id),
        toolExecutionMode: resolveToolExecutionMode(
          resolvedSkill?.enabledToolNames as ToolName[] | undefined,
        ),
        preflightToolCheck: async (toolName, toolInput) => {
          const planMode = this.isPlanMode();
          const reason = this.evaluator.preflightCheck({
            toolName,
            input: toolInput,
            planMode,
            sessionId: input.session.id,
          });
          if (reason) {
            this.emitEvent({
              type: "run.tool_denied",
              payload: {
                runId: input.run.id,
                sessionId: input.session.id,
                toolName,
                reason,
              },
            });
          }
          return reason;
        },
        onTextDelta: (delta) => {
          this.emitEvent({
            type: "run.delta",
            payload: {
              runId: input.run.id,
              sessionId: input.session.id,
              delta,
            },
          });
        },
        onToolRequested: async (event) => {
          // Preflight check: second-layer validation to prevent bypass
          const planMode = this.isPlanMode();
          const preflightError = this.evaluator.preflightCheck({
            toolName: event.toolName,
            input: event.input,
            planMode,
            sessionId: input.session.id,
          });
          if (preflightError) {
            this.emitEvent({
              type: "run.tool_denied",
              payload: {
                runId: input.run.id,
                sessionId: input.session.id,
                toolName: event.toolName,
                reason: preflightError,
              },
            });
            return `${input.run.id}:${event.toolName}:denied`;
          }

          await extensionRunner.emit({
            type: "run.tool_requested",
            payload: {
              runId: input.run.id,
              sessionId: input.session.id,
              toolName: event.toolName,
              input: event.input,
              requiresApproval: event.requiresApproval,
            },
          });
          return this.handleToolRequested(
            input.run.id,
            input.session.id,
            input.task?.id ?? null,
            event,
          );
        },
        onToolDecision: (toolCallId, decision) => {
          this.handleToolDecision(input.run.id, input.session.id, toolCallId, decision);
        },
        onToolStarted: (toolCallId, toolName) => {
          this.emitEvent({
            type: "run.tool_started",
            payload: { runId: input.run.id, toolCallId, toolName },
          });
          void extensionRunner.emit({
            type: "run.tool_started",
            payload: {
              runId: input.run.id,
              sessionId: input.session.id,
              toolCallId,
              toolName,
            },
          });
        },
        onToolFinished: (toolCallId, toolName, output, isError) => {
          // Record write tool execution for replay protection
          this.recoveryEngine?.recordWriteTool(toolCallId, toolName);

          this.deps.database.updateToolCall(toolCallId, {
            output,
            error: isError ? JSON.stringify(output) : null,
          });
          this.emitEvent({
            type: "run.tool_finished",
            payload: { runId: input.run.id, toolCallId, toolName, output },
          });
          void extensionRunner.emit({
            type: "run.tool_finished",
            payload: {
              runId: input.run.id,
              sessionId: input.session.id,
              toolCallId,
              toolName,
              output,
              isError,
            },
          });
        },
      });
      if (!result) {
        throw new Error(`Run ${input.run.id} did not produce a result.`);
      }

      if (this.deps.database.getRun(input.run.id)?.status === "canceled") {
        this.emitEvent({
          type: "run.canceled",
          payload: { runId: input.run.id, sessionId: input.session.id },
        });
        await extensionRunner.emit({
          type: "run.canceled",
          payload: { runId: input.run.id, sessionId: input.session.id },
        });
        return { kind: "canceled" };
      }

      return { kind: "completed", result };
    } catch (error) {
      if (this.canceled || this.deps.database.getRun(input.run.id)?.status === "canceled") {
        return { kind: "canceled" };
      }
      throw error;
    }
  }

  // ==========================================================================
  // Run preparation
  // ==========================================================================

  private prepareRun(input: QueryEngineRunInput): PreparedRunContext {
    this.deps.database.updateRun(input.run.id, {
      status: "running",
      provider: input.providerConfig.type,
      prompt: input.prompt,
    });

    let branchLeafEntryId = input.historyEntryId ?? null;
    if (input.checkpointSummary !== null && input.checkpointSummary !== undefined) {
      if (!this.deps.database.addSessionHistoryEntry) {
        throw new Error(`Session history storage is not available for session ${input.session.id}`);
      }
      const branchId =
        this.deps.database.getActiveBranchId(input.session.id) ??
        this.deps.database.listBranches(input.session.id).at(-1)?.id ??
        null;
      const parentHistoryEntry = branchLeafEntryId
        ? this.deps.database.getHistoryEntry(branchLeafEntryId)
        : null;
      const checkpoint = this.deps.database.addSessionHistoryEntry({
        sessionId: input.session.id,
        parentId: branchLeafEntryId,
        kind: "branch_summary",
        messageId: null,
        summary: input.checkpointSummary,
        details: normalizeHistoryDetails(input.checkpointDetails),
        branchId,
        lineageDepth: parentHistoryEntry ? parentHistoryEntry.lineageDepth + 1 : 0,
        originRunId: input.run.id,
      });
      branchLeafEntryId = checkpoint.id;
    }

    const currentHistoryMessages = this.buildHistoricalRuntimeMessages(
      input.session.id,
      branchLeafEntryId,
    );

    const sessionStatus = nextSessionStatus(input.session.status, "run_started");
    this.deps.database.updateSession(input.session.id, {
      status: sessionStatus,
      latestUserMessage: input.prompt,
    });

    this.deps.runtime.beginRun(input.run.id, input.prompt);

    this.emitEvent({
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
      resolvedSkill: null,
    };
  }

  private async loadRunResources(
    input: QueryEngineRunInput,
    prepared: PreparedRunContext,
  ): Promise<import("@omi/extensions").ExtensionRunner> {
    const { ExtensionRunner } = await import("@omi/extensions");
    await this.deps.resources.reload();

    const resolvedSkill = await this.deps.resources.resolveSkillForPrompt(input.prompt);
    const skillMatches = await this.deps.resources.searchSkills(input.prompt);

    this.emitEvent({
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

    prepared.resolvedSkill = resolvedSkill;

    const extensionRunner = new ExtensionRunner(this.deps.workspaceRoot);
    const extensionCatalog = this.deps.resources.getExtensions();
    await extensionRunner.load(extensionCatalog.items);

    this.emitEvent({
      type: "run.extensions_loaded",
      payload: {
        runId: input.run.id,
        sessionId: input.session.id,
        extensions: extensionCatalog.items.map((ext) => ext.name),
        diagnostics: extensionCatalog.diagnostics,
      },
    });

    await extensionRunner.emit({
      type: "run.extensions_loaded",
      payload: {
        runId: input.run.id,
        sessionId: input.session.id,
        extensions: extensionCatalog.items.map((ext) => ext.name),
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

    return extensionRunner;
  }

  private async buildExecutionInput(
    input: QueryEngineRunInput,
    prepared: PreparedRunContext,
    extensionRunner: import("@omi/extensions").ExtensionRunner,
  ): Promise<{ systemPrompt: string; effectivePrompt: string }> {
    const baseSystemPrompt = this.deps.resources.buildSystemPrompt(prepared.resolvedSkill);
    await extensionRunner.beforeRun({
      prompt: input.prompt,
      sessionId: input.session.id,
      workspaceRoot: this.deps.workspaceRoot,
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

    return { systemPrompt, effectivePrompt };
  }

  // ==========================================================================
  // Run finalization
  // ==========================================================================

  private async finalizeRun(
    input: QueryEngineRunInput,
    result: ProviderRunResult,
    extensionRunner: import("@omi/extensions").ExtensionRunner,
  ): Promise<void> {
    const runId = input.run.id;
    const sessionId = input.session.id;
    const assistantText = result.assistantText.trim();

    this.deps.database.updateRun(runId, { status: "completed" });
    this.deps.database.updateSession(sessionId, {
      status: nextSessionStatus(input.session.status, "run_completed"),
      latestAssistantMessage: assistantText,
    });

    const branchId =
      this.deps.database.getActiveBranchId(sessionId) ??
      this.deps.database.listBranches(sessionId).at(-1)?.id ??
      null;

    this.deps.database.addMessage({
      sessionId,
      role: "user",
      content: input.prompt,
      parentHistoryEntryId: input.historyEntryId,
      branchId,
      originRunId: runId,
    });

    if (assistantText) {
      this.deps.database.addMessage({
        sessionId,
        role: "assistant",
        content: assistantText,
        branchId,
        originRunId: runId,
      });
    }

    this.deps.runtime.completeRun(runId, assistantText);
    this.persistRuntimeSnapshot(sessionId);

    this.emitEvent({
      type: "run.completed",
      payload: { runId, sessionId, summary: assistantText },
    });

    await extensionRunner.emit({
      type: "run.completed",
      payload: { runId, sessionId, summary: assistantText },
    });

    if (input.task) {
      this.deps.database.updateTask(input.task.id, {
        status: nextTaskStatus(input.task.status, "run_completed"),
      });
    }
  }

  // ==========================================================================
  // Tool handling
  // ==========================================================================

  private async handleToolRequested(
    runId: string,
    sessionId: string,
    taskId: string | null,
    event: ProviderToolRequestedEvent,
  ): Promise<string> {
    const toolCallId = createId("tool");
    this.deps.database.createToolCall({
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

    this.emitEvent({
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
      this.deps.runtime.blockOnTool(runId, toolCallId);

      const session = this.requireSession();
      this.deps.database.updateSession(sessionId, {
        status: nextSessionStatus(session.status, "tool_blocked"),
      });

      this.emitEvent({
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
    this.deps.database.updateToolCall(toolCallId, {
      approvalState: decision,
    });

    if (decision === "approved") {
      this.deps.runtime.approveTool(runId, toolCallId);
      const session = this.requireSession();
      this.deps.database.updateSession(sessionId, {
        status: nextSessionStatus(session.status, "resume"),
      });
    } else {
      this.deps.runtime.rejectTool(runId, toolCallId);
      this.deps.database.updateRun(runId, { status: "canceled" });
      this.deps.runtime.cancelRun(runId);

      // Record rejection in denial tracker
      const toolCall = this.deps.database.getToolCall(toolCallId);
      if (toolCall) {
        this.denialTracker.recordDenial(
          `${sessionId}:${toolCall.toolName}`,
          "rejected_by_user",
        );
      }

      const session = this.requireSession();
      this.deps.database.updateSession(sessionId, {
        status: nextSessionStatus(session.status, "run_canceled"),
      });
    }

    this.emitEvent({
      type: "run.tool_decided",
      payload: { runId, sessionId, toolCallId, decision },
    });
  }

  private filterVisibleTools(toolNames: ToolName[], sessionId: string): ToolName[] {
    return this.evaluator.filterVisibleTools(toolNames, {
      toolName: "",
      planMode: this.isPlanMode(),
      sessionId,
    }) as ToolName[];
  }

  // ==========================================================================
  // Compaction
  // ==========================================================================

  private async compactHistoricalContext(input: {
    session: Session;
    providerConfig: ProviderConfig;
    mode: CompactionMode;
    prompt: string | null;
    runId: string | null;
    historyEnvelopes: SessionRuntimeMessageEnvelope[];
  }): Promise<SessionCompactionSnapshot | null> {
    const model = createModelFromConfig(input.providerConfig);
    const plan = buildCompactionPlan(input.historyEnvelopes, model.contextWindow, input.mode);
    const fallbackTokensBefore = estimateContextTokens(
      input.historyEnvelopes.map((entry) => entry.message),
    ).tokens;
    const summaryInput = plan
      ? {
          sessionId: input.session.id,
          providerConfig: input.providerConfig,
          mode: input.mode,
          tokensBefore: plan.tokensBefore,
          tokensKept: plan.tokensKept,
          keepRecentTokens: plan.keepRecentTokens,
          summaryMessages: plan.summaryMessages,
          keptMessages: plan.keptMessages,
        }
      : {
          sessionId: input.session.id,
          providerConfig: input.providerConfig,
          mode: input.mode,
          tokensBefore: fallbackTokensBefore,
          tokensKept: 0,
          keepRecentTokens: 0,
          summaryMessages: input.historyEnvelopes.map((entry) => entry.message),
          keptMessages: [] as RuntimeMessage[],
        };

    if (!plan && input.mode !== "overflow") {
      return null;
    }

    const summary = this.deps.compactionSummarizer
      ? await this.deps.compactionSummarizer.summarize(summaryInput)
      : {
          version: 1 as const,
          goal: `Compacted ${input.mode} context for ${input.session.id}`,
          constraints: [`prompt:${input.prompt ?? "n/a"}`],
          progress: {
            done: [`summarized:${summaryInput.summaryMessages.length}`],
            inProgress: [`kept:${summaryInput.keptMessages.length}`],
            blocked: [],
          },
          keyDecisions: [`tokensBefore:${summaryInput.tokensBefore}`],
          nextSteps: [`resume:${input.mode}`],
          criticalContext: [
            `provider:${input.providerConfig.type}`,
            `tokensKept:${summaryInput.tokensKept}`,
          ],
        };

    const snapshot = sessionCompactionSnapshotSchema.parse({
      version: 1,
      summary,
      compactedAt: nowIso(),
      firstKeptHistoryEntryId: plan?.firstKeptHistoryEntryId ?? null,
      firstKeptTimestamp: plan?.firstKeptTimestamp ?? nowIso(),
      tokensBefore: plan?.tokensBefore ?? summaryInput.tokensBefore,
      tokensKept: plan?.tokensKept ?? summaryInput.tokensKept,
    });

    this.deps.runtime.completeCompaction({
      summary: snapshot.summary,
      compactedAt: snapshot.compactedAt,
    });

    if (this.deps.database.addSessionHistoryEntry) {
      const branchId =
        this.deps.database.getActiveBranchId(input.session.id) ??
        this.deps.database.listBranches(input.session.id).at(-1)?.id ??
        null;
      const parentHistoryEntry =
        this.deps.database.listSessionHistoryEntries?.(input.session.id).at(-1) ?? null;
      const details = {
        mode: input.mode,
        prompt: input.prompt,
        cutoffIndex: plan?.cutoffIndex ?? 0,
        tokensBefore: plan?.tokensBefore ?? summaryInput.tokensBefore,
        tokensKept: plan?.tokensKept ?? summaryInput.tokensKept,
        keepRecentTokens: plan?.keepRecentTokens ?? summaryInput.keepRecentTokens,
      };

      this.deps.database.addSessionHistoryEntry!({
        sessionId: input.session.id,
        parentId: parentHistoryEntry?.id ?? null,
        kind: "branch_summary",
        messageId: null,
        summary: snapshot.summary.goal,
        details: normalizeHistoryDetails(details),
        branchId,
        lineageDepth: parentHistoryEntry ? parentHistoryEntry.lineageDepth + 1 : 0,
        originRunId: input.runId,
      });
    }

    return snapshot;
  }

  /**
   * Run the context pipeline before a model call.
   * Implements the full pipeline: tool result budget -> micro compact -> context collapse -> auto compact.
   */
  private async runContextPipeline(
    session: Session,
    providerConfig: ProviderConfig,
    messages: RuntimeMessage[],
    runId: string,
  ): Promise<{ messages: RuntimeMessage[]; didCompact: boolean; snapshot?: SessionCompactionSnapshot }> {
    const pipelineConfig: ContextPipelineConfig = {
      providerConfig,
      summarizer: this.deps.compactionSummarizer,
      enableMicroCompact: this.deps.contextPipelineConfig?.enableMicroCompact ?? true,
      enableContextCollapse: this.deps.contextPipelineConfig?.enableContextCollapse ?? true,
      maxToolResultTokens: this.deps.contextPipelineConfig?.maxToolResultTokens ?? 2000,
      collapseHeadroomRatio: this.deps.contextPipelineConfig?.collapseHeadroomRatio ?? 0.15,
    };

    const pipeline = new ContextPipeline(pipelineConfig);
    const usageEstimate = estimateContextTokens(messages);
    this.state.compactTracking.lastContextTokens = usageEstimate.tokens;

    const result = await pipeline.execute({
      messages,
      session,
      usageEstimate,
    });

    // If full compaction occurred, update runtime and database
    if (result.compactionSnapshot) {
      this.deps.runtime.completeCompaction({
        summary: result.compactionSnapshot.summary,
        compactedAt: result.compactionSnapshot.compactedAt,
      });

      if (this.deps.database.addSessionHistoryEntry) {
        const branchId =
          this.deps.database.getActiveBranchId(session.id) ??
          this.deps.database.listBranches(session.id).at(-1)?.id ??
          null;
        const parentHistoryEntry =
          this.deps.database.listSessionHistoryEntries?.(session.id).at(-1) ?? null;
        const details = {
          mode: "pipeline",
          tokensBefore: result.usageEstimate.tokens,
          tokensKept: result.compactionSnapshot.tokensKept,
          stages: pipeline.getReport().stages.filter((s) => s.didModify).map((s) => s.name),
        };

        this.deps.database.addSessionHistoryEntry!({
          sessionId: session.id,
          parentId: parentHistoryEntry?.id ?? null,
          kind: "branch_summary",
          messageId: null,
          summary: result.compactionSnapshot.summary.goal,
          details: normalizeHistoryDetails(details),
          branchId,
          lineageDepth: parentHistoryEntry ? parentHistoryEntry.lineageDepth + 1 : 0,
          originRunId: runId,
        });
      }
    }

    return {
      messages: result.messages,
      didCompact: result.didCompact,
      snapshot: result.compactionSnapshot,
    };
  }

  /**
   * Check context health before making a model call.
   * Returns warning state and whether action is recommended.
   */
  private checkContextHealth(
    messages: RuntimeMessage[],
    providerConfig: ProviderConfig,
  ): {
    warningState: TokenWarningState;
    budget: ContextBudget;
    needsAttention: boolean;
    usageTokens: number;
  } {
    const budget = createContextBudget(providerConfig);
    const usage = estimateContextTokens(messages);
    if (budget.effectiveContextWindow <= 0) {
      return {
        warningState: {
          percentLeft: 100,
          isAboveAutoCompactThreshold: false,
          isAboveWarningThreshold: false,
          isAboveErrorThreshold: false,
          isAtBlockingLimit: false,
        },
        budget,
        needsAttention: false,
        usageTokens: usage.tokens,
      };
    }
    const warningState = calculateTokenWarningState(usage.tokens, budget);
    const needsAttention = needsContextAttention(usage.tokens, budget);

    return { warningState, budget, needsAttention, usageTokens: usage.tokens };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private isPlanMode(): boolean {
    return this.planStateManager.isInPlanMode();
  }

  private createMaxOutputContinuationMessage(): RuntimeMessage {
    return {
      role: "user",
      content: "Continue from your last response without repeating completed parts.",
      timestamp: Date.now(),
    };
  }

  private requireSession(): Session {
    const session = this.deps.database.getSession(this.deps.sessionId);
    if (!session) {
      throw new Error(`Session ${this.deps.sessionId} not found`);
    }
    return session;
  }

  private buildHistoricalRuntimeMessages(
    sessionId: string,
    branchLeafEntryId: string | null = null,
  ): RuntimeMessage[] {
    const historyEntries = this.deps.database.listSessionHistoryEntries?.(sessionId) ?? [];
    return buildSessionRuntimeMessages({
      messages: this.deps.database.listMessages(sessionId),
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
    const historyEntries = this.deps.database.listSessionHistoryEntries?.(sessionId) ?? [];
    return buildSessionRuntimeMessageEnvelopes({
      messages: this.deps.database.listMessages(sessionId),
      toolCalls: this.listSessionToolCalls(sessionId),
      compaction: this.buildRuntimeCompactionSnapshot(),
      historyEntries,
      branchLeafEntryId,
    });
  }

  private listSessionToolCalls(sessionId: string): ToolCall[] {
    const runs = this.deps.database.listRuns(sessionId);
    return runs.flatMap((run) => this.deps.database.listToolCalls(run.id));
  }

  private buildRuntimeCompactionSnapshot(): SessionCompactionSnapshot | null {
    const compaction = this.deps.runtime.snapshot().compaction;
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
    this.deps.database.saveSessionRuntimeSnapshot({
      sessionId,
      snapshot: JSON.stringify(this.deps.runtime.snapshot()),
      updatedAt: nowIso(),
    });
  }

  private emitEvent(event: QueryEngineEvent): void {
    this.deps.emit(event);
  }

  private async delayWithAbort(ms: number, runId: string): Promise<void> {
    const start = Date.now();
    const interval = 100;

    while (Date.now() - start < ms) {
      if (this.canceled || this.deps.database.getRun(runId)?.status === "canceled") {
        return;
      }
      const remaining = ms - (Date.now() - start);
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(interval, remaining)));
    }
  }
}

// ==========================================================================
// Exported helper functions (pure, for testability)
// ==========================================================================

export function nextSessionStatus(
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

export function nextTaskStatus(current: Task["status"], event: "run_completed"): Task["status"] {
  if (event === "run_completed") {
    return current === "active" ? "review" : current;
  }
  return current;
}

export function normalizeHistoryDetails(details: unknown): Record<string, unknown> | null {
  if (details === null || details === undefined) {
    return null;
  }
  if (typeof details === "object" && !Array.isArray(details)) {
    return details as Record<string, unknown>;
  }
  return { value: details };
}
