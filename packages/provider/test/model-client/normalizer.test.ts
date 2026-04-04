import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@mariozechner/pi-agent-core";

import { classifyPiAiError, normalizeEvent } from "../../src/model-client/normalizer";
import type { NormalizationContext } from "../../src/model-client/normalizer";

describe("normalizeEvent", () => {
  it("normalizes assistant text deltas to assistant_delta events", () => {
    const events = normalizeEvent(
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "hello",
        },
      } as unknown as AgentEvent,
      createContext(),
    );

    expect(events).toEqual([
      {
        type: "assistant_delta",
        delta: "hello",
      },
    ]);
  });

  it("normalizes tool execution updates to update events", () => {
    const context = createContext();
    context.toolCallIdMap.set("evt-1", "run-1:tool:1");

    const events = normalizeEvent(
      {
        type: "tool_execution_update",
        id: "evt-1",
        toolCallId: "run-1:tool:1",
        toolName: "bash",
        partialResult: { chunk: "partial" },
        args: {},
      } as unknown as AgentEvent,
      context,
    );

    expect(events).toEqual([
      {
        type: "update",
        toolCallId: "run-1:tool:1",
        toolName: "bash",
        delta: JSON.stringify({ chunk: "partial" }),
        partialResult: { chunk: "partial" },
      },
    ]);
  });

  it("uses event-level ids so same-name tools do not collide", () => {
    const context = createContext();
    const first = normalizeEvent(
      {
        type: "tool_execution_update",
        id: "evt-a",
        toolName: "bash",
        partialResult: { chunk: "a" },
      } as unknown as AgentEvent,
      context,
    );
    const second = normalizeEvent(
      {
        type: "tool_execution_update",
        id: "evt-b",
        toolName: "bash",
        partialResult: { chunk: "b" },
      } as unknown as AgentEvent,
      context,
    );

    const firstId = (first[0] as { toolCallId?: string }).toolCallId;
    const secondId = (second[0] as { toolCallId?: string }).toolCallId;
    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    expect(firstId).not.toBe(secondId);
  });

  it("emits usage and complete events for the final message", () => {
    const events = normalizeEvent(
      {
        type: "message_end",
        message: {
          role: "assistant",
          provider: "openai",
          api: "openai-responses",
          model: "gpt-4.1-mini",
          timestamp: Date.now(),
          stop_reason: "end_turn",
          usage: {
            input_tokens: 10,
            output_tokens: 4,
            cache_read_input_tokens: 2,
            cache_creation_input_tokens: 1,
          },
          content: [
            { type: "text", text: "done" },
          ],
        },
      } as unknown as AgentEvent,
      createContext(),
    );

    expect(events[0]).toMatchObject({
      type: "usage",
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 2,
        cacheCreationTokens: 1,
      },
    });
    expect(events[1]).toMatchObject({
      type: "complete",
      stopReason: "end_turn",
      assistantText: "done",
      usage: {
        inputTokens: 10,
        outputTokens: 4,
      },
    });
  });
});

describe("classifyPiAiError", () => {
  it("classifies by structured status code before message fallback", () => {
    expect(classifyPiAiError({ statusCode: 429, message: "something else" })).toBe("rate_limit");
    expect(classifyPiAiError({ response: { status: 503 }, message: "unexpected" })).toBe("network");
  });

  it("classifies by structured error code", () => {
    expect(classifyPiAiError({ code: "invalid_api_key", message: "oops" })).toBe("auth");
    expect(classifyPiAiError({ code: "ECONNRESET", message: "oops" })).toBe("network");
  });

  it("falls back to message classification when no structured fields are present", () => {
    expect(classifyPiAiError("429 Too Many Requests")).toBe("rate_limit");
    expect(classifyPiAiError({ message: "max output tokens reached" })).toBe("max_output");
  });
});

function createContext(): NormalizationContext {
  return {
    runId: "run-1",
    sessionId: "session-1",
    toolCallIdMap: new Map(),
    messageIdCounter: 0,
  };
}
