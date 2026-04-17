import type { AssistantMessage, StopReason } from "@mariozechner/pi-ai";
import type { Message } from "@mariozechner/pi-ai";
import type { ProviderConfig } from "@omi/core";
import type { ModelMessage, ToolResultPart, UserModelMessage } from "ai";

import type { ModelStopReason, ModelUsage } from "../types";

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

export function mapModelStopReasonToPiAi(reason: ModelStopReason): StopReason {
  if (reason === "max_tokens") return "length";
  if (reason === "error") return "error";
  return "stop";
}

export function mapVercelFinishReasonToModel(reason: string | undefined): ModelStopReason {
  if (reason === "tool-calls") return "error";
  if (reason === "length") return "max_tokens";
  if (reason === "content-filter") return "content_filter";
  if (reason === "error") return "error";
  return "end_turn";
}

export function mapClaudeStopReasonToModel(reason: string | null | undefined): ModelStopReason {
  if (reason === "tool_use") return "error";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "stop_sequence") return "stop_sequence";
  if (reason === "end_turn") return "end_turn";
  if (!reason) return "end_turn";
  return "error";
}

export function createAssistantMessage(params: {
  providerConfig: ProviderConfig;
  assistantText: string;
  usage: ModelUsage;
  stopReason: ModelStopReason;
}): AssistantMessage {
  const timestamp = Date.now();

  return {
    role: "assistant",
    api: params.providerConfig.protocol,
    provider: params.providerConfig.name,
    model: params.providerConfig.model,
    stopReason: mapModelStopReasonToPiAi(params.stopReason),
    timestamp,
    usage: {
      input: params.usage.inputTokens,
      output: params.usage.outputTokens,
      cacheRead: params.usage.cacheReadTokens ?? 0,
      cacheWrite: params.usage.cacheCreationTokens ?? 0,
      totalTokens:
        params.usage.inputTokens +
        params.usage.outputTokens +
        (params.usage.cacheReadTokens ?? 0) +
        (params.usage.cacheCreationTokens ?? 0),
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    content: params.assistantText.trim().length > 0
      ? [{ type: "text" as const, text: params.assistantText }]
      : [],
  };
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

function toModelUserContent(
  message: Extract<Message, { role: "user" }>,
): UserModelMessage["content"] {
  if (typeof message.content === "string") {
    return message.content;
  }

  const parts = message.content.map((part) => {
    if (part.type === "text") {
      return {
        type: "text" as const,
        text: part.text,
      };
    }
    return {
      type: "image" as const,
      image: part.data,
      mediaType: part.mimeType,
    };
  });

  if (parts.length === 1 && parts[0].type === "text") {
    return parts[0].text;
  }

  return parts;
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

function buildToolResultOutput(message: Extract<Message, { role: "toolResult" }>): ToolResultPart["output"] {
  const renderedText = renderTextLikeContent(message.content);
  const isTextOnly = message.content.every((part) => part.type === "text");

  if (isTextOnly && typeof message.details === "undefined" && !message.isError) {
    return {
      type: "text",
      value: renderedText,
    };
  }

  return {
    type: "json",
    value: {
      outputText: renderedText,
      hasNonTextContent: !isTextOnly,
      details: typeof message.details === "undefined" ? null : message.details,
      isError: message.isError,
    },
  };
}

export function buildModelMessages(prompt: string, historyMessages: Message[]): ModelMessage[] {
  const messages: ModelMessage[] = [];

  for (const message of historyMessages) {
    if (message.role === "user") {
      messages.push({
        role: "user",
        content: toModelUserContent(message),
      });
      continue;
    }

    if (message.role === "assistant") {
      messages.push({
        role: "assistant",
        content: message.content.map((part) => {
          if (part.type === "text") {
            return { type: "text", text: part.text };
          }
          if (part.type === "thinking") {
            return { type: "reasoning", text: part.thinking };
          }
          return {
            type: "tool-call",
            toolCallId: part.id,
            toolName: part.name,
            input: part.arguments ?? {},
          };
        }),
      });
      continue;
    }

    messages.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          output: buildToolResultOutput(message),
        },
      ],
    });
  }

  if (prompt.trim().length > 0) {
    messages.push({
      role: "user",
      content: prompt,
    });
  }

  return messages;
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
