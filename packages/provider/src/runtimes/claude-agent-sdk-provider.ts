import { createSdkMcpServer, query, tool as createClaudeMcpTool } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ProviderAdapter, ProviderRunInput, ProviderRunResult } from "../providers";
import type { ModelStopReason, ModelUsage } from "../types";
import {
  buildSingleTurnPrompt,
  createAssistantMessage,
  linkAbortSignal,
  mapClaudeStopReasonToModel,
} from "./runtime-utils";
import { jsonSchemaToZodShape } from "./tool-schema";

interface ClaudeAgentSdkDeps {
  query: typeof query;
}

const DEFAULT_DEPS: ClaudeAgentSdkDeps = {
  query,
};

function collectDeltaText(event: unknown): string {
  if (typeof event !== "object" || event === null) {
    return "";
  }

  const payload = event as {
    type?: string;
    delta?: {
      type?: string;
      text?: string;
    };
  };

  if (payload.type !== "content_block_delta") {
    return "";
  }
  if (payload.delta?.type !== "text_delta") {
    return "";
  }
  return typeof payload.delta.text === "string" ? payload.delta.text : "";
}

function parseResultUsage(rawUsage: unknown): ModelUsage {
  if (typeof rawUsage !== "object" || rawUsage === null) {
    return { inputTokens: 0, outputTokens: 0 };
  }
  const usage = rawUsage as Record<string, unknown>;
  return {
    inputTokens: Number(usage.input_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
    cacheReadTokens: Number(usage.cache_read_input_tokens ?? 0) || undefined,
    cacheCreationTokens: Number(usage.cache_creation_input_tokens ?? 0) || undefined,
  };
}

function renderToolOutputText(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (Array.isArray(output)) {
    const lines = output.map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return JSON.stringify(entry);
      }
      const item = entry as Record<string, unknown>;
      if (item.type === "text" && typeof item.text === "string") {
        return item.text;
      }
      return JSON.stringify(item);
    });
    return lines.join("\n");
  }
  return JSON.stringify(output ?? "");
}

export class ClaudeAgentSdkProvider implements ProviderAdapter {
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(private readonly deps: ClaudeAgentSdkDeps = DEFAULT_DEPS) {}

  async run(input: ProviderRunInput): Promise<ProviderRunResult> {
    const abortController = new AbortController();
    const unlinkAbortSignal = linkAbortSignal(input.signal, abortController);
    this.abortControllers.set(input.runId, abortController);

    let assistantText = "";
    let fallbackAssistantText = "";
    let usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
    let stopReason: ModelStopReason = "end_turn";
    let error: string | null = null;
    let toolCallCounter = 0;

    const runnableTools = (input.tools ?? []).filter(
      (tool) => !input.enabledTools || input.enabledTools.includes(tool.name),
    );

    const mcpTools = runnableTools.map((tool) =>
      createClaudeMcpTool(
        tool.name,
        tool.description,
        jsonSchemaToZodShape(tool.parameters),
        async (args): Promise<CallToolResult> => {
          try {
            const result = await tool.execute(
              `${input.runId}:native:${tool.name}:${++toolCallCounter}`,
              args as Record<string, unknown>,
              abortController.signal,
              () => {},
            );
            const outputText = renderToolOutputText(result.content);
            return {
              content: [{ type: "text", text: outputText }],
              isError: false,
            };
          } catch (caughtError) {
            const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
            return {
              content: [{ type: "text", text: message }],
              isError: true,
            };
          }
        },
      ),
    );
    const mcpServer = createSdkMcpServer({
      name: `omi-${input.runId}`,
      tools: mcpTools,
    });

    const queryStream = this.deps.query({
      prompt: buildSingleTurnPrompt(input.prompt, input.historyMessages),
      options: {
        cwd: input.workspaceRoot,
        model: input.providerConfig.model,
        systemPrompt: input.systemPrompt,
        maxTurns: 20,
        tools: [],
        mcpServers: {
          omi: mcpServer,
        },
        abortController,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: input.providerConfig.apiKey,
          ANTHROPIC_BASE_URL: input.providerConfig.baseUrl || process.env.ANTHROPIC_BASE_URL,
        },
      },
    });

    try {
      for await (const message of queryStream) {
        if (message.type === "stream_event") {
          const delta = collectDeltaText(message.event);
          if (delta.length > 0) {
            assistantText += delta;
            await input.onTextDelta?.(delta);
          }
          continue;
        }

        if (message.type === "assistant") {
          const contentBlocks = message.message?.content ?? [];
          for (const block of contentBlocks) {
            if (block.type === "text" && typeof block.text === "string") {
              fallbackAssistantText += block.text;
            }
          }
          continue;
        }

        if (message.type === "result") {
          usage = parseResultUsage(message.usage);
          if (typeof message.stop_reason === "string" || message.stop_reason === null) {
            stopReason = mapClaudeStopReasonToModel(message.stop_reason);
          }
          if (typeof (message as Record<string, unknown>).result === "string") {
            fallbackAssistantText += String((message as Record<string, unknown>).result);
          }

          if (message.subtype !== "success") {
            const errors = Array.isArray(message.errors) ? message.errors : [];
            error = errors.length > 0 ? errors.join("; ") : `Claude Agent SDK result subtype: ${message.subtype}`;
            stopReason = "error";
          }
        }
      }
    } catch (caughtError) {
      error = caughtError instanceof Error ? caughtError.message : String(caughtError);
      stopReason = "error";
    } finally {
      unlinkAbortSignal();
      this.abortControllers.delete(input.runId);
      queryStream.close();
      await mcpServer.instance.close();
    }

    if (assistantText.length === 0 && fallbackAssistantText.length > 0) {
      assistantText = fallbackAssistantText;
    }

    const assistantMessage = createAssistantMessage({
      providerConfig: input.providerConfig,
      assistantText,
      toolCalls: [],
      usage,
      stopReason,
    });

    return {
      assistantText,
      assistantMessage,
      stopReason,
      toolCalls: [],
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
