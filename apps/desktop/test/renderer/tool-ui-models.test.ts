import { describe, expect, it } from "vitest";

import type { ToolCall } from "@omi/core";

import {
  buildRunEventDisplayModel,
  normalizeToolCallViewModel,
} from "../../src/renderer/components/tool-ui/models";

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: overrides.id ?? "tool_1",
    runId: overrides.runId ?? "run_1",
    sessionId: overrides.sessionId ?? "session_1",
    taskId: overrides.taskId ?? null,
    toolName: overrides.toolName ?? "bash",
    approvalState: overrides.approvalState ?? "not_required",
    input: overrides.input ?? {},
    output: overrides.output ?? null,
    error: overrides.error ?? null,
    createdAt: overrides.createdAt ?? "2026-04-17T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-17T00:00:02.000Z",
  };
}

describe("tool-ui models", () => {
  it("maps bash tool call to terminal view model", () => {
    const toolCall = createToolCall({
      toolName: "bash",
      input: { command: "pnpm test" },
      output: {
        content: [{ type: "text", text: "all tests passed" }],
        details: { exitCode: 0, cwd: "/repo" },
      },
    });

    const viewModel = normalizeToolCallViewModel(toolCall, {
      activeToolIds: new Set<string>(),
    });

    expect(viewModel.kind).toBe("terminal");
    expect(viewModel.status).toBe("completed");
    expect(viewModel.command).toBe("pnpm test");
    expect(viewModel.exitCode).toBe(0);
    expect(viewModel.stdout).toContain("all tests passed");
  });

  it("marks pending approval as requires_action", () => {
    const toolCall = createToolCall({
      id: "tool_2",
      approvalState: "pending",
      toolName: "read",
    });

    const viewModel = normalizeToolCallViewModel(toolCall, {
      activeToolIds: new Set<string>(),
    });

    expect(viewModel.status).toBe("requires_action");
  });

  it("marks active tool call as running", () => {
    const toolCall = createToolCall({ id: "tool_3", toolName: "glob" });

    const viewModel = normalizeToolCallViewModel(toolCall, {
      activeToolIds: new Set(["tool_3"]),
    });

    expect(viewModel.status).toBe("running");
  });

  it("maps edit tool call to code diff", () => {
    const toolCall = createToolCall({
      id: "tool_4",
      toolName: "edit",
      input: { path: "src/app.ts" },
      output: {
        details: {
          diff: "@@ -1,1 +1,1 @@\n-foo\n+bar",
        },
      },
    });

    const viewModel = normalizeToolCallViewModel(toolCall, {
      activeToolIds: new Set<string>(),
    });

    expect(viewModel.kind).toBe("code-diff");
    expect(viewModel.diff).toContain("+bar");
    expect(viewModel.filePath).toBe("src/app.ts");
  });

  it("handles malformed tool output without throwing", () => {
    const toolCall = createToolCall({
      id: "tool_5",
      toolName: "unknown_tool",
      output: { nested: { value: 1 } },
    });

    const viewModel = normalizeToolCallViewModel(toolCall, {
      activeToolIds: new Set<string>(),
    });

    expect(viewModel.kind).toBe("generic");
    expect(viewModel.outputPreview).toContain("nested");
  });

  it("marks truncated outputs for long-running tools", () => {
    const toolCall = createToolCall({
      id: "tool_6",
      toolName: "bash",
      output: {
        content: [{ type: "text", text: "tail output" }],
        details: { truncation: { totalLines: 400 } },
      },
    });

    const viewModel = normalizeToolCallViewModel(toolCall, {
      activeToolIds: new Set<string>(),
    });

    expect(viewModel.outputTruncated).toBe(true);
  });

  it("builds failed run display model when latest run has runtime error", () => {
    const toolCall = createToolCall({
      id: "tool_7",
      runId: "run_failed",
      toolName: "bash",
      output: { content: [{ type: "text", text: "partial" }] },
    });

    const runModel = buildRunEventDisplayModel({
      runId: "run_failed",
      toolCalls: [toolCall],
      activeToolIds: new Set<string>(),
      activeRunId: null,
      assistantCreatedAt: null,
      runErrorMessage: "runtime exploded",
      isLatestRun: true,
    });

    expect(runModel.status).toBe("failed");
    expect(runModel.steps.at(-1)?.status).toBe("failed");
  });

  it("builds canceled run display model when approvals are rejected", () => {
    const runModel = buildRunEventDisplayModel({
      runId: "run_canceled",
      toolCalls: [
        createToolCall({ id: "tool_8", runId: "run_canceled", approvalState: "rejected" }),
        createToolCall({ id: "tool_9", runId: "run_canceled", approvalState: "rejected" }),
      ],
      activeToolIds: new Set<string>(),
      activeRunId: null,
      assistantCreatedAt: null,
      runErrorMessage: null,
      isLatestRun: false,
    });

    expect(runModel.status).toBe("canceled");
  });

  it("builds canceled run display model for interrupted tool output", () => {
    const runModel = buildRunEventDisplayModel({
      runId: "run_interrupted",
      toolCalls: [
        createToolCall({
          id: "tool_10",
          runId: "run_interrupted",
          approvalState: "not_required",
          output: null,
          error: null,
        }),
      ],
      activeToolIds: new Set<string>(),
      activeRunId: null,
      assistantCreatedAt: null,
      runErrorMessage: null,
      isLatestRun: true,
    });

    expect(runModel.status).toBe("canceled");
    expect(runModel.toolCalls[0]?.status).toBe("canceled");
  });
});
