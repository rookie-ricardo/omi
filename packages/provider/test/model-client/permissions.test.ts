import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "@omi/core";
import { PiAiModelClient } from "../../src/model-client/pi-ai-client";

const mockStream = vi.fn();

vi.mock("@mariozechner/pi-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mariozechner/pi-ai")>();
  return {
    ...actual,
    streamSimple: (...args: any[]) => mockStream(...args),
  };
});

describe("PiAiModelClient single-turn", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("completes a single-turn run with no tools", async () => {
    const client = new PiAiModelClient();
    const config = makeProviderConfig();

    mockStream.mockReturnValue((async function* () {
      yield {
        type: "text_delta",
        delta: "Hello",
      };
      yield {
        type: "done",
        reason: "stop",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
          usage: { input: 10, output: 5 },
        },
      };
    })());

    const onTextDelta = vi.fn();
    const result = await client.run(
      {
        runId: "run_1",
        sessionId: "session_1",
        prompt: "test",
        historyMessages: [],
        providerConfig: config,
      },
      { onTextDelta },
    );

    expect(result.assistantText).toBe("Hello");
    expect(result.stopReason).toBe("end_turn");
    expect(result.toolCalls).toEqual([]);
    expect(result.error).toBeNull();
    expect(onTextDelta).toHaveBeenCalledWith("Hello");
  });

  it("passes provider apiKey into stream options", async () => {
    const client = new PiAiModelClient();
    const config = makeProviderConfig();

    mockStream.mockReturnValue((async function* () {
      yield {
        type: "done",
        reason: "stop",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          usage: { input: 1, output: 1 },
        },
      };
    })());

    await client.run(
      {
        runId: "run_api_key",
        sessionId: "session_1",
        prompt: "test",
        historyMessages: [],
        providerConfig: config,
      },
      {},
    );

    expect(mockStream).toHaveBeenCalled();
    expect(mockStream.mock.calls[0]?.[2]).toMatchObject({
      apiKey: "test-api-key",
    });
  });

  it("returns tool calls without executing them", async () => {
    const client = new PiAiModelClient();
    const config = makeProviderConfig();

    mockStream.mockReturnValue((async function* () {
      yield {
        type: "done",
        reason: "toolUse",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I will check the weather." },
            { type: "toolCall", id: "tc-1", name: "get_weather", arguments: { city: "London" } },
          ],
          usage: { input: 10, output: 5 },
        },
      };
    })());

    const result = await client.run(
      {
        runId: "run_2",
        sessionId: "session_1",
        prompt: "what's the weather?",
        historyMessages: [],
        providerConfig: config,
      },
      {},
    );

    // Provider now returns tool calls but does NOT execute them
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("get_weather");
    expect(result.toolCalls[0].input).toEqual({ city: "London" });
    expect(result.assistantText).toContain("check the weather");
  });

  it("handles stream errors", async () => {
    const client = new PiAiModelClient();
    const config = makeProviderConfig();

    mockStream.mockReturnValue((async function* () {
      yield {
        type: "error",
        error: {
          role: "assistant",
          errorMessage: "Rate limited",
          content: [],
          usage: { input: 0, output: 0 },
        },
      };
    })());

    const onError = vi.fn();
    const result = await client.run(
      {
        runId: "run_3",
        sessionId: "session_1",
        prompt: "test",
        historyMessages: [],
        providerConfig: config,
      },
      { onError },
    );

    expect(result.error).toBe("Rate limited");
    expect(result.stopReason).toBe("error");
    expect(onError).toHaveBeenCalled();
  });

  it("handles exceptions from stream", async () => {
    const client = new PiAiModelClient();
    const config = makeProviderConfig();

    mockStream.mockImplementation(() => {
      throw new Error("Network failure");
    });

    const onError = vi.fn();
    const result = await client.run(
      {
        runId: "run_4",
        sessionId: "session_1",
        prompt: "test",
        historyMessages: [],
        providerConfig: config,
      },
      { onError },
    );

    expect(result.error).toBe("Network failure");
    expect(result.stopReason).toBe("error");
  });
});

function makeProviderConfig(): ProviderConfig {
  const now = new Date().toISOString();
  return {
    id: "provider_1",
    name: "Test Provider",
    type: "anthropic",
    protocol: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    apiKey: "test-api-key",
    model: "claude-3-5-sonnet-20241022",
    createdAt: now,
    updatedAt: now,
  };
}
