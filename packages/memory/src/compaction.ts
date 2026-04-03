import { completeSimple, getOverflowPatterns, type AssistantMessage, type Model, type Usage } from "@mariozechner/pi-ai";
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
import { ContextPipelineCoordinator } from "./context-pipeline";
import { getLogger } from "./logger";

const logger = getLogger("memory:compaction");

export type CompactionMode = "manual" | "threshold" | "overflow";

// ============================================================================
// Constants and Types
// ============================================================================

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

export interface CompactionResult<T = unknown> {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;
}

export interface CompactionPreparation {
  firstKeptEntryId: string;
  messagesToSummarize: RuntimeMessage[];
  turnPrefixMessages: RuntimeMessage[];
  isSplitTurn: boolean;
  tokensBefore: number;
  previousSummary?: string;
  fileOps: FileOperations;
  settings: CompactionSettings;
}

export interface ContextUsageEstimate {
  tokens: number;
  usageTokens: number;
  trailingTokens: number;
  lastUsageIndex: number | null;
}

export interface CutPointResult {
  firstKeptEntryIndex: number;
  turnStartIndex: number;
  isSplitTurn: boolean;
}

// ============================================================================
// Summarization Prompts
// ============================================================================

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI coding assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`;

// ============================================================================
// File Operations Tracking
// ============================================================================

/** File operations tracking for compaction */
export interface FileOperations {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
}

export interface CompactionDetails {
  readFiles: string[];
  modifiedFiles: string[];
}

/**
 * Create a new FileOperations set for tracking.
 */
export function createFileOps(): FileOperations {
  return {
    read: new Set(),
    written: new Set(),
    edited: new Set(),
  };
}

/**
 * Extract file operations from runtime messages.
 * Looks for read/write/edit tool calls in tool output messages.
 */
export function extractFileOpsFromMessages(messages: RuntimeMessage[], fileOps: FileOperations): void {
  for (const message of messages) {
    if (message.role === "runtimeToolOutput") {
      const details = message.details as { toolInput?: { toolName?: string; args?: Record<string, unknown> } };
      const toolName = details?.toolInput?.toolName;
      const args = details?.toolInput?.args;

      if (args && "path" in args && typeof args.path === "string") {
        const path = args.path as string;
        switch (toolName) {
          case "read":
            fileOps.read.add(path);
            break;
          case "write":
            fileOps.written.add(path);
            break;
          case "edit":
            fileOps.edited.add(path);
            break;
        }
      }
    }
  }
}

/**
 * Compute final file lists from file operations.
 * Returns readFiles (files only read, not modified) and modifiedFiles.
 */
export function computeFileLists(fileOps: FileOperations): {
  readFiles: string[];
  modifiedFiles: string[];
} {
  const modified = new Set([...fileOps.edited, ...fileOps.written]);
  const readOnly = [...fileOps.read].filter((f) => !modified.has(f)).sort();
  const modifiedFiles = [...modified].sort();
  return { readFiles: readOnly, modifiedFiles };
}

/**
 * Format file operations as XML tags for summary.
 */
export function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
  const sections: string[] = [];
  if (readFiles.length > 0) {
    sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
  }
  if (modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
  }
  if (sections.length === 0) return "";
  return `\n\n${sections.join("\n\n")}`;
}

// ============================================================================
// Token Calculation Functions
// ============================================================================

/**
 * Get usage from an assistant transcript message if available.
 * Skips aborted and error messages as they don't have valid usage data.
 */
function getAssistantUsage(msg: RuntimeMessage): Usage | undefined {
  if (msg.role === "assistantTranscript") {
    const assistantMsg = msg as RuntimeMessage & { usage?: Usage; stopReason?: string };
    if (assistantMsg.stopReason !== "aborted" && assistantMsg.stopReason !== "error" && assistantMsg.usage) {
      return assistantMsg.usage;
    }
  }
  return undefined;
}

/**
 * Get last assistant usage info from messages.
 */
function getLastAssistantUsageInfo(messages: RuntimeMessage[]): { usage: Usage; index: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = getAssistantUsage(messages[i]);
    if (usage) return { usage, index: i };
  }
  return undefined;
}

/**
 * Find the last non-aborted assistant message usage from messages.
 */
export function getLastAssistantUsage(messages: RuntimeMessage[]): Usage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = getAssistantUsage(messages[i]);
    if (usage) return usage;
  }
  return undefined;
}

/**
 * Estimate context tokens from messages, using the last assistant usage when available.
 * If there are messages after the last usage, estimate their tokens.
 */
export function estimateContextTokens(messages: RuntimeMessage[]): ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages);

  if (!usageInfo) {
    let estimated = 0;
    for (const message of messages) {
      estimated += estimateRuntimeMessageTokens(message);
    }
    return {
      tokens: estimated,
      usageTokens: 0,
      trailingTokens: estimated,
      lastUsageIndex: null,
    };
  }

  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    trailingTokens += estimateRuntimeMessageTokens(messages[i]);
  }

  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: usageInfo.index,
  };
}

/**
 * Check if compaction should trigger based on context usage.
 */
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
  if (!settings.enabled) return false;
  return contextTokens > contextWindow - settings.reserveTokens;
}

// ============================================================================
// Cut Point Detection
// ============================================================================

/**
 * Find valid cut points: indices of user, assistant, or custom messages.
 * Never cut at tool results (they must follow their tool call).
 */
function findValidCutPoints(envelopes: SessionRuntimeMessageEnvelope[], startIndex: number, endIndex: number): number[] {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const msg = envelopes[i].message;
    switch (msg.role) {
      case "user":
      case "assistantTranscript":
      case "custom":
      case "branchSummary":
      case "compactionSummary":
        cutPoints.push(i);
        break;
      case "runtimeToolOutput":
      case "bashExecution":
        break;
    }
  }
  return cutPoints;
}

/**
 * Find the user message that starts the turn containing the given entry index.
 * Returns -1 if no turn start found before the index.
 */
export function findTurnStartIndex(envelopes: SessionRuntimeMessageEnvelope[], entryIndex: number, startIndex: number): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    const msg = envelopes[i].message;
    if (msg.role === "user" || msg.role === "branchSummary" || msg.role === "compactionSummary") {
      return i;
    }
  }
  return -1;
}

/**
 * Find the cut point in session entries that keeps approximately `keepRecentTokens`.
 * Protected history entries (from key memories) are excluded from compaction candidates.
 */
export function findCutPoint(
  envelopes: SessionRuntimeMessageEnvelope[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
  protectedHistoryEntryIds?: Set<string>,
): CutPointResult {
  // Build cut points excluding protected entries
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const envelope = envelopes[i];
    const msg = envelope.message;

    // Skip protected entries - they must be kept
    if (protectedHistoryEntryIds?.has(envelope.sourceHistoryEntryId ?? "")) {
      continue;
    }

    switch (msg.role) {
      case "user":
      case "assistantTranscript":
      case "custom":
      case "branchSummary":
      case "compactionSummary":
        cutPoints.push(i);
        break;
      case "runtimeToolOutput":
      case "bashExecution":
        // Tool results can be cut if their parent is not protected
        cutPoints.push(i);
        break;
    }
  }

  if (cutPoints.length === 0) {
    return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
  }

  // Walk backwards from newest, accumulating estimated message sizes
  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0]; // Default: keep from first message

  for (let i = endIndex - 1; i >= startIndex; i--) {
    // Skip protected entries in accumulation
    if (protectedHistoryEntryIds?.has(envelopes[i].sourceHistoryEntryId ?? "")) {
      continue;
    }

    const messageTokens = estimateRuntimeMessageTokens(envelopes[i].message);
    accumulatedTokens += messageTokens;

    // Check if we've exceeded the budget
    if (accumulatedTokens >= keepRecentTokens) {
      // Find the closest valid cut point at or after this entry
      for (let c = 0; c < cutPoints.length; c++) {
        if (cutPoints[c] >= i) {
          cutIndex = cutPoints[c];
          break;
        }
      }
      break;
    }
  }

  // Determine if this is a split turn
  const cutEntry = envelopes[cutIndex];
  const isUserMessage = cutEntry.message.role === "user";
  const turnStartIndex = isUserMessage ? -1 : findTurnStartIndex(envelopes, cutIndex, startIndex);

  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUserMessage && turnStartIndex !== -1,
  };
}

// ============================================================================
// Compaction Preparation and Execution
// ============================================================================

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

/**
 * Calculate total context tokens from usage object.
 * Uses the native totalTokens field when available, falls back to computing from components.
 */
export function calculateContextTokens(usage: Usage): number {
  return usage.totalTokens || usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
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
  protectedHistoryEntryIds?: Set<string>,
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

  const cutoffIndex = findCutoffIndex(envelopes, keepRecentTokens, protectedHistoryEntryIds);
  if (mode === "threshold" && cutoffIndex === 0) {
    return null;
  }

  // Find the first entry that is NOT protected - that's our cutoff
  let effectiveCutoffIndex = cutoffIndex;
  for (let i = cutoffIndex; i < envelopes.length; i++) {
    const entryId = envelopes[i].sourceHistoryEntryId;
    if (!protectedHistoryEntryIds?.has(entryId ?? "")) {
      effectiveCutoffIndex = i;
      break;
    }
    effectiveCutoffIndex = i + 1;
  }

  const summaryMessages = envelopes.slice(0, effectiveCutoffIndex).map((entry) => entry.message);
  const keptEnvelopes = envelopes.slice(effectiveCutoffIndex);
  const keptMessages = keptEnvelopes.map((entry) => entry.message);
  const tokensKept = estimateRuntimeMessagesTokens(keptMessages);
  const firstKeptEnvelope = keptEnvelopes[0] ?? null;

  return {
    mode,
    keepRecentTokens,
    tokensBefore,
    tokensKept,
    cutoffIndex: effectiveCutoffIndex,
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
  const lowerMessage = message.toLowerCase();
  return (
    getOverflowPatterns().some((pattern) => pattern.test(message)) ||
    lowerMessage.includes("token limit") ||
    lowerMessage.includes("context limit") ||
    lowerMessage.includes("output token limit")
  );
}

/**
 * Patterns for retryable errors (excluding context overflow which is handled separately)
 * - overloaded_error, rate_limit, 429
 * - 500, 502, 503, 504
 * - network_error, connection_refused, fetch_failed, timeout
 */
const RETRYABLE_PATTERNS = [
  /overloaded/i,
  /rate.?limit/i,
  /\b429\b/,
  /\b500\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /network.?error/i,
  /connection.?refused/i,
  /fetch.?failed/i,
  /timeout/i,
  /econnrefused/i,
  /etimedout/i,
  /socket.?hang.?up/i,
] as const;

/**
 * Check if an error is retryable (excludes context overflow errors)
 * @param error - The error to check
 * @returns true if the error is retryable with exponential backoff
 */
export function isRetryableError(error: unknown): boolean {
  // First check if it's an overflow error - those are handled separately
  if (isOverflowError(error)) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Extract delay from error message if server specifies a retry-after delay
 * @param error - The error to check
 * @returns Delay in milliseconds, or undefined if not specified
 */
export function extractRetryAfterDelay(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : String(error);

  // Match patterns like "retry after 5s", "try again in 10 seconds", etc.
  const delayMatch = message.match(/(?:retry|try again|wait|delay).*?(\d+)\s*(s|sec|seconds?|ms|milli?seconds?)/i);
  if (delayMatch) {
    const value = parseInt(delayMatch[1], 10);
    const unit = delayMatch[2].toLowerCase();
    if (unit.startsWith("ms") || unit.startsWith("milli")) {
      return value;
    }
    return value * 1000; // Convert seconds to milliseconds
  }

  return undefined;
}

function resolveKeepRecentTokens(contextWindow: number, mode: CompactionMode): number {
  const ratio =
    mode === "manual" ? 0.05 : mode === "overflow" ? 0.1 : 0.2;
  const floor =
    mode === "manual" ? 1 : mode === "overflow" ? 1_024 : 2_048;
  return Math.max(floor, Math.floor(contextWindow * ratio));
}

function findCutoffIndex(
  envelopes: SessionRuntimeMessageEnvelope[],
  keepRecentTokens: number,
  protectedHistoryEntryIds?: Set<string>,
): number {
  let tokensKept = 0;
  let cutoffIndex = envelopes.length;

  for (let index = envelopes.length - 1; index >= 0; index -= 1) {
    // Protected entries are always kept, skip them in the calculation
    const entryId = envelopes[index].sourceHistoryEntryId;
    if (protectedHistoryEntryIds?.has(entryId ?? "")) {
      continue;
    }

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

// ============================================================================
// Message Serialization
// ============================================================================

/** Maximum characters for a tool result in serialized summaries. */
const TOOL_RESULT_MAX_CHARS = 2000;

/**
 * Truncate text to a maximum character length for summarization.
 * Keeps the beginning and appends a truncation marker.
 */
function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncatedChars = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`;
}

/**
 * Serialize runtime messages to text for summarization.
 * This prevents the model from treating it as a conversation to continue.
 */
export function serializeConversation(messages: RuntimeMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const content = typeof msg.content === "string"
        ? msg.content
        : msg.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("");
      if (content) parts.push(`[User]: ${content}`);
    } else if (msg.role === "assistantTranscript") {
      const textParts: string[] = [];
      const content = msg.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            textParts.push(block.text);
          }
        }
      }
      if (textParts.length > 0) {
        parts.push(`[Assistant]: ${textParts.join("\n")}`);
      }
    } else if (msg.role === "runtimeToolOutput") {
      const content = typeof msg.content === "string"
        ? msg.content
        : msg.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("");
      if (content) {
        parts.push(`[Tool result]: ${truncateForSummary(content, TOOL_RESULT_MAX_CHARS)}`);
      }
    } else if (msg.role === "bashExecution") {
      if (msg.output) {
        parts.push(`[Bash]: ${msg.command}\n${truncateForSummary(msg.output, TOOL_RESULT_MAX_CHARS)}`);
      }
    } else if (msg.role === "compactionSummary") {
      parts.push(`[Compaction summary]: ${msg.summary}`);
    } else if (msg.role === "branchSummary") {
      parts.push(`[Branch summary]: ${msg.summary}`);
    }
  }

  return parts.join("\n\n");
}

// ============================================================================
// Summary Generation
// ============================================================================

/**
 * Generate a summary of the conversation using the LLM.
 * If previousSummary is provided, uses the update prompt to merge.
 */
export async function generateSummary(
  currentMessages: RuntimeMessage[],
  model: Model<any>,
  reserveTokens: number,
  apiKey: string,
  signal?: AbortSignal,
  customInstructions?: string,
  previousSummary?: string,
): Promise<string> {
  const maxTokens = Math.floor(0.8 * reserveTokens);

  // Use update prompt if we have a previous summary, otherwise initial prompt
  let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  if (customInstructions) {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
  }

  // Serialize conversation to text so model doesn't try to continue it
  const conversationText = serializeConversation(currentMessages);

  // Build the prompt with conversation wrapped in tags
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  }
  promptText += basePrompt;

  const summarizationMessages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: promptText }],
      timestamp: Date.now(),
    },
  ];

  const completionOptions = model.reasoning
    ? { maxTokens, signal, apiKey, reasoning: "high" as const }
    : { maxTokens, signal, apiKey };

  const response = await completeSimple(
    model,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
    completionOptions,
  );

  if (response.stopReason === "error") {
    throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);
  }

  const textContent = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  return textContent;
}

// ============================================================================
// Compaction Preparation and Execution
// ============================================================================

/**
 * Prepare compaction by analyzing entries and determining what to summarize.
 * Protected history entry IDs are excluded from compaction candidates.
 */
export function prepareCompaction(
  envelopes: SessionRuntimeMessageEnvelope[],
  settings: CompactionSettings,
  protectedHistoryEntryIds?: Set<string>,
): CompactionPreparation | undefined {
  if (envelopes.length === 0) {
    return undefined;
  }

  // Find the last compaction boundary
  let prevCompactionIndex = -1;
  for (let i = envelopes.length - 1; i >= 0; i--) {
    if (envelopes[i].message.role === "compactionSummary") {
      prevCompactionIndex = i;
      break;
    }
  }

  const boundaryStart = prevCompactionIndex + 1;
  const boundaryEnd = envelopes.length;

  // Calculate tokens before compaction (excluding protected entries from the count)
  const usageMessages: RuntimeMessage[] = [];
  for (let i = prevCompactionIndex >= 0 ? prevCompactionIndex : 0; i < boundaryEnd; i++) {
    const entryId = envelopes[i].sourceHistoryEntryId;
    // Include protected entries in the token count for accurate context estimation
    usageMessages.push(envelopes[i].message);
  }
  const tokensBefore = estimateContextTokens(usageMessages).tokens;

  // Find cut point, respecting protected entries
  const cutPoint = findCutPoint(envelopes, boundaryStart, boundaryEnd, settings.keepRecentTokens, protectedHistoryEntryIds);

  // Find the first non-protected entry to keep
  let effectiveFirstKeptIndex = cutPoint.firstKeptEntryIndex;
  for (let i = cutPoint.firstKeptEntryIndex; i < boundaryEnd; i++) {
    const entryId = envelopes[i].sourceHistoryEntryId;
    if (!protectedHistoryEntryIds?.has(entryId ?? "")) {
      effectiveFirstKeptIndex = i;
      break;
    }
    effectiveFirstKeptIndex = i + 1;
  }

  // Get UUID of first kept entry
  const firstKeptEnvelope = envelopes[effectiveFirstKeptIndex];
  if (!firstKeptEnvelope?.sourceHistoryEntryId) {
    return undefined; // Session needs migration
  }
  const firstKeptEntryId = firstKeptEnvelope.sourceHistoryEntryId;

  // Use effective first kept index for determining history end
  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : effectiveFirstKeptIndex;

  // Messages to summarize (will be discarded after summary)
  const messagesToSummarize: RuntimeMessage[] = [];
  for (let i = boundaryStart; i < historyEnd; i++) {
    // Skip protected entries - they're not summarized, they're kept
    const entryId = envelopes[i].sourceHistoryEntryId;
    if (protectedHistoryEntryIds?.has(entryId ?? "")) {
      continue;
    }
    messagesToSummarize.push(envelopes[i].message);
  }

  // Messages for turn prefix summary (if splitting a turn)
  const turnPrefixMessages: RuntimeMessage[] = [];
  if (cutPoint.isSplitTurn) {
    for (let i = cutPoint.turnStartIndex; i < effectiveFirstKeptIndex; i++) {
      // Skip protected entries
      const entryId = envelopes[i].sourceHistoryEntryId;
      if (protectedHistoryEntryIds?.has(entryId ?? "")) {
        continue;
      }
      turnPrefixMessages.push(envelopes[i].message);
    }
  }

  // Get previous summary for iterative update
  let previousSummary: string | undefined;
  if (prevCompactionIndex >= 0) {
    const prevCompaction = envelopes[prevCompactionIndex].message;
    if (prevCompaction.role === "compactionSummary") {
      previousSummary = JSON.stringify(prevCompaction.summary);
    }
  }

  // Extract file operations from messages to summarize
  const fileOps = createFileOps();
  extractFileOpsFromMessages(messagesToSummarize, fileOps);

  // Also extract file ops from turn prefix if splitting
  if (cutPoint.isSplitTurn) {
    extractFileOpsFromMessages(turnPrefixMessages, fileOps);
  }

  return {
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    previousSummary,
    fileOps,
    settings,
  };
}

/**
 * Execute compaction using prepared data.
 */
export async function compact(
  preparation: CompactionPreparation,
  model: Model<any>,
  apiKey: string,
  customInstructions?: string,
  signal?: AbortSignal,
): Promise<CompactionResult> {
  const startTime = Date.now();
  const {
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn,
    tokensBefore,
    previousSummary,
    fileOps,
    settings,
  } = preparation;

  logger.debug("Compaction started", {
    isSplitTurn,
    messagesToSummarize: messagesToSummarize.length,
    turnPrefixMessages: turnPrefixMessages.length,
    tokensBefore,
  });

  try {
    // Generate summaries (can be parallel if both needed) and merge into one
    let summary: string;

    if (isSplitTurn && turnPrefixMessages.length > 0) {
      // Generate both summaries in parallel
      const [historyResult, turnPrefixResult] = await Promise.all([
        messagesToSummarize.length > 0
          ? generateSummary(
              messagesToSummarize,
              model,
              settings.reserveTokens,
              apiKey,
              signal,
              customInstructions,
              previousSummary,
            )
          : Promise.resolve("No prior history."),
        generateSummary(turnPrefixMessages, model, settings.reserveTokens, apiKey, signal),
      ]);
      // Merge into single summary
      summary = `${historyResult}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult}`;
    } else {
      // Just generate history summary
      summary = await generateSummary(
        messagesToSummarize,
        model,
        settings.reserveTokens,
        apiKey,
        signal,
        customInstructions,
        previousSummary,
      );
    }

    // Compute file lists and append to summary
    const { readFiles, modifiedFiles } = computeFileLists(fileOps);
    summary += formatFileOperations(readFiles, modifiedFiles);

    const durationMs = Date.now() - startTime;
    logger.info("Compaction completed", {
      durationMs,
      tokensBefore,
      firstKeptEntryId,
      readFiles: readFiles.length,
      modifiedFiles: modifiedFiles.length,
    });

    return {
      summary,
      firstKeptEntryId,
      tokensBefore,
      details: { readFiles, modifiedFiles } as CompactionDetails,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.errorWithError("Compaction failed", error, {
      durationMs,
      messagesToSummarize: messagesToSummarize.length,
      isSplitTurn,
    });
    throw error;
  }
}
