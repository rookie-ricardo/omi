import { Agent, type AgentEvent, type AgentTool } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message } from "@mariozechner/pi-ai";

import type { ProviderConfig } from "@omi/core";

import { createModelFromConfig } from "./model-registry";
import { type ToolName, executeTool, requiresApproval, toolRegistry } from "@omi/tools";

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
  onTextDelta?: (delta: string) => void;
  onToolRequested?: (event: ProviderToolRequestedEvent) => Promise<string>;
  onToolDecision?: (toolCallId: string, decision: "approved" | "rejected") => void;
  onToolStarted?: (toolCallId: string, toolName: string) => void;
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

export { createModelFromConfig } from "./model-registry";

export function buildAgentInitialState(input: ProviderRunInput) {
  return {
    systemPrompt: input.systemPrompt ?? "",
    model: createModelFromConfig(input.providerConfig),
    tools: buildAgentTools(input.workspaceRoot, input.enabledTools),
    messages: input.historyMessages,
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

export class PiAiProvider implements ProviderAdapter {
  private readonly activeAgents = new Map<string, Agent>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly toolCallsByRun = new Map<string, RuntimeToolCall[]>();

  async run(input: ProviderRunInput): Promise<ProviderRunResult> {
    const toolCalls: RuntimeToolCall[] = [];
    this.toolCallsByRun.set(input.runId, toolCalls);

    const agent = new Agent({
      initialState: buildAgentInitialState(input) as never,
      convertToLlm: passthroughMessages as never,
      transformContext: async (messages) => messages as never,
      sessionId: input.sessionId,
      getApiKey: () => input.providerConfig.apiKey,
      toolExecution: "sequential",
      beforeToolCall: async ({ toolCall, args }) => {
        const toolName = toolCall.name;
        const requiresReview = isBuiltInTool(toolName) ? requiresApproval(toolName) : false;
        const toolCallId =
          (await input.onToolRequested?.({
            runId: input.runId,
            sessionId: input.sessionId,
            toolName,
            input: args as Record<string, unknown>,
            requiresApproval: requiresReview,
          })) ?? `${input.runId}:${toolCalls.length + 1}`;

        toolCalls.push({
          toolCallId,
          toolName,
          phase: "requested",
        });

        if (!requiresReview) {
          return undefined;
        }

        const decision = await new Promise<"approved" | "rejected">((resolve) => {
          this.pendingApprovals.set(toolCallId, {
            runId: input.runId,
            toolCallId,
            resolve,
          });
        });
        this.pendingApprovals.delete(toolCallId);

        if (decision === "approved") {
          input.onToolDecision?.(toolCallId, "approved");
          return undefined;
        }

        input.onToolDecision?.(toolCallId, "rejected");
        return {
          block: true,
          reason: "Tool execution rejected by user.",
        };
      },
    });

    this.activeAgents.set(input.runId, agent);
    let latestAssistantText = "";

    agent.subscribe((event) => {
      this.handleAgentEvent(event, input.runId, toolCalls, input);
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        latestAssistantText += event.assistantMessageEvent.delta;
      }
      if (
        event.type === "message_end" &&
        "role" in event.message &&
        event.message.role === "assistant"
      ) {
        const assistantText = assistantMessageToText(event.message);
        if (assistantText) {
          latestAssistantText = assistantText;
        }
      }
    });

    try {
      await agent.prompt(input.prompt);
      return { assistantText: latestAssistantText };
    } finally {
      this.activeAgents.delete(input.runId);
      this.toolCallsByRun.delete(input.runId);
    }
  }

  cancel(runId: string): void {
    const agent = this.activeAgents.get(runId);
    if (!agent) {
      return;
    }

    this.resolvePendingApprovals(runId, "rejected");
    agent.abort();
    this.activeAgents.delete(runId);
    this.toolCallsByRun.delete(runId);
  }

  approveTool(toolCallId: string): void {
    this.resolveApproval(toolCallId, "approved");
  }

  rejectTool(toolCallId: string): void {
    this.resolveApproval(toolCallId, "rejected");
  }

  private resolveApproval(toolCallId: string, decision: "approved" | "rejected"): void {
    const pendingApproval = this.pendingApprovals.get(toolCallId);
    if (!pendingApproval) {
      return;
    }

    this.pendingApprovals.delete(toolCallId);
    pendingApproval.resolve(decision);
  }

  private resolvePendingApprovals(runId: string, decision: "approved" | "rejected"): void {
    for (const [toolCallId, pendingApproval] of this.pendingApprovals.entries()) {
      if (pendingApproval.runId !== runId) {
        continue;
      }

      this.pendingApprovals.delete(toolCallId);
      pendingApproval.resolve(decision);
    }
  }

  private handleAgentEvent(
    event: AgentEvent,
    runId: string,
    toolCalls: RuntimeToolCall[],
    input: ProviderRunInput,
  ): void {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      input.onTextDelta?.(event.assistantMessageEvent.delta);
      return;
    }

    if (event.type === "tool_execution_start") {
      const toolCall = findToolCall(toolCalls, event.toolName, ["requested"]);
      if (!toolCall) {
        return;
      }

      toolCall.phase = "started";
      input.onToolStarted?.(toolCall.toolCallId, toolCall.toolName);
      return;
    }

    if (event.type === "tool_execution_end") {
      const toolCall = findToolCall(toolCalls, event.toolName, ["started", "requested"]);
      if (!toolCall) {
        return;
      }

      toolCall.phase = "finished";
      input.onToolFinished?.(
        toolCall.toolCallId,
        toolCall.toolName,
        (event.result?.details ?? {}) as Record<string, unknown>,
        event.isError,
      );
    }
  }
}

function findToolCall(
  toolCalls: RuntimeToolCall[],
  toolName: string,
  phases: Array<RuntimeToolCall["phase"]>,
): RuntimeToolCall | undefined {
  return toolCalls.find((toolCall) => toolCall.toolName === toolName && phases.includes(toolCall.phase));
}

function buildAgentTools(
  workspaceRoot: string,
  enabledTools?: ToolName[],
): AgentTool[] {
  const allowedToolNames = enabledTools && enabledTools.length > 0 ? new Set(enabledTools) : null;
  const builtIns = toolRegistry
    .list()
    .filter((tool) => !allowedToolNames || allowedToolNames.has(tool.name))
    .map((tool) => {
      return {
        name: tool.name,
        label: formatToolLabel(tool.name),
        description: tool.description,
        parameters: tool.parameters,
        async execute(_toolCallId, params) {
          return toAgentToolResult(await executeTool(tool.name, params, { workspaceRoot }));
        },
      } satisfies AgentTool;
    });

  return builtIns;
}

function formatToolLabel(toolName: ToolName): string {
  return toolName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toAgentToolResult(result: Awaited<ReturnType<typeof executeTool>>) {
  if (result.ok) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.output, null, 2) }],
      details: result.output ?? {},
    };
  }

  return {
    content: [{ type: "text" as const, text: result.error?.message ?? "Tool execution failed." }],
    details: result.error ?? {},
  };
}

function isBuiltInTool(toolName: string): toolName is ToolName {
  return toolRegistry.has(toolName);
}

function passthroughMessages(messages: Message[]): Message[] {
  return messages;
}

function assistantMessageToText(message: AssistantMessage): string {
  return message.content
    .filter((content): content is { type: "text"; text: string } => content.type === "text")
    .map((content) => content.text)
    .join("");
}
