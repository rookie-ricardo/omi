import type { CompactionSummaryDocument, ProviderConfig, Run, Session, Task, ToolCall } from "@omi/core";
import { nowIso } from "@omi/core";
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
  buildContextBudget,
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
import { createModelFromConfig, PiAiProvider, CostTracker, createCostTracker, buildStableToolCallId } from "@omi/provider";
import type { ProviderAdapter, ProviderRunResult, ModelToolCall } from "@omi/provider";
import type { ToolResultMessage, Message as PiAiMessage } from "@mariozechner/pi-ai";
import { SAFE_TOOL_NAMES, listBuiltInToolNames, createAllTools, requiresApproval, isBuiltInTool } from "@omi/tools";
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
import { getPlanStateManager, type AllowedPrompt } from "./modes/plan-mode";

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
  /** Cost tracker for token/USD budget enforcement. */
  costTracker?: CostTracker;
  /** Hook registry for lifecycle event interception. */
  hookRegistry?: import("@omi/extensions").HookRegistry;
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

interface FallbackCompactionRecoveryBundle {
  version: 1;
  mode: CompactionMode;
  generatedAt: string;
  firstKeptHistoryEntryId: string | null;
  firstKeptTimestamp: string | null;
  summarizedMessages: FallbackCompactionRecoveryMessage[];
  keptMessages: FallbackCompactionRecoveryMessage[];
}

interface FallbackCompactionRecoveryMessage {
  role: RuntimeMessage["role"];
  token: string;
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
  private suspended = false;
  private recoveryEngine: RecoveryEngine | null = null;
  private readonly planStateManager = getPlanStateManager();
  private readonly costTracker: CostTracker | null;
  private readonly hookRegistry: import("@omi/extensions").HookRegistry | null;
  private abortController: AbortController | null = null;
  private readonly pendingApprovals = new Map<string, { runId: string; resolve: (decision: "approved" | "rejected") => void }>();

  constructor(private readonly deps: QueryEngineDeps) {
    this.provider = deps.provider ?? new PiAiProvider();
    this.state = createInitialMutableState();
    // Initialize permission evaluator with denial tracker
    this.denialTracker = deps.denialTracker ?? new MemoryDenialTracker();
    this.evaluator = deps.evaluator ?? createPermissionEvaluator()
      .withDenialTracker(this.denialTracker)
      .build();
    this.costTracker = deps.costTracker ?? null;
    this.hookRegistry = deps.hookRegistry ?? null;
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
    this.abortController?.abort();
    // Resolve all pending approvals as rejected
    for (const [id, pending] of this.pendingApprovals.entries()) {
      this.pendingApprovals.delete(id);
      pending.resolve("rejected");
    }
  }

  approveTool(toolCallId: string): void {
    const pending = this.pendingApprovals.get(toolCallId);
    if (!pending) return;
    this.pendingApprovals.delete(toolCallId);
    pending.resolve("approved");
  }

  rejectTool(toolCallId: string): void {
    const pending = this.pendingApprovals.get(toolCallId);
    if (!pending) return;
    this.pendingApprovals.delete(toolCallId);
    pending.resolve("rejected");
  }

  // ==========================================================================
  // Main execution loop (state machine driver)
  // ==========================================================================

  async execute(input: QueryEngineRunInput): Promise<QueryEngineResult> {
    this.state = createInitialMutableState();
    this.currentRunId = input.run.id;
    this.canceled = false;
    this.suspended = false;
    this.abortController = new AbortController();

    // Initialize recovery engine for this run
    this.recoveryEngine = new RecoveryEngine({
      store: this.deps.database,
      runId: input.run.id,
      sessionId: input.session.id,
      emit: (event) => this.emitEvent(event),
      sourceRunId: input.run.sourceRunId ?? null,
      resumeFromCheckpointId: input.run.resumeFromCheckpoint ?? null,
    });
    const restoredCheckpoint = this.recoveryEngine.restoreFromCheckpoint();
    if (restoredCheckpoint) {
      this.state.turnCount = restoredCheckpoint.turnCount;
      this.state.recoveryCount = restoredCheckpoint.recoveryCount;
      this.state.compactTracking = {
        ...this.state.compactTracking,
        ...restoredCheckpoint.compactTracking,
      };
    }

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

      let currentHistoryMessages = prepared.currentHistoryMessages;
      // Build the pi-ai message array that we'll maintain across turns
      let llmMessages = convertRuntimeMessagesToLlm(currentHistoryMessages);

      const retrySettings =
        this.deps.settingsManager?.getRetrySettings?.() ?? DEFAULT_RETRY_SETTINGS;

      // Build tools once for all turns
      const resolvedToolNames = prepared.resolvedSkill?.enabledToolNames.length
        ? this.filterVisibleTools(prepared.resolvedSkill.enabledToolNames as ToolName[], input.session.id)
        : this.filterVisibleTools(listBuiltInToolNames(), input.session.id);
      const tools = this.buildToolsForProvider(this.deps.workspaceRoot, resolvedToolNames);

      // ========== THE AGENTIC LOOP ==========
      while (true) {
        // preprocess_context -> calling_model
        this.transition("calling_model", "context_prepared");

        // Run context pipeline (compaction if needed)
        const pipelineResult = await this.runContextPipeline(
          input.session,
          input.providerConfig,
          currentHistoryMessages,
          input.run.id,
        );
        if (pipelineResult.didCompact) {
          currentHistoryMessages = pipelineResult.messages;
          this.state.messages = currentHistoryMessages;
          llmMessages = convertRuntimeMessagesToLlm(currentHistoryMessages);
        }

        // Budget/cancel checks
        if (this.state.budget.maxTurns > 0 && this.state.turnCount >= this.state.budget.maxTurns) {
          return this.terminate("max_turns", null);
        }
        if (this.costTracker && this.state.budget.maxBudgetUsd > 0) {
          this.costTracker.setBudget(this.state.budget.maxBudgetUsd);
          if (this.costTracker.isBudgetExceeded()) {
            return this.terminate("budget_exceeded", `Cost budget exceeded: ${this.costTracker.formatSummary()}`);
          }
        }
        if (this.canceled) return this.terminate("canceled", null);
        if (this.suspended) return this.terminate("suspended", null);

        // Context health check
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
              llmMessages = convertRuntimeMessagesToLlm(currentHistoryMessages);
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
        this.recoveryEngine!.saveCheckpoint("before_model_call", {
          turnCount: this.state.turnCount,
          recoveryCount: this.state.recoveryCount,
          compactTracking: this.state.compactTracking,
          partialAssistantText: "",
        });

        // calling_model -> streaming_response
        this.transition("streaming_response", "calling_model");

        let result: ProviderRunResult;
        try {
          result = await this.callProviderSingleTurn({
            input,
            systemPrompt: executionInput.systemPrompt,
            effectivePrompt: executionInput.effectivePrompt,
            llmMessages,
            resolvedSkill: prepared.resolvedSkill,
            providerConfig: input.providerConfig,
            tools,
          });
        } catch (error) {
          // Error classification and recovery via RecoveryEngine
          const { action } = this.recoveryEngine!.classifyAndDecide(error, {
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
            this.transition("preprocess_context", "retry");
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
              llmMessages = convertRuntimeMessagesToLlm(currentHistoryMessages);
              this.transition("preprocess_context", "overflow_retry");
              continue;
            }
            return this.terminate(
              "budget_exceeded",
              error instanceof Error ? error.message : String(error),
            );
          }
          if (action.kind === "max_output_recovery") {
            this.transition("recovering", "max_output_recovery");
            this.state.compactTracking.maxOutputRecoveryCount++;
            const continuationMsg = this.createMaxOutputContinuationMessage();
            currentHistoryMessages = [...currentHistoryMessages, continuationMsg];
            this.state.messages = currentHistoryMessages;
            llmMessages = convertRuntimeMessagesToLlm(currentHistoryMessages);
            this.transition("preprocess_context", "max_output_retry");
            continue;
          }
          if (action.kind === "fail") {
            return this.terminate(action.terminalReason, error instanceof Error ? error.message : String(error));
          }
          continue;
        }

        // Increment turn count for each model call
        this.state.turnCount++;

        // Handle cancellation after streaming
        if (this.canceled) return this.terminate("canceled", null);
        if (this.suspended) return this.terminate("suspended", null);

        // Handle error result
        if (result.error && result.stopReason === "error") {
          return this.terminate("error", result.error);
        }

        // Checkpoint: after_model_stream
        this.recoveryEngine!.saveCheckpoint("after_model_stream", {
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

        // Emit assistant message event
        this.emitEvent({
          type: "run.assistant_message",
          payload: { runId: input.run.id, sessionId: input.session.id, text: result.assistantText },
        });

        // Append assistant message to LLM message history
        if (result.assistantMessage) {
          llmMessages.push(result.assistantMessage as PiAiMessage);
        }

        // If no tool calls -> finalize
        const hasToolCalls = result.stopReason === "tool_use" && result.toolCalls.length > 0;
        if (!hasToolCalls) {
          this.transition("post_tool_merge", "model_response_complete");

          // Checkpoint: before_terminal_commit
          this.recoveryEngine!.saveCheckpoint("before_terminal_commit", {
            turnCount: this.state.turnCount,
            recoveryCount: this.state.recoveryCount,
            compactTracking: this.state.compactTracking,
            partialAssistantText: result.assistantText,
          });

          await this.finalizeRun(input, result, extensionRunner);
          return this.terminate("completed", null, result.assistantText);
        }

        // streaming_response -> executing_tools
        this.transition("executing_tools", "tool_calls_present");

        // Execute tools
        const toolResults = await this.executeToolBatch({
          toolCalls: result.toolCalls,
          runId: input.run.id,
          sessionId: input.session.id,
          taskId: input.task?.id ?? null,
          extensionRunner,
          tools,
        });

        // Checkpoint: after_tool_batch
        this.recoveryEngine!.saveCheckpoint("after_tool_batch", {
          turnCount: this.state.turnCount,
          recoveryCount: this.state.recoveryCount,
          compactTracking: this.state.compactTracking,
          partialAssistantText: result.assistantText,
        });

        // executing_tools -> post_tool_merge
        this.transition("post_tool_merge", "tool_execution_complete");

        // Append tool results to LLM messages
        llmMessages.push(...toolResults);

        // post_tool_merge -> preprocess_context (THE LOOP BACK!)
        this.transition("preprocess_context", "tool_results_merged");

        // Check cancellation/suspension after tool execution
        if (this.canceled) return this.terminate("canceled", null);
        if (this.suspended) return this.terminate("suspended", null);

        // Continue the loop for next model call
      }
    } catch (error) {
      return this.terminate(
        "error",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.abortController = null;
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
      costSnapshot: this.costTracker?.snapshot() ?? null,
    });

    return {
      terminalReason: reason,
      turnCount: this.state.turnCount,
      assistantText,
      error,
    };
  }

  // ==========================================================================
  // Provider call (single-turn)
  // ==========================================================================

  private async callProviderSingleTurn(params: {
    input: QueryEngineRunInput;
    systemPrompt: string;
    effectivePrompt: string;
    llmMessages: PiAiMessage[];
    resolvedSkill: ResolvedSkill | null;
    providerConfig: ProviderConfig;
    tools: import("@omi/core").OmiTool[];
  }): Promise<ProviderRunResult> {
    const { input, systemPrompt, effectivePrompt, llmMessages, resolvedSkill, providerConfig, tools } = params;
    const resolvedToolNames = resolvedSkill?.enabledToolNames.length
      ? this.filterVisibleTools(resolvedSkill.enabledToolNames as ToolName[], input.session.id)
      : this.filterVisibleTools(listBuiltInToolNames(), input.session.id);

    const result = await this.provider.run({
      runId: input.run.id,
      sessionId: input.session.id,
      workspaceRoot: this.deps.workspaceRoot,
      prompt: effectivePrompt,
      historyMessages: llmMessages,
      systemPrompt,
      providerConfig,
      enabledTools: resolvedToolNames,
      tools: tools.filter(t => resolvedToolNames.includes(t.name)),
      toolExecutionMode: resolveToolExecutionMode(
        resolvedSkill?.enabledToolNames as ToolName[] | undefined,
      ),
      signal: this.abortController?.signal,
      onTextDelta: (delta) => {
        this.emitEvent({
          type: "run.delta",
          payload: { runId: input.run.id, sessionId: input.session.id, delta },
        });
      },
    });

    if (!result) {
      throw new Error(`Run ${input.run.id} did not produce a result.`);
    }

    // Check if run was canceled in DB during the call
    if (this.deps.database.getRun(input.run.id)?.status === "canceled") {
      throw new Error("Run was canceled");
    }

    return result;
  }

  // ==========================================================================
  // Tool execution
  // ==========================================================================

  private async executeToolBatch(params: {
    toolCalls: ModelToolCall[];
    runId: string;
    sessionId: string;
    taskId: string | null;
    extensionRunner: import("@omi/extensions").ExtensionRunner;
    tools: import("@omi/core").OmiTool[];
  }): Promise<ToolResultMessage[]> {
    const { toolCalls, runId, sessionId, taskId, extensionRunner, tools } = params;
    const toolResults: ToolResultMessage[] = [];

    const executeSingleTool = async (toolCall: ModelToolCall): Promise<ToolResultMessage> => {
      const { id: piToolCallId, name: toolName, input: toolInput } = toolCall;
      const toolCallId = buildStableToolCallId(runId, toolCall, toolName, toolInput);
      let toolError = false;
      let toolOutput: any = "Unknown Error";

      try {
        // 1. PreToolUse hooks
        if (this.hookRegistry?.hasHooks("PreToolUse")) {
          const hookOutputs = await this.hookRegistry.execute("PreToolUse", {
            event: "PreToolUse",
            toolName,
            toolInput,
            sessionId,
            cwd: this.deps.workspaceRoot,
          });
          const { shouldBlock, getBlockReason } = await import("@omi/extensions");
          if (shouldBlock(hookOutputs)) {
            const reason = getBlockReason(hookOutputs) ?? `Tool '${toolName}' blocked by PreToolUse hook.`;
            this.emitEvent({
              type: "run.tool_denied",
              payload: { runId, sessionId, toolName, reason, source: "hook" },
            });
            toolError = true;
            toolOutput = { error: reason };
            return this.buildToolResultMessage(piToolCallId, toolName, toolOutput, toolError);
          }
        }

        // 2. Permission check
        const planMode = this.isPlanMode();
        const preflight = this.evaluator.preflightCheck({
          toolName,
          input: toolInput,
          planMode,
          sessionId,
        });

        // 3. Replay protection check
        if (preflight.decision !== "deny" && this.recoveryEngine?.shouldSkipTool("", toolName, toolInput)) {
          const replayReason = `Skipped replayed write tool: ${toolName}`;
          this.emitEvent({
            type: "run.tool_denied",
            payload: { runId, sessionId, toolName, reason: replayReason },
          });
          toolError = true;
          toolOutput = { error: replayReason };
          return this.buildToolResultMessage(piToolCallId, toolName, toolOutput, toolError);
        }

        if (preflight.decision === "deny") {
          const reason = preflight.reason ?? `Tool '${toolName}' is denied by permission policy.`;
          this.emitEvent({
            type: "run.tool_denied",
            payload: { runId, sessionId, toolName, reason },
          });
          toolError = true;
          toolOutput = { error: reason };
          return this.buildToolResultMessage(piToolCallId, toolName, toolOutput, toolError);
        }

        // 4. Check approved prompts (plan mode)
        const matchedAllowedPrompt = this.matchApprovedPrompt(toolName, toolInput);
        const needsApproval = !matchedAllowedPrompt &&
          (preflight.decision === "ask" || (isBuiltInTool(toolName) ? requiresApproval(toolName) : false));

        if (matchedAllowedPrompt) {
          this.emitEvent({
            type: "run.allowed_prompt_matched",
            payload: { runId, sessionId, toolName, prompt: matchedAllowedPrompt },
          });
        }

        // 5. Record tool call in DB
        this.deps.database.createToolCall({
          id: toolCallId,
          runId,
          sessionId,
          taskId,
          toolName,
          approvalState: needsApproval ? "pending" : "not_required",
          input: toolInput,
          output: null,
          error: null,
        });

        this.emitEvent({
          type: "run.tool_requested",
          payload: { runId, sessionId, toolCallId, toolName, requiresApproval: needsApproval, input: toolInput },
        });

        await extensionRunner.emit({
          type: "run.tool_requested",
          payload: { runId, sessionId, toolName, input: toolInput, requiresApproval: needsApproval },
        });

        // 6. Block for approval if needed
        if (needsApproval) {
          this.deps.runtime.blockOnTool(runId, toolCallId);
          const session = this.requireSession();
          this.deps.database.updateSession(sessionId, {
            status: nextSessionStatus(session.status, "tool_blocked"),
          });
          this.emitEvent({
            type: "run.blocked",
            payload: { runId, toolCallId, reason: `Waiting for approval: ${toolName}` },
          });

          // Wait for user decision
          const decision = await new Promise<"approved" | "rejected">((resolve) => {
            this.pendingApprovals.set(toolCallId, { runId, resolve });
          });
          this.pendingApprovals.delete(toolCallId);

          // Record decision
          this.handleToolDecision(runId, sessionId, toolCallId, decision);

          if (decision === "rejected") {
            toolError = true;
            toolOutput = { error: "Tool execution rejected by user." };
            return this.buildToolResultMessage(piToolCallId, toolName, toolOutput, toolError);
          }
        }

        // 7. Emit tool started
        this.emitEvent({
          type: "run.tool_started",
          payload: { runId, toolCallId, toolName },
        });
        void extensionRunner.emit({
          type: "run.tool_started",
          payload: { runId, sessionId, toolCallId, toolName },
        });

        // 8. Execute the tool
        const toolDef = tools.find(t => t.name === toolName);
        if (!toolDef) {
          toolError = true;
          toolOutput = { error: `Tool ${toolName} not found` };
        } else {
          const execResult = await toolDef.execute(
            toolCallId,
            toolInput,
            this.abortController?.signal ?? new AbortController().signal,
            (_update) => {
              // Tool update callback
            },
          );
          toolOutput = execResult.content;
        }
      } catch (e) {
        toolError = true;
        toolOutput = { error: e instanceof Error ? e.message : String(e) };
      }

      // 9. Record write tool for replay protection
      this.recoveryEngine?.recordWriteTool(toolCallId, toolName, toolInput);

      // 10. Update tool call in DB
      this.deps.database.updateToolCall(toolCallId, {
        output: toolOutput,
        error: toolError ? JSON.stringify(toolOutput) : null,
      });

      // 11. Emit tool finished
      this.emitEvent({
        type: "run.tool_finished",
        payload: { runId, toolCallId, toolName, output: toolOutput },
      });
      void extensionRunner.emit({
        type: "run.tool_finished",
        payload: { runId, sessionId, toolCallId, toolName, output: toolOutput, isError: toolError },
      });

      // 12. PostToolUse hooks
      if (this.hookRegistry?.hasHooks("PostToolUse") || this.hookRegistry?.hasHooks("PostToolUseFailure")) {
        const hookEvent = toolError ? "PostToolUseFailure" : "PostToolUse";
        void this.hookRegistry.execute(hookEvent as import("@omi/extensions").HookEvent, {
          event: hookEvent,
          toolName,
          toolOutput,
          toolUseId: toolCallId,
          sessionId,
          cwd: this.deps.workspaceRoot,
          error: toolError ? JSON.stringify(toolOutput) : undefined,
        });
      }

      // 13. Check for interrupt/suspension
      if (!toolError && toolOutput?.details && typeof toolOutput.details === "object" && (toolOutput.details as any).isInterrupt) {
        this.suspended = true;
      }

      return this.buildToolResultMessage(piToolCallId, toolName, toolOutput, toolError);
    };

    // Execute sequentially by default
    for (const toolCall of toolCalls) {
      if (this.abortController?.signal.aborted || this.canceled) break;
      const result = await executeSingleTool(toolCall);
      toolResults.push(result);
    }

    return toolResults;
  }

  private buildToolResultMessage(
    piToolCallId: string,
    toolName: string,
    output: any,
    isError: boolean,
  ): ToolResultMessage {
    return {
      role: "toolResult",
      toolCallId: piToolCallId,
      toolName,
      content: Array.isArray(output)
        ? output
        : [{ type: "text", text: typeof output === "string" ? output : JSON.stringify(output) }],
      isError,
      timestamp: Date.now(),
    } as ToolResultMessage;
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
    const runtimePrompt = renderRuntimeMessagesForPrompt(extensionRunner.getRuntimeMessages() as RuntimeMessage[]);
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

  /**
   * Build OmiTool[] for the provider from the tools package.
   * This is the single place where tool instances are created for provider consumption.
   */
  private buildToolsForProvider(workspaceRoot: string, enabledTools?: ToolName[]): import("@omi/core").OmiTool[] {
    const allTools = createAllTools(workspaceRoot);
    const toolArray = Object.values(allTools);

    if (!enabledTools || enabledTools.length === 0) {
      return toolArray;
    }

    const allowed = new Set(enabledTools);
    return toolArray.filter((tool) => allowed.has(tool.name));
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
          model,
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
          model,
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

    let summary: CompactionSummaryDocument;
    let fallbackRecoveryBundle: FallbackCompactionRecoveryBundle | null = null;
    if (this.deps.compactionSummarizer) {
      summary = await this.deps.compactionSummarizer.summarize(summaryInput);
    } else {
      fallbackRecoveryBundle = this.buildFallbackCompactionRecoveryBundle({
        mode: input.mode,
        firstKeptHistoryEntryId: plan?.firstKeptHistoryEntryId ?? null,
        firstKeptTimestamp: plan?.firstKeptTimestamp ?? null,
        summaryMessages: summaryInput.summaryMessages,
        keptMessages: summaryInput.keptMessages,
      });
      summary = this.buildFallbackCompactionSummary(input, summaryInput, fallbackRecoveryBundle);
    }

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
        branchId
          ? this.deps.database.getBranchHistory(input.session.id, branchId).at(-1) ?? null
          : this.deps.database.listSessionHistoryEntries?.(input.session.id).at(-1) ?? null;
      const details = {
        mode: input.mode,
        prompt: input.prompt,
        cutoffIndex: plan?.cutoffIndex ?? 0,
        tokensBefore: plan?.tokensBefore ?? summaryInput.tokensBefore,
        tokensKept: plan?.tokensKept ?? summaryInput.tokensKept,
        keepRecentTokens: plan?.keepRecentTokens ?? summaryInput.keepRecentTokens,
        summaryDocument: snapshot.summary,
        fallbackRecovery: fallbackRecoveryBundle,
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

  private buildFallbackCompactionSummary(
    input: {
      session: Session;
      providerConfig: ProviderConfig;
      mode: CompactionMode;
      prompt: string | null;
    },
    summaryInput: {
      tokensBefore: number;
      tokensKept: number;
      keepRecentTokens: number;
      summaryMessages: RuntimeMessage[];
      keptMessages: RuntimeMessage[];
    },
    fallbackRecoveryBundle: FallbackCompactionRecoveryBundle,
  ): CompactionSummaryDocument {
    return {
      version: 1,
      goal: `Compaction fallback snapshot (${input.mode})`,
      constraints: [
        `session_id=${input.session.id}`,
        `provider=${input.providerConfig.type}`,
        `prompt=${this.truncateFallbackToken(input.prompt ?? "n/a")}`,
      ],
      progress: {
        done: [`summarized_messages=${summaryInput.summaryMessages.length}`],
        inProgress: [`kept_messages=${summaryInput.keptMessages.length}`],
        blocked: [],
      },
      keyDecisions: [
        `tokens_before=${summaryInput.tokensBefore}`,
        `tokens_kept=${summaryInput.tokensKept}`,
        `keep_recent_tokens=${summaryInput.keepRecentTokens}`,
      ],
      nextSteps: [`resume_mode=${input.mode}`, "recovery_source=fallbackRecovery"],
      criticalContext: [
        `first_kept_history_entry_id=${fallbackRecoveryBundle.firstKeptHistoryEntryId ?? "null"}`,
        `first_kept_timestamp=${fallbackRecoveryBundle.firstKeptTimestamp ?? "null"}`,
        ...fallbackRecoveryBundle.summarizedMessages
          .slice(0, 8)
          .map((entry) => `summarized:${entry.role}:${entry.token}`),
        ...fallbackRecoveryBundle.keptMessages
          .slice(0, 8)
          .map((entry) => `kept:${entry.role}:${entry.token}`),
      ],
    };
  }

  private buildFallbackCompactionRecoveryBundle(input: {
    mode: CompactionMode;
    firstKeptHistoryEntryId: string | null;
    firstKeptTimestamp: string | null;
    summaryMessages: RuntimeMessage[];
    keptMessages: RuntimeMessage[];
  }): FallbackCompactionRecoveryBundle {
    return {
      version: 1,
      mode: input.mode,
      generatedAt: nowIso(),
      firstKeptHistoryEntryId: input.firstKeptHistoryEntryId,
      firstKeptTimestamp: input.firstKeptTimestamp,
      summarizedMessages: input.summaryMessages.map((message) =>
        this.toFallbackRecoveryMessage(message)
      ),
      keptMessages: input.keptMessages.map((message) => this.toFallbackRecoveryMessage(message)),
    };
  }

  private toFallbackRecoveryMessage(message: RuntimeMessage): FallbackCompactionRecoveryMessage {
    switch (message.role) {
      case "user":
        return {
          role: message.role,
          token: this.truncateFallbackToken(this.runtimeContentToText(message.content)),
        };
      case "assistantTranscript":
        return {
          role: message.role,
          token: this.truncateFallbackToken(message.content),
        };
      case "runtimeToolOutput":
        return {
          role: message.role,
          token: `${message.toolName}:${message.isError ? "error" : "ok"}:${this.truncateFallbackToken(
            this.runtimeContentToText(message.content),
          )}`,
        };
      case "compactionSummary":
        return {
          role: message.role,
          token: this.truncateFallbackToken(message.summary.goal),
        };
      case "branchSummary":
        return {
          role: message.role,
          token: this.truncateFallbackToken(message.summary),
        };
      case "bashExecution":
        return {
          role: message.role,
          token: this.truncateFallbackToken(message.command),
        };
      default:
        return {
          role: message.role,
          token: this.truncateFallbackToken(JSON.stringify(message)),
        };
    }
  }

  private runtimeContentToText(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }
    if (!Array.isArray(content)) {
      return "";
    }
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("");
  }

  private truncateFallbackToken(value: string, maxLength = 180): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, maxLength)}...`;
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
      model: createModelFromConfig(providerConfig),
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
          branchId
            ? this.deps.database.getBranchHistory(session.id, branchId).at(-1) ?? null
            : this.deps.database.listSessionHistoryEntries?.(session.id).at(-1) ?? null;
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
    const budget = buildContextBudget(createModelFromConfig(providerConfig));
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

  private matchApprovedPrompt(
    toolName: string,
    input: Record<string, unknown>,
  ): string | null {
    if (this.isPlanMode()) {
      return null;
    }
    const approvedPrompts = this.planStateManager.getApprovedPrompts();
    if (approvedPrompts.length === 0) {
      return null;
    }
    const normalizedToolName = toolName.toLowerCase();
    const serializedInput = JSON.stringify(input).toLowerCase();

    for (const approvedPrompt of approvedPrompts) {
      if (!this.allowedPromptMatchesTool(approvedPrompt, normalizedToolName)) {
        continue;
      }
      const promptNeedle = approvedPrompt.prompt.trim().toLowerCase();
      if (promptNeedle.length === 0) {
        continue;
      }
      if (serializedInput.includes(promptNeedle)) {
        return approvedPrompt.prompt;
      }
    }
    return null;
  }

  private allowedPromptMatchesTool(
    prompt: AllowedPrompt,
    normalizedToolName: string,
  ): boolean {
    const category = prompt.tool.trim().toLowerCase();
    if (category === normalizedToolName) {
      return true;
    }
    if (category === "bash") {
      return normalizedToolName === "bash";
    }
    if (category === "edit") {
      return normalizedToolName === "edit" || normalizedToolName === "multi_edit";
    }
    if (category === "write") {
      return normalizedToolName === "write";
    }
    return false;
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
