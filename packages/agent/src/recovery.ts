import type { Run, RunCheckpoint, RunCheckpointPhase } from "@omi/core";
import { createId } from "@omi/core";
import {
  isOverflowError,
  isRetryableError,
  extractRetryAfterDelay,
} from "@omi/memory";
import type { AppStore } from "@omi/store";
import type { QueryLoopMutableState, TerminalReason } from "./query-state";

// ============================================================================
// Error Classification
// ============================================================================

export type ErrorClass =
  | "network"
  | "rate_limit"
  | "auth"
  | "prompt_too_long"
  | "max_output"
  | "tool_error"
  | "cancelled"
  | "unknown";

export function classifyError(error: unknown): ErrorClass {
  if (error === null || error === undefined) {
    return "unknown";
  }

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  // Auth errors (non-retryable)
  if (/\b401\b/.test(message) || /\b403\b/.test(message) ||
      lowerMessage.includes("unauthorized") || lowerMessage.includes("invalid api key") ||
      lowerMessage.includes("forbidden") || lowerMessage.includes("authentication")) {
    return "auth";
  }

  // Max output tokens (must check BEFORE isOverflowError to avoid misclassification)
  if (lowerMessage.includes("max_output") || lowerMessage.includes("max output") ||
      lowerMessage.includes("output token limit") ||
      (lowerMessage.includes("max_tokens") && lowerMessage.includes("output"))) {
    return "max_output";
  }

  // Prompt too long / context overflow (needs compaction)
  if (isOverflowError(error)) {
    return "prompt_too_long";
  }

  // Rate limit
  if (/\b429\b/.test(message) || lowerMessage.includes("rate limit") ||
      lowerMessage.includes("ratelimit") || lowerMessage.includes("rate_limit")) {
    return "rate_limit";
  }

  // Network errors
  if (lowerMessage.includes("econnreset") || lowerMessage.includes("etimedout") ||
      lowerMessage.includes("econnrefused") || lowerMessage.includes("socket hang up") ||
      lowerMessage.includes("fetch failed") || lowerMessage.includes("network error")) {
    return "network";
  }

  // Server overloaded / 5xx
  if (lowerMessage.includes("overloaded") || /\b500\b/.test(message) ||
      /\b502\b/.test(message) || /\b503\b/.test(message) || /\b504\b/.test(message)) {
    return "network";
  }

  // Tool error
  if (lowerMessage.includes("tool error") || lowerMessage.includes("tool execution") ||
      lowerMessage.includes("tool failed") || lowerMessage.includes("tool timeout")) {
    return "tool_error";
  }

  // Cancelled
  if (lowerMessage.includes("cancel") || lowerMessage.includes("abort")) {
    return "cancelled";
  }

  return "unknown";
}

// ============================================================================
// Recovery Decision
// ============================================================================

export type RecoveryAction =
  | { kind: "retry"; delayMs: number; reason: string }
  | { kind: "overflow_compact"; reason: string }
  | { kind: "max_output_recovery"; reason: string }
  | { kind: "fail"; reason: string; terminalReason: TerminalReason };

export interface RecoveryDecisionParams {
  error: unknown;
  errorClass: ErrorClass;
  recoveryCount: number;
  maxRetryAttempts: number;
  compactTracking: Pick<
    QueryLoopMutableState["compactTracking"],
    "maxOutputRecoveryCount" | "overflowRecovered"
  >;
  maxOutputRecoveryLimit: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export function decideRecoveryAction(params: RecoveryDecisionParams): RecoveryAction {
  const {
    error,
    errorClass,
    recoveryCount,
    maxRetryAttempts,
    compactTracking,
    maxOutputRecoveryLimit,
    baseDelayMs,
    maxDelayMs,
  } = params;

  switch (errorClass) {
    case "prompt_too_long": {
      if (compactTracking.overflowRecovered) {
        return {
          kind: "fail",
          reason: "overflow_already_attempted",
          terminalReason: "budget_exceeded",
        };
      }
      return { kind: "overflow_compact", reason: "context_overflow" };
    }

    case "max_output": {
      if (compactTracking.maxOutputRecoveryCount >= maxOutputRecoveryLimit) {
        return {
          kind: "fail",
          reason: "max_output_recovery_exhausted",
          terminalReason: "error",
        };
      }
      return { kind: "max_output_recovery", reason: "max_output_tokens_hit" };
    }

    case "rate_limit":
    case "network": {
      if (recoveryCount >= maxRetryAttempts) {
        return {
          kind: "fail",
          reason: "retries_exhausted",
          terminalReason: "error",
        };
      }

      const exponentialDelay = baseDelayMs * Math.pow(2, recoveryCount);
      const serverDelay = extractRetryAfterDelay(error);
      // Prefer server-provided delay, but cap it
      const delayMs = serverDelay !== undefined
        ? Math.min(serverDelay, maxDelayMs)
        : Math.min(exponentialDelay, maxDelayMs);

      return {
        kind: "retry",
        delayMs,
        reason: errorClass === "rate_limit" ? "rate_limited" : "transient_network_error",
      };
    }

    case "cancelled": {
      return {
        kind: "fail",
        reason: "user_cancelled",
        terminalReason: "canceled",
      };
    }

    case "auth": {
      return {
        kind: "fail",
        reason: "authentication_failed",
        terminalReason: "error",
      };
    }

    case "tool_error": {
      // Tool errors are generally not retryable at this level
      return {
        kind: "fail",
        reason: "tool_execution_error",
        terminalReason: "error",
      };
    }

    case "unknown":
    default: {
      // Unknown errors get one retry attempt if budget allows
      if (isRetryableError(error) && recoveryCount < maxRetryAttempts) {
        const exponentialDelay = baseDelayMs * Math.pow(2, recoveryCount);
        return {
          kind: "retry",
          delayMs: Math.min(exponentialDelay, maxDelayMs),
          reason: "unknown_retryable",
        };
      }

      return {
        kind: "fail",
        reason: "non_retryable",
        terminalReason: "error",
      };
    }
  }
}

// ============================================================================
// Checkpoint Manager
// ============================================================================

export interface CheckpointPayload {
  /** Turn count at checkpoint time. */
  turnCount: number;
  /** Number of transient recovery attempts so far. */
  recoveryCount: number;
  /** Compaction and overflow tracking. */
  compactTracking: Pick<
    QueryLoopMutableState["compactTracking"],
    "maxOutputRecoveryCount" | "overflowRecovered"
  >;
  /** Tool call IDs that have been executed with write side-effects. */
  executedWriteToolCallIds: string[];
  /** Snapshot of partial assistant text (for max_output recovery). */
  partialAssistantText: string;
  /** Any additional context. */
  context: Record<string, unknown>;
}

export class CheckpointManager {
  private executedWriteToolCallIds: Set<string> = new Set();

  constructor(
    private readonly store: AppStore,
    private readonly runId: string,
    private readonly sessionId: string,
  ) {}

  /**
   * Save a checkpoint at the given phase.
   */
  save(
    phase: RunCheckpointPhase,
    payload: Omit<CheckpointPayload, "executedWriteToolCallIds">,
  ): RunCheckpoint {
    return this.store.createCheckpoint({
      id: createId("checkpoint"),
      runId: this.runId,
      sessionId: this.sessionId,
      phase,
      payload: {
        ...payload,
        executedWriteToolCallIds: [...this.executedWriteToolCallIds],
      },
    });
  }

  /**
   * Record that a write tool has been executed (for replay protection).
   */
  recordWriteToolExecution(toolCallId: string): void {
    this.executedWriteToolCallIds.add(toolCallId);
  }

  /**
   * Check if a write tool has already been executed (replay protection).
   */
  isWriteToolExecuted(toolCallId: string): boolean {
    return this.executedWriteToolCallIds.has(toolCallId);
  }

  /**
   * Get the latest checkpoint for the run.
   */
  getLatest(): RunCheckpoint | null {
    return this.store.getLatestCheckpoint(this.runId);
  }

  /**
   * List all checkpoints for the run.
   */
  list(): RunCheckpoint[] {
    return this.store.listCheckpoints(this.runId);
  }

  /**
   * Find the best checkpoint to resume from.
   * Prefers checkpoints in reverse order:
   * before_terminal_commit > after_tool_batch > after_model_stream > before_model_call
   */
  findResumeCheckpoint(): RunCheckpoint | null {
    const checkpoints = this.list();
    const resumeOrder: RunCheckpointPhase[] = [
      "before_terminal_commit",
      "after_tool_batch",
      "after_model_stream",
      "before_model_call",
    ];

    for (const phase of resumeOrder) {
      const checkpoint = [...checkpoints].reverse().find((cp) => cp.phase === phase);
      if (checkpoint) {
        return checkpoint;
      }
    }

    return null;
  }

  /**
   * Restore the set of executed write tools from a checkpoint payload.
   */
  restoreExecutedWrites(payload: CheckpointPayload): void {
    for (const id of payload.executedWriteToolCallIds) {
      this.executedWriteToolCallIds.add(id);
    }
  }

  /**
   * Get the set of executed write tool call IDs (for external inspection).
   */
  getExecutedWriteToolCallIds(): ReadonlySet<string> {
    return this.executedWriteToolCallIds;
  }
}

// ============================================================================
// Replay Protection
// ============================================================================

/**
 * Tool call metadata for replay protection decisions.
 */
export interface ToolCallMeta {
  toolCallId: string;
  toolName: string;
  isWrite: boolean;
}

/**
 * Determine if a tool call should be skipped during recovery replay.
 * A write tool that was already executed must not be re-executed.
 */
export function shouldSkipToolCall(
  toolCall: ToolCallMeta,
  executedWriteToolCallIds: ReadonlySet<string>,
): boolean {
  if (!toolCall.isWrite) {
    return false;
  }
  return executedWriteToolCallIds.has(toolCall.toolCallId);
}

/**
 * Filter out already-executed write tools from a batch of pending tool calls.
 * Returns the filtered list and the count of skipped tools.
 */
export function filterAlreadyExecutedWrites(
  toolCalls: ToolCallMeta[],
  executedWriteToolCallIds: ReadonlySet<string>,
): { filtered: ToolCallMeta[]; skippedCount: number } {
  const filtered: ToolCallMeta[] = [];
  let skippedCount = 0;

  for (const tc of toolCalls) {
    if (shouldSkipToolCall(tc, executedWriteToolCallIds)) {
      skippedCount++;
    } else {
      filtered.push(tc);
    }
  }

  return { filtered, skippedCount };
}

/**
 * Registry of which tool names are considered "write" operations.
 * Used by replay protection to decide which tools must not be re-executed.
 */
const WRITE_TOOL_NAMES = new Set([
  "bash",
  "edit",
  "write",
  "notebook_edit",
]);

/**
 * Check if a tool name is a write tool.
 */
export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOL_NAMES.has(toolName);
}

// ============================================================================
// Run Lineage Tracking
// ============================================================================

export interface RunLineageInfo {
  runId: string;
  originRunId: string | null;
  recoveryMode: "start" | "retry" | "resume" | null;
  resumeFromCheckpoint: string | null;
}

  /**
   * Create lineage info for a retry/recovery run.
   */
export function createRetryLineage(
  originalRun: Run,
  checkpointId: string | null,
): RunLineageInfo {
  return {
    runId: originalRun.id,
    originRunId: originalRun.originRunId ?? originalRun.id,
    recoveryMode: "retry",
    resumeFromCheckpoint: checkpointId,
  };
}

/**
 * Create lineage info for a resume run.
 */
export function createResumeLineage(
  originalRun: Run,
  checkpointId: string | null,
): RunLineageInfo {
  return {
    runId: originalRun.id,
    originRunId: originalRun.originRunId ?? originalRun.id,
    recoveryMode: "resume",
    resumeFromCheckpoint: checkpointId,
  };
}

// ============================================================================
// Recovery Engine (main coordinator)
// ============================================================================

export interface RecoveryEngineDeps {
  store: AppStore;
  runId: string;
  sessionId: string;
  emit: (event: RecoveryEngineEvent) => void;
}

export type RecoveryEngineEvent =
  | RecoveryCheckpointSavedEvent
  | RecoveryActionDecidedEvent
  | RecoveryAttemptEvent
  | RecoveryCompletedEvent
  | ReplayProtectionEvent;

export interface RecoveryCheckpointSavedEvent {
  type: "recovery.checkpoint_saved";
  runId: string;
  sessionId: string;
  phase: RunCheckpointPhase;
  checkpointId: string;
}

export interface RecoveryActionDecidedEvent {
  type: "recovery.action_decided";
  runId: string;
  sessionId: string;
  errorClass: ErrorClass;
  action: RecoveryAction["kind"];
  reason: string;
}

export interface RecoveryAttemptEvent {
  type: "recovery.attempt";
  runId: string;
  sessionId: string;
  attempt: number;
  action: RecoveryAction["kind"];
  delayMs: number;
}

export interface RecoveryCompletedEvent {
  type: "recovery.completed";
  runId: string;
  sessionId: string;
  action: RecoveryAction["kind"];
  success: boolean;
}

export interface ReplayProtectionEvent {
  type: "recovery.replay_protection";
  runId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  skipped: boolean;
}

export const DEFAULT_RECOVERY_SETTINGS = {
  maxRetryAttempts: 3,
  baseDelayMs: 2000,
  maxDelayMs: 60000,
  maxOutputRecoveryLimit: 3,
};

export class RecoveryEngine {
  readonly checkpointManager: CheckpointManager;

  constructor(private readonly deps: RecoveryEngineDeps) {
    this.checkpointManager = new CheckpointManager(
      deps.store,
      deps.runId,
      deps.sessionId,
    );
  }

  /**
   * Save a checkpoint at the given phase with mutable state.
   */
  saveCheckpoint(
    phase: RunCheckpointPhase,
    state: {
      turnCount: number;
      recoveryCount: number;
      compactTracking: Pick<
        QueryLoopMutableState["compactTracking"],
        "maxOutputRecoveryCount" | "overflowRecovered"
      >;
      partialAssistantText: string;
      context?: Record<string, unknown>;
    },
  ): RunCheckpoint {
    const checkpoint = this.checkpointManager.save(phase, {
      turnCount: state.turnCount,
      recoveryCount: state.recoveryCount,
      compactTracking: state.compactTracking,
      partialAssistantText: state.partialAssistantText,
      context: state.context ?? {},
    });

    this.deps.emit({
      type: "recovery.checkpoint_saved",
      runId: this.deps.runId,
      sessionId: this.deps.sessionId,
      phase,
      checkpointId: checkpoint.id,
    });

    return checkpoint;
  }

  /**
   * Classify an error and decide recovery action.
   */
  classifyAndDecide(
    error: unknown,
    state: {
      recoveryCount: number;
      compactTracking: Pick<
        QueryLoopMutableState["compactTracking"],
        "maxOutputRecoveryCount" | "overflowRecovered"
      >;
    },
    settings = DEFAULT_RECOVERY_SETTINGS,
  ): { errorClass: ErrorClass; action: RecoveryAction } {
    const errorClass = classifyError(error);
    const action = decideRecoveryAction({
      error,
      errorClass,
      recoveryCount: state.recoveryCount,
      maxRetryAttempts: settings.maxRetryAttempts,
      compactTracking: state.compactTracking,
      maxOutputRecoveryLimit: settings.maxOutputRecoveryLimit,
      baseDelayMs: settings.baseDelayMs,
      maxDelayMs: settings.maxDelayMs,
    });

    this.deps.emit({
      type: "recovery.action_decided",
      runId: this.deps.runId,
      sessionId: this.deps.sessionId,
      errorClass,
      action: action.kind,
      reason: action.reason,
    });

    return { errorClass, action };
  }

  /**
   * Record a write tool execution for replay protection.
   */
  recordWriteTool(toolCallId: string, toolName: string): void {
    const isWrite = isWriteTool(toolName);
    const alreadyExecuted = isWrite && this.checkpointManager.isWriteToolExecuted(toolCallId);
    if (isWrite) {
      if (!alreadyExecuted) {
        this.checkpointManager.recordWriteToolExecution(toolCallId);
      }
    }

    this.deps.emit({
      type: "recovery.replay_protection",
      runId: this.deps.runId,
      sessionId: this.deps.sessionId,
      toolCallId,
      toolName,
      skipped: alreadyExecuted,
    });
  }

  /**
   * Check if a tool call should be skipped during replay.
   */
  shouldSkipTool(toolCallId: string, toolName: string): boolean {
    const isWrite = isWriteTool(toolName);
    if (!isWrite) {
      return false;
    }

    const skipped = this.checkpointManager.isWriteToolExecuted(toolCallId);
    if (skipped) {
      this.deps.emit({
        type: "recovery.replay_protection",
        runId: this.deps.runId,
        sessionId: this.deps.sessionId,
        toolCallId,
        toolName,
        skipped: true,
      });
    }

    return skipped;
  }

  /**
   * Restore state from a checkpoint for run resume.
   * Returns the checkpoint payload if found, null otherwise.
   */
  restoreFromCheckpoint(): CheckpointPayload | null {
    const checkpoint = this.checkpointManager.findResumeCheckpoint();
    if (!checkpoint) {
      return null;
    }

    const payload = checkpoint.payload as unknown as CheckpointPayload;
    this.checkpointManager.restoreExecutedWrites(payload);
    return payload;
  }
}
