import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type {
  ModelErrorClass,
  ModelStreamEvent,
  ModelStopReason,
  ModelToolCall,
} from "./types";

// ============================================================================
// Event Normalization
// ============================================================================

/**
 * Normalize a pi-ai AgentEvent to the unified ModelStreamEvent format.
 * This ensures query loop receives consistent events regardless of protocol.
 */
export function normalizeEvent(
  event: AgentEvent,
  context: NormalizationContext,
): ModelStreamEvent[] {
  const events: ModelStreamEvent[] = [];

  // Text delta
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    events.push({
      type: "assistant_delta",
      delta: event.assistantMessageEvent.delta,
    });
    return events;
  }

  // Tool execution start
  if (event.type === "tool_execution_start") {
    const toolEventKey = getToolEventKey(event);
    const toolCallId = context.currentToolCallId ?? generateToolCallId(context);
    if (toolEventKey) {
      context.toolCallIdMap.set(toolEventKey, toolCallId);
    }
    events.push({
      type: "tool_call_start",
      toolCallId,
      toolName: event.toolName,
      input: (event as Record<string, unknown>).args as Record<string, unknown> ?? {},
    });
    return events;
  }

  if (event.type === "tool_execution_update") {
    const toolCallId = findToolCallId(context, event);
    const partialResult = (event as Record<string, unknown>).partialResult;
    const delta =
      typeof partialResult === "string"
        ? partialResult
        : JSON.stringify(partialResult ?? {});

    events.push({
      type: "update",
      toolCallId,
      toolName: event.toolName,
      delta,
      partialResult,
    });
    return events;
  }

  // Tool execution end
  if (event.type === "tool_execution_end") {
    const toolCallId = findToolCallId(context, event);
    events.push({
      type: "tool_call_end",
      toolCallId,
      toolName: event.toolName,
      result: (event.result?.details ?? {}) as Record<string, unknown>,
      isError: event.isError,
    });
    events.push({
      type: "tool_result",
      toolCallId,
      toolName: event.toolName,
      output: (event.result?.details ?? {}) as Record<string, unknown>,
      isError: event.isError,
    });
    return events;
  }

  // Message end
  if (event.type === "message_end") {
    const usage = extractUsage(event);
    if (usage) {
      events.push({
        type: "usage",
        usage,
      });
    }

    const stopReason = extractStopReason(event);
    if (stopReason) {
      const toolCalls = extractToolCalls(event);
      const assistantText = extractAssistantText(event);

      events.push({
        type: "complete",
        stopReason,
        assistantText,
        toolCalls,
        usage: usage ?? { inputTokens: 0, outputTokens: 0 },
      });
    }
    return events;
  }

  return events;
}

export interface NormalizationContext {
  runId: string;
  sessionId: string;
  currentToolCallId?: string;
  toolCallIdMap: Map<string, string>;
  messageIdCounter: number;
}

let globalToolCallCounter = 0;

function generateToolCallId(context: NormalizationContext): string {
  return `${context.runId}:tool:${++globalToolCallCounter}`;
}

function getToolEventKey(event: AgentEvent): string | null {
  const record = event as Record<string, unknown>;
  const rawId =
    (typeof record.toolCallId === "string" && record.toolCallId)
    || (typeof record.id === "string" && record.id)
    || (typeof record.callId === "string" && record.callId)
    || null;
  if (!rawId || rawId.trim().length === 0) {
    return null;
  }
  return rawId;
}

function findToolCallId(context: NormalizationContext, event: AgentEvent): string {
  const toolEventKey = getToolEventKey(event);
  if (toolEventKey) {
    const existing = context.toolCallIdMap.get(toolEventKey);
    if (existing) {
      return existing;
    }
  }
  if (context.currentToolCallId) {
    return context.currentToolCallId;
  }
  const newId = generateToolCallId(context);
  if (toolEventKey) {
    context.toolCallIdMap.set(toolEventKey, newId);
  }
  return newId;
}

function extractUsage(
  event: Extract<AgentEvent, { type: "message_end" }>,
): { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number } | null {
  const message = (event as Record<string, unknown>).message as Record<string, unknown> | undefined;
  if (!message) return null;

  const usage = message.usage as Record<string, unknown> | undefined;
  if (!usage) return null;

  return {
    inputTokens: (usage.input_tokens as number) ?? 0,
    outputTokens: (usage.output_tokens as number) ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens as number | undefined,
    cacheCreationTokens: usage.cache_creation_input_tokens as number | undefined,
  };
}

function extractStopReason(
  event: Extract<AgentEvent, { type: "message_end" }>,
): ModelStopReason | null {
  const message = (event as Record<string, unknown>).message as Record<string, unknown> | undefined;
  if (!message) return null;

  const stopReason = (message as Record<string, unknown>).stop_reason as string | undefined;
  if (!stopReason) return null;

  const reasonMap: Record<string, ModelStopReason> = {
    end_turn: "end_turn",
    tool_use: "tool_use",
    max_tokens: "max_tokens",
    stop_sequence: "stop_sequence",
    content_filter: "content_filter",
    "max-output-tokens": "max_tokens",
  };

  return reasonMap[stopReason] ?? "end_turn";
}

function extractToolCalls(event: Extract<AgentEvent, { type: "message_end" }>): ModelToolCall[] {
  const message = (event as Record<string, unknown>).message as Record<string, unknown> | undefined;
  if (!message) return [];

  const content = message.content as unknown[] | undefined;
  if (!Array.isArray(content)) return [];

  const toolCalls: ModelToolCall[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as Record<string, unknown>).type === "toolCall"
    ) {
      const toolBlock = block as Record<string, unknown>;
      toolCalls.push({
        id: (toolBlock.id as string) ?? generateFallbackId(),
        name: toolBlock.name as string,
        input: (toolBlock.arguments as Record<string, unknown>) ?? {},
      });
    }
  }

  return toolCalls;
}

let fallbackIdCounter = 0;
function generateFallbackId(): string {
  return `fallback:${++fallbackIdCounter}`;
}

function extractAssistantText(event: Extract<AgentEvent, { type: "message_end" }>): string {
  const message = (event as Record<string, unknown>).message as Record<string, unknown> | undefined;
  if (!message) return "";

  const content = message.content as unknown[] | undefined;
  if (!Array.isArray(content)) return "";

  const textParts: string[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as Record<string, unknown>).type === "text"
    ) {
      const textBlock = block as Record<string, unknown>;
      const text = textBlock.text as string | undefined;
      if (text) {
        textParts.push(text);
      }
    }
  }

  return textParts.join("");
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Classify a pi-ai error message into a unified error class.
 */
function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

export function classifyPiAiError(error: unknown): ModelErrorClass {
  if (error === null || error === undefined) {
    return "unknown";
  }

  if (typeof error === "string") {
    return classifyPiAiErrorByMessage(error);
  }

  const record = toRecord(error);
  if (!record) {
    return classifyPiAiErrorByMessage(String(error));
  }

  const response = toRecord(record.response);
  const nestedError = toRecord(record.error);
  const statusCode = firstNumber(
    record.statusCode,
    record.status,
    response?.statusCode,
    response?.status,
    nestedError?.statusCode,
    nestedError?.status,
  );
  if (statusCode === 401 || statusCode === 403) {
    return "auth";
  }
  if (statusCode === 429) {
    return "rate_limit";
  }
  if (statusCode !== null && statusCode >= 500 && statusCode <= 599) {
    return "network";
  }

  const errorCode = firstString(
    record.code,
    record.errorCode,
    record.type,
    nestedError?.code,
    nestedError?.type,
    response?.code,
  )?.toLowerCase();

  if (errorCode) {
    if (
      errorCode.includes("rate_limit")
      || errorCode.includes("ratelimit")
      || errorCode.includes("too_many_requests")
    ) {
      return "rate_limit";
    }
    if (
      errorCode.includes("invalid_api_key")
      || errorCode.includes("authentication")
      || errorCode.includes("permission_denied")
      || errorCode.includes("forbidden")
      || errorCode.includes("unauthorized")
    ) {
      return "auth";
    }
    if (
      errorCode.includes("econn")
      || errorCode.includes("network")
      || errorCode.includes("connection")
      || errorCode.includes("timeout")
      || errorCode.includes("timedout")
      || errorCode.includes("overloaded")
    ) {
      return "network";
    }
    if (
      errorCode.includes("max_output")
      || errorCode.includes("max_tokens")
      || errorCode.includes("output_limit")
    ) {
      return "max_output";
    }
  }

  const message = firstString(record.message, nestedError?.message) ?? String(error);
  return classifyPiAiErrorByMessage(message);
}

function classifyPiAiErrorByMessage(message: string): ModelErrorClass {
  const lower = message.toLowerCase();

  // Auth errors
  if (
    /\b401\b/.test(message) ||
    /\b403\b/.test(message) ||
    lower.includes("unauthorized") ||
    lower.includes("invalid api key") ||
    lower.includes("forbidden") ||
    lower.includes("authentication")
  ) {
    return "auth";
  }

  // Max output tokens
  if (
    lower.includes("max_output") ||
    lower.includes("max output") ||
    lower.includes("output token limit") ||
    (lower.includes("max_tokens") && lower.includes("output"))
  ) {
    return "max_output";
  }

  // Context overflow / prompt too long
  if (
    lower.includes("context length") ||
    lower.includes("prompt too long") ||
    lower.includes("too many tokens") ||
    lower.includes("maximum context")
  ) {
    return "prompt_too_long";
  }

  // Rate limit
  if (
    /\b429\b/.test(message) ||
    lower.includes("rate limit") ||
    lower.includes("ratelimit") ||
    lower.includes("rate_limit")
  ) {
    return "rate_limit";
  }

  // Network errors
  if (
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("econnrefused") ||
    lower.includes("socket hang up") ||
    lower.includes("fetch failed") ||
    lower.includes("network error")
  ) {
    return "network";
  }

  // Server overloaded / 5xx
  if (
    lower.includes("overloaded") ||
    /\b500\b/.test(message) ||
    /\b502\b/.test(message) ||
    /\b503\b/.test(message) ||
    /\b504\b/.test(message)
  ) {
    return "network";
  }

  // Tool error
  if (
    lower.includes("tool error") ||
    lower.includes("tool execution") ||
    lower.includes("tool failed") ||
    lower.includes("tool timeout")
  ) {
    return "tool_error";
  }

  // Cancelled
  if (lower.includes("cancel") || lower.includes("abort")) {
    return "cancelled";
  }

  return "unknown";
}

/**
 * Determine if an error is recoverable (retryable).
 */
export function isRecoverableError(errorClass: ModelErrorClass): boolean {
  switch (errorClass) {
    case "network":
    case "rate_limit":
    case "prompt_too_long":
      return true;
    case "auth":
    case "max_output":
    case "tool_error":
    case "cancelled":
    case "unknown":
      return false;
  }
}
