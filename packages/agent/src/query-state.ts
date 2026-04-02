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
 *   streaming_response -> executing_tools (on tool_use stop reason)
 *   streaming_response -> terminal (on end_turn / max_tokens / error)
 *   streaming_response -> recovering (on retryable error)
 *   streaming_response -> preprocess_context (on max_output_tokens recovery)
 *   streaming_response -> post_tool_merge (no tool calls, direct merge)
 *   executing_tools -> post_tool_merge
 *   executing_tools -> terminal (on cancellation)
 *   executing_tools -> recovering (on tool error)
 *   post_tool_merge -> preprocess_context (continue loop)
 *   post_tool_merge -> terminal (on max_turns / budget / cancel)
 *   recovering -> preprocess_context (retry)
 *   recovering -> terminal (on exhausted retries)
 */
export type QueryLoopState =
  | "init"
  | "preprocess_context"
  | "calling_model"
  | "streaming_response"
  | "executing_tools"
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
  | "blocking_limit"
  | "aborted_streaming"
  | "aborted_tools"
  | "prompt_too_long"
  | "stop_hook_prevented";

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

export interface QueryLoopMutableState {
  /** Current state machine state. */
  currentState: QueryLoopState;
  /** Accumulated messages for this run (history + new). */
  messages: RuntimeMessage[];
  /** Number of completed turns (user prompt -> assistant response = 1 turn). */
  turnCount: number;
  /** Number of transient-error retry attempts in the current run. */
  retryAttempt: number;
  /** Number of max_output_tokens recovery attempts. */
  maxOutputRecoveryCount: number;
  /** Whether overflow recovery has already been attempted. */
  overflowRecovered: boolean;
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
): QueryLoopMutableState {
  return {
    currentState: "init",
    messages: initialMessages,
    turnCount: 0,
    retryAttempt: 0,
    maxOutputRecoveryCount: 0,
    overflowRecovered: false,
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
    "executing_tools",
    "terminal",
    "recovering",
    "preprocess_context",
    "post_tool_merge",
  ]),
  executing_tools: new Set(["post_tool_merge", "terminal", "recovering"]),
  post_tool_merge: new Set([
    "preprocess_context",
    "terminal",
  ]),
  terminal: new Set([]),
  recovering: new Set(["preprocess_context", "terminal"]),
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
