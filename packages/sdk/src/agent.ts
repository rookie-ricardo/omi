import { createId, nowIso } from "@omi/core";
import { buildSystemPrompt, loadProjectContextFiles } from "@omi/prompt";
import {
  createProviderAdapter,
  type ProviderAdapter,
  type ProviderRunInput,
  type ProviderToolLifecycleControl,
  type ProviderToolLifecycleEvent,
} from "@omi/provider";
import { createAllTools, listBuiltInToolNames } from "@omi/tools";

import type {
  AgentOptions,
  AssistantMessage,
  CanUseToolResult,
  Message,
  QueryResult,
  SDKMessage,
  SDKResultMessage,
  TokenUsage,
  UserMessage,
} from "./types";

interface ProviderConfigShape {
  id: string;
  name: string;
  protocol: "anthropic-messages" | "openai-chat" | "openai-responses";
  baseUrl: string;
  apiKey: string;
  model: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

function inferProtocol(options: AgentOptions): ProviderConfigShape["protocol"] {
  if (options.protocol) {
    return options.protocol;
  }

  const model = (options.model ?? "").toLowerCase();
  if (model.startsWith("gpt") || model.startsWith("o")) {
    return "openai-chat";
  }

  return "anthropic-messages";
}

function buildProviderConfig(options: AgentOptions): ProviderConfigShape {
  const protocol = inferProtocol(options);
  const apiKey = options.apiKey
    ?? (protocol === "anthropic-messages"
      ? process.env.ANTHROPIC_API_KEY
      : process.env.OPENAI_API_KEY)
    ?? "";

  const model = options.model
    ?? (protocol === "anthropic-messages" ? "claude-sonnet-4-6" : "gpt-5.4");

  return {
    id: "sdk_default",
    name: protocol === "anthropic-messages" ? "claude" : "openai",
    protocol,
    baseUrl: options.baseURL ?? "",
    apiKey,
    model,
    url: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function toProviderHistory(messages: Message[]): ProviderRunInput["historyMessages"] {
  const history: ProviderRunInput["historyMessages"] = [];

  for (const message of messages) {
    if (message.type === "user") {
      history.push({
        role: "user",
        content: [{ type: "text", text: message.message.content }],
      } as unknown as ProviderRunInput["historyMessages"][number]);
      continue;
    }

    if (message.type === "assistant") {
      history.push({
        role: "assistant",
        content: [{ type: "text", text: message.message.content }],
      } as unknown as ProviderRunInput["historyMessages"][number]);
    }
  }

  return history;
}

function transformPlanPromptForRuntime(
  prompt: string,
  protocol: ProviderConfigShape["protocol"],
): string {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith("/plan")) {
    return prompt;
  }

  if (protocol === "anthropic-messages") {
    return prompt;
  }

  const body = trimmed.slice("/plan".length).trim();
  const target = body.length > 0 ? body : "Analyze the current task and provide a concrete implementation plan.";

  return [
    "Plan-only mode.",
    "Generate a concrete implementation plan and do not execute actions.",
    "Do not write code, do not run commands, and do not claim work is completed.",
    "Output sections exactly as:",
    "1) Goal",
    "2) Scope",
    "3) Step-by-step Plan",
    "4) Risks",
    "",
    `User request: ${target}`,
  ].join("\n");
}

export class Agent {
  private readonly options: AgentOptions;
  private readonly provider: ProviderAdapter;
  private readonly workspaceRoot: string;
  private readonly sessionId: string;
  private readonly messageLog: Message[] = [];

  constructor(options: AgentOptions = {}) {
    this.options = { ...options };
    this.provider = createProviderAdapter();
    this.workspaceRoot = options.cwd ?? process.cwd();
    this.sessionId = createId("session");
  }

  async *query(
    prompt: string,
    overrides?: Partial<AgentOptions>,
  ): AsyncGenerator<SDKMessage, void> {
    const startedAt = Date.now();
    const merged = { ...this.options, ...overrides };
    const providerConfig = buildProviderConfig(merged);

    if (!providerConfig.apiKey) {
      yield {
        type: "result",
        subtype: "error_during_execution",
        isError: true,
        errors: ["Missing API key. Set apiKey or relevant environment variables."],
        durationMs: Date.now() - startedAt,
      } satisfies SDKResultMessage;
      return;
    }

    const tools = Object.values(createAllTools(this.workspaceRoot));
    const toolNames = listBuiltInToolNames();
    const contextFiles = loadProjectContextFiles(this.workspaceRoot);
    const systemPrompt = merged.systemPrompt ?? buildSystemPrompt({
      appendSystemPrompt: merged.appendSystemPrompt,
      cwd: this.workspaceRoot,
      selectedTools: toolNames,
      projectContextFiles: contextFiles,
    });

    const runId = createId("run");
    const userPrompt = transformPlanPromptForRuntime(prompt, providerConfig.protocol);

    const userMessage: UserMessage = {
      type: "user",
      message: {
        role: "user",
        content: prompt,
      },
      uuid: createId("msg"),
      timestamp: nowIso(),
    };
    this.messageLog.push(userMessage);

    yield {
      type: "system",
      subtype: "init",
      sessionId: this.sessionId,
      model: providerConfig.model,
      cwd: this.workspaceRoot,
      permissionMode: merged.permissionMode ?? "default",
    };

    let assistantText = "";
    const lifecycleDecisions = new Map<string, CanUseToolResult>();

    const streamQueue: SDKMessage[] = [];
    let streamResolver: ((message: SDKMessage | null) => void) | null = null;
    let streamClosed = false;

    const pushStream = (message: SDKMessage): void => {
      if (streamResolver) {
        const resolver = streamResolver;
        streamResolver = null;
        resolver(message);
        return;
      }
      streamQueue.push(message);
    };

    const closeStream = (): void => {
      streamClosed = true;
      if (streamResolver) {
        const resolver = streamResolver;
        streamResolver = null;
        resolver(null);
      }
    };

    const nextStream = async (): Promise<SDKMessage | null> => {
      if (streamQueue.length > 0) {
        return streamQueue.shift() ?? null;
      }
      if (streamClosed) {
        return null;
      }
      return new Promise<SDKMessage | null>((resolve) => {
        streamResolver = resolve;
      });
    };

    void (async () => {
      try {
        const result = await this.provider.run({
          runId,
          sessionId: this.sessionId,
          workspaceRoot: this.workspaceRoot,
          prompt: userPrompt,
          historyMessages: toProviderHistory(this.messageLog.slice(0, -1)),
          systemPrompt,
          providerConfig,
          tools,
          enabledTools: toolNames,
          signal: merged.abortSignal,
          onTextDelta: async (delta) => {
            assistantText += delta;
            pushStream({
              type: "assistant",
              sessionId: this.sessionId,
              message: {
                role: "assistant",
                content: [{ type: "text", text: assistantText }],
              },
            });
          },
          onToolLifecycle: async (event): Promise<ProviderToolLifecycleControl> =>
            this.handleToolLifecycle(event, merged, lifecycleDecisions),
        });

        const usage: TokenUsage = {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cacheCreationInputTokens: result.usage.cacheCreationTokens,
          cacheReadInputTokens: result.usage.cacheReadTokens,
        };

        const assistantMessage: AssistantMessage = {
          type: "assistant",
          message: {
            role: "assistant",
            content: assistantText,
          },
          uuid: createId("msg"),
          timestamp: nowIso(),
          usage,
        };
        this.messageLog.push(assistantMessage);

        pushStream({
          type: "result",
          subtype: result.error ? "error_during_execution" : "success",
          isError: Boolean(result.error),
          numTurns: 1,
          result: assistantText,
          stopReason: result.stopReason,
          durationMs: Date.now() - startedAt,
          usage,
          ...(result.error ? { errors: [result.error] } : {}),
        } satisfies SDKResultMessage);
      } catch (error) {
        pushStream({
          type: "result",
          subtype: "error_during_execution",
          isError: true,
          errors: [error instanceof Error ? error.message : String(error)],
          durationMs: Date.now() - startedAt,
        } satisfies SDKResultMessage);
      } finally {
        closeStream();
      }
    })();

    while (true) {
      const message = await nextStream();
      if (!message) {
        break;
      }
      yield message;
    }
  }

  async prompt(
    text: string,
    overrides?: Partial<AgentOptions>,
  ): Promise<QueryResult> {
    const startedAt = Date.now();
    let output = "";
    let usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
    };

    for await (const event of this.query(text, overrides)) {
      if (event.type === "assistant") {
        output = event.message.content.map((entry) => entry.text).join("\n");
      }
      if (event.type === "result" && event.usage) {
        usage = event.usage;
      }
    }

    return {
      text: output,
      usage,
      numTurns: 1,
      durationMs: Date.now() - startedAt,
      sessionId: this.sessionId,
      messages: [...this.messageLog],
    };
  }

  getMessages(): Message[] {
    return [...this.messageLog];
  }

  getSessionId(): string {
    return this.sessionId;
  }

  clear(): void {
    this.messageLog.length = 0;
  }

  abort(): void {
    // SDK cancel uses per-run cancel by id; thin wrapper exposes AbortSignal path via options.
  }

  dispose(): void {
    this.clear();
  }

  private async handleToolLifecycle(
    event: ProviderToolLifecycleEvent,
    options: AgentOptions,
    lifecycleDecisions: Map<string, CanUseToolResult>,
  ): Promise<ProviderToolLifecycleControl> {
    if (event.stage === "requested") {
      if (!options.canUseTool) {
        return {
          allowExecution: true,
          requiresApproval: false,
        };
      }

      const decision = await options.canUseTool(event.toolName, event.input);
      lifecycleDecisions.set(event.toolCallId, decision);

      if (decision.behavior === "deny") {
        return {
          allowExecution: false,
          error: decision.message ?? "Tool denied by canUseTool callback.",
        };
      }

      if (decision.behavior === "ask") {
        return {
          allowExecution: true,
          requiresApproval: true,
        };
      }

      return {
        allowExecution: true,
        requiresApproval: false,
      };
    }

    if (event.stage === "approval_requested") {
      const decision = lifecycleDecisions.get(event.toolCallId);
      if (decision?.behavior === "deny") {
        return {
          decision: "rejected",
          error: decision.message,
        };
      }
      return {
        decision: "approved",
      };
    }

    return {};
  }
}

export function createAgent(options: AgentOptions = {}): Agent {
  return new Agent(options);
}

export async function* query(
  params: {
    prompt: string;
  } & AgentOptions,
): AsyncGenerator<SDKMessage, void> {
  const agent = createAgent(params);
  try {
    yield* agent.query(params.prompt);
  } finally {
    agent.dispose();
  }
}
