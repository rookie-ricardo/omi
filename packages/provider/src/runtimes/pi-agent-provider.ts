import { Agent, type AgentTool, type AgentToolResult } from "@mariozechner/pi-agent-core";

import { createModelFromConfig } from "../model-registry";
import type {
  ProviderAdapter,
  ProviderRunInput,
  ProviderRunResult,
  ProviderToolLifecycleControl,
} from "../providers";
import type { ModelUsage } from "../types";
import { linkAbortSignal } from "./runtime-utils";

export class PiAgentProvider implements ProviderAdapter {
  private readonly agents = new Map<string, Agent>();

  async run(input: ProviderRunInput): Promise<ProviderRunResult> {
    const abortController = new AbortController();
    const unlinkAbortSignal = linkAbortSignal(input.signal, abortController);

    const model = createModelFromConfig(input.providerConfig);

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

    // OmiTool[] → AgentTool[] — direct mapping, no Vercel jsonSchema middle layer
    let toolCallCounter = 0;
    const agentTools: AgentTool<any, any>[] = (input.tools ?? [])
      .filter((tool) => !input.enabledTools || input.enabledTools.includes(tool.name))
      .map((tool) => ({
        name: tool.name,
        label: tool.label ?? tool.name,
        description: tool.description,
        parameters: tool.parameters,
        execute: async (
          toolCallId: string,
          params: Record<string, unknown>,
          signal?: AbortSignal,
          onUpdate?: (partialResult: AgentToolResult<any>) => void,
        ): Promise<AgentToolResult<any>> => {
          const id = toolCallId || `${input.runId}:native:${tool.name}:${++toolCallCounter}`;

          const requested = await emitToolLifecycle({
            stage: "requested",
            toolCallId: id,
            toolName: tool.name,
            input: params,
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
              toolCallId: id,
              toolName: tool.name,
              input: params,
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
            toolCallId: id,
            toolName: tool.name,
            input: params,
          });

          try {
            const omiOnUpdate = onUpdate
              ? (update: unknown) => { onUpdate({ content: [], details: update }); }
              : undefined;
            const result = await tool.execute(id, params, signal ?? abortController.signal, omiOnUpdate as any);
            await emitToolLifecycle({
              stage: "finished",
              toolCallId: id,
              toolName: tool.name,
              input: params,
              output: result.content,
            });
            return { content: result.content, details: result.details };
          } catch (caughtError) {
            const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
            await emitToolLifecycle({
              stage: "failed",
              toolCallId: id,
              toolName: tool.name,
              input: params,
              error: message,
              output: { error: message },
            });
            return {
              content: [{ type: "text", text: message }],
              details: { error: message },
            };
          }
        },
      }));

    let assistantText = "";
    let usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
    let stopReason: ProviderRunResult["stopReason"] = "end_turn";
    let error: string | null = null;

    try {
      const agent = new Agent({
        initialState: {
          systemPrompt: input.systemPrompt ?? "",
          model,
          tools: agentTools,
          messages: input.historyMessages,
          thinkingLevel: input.thinkingLevel ?? "off",
        },
        toolExecution: input.toolExecutionMode ?? "parallel",
        convertToLlm: input.convertToLlm,
        transformContext: input.transformContext,
      });

      this.agents.set(input.runId, agent);

      agent.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          assistantText += event.assistantMessageEvent.delta;
          input.onTextDelta?.(event.assistantMessageEvent.delta);
        }
      });

      await agent.prompt(input.prompt);
      await agent.waitForIdle();

      // Accumulate usage from all assistant messages in this run
      for (const msg of agent.state.messages) {
        if (msg.role === "assistant" && msg.usage) {
          usage.inputTokens += msg.usage.input;
          usage.outputTokens += msg.usage.output;
          usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + (msg.usage.cacheRead ?? 0);
          usage.cacheCreationTokens = (usage.cacheCreationTokens ?? 0) + (msg.usage.cacheWrite ?? 0);
        }
      }
    } catch (caughtError) {
      error = caughtError instanceof Error ? caughtError.message : String(caughtError);
      stopReason = "error";
    } finally {
      unlinkAbortSignal();
      this.agents.delete(input.runId);
    }

    return { assistantText, stopReason, usage, error };
  }

  cancel(runId: string): void {
    const agent = this.agents.get(runId);
    if (!agent) return;
    agent.abort();
    this.agents.delete(runId);
  }
}
