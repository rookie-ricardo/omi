import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message } from "@mariozechner/pi-ai";

import type { ProviderConfig } from "@omi/core";

import { createModelFromConfig } from "./model-registry";
import { PiAiModelClient } from "./model-client/pi-ai-client";
import type { ModelClientCallbacks, ToolPreflightDecision } from "./model-client/types";
import { type ToolName, requiresApproval, isBuiltInTool, createAllTools } from "@omi/tools";

export interface ProviderAdapter {
  run(input: ProviderRunInput): Promise<ProviderRunResult>;
  cancel(runId: string): void;
  approveTool(toolCallId: string): void;
  rejectTool(toolCallId: string): void;
}

export interface ProviderRunInput {
  runId: string;
  sessionId: string;
  workspaceRoot: string;
  prompt: string;
  historyMessages: Message[];
  systemPrompt?: string;
  providerConfig: ProviderConfig;
  enabledTools?: ToolName[];
  thinkingLevel?: ThinkingLevel;
  toolExecutionMode?: "sequential" | "parallel";
  preflightToolCheck?: (
    toolName: string,
    input: Record<string, unknown>,
  ) => ToolPreflightDecision | Promise<ToolPreflightDecision>;
  convertToLlm?: (messages: Message[]) => Message[];
  onTextDelta?: (delta: string) => void;
  onToolRequested?: (event: ProviderToolRequestedEvent) => Promise<string>;
  onToolDecision?: (toolCallId: string, decision: "approved" | "rejected") => void;
  onToolStarted?: (toolCallId: string, toolName: string) => void;
  onToolUpdate?: (toolCallId: string, delta: string) => void;
  onToolFinished?: (
    toolCallId: string,
    toolName: string,
    output: Record<string, unknown>,
    isError: boolean,
  ) => void;
}

export interface ProviderRunResult {
  assistantText: string;
}

export interface ProviderToolRequestedEvent {
  runId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  requiresApproval: boolean;
}

// Standard thinking levels
export const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

// Thinking levels including xhigh (for supported models)
export const THINKING_LEVELS_WITH_XHIGH: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export { createModelFromConfig } from "./model-registry";

export function buildAgentInitialState(input: ProviderRunInput) {
  return {
    systemPrompt: input.systemPrompt ?? "",
    model: createModelFromConfig(input.providerConfig),
    tools: buildAgentTools(input.workspaceRoot, input.enabledTools),
    messages: input.historyMessages,
    thinkingLevel: input.thinkingLevel ?? "off",
  };
}

/**
 * PiAiProvider - unified provider implementation backed by PiAiModelClient.
 *
 * All calls route through pi-ai via PiAiModelClient (which wraps pi-agent-core Agent).
 * The query layer sees no protocol branching - all protocol differences are
 * encapsulated in the pi-ai abstraction layer.
 */
export class PiAiProvider implements ProviderAdapter {
  private readonly modelClient: PiAiModelClient;

  constructor() {
    this.modelClient = new PiAiModelClient();
  }

  async run(input: ProviderRunInput): Promise<ProviderRunResult> {
    const pendingRequested = new Set<string>();
    const callbacks: ModelClientCallbacks = {
      onTextDelta: input.onTextDelta,
      onUpdate: (toolCallId, toolName, delta) => {
        input.onToolUpdate?.(toolCallId, delta);
      },
      onToolCallStart: async (toolCallId, toolName, toolInput) => {
        if (pendingRequested.has(toolCallId)) {
          pendingRequested.delete(toolCallId);
          input.onToolStarted?.(toolCallId, toolName);
          return;
        }
        const requiresReview = isBuiltInTool(toolName) ? requiresApproval(toolName) : false;
        pendingRequested.add(toolCallId);
        await input.onToolRequested?.({
          runId: input.runId,
          sessionId: input.sessionId,
          toolCallId,
          toolName,
          input: toolInput,
          requiresApproval: requiresReview,
        });
      },
      onToolDecision: input.onToolDecision,
      onToolCallEnd: (toolCallId, toolName, result, isError) => {
        input.onToolFinished?.(toolCallId, toolName, result, isError);
      },
      onUsage: () => {
        // ProviderRunInput doesn't have onUsage - ignore
      },
      onError: () => {
        // Errors are surfaced via run result
      },
      onRequestStart: () => {
        // Ignored
      },
    };

    try {
      const result = await this.modelClient.run(
        {
          runId: input.runId,
          sessionId: input.sessionId,
          prompt: input.prompt,
          historyMessages: input.historyMessages,
          systemPrompt: input.systemPrompt,
          providerConfig: input.providerConfig,
          enabledTools: input.enabledTools,
          thinkingLevel: input.thinkingLevel,
          toolExecutionMode: input.toolExecutionMode,
          preflightToolCheck: input.preflightToolCheck,
        },
        callbacks,
      );
      return { assistantText: result.assistantText };
    } finally {
      // no-op
    }
  }

  cancel(runId: string): void {
    this.modelClient.cancel(runId);
  }

  approveTool(toolCallId: string): void {
    this.modelClient.approveTool(toolCallId);
  }

  rejectTool(toolCallId: string): void {
    this.modelClient.rejectTool(toolCallId);
  }
}

function buildAgentTools(
  workspaceRoot: string,
  enabledTools?: ToolName[],
): ReturnType<typeof createAllTools> {
  const allTools = createAllTools(workspaceRoot);

  if (!enabledTools || enabledTools.length === 0) {
    return allTools;
  }

  const allowed = new Set(enabledTools);
  const result: ReturnType<typeof createAllTools> = {};
  for (const [name, tool] of Object.entries(allTools)) {
    if (allowed.has(name as ToolName)) {
      result[name] = tool;
    }
  }
  return result;
}

function assistantMessageToText(message: AssistantMessage): string {
  return message.content
    .filter((content): content is { type: "text"; text: string } => content.type === "text")
    .map((content) => content.text)
    .join("");
}
