import { describe, expect, it, vi } from "vitest";

import type { SessionRuntimeState } from "@omi/agent";
import type { SessionBranch as CoreSessionBranch, Run } from "@omi/core";
import type { CompactionSummaryDocument } from "@omi/memory";
import { parseResult } from "@omi/protocol";

import { normalizeResult } from "../src/protocol";
import {
  collectRunEventDeliveries,
  handleRunnerRequest,
  resetRunEventSubscriptions,
} from "../src/request-handler";

describe("runner request handler", () => {
  it("returns structured payloads for runtime, branches, run state, and mode control", async () => {
    resetRunEventSubscriptions();

    const runtimeState: SessionRuntimeState = {
      version: 1,
      sessionId: "session_1",
      activeRunId: null,
      pendingRunIds: [],
      queuedRuns: [],
      blockedRunId: null,
      blockedToolCallId: null,
      pendingApprovalToolCallIds: [],
      interruptedRunIds: [],
      selectedProviderConfigId: null,
      lastUserPrompt: null,
      lastAssistantResponse: null,
      lastActivityAt: "2025-03-30T00:00:00.000Z",
      activeBranchId: null,
      compaction: {
        status: "idle",
        reason: null,
        requestedAt: null,
        updatedAt: "2025-03-30T00:00:00.000Z",
        lastSummary: null,
        lastCompactedAt: null,
        error: null,
      },
    };

    const mainBranch: CoreSessionBranch = {
      id: "branch_main",
      sessionId: "session_1",
      headEntryId: null,
      title: "main",
      createdAt: "2025-03-30T00:00:00.000Z",
      updatedAt: "2025-03-30T00:00:00.000Z",
    };

    const featureBranch: CoreSessionBranch = {
      id: "branch_feature",
      sessionId: "session_1",
      headEntryId: "hist_1",
      title: "feature",
      createdAt: "2025-03-30T00:00:00.000Z",
      updatedAt: "2025-03-30T00:00:00.000Z",
    };

    let activeBranchId = "branch_main";

    const runStateRun: Run = {
      id: "run_1",
      sessionId: "session_1",
      taskId: null,
      status: "running",
      provider: "anthropic",
      prompt: "Inspect the repo",
      sourceRunId: null,
      recoveryMode: "start",
      originRunId: null,
      resumeFromCheckpoint: null,
      terminalReason: null,
      createdAt: "2025-03-30T00:00:00.000Z",
      updatedAt: "2025-03-30T00:00:00.000Z",
    };

    const orchestrator = {
      createSession: vi.fn(),
      updateSessionTitle: vi.fn((sessionId: string, title: string) => ({
        session: {
          id: sessionId,
          title,
          status: "idle" as const,
          createdAt: "2025-03-30T00:00:00.000Z",
          updatedAt: "2025-03-30T00:00:00.000Z",
          latestUserMessage: null,
          latestAssistantMessage: null,
        },
      })),
      listSessions: vi.fn(),
      getSessionDetail: vi.fn(),
      getSessionRuntimeState: vi.fn(() => runtimeState),
      listSessionHistory: vi.fn(() => ({
        sessionId: "session_1",
        historyEntries: [],
      })),
      listSkills: vi.fn(async () => []),
      searchSkills: vi.fn(),
      listTasks: vi.fn(),
      updateTask: vi.fn(),
      getGitStatus: vi.fn(),
      getGitDiff: vi.fn(),
      startRun: vi.fn(),
      continueFromHistoryEntry: vi.fn(() => ({
        id: "run_2",
        sessionId: "session_1",
        taskId: null,
        status: "queued",
        provider: "anthropic",
        createdAt: "2025-03-30T00:00:00.000Z",
        updatedAt: "2025-03-30T00:00:00.000Z",
      } satisfies Run)),
      retryRun: vi.fn(),
      resumeRun: vi.fn(),
      cancelRun: vi.fn(),
      approveTool: vi.fn(),
      rejectTool: vi.fn(),
      listPendingToolCalls: vi.fn(() => ({
        sessionId: "session_1",
        runtime: runtimeState,
        pendingToolCalls: [],
      })),
      listToolCalls: vi.fn(() => ({
        sessionId: "session_1",
        toolCalls: [],
      })),
      setSessionWorkspaceRoot: vi.fn((sessionId: string, workspaceRoot: string | null) => ({
        sessionId,
        workspaceRoot: workspaceRoot ?? "/workspace/default",
      })),
      setSessionPermissionMode: vi.fn((sessionId: string, mode: "default" | "full-access") => ({
        sessionId,
        mode,
      })),
      switchModel: vi.fn(() => ({
        sessionId: "session_1",
        runtime: runtimeState,
      })),
      saveProviderConfig: vi.fn((input) => ({
        id: input.id ?? "provider_1",
        name: "OpenAI",
        type: input.type,
        protocol: input.protocol,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: input.model,
        createdAt: "2025-03-30T00:00:00.000Z",
        updatedAt: "2025-03-30T00:00:00.000Z",
      })),
      deleteProviderConfig: vi.fn(() => ({ deleted: true })),
      compactSession: vi.fn(async () => {
        const summary: CompactionSummaryDocument = {
          version: 1,
          goal: "summary",
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

        return {
          sessionId: "session_1",
          runtime: runtimeState,
          summary,
          compactedAt: "2025-03-30T00:00:00.000Z",
        };
      }),
      listExtensions: vi.fn(),
      listModels: vi.fn(),
      database: {
        getRun: vi.fn((runId: string) => (runId === "run_1" ? runStateRun : null)),
        listCheckpoints: vi.fn(() => [
          {
            id: "ckpt_1",
            createdAt: "2025-03-30T00:00:00.000Z",
            phase: "before_model_call",
            payload: { checkpoint: "state" },
          },
        ]),
      },
      sessionManager: {
        createBranch: vi.fn((sessionId: string, title: string, fromEntryId: string | null) => {
          activeBranchId = "branch_feature";
          return {
            id: "branch_feature",
            sessionId,
            headEntryId: fromEntryId,
            title,
            createdAt: "2025-03-30T00:00:00.000Z",
            updatedAt: "2025-03-30T00:00:00.000Z",
          };
        }),
        listBranches: vi.fn(() => [mainBranch, featureBranch]),
        switchBranch: vi.fn((sessionId: string, branchId: string) => {
          activeBranchId = branchId;
          return branchId === "branch_main" ? mainBranch : featureBranch;
        }),
        getActiveBranchId: vi.fn(() => activeBranchId),
      },
    };

    const runtimeResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_1",
      method: "session.runtime.get",
      params: { sessionId: "session_1" },
    });
    expect(runtimeResponse).toEqual({
      sessionId: "session_1",
      runtime: runtimeState,
    });
    expect(normalizeResult("session.runtime.get", runtimeResponse)).toEqual(
      parseResult("session.runtime.get", runtimeResponse),
    );

    const updatedTitleResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_title",
      method: "session.title.update",
      params: {
        sessionId: "session_1",
        title: "renamed thread",
      },
    });
    expect(updatedTitleResponse).toEqual({
      session: {
        id: "session_1",
        title: "renamed thread",
        status: "idle",
        createdAt: "2025-03-30T00:00:00.000Z",
        updatedAt: "2025-03-30T00:00:00.000Z",
        latestUserMessage: null,
        latestAssistantMessage: null,
      },
    });
    expect(normalizeResult("session.title.update", updatedTitleResponse)).toEqual(
      parseResult("session.title.update", updatedTitleResponse),
    );

    const workspaceResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_workspace",
      method: "session.workspace.set",
      params: {
        sessionId: "session_1",
        workspaceRoot: "/workspace/repo-a",
      },
    });
    expect(workspaceResponse).toEqual({
      sessionId: "session_1",
      workspaceRoot: "/workspace/repo-a",
    });
    expect(normalizeResult("session.workspace.set", workspaceResponse)).toEqual(
      parseResult("session.workspace.set", workspaceResponse),
    );

    const permissionResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_permission",
      method: "session.permission.set",
      params: {
        sessionId: "session_1",
        mode: "full-access",
      },
    });
    expect(permissionResponse).toEqual({
      sessionId: "session_1",
      mode: "full-access",
    });
    expect(normalizeResult("session.permission.set", permissionResponse)).toEqual(
      parseResult("session.permission.set", permissionResponse),
    );

    await handleRunnerRequest(orchestrator, {
      id: "rpc_run_start",
      method: "run.start",
      params: {
        sessionId: "session_1",
        taskId: null,
        prompt: "inspect selected files first",
        contextFiles: ["src/index.ts", "README.md"],
      },
    });
    expect(orchestrator.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_1",
        taskId: null,
        prompt: "inspect selected files first",
        contextFiles: ["src/index.ts", "README.md"],
      }),
    );

    const createdBranchResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_2",
      method: "session.branch.create",
      params: {
        sessionId: "session_1",
        branchName: "feature",
        fromEntryId: "hist_1",
      },
    });
    expect(createdBranchResponse).toEqual({
      sessionId: "session_1",
      branch: {
        id: "branch_feature",
        name: "feature",
        sessionId: "session_1",
        parentEntryId: "hist_1",
        createdAt: "2025-03-30T00:00:00.000Z",
        isActive: true,
      },
    });
    expect(normalizeResult("session.branch.create", createdBranchResponse)).toEqual(
      parseResult("session.branch.create", createdBranchResponse),
    );

    const listedBranchesResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_3",
      method: "session.branch.list",
      params: {
        sessionId: "session_1",
      },
    });
    expect(listedBranchesResponse).toEqual({
      sessionId: "session_1",
      branches: [
        {
          id: "branch_main",
          name: "main",
          sessionId: "session_1",
          parentEntryId: null,
          createdAt: "2025-03-30T00:00:00.000Z",
          isActive: false,
        },
        {
          id: "branch_feature",
          name: "feature",
          sessionId: "session_1",
          parentEntryId: "hist_1",
          createdAt: "2025-03-30T00:00:00.000Z",
          isActive: true,
        },
      ],
    });
    expect(normalizeResult("session.branch.list", listedBranchesResponse)).toEqual(
      parseResult("session.branch.list", listedBranchesResponse),
    );

    const switchedBranchResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_4",
      method: "session.branch.switch",
      params: {
        sessionId: "session_1",
        branchId: "branch_main",
      },
    });
    expect(switchedBranchResponse).toEqual({
      sessionId: "session_1",
      branch: {
        id: "branch_main",
        name: "main",
        sessionId: "session_1",
        parentEntryId: null,
        createdAt: "2025-03-30T00:00:00.000Z",
        isActive: true,
      },
      previousBranchId: "branch_feature",
    });
    expect(normalizeResult("session.branch.switch", switchedBranchResponse)).toEqual(
      parseResult("session.branch.switch", switchedBranchResponse),
    );

    const runStateResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_5",
      method: "run.state.get",
      params: {
        runId: "run_1",
      },
    });
    expect(runStateResponse).toEqual({
      run: {
        runId: "run_1",
        sessionId: "session_1",
        status: "running",
        startedAt: "2025-03-30T00:00:00.000Z",
        currentToolCallId: null,
        pendingApprovalToolCallIds: [],
        error: null,
        checkpoints: [
          {
            id: "ckpt_1",
            createdAt: "2025-03-30T00:00:00.000Z",
            phase: "before_model_call",
            payload: { checkpoint: "state" },
          },
        ],
      },
    });
    expect(normalizeResult("run.state.get", runStateResponse)).toEqual(
      parseResult("run.state.get", runStateResponse),
    );

    const runEventsResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_5b",
      method: "run.events.subscribe",
      params: {
        runId: "run_1",
        events: ["run.completed", "run.failed"],
      },
    });
    expect(runEventsResponse).toEqual({
      runId: "run_1",
      subscriptionId: expect.any(String),
      events: ["run.completed", "run.failed"],
    });
    expect(normalizeResult("run.events.subscribe", runEventsResponse)).toEqual(
      parseResult("run.events.subscribe", runEventsResponse),
    );

    const runEventSubscription = runEventsResponse as { subscriptionId: string };
    const deliveries = collectRunEventDeliveries("run.completed", {
      runId: "run_1",
      sessionId: "session_1",
      summary: "done",
    });
    expect(deliveries).toEqual([
      {
        runId: "run_1",
        subscriptionId: runEventSubscription.subscriptionId,
        event: "run.completed",
        payload: {
          runId: "run_1",
          sessionId: "session_1",
          summary: "done",
        },
        deliveredAt: expect.any(String),
      },
    ]);

    expect(
      collectRunEventDeliveries("run.delta", {
        runId: "run_1",
        sessionId: "session_1",
      }),
    ).toEqual([]);

    const runEventsUnsubscribeResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_5c",
      method: "run.events.unsubscribe",
      params: {
        runId: "run_1",
        subscriptionId: runEventSubscription.subscriptionId,
      },
    });
    expect(runEventsUnsubscribeResponse).toEqual({
      runId: "run_1",
      subscriptionId: runEventSubscription.subscriptionId,
      unsubscribed: true,
    });
    expect(normalizeResult("run.events.unsubscribe", runEventsUnsubscribeResponse)).toEqual(
      parseResult("run.events.unsubscribe", runEventsUnsubscribeResponse),
    );

    expect(
      collectRunEventDeliveries("run.completed", {
        runId: "run_1",
        sessionId: "session_1",
        summary: "done again",
      }),
    ).toEqual([]);

    const refreshedSkillsResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_5d",
      method: "skill.refresh",
      params: {},
    });
    expect(refreshedSkillsResponse).toEqual({
      refreshedAt: expect.any(String),
      skills: [],
    });
    expect(normalizeResult("skill.refresh", refreshedSkillsResponse)).toEqual(
      parseResult("skill.refresh", refreshedSkillsResponse),
    );

    const enteredModeResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_6",
      method: "session.mode.enter",
      params: {
        sessionId: "session_1",
        mode: "plan",
        config: { summary: "plan" },
      },
    });
    expect(enteredModeResponse).toEqual({
      sessionId: "session_1",
      mode: {
        sessionId: "session_1",
        mode: "plan",
        status: "planning",
        enteredAt: expect.any(String),
        summary: "plan",
      },
    });
    expect(normalizeResult("session.mode.enter", enteredModeResponse)).toEqual(
      parseResult("session.mode.enter", enteredModeResponse),
    );

    const exitedModeResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_7",
      method: "session.mode.exit",
      params: {
        sessionId: "session_1",
        discard: false,
      },
    });
    expect(exitedModeResponse).toEqual({
      sessionId: "session_1",
      previousMode: expect.objectContaining({
        sessionId: "session_1",
        mode: "plan",
      }),
      discarded: false,
    });
    expect(normalizeResult("session.mode.exit", exitedModeResponse)).toEqual(
      parseResult("session.mode.exit", exitedModeResponse),
    );

    const pendingResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_8",
      method: "tool.pending.list",
      params: { sessionId: "session_1" },
    });
    expect(pendingResponse).toEqual({
      sessionId: "session_1",
      runtime: runtimeState,
      pendingToolCalls: [],
    });
    expect(normalizeResult("tool.pending.list", pendingResponse)).toEqual(
      parseResult("tool.pending.list", pendingResponse),
    );

    const switchedResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_9",
      method: "session.model.switch",
      params: {
        sessionId: "session_1",
        providerConfigId: "provider_1",
      },
    });
    expect(switchedResponse).toEqual({
      sessionId: "session_1",
      runtime: runtimeState,
    });
    expect(normalizeResult("session.model.switch", switchedResponse)).toEqual(
      parseResult("session.model.switch", switchedResponse),
    );

    const compactedResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_10",
      method: "session.compact",
      params: {
        sessionId: "session_1",
      },
    });
    expect(compactedResponse).toEqual({
      sessionId: "session_1",
      runtime: runtimeState,
      summary: {
        version: 1,
        goal: "summary",
        constraints: [],
        progress: {
          done: [],
          inProgress: [],
          blocked: [],
        },
        keyDecisions: [],
        nextSteps: [],
        criticalContext: [],
      },
      compactedAt: "2025-03-30T00:00:00.000Z",
    });
    expect(normalizeResult("session.compact", compactedResponse)).toEqual(
      parseResult("session.compact", compactedResponse),
    );

    const historyResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_11",
      method: "session.history.list",
      params: {
        sessionId: "session_1",
      },
    });
    expect(historyResponse).toEqual({
      sessionId: "session_1",
      historyEntries: [],
    });
    expect(normalizeResult("session.history.list", historyResponse)).toEqual(
      parseResult("session.history.list", historyResponse),
    );

    const continuedResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_12",
      method: "session.history.continue",
      params: {
        sessionId: "session_1",
        historyEntryId: "hist_1",
        prompt: "continue from branch",
        checkpointSummary: "branch checkpoint",
        checkpointDetails: { source: "test" },
      },
    });
    expect(continuedResponse).toMatchObject({
      id: "run_2",
      sessionId: "session_1",
      status: "queued",
    });
    expect(normalizeResult("session.history.continue", continuedResponse)).toEqual(
      parseResult("session.history.continue", continuedResponse),
    );
  });
});
