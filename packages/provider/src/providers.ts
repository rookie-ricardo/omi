import type { Message } from "@mariozechner/pi-ai";

import type { OmiTool, ThinkingLevel, ProviderConfig } from "@omi/core";

import { createModelFromConfig } from "./model-registry";
import type { ModelStopReason, ModelToolCall, ModelUsage, ToolName } from "./types";
import { resolveProviderRuntime } from "./runtimes/resolver";
import { ClaudeAgentSdkProvider } from "./runtimes/claude-agent-sdk-provider";
import { VercelAiSdkProvider } from "./runtimes/vercel-ai-sdk-provider";

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

export interface ProviderRouterOptions {
  claudeProvider?: ProviderAdapter;
  vercelProvider?: ProviderAdapter;
}

/**
 * PiAiProvider - runtime router facade.
 *
 * Routes anthropic providers to Claude runtime and others to Vercel runtime.
 * Tool execution is handled by runtime-native SDK agent loops.
 */
export class PiAiProvider implements ProviderAdapter {
  private readonly claudeProvider: ProviderAdapter;
  private readonly vercelProvider: ProviderAdapter;

  constructor(options: ProviderRouterOptions = {}) {
    this.claudeProvider = options.claudeProvider ?? new ClaudeAgentSdkProvider();
    this.vercelProvider = options.vercelProvider ?? new VercelAiSdkProvider();
  }

  async run(input: ProviderRunInput): Promise<ProviderRunResult> {
    const runtime = resolveProviderRuntime(input.providerConfig);
    const targetProvider = runtime === "claude-agent-sdk" ? this.claudeProvider : this.vercelProvider;
    return targetProvider.run(input);
  }

  cancel(runId: string): void {
    for (const provider of new Set([this.claudeProvider, this.vercelProvider])) {
      provider.cancel(runId);
    }
  }
}

export function createProviderAdapter(options: ProviderRouterOptions = {}): ProviderAdapter {
  return new PiAiProvider(options);
}

export { canonicalizeForHash, buildStableToolCallId } from "./tool-call-id";
export type { ModelToolCall, ModelUsage, ModelStopReason, ToolPreflightDecision, ModelErrorClass } from "./types";
export { resolveProviderRuntime, type ProviderRuntime } from "./runtimes/resolver";
export { ClaudeAgentSdkProvider } from "./runtimes/claude-agent-sdk-provider";
export { VercelAiSdkProvider } from "./runtimes/vercel-ai-sdk-provider";
