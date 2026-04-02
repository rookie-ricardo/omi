import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message } from "@mariozechner/pi-ai";

import type { ProviderConfig } from "@omi/core";

import { createModelFromConfig } from "./model-registry";
import { PiAiModelClient } from "./model-client/pi-ai-client";
import type { ModelClientCallbacks } from "./model-client/types";
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

interface PendingApproval {
  runId: string;
  toolCallId: string;
  resolve: (decision: "approved" | "rejected") => void;
}

interface RuntimeToolCall {
  toolCallId: string;
  toolName: string;
  phase: "requested" | "started" | "finished";
}

/**
 * PiAiProvider - unified provider implementation backed by PiAiModelClient.
 *
 * All calls route through pi-ai via PiAiModelClient (which wraps pi-agent-core Agent).
 * The query layer sees no protocol branching - all protocol differences are
 * encapsulated in the pi-ai abstraction layer.
 */
export class PiAiProvider implements ProviderAdapter {
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly toolCallsByRun = new Map<string, RuntimeToolCall[]>();
  private readonly modelClient: PiAiModelClient;

  constructor() {
    this.modelClient = new PiAiModelClient();
  }

  async run(input: ProviderRunInput): Promise<ProviderRunResult> {
    const toolCalls: RuntimeToolCall[] = [];
    this.toolCallsByRun.set(input.runId, toolCalls);

    // Build ModelClientCallbacks from ProviderRunInput
    const callbacks = this.buildCallbacks(input, toolCalls);

    // Normalize tool call start/end to match ProviderRunInput callbacks
    // (onToolRequested -> before approval, onToolStarted -> after approval)
    const normalizedCallbacks: ModelClientCallbacks = {
      onTextDelta: input.onTextDelta,
      onToolCallStart: (toolCallId, toolName, toolInput) => {
        toolCalls.push({ toolCallId, toolName, phase: "requested" });
        input.onToolStarted?.(toolCallId, toolName);
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

    // Wire tool approval through callbacks
    const approvalCallbacks = this.buildApprovalCallbacks(input, toolCalls);

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
        },
        { ...normalizedCallbacks, ...approvalCallbacks },
      );

      // Trigger onToolRequested for tools that need approval
      await this.triggerToolRequests(input, toolCalls);

      return { assistantText: result.assistantText };
    } finally {
      this.toolCallsByRun.delete(input.runId);
    }
  }

  cancel(runId: string): void {
    this.resolvePendingApprovalsForRun(runId, "rejected");
    this.modelClient.cancel(runId);
    this.toolCallsByRun.delete(runId);
  }

  approveTool(toolCallId: string): void {
    const pending = this.pendingApprovals.get(toolCallId);
    if (!pending) {
      return;
    }
    this.pendingApprovals.delete(toolCallId);
    pending.resolve("approved");
  }

  rejectTool(toolCallId: string): void {
    const pending = this.pendingApprovals.get(toolCallId);
    if (!pending) {
      return;
    }
    this.pendingApprovals.delete(toolCallId);
    pending.resolve("rejected");
  }

  private buildCallbacks(
    input: ProviderRunInput,
    toolCalls: RuntimeToolCall[],
  ): ModelClientCallbacks {
    return {
      onTextDelta: input.onTextDelta,
      onToolCallStart: (toolCallId, toolName, toolInput) => {
        toolCalls.push({ toolCallId, toolName, phase: "requested" });
        input.onToolStarted?.(toolCallId, toolName);
      },
      onToolDecision: input.onToolDecision,
      onToolCallEnd: (toolCallId, toolName, result, isError) => {
        input.onToolFinished?.(toolCallId, toolName, result, isError);
      },
    };
  }

  private buildApprovalCallbacks(
    input: ProviderRunInput,
    toolCalls: RuntimeToolCall[],
  ): ModelClientCallbacks {
    return {
      onToolCallStart: async (toolCallId, toolName, toolInput) => {
        const requiresReview = isBuiltInTool(toolName) ? requiresApproval(toolName) : false;

        if (requiresReview) {
          // Trigger onToolRequested for approval
          const resolvedId =
            (await input.onToolRequested?.({
              runId: input.runId,
              sessionId: input.sessionId,
              toolName,
              input: toolInput,
              requiresApproval: requiresReview,
            })) ?? toolCallId;

          // Wait for approval
          const decision = await new Promise<"approved" | "rejected">((resolve) => {
            this.pendingApprovals.set(resolvedId, {
              runId: input.runId,
              toolCallId: resolvedId,
              resolve,
            });
          });
          this.pendingApprovals.delete(resolvedId);

          input.onToolDecision?.(resolvedId, decision);
          if (decision === "rejected") {
            throw new Error("Tool execution rejected by user.");
          }
        }
      },
    };
  }

  private async triggerToolRequests(
    input: ProviderRunInput,
    toolCalls: RuntimeToolCall[],
  ): Promise<void> {
    for (const tc of toolCalls) {
      if (tc.phase === "requested") {
        const requiresReview = isBuiltInTool(tc.toolName) ? requiresApproval(tc.toolName) : false;
        if (!requiresReview) {
          await input.onToolRequested?.({
            runId: input.runId,
            sessionId: input.sessionId,
            toolName: tc.toolName,
            input: {},
            requiresApproval: false,
          });
        }
      }
    }
  }

  private resolvePendingApprovalsForRun(runId: string, decision: "approved" | "rejected"): void {
    for (const [toolCallId, pending] of this.pendingApprovals.entries()) {
      if (pending.runId !== runId) {
        continue;
      }
      this.pendingApprovals.delete(toolCallId);
      pending.resolve(decision);
    }
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
