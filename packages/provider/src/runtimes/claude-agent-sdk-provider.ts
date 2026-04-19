import {
  createSdkMcpServer,
  query,
  tool as createClaudeMcpTool,
  type Options as ClaudeAgentSdkOptions,
  type SDKMessage as ClaudeAgentSdkMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  DEFAULT_SKILL_SETTING_SOURCES,
  normalizeSkillSettingSources,
} from "@omi/core";

import type {
  ProviderAdapter,
  ProviderRunInput,
  ProviderRunResult,
  ProviderToolLifecycleControl,
} from "../providers";
import type { ModelStopReason, ModelUsage } from "../types";
import {
  buildSingleTurnPrompt,
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

const DEFAULT_TOOL_PRESET: NonNullable<ClaudeAgentSdkOptions["tools"]> = {
  type: "preset",
  preset: "claude_code",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function mapClaudeToolName(toolName: string): string {
  const trimmed = toolName.trim();
  if (trimmed.length === 0) {
    return "unknown_tool";
  }
  if (trimmed.includes("__")) {
    return trimmed.toLowerCase();
  }
  const snake = trimmed
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
  return snake;
}

function coerceToolInput(input: unknown, blockedPath: string | undefined): Record<string, unknown> {
  const normalized = isRecord(input) ? { ...input } : {};
  if (typeof blockedPath === "string" && blockedPath.length > 0) {
    const existingPath = normalized.path ?? normalized.filePath ?? normalized.file_path;
    if (typeof existingPath !== "string" || existingPath.length === 0) {
      normalized.path = blockedPath;
    }
  }
  return normalized;
}

function buildSingleUserMessageStream(prompt: string): AsyncIterable<SDKUserMessage> {
  return (async function* () {
    yield {
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: prompt,
      },
    };
  })();
}

function mapThinkingLevelToClaudeEffort(
  level: ProviderRunInput["thinkingLevel"],
): NonNullable<ClaudeAgentSdkOptions["effort"]> | undefined {
  if (level === "minimal" || level === "low") {
    return "low";
  }
  if (level === "medium") {
    return "medium";
  }
  if (level === "high") {
    return "high";
  }
  if (level === "xhigh") {
    return "max";
  }
  return undefined;
}

export class ClaudeAgentSdkProvider implements ProviderAdapter {
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly sessionCursors = new Map<string, string>();

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
    let structuredOutput: unknown = undefined;
    let providerMeta: Record<string, unknown> | undefined;
    let observedSessionId: string | null = this.sessionCursors.get(input.sessionId) ?? null;
    let resultSnapshot: Record<string, unknown> | null = null;
    let toolCallCounter = 0;
    const emitToolLifecycle = async (
      event: Omit<Parameters<NonNullable<ProviderRunInput["onToolLifecycle"]>>[0], "runId" | "sessionId">,
    ): Promise<ProviderToolLifecycleControl> => {
      if (!input.onToolLifecycle) {
        throw new Error("Missing onToolLifecycle handler for runtime-native tool execution (fail-closed).");
      }
      const control = await input.onToolLifecycle({
        ...event,
        source: event.source ?? "runtime_native",
        runId: input.runId,
        sessionId: input.sessionId,
      });
      return control ?? {};
    };

    const runnableTools = (input.tools ?? []).filter(
      (tool) => !input.enabledTools || input.enabledTools.includes(tool.name),
    );

    const mcpTools = runnableTools.map((tool) =>
      createClaudeMcpTool(
        tool.name,
        tool.description,
        jsonSchemaToZodShape(tool.parameters),
        async (args): Promise<CallToolResult> => {
          const toolCallId = `${input.runId}:native:${tool.name}:${++toolCallCounter}`;
          const toolInput = args as Record<string, unknown>;
          const requested = await emitToolLifecycle({
            stage: "requested",
            toolCallId,
            toolName: tool.name,
            input: toolInput,
          });
          if (typeof requested.allowExecution !== "boolean") {
            throw new Error(
              `Tool lifecycle handler must return { allowExecution: boolean } for requested stage (${tool.name}).`,
            );
          }
          if (!requested.allowExecution) {
            return {
              content: [{ type: "text", text: requested.error ?? `Tool '${tool.name}' denied by runtime policy.` }],
              isError: true,
            };
          }
          if (typeof requested.requiresApproval !== "boolean") {
            throw new Error(
              `Tool lifecycle handler must return { requiresApproval: boolean } when execution is allowed (${tool.name}).`,
            );
          }
          if (requested.requiresApproval) {
            const approval = await emitToolLifecycle({
              stage: "approval_requested",
              toolCallId,
              toolName: tool.name,
              input: toolInput,
            });
            if (approval.decision !== "approved" && approval.decision !== "rejected") {
              throw new Error(
                `Tool lifecycle handler must return decision for approval_requested stage (${tool.name}).`,
              );
            }
            if (approval.decision === "rejected") {
              return {
                content: [{ type: "text", text: approval.error ?? "Tool execution rejected by user." }],
                isError: true,
              };
            }
          }
          await emitToolLifecycle({
            stage: "started",
            toolCallId,
            toolName: tool.name,
            input: toolInput,
          });
          try {
            const result = await tool.execute(
              toolCallId,
              toolInput,
              abortController.signal,
              (update) => {
                void emitToolLifecycle({
                  stage: "progress",
                  toolCallId,
                  toolName: tool.name,
                  input: toolInput,
                  output: update,
                });
              },
            );
            await emitToolLifecycle({
              stage: "finished",
              toolCallId,
              toolName: tool.name,
              input: toolInput,
              output: result.content,
            });
            const outputText = renderToolOutputText(result.content);
            return {
              content: [{ type: "text", text: outputText }],
              isError: false,
            };
          } catch (caughtError) {
            const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
            await emitToolLifecycle({
              stage: "failed",
              toolCallId,
              toolName: tool.name,
              input: toolInput,
              error: message,
              output: { error: message },
            });
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

    const requestedOptions = (isRecord(input.claudeOptions) ? input.claudeOptions : {}) as ClaudeAgentSdkOptions;
    const sharedSettingSources = normalizeSkillSettingSources(
      requestedOptions.settingSources,
      DEFAULT_SKILL_SETTING_SOURCES,
    );
    const runtimeManagedToolNames = new Set(runnableTools.map((tool) => tool.name));
    const userCanUseTool = requestedOptions.canUseTool;
    const hasExplicitSessionCursor = Boolean(
      requestedOptions.resume || requestedOptions.continue || requestedOptions.sessionId,
    );
    const autoResumeSessionId = !hasExplicitSessionCursor
      ? (this.sessionCursors.get(input.sessionId) ?? null)
      : null;

    const runtimeCanUseTool: NonNullable<ClaudeAgentSdkOptions["canUseTool"]> = async (
      rawToolName,
      rawInput,
      permissionOptions,
    ) => {
      if (runtimeManagedToolNames.has(rawToolName)) {
        if (!userCanUseTool) {
          return { behavior: "allow" };
        }
        return userCanUseTool(rawToolName, rawInput, permissionOptions);
      }

      const toolName = mapClaudeToolName(rawToolName);
      const toolCallId = typeof permissionOptions?.toolUseID === "string" && permissionOptions.toolUseID.length > 0
        ? permissionOptions.toolUseID
        : `${input.runId}:builtin:${toolName}:${++toolCallCounter}`;
      const toolInput = coerceToolInput(rawInput, permissionOptions?.blockedPath);

      const requested = await emitToolLifecycle({
        stage: "requested",
        source: "provider_builtin",
        rawToolName,
        toolCallId,
        toolName,
        input: toolInput,
      });
      if (typeof requested.allowExecution !== "boolean") {
        throw new Error(
          `Tool lifecycle handler must return { allowExecution: boolean } for requested stage (${toolName}).`,
        );
      }
      if (!requested.allowExecution) {
        return {
          behavior: "deny" as const,
          message: requested.error ?? `Tool '${toolName}' denied by runtime policy.`,
        };
      }
      if (typeof requested.requiresApproval !== "boolean") {
        throw new Error(
          `Tool lifecycle handler must return { requiresApproval: boolean } when execution is allowed (${toolName}).`,
        );
      }
      if (requested.requiresApproval) {
        const approval = await emitToolLifecycle({
          stage: "approval_requested",
          source: "provider_builtin",
          rawToolName,
          toolCallId,
          toolName,
          input: toolInput,
        });
        if (approval.decision !== "approved" && approval.decision !== "rejected") {
          throw new Error(
            `Tool lifecycle handler must return decision for approval_requested stage (${toolName}).`,
          );
        }
        if (approval.decision === "rejected") {
          return {
            behavior: "deny" as const,
            message: approval.error ?? `Tool '${toolName}' rejected by user.`,
          };
        }
      }

      const lifecycleAllow = {
        behavior: "allow" as const,
      };
      if (!userCanUseTool) {
        return lifecycleAllow;
      }
      const userDecision = await userCanUseTool(rawToolName, rawInput, permissionOptions);
      if (userDecision.behavior === "deny") {
        return userDecision;
      }
      return userDecision;
    };

    const requestedEnv = requestedOptions.env ?? {};
    const env = {
      ...process.env,
      ...requestedEnv,
      ANTHROPIC_API_KEY: input.providerConfig.apiKey,
      ANTHROPIC_BASE_URL:
        input.providerConfig.baseUrl?.trim().length
          ? input.providerConfig.baseUrl
          : (requestedEnv.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL),
    };
    const inferredEffort = mapThinkingLevelToClaudeEffort(input.thinkingLevel);
    const options: ClaudeAgentSdkOptions = {
      ...requestedOptions,
      cwd: input.workspaceRoot,
      model: input.providerConfig.model,
      systemPrompt: input.systemPrompt ?? requestedOptions.systemPrompt,
      maxTurns: requestedOptions.maxTurns ?? 20,
      tools: requestedOptions.tools ?? DEFAULT_TOOL_PRESET,
      settingSources: sharedSettingSources as NonNullable<ClaudeAgentSdkOptions["settingSources"]>,
      includePartialMessages: requestedOptions.includePartialMessages ?? true,
      promptSuggestions: requestedOptions.promptSuggestions ?? true,
      agentProgressSummaries: requestedOptions.agentProgressSummaries ?? true,
      includeHookEvents: requestedOptions.includeHookEvents ?? false,
      ...(typeof requestedOptions.effort === "undefined" && inferredEffort
        ? { effort: inferredEffort }
        : {}),
      ...(input.thinkingLevel === "off" &&
          typeof requestedOptions.thinking === "undefined" &&
          typeof requestedOptions.maxThinkingTokens === "undefined"
        ? { thinking: { type: "disabled" as const } }
        : {}),
      mcpServers: {
        ...(requestedOptions.mcpServers ?? {}),
        omi: mcpServer,
      },
      canUseTool: runtimeCanUseTool,
      abortController,
      env,
      ...(input.agents ? { agents: input.agents as ClaudeAgentSdkOptions["agents"] } : {}),
    };
    if (autoResumeSessionId) {
      options.resume = autoResumeSessionId;
    }

    const usingNativeSessionPrompt = Boolean(options.resume || options.continue || options.sessionId);
    const promptText = usingNativeSessionPrompt
      ? input.prompt
      : buildSingleTurnPrompt(input.prompt, input.historyMessages);

    const queryStream = this.deps.query({
      prompt: buildSingleUserMessageStream(promptText),
      options,
    });

    try {
      for await (const message of queryStream) {
        if (typeof (message as { session_id?: unknown }).session_id === "string") {
          observedSessionId = (message as { session_id: string }).session_id;
        }
        try {
          await input.onSdkMessage?.(message as ClaudeAgentSdkMessage);
        } catch {
          // SDK message observers must be fail-open to avoid interrupting the run.
        }

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
          resultSnapshot = message as unknown as Record<string, unknown>;
          usage = parseResultUsage(message.usage);
          if (typeof message.stop_reason === "string" || message.stop_reason === null) {
            stopReason = mapClaudeStopReasonToModel(message.stop_reason);
            if (message.stop_reason === "tool_use") {
              error = "SDK loop ended with unresolved tool_use stop reason.";
            }
          }

          if (message.subtype === "success" && "structured_output" in message) {
            structuredOutput = (message as Record<string, unknown>).structured_output;
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

    if (observedSessionId && observedSessionId.length > 0) {
      this.sessionCursors.set(input.sessionId, observedSessionId);
    }

    providerMeta = {
      runtime: "claude-agent-sdk",
      sessionId: observedSessionId,
      resumeUsed: typeof options.resume === "string" ? options.resume : null,
      promptMode: usingNativeSessionPrompt ? "native_session" : "fallback_envelope",
      resultSubtype: typeof resultSnapshot?.subtype === "string" ? resultSnapshot.subtype : null,
      numTurns: typeof resultSnapshot?.num_turns === "number" ? resultSnapshot.num_turns : null,
      totalCostUsd: typeof resultSnapshot?.total_cost_usd === "number" ? resultSnapshot.total_cost_usd : null,
      terminalReason: typeof resultSnapshot?.terminal_reason === "string" ? resultSnapshot.terminal_reason : null,
      modelUsage: isRecord(resultSnapshot?.modelUsage) ? resultSnapshot.modelUsage : null,
      permissionDenials: Array.isArray(resultSnapshot?.permission_denials) ? resultSnapshot.permission_denials : null,
      deferredToolUse: isRecord(resultSnapshot?.deferred_tool_use) ? resultSnapshot.deferred_tool_use : null,
      fastModeState: isRecord(resultSnapshot?.fast_mode_state) ? resultSnapshot.fast_mode_state : null,
    };

    if (assistantText.length === 0 && fallbackAssistantText.length > 0) {
      assistantText = fallbackAssistantText;
    }

    return {
      assistantText,
      stopReason,
      usage,
      error,
      structuredOutput,
      providerMeta,
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
