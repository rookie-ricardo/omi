import { nowIso } from "@omi/core";
import type { RuntimeMessage } from "@omi/memory";

// ============================================================================
// Query Loop States
// ============================================================================

/**
 * The states in the query loop state machine.
 *
 * Transitions:
 *   init -> preprocess_context
 *   preprocess_context -> calling_model
 *   preprocess_context -> terminal (on skip)
 *   calling_model -> streaming_response
 *   calling_model -> recovering (on transient error)
 *   calling_model -> terminal (on fatal error)
 *   streaming_response -> terminal (on end_turn / max_tokens / error)
 *   streaming_response -> recovering (on retryable error)
 *   streaming_response -> preprocess_context (on max_output_tokens recovery)
 *   streaming_response -> post_tool_merge (response merged)
 *   post_tool_merge -> terminal (on max_turns / budget_exceeded / cancel)
 *   recovering -> calling_model (overflow retry)
 *   recovering -> preprocess_context (retry)
 *   recovering -> terminal (on exhausted retries)
 */
export type QueryLoopState =
  | "init"
  | "preprocess_context"
  | "calling_model"
  | "streaming_response"
  | "post_tool_merge"
  | "terminal"
  | "recovering";

/**
 * Unified terminal reasons for a query loop run.
 */
export type TerminalReason =
  | "completed"
  | "max_turns"
  | "budget_exceeded"
  | "canceled"
  | "error"
  | "suspended";

/**
 * Tool execution mode: sequential for mutations, parallel for read-only.
 */
export type ToolExecutionMode = "sequential" | "parallel";

// ============================================================================
// Query Loop State Object
// ============================================================================

export interface QueryLoopBudget {
  /** Maximum turns before forced termination. */
  maxTurns: number;
  /** Maximum USD budget (0 = unlimited). */
  maxBudgetUsd: number;
  /** Maximum output token recovery attempts. */
  maxOutputRecoveryAttempts: number;
  /** Maximum retry attempts for transient errors. */
  maxRetryAttempts: number;
}

export interface QueryLoopCompactTracking {
  /** Number of max_output_tokens recovery attempts. */
  maxOutputRecoveryCount: number;
  /** Whether overflow recovery has already been attempted. */
  overflowRecovered: boolean;
  /** The last stop reason reported by the model. */
  lastStopReason: string | null;
  /** Snapshot of context tokens from the latest health check. */
  lastContextTokens: number;
}

export interface QueryLoopMutableState {
  /** Current state machine state. */
  currentState: QueryLoopState;
  /** Accumulated messages for this run (history + new). */
  messages: RuntimeMessage[];
  /** Number of completed turns (user prompt -> assistant response = 1 turn). */
  turnCount: number;
  /** Number of transient-error recovery attempts in the current run. */
  recoveryCount: number;
  /** Compaction and overflow tracking for this run. */
  compactTracking: QueryLoopCompactTracking;
  /** Runtime budget for this query loop. */
  budget: QueryLoopBudget;
  /** Last terminal reason (set when state becomes "terminal"). */
  terminalReason: TerminalReason | null;
  /** Error that caused termination (if any). */
  terminalError: string | null;
  /** The last stop reason from the model response. */
  lastStopReason: string | null;
  /** Snapshot of context tokens from last usage. */
  lastContextTokens: number;
  /** Timestamp of the last state transition. */
  lastTransitionAt: string;
}

export interface QueryLoopSnapshot extends QueryLoopMutableState {
  sessionId: string;
  runId: string;
}

// ============================================================================
// State Transition Events
// ============================================================================

export interface QueryLoopTransitionEvent {
  type: "query_loop.transition";
  runId: string;
  sessionId: string;
  from: QueryLoopState;
  to: QueryLoopState;
  reason: string;
  timestamp: string;
  turnCount: number;
}

export interface QueryLoopTerminalEvent {
  type: "query_loop.terminal";
  runId: string;
  sessionId: string;
  reason: TerminalReason;
  error: string | null;
  turnCount: number;
  timestamp: string;
  /** Cost tracking snapshot at termination (null if no tracker configured). */
  costSnapshot?: unknown;
}

export type QueryLoopEvent = QueryLoopTransitionEvent | QueryLoopTerminalEvent;

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_QUERY_LOOP_BUDGET: QueryLoopBudget = {
  maxTurns: 200,
  maxBudgetUsd: 0,
  maxOutputRecoveryAttempts: 3,
  maxRetryAttempts: 3,
};

export function createInitialMutableState(
  initialMessages: RuntimeMessage[] = [],
  budget: QueryLoopBudget = DEFAULT_QUERY_LOOP_BUDGET,
): QueryLoopMutableState {
  return {
    currentState: "init",
    messages: initialMessages,
    turnCount: 0,
    recoveryCount: 0,
    compactTracking: {
      maxOutputRecoveryCount: 0,
      overflowRecovered: false,
      lastStopReason: null,
      lastContextTokens: 0,
    },
    budget: { ...budget },
    terminalReason: null,
    terminalError: null,
    lastStopReason: null,
    lastContextTokens: 0,
    lastTransitionAt: nowIso(),
  };
}

// ============================================================================
// State Machine Validator
// ============================================================================

const VALID_TRANSITIONS: Record<QueryLoopState, Set<QueryLoopState>> = {
  init: new Set(["preprocess_context"]),
  preprocess_context: new Set(["calling_model", "terminal"]),
  calling_model: new Set(["streaming_response", "recovering", "terminal"]),
  streaming_response: new Set([
    "terminal",
    "recovering",
    "preprocess_context",
    "post_tool_merge",
  ]),
  post_tool_merge: new Set([
    "preprocess_context",
    "terminal",
  ]),
  terminal: new Set([]),
  recovering: new Set(["calling_model", "preprocess_context", "terminal"]),
};

export function isValidTransition(
  from: QueryLoopState,
  to: QueryLoopState,
): boolean {
  if (from === to) return false;
  return VALID_TRANSITIONS[from]?.has(to) ?? false;
}

/**
 * All valid transition pairs for exhaustive testing.
 * Returns 16 valid transitions total.
 */
export function getAllValidTransitions(): Array<{
  from: QueryLoopState;
  to: QueryLoopState;
}> {
  const pairs: Array<{ from: QueryLoopState; to: QueryLoopState }> = [];
  for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
    for (const to of targets) {
      pairs.push({ from: from as QueryLoopState, to: to as QueryLoopState });
    }
  }
  return pairs;
}
