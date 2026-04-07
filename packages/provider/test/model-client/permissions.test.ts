import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig, OmiTool } from "@omi/core";
import { PiAiModelClient } from "../../src/model-client/pi-ai-client";

const mockStream = vi.fn();

vi.mock("@mariozechner/pi-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mariozechner/pi-ai")>();
  return {
    ...actual,
    streamSimple: (...args: any[]) => mockStream(...args),
  };
});

describe("PiAiModelClient tool loop", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("completes a run with no tools", async () => {
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
    expect(onTextDelta).toHaveBeenCalledWith("Hello");
  });

  it("executes a tool and continues the loop", async () => {
    const client = new PiAiModelClient();
    const config = makeProviderConfig();
    const toolExecute = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "tool result" }] });
    const tool: OmiTool = {
      name: "get_weather",
      description: "Get weather",
      parameters: {},
      execute: toolExecute,
    };

    let callCount = 0;
    mockStream.mockImplementation(() => {
      callCount++;
      return (async function* () {
        if (callCount === 1) {
          yield {
            type: "done",
            reason: "toolUse",
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "I will check the weather." },
                { type: "toolCall", id: "tc-1", name: "get_weather", arguments: { city: "London" } }
              ],
              usage: { input: 10, output: 5 },
            },
          };
        } else {
          yield {
            type: "text_delta",
            delta: "It's sunny.",
          };
          yield {
            type: "done",
            reason: "stop",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "It's sunny." }],
              usage: { input: 20, output: 5 },
            },
          };
        }
      })();
    });

    const onToolCallStart = vi.fn();
    const onToolResult = vi.fn();

    const result = await client.run(
      {
        runId: "run_2",
        sessionId: "session_1",
        prompt: "what's the weather?",
        historyMessages: [],
        providerConfig: config,
        tools: [tool],
      },
      { onToolCallStart, onToolResult },
    );

    expect(toolExecute).toHaveBeenCalled();
    expect(onToolCallStart).toHaveBeenCalled();
    expect(onToolResult).toHaveBeenCalled();
    expect(callCount).toBe(2); // Initial turn + following tool result
    expect(result.assistantText).toContain(" sunny");
  });

  it("blocks tool execution via preflightToolCheck", async () => {
    const client = new PiAiModelClient();
    const config = makeProviderConfig();
    const toolExecute = vi.fn();
    const tool: OmiTool = {
      name: "unsafe_tool",
      description: "Unsafe",
      parameters: {},
      execute: toolExecute,
    };

    mockStream.mockReturnValue((async function* () {
      yield {
        type: "done",
        reason: "toolUse",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "tc-1", name: "unsafe_tool", arguments: {} }],
          usage: { input: 10, output: 5 },
        },
      };
    })());

    const onToolResult = vi.fn();
    await client.run(
      {
        runId: "run_3",
        sessionId: "session_1",
        prompt: "run unsafe",
        historyMessages: [],
        providerConfig: config,
        tools: [tool],
        preflightToolCheck: async () => ({ decision: "deny", reason: "Blocked" }),
      },
      { onToolResult },
    );

    expect(toolExecute).not.toHaveBeenCalled();
    expect(onToolResult).toHaveBeenCalledWith(
        expect.any(String),
        "unsafe_tool",
        { error: "Blocked" },
        true
    );
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

