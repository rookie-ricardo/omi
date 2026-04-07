import { type AssistantMessage, type Message, type ToolResultMessage, type StopReason, streamSimple } from "@mariozechner/pi-ai";
import { createHash } from "node:crypto";
import { createModelFromConfig } from "../model-registry";
import type {
  ModelClient,
  ModelClientCallbacks,
  ModelClientRunInput,
  ModelClientRunResult,
  ModelStopReason,
} from "./types";
import { routeProtocol } from "./protocol-router";
import { classifyPiAiError, isRecoverableError } from "./normalizer";

export type { ToolResultMessage } from "@mariozechner/pi-ai";

export function canonicalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeForHash(item));
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const sortedEntries = Object.keys(record)
      .sort()
      .map((key) => [key, canonicalizeForHash(record[key])] as const);
    return Object.fromEntries(sortedEntries);
  }
  return value;
}

export function buildStableToolCallId(
  runId: string,
  toolCall: unknown,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const toolCallSnapshot = JSON.stringify(canonicalizeForHash(toolCall ?? {}));
  const argsSnapshot = JSON.stringify(canonicalizeForHash(args));
  const fingerprint = createHash("sha1")
    .update(`${toolName}|${toolCallSnapshot}|${argsSnapshot}`)
    .digest("hex")
    .slice(0, 16);
  return `${runId}:tool:fallback:${fingerprint}`;
}

export class PiAiModelClient implements ModelClient {
  private readonly abortControllers = new Map<string, AbortController>();

  async run(
    input: ModelClientRunInput,
    callbacks: ModelClientCallbacks,
  ): Promise<ModelClientRunResult> {
    const {
      runId,
      sessionId,
      prompt,
      historyMessages,
      systemPrompt,
      providerConfig,
      enabledTools,
      thinkingLevel,
    } = input;

    routeProtocol(providerConfig);

    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);

    const model = createModelFromConfig(providerConfig);
    const apiTools = (input.tools ?? [])
      .filter((t) => !enabledTools || enabledTools.includes(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters as any,
      }));

    await callbacks.onRequestStart?.(runId, sessionId);

    const messages = [...historyMessages] as Message[];

    if (prompt && prompt.trim().length > 0) {
      messages.push({
        role: "user",
        timestamp: Date.now(),
        content: prompt,
      });
    }

    let assistantText = "";
    let finalStopReason: ModelStopReason = "end_turn";
    let finalToolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    let finalUsage = { inputTokens: 0, outputTokens: 0 };
    let finalError: string | null = null;
    let assistantMessage: AssistantMessage | undefined = undefined;

    try {
      const stream = streamSimple(
        model,
        {
          systemPrompt: systemPrompt ?? undefined,
          messages,
          tools: apiTools,
        },
        {
          signal: abortController.signal,
          reasoning: (thinkingLevel && thinkingLevel !== "off") ? (thinkingLevel as any) : undefined,
        }
      );

      for await (const event of stream) {
        if (abortController.signal.aborted) {
          break;
        }
        switch (event.type) {
          case "text_delta":
            assistantText += event.delta;
            await callbacks.onTextDelta?.(event.delta);
            break;
          case "toolcall_start":
            break;
          case "toolcall_delta":
            break;
          case "done":
            assistantMessage = event.message;
            finalStopReason = this.mapStopReason(event.reason);
            finalUsage = {
              inputTokens: event.message.usage.input,
              outputTokens: event.message.usage.output,
            };
            if (event.message.usage.cacheRead) {
              (finalUsage as any).cacheReadTokens = event.message.usage.cacheRead;
            }
            if (event.message.usage.cacheWrite) {
              (finalUsage as any).cacheCreationTokens = event.message.usage.cacheWrite;
            }
            await callbacks.onUsage?.(finalUsage);

            // Extract tool calls from the assistant message
            finalToolCalls = event.message.content
              .filter((c) => c.type === "toolCall")
              .map((t: any) => ({ id: t.id, name: t.name, input: t.arguments }));
            break;
          case "error":
            assistantMessage = event.error;
            finalError = event.error.errorMessage ?? "Unknown error";
            finalStopReason = "error";
            break;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorClass = classifyPiAiError(error);
      const recoverable = isRecoverableError(errorClass);
      await callbacks.onError?.(errorMessage, errorClass, recoverable);
      finalError = errorMessage;
      finalStopReason = "error";
    } finally {
      this.abortControllers.delete(runId);
    }

    return {
      assistantText,
      stopReason: finalStopReason,
      toolCalls: finalToolCalls,
      usage: finalUsage,
      error: finalError,
      assistantMessage: assistantMessage ?? null,
    };
  }

  private mapStopReason(reason: StopReason | string): ModelStopReason {
    if (reason === "length") return "max_tokens";
    if (reason === "toolUse") return "tool_use";
    if (reason === "stop") return "end_turn";
    if (reason === "error" || reason === "aborted") return "error";
    return "end_turn";
  }

  cancel(runId: string): void {
    const abortController = this.abortControllers.get(runId);
    if (!abortController) return;

    abortController.abort();
    this.abortControllers.delete(runId);
  }
}

export function createModelClient(): ModelClient {
  return new PiAiModelClient();
}
