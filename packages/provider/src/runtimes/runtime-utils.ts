import type { AssistantMessage, StopReason } from "@mariozechner/pi-ai";
import type { ProviderConfig } from "@omi/core";

import type { ModelStopReason, ModelToolCall, ModelUsage } from "../model-client/types";

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
  if (reason === "tool_use") return "toolUse";
  if (reason === "max_tokens") return "length";
  if (reason === "error") return "error";
  return "stop";
}

export function mapVercelFinishReasonToModel(reason: string | undefined): ModelStopReason {
  if (reason === "tool-calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "content-filter") return "content_filter";
  if (reason === "error") return "error";
  return "end_turn";
}

export function mapClaudeStopReasonToModel(reason: string | null | undefined): ModelStopReason {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "stop_sequence") return "stop_sequence";
  if (reason === "end_turn") return "end_turn";
  if (!reason) return "end_turn";
  return "error";
}

export function createAssistantMessage(params: {
  providerConfig: ProviderConfig;
  assistantText: string;
  toolCalls: ModelToolCall[];
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
    content: [
      ...(params.assistantText.trim().length > 0
        ? [{ type: "text" as const, text: params.assistantText }]
        : []),
      ...params.toolCalls.map((toolCall) => ({
        type: "toolCall" as const,
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.input,
      })),
    ],
  };
}

export function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

