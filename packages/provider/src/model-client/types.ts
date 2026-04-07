import type { OmiTool } from "@omi/core";
import type { Message } from "@mariozechner/pi-ai";
import type { ProviderConfig } from "@omi/core";

export type ToolName = string;

// ============================================================================
// Protocol Types
// ============================================================================

/**
 * Supported protocol types for model providers.
 * All protocol implementations are delegated to pi-ai.
 */
export type ProtocolType = "openai-chat" | "openai-responses" | "anthropic-messages";

/**
 * Unified tool call representation across all protocols.
 */
export interface ModelToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Unified tool result representation across all protocols.
 */
export interface ModelToolResult {
  id: string;
  output: Record<string, unknown>;
  isError: boolean;
}

/**
 * Unified usage statistics across all protocols.
 */
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/**
 * Unified error classification for recovery.
 */
export type ModelErrorClass =
  | "network"
  | "rate_limit"
  | "auth"
  | "prompt_too_long"
  | "max_output"
  | "tool_error"
  | "cancelled"
  | "unknown";

/**
 * Unified stop reason across all protocols.
 */
export type ModelStopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "stop_sequence"
  | "content_filter"
  | "error";

// ============================================================================
// Stream Events
// ============================================================================

/**
 * Text delta event (streaming token output).
 */
export interface ModelTextDeltaEvent {
  type: "assistant_delta";
  delta: string;
}

/**
 * Tool call start event.
 */
export interface ModelToolCallStartEvent {
  type: "tool_call_start";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

/**
 * Tool call end event.
 */
export interface ModelToolCallEndEvent {
  type: "tool_call_end";
  toolCallId: string;
  toolName: string;
  result: Record<string, unknown>;
  isError: boolean;
}

/**
 * Tool result event (response from tool execution).
 */
export interface ModelToolResultEvent {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  output: Record<string, unknown>;
  isError: boolean;
}

/**
 * Streamed update event for tool execution progress.
 */
export interface ModelUpdateEvent {
  type: "update";
  toolCallId: string;
  toolName: string;
  delta: string;
  partialResult: unknown;
}

/**
 * Usage update event (may be intermediate or final).
 */
export interface ModelUsageEvent {
  type: "usage";
  usage: ModelUsage;
}

/**
 * Error event (can be recoverable or fatal).
 */
export interface ModelErrorEvent {
  type: "error";
  error: string;
  errorClass: ModelErrorClass;
  recoverable: boolean;
}

/**
 * Streaming complete event (final).
 */
export interface ModelCompleteEvent {
  type: "complete";
  stopReason: ModelStopReason;
  assistantText: string;
  toolCalls: ModelToolCall[];
  usage: ModelUsage;
}

/**
 * Request start event.
 */
export interface ModelRequestStartEvent {
  type: "request_start";
  runId: string;
  sessionId: string;
}

/**
 * Union of all unified stream events.
 */
export type ModelStreamEvent =
  | ModelTextDeltaEvent
  | ModelToolCallStartEvent
  | ModelToolCallEndEvent
  | ModelToolResultEvent
  | ModelUpdateEvent
  | ModelUsageEvent
  | ModelErrorEvent
  | ModelCompleteEvent
  | ModelRequestStartEvent;

// ============================================================================
// ModelClient Interface
// ============================================================================

export interface ModelClientRunInput {
  runId: string;
  sessionId: string;
  prompt: string;
  historyMessages: Message[];
  systemPrompt?: string;
  providerConfig: ProviderConfig;
  enabledTools?: ToolName[];
  /** Pre-built tools injected by the agent layer */
  tools?: OmiTool[];
  /** Callback to check if a tool requires user approval */
  requiresApprovalFn?: (toolName: string) => boolean;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  toolExecutionMode?: "sequential" | "parallel";
  preflightToolCheck?: (
    toolName: string,
    input: Record<string, unknown>,
  ) => ToolPreflightDecision | Promise<ToolPreflightDecision>;
}

export interface ToolPreflightDecision {
  decision: "allow" | "ask" | "deny";
  reason: string | null;
}

export const ALLOW_TOOL_PREFLIGHT_DECISION: ToolPreflightDecision = {
  decision: "allow",
  reason: null,
};

export interface ModelClientRunResult {
  assistantText: string;
  stopReason: ModelStopReason;
  toolCalls: ModelToolCall[];
  usage: ModelUsage;
  error: string | null;
}

/**
 * Unified model client interface.
 * All protocol differences are handled internally by pi-ai.
 * The query loop only works with these unified types.
 */
export interface ModelClient {
  /**
   * Execute a model run with streaming events.
   * All events are normalized to the unified ModelStreamEvent format.
   */
  run(
    input: ModelClientRunInput,
    callbacks: ModelClientCallbacks,
  ): Promise<ModelClientRunResult>;

  /**
   * Cancel an in-progress run.
   */
  cancel(runId: string): void;

  /**
   * Approve a pending tool call.
   */
  approveTool(toolCallId: string): void;

  /**
   * Reject a pending tool call.
   */
  rejectTool(toolCallId: string): void;
}

/**
 * Callbacks for receiving stream events from the model client.
 */
export interface ModelClientCallbacks {
  onTextDelta?: (delta: string) => void | Promise<void>;
  onToolCallStart?: (toolCallId: string, toolName: string, input: Record<string, unknown>) => void | Promise<void>;
  onToolDecision?: (toolCallId: string, decision: "approved" | "rejected") => void | Promise<void>;
  onToolCallEnd?: (
    toolCallId: string,
    toolName: string,
    result: Record<string, unknown>,
    isError: boolean
  ) => void | Promise<void>;
  onToolResult?: (
    toolCallId: string,
    toolName: string,
    output: Record<string, unknown>,
    isError: boolean
  ) => void | Promise<void>;
  onUpdate?: (
    toolCallId: string,
    toolName: string,
    delta: string,
    partialResult: unknown
  ) => void | Promise<void>;
  onUsage?: (usage: ModelUsage) => void | Promise<void>;
  onError?: (error: string, errorClass: ModelErrorClass, recoverable: boolean) => void | Promise<void>;
  onRequestStart?: (runId: string, sessionId: string) => void | Promise<void>;
}

// ============================================================================
// Protocol Detection
// ============================================================================

/**
 * Result of protocol detection.
 */
export interface ProtocolDetectionResult {
  protocol: ProtocolType;
  reasoning: string;
}

/**
 * Detect the appropriate protocol for a given provider configuration.
 * This is a pure function that determines routing based on provider metadata.
 */
export function detectProtocol(providerConfig: ProviderConfig): ProtocolDetectionResult {
  if (providerConfig.protocol === "anthropic-messages") {
    return {
      protocol: "anthropic-messages",
      reasoning: "providerConfig.protocol -> anthropic-messages",
    };
  }
  if (providerConfig.protocol === "openai-responses") {
    return {
      protocol: "openai-responses",
      reasoning: "providerConfig.protocol -> openai-responses",
    };
  }
  if (providerConfig.protocol === "openai-chat") {
    return {
      protocol: "openai-chat",
      reasoning: "providerConfig.protocol -> openai-chat",
    };
  }
  throw new Error(
    `providerConfig.protocol must be one of anthropic-messages | openai-responses | openai-chat`,
  );
}
