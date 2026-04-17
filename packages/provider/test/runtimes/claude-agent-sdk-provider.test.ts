import { describe, expect, it, vi } from "vitest";

import type { OmiTool, ProviderConfig } from "@omi/core";

import { ClaudeAgentSdkProvider } from "../../src/runtimes/claude-agent-sdk-provider";

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "provider_1",
    name: "anthropic",
    protocol: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    apiKey: "test-key",
    model: "claude-sonnet-4-5",
    url: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTool(name: string, execute: OmiTool["execute"]): OmiTool {
  return {
    name,
    label: name,
    description: `${name} tool`,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    } as const,
    execute,
  };
}

function renderUserMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";
      if ((part as Record<string, unknown>).type === "text" && typeof (part as Record<string, unknown>).text === "string") {
        return String((part as Record<string, unknown>).text);
      }
      return "";
    })
    .join("");
}

async function readPromptText(prompt: unknown): Promise<string> {
  if (typeof prompt === "string") {
    return prompt;
  }
  if (!prompt || typeof (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator] !== "function") {
    return "";
  }
  let text = "";
  for await (const item of prompt as AsyncIterable<unknown>) {
    if (typeof item !== "object" || item === null) continue;
    const message = item as { type?: string; message?: { role?: string; content?: unknown } };
    if (message.type !== "user" || message.message?.role !== "user") continue;
    text += renderUserMessageContent(message.message.content);
  }
  return text;
}

describe("ClaudeAgentSdkProvider", () => {
  it("runs native sdk loop with in-process MCP tools", async () => {
    const onTextDelta = vi.fn();
    const toolLifecycleStages: string[] = [];
    const toolExecute = vi.fn(async () => ({
      content: [{ type: "text", text: "ok" }],
      details: {},
    }));
    const closeSpy = vi.fn();
    const querySpy = vi.fn(({ options }: any) => ({
      close: closeSpy,
      [Symbol.asyncIterator]: async function* () {
        const handler = options.mcpServers?.omi?.instance?._registeredTools?.bash?.handler;
        await handler?.({ query: "ls -la" });

        yield {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "Working..." },
          },
        };
        yield {
          type: "result",
          subtype: "success",
          stop_reason: "end_turn",
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_input_tokens: 2,
            cache_creation_input_tokens: 3,
          },
        };
      },
    }));

    const provider = new ClaudeAgentSdkProvider({
      query: querySpy as any,
    });

    const result = await provider.run({
      runId: "run_1",
      sessionId: "session_1",
      workspaceRoot: "/workspace",
      prompt: "show files",
      historyMessages: [
        {
          role: "user",
          content: [{ type: "text", text: "previous context" }],
          timestamp: 1,
        },
      ],
      providerConfig: makeConfig(),
      tools: [makeTool("bash", toolExecute)],
      enabledTools: ["bash"],
      onToolLifecycle: async (event) => {
        toolLifecycleStages.push(event.stage);
        if (event.stage === "requested") {
          return { allowExecution: true, requiresApproval: false };
        }
        return {};
      },
      onTextDelta,
    });

    expect(result.assistantText).toBe("Working...");
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 2,
      cacheCreationTokens: 3,
    });
    expect(result.error).toBeNull();
    expect(toolExecute).toHaveBeenCalledTimes(1);
    expect(toolExecute).toHaveBeenCalledWith(
      expect.stringContaining("run_1:native:bash:"),
      { query: "ls -la" },
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(onTextDelta).toHaveBeenCalledWith("Working...");
    expect(toolLifecycleStages).toEqual(["requested", "started", "finished"]);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(querySpy).toHaveBeenCalledTimes(1);
    const queryCall = querySpy.mock.calls[0]?.[0] as { prompt: unknown; options: Record<string, unknown> };
    const parsedPrompt = JSON.parse(await readPromptText(queryCall.prompt)) as {
      format: string;
      history: unknown[];
      currentUserMessage: string;
    };
    expect(parsedPrompt).toEqual({
      format: "omi-history-v1",
      history: [
        {
          role: "user",
          content: [{ type: "text", text: "previous context" }],
        },
      ],
      currentUserMessage: "show files",
    });
    expect(queryCall.options).toEqual(
      expect.objectContaining({
        maxTurns: 20,
        tools: {
          type: "preset",
          preset: "claude_code",
        },
        settingSources: ["project", "local", "user"],
        includePartialMessages: true,
        promptSuggestions: true,
        agentProgressSummaries: true,
        canUseTool: expect.any(Function),
        mcpServers: expect.objectContaining({
          omi: expect.any(Object),
        }),
      }),
    );
  });

  it("returns error when sdk yields non-success result", async () => {
    const closeSpy = vi.fn();
    const provider = new ClaudeAgentSdkProvider({
      query: (() => ({
        close: closeSpy,
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            subtype: "error_during_execution",
            errors: ["model failed"],
            stop_reason: null,
            usage: {
              input_tokens: 1,
              output_tokens: 0,
            },
          };
        },
      })) as any,
    });

    const result = await provider.run({
      runId: "run_2",
      sessionId: "session_1",
      workspaceRoot: "/workspace",
      prompt: "fail",
      historyMessages: [],
      providerConfig: makeConfig(),
      enabledTools: ["bash"],
    });

    expect(result.stopReason).toBe("error");
    expect(result.error).toContain("model failed");
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("auto-resumes native claude session and switches prompt mode on subsequent calls", async () => {
    const closeSpy = vi.fn();
    const observedCalls: Array<{ prompt: unknown; options: Record<string, unknown> }> = [];
    const querySpy = vi.fn((call: { prompt: unknown; options: Record<string, unknown> }) => {
      observedCalls.push(call);
      return {
      close: closeSpy,
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "result",
          subtype: "success",
          stop_reason: "end_turn",
          result: "ok",
          usage: {
            input_tokens: 1,
            output_tokens: 1,
          },
          session_id: "claude_session_1",
        };
      },
    }});
    const provider = new ClaudeAgentSdkProvider({
      query: querySpy as any,
    });

    await provider.run({
      runId: "run_auto_1",
      sessionId: "session_auto",
      workspaceRoot: "/workspace",
      prompt: "first prompt",
      historyMessages: [
        {
          role: "user",
          content: [{ type: "text", text: "before first" }],
          timestamp: 1,
        },
      ],
      providerConfig: makeConfig(),
    });

    await provider.run({
      runId: "run_auto_2",
      sessionId: "session_auto",
      workspaceRoot: "/workspace",
      prompt: "second prompt",
      historyMessages: [
        {
          role: "user",
          content: [{ type: "text", text: "before second" }],
          timestamp: 2,
        },
      ],
      providerConfig: makeConfig(),
    });

    const firstCall = observedCalls[0];
    const secondCall = observedCalls[1];
    expect(firstCall).toBeTruthy();
    expect(secondCall).toBeTruthy();
    if (!firstCall || !secondCall) {
      throw new Error("expected query calls were not captured");
    }
    const firstPrompt = await readPromptText(firstCall.prompt);
    const secondPrompt = await readPromptText(secondCall.prompt);

    expect(firstPrompt).toContain("\"format\":\"omi-history-v1\"");
    expect(secondPrompt).toBe("second prompt");
    expect(secondCall.options.resume).toBe("claude_session_1");
    expect(closeSpy).toHaveBeenCalledTimes(2);
  });

  it("bridges provider built-in tool approval through onToolLifecycle via canUseTool", async () => {
    const lifecycleLog: Array<{ stage: string; source?: string; toolName: string; rawToolName?: string }> = [];
    let canUseToolDecision: unknown = null;
    const closeSpy = vi.fn();
    const querySpy = vi.fn(({ options }: any) => ({
      close: closeSpy,
      [Symbol.asyncIterator]: async function* () {
        canUseToolDecision = await options.canUseTool?.(
          "Bash",
          { command: "ls -la" },
          {
            signal: new AbortController().signal,
            toolUseID: "builtin_tool_1",
          },
        );
        yield {
          type: "result",
          subtype: "success",
          stop_reason: "end_turn",
          result: "done",
          usage: {
            input_tokens: 2,
            output_tokens: 1,
          },
          session_id: "claude_session_builtins",
        };
      },
    }));
    const provider = new ClaudeAgentSdkProvider({
      query: querySpy as any,
    });

    await provider.run({
      runId: "run_builtin_1",
      sessionId: "session_builtin",
      workspaceRoot: "/workspace",
      prompt: "run built-in",
      historyMessages: [],
      providerConfig: makeConfig(),
      onToolLifecycle: async (event) => {
        lifecycleLog.push({
          stage: event.stage,
          source: event.source,
          toolName: event.toolName,
          rawToolName: event.rawToolName,
        });
        if (event.stage === "requested") {
          return { allowExecution: true, requiresApproval: true };
        }
        if (event.stage === "approval_requested") {
          return { decision: "approved" };
        }
        return {};
      },
    });

    expect(canUseToolDecision).toEqual({ behavior: "allow" });
    expect(lifecycleLog).toEqual([
      {
        stage: "requested",
        source: "provider_builtin",
        toolName: "bash",
        rawToolName: "Bash",
      },
      {
        stage: "approval_requested",
        source: "provider_builtin",
        toolName: "bash",
        rawToolName: "Bash",
      },
    ]);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("passes through claude options and forwards sdk messages", async () => {
    const closeSpy = vi.fn();
    const onSdkMessage = vi.fn();
    const querySpy = vi.fn(({ options }: any) => ({
      close: closeSpy,
      [Symbol.asyncIterator]: async function* () {
        yield { type: "prompt_suggestion", suggestion: "continue with integration tests" };
        yield {
          type: "result",
          subtype: "success",
          stop_reason: "end_turn",
          result: "done",
          usage: {
            input_tokens: 3,
            output_tokens: 5,
          },
          structured_output: {
            status: "ok",
          },
        };
      },
    }));

    const provider = new ClaudeAgentSdkProvider({
      query: querySpy as any,
    });

    const result = await provider.run({
      runId: "run_3",
      sessionId: "session_1",
      workspaceRoot: "/workspace",
      prompt: "emit suggestion",
      historyMessages: [],
      providerConfig: makeConfig(),
      tools: [],
      claudeOptions: {
        includeHookEvents: true,
        promptSuggestions: true,
        maxTurns: 9,
        env: {
          CLAUDE_AGENT_SDK_CLIENT_APP: "omi-test/1.0.0",
        },
      } as any,
      onSdkMessage,
    });

    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          maxTurns: 9,
          includeHookEvents: true,
          promptSuggestions: true,
          env: expect.objectContaining({
            CLAUDE_AGENT_SDK_CLIENT_APP: "omi-test/1.0.0",
            ANTHROPIC_API_KEY: "test-key",
          }),
          mcpServers: expect.objectContaining({
            omi: expect.any(Object),
          }),
        }),
      }),
    );
    expect(onSdkMessage).toHaveBeenCalledTimes(2);
    expect(result.structuredOutput).toEqual({ status: "ok" });
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
