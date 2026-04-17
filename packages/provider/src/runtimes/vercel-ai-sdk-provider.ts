import { streamText, jsonSchema, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import { createModelFromConfig } from "../model-registry";
import type {
  ProviderAdapter,
  ProviderRunInput,
  ProviderRunResult,
  ProviderToolLifecycleControl,
} from "../providers";
import type { ModelUsage } from "../types";
import {
  buildModelMessages,
  linkAbortSignal,
  mapVercelFinishReasonToModel,
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
    let usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
    let stopReason: ProviderRunResult["stopReason"] = "end_turn";
    let error: string | null = null;
    let toolCallCounter = 0;
    const emitToolLifecycle = async (
      event: Omit<Parameters<NonNullable<ProviderRunInput["onToolLifecycle"]>>[0], "runId" | "sessionId">,
    ): Promise<ProviderToolLifecycleControl> => {
      if (!input.onToolLifecycle) {
        throw new Error("Missing onToolLifecycle handler for runtime-native tool execution (fail-closed).");
      }
      const control = await input.onToolLifecycle({
        ...event,
        source: event.source ?? "runtime_native",
        runId: input.runId,
        sessionId: input.sessionId,
      });
      return control ?? {};
    };

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
            execute: async (toolInput: Record<string, unknown>) => {
              const toolCallId = `${input.runId}:native:${tool.name}:${++toolCallCounter}`;
              const requested = await emitToolLifecycle({
                stage: "requested",
                toolCallId,
                toolName: tool.name,
                input: toolInput,
              });
              if (typeof requested.allowExecution !== "boolean") {
                throw new Error(
                  `Tool lifecycle handler must return { allowExecution: boolean } for requested stage (${tool.name}).`,
                );
              }
              if (!requested.allowExecution) {
                return {
                  content: [{ type: "text", text: requested.error ?? `Tool '${tool.name}' denied by runtime policy.` }],
                  details: { denied: true },
                };
              }
              if (typeof requested.requiresApproval !== "boolean") {
                throw new Error(
                  `Tool lifecycle handler must return { requiresApproval: boolean } when execution is allowed (${tool.name}).`,
                );
              }
              if (requested.requiresApproval) {
                const approval = await emitToolLifecycle({
                  stage: "approval_requested",
                  toolCallId,
                  toolName: tool.name,
                  input: toolInput,
                });
                if (approval.decision !== "approved" && approval.decision !== "rejected") {
                  throw new Error(
                    `Tool lifecycle handler must return decision for approval_requested stage (${tool.name}).`,
                  );
                }
                if (approval.decision === "rejected") {
                  return {
                    content: [{ type: "text", text: approval.error ?? "Tool execution rejected by user." }],
                    details: { rejected: true },
                  };
                }
              }
              await emitToolLifecycle({
                stage: "started",
                toolCallId,
                toolName: tool.name,
                input: toolInput,
              });
              try {
                const result = await tool.execute(
                  toolCallId,
                  toolInput,
                  abortController.signal,
                  (update) => {
                    void emitToolLifecycle({
                      stage: "progress",
                      toolCallId,
                      toolName: tool.name,
                      input: toolInput,
                      output: update,
                    });
                  },
                );
                await emitToolLifecycle({
                  stage: "finished",
                  toolCallId,
                  toolName: tool.name,
                  input: toolInput,
                  output: result.content,
                });
                return {
                  content: result.content,
                  details: result.details,
                };
              } catch (caughtError) {
                const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
                await emitToolLifecycle({
                  stage: "failed",
                  toolCallId,
                  toolName: tool.name,
                  input: toolInput,
                  error: message,
                  output: { error: message },
                });
                return {
                  content: [{ type: "text", text: message }],
                  details: { error: message },
                };
              }
            },
          };
          return accumulator;
        }, {}) as any;

      const textStreamResult = this.deps.streamText({
        model: openaiProvider(input.providerConfig.model),
        system: input.systemPrompt,
        messages: buildModelMessages(input.prompt, input.historyMessages),
        tools: activeTools,
        stopWhen: stepCountIs(20),
        abortSignal: abortController.signal,
      });

      for await (const delta of textStreamResult.textStream) {
        assistantText += delta;
        await input.onTextDelta?.(delta);
      }

      const [resolvedFinishReason, resolvedUsage] = await Promise.all([
        textStreamResult.finishReason,
        textStreamResult.usage,
      ]);
      stopReason = mapVercelFinishReasonToModel(resolvedFinishReason);
      if (resolvedFinishReason === "tool-calls") {
        error = "SDK loop ended with unresolved tool-calls finish reason.";
      }
      usage = {
        inputTokens: resolvedUsage.inputTokens ?? 0,
        outputTokens: resolvedUsage.outputTokens ?? 0,
        cacheReadTokens: resolvedUsage.inputTokenDetails?.cacheReadTokens ?? undefined,
        cacheCreationTokens: resolvedUsage.inputTokenDetails?.cacheWriteTokens ?? undefined,
      };
    } catch (caughtError) {
      error = caughtError instanceof Error ? caughtError.message : String(caughtError);
      stopReason = "error";
    } finally {
      unlinkAbortSignal();
      this.abortControllers.delete(input.runId);
    }

    return {
      assistantText,
      stopReason,
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
