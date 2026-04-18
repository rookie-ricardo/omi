import { describe, expect, it } from "vitest";
import type { Message } from "@mariozechner/pi-ai";

import { buildSingleTurnPrompt } from "../../src/runtimes/runtime-utils";

interface FallbackPromptEnvelope {
  format: string;
  history: Array<Record<string, unknown>>;
  currentUserMessage: string;
}

function parseFallbackPrompt(rawPrompt: string): FallbackPromptEnvelope {
  return JSON.parse(rawPrompt) as FallbackPromptEnvelope;
}

describe("runtime-utils", () => {
  it("serializes fallback prompt as a stable JSON envelope with normalized history records", () => {
    const historyMessages = [
      {
        role: "user",
        content: [
          { type: "text", text: "show chart" },
          { type: "image", mimeType: "image/png", data: "image-bytes" },
        ],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "running analysis" },
          { type: "thinking", thinking: "inspect columns" },
          { type: "toolCall", id: "call_1", name: "python", arguments: { code: "print(1)" } },
        ],
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "python",
        isError: true,
        details: { exitCode: 1 },
        content: [
          { type: "text", text: "1\n" },
          { type: "image", mimeType: "image/png", data: "plot-bytes" },
        ],
        timestamp: 3,
      },
    ] as Message[];

    const envelope = parseFallbackPrompt(buildSingleTurnPrompt("what next", historyMessages));
    expect(envelope).toEqual({
      format: "omi-history-v1",
      history: [
        {
          role: "user",
          content: [
            { type: "text", text: "show chart" },
            { type: "image", mimeType: "image/png" },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "running analysis" },
            { type: "thinking", text: "inspect columns" },
            { type: "tool_call", id: "call_1", name: "python", arguments: { code: "print(1)" } },
          ],
        },
        {
          role: "tool_result",
          toolCallId: "call_1",
          toolName: "python",
          isError: true,
          output: "1\n[image]",
          details: { exitCode: 1 },
        },
      ],
      currentUserMessage: "what next",
    });
  });

  it("keeps fallback envelope schema when history is empty", () => {
    const envelope = parseFallbackPrompt(buildSingleTurnPrompt("hello", []));
    expect(envelope).toEqual({
      format: "omi-history-v1",
      history: [],
      currentUserMessage: "hello",
    });
  });

  it("normalizes blank prompt in fallback envelope", () => {
    const envelope = parseFallbackPrompt(buildSingleTurnPrompt("   ", []));
    expect(envelope).toEqual({
      format: "omi-history-v1",
      history: [],
      currentUserMessage: "",
    });
  });
});
