/**
 * Tool Surface Governance - Unified Tool Definitions
 *
 * Provides a standardized schema for all tools with:
 * - Structured schemas (zod)
 * - Risk classification and concurrency safety
 * - Error codes and audit fields
 * - Idempotency policies for write operations
 */

import { z } from "zod";

// ============================================================================
// Risk Level
// ============================================================================

/**
 * Risk level for permission engine integration.
 * - none: No risk (pure read, no side effects)
 * - low: Minor side effects (file reads with size limits)
 * - medium: Moderate risk (file writes, network access)
 * - high: Significant risk (code execution, system modifications)
 * - critical: Dangerous (rm -rf, sudo, network escalation)
 */
export type ToolRiskLevel = "none" | "low" | "medium" | "high" | "critical";

export const TOOL_RISK_LEVELS: ToolRiskLevel[] = ["none", "low", "medium", "high", "critical"];

export const RISK_LEVEL_SCORE: Record<ToolRiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

// ============================================================================
// Idempotency Policy (for write tools)
// ============================================================================

/**
 * Idempotency policy for write operations.
 * - none: Not idempotent, repeated execution has side effects
 * - safe: Safe to retry, produces same result
 * - conflict: May conflict with concurrent writes
 */
export type ToolIdempotencyPolicy = "none" | "safe" | "conflict";

// ============================================================================
// Structured Output
// ============================================================================

/**
 * Standardized tool output envelope.
 * All tools should return structured output to avoid ambiguity.
 */
export interface ToolOutput {
  /** Whether the tool executed successfully. */
  ok: boolean;
  /** Structured data payload. */
  data?: unknown;
  /** Human-readable content for display. */
  content?: string;
  /** Error information if ok=false. */
  error?: ToolError;
  /** Execution metadata for audit. */
  meta?: ToolOutputMeta;
}

export interface ToolError {
  /** Machine-readable error code. */
  code: string;
  /** Human-readable error message. */
  message: string;
  /** Optional retry hint. */
  retryable?: boolean;
}

export interface ToolOutputMeta {
  /** Execution duration in milliseconds. */
  durationMs?: number;
  /** Tool version for debugging. */
  version?: string;
  /** Whether output was truncated. */
  truncated?: boolean;
  /** Truncation details. */
  truncationLimit?: string;
}

// ============================================================================
// Standard Error Codes
// ============================================================================

export const TOOL_ERROR_CODES = {
  // File system errors
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  FILE_ALREADY_EXISTS: "FILE_ALREADY_EXISTS",
  DIRECTORY_NOT_FOUND: "DIRECTORY_NOT_FOUND",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  INVALID_PATH: "INVALID_PATH",

  // Execution errors
  COMMAND_FAILED: "COMMAND_FAILED",
  COMMAND_TIMEOUT: "COMMAND_TIMEOUT",
  PROCESS_KILLED: "PROCESS_KILLED",
  INVALID_COMMAND: "INVALID_COMMAND",

  // Parameter errors
  INVALID_INPUT: "INVALID_INPUT",
  MISSING_REQUIRED: "MISSING_REQUIRED",
  INVALID_SCHEMA: "INVALID_SCHEMA",

  // System errors
  UNKNOWN_TOOL: "UNKNOWN_TOOL",
  TOOL_NOT_ENABLED: "TOOL_NOT_ENABLED",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  RATE_LIMITED: "RATE_LIMITED",

  // Output errors
  OUTPUT_TRUNCATED: "OUTPUT_TRUNCATED",
  OUTPUT_PARSE_ERROR: "OUTPUT_PARSE_ERROR",

  // Tool-specific errors (extends as needed)
  MCP_ERROR: "MCP_ERROR",
  TASK_NOT_FOUND: "TASK_NOT_FOUND",
  TASK_FAILED: "TASK_FAILED",
  PLAN_NOT_ACTIVE: "PLAN_NOT_ACTIVE",
  SEARCH_ERROR: "SEARCH_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
} as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[keyof typeof TOOL_ERROR_CODES];

// ============================================================================
// Audit Fields
// ============================================================================

export interface ToolAuditFields {
  /** Tool execution ID (for tracing). */
  executionId?: string;
  /** Tool invocation timestamp. */
  invokedAt?: string;
  /** Whether the result was cached. */
  cached?: boolean;
  /** Input hash for deduplication. */
  inputHash?: string;
  /** Number of retry attempts. */
  retryCount?: number;
}

// ============================================================================
// Tool Definition
// ============================================================================

export interface ToolDefinition {
  /** Unique tool name. */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Zod input schema for validation. */
  inputSchema: z.ZodType<unknown>;
  /** Whether this tool modifies state (vs. read-only). */
  isReadOnly: boolean;
  /** Whether this tool can run concurrently with itself. */
  isConcurrencySafe: boolean;
  /** Risk classification for permission engine. */
  riskLevel: ToolRiskLevel;
  /** Idempotency policy for write operations. */
  idempotencyPolicy: ToolIdempotencyPolicy;
  /** Whether this tool is enabled by default. */
  enabledByDefault: boolean;
  /** Standard error codes this tool may produce. */
  errorCodes: ToolErrorCode[];
  /** Audit field names tracked by this tool. */
  auditFields: (keyof ToolAuditFields)[];
  /** Examples for LLM prompting. */
  examples?: Array<{ input: Record<string, unknown>; output: string }>;
}

// ============================================================================
// Helper: Build structured error
// ============================================================================

export function buildToolError(
  code: ToolErrorCode,
  message: string,
  options?: Partial<Pick<ToolError, "retryable">>,
): ToolError {
  return {
    code,
    message,
    retryable: options?.retryable,
  };
}

// ============================================================================
// Helper: Build structured output
// ============================================================================

export function buildToolOutput(
  data: unknown,
  options?: {
    content?: string;
    error?: ToolError;
    meta?: ToolOutputMeta;
  },
): ToolOutput {
  return {
    ok: options?.error === undefined,
    data,
    content: options?.content,
    error: options?.error,
    meta: options?.meta,
  };
}

export function buildSuccessOutput(data: unknown, content?: string, meta?: ToolOutputMeta): ToolOutput {
  return {
    ok: true,
    data,
    content,
    meta,
  };
}

export function buildErrorOutput(error: ToolError, meta?: ToolOutputMeta): ToolOutput {
  return {
    ok: false,
    error,
    meta,
  };
}
