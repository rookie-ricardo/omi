import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import {
  compactionSummaryDocumentSchema,
  type CompactionSummaryDocument,
  type SessionHistoryEntry,
  type SessionMessage,
  type ToolCall,
} from "@omi/core";
import { z } from "zod";

export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const COMPACTION_SUMMARY_SUFFIX = `
</summary>`;

export const BRANCH_SUMMARY_PREFIX = `The branch history before this point was summarized as:

<summary>
`;

export const BRANCH_SUMMARY_SUFFIX = `
</summary>`;

/**
 * Message type for bash executions via the ! command.
 */
export interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
  timestamp: number;
  /** If true, this message is excluded from LLM context (!! prefix) */
  excludeFromContext?: boolean;
}

export interface RuntimeUserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface RuntimeAssistantTranscriptMessage {
  role: "assistantTranscript";
  content: string;
  timestamp: number;
}

export type RuntimeToolResultMessage = ToolResultMessage;

export interface RuntimeCompactionSummaryMessage {
  role: "compactionSummary";
  summary: CompactionSummaryDocument;
  compactedAt: number;
  timestamp: number;
}

export interface RuntimeBranchSummaryMessage {
  role: "branchSummary";
  summary: string;
  fromId?: string;
  timestamp: number;
}

export interface RuntimeCustomMessage {
  role: "custom";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display: boolean;
  details?: unknown;
  timestamp: number;
}

export interface RuntimeToolOutputMessage {
  role: "runtimeToolOutput";
  toolCallId: string;
  toolName: string;
  content: string | (TextContent | ImageContent)[];
  details?: unknown;
  isError: boolean;
  timestamp: number;
}

export type RuntimeMessage =
  | RuntimeUserMessage
  | RuntimeAssistantTranscriptMessage
  | RuntimeToolResultMessage
  | RuntimeCompactionSummaryMessage
  | RuntimeBranchSummaryMessage
  | RuntimeCustomMessage
  | RuntimeToolOutputMessage
  | BashExecutionMessage;

export interface SessionCompactionSnapshot {
  version: 1;
  summary: CompactionSummaryDocument;
  compactedAt: string;
  firstKeptHistoryEntryId: string | null;
  firstKeptTimestamp: string | null;
  tokensBefore: number;
  tokensKept: number;
}

export { compactionSummaryDocumentSchema } from "@omi/core";
export type { CompactionSummaryDocument } from "@omi/core";

export const sessionCompactionSnapshotSchema: z.ZodType<SessionCompactionSnapshot> = z.object({
  version: z.literal(1),
  summary: compactionSummaryDocumentSchema,
  compactedAt: z.string(),
  firstKeptHistoryEntryId: z.string().nullable(),
  firstKeptTimestamp: z.string().nullable(),
  tokensBefore: z.number(),
  tokensKept: z.number(),
});

export interface SessionRuntimeMessageInput {
  messages: SessionMessage[];
  toolCalls: ToolCall[];
  compaction: SessionCompactionSnapshot | null;
  historyEntries?: SessionHistoryEntry[];
  branchLeafEntryId?: string | null;
}

export interface SessionRuntimeMessageEnvelope {
  message: RuntimeMessage;
  timestamp: number;
  order: number;
  sourceHistoryEntryId: string | null;
}

export function createRuntimeCompactionSummaryMessage(
  summary: CompactionSummaryDocument,
  timestamp = Date.now(),
): RuntimeCompactionSummaryMessage {
  return {
    role: "compactionSummary",
    summary,
    compactedAt: timestamp,
    timestamp,
  };
}

export function createRuntimeBranchSummaryMessage(
  summary: string,
  fromId?: string,
  timestamp = Date.now(),
): RuntimeBranchSummaryMessage {
  return {
    role: "branchSummary",
    summary,
    fromId,
    timestamp,
  };
}

/**
 * Create a bash execution message.
 */
export function createBashExecutionMessage(
  command: string,
  output: string,
  exitCode: number | undefined,
  cancelled: boolean,
  truncated: boolean,
  fullOutputPath?: string,
  excludeFromContext?: boolean,
  timestamp = Date.now(),
): BashExecutionMessage {
  return {
    role: "bashExecution",
    command,
    output,
    exitCode,
    cancelled,
    truncated,
    fullOutputPath,
    excludeFromContext,
    timestamp,
  };
}

/**
 * Convert a BashExecutionMessage to user message text for LLM context.
 */
export function bashExecutionToText(msg: BashExecutionMessage): string {
  let text = `Ran \`${msg.command}\`\n`;
  if (msg.output) {
    text += `\`\`\`\n${msg.output}\n\`\`\``;
  } else {
    text += "(no output)";
  }
  if (msg.cancelled) {
    text += "\n\n(command cancelled)";
  } else if (msg.exitCode !== null && msg.exitCode !== undefined && msg.exitCode !== 0) {
    text += `\n\nCommand exited with code ${msg.exitCode}`;
  }
  if (msg.truncated && msg.fullOutputPath) {
    text += `\n\n[Output truncated. Full output: ${msg.fullOutputPath}]`;
  }
  return text;
}

export function createRuntimeCustomMessage(
  customType: string,
  content: string | (TextContent | ImageContent)[],
  display: boolean,
  details: unknown | undefined,
  timestamp = Date.now(),
): RuntimeCustomMessage {
  return {
    role: "custom",
    customType,
    content,
    display,
    details,
    timestamp,
  };
}

export function createRuntimeToolOutputMessage(
  toolCallId: string,
  toolName: string,
  content: string | (TextContent | ImageContent)[],
  isError: boolean,
  details: unknown | undefined,
  timestamp = Date.now(),
): RuntimeToolOutputMessage {
  return {
    role: "runtimeToolOutput",
    toolCallId,
    toolName,
    content,
    isError,
    details,
    timestamp,
  };
}

export function buildSessionRuntimeMessages(input: SessionRuntimeMessageInput): RuntimeMessage[] {
  const envelopes = buildSessionRuntimeMessageEnvelopes(input);
  const runtimeMessages: RuntimeMessage[] = [];
  if (input.compaction) {
    const compactedAt = Date.parse(input.compaction.compactedAt);
    runtimeMessages.push(
      createRuntimeCompactionSummaryMessage(
        input.compaction.summary,
        Number.isFinite(compactedAt) ? compactedAt : Date.now(),
      ),
    );
  }

  runtimeMessages.push(...applyCompactionEnvelopeFilter(envelopes, input.compaction).map((entry) => entry.message));
  return runtimeMessages;
}

export function buildBranchRuntimeMessages(input: SessionRuntimeMessageInput): RuntimeMessage[] {
  return buildSessionRuntimeMessages(input);
}

export function buildSessionRuntimeMessageEnvelopes(
  input: SessionRuntimeMessageInput,
): SessionRuntimeMessageEnvelope[] {
  const branchEntries = resolveBranchLineage(input.historyEntries, input.branchLeafEntryId);
  if (!branchEntries) {
    return buildLinearSessionRuntimeMessageEnvelopes(input);
  }

  return buildBranchRuntimeMessageEnvelopes(input, branchEntries);
}

function buildLinearSessionRuntimeMessageEnvelopes(
  input: SessionRuntimeMessageInput,
): SessionRuntimeMessageEnvelope[] {
  const entries: SessionRuntimeMessageEnvelope[] = [];
  const messageHistoryEntryByMessageId = new Map(
    (input.historyEntries ?? []).map((entry) => [entry.messageId, entry.id] as const).filter((pair) => pair[0]),
  );
  let order = 0;

  for (const message of input.messages) {
    const timestamp = Date.parse(message.createdAt);

    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }

    const runtimeMessage =
      message.role === "user"
        ? {
            role: "user" as const,
            content: message.content,
            timestamp,
          }
        : {
            role: "assistantTranscript" as const,
            content: message.content,
            timestamp,
          };

    entries.push({
      timestamp,
      order: order += 1,
      message: runtimeMessage,
      sourceHistoryEntryId: messageHistoryEntryByMessageId.get(message.id) ?? null,
    });
  }

  for (const toolCall of input.toolCalls) {
    const timestamp = Date.parse(toolCall.createdAt);
    if (!toolCall.output && !toolCall.error) {
      continue;
    }

    entries.push({
      timestamp,
      order: order += 1,
      message: createRuntimeToolOutputMessage(
        toolCall.id,
        toolCall.toolName,
        toolCall.output ? JSON.stringify(toolCall.output, null, 2) : toolCall.error ?? "",
        Boolean(toolCall.error),
        toolCall.output ?? { error: toolCall.error ?? "Tool execution failed." },
        timestamp,
      ),
      sourceHistoryEntryId: null,
    });
  }

  entries.sort((left, right) => left.timestamp - right.timestamp || left.order - right.order);
  return applyCompactionEnvelopeFilter(entries, input.compaction);
}

function buildBranchRuntimeMessageEnvelopes(
  input: SessionRuntimeMessageInput,
  branchEntries: SessionHistoryEntry[],
): SessionRuntimeMessageEnvelope[] {
  const entries: SessionRuntimeMessageEnvelope[] = [];
  const messagesById = new Map(input.messages.map((message) => [message.id, message]));
  let order = 0;

  for (const entry of branchEntries) {
    const timestamp = Date.parse(entry.createdAt);

    if (entry.kind === "message") {
      const message = entry.messageId ? messagesById.get(entry.messageId) : null;
      if (!message) {
        continue;
      }

      if (message.role !== "user" && message.role !== "assistant") {
        continue;
      }

      const runtimeMessage =
        message.role === "user"
          ? {
              role: "user" as const,
              content: message.content,
              timestamp,
            }
          : {
              role: "assistantTranscript" as const,
              content: message.content,
              timestamp,
            };

      entries.push({
        timestamp,
        order: order += 1,
        message: runtimeMessage,
        sourceHistoryEntryId: entry.id,
      });
      continue;
    }

    if (entry.kind === "branch_summary" && entry.summary) {
      entries.push({
        timestamp,
        order: order += 1,
        message: createRuntimeBranchSummaryMessage(entry.summary, entry.id, timestamp),
        sourceHistoryEntryId: entry.id,
      });
    }
  }

  for (const toolCall of input.toolCalls) {
    const timestamp = Date.parse(toolCall.createdAt);
    if (!toolCall.output && !toolCall.error) {
      continue;
    }

    entries.push({
      timestamp,
      order: order += 1,
      message: createRuntimeToolOutputMessage(
        toolCall.id,
        toolCall.toolName,
        toolCall.output ? JSON.stringify(toolCall.output, null, 2) : toolCall.error ?? "",
        Boolean(toolCall.error),
        toolCall.output ?? { error: toolCall.error ?? "Tool execution failed." },
        timestamp,
      ),
      sourceHistoryEntryId: null,
    });
  }

  entries.sort((left, right) => left.timestamp - right.timestamp || left.order - right.order);
  return applyCompactionEnvelopeFilter(entries, input.compaction);
}

function applyCompactionEnvelopeFilter(
  envelopes: SessionRuntimeMessageEnvelope[],
  compaction: SessionCompactionSnapshot | null,
): SessionRuntimeMessageEnvelope[] {
  if (!compaction) {
    return envelopes;
  }

  const cutoffIndex = resolveCompactionCutoffIndex(envelopes, compaction);
  if (cutoffIndex === null) {
    return envelopes;
  }

  return envelopes.slice(cutoffIndex);
}

function resolveCompactionCutoffIndex(
  envelopes: SessionRuntimeMessageEnvelope[],
  compaction: SessionCompactionSnapshot,
): number | null {
  if (envelopes.length === 0) {
    return null;
  }

  if (compaction.firstKeptHistoryEntryId) {
    const historyIndex = envelopes.findIndex(
      (entry) => entry.sourceHistoryEntryId === compaction.firstKeptHistoryEntryId,
    );
    if (historyIndex !== -1) {
      return historyIndex;
    }
  }

  const preferred = compaction.firstKeptTimestamp ?? compaction.compactedAt;
  const timestamp = Date.parse(preferred);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const timestampIndex = envelopes.findIndex((entry) => entry.timestamp >= timestamp);
  return timestampIndex === -1 ? envelopes.length : timestampIndex;
}

export function renderRuntimeMessageForPrompt(message: RuntimeMessage): string {
  switch (message.role) {
    case "user":
      return `${message.role}: ${contentToText(message.content)}`;
    case "assistantTranscript":
      return `assistant: ${message.content}`;
    case "toolResult":
      return `${message.role}:${message.toolName}: ${contentToText(message.content)}`;
    case "compactionSummary":
      return `compactionSummary: ${renderCompactionSummaryDocument(message.summary)}`;
    case "branchSummary":
      return `branchSummary: ${message.summary}`;
    case "custom":
      return `${message.customType}: ${contentToText(message.content)}`;
    case "runtimeToolOutput":
      return `${message.role}:${message.toolName}: ${contentToText(message.content)}`;
    case "bashExecution":
      return bashExecutionToText(message);
  }
}

export function renderCompactionSummaryDocument(summary: CompactionSummaryDocument): string {
  return JSON.stringify(summary, null, 2);
}

export function renderRuntimeMessagesForPrompt(messages: RuntimeMessage[]): string {
  return messages
    .map((message) => renderRuntimeMessageForPrompt(message))
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function resolveBranchLineage(
  historyEntries: SessionHistoryEntry[] | undefined,
  branchLeafEntryId: string | null | undefined,
): SessionHistoryEntry[] | null {
  if (!historyEntries || historyEntries.length === 0) {
    if (branchLeafEntryId !== null && branchLeafEntryId !== undefined) {
      throw new Error(`History entry ${branchLeafEntryId} not found for session unknown`);
    }
    return null;
  }

  const sorted = historyEntries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => left.entry.createdAt.localeCompare(right.entry.createdAt) || left.index - right.index)
    .map(({ entry }) => entry);
  const byId = new Map(sorted.map((entry) => [entry.id, entry]));
  const leaf =
    branchLeafEntryId !== null && branchLeafEntryId !== undefined ? byId.get(branchLeafEntryId) : sorted.at(-1);
  if (branchLeafEntryId !== null && branchLeafEntryId !== undefined && !leaf) {
    throw new Error(`History entry ${branchLeafEntryId} not found for session ${sorted[0]?.sessionId ?? "unknown"}`);
  }
  if (!leaf) {
    return null;
  }

  const lineage: SessionHistoryEntry[] = [];
  const visited = new Set<string>();
  let current: SessionHistoryEntry | undefined = leaf;

  while (current) {
    if (visited.has(current.id)) {
      throw new Error(`Cycle detected while resolving session history lineage for ${current.sessionId}`);
    }
    visited.add(current.id);
    lineage.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return lineage.reverse();
}

export function convertRuntimeMessagesToLlm(messages: RuntimeMessage[]): Message[] {
  const llmMessages: Message[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "user":
        llmMessages.push(message);
        break;
      case "assistantTranscript":
        llmMessages.push({
          role: "user",
          content: normalizeContent(`assistant: ${message.content}`),
          timestamp: message.timestamp,
        });
        break;
      case "toolResult":
        llmMessages.push(message);
        break;
      case "compactionSummary":
        llmMessages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: `${COMPACTION_SUMMARY_PREFIX}${renderCompactionSummaryDocument(message.summary)}${COMPACTION_SUMMARY_SUFFIX}`,
            },
          ],
          timestamp: message.timestamp,
        });
        break;
      case "branchSummary":
        llmMessages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: `${BRANCH_SUMMARY_PREFIX}${message.summary}${BRANCH_SUMMARY_SUFFIX}`,
            },
          ],
          timestamp: message.timestamp,
        });
        break;
      case "custom":
        llmMessages.push({
          role: "user",
          content: normalizeContent(message.content),
          timestamp: message.timestamp,
        });
        break;
      case "runtimeToolOutput":
        llmMessages.push({
          role: "toolResult",
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          content: normalizeContent(message.content),
          details: message.details,
          isError: message.isError,
          timestamp: message.timestamp,
        });
        break;
      case "bashExecution":
        // Skip messages excluded from context (!! prefix)
        if (message.excludeFromContext) {
          continue;
        }
        llmMessages.push({
          role: "user",
          content: [{ type: "text", text: bashExecutionToText(message) }],
          timestamp: message.timestamp,
        });
        break;
    }
  }

  return llmMessages;
}

export function assistantMessageToText(message: AssistantMessage): string {
  return message.content
    .filter((content): content is TextContent => content.type === "text")
    .map((content) => content.text)
    .join("");
}

function normalizeContent(content: string | (TextContent | ImageContent)[]): (TextContent | ImageContent)[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  return content;
}

function contentToText(
  content: string | Array<{ type: string; text?: string }>,
): string {
  const normalized = typeof content === "string" ? normalizeContent(content) : content;
  return normalized
    .filter((part): part is TextContent => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}
