import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@mariozechner/pi-agent-core";

import { normalizeEvent } from "../../src/model-client/normalizer";
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
    context.toolCallIdMap.set("bash", "run-1:tool:1");

    const events = normalizeEvent(
      {
        type: "tool_execution_update",
        toolCallId: "run-1:tool:1",
        toolName: "bash",
        partialResult: { chunk: "partial" },
        args: {},
      } as AgentEvent,
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

function createContext(): NormalizationContext {
  return {
    runId: "run-1",
    sessionId: "session-1",
    toolCallIdMap: new Map(),
    messageIdCounter: 0,
  };
}
