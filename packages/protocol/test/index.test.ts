import { describe, expect, it } from "vitest";

import {
  parseCommand,
  parseResult,
  type RunnerCommandName,
  type RunnerResultName,
} from "../src/index";

describe("protocol command parsing", () => {
  it("parses supported command payloads", () => {
    expect(parseCommand("session.create", { title: "Thread" })).toEqual({ title: "Thread" });
    expect(parseCommand("run.start", {
      sessionId: "session_1",
      taskId: null,
      prompt: "hello",
      contextFiles: ["README.md"],
    })).toEqual({
      sessionId: "session_1",
      taskId: null,
      prompt: "hello",
      contextFiles: ["README.md"],
    });

    expect(parseCommand("provider.config.save", {
      name: "Claude",
      protocol: "anthropic-messages",
      baseUrl: "",
      model: "claude-sonnet-4-5",
      apiKey: "key",
      url: "",
    })).toMatchObject({
      name: "Claude",
      protocol: "anthropic-messages",
      model: "claude-sonnet-4-5",
    });
  });

  it("rejects unsupported command names", () => {
    expect(() => parseCommand("session.compact" as RunnerCommandName, { sessionId: "session_1" })).toThrow(
      /Unsupported command/,
    );
  });
});

describe("protocol result parsing", () => {
  it("parses supported result payloads", () => {
    const runtime = parseResult("session.runtime.get", {
      sessionId: "session_1",
      runtime: {
        version: 1,
        sessionId: "session_1",
        activeRunId: null,
        activeBranchId: null,
        pendingRunIds: [],
        queuedRuns: [],
        blockedRunId: null,
        blockedToolCallId: null,
        pendingApprovalToolCallIds: [],
        interruptedRunIds: [],
        selectedProviderConfigId: null,
        lastUserPrompt: null,
        lastAssistantResponse: null,
        lastActivityAt: "2026-01-01T00:00:00.000Z",
        compaction: {
          status: "idle",
          reason: null,
          requestedAt: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
          lastSummary: null,
          lastCompactedAt: null,
          error: null,
        },
      },
    });

    expect(runtime.sessionId).toBe("session_1");

    const runState = parseResult("run.state.get", {
      run: {
        id: "run_1",
        sessionId: "session_1",
        taskId: null,
        status: "running",
        provider: "anthropic",
        prompt: "hello",
        sourceRunId: null,
        recoveryMode: "start",
        originRunId: null,
        resumeFromCheckpoint: null,
        terminalReason: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      checkpoints: [],
    });

    expect(runState.run.id).toBe("run_1");
  });

  it("rejects unsupported result names", () => {
    expect(() => parseResult("session.compact" as RunnerResultName, {})).toThrow(
      /Unsupported result method/,
    );
  });
});
