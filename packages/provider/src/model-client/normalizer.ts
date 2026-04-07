import type { ModelErrorClass } from "./types";

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
