import { describe, expect, it, vi } from "vitest";

import type { SessionRuntimeState } from "@omi/agent";
import type { Run } from "@omi/core";
import { commandMap, parseResult } from "@omi/core";

import {
  collectRunEventDeliveries,
  handleRunnerRequest,
  resetRunEventSubscriptions,
  RunnerCommandError,
  SUPPORTED_COMMANDS,
} from "../src/request-handler";

describe("runner request handler", () => {
  const runtimeState: SessionRuntimeState = {
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
  };

  const run: Run = {
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
  };

  const orchestrator = {
    createSession: vi.fn((title: string) => ({
      id: "session_1",
      title,
      status: "idle" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      latestUserMessage: null,
      latestAssistantMessage: null,
    })),
    updateSessionTitle: vi.fn(),
    listSessions: vi.fn(() => []),
    getSessionDetail: vi.fn(() => ({
      session: {
        id: "session_1",
        title: "Thread",
        status: "idle" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        latestUserMessage: null,
        latestAssistantMessage: null,
      },
      messages: [],
      tasks: [],
    })),
    getSessionRuntimeState: vi.fn(() => runtimeState),
    listSessionHistory: vi.fn(() => ({ sessionId: "session_1", historyEntries: [] })),
    getGitStatus: vi.fn(async () => ({
      hasRepository: false,
      root: null,
      branch: null,
      branches: [],
      files: [],
    })),
    getGitDiff: vi.fn(async () => ({
      path: "README.md",
      status: "modified" as const,
      leftTitle: "HEAD",
      rightTitle: "Working tree",
      rows: [],
    })),
    startRun: vi.fn(() => run),
    continueFromHistoryEntry: vi.fn(() => run),
    cancelRun: vi.fn(() => ({ runId: "run_1", canceled: true as const })),
    approveTool: vi.fn(),
    rejectTool: vi.fn(),
    listPendingToolCalls: vi.fn(() => ({
      sessionId: "session_1",
      runtime: runtimeState,
      pendingToolCalls: [],
    })),
    listToolCalls: vi.fn(() => ({ sessionId: "session_1", toolCalls: [] })),
    setSessionWorkspaceRoot: vi.fn((sessionId: string, workspaceRoot: string | null) => ({
      sessionId,
      workspaceRoot: workspaceRoot ?? "/workspace",
    })),
    setSessionPermissionMode: vi.fn((sessionId: string, mode: "default" | "full-access") => ({
      sessionId,
      mode,
    })),
    switchModel: vi.fn(() => ({ sessionId: "session_1", runtime: runtimeState })),
    saveProviderConfig: vi.fn(),
    deleteProviderConfig: vi.fn(() => ({ deleted: true })),
    listModels: vi.fn(() => ({ providerConfigs: [], builtInProviders: [] })),
    database: {
      getRun: vi.fn((runId: string) => (runId === "run_1" ? run : null)),
      listCheckpoints: vi.fn(() => []),
    },
  };

  it("keeps runner command handling in sync with protocol command map", () => {
    const protocolCommands = Object.keys(commandMap).sort();
    const runnerCommands = [...SUPPORTED_COMMANDS].sort();
    expect(runnerCommands).toEqual(protocolCommands);
  });

  it("routes supported commands and normalizes schema-backed results", async () => {
    const runtimeResponse = await handleRunnerRequest(orchestrator, {
      id: "1",
      method: "session.runtime.get",
      params: { sessionId: "session_1" },
    });

    expect(runtimeResponse).toEqual({ sessionId: "session_1", runtime: runtimeState });
    expect(parseResult("session.runtime.get", runtimeResponse)).toEqual(runtimeResponse);

    const started = await handleRunnerRequest(orchestrator, {
      id: "2",
      method: "run.start",
      params: { sessionId: "session_1", taskId: null, prompt: "hello", contextFiles: ["README.md"] },
    });

    expect(started).toEqual(run);
    expect(orchestrator.startRun).toHaveBeenCalledWith({
      sessionId: "session_1",
      taskId: null,
      prompt: "hello",
      contextFiles: ["README.md"],
    });

    const runState = await handleRunnerRequest(orchestrator, {
      id: "3",
      method: "run.state.get",
      params: { runId: "run_1" },
    });
    expect(runState).toEqual({ run, checkpoints: [] });
    expect(parseResult("run.state.get", runState)).toEqual(runState);
  });

  it("delivers subscribed run events", async () => {
    resetRunEventSubscriptions();

    const subscribed = await handleRunnerRequest(orchestrator, {
      id: "4",
      method: "run.events.subscribe",
      params: { runId: "run_1", events: ["run.delta"] },
    });

    expect(subscribed).toMatchObject({ runId: "run_1" });

    const deliveries = collectRunEventDeliveries("run.delta", {
      runId: "run_1",
      sessionId: "session_1",
      delta: "hello",
    });

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      runId: "run_1",
      event: "run.delta",
      payload: {
        runId: "run_1",
        sessionId: "session_1",
        delta: "hello",
      },
    });
  });

  it("returns structured unsupported-command errors", async () => {
    await expect(
      handleRunnerRequest(orchestrator, {
        id: "5",
        method: "session.compact",
        params: { sessionId: "session_1" },
      } as any),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_COMMAND",
      message: "Unsupported command: session.compact",
    } satisfies Partial<RunnerCommandError>);
  });
});
