import { completeSimple, getOverflowPatterns, type Model } from "@mariozechner/pi-ai";
import type { ProviderConfig } from "@omi/core";

import { createModelFromConfig } from "@omi/provider";
import {
  assistantMessageToText,
  compactionSummaryDocumentSchema,
  renderRuntimeMessageForPrompt,
  renderRuntimeMessagesForPrompt,
  type CompactionSummaryDocument,
  type RuntimeMessage,
  type SessionRuntimeMessageEnvelope,
} from "./messages";

export type CompactionMode = "manual" | "threshold" | "overflow";

export interface CompactionPlan {
  mode: CompactionMode;
  keepRecentTokens: number;
  tokensBefore: number;
  tokensKept: number;
  cutoffIndex: number;
  firstKeptHistoryEntryId: string | null;
  firstKeptTimestamp: string | null;
  summaryMessages: RuntimeMessage[];
  keptMessages: RuntimeMessage[];
}

export interface CompactionSummaryInput {
  sessionId: string;
  providerConfig: ProviderConfig;
  mode: CompactionMode;
  tokensBefore: number;
  tokensKept: number;
  keepRecentTokens: number;
  summaryMessages: RuntimeMessage[];
  keptMessages: RuntimeMessage[];
}

export interface CompactionSummaryGenerator {
  summarize(input: CompactionSummaryInput): Promise<CompactionSummaryDocument>;
}

export function estimateTextTokens(text: string): number {
  if (!text.trim()) {
    return 0;
  }

  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateRuntimeMessageTokens(message: RuntimeMessage): number {
  return estimateTextTokens(renderRuntimeMessageForPrompt(message)) + 4;
}

export function estimateRuntimeMessagesTokens(messages: RuntimeMessage[]): number {
  return messages.reduce((total, message) => total + estimateRuntimeMessageTokens(message), 0);
}

export function buildCompactionPlan(
  envelopes: SessionRuntimeMessageEnvelope[],
  contextWindow: number,
  mode: CompactionMode,
): CompactionPlan | null {
  if (envelopes.length === 0) {
    return null;
  }

  let keepRecentTokens = resolveKeepRecentTokens(contextWindow, mode);
  const tokensBefore = estimateRuntimeMessagesTokens(envelopes.map((entry) => entry.message));

  if (mode !== "threshold" && tokensBefore > 0 && tokensBefore <= keepRecentTokens) {
    keepRecentTokens = Math.max(1, Math.floor(tokensBefore / 2));
  }

  if (mode === "threshold" && tokensBefore <= keepRecentTokens) {
    return null;
  }

  const cutoffIndex = findCutoffIndex(envelopes, keepRecentTokens);
  if (mode === "threshold" && cutoffIndex === 0) {
    return null;
  }

  const summaryMessages = envelopes.slice(0, cutoffIndex).map((entry) => entry.message);
  const keptEnvelopes = envelopes.slice(cutoffIndex);
  const keptMessages = keptEnvelopes.map((entry) => entry.message);
  const tokensKept = estimateRuntimeMessagesTokens(keptMessages);
  const firstKeptEnvelope = keptEnvelopes[0] ?? null;

  return {
    mode,
    keepRecentTokens,
    tokensBefore,
    tokensKept,
    cutoffIndex,
    firstKeptHistoryEntryId: firstKeptEnvelope?.sourceHistoryEntryId ?? null,
    firstKeptTimestamp: firstKeptEnvelope ? new Date(firstKeptEnvelope.timestamp).toISOString() : null,
    summaryMessages,
    keptMessages,
  };
}

export async function generateCompactionSummary(
  input: CompactionSummaryInput,
  summarize: CompactionSummaryGenerator | null | undefined,
): Promise<CompactionSummaryDocument> {
  if (summarize) {
    return summarize.summarize(input);
  }

  return defaultCompactionSummaryGenerator(input);
}

export function isOverflowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return getOverflowPatterns().some((pattern) => pattern.test(message));
}

function resolveKeepRecentTokens(contextWindow: number, mode: CompactionMode): number {
  const ratio =
    mode === "manual" ? 0.05 : mode === "overflow" ? 0.1 : 0.2;
  const floor =
    mode === "manual" ? 1 : mode === "overflow" ? 1_024 : 2_048;
  return Math.max(floor, Math.floor(contextWindow * ratio));
}

function findCutoffIndex(envelopes: SessionRuntimeMessageEnvelope[], keepRecentTokens: number): number {
  let tokensKept = 0;
  let cutoffIndex = envelopes.length;

  for (let index = envelopes.length - 1; index >= 0; index -= 1) {
    const tokens = estimateRuntimeMessageTokens(envelopes[index].message);
    if (tokensKept > 0 && tokensKept + tokens > keepRecentTokens) {
      break;
    }

    tokensKept += tokens;
    cutoffIndex = index;

    if (tokensKept >= keepRecentTokens) {
      break;
    }
  }

  return cutoffIndex;
}

async function defaultCompactionSummaryGenerator(
  input: CompactionSummaryInput,
): Promise<CompactionSummaryDocument> {
  const model = createModelFromConfig(input.providerConfig) as Model<any>;
  const systemPrompt = [
    "You compact agent history into a structured summary for deterministic recovery.",
    "Return valid JSON only. Do not wrap the JSON in markdown fences.",
    "The JSON must match this schema exactly:",
    JSON.stringify(
      {
        version: 1,
        goal: "string",
        constraints: ["string"],
        progress: {
          done: ["string"],
          inProgress: ["string"],
          blocked: ["string"],
        },
        keyDecisions: ["string"],
        nextSteps: ["string"],
        criticalContext: ["string"],
      },
      null,
      2,
    ),
    "Rules:",
    "- Use only facts present in the transcript.",
    "- Keep each array concise and concrete.",
    "- Put unresolved blockers in progress.blocked.",
    "- Put decisions that must survive restart in keyDecisions.",
    "- Put the next actionable steps in nextSteps.",
    "- Put anything required to resume safely in criticalContext.",
  ].join("\n\n");

  const messages = [
    {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: [
            `Session: ${input.sessionId}`,
            `Mode: ${input.mode}`,
            `Tokens before compaction: ${input.tokensBefore}`,
            `Tokens kept after compaction: ${input.tokensKept}`,
            "",
            "TO SUMMARIZE:",
            renderRuntimeMessagesForPrompt(input.summaryMessages),
            "",
            "KEPT RECENT CONTEXT:",
            renderRuntimeMessagesForPrompt(input.keptMessages),
            "",
            "Return only the JSON object.",
          ].join("\n"),
        },
      ],
      timestamp: Date.now(),
    },
  ];

  const response = await completeSimple(model, {
    systemPrompt,
    messages,
  }, {
    apiKey: input.providerConfig.apiKey,
    reasoning: "medium",
    maxTokens: 1_024,
  });

  const rawText = assistantMessageToText(response).trim();
  if (!rawText) {
    throw new Error("Compaction summary generation returned an empty response.");
  }

  const parsed = parseCompactionSummaryJson(rawText);
  const result = compactionSummaryDocumentSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Compaction summary did not match the expected schema: ${result.error.message}`,
    );
  }

  return result.data;
}

function parseCompactionSummaryJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() ?? text.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Compaction summary response did not contain JSON: ${text}`);
  }

  return JSON.parse(candidate.slice(start, end + 1));
}
