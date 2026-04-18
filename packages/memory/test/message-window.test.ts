import { describe, expect, it } from "vitest";

import type { SessionMessage, ToolCall } from "@omi/core";

import {
  buildSessionRuntimeMessages,
  listRetainedSessionMessages,
  listRetainedToolCalls,
} from "../src/messages";

describe("summary window", () => {
  it("keeps only the latest summary and later messages for runtime rebuild", () => {
    const messages: SessionMessage[] = [
      createMessage({
        id: "msg_old_user",
        role: "user",
        messageType: "text",
        content: "old user",
        createdAt: "2026-04-19T10:00:00.000Z",
      }),
      createMessage({
        id: "msg_old_assistant",
        role: "assistant",
        messageType: "text",
        content: "old assistant",
        createdAt: "2026-04-19T10:01:00.000Z",
      }),
      createMessage({
        id: "msg_summary",
        role: "assistant",
        messageType: "summary",
        content: "summary",
        createdAt: "2026-04-19T10:02:00.000Z",
        compressedFromMessageId: "msg_old_user",
      }),
      createMessage({
        id: "msg_new_user",
        role: "user",
        messageType: "text",
        content: "new user",
        createdAt: "2026-04-19T10:03:00.000Z",
      }),
      createMessage({
        id: "msg_tool_call",
        role: "tool",
        messageType: "tool_call",
        content: "{\"cmd\":\"rg --files\"}",
        parentMessageId: "msg_new_user",
        createdAt: "2026-04-19T10:04:00.000Z",
      }),
      createMessage({
        id: "msg_new_assistant",
        role: "assistant",
        messageType: "text",
        content: "new assistant",
        parentMessageId: "msg_new_user",
        createdAt: "2026-04-19T10:05:00.000Z",
      }),
    ];
    const toolCalls: ToolCall[] = [
      createToolCall({
        id: "tool_old",
        messageId: "msg_old_assistant",
        createdAt: "2026-04-19T10:01:30.000Z",
      }),
      createToolCall({
        id: "tool_new",
        messageId: "msg_tool_call",
        createdAt: "2026-04-19T10:04:30.000Z",
      }),
    ];

    const retainedMessages = listRetainedSessionMessages(messages);
    const retainedToolCalls = listRetainedToolCalls(toolCalls, retainedMessages);
    const runtimeMessages = buildSessionRuntimeMessages({
      messages,
      toolCalls,
      compaction: null,
    });

    expect(retainedMessages.map((message) => message.id)).toEqual([
      "msg_summary",
      "msg_new_user",
      "msg_tool_call",
      "msg_new_assistant",
    ]);
    expect(retainedToolCalls.map((toolCall) => toolCall.id)).toEqual(["tool_new"]);
    expect(runtimeMessages.map((message) => message.role)).toEqual([
      "assistantTranscript",
      "user",
      "runtimeToolOutput",
      "assistantTranscript",
    ]);
  });
});

function createMessage(input: {
  id: string;
  role: SessionMessage["role"];
  messageType: SessionMessage["messageType"];
  content: string;
  createdAt: string;
  parentMessageId?: string | null;
  compressedFromMessageId?: string | null;
}): SessionMessage {
  return {
    id: input.id,
    sessionId: "session_1",
    taskId: null,
    parentMessageId: input.parentMessageId ?? null,
    role: input.role,
    messageType: input.messageType,
    content: input.content,
    model: "gpt-5.4",
    tokens: 1,
    totalTokens: 1,
    compressedFromMessageId: input.compressedFromMessageId ?? null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

function createToolCall(input: {
  id: string;
  messageId: string;
  createdAt: string;
}): ToolCall {
  return {
    id: input.id,
    messageId: input.messageId,
    sessionId: "session_1",
    toolName: "exec_command",
    approvalState: "not_required",
    input: { cmd: "rg --files" },
    output: { stdout: "a.ts" },
    error: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}
