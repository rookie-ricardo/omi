import { describe, expect, it } from "vitest";
import type { Message } from "@mariozechner/pi-ai";

import { buildModelMessages, buildSingleTurnPrompt } from "../../src/runtimes/runtime-utils";

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

  it("does not append a trailing user turn for blank prompt in structured messages", () => {
    const modelMessages = buildModelMessages("   ", []);
    expect(modelMessages).toEqual([]);
  });

  it("maps runtime history messages into structured model messages", () => {
    const historyMessages = [
      {
        role: "user",
        content: [{ type: "text", text: "previous question" }],
        timestamp: 1,
      },
      {
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          { type: "image", mimeType: "image/jpeg", data: "img-data" },
        ],
        timestamp: 2,
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "working on it" },
          { type: "thinking", thinking: "make plan" },
          { type: "toolCall", id: "call_2", name: "bash", arguments: { cmd: "ls" } },
        ],
        timestamp: 3,
      },
      {
        role: "toolResult",
        toolCallId: "call_2",
        toolName: "bash",
        isError: false,
        content: [{ type: "text", text: "file-a\nfile-b" }],
        timestamp: 4,
      },
      {
        role: "toolResult",
        toolCallId: "call_3",
        toolName: "vision",
        isError: true,
        details: { score: 0.9 },
        content: [
          { type: "text", text: "caption" },
          { type: "image", mimeType: "image/png", data: "image-data" },
        ],
        timestamp: 5,
      },
      {
        role: "toolResult",
        toolCallId: "call_4",
        toolName: "bash",
        isError: true,
        content: [{ type: "text", text: "permission denied" }],
        timestamp: 6,
      },
    ] as Message[];

    const modelMessages = buildModelMessages("final prompt", historyMessages);
    expect(modelMessages).toEqual([
      {
        role: "user",
        content: "previous question",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          { type: "image", image: "img-data", mediaType: "image/jpeg" },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "working on it" },
          { type: "reasoning", text: "make plan" },
          { type: "tool-call", toolCallId: "call_2", toolName: "bash", input: { cmd: "ls" } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_2",
            toolName: "bash",
            output: { type: "text", value: "file-a\nfile-b" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_3",
            toolName: "vision",
            output: {
              type: "json",
              value: {
                outputText: "caption[image]",
                hasNonTextContent: true,
                details: { score: 0.9 },
                isError: true,
              },
            },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_4",
            toolName: "bash",
            output: {
              type: "json",
              value: {
                outputText: "permission denied",
                hasNonTextContent: false,
                details: null,
                isError: true,
              },
            },
          },
        ],
      },
      {
        role: "user",
        content: "final prompt",
      },
    ]);
  });
});
