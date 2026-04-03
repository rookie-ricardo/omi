/**
 * Context Budget Manager
 *
 * Calculates dynamic context thresholds based on:
 * - Model's context window size
 * - Output token reservation (for model responses)
 * - Buffer tokens for safety margins
 */

import type { Model, Api } from "@mariozechner/pi-ai";

import type { ProviderConfig } from "@omi/core";
import { createModelFromConfig } from "@omi/provider";

// ============================================================================
// Constants
// ============================================================================

/**
 * Default reserve tokens for model output.
 * Based on p99.99 of compact summary output being ~17k tokens.
 */
export const DEFAULT_OUTPUT_RESERVE_TOKENS = 20_000;

/**
 * Buffer tokens for auto-compact trigger.
 * Leaves headroom before hitting the blocking limit.
 */
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;

/**
 * Buffer tokens for warning threshold.
 */
export const WARNING_THRESHOLD_BUFFER_TOKENS = 15_000;

/**
 * Buffer tokens for error/blocking threshold.
 */
export const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000;

/**
 * Buffer tokens for manual compaction trigger.
 */
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000;

// ============================================================================
// Types
// ============================================================================

export interface ContextBudget {
  /** Model's raw context window */
  rawContextWindow: number;
  /** Effective context window after output reservation */
  effectiveContextWindow: number;
  /** Auto-compact trigger threshold */
  autoCompactThreshold: number;
  /** Warning threshold (percentage-based) */
  warningThreshold: number;
  /** Error/blocking threshold */
  errorThreshold: number;
  /** Manual compaction trigger threshold */
  manualCompactThreshold: number;
  /** Output reservation for model responses */
  outputReserveTokens: number;
}

export interface TokenWarningState {
  /** Percentage of context window remaining (0-100) */
  percentLeft: number;
  /** Whether usage exceeds auto-compact threshold */
  isAboveAutoCompactThreshold: boolean;
  /** Whether usage exceeds warning threshold */
  isAboveWarningThreshold: boolean;
  /** Whether usage exceeds error threshold */
  isAboveErrorThreshold: boolean;
  /** Whether usage hits the blocking limit */
  isAtBlockingLimit: boolean;
}

export interface QuickBudgetCheckResult {
  budget: ContextBudget;
  usage: number;
  warningState: TokenWarningState;
  needsAttention: boolean;
}

// ============================================================================
// Context Budget Calculation
// ============================================================================

/**
 * Create a context budget from a provider config.
 * Factors in the model's context window and reserves output tokens.
 */
export function createContextBudget(config: ProviderConfig, outputReserve?: number): ContextBudget {
  const model = createModelFromConfig(config);
  return buildContextBudget(model, outputReserve);
}

/**
 * Build a context budget from a model.
 */
export function buildContextBudget(model: Model<Api>, outputReserve?: number): ContextBudget {
  const rawContextWindow = model.contextWindow ?? 128_000;
  const outputReserveTokens = outputReserve ?? Math.min(model.maxTokens ?? 16384, DEFAULT_OUTPUT_RESERVE_TOKENS);

  const effectiveContextWindow = rawContextWindow - outputReserveTokens;

  return {
    rawContextWindow,
    effectiveContextWindow,
    autoCompactThreshold: effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS,
    warningThreshold: effectiveContextWindow - WARNING_THRESHOLD_BUFFER_TOKENS,
    errorThreshold: effectiveContextWindow - ERROR_THRESHOLD_BUFFER_TOKENS,
    manualCompactThreshold: effectiveContextWindow - MANUAL_COMPACT_BUFFER_TOKENS,
    outputReserveTokens,
  };
}

/**
 * Get the effective context window size (context - output reserve).
 */
export function getEffectiveContextWindow(config: ProviderConfig, outputReserve?: number): number {
  const budget = createContextBudget(config, outputReserve);
  return budget.effectiveContextWindow;
}

// ============================================================================
// Threshold Checking
// ============================================================================

/**
 * Calculate warning state based on current token usage.
 */
export function calculateTokenWarningState(
  tokenUsage: number,
  budget: ContextBudget,
): TokenWarningState {
  const percentLeft = Math.max(
    0,
    Math.round(((budget.effectiveContextWindow - tokenUsage) / budget.effectiveContextWindow) * 100),
  );

  return {
    percentLeft,
    isAboveAutoCompactThreshold: tokenUsage >= budget.autoCompactThreshold,
    isAboveWarningThreshold: tokenUsage >= budget.warningThreshold,
    isAboveErrorThreshold: tokenUsage >= budget.errorThreshold,
    isAtBlockingLimit: tokenUsage >= budget.manualCompactThreshold,
  };
}

/**
 * Perform a one-shot budget check for a transcript.
 * Returns the computed budget, usage estimate, and whether the transcript
 * should be compacted soon.
 */
export function quickBudgetCheck(
  tokenUsage: number,
  budget: ContextBudget,
): QuickBudgetCheckResult {
  const warningState = calculateTokenWarningState(tokenUsage, budget);
  return {
    budget,
    usage: tokenUsage,
    warningState,
    needsAttention: warningState.isAboveWarningThreshold || warningState.isAtBlockingLimit,
  };
}

/**
 * Check whether the current context needs attention from the compaction pipeline.
 */
export function needsContextAttention(tokenUsage: number, budget: ContextBudget): boolean {
  return calculateTokenWarningState(tokenUsage, budget).isAboveWarningThreshold;
}

/**
 * Check if auto-compaction should trigger based on token usage.
 */
export function shouldAutoCompact(tokenUsage: number, budget: ContextBudget): boolean {
  return tokenUsage >= budget.autoCompactThreshold;
}

/**
 * Check if manual compaction should trigger based on token usage.
 */
export function shouldManualCompact(tokenUsage: number, budget: ContextBudget): boolean {
  return tokenUsage >= budget.manualCompactThreshold;
}

/**
 * Check if usage is at a blocking limit.
 */
export function isAtBlockingLimit(tokenUsage: number, budget: ContextBudget): boolean {
  return tokenUsage >= budget.manualCompactThreshold;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get recommended reserve tokens for a model based on its max tokens.
 */
export function getRecommendedReserveTokens(model: Model<Api>): number {
  const maxTokens = model.maxTokens ?? 16384;
  // Reserve the larger of model's maxTokens or default, capped reasonably
  return Math.min(Math.max(maxTokens, 8192), DEFAULT_OUTPUT_RESERVE_TOKENS);
}

/**
 * Check if a model supports the given token budget.
 */
export function supportsTokenBudget(model: Model<Api>, requiredTokens: number): boolean {
  const effectiveWindow = (model.contextWindow ?? 128_000) - getRecommendedReserveTokens(model);
  return effectiveWindow >= requiredTokens;
}
