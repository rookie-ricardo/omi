import { describe, expect, it, vi } from "vitest";

import type { ProviderConfig, OmiTool } from "@omi/core";

import { VercelAiSdkProvider } from "../../src/runtimes/vercel-ai-sdk-provider";

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "provider_1",
    name: "OpenAI",
    type: "openai",
    protocol: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "gpt-4.1-mini",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTool(name: string): OmiTool {
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
    } as any,
    execute: async () => ({
      content: [{ type: "text", text: "ok" }],
      details: {},
    }),
  };
}

describe("VercelAiSdkProvider", () => {
  it("streams text and returns tool calls from ai sdk", async () => {
    const onTextDelta = vi.fn();

    const provider = new VercelAiSdkProvider({
      createOpenAI: vi.fn(() => vi.fn((modelId: string) => ({ modelId })) as any),
      streamText: vi.fn(() => ({
        textStream: (async function* () {
          yield "hel";
          yield "lo";
        })(),
        toolCalls: Promise.resolve([
          {
            toolCallId: "tool_1",
            toolName: "bash",
            input: { query: "ls -la" },
          },
        ]),
        finishReason: Promise.resolve("tool-calls"),
        usage: Promise.resolve({
          inputTokens: 12,
          outputTokens: 34,
          inputTokenDetails: {
            cacheReadTokens: 5,
            cacheWriteTokens: 7,
          },
        }),
      }) as any),
    });

    const result = await provider.run({
      runId: "run_1",
      sessionId: "session_1",
      workspaceRoot: "/workspace",
      prompt: "list files",
      historyMessages: [],
      providerConfig: makeConfig(),
      tools: [makeTool("bash")],
      enabledTools: ["bash"],
      onTextDelta,
    });

    expect(result.assistantText).toBe("hello");
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toEqual([
      {
        id: "tool_1",
        name: "bash",
        input: { query: "ls -la" },
      },
    ]);
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 34,
      cacheReadTokens: 5,
      cacheCreationTokens: 7,
    });
    expect(result.error).toBeNull();
    expect(onTextDelta).toHaveBeenCalledTimes(2);
  });

  it("supports cancellation", async () => {
    const provider = new VercelAiSdkProvider({
      createOpenAI: vi.fn(() => vi.fn((modelId: string) => ({ modelId })) as any),
      streamText: vi.fn(({ abortSignal }) => ({
        textStream: (async function* () {
          await new Promise((_resolve, reject) => {
            abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        })(),
        toolCalls: Promise.resolve([]),
        finishReason: Promise.resolve("error"),
        usage: Promise.resolve({
          inputTokens: 0,
          outputTokens: 0,
          inputTokenDetails: {},
        }),
      }) as any),
    });

    const pending = provider.run({
      runId: "run_2",
      sessionId: "session_1",
      workspaceRoot: "/workspace",
      prompt: "cancel me",
      historyMessages: [],
      providerConfig: makeConfig(),
      tools: [makeTool("bash")],
      enabledTools: ["bash"],
    });

    provider.cancel("run_2");
    const result = await pending;

    expect(result.stopReason).toBe("error");
    expect(result.error).toContain("aborted");
  });
});

