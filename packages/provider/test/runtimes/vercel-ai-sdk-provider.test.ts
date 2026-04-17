import { describe, expect, it, vi } from "vitest";

import type { ProviderConfig, OmiTool } from "@omi/core";

import { VercelAiSdkProvider } from "../../src/runtimes/vercel-ai-sdk-provider";

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "provider_1",
    name: "openai",
    protocol: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "gpt-4.1-mini",
    url: "",
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
  it("runs native sdk loop with tool execute callbacks", async () => {
    const onTextDelta = vi.fn();
    const lifecycleStages: string[] = [];
    const streamTextSpy = vi.fn((options: any) => ({
      textStream: (async function* () {
        await options.tools.bash.execute({ query: "ls -la" });
        yield "hel";
        yield "lo";
      })(),
      toolCalls: Promise.resolve([]),
      finishReason: Promise.resolve("tool-calls"),
      usage: Promise.resolve({
        inputTokens: 12,
        outputTokens: 34,
        inputTokenDetails: {
          cacheReadTokens: 5,
          cacheWriteTokens: 7,
        },
      }),
    }) as any);

    const provider = new VercelAiSdkProvider({
      createOpenAI: vi.fn(() => vi.fn((modelId: string) => ({ modelId })) as any),
      streamText: streamTextSpy,
    });

    const result = await provider.run({
      runId: "run_1",
      sessionId: "session_1",
      workspaceRoot: "/workspace",
      prompt: "list files",
      historyMessages: [
        {
          role: "user",
          content: [{ type: "text", text: "previous context" }],
          timestamp: 1,
        },
      ],
      providerConfig: makeConfig(),
      tools: [makeTool("bash")],
      enabledTools: ["bash"],
      onToolLifecycle: async (event) => {
        lifecycleStages.push(event.stage);
        if (event.stage === "requested") {
          return { allowExecution: true, requiresApproval: false };
        }
        return {};
      },
      onTextDelta,
    });

    expect(result.assistantText).toBe("hello");
    expect(result.stopReason).toBe("error");
    expect(result.error).toContain("tool-calls");
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 34,
      cacheReadTokens: 5,
      cacheCreationTokens: 7,
    });
    expect(lifecycleStages).toEqual(["requested", "started", "finished"]);
    expect(onTextDelta).toHaveBeenCalledTimes(2);
    expect(streamTextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: "previous context",
          }),
          expect.objectContaining({
            role: "user",
            content: "list files",
          }),
        ]),
      }),
    );
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
