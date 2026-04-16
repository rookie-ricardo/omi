import { describe, expect, it, vi } from "vitest";

import type { OmiTool, ProviderConfig } from "@omi/core";

import { ClaudeAgentSdkProvider } from "../../src/runtimes/claude-agent-sdk-provider";

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "provider_1",
    name: "Anthropic",
    type: "anthropic",
    protocol: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    apiKey: "test-key",
    model: "claude-sonnet-4-5",
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
    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("user: previous context"),
        options: expect.objectContaining({
          maxTurns: 20,
          tools: [],
          mcpServers: expect.objectContaining({
            omi: expect.any(Object),
          }),
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
});
