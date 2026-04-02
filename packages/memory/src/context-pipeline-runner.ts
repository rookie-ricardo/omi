import type { ProviderConfig, Session } from "@omi/core";
import { createModelFromConfig } from "@omi/provider";

import {
  buildCompactionPlan,
  estimateContextTokens,
  type CompactionMode,
  type CompactionSummaryGenerator,
  type ContextUsageEstimate,
} from "./compaction";
import {
  createRuntimeCompactionSummaryMessage,
  renderRuntimeMessageForPrompt,
  sessionCompactionSnapshotSchema,
  type RuntimeMessage,
  type SessionCompactionSnapshot,
  type SessionRuntimeMessageEnvelope,
} from "./messages";

export interface ContextPipelineConfig {
  providerConfig: ProviderConfig;
  summarizer?: CompactionSummaryGenerator | null;
  enableMicroCompact?: boolean;
  enableContextCollapse?: boolean;
  maxToolResultTokens?: number;
  collapseHeadroomRatio?: number;
}

export interface ContextPipelineStageReport {
  name: "micro_compact" | "context_collapse";
  didModify: boolean;
  reason: string | null;
}

export interface ContextPipelineReport {
  stages: ContextPipelineStageReport[];
}

export interface ContextPipelineResult {
  messages: RuntimeMessage[];
  didCompact: boolean;
  compactionSnapshot?: SessionCompactionSnapshot;
  usageEstimate: ContextUsageEstimate;
}

export interface ContextPipelineExecuteInput {
  session: Session;
  messages: RuntimeMessage[];
  usageEstimate?: ContextUsageEstimate;
}

export class ContextPipeline {
  private readonly report: ContextPipelineReport = {
    stages: [],
  };

  constructor(private readonly config: ContextPipelineConfig) {}

  getReport(): ContextPipelineReport {
    return {
      stages: this.report.stages.map((stage) => ({ ...stage })),
    };
  }

  async execute(input: ContextPipelineExecuteInput): Promise<ContextPipelineResult> {
    const usageEstimate = input.usageEstimate ?? estimateContextTokens(input.messages);
    const model = createModelFromConfig(this.config.providerConfig);
    const maxToolResultTokens = this.config.maxToolResultTokens ?? 2000;
    const collapseHeadroomRatio = this.config.collapseHeadroomRatio ?? 0.15;
    const enableMicroCompact = this.config.enableMicroCompact ?? true;
    const enableContextCollapse = this.config.enableContextCollapse ?? true;
    const contextWindow = model.contextWindow;
    const collapseThreshold = Math.max(1, Math.floor(contextWindow * (1 - collapseHeadroomRatio)));

    const shouldMicroCompact = enableMicroCompact && usageEstimate.trailingTokens > maxToolResultTokens;
    const shouldContextCollapse = enableContextCollapse && usageEstimate.tokens > collapseThreshold;
    const shouldCompact = shouldMicroCompact || shouldContextCollapse;

    if (!shouldCompact) {
      this.report.stages.push({
        name: shouldMicroCompact ? "micro_compact" : "context_collapse",
        didModify: false,
        reason: null,
      });
      return {
        messages: [...input.messages],
        didCompact: false,
        usageEstimate,
      };
    }

    const mode: CompactionMode = usageEstimate.tokens > contextWindow ? "overflow" : "threshold";
    const envelopes = input.messages.map<SessionRuntimeMessageEnvelope>((message, index) => ({
      message,
      timestamp: message.timestamp,
      order: index + 1,
      sourceHistoryEntryId: null,
    }));
    const plan = buildCompactionPlan(envelopes, contextWindow, mode);
    if (!plan) {
      this.report.stages.push({
        name: shouldMicroCompact ? "micro_compact" : "context_collapse",
        didModify: false,
        reason: "no_plan",
      });
      return {
        messages: [...input.messages],
        didCompact: false,
        usageEstimate,
      };
    }

    const summary = this.config.summarizer
      ? await this.config.summarizer.summarize({
          sessionId: input.session.id,
          providerConfig: this.config.providerConfig,
          mode,
          tokensBefore: plan.tokensBefore,
          tokensKept: plan.tokensKept,
          keepRecentTokens: plan.keepRecentTokens,
          summaryMessages: plan.summaryMessages,
          keptMessages: plan.keptMessages,
        })
      : buildFallbackSummary(input.session, plan.summaryMessages, plan.keptMessages);

    const snapshot = sessionCompactionSnapshotSchema.parse({
      version: 1,
      summary,
      compactedAt: new Date().toISOString(),
      firstKeptHistoryEntryId: plan.firstKeptHistoryEntryId,
      firstKeptTimestamp: plan.firstKeptTimestamp,
      tokensBefore: plan.tokensBefore,
      tokensKept: plan.tokensKept,
    });

    this.report.stages.push({
      name: shouldMicroCompact ? "micro_compact" : "context_collapse",
      didModify: true,
      reason: mode,
    });

    return {
      messages: [
        createRuntimeCompactionSummaryMessage(snapshot.summary, Date.parse(snapshot.compactedAt)),
        ...plan.keptMessages,
      ],
      didCompact: true,
      compactionSnapshot: snapshot,
      usageEstimate,
    };
  }
}

function buildFallbackSummary(
  session: Session,
  summaryMessages: RuntimeMessage[],
  keptMessages: RuntimeMessage[],
): SessionCompactionSnapshot["summary"] {
  const summarize = (messages: RuntimeMessage[], maxItems: number): string[] =>
    messages
      .slice(-maxItems)
      .map((message) => renderRuntimeMessageForPrompt(message))
      .filter((item) => item.trim().length > 0);

  return {
    version: 1,
    goal: `Context checkpoint for ${session.title}`,
    constraints: [],
    progress: {
      done: summarize(summaryMessages, 3),
      inProgress: [],
      blocked: [],
    },
    keyDecisions: summarize(summaryMessages, 3),
    nextSteps: summarize(keptMessages, 3),
    criticalContext: summarize([...summaryMessages, ...keptMessages], 5),
  };
}
