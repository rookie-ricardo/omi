import { query } from "@anthropic-ai/claude-agent-sdk";

import type { ProviderAdapter, ProviderRunInput, ProviderRunResult } from "../providers";
import type { ModelStopReason, ModelToolCall, ModelUsage } from "../model-client/types";
import {
  createAssistantMessage,
  linkAbortSignal,
  mapClaudeStopReasonToModel,
  normalizeToolInput,
} from "./runtime-utils";

interface ClaudeAgentSdkDeps {
  query: typeof query;
}

const DEFAULT_DEPS: ClaudeAgentSdkDeps = {
  query,
};

const OMI_TO_CLAUDE_TOOL_NAME: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  notebook_edit: "NotebookEdit",
  write: "Write",
  ls: "LS",
  grep: "Grep",
  glob: "Glob",
  "web.fetch": "WebFetch",
  "web.search": "WebSearch",
  "todo.write": "TodoWrite",
  ask_user: "AskUserQuestion",
};

const CLAUDE_TO_OMI_TOOL_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(OMI_TO_CLAUDE_TOOL_NAME).map(([omiName, claudeName]) => [claudeName, omiName]),
);

function mapClaudeToolName(toolName: string): string {
  if (CLAUDE_TO_OMI_TOOL_NAME[toolName]) {
    return CLAUDE_TO_OMI_TOOL_NAME[toolName];
  }
  return toolName.toLowerCase();
}

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

    const capturedToolCalls = new Map<string, ModelToolCall>();
    const enabledTools = new Set(input.enabledTools ?? (input.tools ?? []).map((tool) => tool.name));
    const claudeTools = Array.from(
      new Set(
        Array.from(enabledTools)
          .map((toolName) => OMI_TO_CLAUDE_TOOL_NAME[toolName])
          .filter((toolName): toolName is string => Boolean(toolName)),
      ),
    );

    const queryStream = this.deps.query({
      prompt: input.prompt,
      options: {
        cwd: input.workspaceRoot,
        model: input.providerConfig.model,
        systemPrompt: input.systemPrompt,
        maxTurns: 1,
        permissionMode: "dontAsk",
        tools: claudeTools,
        canUseTool: async (toolName, toolInput, options) => {
          const mappedToolName = mapClaudeToolName(toolName);
          if (!enabledTools.has(mappedToolName)) {
            return {
              behavior: "deny",
              message: `Tool '${mappedToolName}' is not enabled in this run.`,
              toolUseID: options.toolUseID,
            };
          }

          if (!capturedToolCalls.has(options.toolUseID)) {
            capturedToolCalls.set(options.toolUseID, {
              id: options.toolUseID,
              name: mappedToolName,
              input: normalizeToolInput(toolInput),
            });
          }

          return {
            behavior: "deny",
            message: "Tool execution is delegated to the external orchestrator.",
            toolUseID: options.toolUseID,
          };
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
    }

    if (assistantText.length === 0 && fallbackAssistantText.length > 0) {
      assistantText = fallbackAssistantText;
    }

    const toolCalls = Array.from(capturedToolCalls.values());
    if (toolCalls.length > 0) {
      stopReason = "tool_use";
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
