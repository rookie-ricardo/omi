import { describe, expect, it } from "vitest";

import type { ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import type { SessionHistoryEntry, SessionMessage, ToolCall } from "@omi/core";

import {
  buildBranchRuntimeMessages,
  buildSessionRuntimeMessages,
  assistantMessageToText,
  convertRuntimeMessagesToLlm,
  createRuntimeBranchSummaryMessage,
  createRuntimeCustomMessage,
  createRuntimeCompactionSummaryMessage,
  createRuntimeToolOutputMessage,
  type RuntimeMessage,
  type CompactionSummaryDocument,
} from "../src/messages";

describe("messages", () => {
  it("passes through llm-compatible runtime messages", () => {
    const messages: RuntimeMessage[] = [
      makeUserMessage("hello"),
      makeToolResultMessage("tool_1", "read"),
    ];

    expect(convertRuntimeMessagesToLlm(messages)).toEqual(messages);
  });

  it("converts assistant transcript messages into user prompts", () => {
    expect(
      convertRuntimeMessagesToLlm([
        {
          role: "assistantTranscript",
          content: "done",
          timestamp: 2,
        },
      ]),
    ).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "assistant: done" }],
        timestamp: 2,
      },
    ]);
  });

  it("normalizes custom runtime messages into user messages", () => {
    const prompt = createRuntimeCustomMessage("hint", "Use a small diff.", true, { source: "test" }, 123);

    expect(convertRuntimeMessagesToLlm([prompt])).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Use a small diff." }],
        timestamp: 123,
      },
    ]);
  });

  it("normalizes runtime tool output into toolResult messages", () => {
    const toolOutput = createRuntimeToolOutputMessage(
      "tool_1",
      "bash",
      [{ type: "text", text: "ok" }],
      false,
      { exitCode: 0 },
      456,
    );

    expect(convertRuntimeMessagesToLlm([toolOutput])).toEqual([
      {
        role: "toolResult",
        toolCallId: "tool_1",
        toolName: "bash",
        content: [{ type: "text", text: "ok" }],
        details: { exitCode: 0 },
        isError: false,
        timestamp: 456,
      },
    ]);
  });

  it("builds compacted session history with summary and recent runtime messages", () => {
    const messages: SessionMessage[] = [
      makeSessionMessage("msg_1", "user", "old user", "2025-03-30T00:00:00.000Z"),
      makeSessionMessage("msg_2", "assistant", "old assistant", "2025-03-30T00:00:01.000Z"),
      makeSessionMessage("msg_3", "user", "recent user", "2025-03-30T00:00:04.000Z"),
      makeSessionMessage("msg_4", "assistant", "recent assistant", "2025-03-30T00:00:05.000Z"),
    ];
    const toolCalls: ToolCall[] = [
      makeToolCall("tool_1", "read", "2025-03-30T00:00:02.000Z", { path: "src/old.ts" }, null),
      makeToolCall("tool_2", "write", "2025-03-30T00:00:06.000Z", { path: "src/new.ts" }, { ok: true }),
    ];

    const runtime = buildSessionRuntimeMessages({
      messages,
      toolCalls,
      compaction: {
        version: 1,
        summary: makeCompactionSummaryDocument("Compacted history summary"),
        compactedAt: "2025-03-30T00:00:03.000Z",
        firstKeptHistoryEntryId: null,
        firstKeptTimestamp: "2025-03-30T00:00:03.000Z",
        tokensBefore: 0,
        tokensKept: 0,
      },
    });

    expect(runtime[0]).toMatchObject({
      role: "compactionSummary",
      summary: makeCompactionSummaryDocument("Compacted history summary"),
    });
    expect(runtime.some((message) => "content" in message && message.role === "user" && message.content === "old user")).toBe(false);
    expect(
      runtime.some(
        (message) =>
          "content" in message &&
          message.role === "assistantTranscript" &&
          message.content === "old assistant",
      ),
    ).toBe(false);
    expect(runtime.some((message) => message.role === "user" && message.timestamp === Date.parse("2025-03-30T00:00:04.000Z"))).toBe(true);
    expect(runtime.some((message) => message.role === "runtimeToolOutput" && message.toolCallId === "tool_2")).toBe(true);
  });

  it("creates a compaction summary runtime message", () => {
    const summary = createRuntimeCompactionSummaryMessage(
      makeCompactionSummaryDocument("Summarized context"),
      123,
    );

    expect(convertRuntimeMessagesToLlm([summary])).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
              text:
                "The conversation history before this point was compacted into the following summary:\n\n<summary>\n{\n  \"version\": 1,\n  \"goal\": \"Summarized context\",\n  \"constraints\": [],\n  \"progress\": {\n    \"done\": [],\n    \"inProgress\": [],\n    \"blocked\": []\n  },\n  \"keyDecisions\": [],\n  \"nextSteps\": [],\n  \"criticalContext\": []\n}\n</summary>",
          },
        ],
        timestamp: 123,
      },
    ]);
  });

  it("creates a branch summary runtime message", () => {
    const summary = createRuntimeBranchSummaryMessage("Branch checkpoint", undefined, 321);

    expect(convertRuntimeMessagesToLlm([summary])).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "The branch history before this point was summarized as:\n\n<summary>\nBranch checkpoint\n</summary>",
          },
        ],
        timestamp: 321,
      },
    ]);
  });

  it("reconstructs branch-local runtime history from explicit lineage", () => {
    const messages: SessionMessage[] = [
      makeSessionMessage("msg_root_user", "user", "root user", "2025-03-30T00:00:00.000Z"),
      makeSessionMessage(
        "msg_root_assistant",
        "assistant",
        "root assistant",
        "2025-03-30T00:00:01.000Z",
      ),
      makeSessionMessage("msg_branch_a_user", "user", "branch a user", "2025-03-30T00:00:03.000Z"),
      makeSessionMessage(
        "msg_branch_a_assistant",
        "assistant",
        "branch a assistant",
        "2025-03-30T00:00:04.000Z",
      ),
      makeSessionMessage("msg_branch_b_user", "user", "branch b user", "2025-03-30T00:00:05.000Z"),
      makeSessionMessage(
        "msg_branch_b_assistant",
        "assistant",
        "branch b assistant",
        "2025-03-30T00:00:06.000Z",
      ),
    ];

    const historyEntries: SessionHistoryEntry[] = [
      makeHistoryEntry("hist_root_user", null, "message", "msg_root_user", null, "2025-03-30T00:00:00.000Z"),
      makeHistoryEntry(
        "hist_root_assistant",
        "hist_root_user",
        "message",
        "msg_root_assistant",
        null,
        "2025-03-30T00:00:01.000Z",
      ),
      makeHistoryEntry(
        "hist_branch_a_summary",
        "hist_root_assistant",
        "branch_summary",
        null,
        "Branch A summary",
        "2025-03-30T00:00:02.000Z",
      ),
      makeHistoryEntry(
        "hist_branch_a_user",
        "hist_branch_a_summary",
        "message",
        "msg_branch_a_user",
        null,
        "2025-03-30T00:00:03.000Z",
      ),
      makeHistoryEntry(
        "hist_branch_a_assistant",
        "hist_branch_a_user",
        "message",
        "msg_branch_a_assistant",
        null,
        "2025-03-30T00:00:04.000Z",
      ),
      makeHistoryEntry(
        "hist_branch_b_summary",
        "hist_root_assistant",
        "branch_summary",
        null,
        "Branch B summary",
        "2025-03-30T00:00:05.000Z",
      ),
      makeHistoryEntry(
        "hist_branch_b_user",
        "hist_branch_b_summary",
        "message",
        "msg_branch_b_user",
        null,
        "2025-03-30T00:00:05.500Z",
      ),
      makeHistoryEntry(
        "hist_branch_b_assistant",
        "hist_branch_b_user",
        "message",
        "msg_branch_b_assistant",
        null,
        "2025-03-30T00:00:06.000Z",
      ),
    ];

    const runtime = buildBranchRuntimeMessages({
      messages,
      toolCalls: [],
      compaction: null,
      historyEntries,
      branchLeafEntryId: "hist_branch_a_assistant",
    });

    expect(runtime).toEqual([
      expect.objectContaining({ role: "user", content: "root user" }),
      expect.objectContaining({ role: "assistantTranscript", content: "root assistant" }),
      expect.objectContaining({ role: "branchSummary", summary: "Branch A summary" }),
      expect.objectContaining({ role: "user", content: "branch a user" }),
      expect.objectContaining({ role: "assistantTranscript", content: "branch a assistant" }),
    ]);
    expect(runtime.some((message) => message.role === "branchSummary" && message.summary === "Branch B summary")).toBe(
      false,
    );
    expect(runtime.some((message) => message.role === "user" && "content" in message && message.content === "branch b user")).toBe(
      false,
    );
  });

  it("fails when an explicit branch leaf cannot be resolved", () => {
    const messages: SessionMessage[] = [
      makeSessionMessage("msg_root_user", "user", "root user", "2025-03-30T00:00:00.000Z"),
    ];

    expect(() =>
      buildBranchRuntimeMessages({
        messages,
        toolCalls: [],
        compaction: null,
        historyEntries: [],
        branchLeafEntryId: "missing_hist",
      }),
    ).toThrowError(/History entry missing_hist not found/);
  });

  it("extracts assistant text from mixed content", () => {
    expect(
      assistantMessageToText({
        role: "assistant",
        content: [
          { type: "thinking", thinking: "internal" },
          { type: "text", text: "first" },
          { type: "text", text: "second" },
        ],
        api: "openai-responses",
        provider: "openai",
        model: "gpt-4.1-mini",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: "stop",
        timestamp: 789,
      }),
    ).toBe("firstsecond");
  });
});

function makeUserMessage(content: string): UserMessage {
  return {
    role: "user",
    content,
    timestamp: 1,
  };
}

function makeToolResultMessage(toolCallId: string, toolName: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text: "result" }],
    details: { ok: true },
    isError: false,
    timestamp: 3,
  };
}

function makeSessionMessage(
  id: string,
  role: SessionMessage["role"],
  content: string,
  createdAt: string,
): SessionMessage {
  return {
    id,
    sessionId: "session_1",
    role,
    content,
    createdAt,
  };
}

function makeToolCall(
  id: string,
  toolName: string,
  createdAt: string,
  input: Record<string, unknown>,
  output: Record<string, unknown> | null,
): ToolCall {
  return {
    id,
    runId: "run_1",
    sessionId: "session_1",
    taskId: null,
    toolName,
    approvalState: output ? "approved" : "not_required",
    input,
    output,
    error: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function makeCompactionSummaryDocument(goal: string): CompactionSummaryDocument {
  return {
    version: 1,
    goal,
    constraints: [],
    progress: {
      done: [],
      inProgress: [],
      blocked: [],
    },
    keyDecisions: [],
    nextSteps: [],
    criticalContext: [],
  };
}

function makeHistoryEntry(
  id: string,
  parentId: string | null,
  kind: SessionHistoryEntry["kind"],
  messageId: string | null,
  summary: string | null,
  createdAt: string,
  originRunId: string | null = null,
  branchId: string | null = null,
  lineageDepth = 0,
): SessionHistoryEntry {
  return {
    id,
    sessionId: "session_1",
    parentId,
    originRunId,
    kind,
    messageId,
    summary,
    details: null,
    branchId,
    lineageDepth,
    createdAt,
    updatedAt: createdAt,
  };
}
