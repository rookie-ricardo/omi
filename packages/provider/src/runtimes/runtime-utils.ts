import type { Message } from "@mariozechner/pi-ai";

import type { ModelStopReason } from "../types";

export function linkAbortSignal(
  source: AbortSignal | undefined,
  target: AbortController,
): () => void {
  if (!source) {
    return () => {};
  }

  if (source.aborted) {
    target.abort(source.reason);
    return () => {};
  }

  const onAbort = () => {
    target.abort(source.reason);
  };
  source.addEventListener("abort", onAbort, { once: true });
  return () => source.removeEventListener("abort", onAbort);
}

export function mapClaudeStopReasonToModel(reason: string | null | undefined): ModelStopReason {
  if (reason === "tool_use") return "error";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "stop_sequence") return "stop_sequence";
  if (reason === "end_turn") return "end_turn";
  if (!reason) return "end_turn";
  return "error";
}

function renderTextLikeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  const pieces = content.flatMap((part) => {
    if (typeof part !== "object" || part === null) {
      return [];
    }
    const value = part as Record<string, unknown>;
    if (value.type === "text" && typeof value.text === "string") {
      return [value.text];
    }
    if (value.type === "image") {
      return ["[image]"];
    }
    return [];
  });
  return pieces.join("");
}

function serializeMessageForFallbackPrompt(message: Message): Record<string, unknown> {
  if (message.role === "user") {
    const content = typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : message.content.map((part) => {
          if (part.type === "text") {
            return { type: "text", text: part.text };
          }
          return { type: "image", mimeType: part.mimeType };
        });
    return {
      role: "user",
      content,
    };
  }

  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content.map((part) => {
        if (part.type === "text") {
          return { type: "text", text: part.text };
        }
        if (part.type === "thinking") {
          return { type: "thinking", text: part.thinking };
        }
        return {
          type: "tool_call",
          id: part.id,
          name: part.name,
          arguments: part.arguments ?? {},
        };
      }),
    };
  }

  return {
    role: "tool_result",
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    isError: message.isError,
    output: renderTextLikeContent(message.content),
    details: typeof message.details === "undefined" ? null : message.details,
  };
}

/**
 * Claude Agent SDK currently accepts prompt text (or streamed user input) instead of
 * fully-structured model messages. Keep a deterministic fallback rendering so history
 * remains machine-readable when we must bridge through text.
 */
export function buildSingleTurnPrompt(prompt: string, historyMessages: Message[]): string {
  const normalizedPrompt = prompt.trim().length > 0 ? prompt : "";
  return JSON.stringify({
    format: "omi-history-v1",
    history: historyMessages.map((message) => serializeMessageForFallbackPrompt(message)),
    currentUserMessage: normalizedPrompt,
  });
}
