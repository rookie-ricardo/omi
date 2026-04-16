import type { AssistantMessage, StopReason } from "@mariozechner/pi-ai";
import type { Message } from "@mariozechner/pi-ai";
import type { ProviderConfig } from "@omi/core";

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
    provider: params.providerConfig.type,
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

function renderMessageForTranscript(message: Message): string {
  if (message.role === "user") {
    const text = renderTextLikeContent(message.content);
    return text.length > 0 ? `user: ${text}` : "user:";
  }

  if (message.role === "assistant") {
    const chunks: string[] = [];
    for (const block of message.content) {
      if (block.type === "text") {
        chunks.push(block.text);
      }
      if (block.type === "toolCall") {
        chunks.push(
          `[tool_call:${block.name} id=${block.id} args=${JSON.stringify(block.arguments ?? {})}]`,
        );
      }
    }
    return chunks.length > 0 ? `assistant: ${chunks.join("\n")}` : "assistant:";
  }

  const toolText = renderTextLikeContent(message.content);
  const toolDetails = typeof message.details === "undefined" ? "" : ` details=${JSON.stringify(message.details)}`;
  const base = `tool_result:${message.toolName} id=${message.toolCallId} error=${message.isError}`;
  if (toolText.length > 0) {
    return `${base} output=${toolText}${toolDetails}`;
  }
  return `${base}${toolDetails}`;
}

export function buildSingleTurnPrompt(prompt: string, historyMessages: Message[]): string {
  if (historyMessages.length === 0) {
    return prompt;
  }

  const transcript = historyMessages.map((message) => renderMessageForTranscript(message)).join("\n\n");
  if (prompt.trim().length === 0) {
    return transcript;
  }
  return `${transcript}\n\nuser: ${prompt}`;
}
