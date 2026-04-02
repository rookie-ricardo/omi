/**
 * Branch summarization for tree navigation.
 *
 * When navigating to a different point in the session tree, this generates
 * a summary of the branch being left so context isn't lost.
 */

import type { Model } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import type { SessionHistoryEntry } from "@omi/core";

import { convertRuntimeMessagesToLlm, renderRuntimeMessagesForPrompt, type RuntimeMessage } from "./messages";
import { estimateRuntimeMessageTokens, calculateContextTokens, createFileOps, extractFileOpsFromMessages, computeFileLists, formatFileOperations, type FileOperations } from "./compaction";

// ============================================================================
// Types
// ============================================================================

export interface BranchSummaryResult {
  summary?: string;
  readFiles?: string[];
  modifiedFiles?: string[];
  aborted?: boolean;
  error?: string;
}

/** Details stored in BranchSummaryEntry.details for file tracking */
export interface BranchSummaryDetails {
  readFiles: string[];
  modifiedFiles: string[];
}

export interface BranchPreparation {
  /** Messages extracted for summarization, in chronological order */
  messages: RuntimeMessage[];
  /** File operations extracted from tool calls */
  fileOps: FileOperations;
  /** Total estimated tokens in messages */
  totalTokens: number;
}

export interface CollectEntriesResult {
  /** Entries to summarize, in chronological order */
  entries: SessionHistoryEntry[];
  /** Common ancestor between old and new position, if any */
  commonAncestorId: string | null;
}

/** Read-only interface for session access (used by tree navigation) */
export interface ReadonlySessionStore {
  listSessionHistoryEntries(sessionId: string): SessionHistoryEntry[];
}

/**
 * Read-only session manager interface for tree navigation.
 * Matches the ReadonlySessionManager type from pi-mono.
 */
export interface ReadonlySessionManager {
  getSessionId(): string;
  getBranch(targetId: string): SessionHistoryEntry[];
  getEntry(id: string): SessionHistoryEntry | undefined;
}

export interface GenerateBranchSummaryOptions {
  /** Model to use for summarization */
  model: Model<any>;
  /** API key for the model */
  apiKey: string;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Optional custom instructions for summarization */
  customInstructions?: string;
  /** Tokens reserved for prompt + LLM response (default 16384) */
  reserveTokens?: number;
}

// ============================================================================
// System Prompts
// ============================================================================

const BRANCH_SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI coding assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const BRANCH_SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. This summary will be used as context when navigating back to this point in the session tree.

Create a structured summary that:
- Preserves the original user's intent and goal
- Captures key decisions and their rationale
- Lists what was accomplished (files read, modified, or created)
- Identifies what work was in progress
- Provides enough context to continue the work

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

// ============================================================================
// Entry Collection
// ============================================================================

/**
 * Collect entries that should be summarized when navigating from one position to another.
 *
 * Walks from oldLeafId back to the common ancestor with targetId, collecting entries
 * along the way. Does NOT stop at compaction boundaries - those are included and their
 * summaries become context.
 *
 * @param session - ReadonlySessionManager (read-only access)
 * @param oldLeafId - Current position (where we're navigating from)
 * @param targetId - Target position (where we're navigating to)
 * @returns Entries to summarize and the common ancestor
 */
export function collectEntriesForBranchSummary(
  session: ReadonlySessionManager,
  oldLeafId: string | null,
  targetId: string,
): CollectEntriesResult {
  // If no old position, nothing to summarize
  if (!oldLeafId) {
    return { entries: [], commonAncestorId: null };
  }

  // Get branch paths using the session manager
  const oldBranch = session.getBranch(oldLeafId);
  const targetBranch = session.getBranch(targetId);

  // Build sets for lookup
  const oldIds = new Set(oldBranch.map((e) => e.id));

  // Find common ancestor (deepest node on both paths)
  let commonAncestorId: string | null = null;
  for (let i = targetBranch.length - 1; i >= 0; i--) {
    if (oldIds.has(targetBranch[i].id)) {
      commonAncestorId = targetBranch[i].id;
      break;
    }
  }

  // Collect entries from old leaf back to common ancestor
  const entries: SessionHistoryEntry[] = [];
  for (const entry of oldBranch) {
    if (entry.id === commonAncestorId) break;
    entries.push(entry);
  }

  return { entries, commonAncestorId };
}

// ============================================================================
// Entry to Message Conversion
// ============================================================================

/**
 * Prepare entries for summarization with token budget.
 *
 * Walks entries from NEWEST to OLDEST, adding messages until we hit the token budget.
 * This ensures we keep the most recent context when the branch is too long.
 *
 * Also collects file operations from tool calls and existing branch_summary entries' details.
 *
 * @param entries - Session history entries in chronological order
 * @param messages - Messages map (entryId -> RuntimeMessage) for extracting content
 * @param tokenBudget - Maximum tokens to include (0 = no limit)
 */
export function prepareBranchEntries(
  entries: SessionHistoryEntry[],
  messages: Map<string, RuntimeMessage>,
  tokenBudget: number = 0,
): BranchPreparation {
  const fileOps = createFileOps();
  let totalTokens = 0;

  // First pass: collect file ops from ALL entries (even if they don't fit in token budget)
  // This ensures we capture cumulative file tracking from nested branch summaries
  for (const entry of entries) {
    if (entry.kind === "branch_summary" && entry.summary && entry.details) {
      const details = entry.details as BranchSummaryDetails;
      if (Array.isArray(details.readFiles)) {
        for (const f of details.readFiles) fileOps.read.add(f);
      }
      if (Array.isArray(details.modifiedFiles)) {
        for (const f of details.modifiedFiles) {
          fileOps.edited.add(f);
        }
      }
    }

    // Extract file ops from messages
    const msg = messages.get(entry.id);
    if (msg) {
      extractFileOpsFromMessages([msg], fileOps);
    }
  }

  // Second pass: walk from newest to oldest, adding messages until token budget
  const selectedMessages: RuntimeMessage[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const message = messages.get(entry.id);
    if (!message) continue;

    const tokens = estimateRuntimeMessageTokens(message);

    // Check budget before adding
    if (tokenBudget > 0 && totalTokens + tokens > tokenBudget) {
      // If this is a summary entry, try to fit it anyway as it's important context
      if (entry.kind === "branch_summary") {
        if (totalTokens < tokenBudget * 0.9) {
          selectedMessages.unshift(message);
          totalTokens += tokens;
        }
      }
      // Stop - we've hit the budget
      break;
    }

    selectedMessages.unshift(message);
    totalTokens += tokens;
  }

  return { messages: selectedMessages, fileOps, totalTokens };
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Generate a branch summary using the LLM.
 */
export async function generateBranchSummary(
  messages: RuntimeMessage[],
  options: GenerateBranchSummaryOptions,
): Promise<BranchSummaryResult> {
  const { model, apiKey, signal, customInstructions, reserveTokens = 16384 } = options;

  try {
    // Extract file operations
    const fileOps = createFileOps();
    for (const msg of messages) {
      extractFileOpsFromMessages([msg], fileOps);
    }

    // Compute file lists
    const { readFiles, modifiedFiles } = computeFileLists(fileOps);

    // Build prompt
    let promptText = BRANCH_SUMMARIZATION_PROMPT;
    if (customInstructions) {
      promptText = `${promptText}\n\nAdditional focus: ${customInstructions}`;
    }

    // Serialize messages for summarization
    const llmMessages = convertRuntimeMessagesToLlm(messages);
    const conversationText = llmMessages
      .map((msg) => {
        const content =
          typeof msg.content === "string"
            ? msg.content
            : (msg.content as Array<{ type: string; text?: string }>)
                .filter((c) => c.type === "text" && c.text)
                .map((c) => c.text!)
                .join("");
        return `[${msg.role}]: ${content}`;
      })
      .join("\n\n");

    const fullPrompt = `<conversation>\n${conversationText}\n</conversation>\n\n${promptText}`;

    const summarizationMessages = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: fullPrompt }],
        timestamp: Date.now(),
      },
    ];

    const maxTokens = Math.floor(0.8 * reserveTokens);
    const response = await completeSimple(
      model,
      {
        systemPrompt: BRANCH_SUMMARIZATION_SYSTEM_PROMPT,
        messages: summarizationMessages,
      },
      {
        apiKey,
        maxTokens,
        signal,
      },
    );

    if (response.stopReason === "error") {
      return {
        error: `Branch summarization failed: ${response.errorMessage || "Unknown error"}`,
      };
    }

    const textContent = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    // Append file operations to summary
    let summary = textContent;
    const fileOpsSection = formatFileOperations(readFiles, modifiedFiles);
    if (fileOpsSection) {
      summary += fileOpsSection;
    }

    return {
      summary,
      readFiles,
      modifiedFiles,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
