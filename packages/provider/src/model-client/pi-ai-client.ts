import {
  Agent,
  type AgentEvent,
  type AgentTool,
  ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { createModelFromConfig } from "../model-registry";
import type { ToolName } from "@omi/tools";
import { createToolArray } from "@omi/tools";
import type {
  ModelClient,
  ModelClientCallbacks,
  ModelClientRunInput,
  ModelClientRunResult,
  ModelStopReason,
  ModelStreamEvent,
} from "./types";
import { routeProtocol } from "./protocol-router";
import {
  classifyPiAiError,
  isRecoverableError,
  normalizeEvent,
} from "./normalizer";

// ============================================================================
// PiAiModelClient Implementation
// ============================================================================

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
 * PiAiModelClient - unified model client implementation.
 *
 * This client wraps @mariozechner/pi-agent-core Agent and normalizes all events
 * to the unified ModelStreamEvent format. Protocol differences are handled
 * internally by pi-ai, so the query loop remains protocol-agnostic.
 *
 * Key design principles:
 * - All protocol routing is based on providerConfig.protocol when present
 * - Events are normalized to ModelStreamEvent format
 * - No direct use of openai or @anthropic-ai/sdk
 * - Protocol-specific behavior is encapsulated in pi-ai
 */
export class PiAiModelClient implements ModelClient {
  private readonly activeAgents = new Map<string, Agent>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly toolCallsByRun = new Map<string, RuntimeToolCall[]>();

  async run(
    input: ModelClientRunInput,
    callbacks: ModelClientCallbacks,
  ): Promise<ModelClientRunResult> {
    const {
      runId,
      sessionId,
      prompt,
      historyMessages,
      systemPrompt,
      providerConfig,
      enabledTools,
      thinkingLevel,
      toolExecutionMode,
      preflightToolCheck,
    } = input;

    // Validate protocol routing contract before model execution.
    routeProtocol(providerConfig);

    const toolCalls: RuntimeToolCall[] = [];
    this.toolCallsByRun.set(runId, toolCalls);

    const agent = new Agent({
      initialState: {
        systemPrompt: systemPrompt ?? "",
        model: createModelFromConfig(providerConfig),
        tools: this.buildTools(enabledTools),
        messages: historyMessages,
        thinkingLevel: (thinkingLevel ?? "off") as ThinkingLevel,
      } as never,
      convertToLlm: (msgs: Message[]) => msgs as never,
      transformContext: async (msgs: Message[]) => msgs as never,
      sessionId,
      getApiKey: () => providerConfig.apiKey,
      toolExecution: toolExecutionMode ?? "sequential",
      beforeToolCall: async ({
        toolCall,
        args,
      }: {
        toolCall: { name: string };
        args: Record<string, unknown>;
      }) => {
        const toolName = toolCall.name;
        const toolCallId = `${runId}:${toolCalls.length + 1}`;
        const preflightReason = await preflightToolCheck?.(toolName, args);
        if (preflightReason) {
          callbacks.onToolDecision?.(toolCallId, "rejected");
          return {
            block: true,
            reason: preflightReason,
          };
        }

        const requiresReview = this.requiresApproval(toolName);

        toolCalls.push({
          toolCallId,
          toolName,
          phase: "requested",
        });

        // Emit normalized tool call start event
        callbacks.onToolCallStart?.(toolCallId, toolName, args);

        if (!requiresReview) {
          return undefined;
        }

        const decision = await new Promise<"approved" | "rejected">((resolve) => {
          this.pendingApprovals.set(toolCallId, {
            runId,
            toolCallId,
            resolve,
          });
        });
        this.pendingApprovals.delete(toolCallId);

        if (decision === "approved") {
          callbacks.onToolDecision?.(toolCallId, "approved");
          return undefined;
        }

        callbacks.onToolDecision?.(toolCallId, "rejected");
        return {
          block: true,
          reason: "Tool execution rejected by user.",
        };
      },
    } as never);

    this.activeAgents.set(runId, agent);
    callbacks.onRequestStart?.(runId, sessionId);

    let latestAssistantText = "";
    let finalStopReason: ModelStopReason = "end_turn";
    let finalToolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    let finalUsage = { inputTokens: 0, outputTokens: 0 };
    let finalError: string | null = null;

    const context = {
      runId,
      sessionId,
      currentToolCallId: undefined as string | undefined,
      toolCallIdMap: new Map<string, string>(),
      messageIdCounter: 0,
    };

    agent.subscribe((event: AgentEvent) => {
      const normalizedEvents = normalizeEvent(event, context);

      for (const normalized of normalizedEvents) {
        this.emitNormalizedEvent(normalized, callbacks);

        if (normalized.type === "assistant_delta") {
          latestAssistantText += normalized.delta;
        }
        if (normalized.type === "complete") {
          finalStopReason = normalized.stopReason;
          finalToolCalls = normalized.toolCalls;
          finalUsage = normalized.usage;
        }
        if (normalized.type === "error") {
          finalError = normalized.error;
        }
        if (normalized.type === "tool_call_start") {
          context.currentToolCallId = normalized.toolCallId;
        }
      }
    });

    try {
      await agent.prompt(prompt);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorClass = classifyPiAiError(errorMessage);
      const recoverable = isRecoverableError(errorClass);
      callbacks.onError?.(errorMessage, errorClass, recoverable);
      finalError = errorMessage;
    } finally {
      this.activeAgents.delete(runId);
      this.toolCallsByRun.delete(runId);
    }

    return {
      assistantText: latestAssistantText,
      stopReason: finalStopReason,
      toolCalls: finalToolCalls,
      usage: finalUsage,
      error: finalError,
    };
  }

  cancel(runId: string): void {
    const agent = this.activeAgents.get(runId);
    if (!agent) {
      return;
    }

    this.resolvePendingApprovalsForRun(runId, "rejected");
    (agent as unknown as { abort(): void }).abort();
    this.activeAgents.delete(runId);
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

  private emitNormalizedEvent(event: ModelStreamEvent, callbacks: ModelClientCallbacks): void {
    switch (event.type) {
      case "assistant_delta":
        callbacks.onTextDelta?.(event.delta);
        break;
      case "tool_call_start":
        callbacks.onToolCallStart?.(event.toolCallId, event.toolName, event.input);
        break;
      case "tool_call_end":
        callbacks.onToolCallEnd?.(event.toolCallId, event.toolName, event.result, event.isError);
        break;
      case "tool_result":
        callbacks.onToolResult?.(event.toolCallId, event.toolName, event.output, event.isError);
        break;
      case "update":
        callbacks.onUpdate?.(event.toolCallId, event.toolName, event.delta, event.partialResult);
        break;
      case "usage":
        callbacks.onUsage?.(event.usage);
        break;
      case "error":
        callbacks.onError?.(event.error, event.errorClass, event.recoverable);
        break;
      case "request_start":
        callbacks.onRequestStart?.(event.runId, event.sessionId);
        break;
      case "complete":
        break;
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

  private requiresApproval(toolName: string): boolean {
    return false;
  }

  private buildTools(enabledTools?: ToolName[]): AgentTool[] {
    const allTools = createToolArray("");

    if (!enabledTools || enabledTools.length === 0) {
      return allTools;
    }

    const allowed = new Set(enabledTools);
    return allTools.filter((tool: AgentTool) => allowed.has(tool.name as ToolName));
  }
}

/**
 * Create a new PiAiModelClient instance.
 */
export function createModelClient(): ModelClient {
  return new PiAiModelClient();
}
