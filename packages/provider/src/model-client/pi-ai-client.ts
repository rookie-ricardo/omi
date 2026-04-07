import type { OmiTool } from "@omi/core";
import { type AssistantMessage, type Message, type ToolResultMessage, type StopReason, streamSimple } from "@mariozechner/pi-ai";
import { createHash } from "node:crypto";
import { createModelFromConfig } from "../model-registry";
import { ALLOW_TOOL_PREFLIGHT_DECISION } from "./types";
import type {
  ModelClient,
  ModelClientCallbacks,
  ModelClientRunInput,
  ModelClientRunResult,
  ModelStopReason,
  ToolPreflightDecision,
} from "./types";
import { routeProtocol } from "./protocol-router";
import { classifyPiAiError, isRecoverableError } from "./normalizer";

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

function canonicalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeForHash(item));
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const sortedEntries = Object.keys(record)
      .sort()
      .map((key) => [key, canonicalizeForHash(record[key])] as const);
    return Object.fromEntries(sortedEntries);
  }
  return value;
}

function buildStableToolCallId(
  runId: string,
  toolCall: unknown,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const toolCallSnapshot = JSON.stringify(canonicalizeForHash(toolCall ?? {}));
  const argsSnapshot = JSON.stringify(canonicalizeForHash(args));
  const fingerprint = createHash("sha1")
    .update(`${toolName}|${toolCallSnapshot}|${argsSnapshot}`)
    .digest("hex")
    .slice(0, 16);
  return `${runId}:tool:fallback:${fingerprint}`;
}

export class PiAiModelClient implements ModelClient {
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly toolCallsByRun = new Map<string, RuntimeToolCall[]>();
  private readonly abortControllers = new Map<string, AbortController>();

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

    routeProtocol(providerConfig);

    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);

    const toolCalls: RuntimeToolCall[] = [];
    this.toolCallsByRun.set(runId, toolCalls);
    const startedToolCallIds = new Set<string>();

    const model = createModelFromConfig(providerConfig);
    const apiTools = (input.tools ?? [])
      .filter((t) => !enabledTools || enabledTools.includes(t.name))
      .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as any,
    }));

    await callbacks.onRequestStart?.(runId, sessionId);

    // Initial message array
    const messages = [...historyMessages] as Message[];
    
    // Auto-append prompt if present
    if (prompt && prompt.trim().length > 0) {
      messages.push({
        role: "user",
        timestamp: Date.now(),
        content: prompt,
      });
    }

    let latestAssistantText = "";
    let finalStopReason: ModelStopReason = "end_turn";
    let finalToolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    let finalUsage = { inputTokens: 0, outputTokens: 0 };
    let finalError: string | null = null;
    let keepRunning = true;

    try {
      while (keepRunning && !abortController.signal.aborted) {
        let streamFinished = false;
        let turnAssistantMessage: AssistantMessage | undefined = undefined;

        try {
          const stream = streamSimple(
            model,
            {
              systemPrompt: systemPrompt ?? undefined,
              messages,
              tools: apiTools,
            },
            {
              signal: abortController.signal,
              reasoning: (thinkingLevel && thinkingLevel !== "off") ? (thinkingLevel as any) : undefined,
            }
          );

          for await (const event of stream) {
            if (abortController.signal.aborted) {
                break;
            }
            switch (event.type) {
              case "text_delta":
                latestAssistantText += event.delta;
                await callbacks.onTextDelta?.(event.delta);
                break;
              case "toolcall_start":
                break;
              case "toolcall_delta":
                break;
              case "done":
                streamFinished = true;
                turnAssistantMessage = event.message;
                finalStopReason = this.mapStopReason(event.reason);
                finalUsage = {
                  inputTokens: event.message.usage.input,
                  outputTokens: event.message.usage.output,
                };
                if (event.message.usage.cacheRead) {
                    (finalUsage as any).cacheReadTokens = event.message.usage.cacheRead;
                }
                if (event.message.usage.cacheWrite) {
                    (finalUsage as any).cacheCreationTokens = event.message.usage.cacheWrite;
                }
                await callbacks.onUsage?.(finalUsage);
                // Extract text for completion emit 
                break;
              case "error":
                streamFinished = true;
                turnAssistantMessage = event.error;
                finalError = event.error.errorMessage ?? "Unknown error";
                finalStopReason = "error";
                break;
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorClass = classifyPiAiError(error);
          const recoverable = isRecoverableError(errorClass);
          await callbacks.onError?.(errorMessage, errorClass, recoverable);
          finalError = errorMessage;
          finalStopReason = "error";
          break;
        }

        if (!turnAssistantMessage) {
            break;
        }

        messages.push(turnAssistantMessage);

        const toolCallsInMessage = turnAssistantMessage.content.filter((c) => c.type === "toolCall") as any[];
        
        if (toolCallsInMessage.length === 0 || finalStopReason !== "tool_use") {
          keepRunning = false;
          finalToolCalls = toolCallsInMessage.map(t => ({ id: t.id, name: t.name, input: t.arguments }));
          break;
        }

        const toolResultMessages: ToolResultMessage[] = [];
        const executeTool = async (piToolCall: any) => {
          const toolName = piToolCall.name;
          const args = piToolCall.arguments;
          const toolCallId = buildStableToolCallId(runId, piToolCall, toolName, args);
          
          let toolError: boolean = false;
          let toolOutput: any = "Unknown Error";

          try {
            const preflight: ToolPreflightDecision =
              (await preflightToolCheck?.(toolName, args)) ?? ALLOW_TOOL_PREFLIGHT_DECISION;

            if (preflight.decision === "deny") {
              await callbacks.onToolCallStart?.(toolCallId, toolName, args);
              startedToolCallIds.add(toolCallId);
              toolError = true;
              toolOutput = { error: preflight.reason ?? `Tool '${toolName}' is denied by policy.` };
            } else {
              const requiresReview = preflight.decision === "ask" || (input.requiresApprovalFn?.(toolName) ?? false);
              
              await callbacks.onToolCallStart?.(toolCallId, toolName, args);
              startedToolCallIds.add(toolCallId);

              if (requiresReview) {
                const decision = await new Promise<"approved" | "rejected">((resolve) => {
                  this.pendingApprovals.set(toolCallId, { runId, toolCallId, resolve });
                });
                this.pendingApprovals.delete(toolCallId);

                if (decision === "rejected") {
                  toolError = true;
                  toolOutput = { error: "Tool execution rejected by user." };
                }
              }

              if (!toolError) {
                const toolDef = (input.tools ?? []).find(t => t.name === toolName);
                if (!toolDef) {
                  toolError = true;
                  toolOutput = { error: `Tool ${toolName} not found` };
                } else {
                  const result = await toolDef.execute(toolCallId, args, abortController.signal, (update) => {
                    callbacks.onUpdate?.(toolCallId, toolName, typeof update === 'string' ? update : JSON.stringify(update), update);
                  });
                  toolOutput = result.content;
                }
              }
            }
          } catch (e) {
             toolError = true;
             toolOutput = { error: e instanceof Error ? e.message : String(e) };
          }

          toolResultMessages.push({
            role: "toolResult",
            toolCallId: piToolCall.id,
            toolName: toolName,
            content: Array.isArray(toolOutput) ? toolOutput : [{ type: "text", text: typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput) }],
            isError: toolError,
            timestamp: Date.now()
          });

          await callbacks.onToolResult?.(toolCallId, toolName, toolOutput, toolError);
          await callbacks.onToolCallEnd?.(toolCallId, toolName, toolOutput, toolError);
        };

        if (toolExecutionMode === "parallel") {
          await Promise.all(toolCallsInMessage.map(tc => executeTool(tc)));
        } else {
          for (const tc of toolCallsInMessage) {
            if (abortController.signal.aborted) break;
            await executeTool(tc);
          }
        }

        messages.push(...toolResultMessages);
      }
    } finally {
      this.abortControllers.delete(runId);
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

  private mapStopReason(reason: StopReason | string): ModelStopReason {
    if (reason === "length") return "max_tokens";
    if (reason === "toolUse") return "tool_use";
    if (reason === "stop") return "end_turn";
    if (reason === "error" || reason === "aborted") return "error";
    return "end_turn";
  }

  cancel(runId: string): void {
    const abortController = this.abortControllers.get(runId);
    if (!abortController) return;

    this.resolvePendingApprovalsForRun(runId, "rejected");
    abortController.abort();
    this.abortControllers.delete(runId);
    this.toolCallsByRun.delete(runId);
  }

  approveTool(toolCallId: string): void {
    const pending = this.pendingApprovals.get(toolCallId);
    if (!pending) return;

    this.pendingApprovals.delete(toolCallId);
    pending.resolve("approved");
  }

  rejectTool(toolCallId: string): void {
    const pending = this.pendingApprovals.get(toolCallId);
    if (!pending) return;

    this.pendingApprovals.delete(toolCallId);
    pending.resolve("rejected");
  }

  private resolvePendingApprovalsForRun(runId: string, decision: "approved" | "rejected"): void {
    for (const [toolCallId, pending] of this.pendingApprovals.entries()) {
      if (pending.runId !== runId) continue;
      this.pendingApprovals.delete(toolCallId);
      pending.resolve(decision);
    }
  }
}

export function createModelClient(): ModelClient {
  return new PiAiModelClient();
}
