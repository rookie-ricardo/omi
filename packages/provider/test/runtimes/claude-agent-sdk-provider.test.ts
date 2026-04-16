import { describe, expect, it, vi } from "vitest";

import type { ProviderConfig } from "@omi/core";

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

describe("ClaudeAgentSdkProvider", () => {
  it("captures tool requests via canUseTool and maps them to provider tool calls", async () => {
    const onTextDelta = vi.fn();
    const querySpy = vi.fn(async function* ({ options }: any) {
      await options.canUseTool?.(
        "Bash",
        { command: "ls -la" },
        {
          signal: new AbortController().signal,
          toolUseID: "tool_1",
        },
      );

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
    });

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
      enabledTools: ["bash"],
      onTextDelta,
    });

    expect(result.assistantText).toBe("Working...");
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toEqual([
      {
        id: "tool_1",
        name: "bash",
        input: { command: "ls -la" },
      },
    ]);
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 2,
      cacheCreationTokens: 3,
    });
    expect(result.error).toBeNull();
    expect(onTextDelta).toHaveBeenCalledWith("Working...");
    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("user: previous context"),
      }),
    );
  });

  it("returns error when sdk yields non-success result", async () => {
    const provider = new ClaudeAgentSdkProvider({
      query: (async function* () {
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
      }) as any,
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
    expect(result.toolCalls).toEqual([]);
  });
});
