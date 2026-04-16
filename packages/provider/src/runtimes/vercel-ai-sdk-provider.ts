import { streamText, jsonSchema } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import { createModelFromConfig } from "../model-registry";
import type { ProviderAdapter, ProviderRunInput, ProviderRunResult } from "../providers";
import type { ModelToolCall, ModelUsage } from "../types";
import {
  buildSingleTurnPrompt,
  createAssistantMessage,
  linkAbortSignal,
  mapVercelFinishReasonToModel,
  normalizeToolInput,
} from "./runtime-utils";

interface VercelAiSdkDeps {
  createOpenAI: typeof createOpenAI;
  streamText: typeof streamText;
}

const DEFAULT_DEPS: VercelAiSdkDeps = {
  createOpenAI,
  streamText,
};

export class VercelAiSdkProvider implements ProviderAdapter {
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(private readonly deps: VercelAiSdkDeps = DEFAULT_DEPS) {}

  async run(input: ProviderRunInput): Promise<ProviderRunResult> {
    const abortController = new AbortController();
    const unlinkAbortSignal = linkAbortSignal(input.signal, abortController);
    this.abortControllers.set(input.runId, abortController);

    let assistantText = "";
    let toolCalls: ModelToolCall[] = [];
    let usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
    let stopReason: ProviderRunResult["stopReason"] = "end_turn";
    let error: string | null = null;

    try {
      const modelConfig = createModelFromConfig(input.providerConfig);
      const openaiProvider = this.deps.createOpenAI({
        apiKey: input.providerConfig.apiKey,
        baseURL: modelConfig.baseUrl || undefined,
      });
      const activeTools = (input.tools ?? [])
        .filter((tool) => !input.enabledTools || input.enabledTools.includes(tool.name))
        .reduce<Record<string, unknown>>((accumulator, tool) => {
          accumulator[tool.name] = {
            description: tool.description,
            inputSchema: jsonSchema(tool.parameters as any),
          };
          return accumulator;
        }, {}) as any;

      const textStreamResult = this.deps.streamText({
        model: openaiProvider(input.providerConfig.model),
        system: input.systemPrompt,
        prompt: buildSingleTurnPrompt(input.prompt, input.historyMessages),
        tools: activeTools,
        abortSignal: abortController.signal,
      });

      for await (const delta of textStreamResult.textStream) {
        assistantText += delta;
        await input.onTextDelta?.(delta);
      }

      const [resolvedToolCalls, resolvedFinishReason, resolvedUsage] = await Promise.all([
        textStreamResult.toolCalls,
        textStreamResult.finishReason,
        textStreamResult.usage,
      ]);

      toolCalls = resolvedToolCalls.map((toolCall) => ({
        id: toolCall.toolCallId,
        name: toolCall.toolName,
        input: normalizeToolInput(toolCall.input),
      }));
      stopReason = mapVercelFinishReasonToModel(resolvedFinishReason);
      usage = {
        inputTokens: resolvedUsage.inputTokens ?? 0,
        outputTokens: resolvedUsage.outputTokens ?? 0,
        cacheReadTokens: resolvedUsage.inputTokenDetails?.cacheReadTokens ?? undefined,
        cacheCreationTokens: resolvedUsage.inputTokenDetails?.cacheWriteTokens ?? undefined,
      };

      if (toolCalls.length > 0) {
        stopReason = "tool_use";
      }
    } catch (caughtError) {
      error = caughtError instanceof Error ? caughtError.message : String(caughtError);
      stopReason = "error";
    } finally {
      unlinkAbortSignal();
      this.abortControllers.delete(input.runId);
    }

    const assistantMessage = createAssistantMessage({
      providerConfig: input.providerConfig,
      assistantText,
      toolCalls,
      usage,
      stopReason,
    });

    return {
      assistantText,
      assistantMessage,
      stopReason,
      toolCalls,
      usage,
      error,
    };
  }

  cancel(runId: string): void {
    const controller = this.abortControllers.get(runId);
    if (!controller) {
      return;
    }
    controller.abort();
    this.abortControllers.delete(runId);
  }
}
