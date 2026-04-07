import type { Message } from "@mariozechner/pi-ai";

import type { OmiTool, ThinkingLevel, ProviderConfig } from "@omi/core";

import { createModelFromConfig } from "./model-registry";
import { PiAiModelClient } from "./model-client/pi-ai-client";
import type { ModelClientCallbacks, ModelStopReason, ModelToolCall, ModelUsage, ToolName } from "./model-client/types";

export interface ProviderAdapter {
  run(input: ProviderRunInput): Promise<ProviderRunResult>;
  cancel(runId: string): void;
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
  /** Pre-built tools injected by the agent layer */
  tools?: OmiTool[];
  thinkingLevel?: ThinkingLevel;
  toolExecutionMode?: "sequential" | "parallel";
  convertToLlm?: (messages: Message[]) => Message[];
  onTextDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface ProviderRunResult {
  assistantText: string;
  assistantMessage: unknown; // Raw provider message for history append
  stopReason: ModelStopReason;
  toolCalls: ModelToolCall[];
  usage: ModelUsage;
  error: string | null;
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
    tools: input.tools ?? [],
    messages: input.historyMessages,
    thinkingLevel: input.thinkingLevel ?? "off",
  };
}

/**
 * PiAiProvider - unified provider implementation backed by PiAiModelClient.
 *
 * Single-turn caller: streams one LLM response and returns it with any tool calls.
 * Tool execution is handled by the agent layer (QueryEngine).
 */
export class PiAiProvider implements ProviderAdapter {
  private readonly modelClient: PiAiModelClient;

  constructor() {
    this.modelClient = new PiAiModelClient();
  }

  async run(input: ProviderRunInput): Promise<ProviderRunResult> {
    const callbacks: ModelClientCallbacks = {
      onTextDelta: input.onTextDelta,
      onUsage: () => {},
      onError: () => {},
      onRequestStart: () => {},
    };

    const result = await this.modelClient.run(
      {
        runId: input.runId,
        sessionId: input.sessionId,
        prompt: input.prompt,
        historyMessages: input.historyMessages,
        systemPrompt: input.systemPrompt,
        providerConfig: input.providerConfig,
        enabledTools: input.enabledTools,
        tools: input.tools,
        thinkingLevel: input.thinkingLevel,
        toolExecutionMode: input.toolExecutionMode,
      },
      callbacks,
    );

    return {
      assistantText: result.assistantText,
      assistantMessage: result.assistantMessage,
      stopReason: result.stopReason,
      toolCalls: result.toolCalls,
      usage: result.usage,
      error: result.error,
    };
  }

  cancel(runId: string): void {
    this.modelClient.cancel(runId);
  }
}

export { canonicalizeForHash, buildStableToolCallId } from "./model-client/pi-ai-client";
export type { ModelToolCall, ModelUsage, ModelStopReason, ToolPreflightDecision, ModelErrorClass } from "./model-client/types";
