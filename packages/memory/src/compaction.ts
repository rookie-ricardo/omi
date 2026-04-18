import type { Message } from "@mariozechner/pi-ai";

/**
 * Configuration for the context compaction strategy.
 */
export interface CompactionConfig {
  /** Model context window size in tokens. */
  contextWindow: number;
  /** Tokens reserved for model output generation. Default: 16384. */
  reserveTokens?: number;
  /** Tokens to keep from the most recent messages. Default: 20000. */
  keepRecentTokens?: number;
}

const DEFAULT_RESERVE_TOKENS = 16_384;
const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count for a message using a fast heuristic (~4 chars/token).
 */
function estimateMessageTokens(message: Message): number {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return Math.ceil(message.content.length / CHARS_PER_TOKEN);
    }
    let chars = 0;
    for (const part of message.content) {
      if (part.type === "text") {
        chars += part.text.length;
      } else {
        // Image tokens: rough estimate for base64 encoded images
        chars += 1000;
      }
    }
    return Math.ceil(chars / CHARS_PER_TOKEN);
  }

  if (message.role === "assistant") {
    let chars = 0;
    for (const part of message.content) {
      if (part.type === "text") {
        chars += part.text.length;
      } else if (part.type === "thinking") {
        chars += part.thinking.length;
      } else {
        // toolCall
        chars += part.name.length + JSON.stringify(part.arguments ?? {}).length;
      }
    }
    return Math.ceil(chars / CHARS_PER_TOKEN);
  }

  // toolResult
  let chars = 0;
  for (const part of message.content) {
    if (part.type === "text") {
      chars += part.text.length;
    } else {
      chars += 1000;
    }
  }
  if (message.details !== undefined) {
    chars += JSON.stringify(message.details).length;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Check if a message index is a valid cut point.
 * Tool results must stay paired with their preceding assistant tool call,
 * so we never cut immediately before a toolResult.
 */
function isValidCutPoint(messages: Message[], index: number): boolean {
  if (index >= messages.length) return true;
  // Don't cut before a tool result — it must stay with its tool call
  return messages[index].role !== "toolResult";
}

/**
 * Find the cut point by walking backward from the end, accumulating
 * tokens until the keepRecentTokens budget is exhausted.
 */
function findCutPoint(messages: Message[], keepRecentTokens: number): number {
  let accumulated = 0;
  let cutPoint = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateMessageTokens(messages[i]);
    if (accumulated + tokens > keepRecentTokens) {
      // Budget exhausted — cut here, but snap to a valid boundary
      cutPoint = i + 1;
      break;
    }
    accumulated += tokens;
    cutPoint = i;
  }

  // Snap forward to a valid cut point (don't split tool call / tool result pairs)
  while (cutPoint < messages.length && !isValidCutPoint(messages, cutPoint)) {
    cutPoint++;
  }

  return cutPoint;
}

/**
 * Create a transformContext function for pi-agent-core's Agent.
 *
 * This implements a simple truncation strategy:
 * - If total tokens fit within the context budget, return messages unchanged.
 * - Otherwise, find a cut point and drop older messages, keeping recent ones.
 *
 * The cut-point algorithm respects turn boundaries by never splitting
 * tool call / tool result pairs.
 */
export function createTransformContext(
  config: CompactionConfig,
): (messages: Message[], signal?: AbortSignal) => Promise<Message[]> {
  const reserveTokens = config.reserveTokens ?? DEFAULT_RESERVE_TOKENS;
  const keepRecentTokens = config.keepRecentTokens ?? DEFAULT_KEEP_RECENT_TOKENS;
  const maxContextTokens = config.contextWindow - reserveTokens;

  return async (messages: Message[]): Promise<Message[]> => {
    // Fast path: estimate total tokens
    let totalTokens = 0;
    for (const msg of messages) {
      totalTokens += estimateMessageTokens(msg);
    }

    if (totalTokens <= maxContextTokens) {
      return messages;
    }

    // Over budget — find cut point keeping recent messages
    const cutPoint = findCutPoint(messages, keepRecentTokens);

    if (cutPoint === 0) {
      // Even the recent budget exceeds all messages — nothing to cut
      return messages;
    }

    return messages.slice(cutPoint);
  };
}

export { estimateMessageTokens };
