import type { Message } from "@mariozechner/pi-ai";
import type {
  Options as ClaudeAgentSdkOptions,
  SDKMessage as ClaudeAgentSdkMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type { OmiTool, ThinkingLevel, ProviderConfig } from "@omi/core";

import { createModelFromConfig } from "./model-registry";
import type { ModelStopReason, ModelUsage, ToolName } from "./types";
import { resolveProviderRuntime } from "./runtimes/resolver";
import { ClaudeAgentSdkProvider } from "./runtimes/claude-agent-sdk-provider";
import { PiAgentProvider } from "./runtimes/pi-agent-provider";

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
  /**
   * Runtime-native tool lifecycle sink.
   * Provider runtimes must fail-closed when tool execution is attempted
   * without a valid lifecycle handler response.
   */
  onToolLifecycle?: (
    event: ProviderToolLifecycleEvent,
  ) => Promise<ProviderToolLifecycleControl | void> | ProviderToolLifecycleControl | void;
  thinkingLevel?: ThinkingLevel;
  toolExecutionMode?: "sequential" | "parallel";
  convertToLlm?: (messages: Message[]) => Message[];
  /**
   * Context compression hook (pi-agent-core only).
   * Called before each LLM request to prune or compress the message history.
   */
  transformContext?: (messages: Message[], signal?: AbortSignal) => Promise<Message[]>;
  onTextDelta?: (delta: string) => void;
  /**
   * Claude Agent SDK specific options.
   * This is only applied when provider runtime resolves to Claude Agent SDK.
   */
  claudeOptions?: ClaudeAgentSdkOptions;
  /**
   * Raw SDK message callback (Claude runtime only).
   * Used to surface advanced runtime events (task progress, prompt suggestions,
   * rate limit, auth status, hook events, etc.) to upper orchestration layers.
   */
  onSdkMessage?: (message: ClaudeAgentSdkMessage) => void | Promise<void>;
  /**
   * Sub-agent definitions (Claude Agent SDK only).
   * Each agent gets its own context, tools, and optional model override.
   */
  agents?: Record<string, {
    description: string;
    prompt: string;
    tools?: string[];
    model?: "sonnet" | "opus" | "haiku" | "inherit";
    mcpServers?: Array<string | Record<string, unknown>>;
  }>;
  signal?: AbortSignal;
}

export type ProviderToolLifecycleStage =
  | "requested"
  | "approval_requested"
  | "started"
  | "progress"
  | "finished"
  | "failed";

export interface ProviderToolLifecycleEvent {
  stage: ProviderToolLifecycleStage;
  runId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  /**
   * Tool source category for runtimes that mix wrapped tools and provider-native tools.
   */
  source?: "runtime_native" | "provider_builtin";
  /**
   * Original provider tool name when normalized toolName is used internally.
   */
  rawToolName?: string;
  output?: unknown;
  error?: string;
}

export interface ProviderToolLifecycleControl {
  allowExecution?: boolean;
  requiresApproval?: boolean;
  decision?: "approved" | "rejected";
  error?: string;
}

export interface ProviderRunResult {
  assistantText: string;
  stopReason: ModelStopReason;
  usage: ModelUsage;
  error: string | null;
  structuredOutput?: unknown;
  providerMeta?: Record<string, unknown>;
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
  piAgentProvider?: ProviderAdapter;
}

/**
 * PiAiProvider - runtime router facade.
 *
 * Routes anthropic providers to Claude Agent SDK and others to pi-agent-core.
 * Tool execution is handled by runtime-native SDK agent loops.
 */
export class PiAiProvider implements ProviderAdapter {
  private readonly claudeProvider: ProviderAdapter;
  private readonly piAgentProvider: ProviderAdapter;

  constructor(options: ProviderRouterOptions = {}) {
    this.claudeProvider = options.claudeProvider ?? new ClaudeAgentSdkProvider();
    this.piAgentProvider = options.piAgentProvider ?? new PiAgentProvider();
  }

  async run(input: ProviderRunInput): Promise<ProviderRunResult> {
    const runtime = resolveProviderRuntime(input.providerConfig);
    const targetProvider = runtime === "claude-agent-sdk" ? this.claudeProvider : this.piAgentProvider;
    return targetProvider.run(input);
  }

  cancel(runId: string): void {
    for (const provider of new Set([this.claudeProvider, this.piAgentProvider])) {
      provider.cancel(runId);
    }
  }
}

export function createProviderAdapter(options: ProviderRouterOptions = {}): ProviderAdapter {
  return new PiAiProvider(options);
}

export type { ModelUsage, ModelStopReason, ToolPreflightDecision, ModelErrorClass } from "./types";
export { resolveProviderRuntime, type ProviderRuntime } from "./runtimes/resolver";
export { ClaudeAgentSdkProvider } from "./runtimes/claude-agent-sdk-provider";
export { PiAgentProvider } from "./runtimes/pi-agent-provider";
