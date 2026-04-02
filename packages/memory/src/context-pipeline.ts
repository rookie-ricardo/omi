/**
 * Context Pipeline Orchestrator
 *
 * Implements the context management pipeline:
 * 1. Tool Result Budget - Fast budget check for tool results
 * 2. Micro Compact - Lightweight pruning of excessive tool results
 * 3. Context Collapse - Budget-based headroom management
 * 4. Auto Compact - LLM-based summarization when needed
 * 5. Compact and Continue - Full compaction with auto-retry
 */

import type { ProviderConfig, Session } from "@omi/core";
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
  generateCompactionSummary,
  sessionCompactionSnapshotSchema,
} from "@omi/memory";
import { createModelFromConfig } from "@omi/provider";

import {
  buildContextBudget,
  calculateTokenWarningState,
  createContextBudget,
  estimateRuntimeMessagesTokens,
  shouldAutoCompact,
  type ContextBudget,
  type TokenWarningState,
} from "./context-budget";
import {
  estimateContextTokens,
  estimateRuntimeMessageTokens,
  estimateRuntimeMessagesTokens,
  type ContextUsageEstimate,
} from "./compaction";

// ============================================================================
// Types
// ============================================================================

export interface ContextPipelineConfig {
  /** Provider configuration for model access */
  providerConfig: ProviderConfig;
  /** Custom compaction summarizer */
  summarizer?: CompactionSummaryGenerator;
  /** Enable micro compact (fast tool result pruning) */
  enableMicroCompact?: boolean;
  /** Enable context collapse (budget headroom management) */
  enableContextCollapse?: boolean;
  /** Maximum tool result size in tokens */
  maxToolResultTokens?: number;
  /** Headroom ratio for context collapse trigger (0-1) */
  collapseHeadroomRatio?: number;
}

export interface ContextPipelineInput {
  /** Current runtime messages */
  messages: RuntimeMessage[];
  /** Session for compaction history */
  session: Session;
  /** Optional current usage estimate */
  usageEstimate?: ContextUsageEstimate;
}

export interface ContextPipelineResult {
  /** Whether any action was taken */
  didCompact: boolean;
  /** Updated messages after processing */
  messages: RuntimeMessage[];
  /** Updated usage estimate */
  usageEstimate: ContextUsageEstimate;
  /** Warning state after processing */
  warningState: TokenWarningState;
  /** Compaction snapshot if compaction occurred */
  compactionSnapshot?: SessionCompactionSnapshot;
  /** Budget state after processing */
  budget: ContextBudget;
}

export interface PipelineStage {
  name: string;
  didRun: boolean;
  didModify: boolean;
  description: string;
}

export interface ContextPipelineReport {
  /** Whether full compaction was triggered */
  didFullCompaction: boolean;
  /** Stages that ran */
  stages: PipelineStage[];
  /** Final warning state */
  finalWarningState: TokenWarningState;
  /** Final budget */
  finalBudget: ContextBudget;
  /** Compaction result if any */
  compactionResult?: {
    mode: CompactionMode;
    tokensBefore: number;
    tokensKept: number;
  };
}

// ============================================================================
// Pipeline Implementation
// ============================================================================

export class ContextPipeline {
  private readonly config: ContextPipelineConfig;
  private readonly budget: ContextBudget;
  private stages: PipelineStage[] = [];

  constructor(config: ContextPipelineConfig) {
    this.config = config;
    this.budget = createContextBudget(config.providerConfig);
  }

  /**
   * Execute the full context pipeline.
   */
  async execute(input: ContextPipelineInput): Promise<ContextPipelineResult> {
    this.stages = [];

    let messages = [...input.messages];
    let usageEstimate = input.usageEstimate ?? estimateContextTokens(messages);
    let warningState = calculateTokenWarningState(usageEstimate.tokens, this.budget);

    // Stage 1: Tool Result Budget Check
    const toolResultResult = this.runToolResultBudgetStage(messages);
    if (toolResultResult.didModify) {
      messages = toolResultResult.messages;
      usageEstimate = estimateContextTokens(messages);
      warningState = calculateTokenWarningState(usageEstimate.tokens, this.budget);
    }

    // Stage 2: Micro Compact (if enabled and needed)
    if (this.config.enableMicroCompact !== false && warningState.isAboveWarningThreshold) {
      const microResult = this.runMicroCompactStage(messages, warningState);
      if (microResult.didModify) {
        messages = microResult.messages;
        usageEstimate = estimateContextTokens(messages);
        warningState = calculateTokenWarningState(usageEstimate.tokens, this.budget);
      }
    }

    // Stage 3: Context Collapse (if enabled)
    if (this.config.enableContextCollapse !== false && warningState.isAboveAutoCompactThreshold) {
      const collapseResult = this.runContextCollapseStage(messages, usageEstimate, warningState);
      if (collapseResult.didCompact) {
        return collapseResult;
      }
    }

    // Stage 4: Auto Compact (if still needed)
    if (shouldAutoCompact(usageEstimate.tokens, this.budget)) {
      const autoCompactResult = await this.runAutoCompactStage(input.session, messages, usageEstimate);
      if (autoCompactResult.didCompact) {
        return autoCompactResult;
      }
    }

    return {
      didCompact: false,
      messages,
      usageEstimate,
      warningState,
      budget: this.budget,
    };
  }

  /**
   * Run tool result budget stage - fast check for excessive tool results.
   */
  private runToolResultBudgetStage(messages: RuntimeMessage[]): {
    didModify: boolean;
    messages: RuntimeMessage[];
  } {
    this.stages.push({
      name: "tool_result_budget",
      didRun: true,
      didModify: false,
      description: "Check tool results for budget compliance",
    });

    const maxTokens = this.config.maxToolResultTokens ?? 2000;
    let modified = false;
    const maxChars = maxTokens * 4; // Rough char/token ratio

    const processed = messages.map((msg) => {
      if (msg.role === "runtimeToolOutput") {
        const content = typeof msg.content === "string" ? msg.content : "";
        const tokens = estimateRuntimeMessageTokens(msg);

        if (tokens > maxTokens) {
          modified = true;
          return {
            ...msg,
            content: content.slice(0, maxChars) + "\n\n[Truncated due to size]",
          };
        }
      }
      return msg;
    });

    return { didModify: modified, messages: modified ? processed : messages };
  }

  /**
   * Run micro compact stage - lightweight pruning of excessive content.
   */
  private runMicroCompactStage(
    messages: RuntimeMessage[],
    warningState: TokenWarningState,
  ): { didModify: boolean; messages: RuntimeMessage[] } {
    this.stages.push({
      name: "micro_compact",
      didRun: true,
      didModify: false,
      description: "Lightweight pruning of excessive content",
    });

    // If we're past error threshold, do aggressive micro compaction
    if (warningState.isAboveErrorThreshold) {
      return this.runAggressiveMicroCompact(messages);
    }

    // Otherwise, do conservative micro compaction
    return this.runConservativeMicroCompact(messages);
  }

  private runConservativeMicroCompact(messages: RuntimeMessage[]): {
    didModify: boolean;
    messages: RuntimeMessage[];
  } {
    const maxToolResultChars = 4000;
    let modified = false;

    const processed = messages.map((msg) => {
      if (msg.role === "runtimeToolOutput") {
        const content = typeof msg.content === "string" ? msg.content : "";
        if (content.length > maxToolResultChars) {
          modified = true;
          return {
            ...msg,
            content: content.slice(0, maxToolResultChars) + "\n\n[Output truncated]",
          };
        }
      }
      return msg;
    });

    return { didModify: modified, messages: modified ? processed : messages };
  }

  private runAggressiveMicroCompact(messages: RuntimeMessage[]): {
    didModify: boolean;
    messages: RuntimeMessage[];
  } {
    const maxToolResultChars = 1500;
    let modified = false;

    const processed = messages.map((msg) => {
      if (msg.role === "runtimeToolOutput") {
        const content = typeof msg.content === "string" ? msg.content : "";
        if (content.length > maxToolResultChars) {
          modified = true;
          return {
            ...msg,
            content: content.slice(0, maxToolResultChars) + "\n\n[Output truncated]",
          };
        }
      }
      return msg;
    });

    return { didModify: modified, messages: modified ? processed : messages };
  }

  /**
   * Run context collapse stage - budget-based headroom management.
   */
  private runContextCollapseStage(
    messages: RuntimeMessage[],
    usageEstimate: ContextUsageEstimate,
    warningState: TokenWarningState,
  ): ContextPipelineResult {
    this.stages.push({
      name: "context_collapse",
      didRun: true,
      didModify: false,
      description: "Budget-based headroom management",
    });

    const headroomRatio = this.config.collapseHeadroomRatio ?? 0.15; // 15% headroom target
    const targetTokens = Math.floor(this.budget.effectiveContextWindow * (1 - headroomRatio));

    // If we're already close to target, trigger collapse
    if (usageEstimate.tokens > targetTokens) {
      // Context collapse reduces the oldest content to make room
      const collapseRatio = headroomRatio; // Remove this percentage of context
      const keepRatio = 1 - collapseRatio;

      // Find cut point based on ratio
      const totalTokens = usageEstimate.tokens;
      const targetKeepTokens = Math.floor(totalTokens * keepRatio);

      let accumulated = 0;
      let cutoffIndex = 0;

      for (let i = 0; i < messages.length; i++) {
        const tokens = estimateRuntimeMessageTokens(messages[i]);
        accumulated += tokens;
        if (accumulated > targetKeepTokens) {
          cutoffIndex = i;
          break;
        }
        cutoffIndex = i + 1;
      }

      if (cutoffIndex < messages.length) {
        // Mark that context was collapsed (lightweight, not full compaction)
        const collapsedMessages = messages.slice(cutoffIndex);
        const newUsage = estimateContextTokens(collapsedMessages);

        this.stages[this.stages.length - 1].didModify = true;

        return {
          didCompact: true,
          messages: collapsedMessages,
          usageEstimate: newUsage,
          warningState: calculateTokenWarningState(newUsage.tokens, this.budget),
          budget: this.budget,
        };
      }
    }

    return {
      didCompact: false,
      messages,
      usageEstimate,
      warningState,
      budget: this.budget,
    };
  }

  /**
   * Run auto compact stage - LLM-based summarization.
   */
  private async runAutoCompactStage(
    session: Session,
    messages: RuntimeMessage[],
    usageEstimate: ContextUsageEstimate,
  ): Promise<ContextPipelineResult> {
    this.stages.push({
      name: "auto_compact",
      didRun: true,
      didModify: false,
      description: "LLM-based context summarization",
    });

    const envelopes = this.buildEnvelopesFromMessages(messages);
    const model = createModelFromConfig(this.config.providerConfig);
    const plan = buildCompactionPlan(envelopes, model.contextWindow, "threshold");

    if (!plan) {
      return {
        didCompact: false,
        messages,
        usageEstimate,
        warningState: calculateTokenWarningState(usageEstimate.tokens, this.budget),
        budget: this.budget,
      };
    }

    const summary = await generateCompactionSummary(
      {
        sessionId: session.id,
        providerConfig: this.config.providerConfig,
        mode: "threshold",
        tokensBefore: plan.tokensBefore,
        tokensKept: plan.tokensKept,
        keepRecentTokens: plan.keepRecentTokens,
        summaryMessages: plan.summaryMessages,
        keptMessages: plan.keptMessages,
      },
      this.config.summarizer,
    );

    const snapshot = sessionCompactionSnapshotSchema.parse({
      version: 1,
      summary,
      compactedAt: nowIso(),
      firstKeptHistoryEntryId: plan.firstKeptHistoryEntryId,
      firstKeptTimestamp: plan.firstKeptTimestamp,
      tokensBefore: plan.tokensBefore,
      tokensKept: plan.tokensKept,
    });

    this.stages[this.stages.length - 1].didModify = true;

    return {
      didCompact: true,
      messages: plan.keptMessages,
      usageEstimate: {
        tokens: plan.tokensKept,
        usageTokens: plan.tokensKept,
        trailingTokens: 0,
        lastUsageIndex: null,
      },
      warningState: calculateTokenWarningState(plan.tokensKept, this.budget),
      compactionSnapshot: snapshot,
      budget: this.budget,
    };
  }

  /**
   * Build envelopes from messages for compaction planning.
   */
  private buildEnvelopesFromMessages(messages: RuntimeMessage[]): SessionRuntimeMessageEnvelope[] {
    return messages.map((msg, index) => ({
      message: msg,
      timestamp: Date.now() - (messages.length - index) * 1000,
      order: index,
      sourceHistoryEntryId: null,
    }));
  }

  /**
   * Get pipeline report.
   */
  getReport(): ContextPipelineReport {
    return {
      didFullCompaction: this.stages.some((s) => s.name === "auto_compact" && s.didModify),
      stages: this.stages,
      finalWarningState: calculateTokenWarningState(0, this.budget),
      finalBudget: this.budget,
    };
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Run a quick context budget check.
 */
export function quickBudgetCheck(
  messages: RuntimeMessage[],
  config: ProviderConfig,
): TokenWarningState {
  const budget = createContextBudget(config);
  const usage = estimateRuntimeMessagesTokens(messages);
  return calculateTokenWarningState(usage, budget);
}

/**
 * Check if context needs attention.
 */
export function needsContextAttention(
  messages: RuntimeMessage[],
  config: ProviderConfig,
): boolean {
  const state = quickBudgetCheck(messages, config);
  return (
    state.isAboveAutoCompactThreshold ||
    state.isAboveWarningThreshold ||
    state.isAtBlockingLimit
  );
}

/**
 * Get context health percentage (0-100).
 */
export function getContextHealth(messages: RuntimeMessage[], config: ProviderConfig): number {
  const state = quickBudgetCheck(messages, config);
  return state.percentLeft;
}
